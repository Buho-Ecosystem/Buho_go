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
 * Shape (also the persisted format, `STATE_VERSION` 1):
 *   threads[partner] = { messages, reactions, unread, lastReadAt, muted }
 *     messages   ChatMessage[] sorted by (createdAt, id), deduped by rumor id,
 *                never containing reactions; outgoing ones carry `delivery`
 *     reactions  { [targetId]: { [senderPubkey]: { emoji, createdAt, id } } }
 *   blocked      pubkeys whose messages are dropped
 *   syncCursor   unix seconds of the last completed inbox sync, or null
 *   outbox       items waiting to be (re)sent, see `enqueueOutbox`
 *   inboxRelays  the inbox relay resolver's `snapshot()`, or null
 *   settlements  own requests whose payment a wallet of the user confirmed, by request id (see `setSettlement`)
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
import { SINCE_SLACK_SECONDS } from '../services/dm/constants.js'
import { MESSAGE_TYPE, REQUEST_STATUS } from '../services/dm/protocol.js'
import { loadChatState, saveChatState, deleteChatState } from '../utils/dmStorage.js'
import { useAddressBookStore } from './addressBook.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1

/** Wrap ids remembered as handled at most (the oldest go first). */
export const MAX_HANDLED_WRAPS = 5000

/** Messages kept per thread by `prune` (pending requests are kept on top). */
export const MAX_MESSAGES_PER_THREAD = 500

/** A thread is pruned on ingest once it exceeds the cap by this much (amortises the work). */
const PRUNE_SLACK = 100

/** Quiet time before a change is written, and the longest a steady stream may delay a write. */
export const SAVE_DEBOUNCE_MS = 400
export const SAVE_MAX_WAIT_MS = 5000

/** Local send state of an outgoing message. */
export const DELIVERY = Object.freeze({
  QUEUED: 'queued',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
})
const DELIVERY_VALUES = new Set(Object.values(DELIVERY))

/** Derived state of a payment request. */
export const REQUEST_STATE = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
})

const MESSAGE_TYPES = new Set(Object.values(MESSAGE_TYPE))
const HEX_64 = /^[0-9a-f]{64}$/

// ---------------------------------------------------------------------------
// Collaborators (replaceable for tests and wiring)
// ---------------------------------------------------------------------------

