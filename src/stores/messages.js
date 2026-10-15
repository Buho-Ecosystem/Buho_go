/**
 * Messages store: the contact chat's state, nothing else.
 *
 * Pure state and persistence. No network, no wallet calls, no i18n; the inbox
 * (`services/dm/inbox.js`) feeds it parsed `ChatMessage`s and the UI reads it.
 * Message content is never logged.
 *
 * Scoping. Everything belongs to one identity pubkey (`scope`). `setScope`
 * saves the previous identity's state under ITS key, empties memory and only
 * then loads the next identity's record, so two identities never mix. While no
 * scope is set (before the first load, after `setScope(null)`) every mutating
 * action is a no-op and nothing is persisted.
 *
 * Shape (also the persisted format, `STATE_VERSION` 2):
 *   threads[partner] = { messages, reactions, unread, lastReadAt, muted }
 *     messages   ChatMessage[] sorted by (createdAt, id), deduped by rumor id,
 *                never containing reactions; outgoing ones carry `delivery`
 *     reactions  { [targetId]: { [senderPubkey]: { emoji, createdAt, id } } }
 *   blocked      pubkeys whose messages are dropped
 *   blockChanges block / unblock changes made here and not yet saved to the
 *                person's NIP-51 mute list: [{ op: 'block' | 'unblock', pubkey }]
 *                (services/dm/muteList.js); a record from before the list
 *                sync starts with its blocks in it, so they are published
 *   syncCursor   unix seconds of the last completed inbox sync, or null
 *   outbox       items waiting to be (re)sent, see `enqueueOutbox`
 *   inboxRelays  the inbox relay resolver's `snapshot()`, or null
 *   requestGoals private shared-request manifests (never sent to partners)
 *   settlements  own requests whose payment a wallet of the user confirmed, by request id (see `setSettlement`)
 *   ownPayments  payments the user made for a partner's request, by request id:
 *                { status: 'pending' | 'sent', announced, amountSats, ... }; a
 *                request paid here is never offered for paying again
 *   signerAppMessages  true once the person turned messages on for an identity
 *                that signs in another app (each message asks that app; see
 *                services/dm/dmSigner.js), so receiving never starts unasked
 *   handledWraps gift wrap id -> its created_at, for wraps already opened and
 *                dealt with: a restart re-reads two days of wraps and must not
 *                decrypt them again (a signer app would be asked each time)
 *
 * Time units: message times and `now` arguments are unix SECONDS (rumor
 * `created_at`, request `validUntil`); only the debounce works in milliseconds.
 */

import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { DELIVERY, REQUEST_STATE, SINCE_SLACK_SECONDS } from '../services/dm/constants.js'
import { MESSAGE_TYPE, REQUEST_STATUS } from '../services/dm/protocol.js'
import { loadChatState, saveChatState, deleteChatState, deleteAllChatStates } from '../utils/dmStorage.js'
import { useAddressBookStore } from './addressBook.js'
import { normalizeRequestGoal, requestIdsOf } from '../services/dm/requestGoals.js'
import { requestSourceKey } from '../utils/requestAllocation.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STATE_VERSION = 2

/** Threads with people outside the address book kept at most: the least recently active one goes first. */
export const MAX_UNKNOWN_THREADS = 50

/** Wrap ids remembered as handled at most (the oldest go first). */
export const MAX_HANDLED_WRAPS = 5000

/** Messages kept per thread by `prune` (pending requests are kept on top). */
export const MAX_MESSAGES_PER_THREAD = 500

/** A thread is pruned on ingest once it exceeds the cap by this much (amortises the work). */
const PRUNE_SLACK = 100

/** Quiet time before a change is written, and the longest a steady stream may delay a write. */
export const SAVE_DEBOUNCE_MS = 400
export const SAVE_MAX_WAIT_MS = 5000

// Defined with the other chat constants, so components read the same values without the store.
export { DELIVERY, REQUEST_STATE }

const DELIVERY_VALUES = new Set(Object.values(DELIVERY))


const MESSAGE_TYPES = new Set(Object.values(MESSAGE_TYPE))
const OWN_PAYMENT_STATUSES = new Set(['pending', 'sent'])
const HEX_64 = /^[0-9a-f]{64}$/

// ---------------------------------------------------------------------------
// Collaborators (replaceable for tests and wiring)
// ---------------------------------------------------------------------------

const defaultDeps = () => ({
  storage: { loadChatState, saveChatState, deleteChatState, deleteAllChatStates },
  /** Unix seconds. */
  now: () => Math.floor(Date.now() / 1000),
  /** Milliseconds, for the debounce only. */
  nowMs: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: handle => clearTimeout(handle),
  /** Is this pubkey one of the user's saved contacts? */
  isKnownContact: pubkey => Boolean(useAddressBookStore().findContactByPubkey(pubkey)),
  saveDelayMs: SAVE_DEBOUNCE_MS,
  saveMaxWaitMs: SAVE_MAX_WAIT_MS,
  /** Never receives message content. */
  warn: (message, detail) => console.warn(message, detail ?? ''),
})

let deps = defaultDeps()

/** Override collaborators; only the given keys change. */
export function configureMessages(overrides = {}) {
  deps = { ...deps, ...overrides }
}