const defaultDeps = () => ({
  storage: { loadChatState, saveChatState, deleteChatState },
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
    threads: {}, blocked: [], syncCursor: null, outbox: [], inboxRelays: null, settlements: {}, handledWraps: {},
    signerAppMessages: false,
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
 * @param {object[]} messages Sorted thread messages.
 * @param {number} now Unix seconds.
 * @returns {Map<string, string>} request id -> REQUEST_STATE
 */
export function deriveRequestStates(messages, now) {
  const requests = new Map()
  for (const m of messages) {
    if (m.type === MESSAGE_TYPE.REQUEST) requests.set(m.id, m)
  }
  const states = new Map()
  for (const id of requests.keys()) states.set(id, REQUEST_STATE.PENDING)

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
    if (states.get(id) === REQUEST_STATE.PENDING && request.request.validUntil < now) {
      states.set(id, REQUEST_STATE.EXPIRED)
    }
  }
  return states
}

/**
 * Keep the last `max` messages of a thread plus every still-pending request
 * and the status messages that belong to a kept request (so a kept request
 * never loses the answer that settles it). Reactions on dropped messages go too.
 * @returns {number} How many messages were dropped.
 */
function pruneThread(thread, now, max) {
  const { messages } = thread
  if (messages.length <= max) return 0

  const keep = new Set(messages.slice(messages.length - max).map(m => m.id))
  const states = deriveRequestStates(messages, now)
  for (const m of messages) {
    if (m.type === MESSAGE_TYPE.REQUEST && states.get(m.id) === REQUEST_STATE.PENDING) keep.add(m.id)
  }
  for (const m of messages) {
    if (m.type === MESSAGE_TYPE.STATUS && keep.has(m.status.requestId)) keep.add(m.id)
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

/** `MIGRATIONS[n]` upgrades a version-n record to n + 1. Empty until a format change needs one. */
const MIGRATIONS = {}

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
  state.syncCursor = isCount(raw.syncCursor) ? raw.syncCursor : null
  state.inboxRelays = isPlainObject(raw.inboxRelays) ? raw.inboxRelays : null
  if (isPlainObject(raw.settlements)) {
    for (const [requestId, settlement] of Object.entries(raw.settlements)) {
      if (hexKey(requestId) && isPlainObject(settlement)) state.settlements[requestId] = { ...settlement }
    }
  }
  state.signerAppMessages = raw.signerAppMessages === true
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
  let r = runtimes.get(store)
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
    runtimes.set(store, r)
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

    /** Unread messages for the app badge. Muted chats are left out; `unreadFor` still counts them. */
    totalUnread: state => Object.values(state.threads).reduce((sum, t) => sum + (t.muted ? 0 : t.unread), 0),

    unreadFor: state => (partner) => state.threads[hexKey(partner)]?.unread ?? 0,

    /** `settlement(id)` -> `{ walletId?, address?, paymentHash?, paidAt }` once a wallet of the user confirmed the payment of an own request, or null. */
    settlement: state => requestId => state.settlements[requestId] ?? null,

    isBlocked: state => pubkey => state.blocked.includes(hexKey(pubkey)),

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
     * `requestStatus(id, now)` -> 'pending' | 'paid' | 'declined' | 'cancelled' | 'expired',
     * or null for an unknown request. `now` is unix seconds and defaults to the clock.
     */
    requestStatus: state => (requestId, now = deps.now()) => {
      for (const thread of Object.values(state.threads)) {
        if (thread.messages.some(m => m.type === MESSAGE_TYPE.REQUEST && m.id === requestId)) {
          return deriveRequestStates(thread.messages, now).get(requestId) ?? null
        }
      }
      return null
    },

    /** Requests the partner sent that can still be paid, oldest first. */
    pendingRequestsFrom: state => (partner, now = deps.now()) => {
      const thread = state.threads[hexKey(partner)]
      if (!thread) return []
      const states = deriveRequestStates(thread.messages, now)
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
        syncCursor: this.syncCursor,
        outbox: this.outbox,
        inboxRelays: this.inboxRelays,
        settlements: this.settlements,
        handledWraps: this.handledWraps,
        signerAppMessages: this.signerAppMessages,
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

    /** Write pending changes now. Resolves true when nothing is left unsaved, false when the write failed. */
    async flush() {
      const r = runtime(this)
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

    /** Delete an identity's stored history (identity reset); clears memory when it is the active one. */
    async deleteHistory(pubkey = this.scope) {
      const key = hexKey(pubkey)
      if (!key) return
      const r = runtime(this)
      if (key === this.scope) {
        r.generation += 1
        if (r.timer !== null) { deps.clearTimer(r.timer); r.timer = null }
        r.dirty = false
        r.firstDirtyAt = null
        this.scope = null
        this.openThread = null
        Object.assign(this, emptyState())
      }
      await enqueue(r, () => deps.storage.deleteChatState(key))
    },

    // ----- messages --------------------------------------------------------

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

      const thread = this._threadFor(message.partner)

      if (message.type === MESSAGE_TYPE.REACTION) {
        if (!applyReaction(thread, message)) return false
        this._markDirty()
        return true
      }

      const existing = thread.messages.find(m => m.id === message.id)
      if (existing) {
        // Our own message coming back from a relay proves it was delivered.
        if (existing.outgoing && existing.delivery !== DELIVERY.SENT) {
          existing.delivery = DELIVERY.SENT
          this._markDirty()
        }
        return false
      }

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
      this.blocked.push(key)
      const thread = this.threads[key]
      if (thread) thread.unread = 0
      this._markDirty()
      return true
    },

    unblock(pubkey) {
      const key = hexKey(pubkey)
      const i = this.scope && key ? this.blocked.indexOf(key) : -1
      if (i === -1) return false
      this.blocked.splice(i, 1)
      this._markDirty()
      return true
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
        pruneThread(thread, deps.now(), MAX_MESSAGES_PER_THREAD)
        thread.unread = Math.min(thread.unread, thread.messages.length)
      }
    },

    /** Trim every thread to the last `MAX_MESSAGES_PER_THREAD` messages; pending requests are always kept. */
    prune() {
      if (!this.scope) return 0
      const now = deps.now()
      let dropped = 0
      for (const thread of Object.values(this.threads)) {
        const n = pruneThread(thread, now, MAX_MESSAGES_PER_THREAD)
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