/** Restore the production collaborators. */
export function resetMessagesConfig() {
  deps = defaultDeps()
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function hexKey(value) {
  if (typeof value !== 'string') return null
  const hex = value.trim().toLowerCase()
  return HEX_64.test(hex) ? hex : null
}

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isCount = value => Number.isInteger(value) && value >= 0

/** Total order of a thread: time, then id (so every device sorts alike). */
function compareMessages(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

function copyOrNull(value) {
  return isPlainObject(value) ? { ...value } : null
}

/**
 * The stored form of a ChatMessage: only the contract's fields, validated for
 * consistency with the active identity. Null when it does not belong here.
 */
function normalizeMessage(raw, me) {
  if (!isPlainObject(raw)) return null
  const id = hexKey(raw.id)
  const partner = hexKey(raw.partner)
  const sender = hexKey(raw.sender)
  const recipient = hexKey(raw.recipient)
  if (!id || !partner || !sender || !recipient || partner === me) return null
  if (!MESSAGE_TYPES.has(raw.type) || typeof raw.outgoing !== 'boolean') return null
  if (!Number.isFinite(raw.createdAt) || raw.createdAt < 0) return null
  // The sender must be who the direction says: the partner, or me.
  if (sender !== (raw.outgoing ? me : partner)) return null
  if (raw.type === MESSAGE_TYPE.REACTION && !(isPlainObject(raw.reaction) && hexKey(raw.reaction.targetId))) return null
  if (raw.type === MESSAGE_TYPE.REQUEST && !isPlainObject(raw.request)) return null
  if (raw.type === MESSAGE_TYPE.STATUS && !(isPlainObject(raw.status) && hexKey(raw.status.requestId))) return null

  return {
    id,
    kind: raw.kind ?? null,
    type: raw.type,
    sender,
    recipient,
    partner,
    outgoing: raw.outgoing,
    createdAt: raw.createdAt,
    text: typeof raw.text === 'string' ? raw.text : '',
    replyTo: typeof raw.replyTo === 'string' ? raw.replyTo : null,
    request: copyOrNull(raw.request),
    status: raw.status ? { ...raw.status, requestId: hexKey(raw.status.requestId) } : null,
    payment: copyOrNull(raw.payment),
    reaction: raw.reaction ? { ...raw.reaction, targetId: hexKey(raw.reaction.targetId) } : null,
    degraded: raw.degraded === true,
  }
}

function emptyThread() {
  return { messages: [], reactions: {}, unread: 0, lastReadAt: 0, muted: false }
}

function emptyState() {
  return {
    threads: {}, blocked: [], blockChanges: [], syncCursor: null, outbox: [], inboxRelays: null, settlements: {}, handledWraps: {},
    signerAppMessages: false,
    ownPayments: {},
    requestGoals: {},
    // Not persisted: why received messages wait for the signer app (a DmError code), or null.
    signerHold: null,
  }
}

/**
 * Derive the state of every request in a thread in one pass.
 *
 * A status counts only from the right party: `paid` and `declined` from the
 * payer (the request's recipient), `cancelled` from the requester (its sender).
 * `reminder` never changes a state. The latest valid status wins, `paid` is
 * final, and an unanswered request whose `valid_until` has passed is `expired`
 * (docs section 8a). A declined or cancelled request stays so after
 * its lifetime ends, and a payment that comes late still turns it `paid`.
 *
 * The payer's own side counts too, so a request they paid is never offered
 * for paying again: their own `payment` message for it, and their own record
 * of the payment (`ownPayments`, kept when the wallet sent it, even if the
 * announcement could not go out yet): sent is `paid`, still routing is
 * `paying`.
 *
 * @param {object[]} messages Sorted thread messages.
 * @param {number} now Unix seconds.
 * @param {Record<string, { status: 'pending' | 'sent' }>} [ownPayments] By request id.
 * @returns {Map<string, string>} request id -> REQUEST_STATE
 */
export function deriveRequestStates(messages, now, ownPayments = {}) {
  const requests = new Map()
  for (const m of messages) {
    if (m.type === MESSAGE_TYPE.REQUEST) requests.set(m.id, m)
  }
  const states = new Map()
  for (const id of requests.keys()) states.set(id, REQUEST_STATE.PENDING)

  for (const m of messages) {
    if (m.type !== MESSAGE_TYPE.PAYMENT || !m.payment.requestId) continue
    const request = requests.get(m.payment.requestId)
    // Less than was asked (an underpaid "Send anyway") does not pay the request.
    if (request && m.outgoing && m.sender === request.recipient && m.payment.amountSats >= request.request.amountSats) {
      states.set(request.id, REQUEST_STATE.PAID)
    }
  }

  for (const m of messages) {
    if (m.type !== MESSAGE_TYPE.STATUS) continue
    const request = requests.get(m.status.requestId)
    if (!request || states.get(request.id) === REQUEST_STATE.PAID) continue
    const { value } = m.status
    if (value === REQUEST_STATUS.PAID && m.sender === request.recipient) {
      states.set(request.id, REQUEST_STATE.PAID)
    } else if (value === REQUEST_STATUS.DECLINED && m.sender === request.recipient) {
      states.set(request.id, REQUEST_STATE.DECLINED)
    } else if (value === REQUEST_STATUS.CANCELLED && m.sender === request.sender) {
      states.set(request.id, REQUEST_STATE.CANCELLED)
    }
  }

  for (const [id, request] of requests) {
    if (request.outgoing || states.get(id) === REQUEST_STATE.PAID) continue
    const own = ownPayments[id]?.status
    if (own === 'sent') states.set(id, REQUEST_STATE.PAID)
    else if (own === 'pending') states.set(id, REQUEST_STATE.PAYING)
  }

  for (const [id, request] of requests) {
    if (states.get(id) === REQUEST_STATE.PENDING && request.request.validUntil < now) {
      states.set(id, REQUEST_STATE.EXPIRED)
    }
  }
  // A signed replacement closes the original; paying either version never
  // offers the other again. A peer cannot replace somebody else's request.
  for (const replacement of requests.values()) {
    const original = requests.get(replacement.request.replaces)
    if (!original || original.sender !== replacement.sender || original.recipient !== replacement.recipient
      || original.request.amountSats !== replacement.request.amountSats || replacement.createdAt <= original.createdAt) continue
    const oldState = states.get(original.id), newState = states.get(replacement.id)
    if (oldState === REQUEST_STATE.PAID || newState === REQUEST_STATE.PAID) {
      states.set(original.id, REQUEST_STATE.PAID); states.set(replacement.id, REQUEST_STATE.PAID)
    } else if (oldState === REQUEST_STATE.PAYING || newState === REQUEST_STATE.PAYING) {
      states.set(original.id, REQUEST_STATE.PAYING); states.set(replacement.id, REQUEST_STATE.PAYING)
    } else states.set(original.id, REQUEST_STATE.CANCELLED)
  }
  return states
}

/**
 * Keep the last `max` messages of a thread plus every still-pending request
 * and the status messages that belong to a kept request (so a kept request
 * never loses the answer that settles it). Reactions on dropped messages go too.
 * @returns {number} How many messages were dropped.
 */
function pruneThread(thread, now, max, retainedRequests = new Set()) {
  const { messages } = thread
  if (messages.length <= max) return 0

  const keep = new Set(messages.slice(messages.length - max).map(m => m.id))
  const states = deriveRequestStates(messages, now)
  for (const m of messages) {
    if (m.type === MESSAGE_TYPE.REQUEST && (states.get(m.id) === REQUEST_STATE.PENDING || retainedRequests.has(m.id))) keep.add(m.id)
  }
  for (const m of messages) {
    if (m.type === MESSAGE_TYPE.STATUS && keep.has(m.status.requestId)) keep.add(m.id)
    if (m.type === MESSAGE_TYPE.PAYMENT && retainedRequests.has(m.payment?.requestId)) keep.add(m.id)
  }

  const dropped = messages.filter(m => !keep.has(m.id))
  if (dropped.length === 0) return 0
  thread.messages = messages.filter(m => keep.has(m.id))
  for (const m of dropped) delete thread.reactions[m.id]
  return dropped.length
}

/** Apply a reaction; false when it is a duplicate or older than the sender's current one. */
function applyReaction(thread, message) {
  const { targetId, emoji } = message.reaction
  const bySender = (thread.reactions[targetId] ||= {})
  const current = bySender[message.sender]
  if (current && compareMessages(current, message) >= 0) return false
  bySender[message.sender] = { emoji, createdAt: message.createdAt, id: message.id }
  return true
}

// ---------------------------------------------------------------------------
// Persisted format: migration and validation
// ---------------------------------------------------------------------------

/** `MIGRATIONS[n]` upgrades a version-n record to n + 1. Version 1 migrates without losing its chat history. */
const MIGRATIONS = { 1: raw => ({ ...raw, requestGoals: {} }) }

/**
 * Bring a stored record to `STATE_VERSION`.
 * @returns {{ raw: object | null, tooNew: boolean }} `raw` null when unusable.
 */
export function migrateState(raw) {
  if (!isPlainObject(raw) || !isCount(raw.version)) return { raw: null, tooNew: false }
  if (raw.version > STATE_VERSION) return { raw: null, tooNew: true }
  let current = raw
  while (current.version < STATE_VERSION) {
    const step = MIGRATIONS[current.version]
    if (!step) return { raw: null, tooNew: false }
    current = { ...step(current), version: current.version + 1 }
  }
  return { raw: current, tooNew: false }
}

function restoreOutbox(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const items = []
  for (const item of raw) {
    const id = isPlainObject(item) ? hexKey(item.id) : null
    const partner = isPlainObject(item) ? hexKey(item.partner) : null
    if (!id || !partner || seen.has(id)) continue
    seen.add(id)
    items.push({ ...item, id, partner })
  }
  return items
}

function restoreReactions(raw) {
  const out = {}
  if (!isPlainObject(raw)) return out
  for (const [targetId, bySender] of Object.entries(raw)) {
    if (!hexKey(targetId) || !isPlainObject(bySender)) continue
    for (const [sender, entry] of Object.entries(bySender)) {
      if (!hexKey(sender) || !isPlainObject(entry)) continue
      if (typeof entry.emoji !== 'string' || !Number.isFinite(entry.createdAt) || !hexKey(entry.id)) continue
      ;(out[targetId] ||= {})[sender] = { emoji: entry.emoji, createdAt: entry.createdAt, id: entry.id }
    }
  }
  return out
}

/** Rebuild a clean in-memory state from a migrated record. Entries that do not validate are skipped. */
function restoreState(raw, me) {
  const state = emptyState()
  for (const rawGoal of Object.values(isPlainObject(raw.requestGoals) ? raw.requestGoals : {})) {
    const goal = normalizeRequestGoal(rawGoal, me)
    if (goal) state.requestGoals[goal.id] = goal
  }
  state.outbox = restoreOutbox(raw.outbox)
  const queued = new Set(state.outbox.map(item => item.id))

  if (isPlainObject(raw.threads)) {
    for (const [key, stored] of Object.entries(raw.threads)) {
      const partner = hexKey(key)
      if (!partner || partner === me || !isPlainObject(stored)) continue
      const thread = emptyThread()
      const seen = new Set()
      for (const entry of Array.isArray(stored.messages) ? stored.messages : []) {
        const message = normalizeMessage(entry, me)
        if (!message || message.partner !== partner || message.type === MESSAGE_TYPE.REACTION || seen.has(message.id)) continue
        seen.add(message.id)
        if (message.outgoing) {
          let delivery = DELIVERY_VALUES.has(entry.delivery) ? entry.delivery : DELIVERY.SENT
          // "Sending" cannot survive a restart: it is retried if it is still in the outbox.
          if (delivery === DELIVERY.SENDING) delivery = queued.has(message.id) ? DELIVERY.QUEUED : DELIVERY.FAILED
          message.delivery = delivery
        }
        thread.messages.push(message)
      }
      thread.messages.sort(compareMessages)
      thread.reactions = restoreReactions(stored.reactions)
      thread.unread = isCount(stored.unread) ? Math.min(stored.unread, thread.messages.length) : 0
      thread.lastReadAt = Number.isFinite(stored.lastReadAt) && stored.lastReadAt > 0 ? stored.lastReadAt : 0
      thread.muted = stored.muted === true
      state.threads[partner] = thread
    }
  }

  state.blocked = [...new Set((Array.isArray(raw.blocked) ? raw.blocked : []).map(hexKey).filter(Boolean))]
  state.blockChanges = Array.isArray(raw.blockChanges)
    ? raw.blockChanges
      .filter(change => isPlainObject(change) && (change.op === 'block' || change.op === 'unblock') && hexKey(change.pubkey))
      .map(change => ({ op: change.op, pubkey: hexKey(change.pubkey) }))
    : state.blocked.map(pubkey => ({ op: 'block', pubkey }))
  state.syncCursor = isCount(raw.syncCursor) ? raw.syncCursor : null
  state.inboxRelays = isPlainObject(raw.inboxRelays) ? raw.inboxRelays : null
  if (isPlainObject(raw.settlements)) {
    for (const [requestId, settlement] of Object.entries(raw.settlements)) {
      if (hexKey(requestId) && isPlainObject(settlement)) state.settlements[requestId] = { ...settlement }
    }
  }
  state.signerAppMessages = raw.signerAppMessages === true
  if (isPlainObject(raw.ownPayments)) {
    for (const [requestId, record] of Object.entries(raw.ownPayments)) {
      if (hexKey(requestId) && isPlainObject(record) && OWN_PAYMENT_STATUSES.has(record.status)) state.ownPayments[requestId] = { ...record }
    }
  }
  if (isPlainObject(raw.handledWraps)) {
    for (const [wrapId, createdAt] of Object.entries(raw.handledWraps)) {
      if (hexKey(wrapId) && isCount(createdAt)) state.handledWraps[wrapId] = createdAt
    }
  }
  return state
}

// ---------------------------------------------------------------------------
// Runtime that must not be reactive or persisted (one per store instance)
// ---------------------------------------------------------------------------

const runtimes = new WeakMap()

function runtime(store) {
  // Pinia's devtools wrap each action in a different proxy. All actions
  // must share the same save queue and dirty flag, including nested ones.
  const key = toRaw(store)
  let r = runtimes.get(key)
  if (!r) {
    r = {
      generation: 0,
      chain: Promise.resolve(),
      timer: null,
      dirty: false,
      firstDirtyAt: null,
      /** False when the record could not be read or is newer than this app: never overwrite it. */
      persist: true,
    }
    runtimes.set(key, r)
  }
  return r
}

/** Storage operations run strictly in order, so a load always sees the save before it. */
function enqueue(r, task) {
  const run = r.chain.then(task)
  r.chain = run.catch(() => {})
  return run
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useMessagesStore = defineStore('messages', {
  state: () => ({
    /** The identity pubkey whose state is in memory; null until it has loaded. */
    scope: null,
    ...emptyState(),
    /** Partner whose chat is on screen (not persisted). */
    openThread: null,
  }),

  getters: {
    /** `thread(partner)` -> { partner, messages, unread, lastReadAt, muted }; an empty view when unknown. */
    thread: state => (partner) => {
      const key = hexKey(partner)
      const thread = key && state.threads[key]
      return thread
        ? { partner: key, messages: thread.messages, unread: thread.unread, lastReadAt: thread.lastReadAt, muted: thread.muted }
        : { partner: key, messages: [], unread: 0, lastReadAt: 0, muted: false }
    },

    /** Threads that have at least one message, last activity first: [{ partner, lastMessage, lastActivityAt, unread, muted }]. */
    threadsSorted: (state) => {
      const rows = []
      for (const [partner, thread] of Object.entries(state.threads)) {
        const lastMessage = thread.messages[thread.messages.length - 1]
        if (!lastMessage) continue
        rows.push({ partner, lastMessage, lastActivityAt: lastMessage.createdAt, unread: thread.unread, muted: thread.muted })
      }
      return rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt || (a.partner < b.partner ? -1 : 1))
    },

    /** Threads whose partner is not in the address book: the "Unknown" section. */
    unknownThreads() {
      return this.threadsSorted.filter(row => !deps.isKnownContact(row.partner))
    },

    /** Threads with a saved contact. */
    knownThreads() {
      return this.threadsSorted.filter(row => deps.isKnownContact(row.partner))
    },

    /** Unread messages of every conversation (the address book's Messages row). Muted chats are left out; `unreadFor` still counts them. */
    totalUnread: state => Object.values(state.threads).reduce((sum, t) => sum + (t.muted ? 0 : t.unread), 0),

    /**
     * Unread messages from contacts only: the app badge. A stranger (spam with
     * ever new keys) must not light a badge; their threads wait in Messages.
     */
    knownUnread(state) {
      return Object.entries(state.threads)
        .filter(([partner, t]) => !t.muted && deps.isKnownContact(partner))
        .reduce((sum, [, t]) => sum + t.unread, 0)
    },

    unreadFor: state => (partner) => state.threads[hexKey(partner)]?.unread ?? 0,

    /** `settlement(id)` -> `{ walletId?, address?, paymentHash?, paidAt }` once a wallet of the user confirmed the payment of an own request, or null. */
    settlement: state => requestId => state.settlements[requestId] ?? null,
    requestGoal: state => id => state.requestGoals[id] ?? null,
    requestGoalFor: state => requestId => Object.values(state.requestGoals).find(goal => goal.shares.some(share => requestIdsOf(share).includes(requestId))) ?? null,
    requestGoalForSource: state => source => {
      const key = requestSourceKey(source)
      return key ? Object.values(state.requestGoals).find(goal => requestSourceKey(goal.source) === key) ?? null : null
    },
    requestGoalsSorted: state => Object.values(state.requestGoals).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),

    isBlocked: state => pubkey => state.blocked.includes(hexKey(pubkey)),

    /** Block changes not yet saved to the mute list, oldest first (copies). */
    pendingBlockChanges: state => state.blockChanges.map(change => ({ ...change })),

    /** Reactions on one message: [{ emoji, count, mine, senders }], most used first. */
    reactionsFor: state => (partner, targetId) => {
      const bySender = state.threads[hexKey(partner)]?.reactions[targetId]
      if (!bySender) return []
      const groups = new Map()
      for (const [sender, r] of Object.entries(bySender)) {
        const group = groups.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false, senders: [], firstAt: r.createdAt }
        group.count += 1
        group.mine ||= sender === state.scope
        group.senders.push(sender)
        group.firstAt = Math.min(group.firstAt, r.createdAt)
        groups.set(r.emoji, group)
      }
      return [...groups.values()]
        .sort((a, b) => b.count - a.count || a.firstAt - b.firstAt)
        .map(({ firstAt, ...rest }) => rest)
    },

    /**
     * `requestStatus(id, now)` -> 'pending' | 'paying' | 'paid' | 'declined' | 'cancelled' | 'expired',
     * or null for an unknown request. `now` is unix seconds and defaults to the clock.
     */
    requestStatus: state => (requestId, now = deps.now()) => {
      for (const thread of Object.values(state.threads)) {
        if (thread.messages.some(m => m.type === MESSAGE_TYPE.REQUEST && m.id === requestId)) {
          return deriveRequestStates(thread.messages, now, state.ownPayments).get(requestId) ?? null
        }
      }
      return null
    },

    /**
     * Requests that wait for the user, oldest first: money a contact asked for
     * that is not paid, declined, cancelled or expired. Strangers and blocked
     * senders stay out (strangers light no badge; they wait in Messages).
     * `now` is unix seconds: a caller that shows the list keeps its own clock,
     * so a request leaves the list once it expires.
     */
    requestsToPay: state => (now = deps.now()) => {
      const open = []
      for (const [partner, thread] of Object.entries(state.threads)) {
        if (!deps.isKnownContact(partner) || state.blocked.includes(partner)) continue
        const states = deriveRequestStates(thread.messages, now, state.ownPayments)
        for (const m of thread.messages) {
          if (m.type === MESSAGE_TYPE.REQUEST && !m.outgoing && states.get(m.id) === REQUEST_STATE.PENDING) open.push(m)
        }
      }
      return open.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    },

    /** Requests the partner sent that can still be paid, oldest first. */
    pendingRequestsFrom: state => (partner, now = deps.now()) => {
      const thread = state.threads[hexKey(partner)]
      if (!thread) return []
      const states = deriveRequestStates(thread.messages, now, state.ownPayments)
      return thread.messages.filter(
        m => m.type === MESSAGE_TYPE.REQUEST && !m.outgoing && states.get(m.id) === REQUEST_STATE.PENDING,
      )
    },
  },

  actions: {
    // ----- scope and persistence -------------------------------------------

    /**
     * Switch to an identity (or to none). Saves the current state under its own
     * key first, then loads the new record. Resolves true when the state is
     * ready, false when a newer `setScope` superseded this call or the stored
     * record could not be read (the store then starts empty and does not write,
     * so it cannot overwrite what it failed to read).
     * @param {string | null} pubkey
     */
    async setScope(pubkey) {
      const next = pubkey === null || pubkey === undefined ? null : hexKey(pubkey)
      if (pubkey !== null && pubkey !== undefined && !next) throw new TypeError('messages: scope must be a 64-hex pubkey or null')
      const r = runtime(this)
      if (next !== null && next === this.scope) return true

      const token = ++r.generation
      this._detach()
      if (next === null) return true

      let record = null
      let readFailed = false
      try {
        record = await enqueue(r, () => deps.storage.loadChatState(next))
      } catch (error) {
        readFailed = true
        deps.warn('[messages] could not read chat storage', { reason: error?.name || 'Error' })
      }
      if (token !== r.generation) return false
      this._adopt(next, record, readFailed)
      return !readFailed
    },

    /** Save what the current scope holds under its key, forget it, leave no scope. */
    _detach() {
      const r = runtime(this)
      const pubkey = this.scope
      if (r.timer !== null) { deps.clearTimer(r.timer); r.timer = null }
      if (pubkey && r.dirty && r.persist) {
        const snapshot = this._snapshot()
        enqueue(r, () => deps.storage.saveChatState(pubkey, snapshot)).catch(error =>
          deps.warn('[messages] could not save chat state', { reason: error?.name || 'Error' }))
      }
      r.dirty = false
      r.firstDirtyAt = null
      r.persist = true
      this.scope = null
      this.openThread = null
      Object.assign(this, emptyState())
    },

    _adopt(pubkey, record, readFailed) {
      const r = runtime(this)
      Object.assign(this, emptyState())
      if (readFailed) {
        r.persist = false
      } else if (record !== null) {
        const { raw, tooNew } = migrateState(record)
        if (tooNew) {
          r.persist = false
          deps.warn('[messages] chat record is from a newer app version, leaving it untouched')
        } else if (raw) {
          Object.assign(this, restoreState(raw, pubkey))
        } else {
          deps.warn('[messages] chat record has an unknown format, starting empty')
        }
      }
      this.scope = pubkey
      this.prune()
    },

    _snapshot() {
      // Plain JSON copy: the save runs later, from a queue, and must not see later edits.
      return JSON.parse(JSON.stringify({
        version: STATE_VERSION,
        threads: this.threads,
        blocked: this.blocked,
        blockChanges: this.blockChanges,
        syncCursor: this.syncCursor,
        outbox: this.outbox,
        inboxRelays: this.inboxRelays,
        settlements: this.settlements,
        handledWraps: this.handledWraps,
        signerAppMessages: this.signerAppMessages,
        ownPayments: this.ownPayments,
        requestGoals: this.requestGoals,
      }))
    },

    /** Debounced save: waits `saveDelayMs` of quiet, but never longer than `saveMaxWaitMs` in total. */
    _markDirty() {
      const r = runtime(this)
      if (!this.scope || !r.persist) return
      r.dirty = true
      const t = deps.nowMs()
      r.firstDirtyAt ??= t
      if (r.timer !== null) deps.clearTimer(r.timer)
      const delay = Math.max(0, Math.min(deps.saveDelayMs, r.firstDirtyAt + deps.saveMaxWaitMs - t))
      r.timer = deps.setTimer(() => { r.timer = null; this.flush() }, delay)
    },

    /** Whether changes reach storage: false without an identity, or when its record could not be read. */
    canPersist() {
      return Boolean(this.scope) && runtime(this).persist
    },

    /** Write pending changes now. Resolves true when nothing is left unsaved, false when the write failed. */
    async flush() {
      const r = runtime(this)
      if (!this.scope) return false
      if (r.timer !== null) { deps.clearTimer(r.timer); r.timer = null }
      const pubkey = this.scope
      if (pubkey && r.dirty && r.persist) {
        const snapshot = this._snapshot()
        r.dirty = false
        r.firstDirtyAt = null
        try {
          await enqueue(r, () => deps.storage.saveChatState(pubkey, snapshot))
        } catch (error) {
          deps.warn('[messages] could not save chat state', { reason: error?.name || 'Error' })
          if (this.scope === pubkey) r.dirty = true
          return false
        }
        return true
      }
      await r.chain
      return true
    },

    /** Delete an identity's stored history; clears memory when it is the active one. */
    async deleteHistory(pubkey = this.scope) {
      const key = hexKey(pubkey)
      if (!key) return
      const r = runtime(this)
      if (key === this.scope) this._forgetInMemory()
      await enqueue(r, () => deps.storage.deleteChatState(key))
    },

    /**
     * Delete every identity's stored history (erase: the seed, the other
     * accounts and the imported identities are all gone, while the device key
     * that could still read their records survives).
     */
    async deleteAllHistory() {
      const r = runtime(this)
      this._forgetInMemory()
      await enqueue(r, () => deps.storage.deleteAllChatStates())
    },

    /** Drop the scope and everything in memory, with no save pending. */
    _forgetInMemory() {
      const r = runtime(this)
      r.generation += 1
      if (r.timer !== null) { deps.clearTimer(r.timer); r.timer = null }
      r.dirty = false
      r.firstDirtyAt = null
      this.scope = null
      this.openThread = null
      Object.assign(this, emptyState())
    },

    // ----- messages --------------------------------------------------------

    /** Drop the least recently active stranger threads until a new one fits under MAX_UNKNOWN_THREADS. */
    _makeRoomForStranger() {
      const protectedPeople = new Set(Object.values(this.requestGoals).flatMap(goal => goal.shares.map(share => share.pubkey)))
      const strangers = this.unknownThreads.filter(row => !protectedPeople.has(row.partner))
      for (const row of strangers.slice(MAX_UNKNOWN_THREADS - 1)) delete this.threads[row.partner]
    },

    _threadFor(partner) {
      return (this.threads[partner] ||= emptyThread())
    },

    _insert(thread, message) {
      const { messages } = thread
      let i = messages.length
      while (i > 0 && compareMessages(messages[i - 1], message) > 0) i -= 1
      messages.splice(i, 0, message)
    },

    /**
     * Store a message that arrived from the network (or a self copy).
     * Returns true when it changed the state (a new message, or a reaction
     * that is new or newer for its sender). `live` is accepted for the inbox's
     * convenience; the unread rule is the same for live and backfilled messages.
     * @param {object} chatMessage A `ChatMessage` from `parseRumor`.
     * @param {{ live?: boolean }} [options]
     */
    ingest(chatMessage, options = {}) { // eslint-disable-line no-unused-vars
      if (!this.scope) return false
      const message = normalizeMessage(chatMessage, this.scope)
      if (!message) return false
      if (!message.outgoing && this.isBlocked(message.sender)) return false
      // Strangers can come with ever new keys: their threads are capped.
      if (!this.threads[message.partner] && !deps.isKnownContact(message.partner)) this._makeRoomForStranger()

      const thread = this._threadFor(message.partner)

      if (message.type === MESSAGE_TYPE.REACTION) {
        if (!applyReaction(thread, message)) return false
        this._markDirty()
        return true
      }

      // Already stored. Our own self copy coming back proves nothing about the
      // partner's relays; only the inbox's delivery (setDelivery) moves the state.
      if (thread.messages.some(m => m.id === message.id)) return false

      if (message.outgoing) {
        message.delivery = DELIVERY.SENT
      }
      this._insert(thread, message)

      if (!message.outgoing) {
        if (this.openThread === message.partner) {
          // On screen, so already read.
          thread.lastReadAt = Math.max(thread.lastReadAt, message.createdAt)
        } else if (message.createdAt > thread.lastReadAt) {
          thread.unread += 1
        }
      }
      this._autoPrune(thread)
      this._markDirty()
      return true
    },

    /**
     * Store a message the user just wrote, with its local delivery state.
     * Returns false for a duplicate id. A message that is not outgoing from
     * the active identity is a programming error.
     * @param {object} chatMessage
     * @param {{ delivery?: 'queued'|'sending'|'sent'|'failed' }} [options]
     */
    addOutgoing(chatMessage, { delivery = DELIVERY.QUEUED } = {}) {
      if (!this.scope) return false
      if (!DELIVERY_VALUES.has(delivery)) throw new TypeError('messages: unknown delivery state')
      const message = normalizeMessage(chatMessage, this.scope)
      if (!message || !message.outgoing) throw new TypeError('messages: addOutgoing needs an outgoing message of the active identity')

      const thread = this._threadFor(message.partner)
      if (message.type === MESSAGE_TYPE.REACTION) {
        if (!applyReaction(thread, message)) return false
        this._markDirty()
        return true
      }
      if (thread.messages.some(m => m.id === message.id)) return false
      message.delivery = delivery
      this._insert(thread, message)
      this._autoPrune(thread)
      this._markDirty()
      return true
    },

    /**
     * Move an outgoing message through queued -> sending -> sent | failed.
     * A message that is `sent` stays so (a late retry result cannot undo it).
     * Returns whether the state changed.
     */
    setDelivery(id, delivery) {
      if (!this.scope) return false
      if (!DELIVERY_VALUES.has(delivery)) throw new TypeError('messages: unknown delivery state')
      for (const thread of Object.values(this.threads)) {
        const message = thread.messages.find(m => m.id === id)
        if (!message) continue
        if (!message.outgoing || message.delivery === delivery || message.delivery === DELIVERY.SENT) return false
        message.delivery = delivery
        this._markDirty()
        return true
      }
      return false
    },

    // ----- read state, blocking, muting ------------------------------------

    /** Mark everything in the thread read. */
    markRead(partner) {
      const key = hexKey(partner)
      const thread = this.scope && key && this.threads[key]
      if (!thread) return
      const newest = thread.messages.reduce((max, m) => Math.max(max, m.createdAt), 0)
      const lastReadAt = Math.max(thread.lastReadAt, newest)
      if (thread.unread === 0 && lastReadAt === thread.lastReadAt) return
      thread.unread = 0
      thread.lastReadAt = lastReadAt
      this._markDirty()
    },

    /** Tell the store which chat is on screen (null: none). Opening a chat reads it. */
    setOpenThread(partner) {
      const key = partner === null || partner === undefined ? null : hexKey(partner)
      if (partner !== null && partner !== undefined && !key) throw new TypeError('messages: partner must be a 64-hex pubkey or null')
      this.openThread = key
      if (key) this.markRead(key)
    },

    block(pubkey) {
      const key = hexKey(pubkey)
      if (!this.scope || !key || key === this.scope || this.blocked.includes(key)) return false
      this._setBlocked(key, true)
      this._recordBlockChange('block', key)
      this._markDirty()
      return true
    },

    unblock(pubkey) {
      const key = hexKey(pubkey)
      if (!this.scope || !key || !this.blocked.includes(key)) return false
      this._setBlocked(key, false)
      this._recordBlockChange('unblock', key)
      this._markDirty()
      return true
    },

    /** The mute list saved these changes; a later change of the same key stays pending. */
    settleBlockChanges(changes) {
      if (!this.scope) return
      const saved = new Set(changes.map(change => `${change.op}:${change.pubkey}`))
      this.blockChanges = this.blockChanges.filter(change => !saved.has(`${change.op}:${change.pubkey}`))
      this._markDirty()
    },

    /**
     * The keys the mute list blocks. When the whole list could be read
     * (`complete`) it is the truth, with the changes not yet saved on top;
     * otherwise its keys only add blocks, so nothing unseen gets unblocked.
     */
    adoptBlockList(keys, { complete }) {
      if (!this.scope) return
      const next = new Set(complete ? keys : [...this.blocked, ...keys])
      for (const { op, pubkey } of this.blockChanges) {
        if (op === 'block') next.add(pubkey)
        else next.delete(pubkey)
      }
      next.delete(this.scope)
      const changed = next.size !== this.blocked.length || this.blocked.some(key => !next.has(key))
      if (!changed) return
      for (const key of next) if (!this.blocked.includes(key)) this._setBlocked(key, true)
      for (const key of [...this.blocked]) if (!next.has(key)) this._setBlocked(key, false)
      this._markDirty()
    },

    _setBlocked(key, blocked) {
      if (blocked) {
        this.blocked.push(key)
        const thread = this.threads[key]
        if (thread) thread.unread = 0
      } else {
        this.blocked.splice(this.blocked.indexOf(key), 1)
      }
    },

    /** Only the latest change per key matters: it is what the list must say. */
    _recordBlockChange(op, pubkey) {
      this.blockChanges = [...this.blockChanges.filter(change => change.pubkey !== pubkey), { op, pubkey }]
    },

    mute(partner, muted = true) {
      const key = hexKey(partner)
      if (!this.scope || !key || key === this.scope) return false
      const thread = this._threadFor(key)
      if (thread.muted === Boolean(muted)) return false
      thread.muted = Boolean(muted)
      this._markDirty()
      return true
    },

    // ----- private request goals ------------------------------------------

    addRequestGoal(raw) {
      const goal = normalizeRequestGoal(raw, this.scope)
      if (!goal) throw new TypeError('messages: invalid request goal')
      if (this.requestGoals[goal.id] || (goal.source && this.requestGoalForSource(goal.source))) return false
      this.requestGoals[goal.id] = goal
      this._markDirty()
      return true
    },

    setRequestGoalError(goalId, requestId, code) {
      const share = this.requestGoals[goalId]?.shares.find(share => share.requestId === requestId)
      if (!this.scope || !share || share.errorCode === code) return false
      share.errorCode = code
      this._markDirty()
      return true
    },

    setRequestGoalSendError(goalId, code) {
      const goal = this.requestGoals[goalId]
      if (!this.scope || !goal || goal.sendErrorCode === code) return false
      goal.sendErrorCode = code; this._markDirty()
      return true
    },

    replaceRequestGoalShare(goalId, requestId, attempt) {
      const goal = this.requestGoals[goalId]
      if (!goal || !this.scope) return false
      const next = JSON.parse(JSON.stringify(goal))
      const share = next.shares.find(share => share.requestId === requestId)
      if (!share) return false
      share.previousRequests = [...(share.previousRequests || []), { requestId, template: share.template }]
      share.requestId = attempt.requestId; share.template = attempt.template; share.errorCode = null
      const normalized = normalizeRequestGoal(next, this.scope)
      if (!normalized) throw new TypeError('messages: invalid replacement request')
      this.requestGoals[goalId] = normalized; this._markDirty()
      return true
    },

    _retainedGoalRequests() {
      return new Set(Object.values(this.requestGoals).flatMap(goal => goal.shares.flatMap(requestIdsOf)))
    },

    // ----- sync, outbox, relay cache ---------------------------------------

    /** Remember how far the inbox has synced (unix seconds). Only moves forward; `null` clears it. */
    setSyncCursor(seconds) {
      if (!this.scope) return false
      if (seconds === null) {
        if (this.syncCursor === null) return false
        this.syncCursor = null
      } else {
        if (!isCount(seconds)) throw new TypeError('messages: sync cursor must be whole unix seconds or null')
        if (this.syncCursor !== null && seconds <= this.syncCursor) return false
        this.syncCursor = seconds
      }
      this._markDirty()
      return true
    },

    /** The user's own payment for a partner's request, or null. */
    ownPayment(requestId) {
      return (this.scope && this.ownPayments[requestId]) || null
    },

    /**
     * Record (or update) the user's own payment for a partner's request: the
     * wallet sent it (`sent`) or it is still routing (`pending`). `announced`
     * says whether the partner was told.
     */
    setOwnPayment(requestId, record) {
      if (!this.scope || !hexKey(requestId) || !OWN_PAYMENT_STATUSES.has(record?.status)) return false
      this.ownPayments[requestId] = { ...this.ownPayments[requestId], ...JSON.parse(JSON.stringify(record)) }
      this._markDirty()
      return true
    },

    /** Forget an own payment that failed: the request can be paid again. */
    clearOwnPayment(requestId) {
      if (!this.scope || !(requestId in this.ownPayments)) return false
      delete this.ownPayments[requestId]
      this._markDirty()
      return true
    },

    /** The person turned messages on for this identity's signer app. */
    turnOnSignerAppMessages() {
      if (!this.scope || this.signerAppMessages) return false
      this.signerAppMessages = true
      this._markDirty()
      return true
    },

    /** Why received messages wait for the signer app (a DmError code), or null. */
    setSignerHold(code) {
      if (!this.scope) return
      this.signerHold = typeof code === 'string' ? code : null
    },

    /** Whether the gift wrap `wrapId` was already opened and dealt with. */
    hasHandledWrap(wrapId) {
      return Boolean(this.scope && hexKey(wrapId) && this.handledWraps[wrapId] !== undefined)
    },

    /** Remember a gift wrap as dealt with (`createdAt`: the wrap's own unix seconds). */
    rememberHandledWrap(wrapId, createdAt) {
      if (!this.scope || !hexKey(wrapId) || !isCount(createdAt) || this.handledWraps[wrapId] !== undefined) return false
      this.handledWraps[wrapId] = createdAt
      this._markDirty()
      return true
    },

    /**
     * Queue something to (re)send. `item` is JSON data the inbox understands
     * (typically the sealed wraps per relay); the store only needs `id` (the
     * rumor id) and `partner`. Enqueuing an id again replaces the item in place.
     */
    enqueueOutbox(item) {
      if (!this.scope) return false
      const id = isPlainObject(item) ? hexKey(item.id) : null
      const partner = isPlainObject(item) ? hexKey(item.partner) : null
      if (!id || !partner) throw new TypeError('messages: outbox item needs a 64-hex id and partner')
      const stored = { ...JSON.parse(JSON.stringify(item)), id, partner }
      const i = this.outbox.findIndex(entry => entry.id === id)
      if (i === -1) this.outbox.push(stored)
      else this.outbox.splice(i, 1, stored)
      this._markDirty()
      return true
    },

    dequeueOutbox(id) {
      const i = this.scope ? this.outbox.findIndex(entry => entry.id === id) : -1
      if (i === -1) return false
      this.outbox.splice(i, 1)
      this._markDirty()
      return true
    },

    /** Keep the inbox relay resolver's `snapshot()` (persisted; the resolver re-validates it in `hydrate`). */
    setInboxRelaySnapshot(snapshot) {
      if (!this.scope) return false
      if (snapshot !== null && !isPlainObject(snapshot)) throw new TypeError('messages: snapshot must be an object or null')
      this.inboxRelays = snapshot === null ? null : JSON.parse(JSON.stringify(snapshot))
      this._markDirty()
      return true
    },

    /**
     * Remember that one of the user's own requests was paid, as the user's own
     * wallet confirmed (which wallet, when). Records of requests that no
     * longer exist are dropped by `prune`.
     * @param {string} requestId Rumor id of the request.
     * @param {{ walletId?: string | null, address?: string, paymentHash?: string, paidAt: number }} settlement
     *   `walletId`: a wallet of the user showed the money. `address`: the user's Lightning address
     *   confirmed it by LUD-21 (no wallet). `paymentHash` keeps one payment from settling two requests.
     */
    setSettlement(requestId, settlement) {
      const id = hexKey(requestId)
      if (!this.scope || !id) return false
      if (!isPlainObject(settlement)) throw new TypeError('messages: settlement must be an object')
      this.settlements[id] = JSON.parse(JSON.stringify(settlement))
      this._markDirty()
      return true
    },

    // ----- pruning ---------------------------------------------------------

    _autoPrune(thread) {
      if (thread.messages.length > MAX_MESSAGES_PER_THREAD + PRUNE_SLACK) {
        pruneThread(thread, deps.now(), MAX_MESSAGES_PER_THREAD, this._retainedGoalRequests())
        thread.unread = Math.min(thread.unread, thread.messages.length)
      }
    },

    /** Trim every thread to the last `MAX_MESSAGES_PER_THREAD` messages; pending requests are always kept. */
    prune() {
      if (!this.scope) return 0
      const now = deps.now()
      const retained = this._retainedGoalRequests()
      let dropped = 0
      for (const thread of Object.values(this.threads)) {
        const n = pruneThread(thread, now, MAX_MESSAGES_PER_THREAD, retained)
        if (n > 0) thread.unread = Math.min(thread.unread, thread.messages.length)
        dropped += n
      }
      // A settlement without its request (pruned, or never stored) is dead weight.
      const requestIds = new Set()
      for (const thread of Object.values(this.threads)) {
        for (const m of thread.messages) if (m.type === MESSAGE_TYPE.REQUEST) requestIds.add(m.id)
      }
      let orphans = 0
      for (const id of Object.keys(this.settlements)) {
        if (!requestIds.has(id)) { delete this.settlements[id]; orphans += 1 }
      }
      const forgotten = this._pruneHandledWraps()
      if (dropped > 0 || orphans > 0 || forgotten > 0) this._markDirty()
      return dropped
    },

    /**
     * Forget handled wraps the inbox can no longer fetch: older than its
     * window (sync cursor minus the two-day slack, plus a day of margin), and
     * beyond MAX_HANDLED_WRAPS the oldest.
     */
    _pruneHandledWraps() {
      const entries = Object.entries(this.handledWraps)
      const floor = this.syncCursor === null ? 0 : this.syncCursor - SINCE_SLACK_SECONDS - 24 * 60 * 60
      let keep = entries.filter(([, createdAt]) => createdAt >= floor)
      if (keep.length > MAX_HANDLED_WRAPS) {
        keep = keep.sort((a, b) => b[1] - a[1]).slice(0, MAX_HANDLED_WRAPS)
      }
      if (keep.length === entries.length) return 0
      this.handledWraps = Object.fromEntries(keep)
      return entries.length - keep.length
    },
  },
})
