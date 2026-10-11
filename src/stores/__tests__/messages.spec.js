/**
 * messages store: scoping, ordering, unread, reactions, request status,
 * outbox, pruning and persistence.
 *
 * Run directly with Node:
 *   node --test src/stores/__tests__/messages.spec.js
 */

import { test, beforeEach } from 'node:test'
import { strict as assert } from 'node:assert'

class MemoryStorage {
  constructor() { this._data = new Map() }
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null }
  setItem(key, value) { this._data.set(key, String(value)) }
  removeItem(key) { this._data.delete(key) }
}
globalThis.localStorage = new MemoryStorage()

const { createPinia, setActivePinia } = await import('pinia')
const { createDmStorage, createMemoryBackend } = await import('../../utils/dmStorage.js')
const {
  useMessagesStore, configureMessages, resetMessagesConfig,
  DELIVERY, REQUEST_STATE, MAX_MESSAGES_PER_THREAD, MAX_UNKNOWN_THREADS, SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS, STATE_VERSION,
} = await import('../messages.js')

const hex = ch => ch.repeat(64)
const ME = hex('1')
const OTHER_ME = hex('2')
const ALICE = hex('a')
const BOB = hex('b')
const rid = n => n.toString(16).padStart(64, '0')

let idCounter = 0
const nextId = () => rid(++idCounter + 1000)

function msg(partner, overrides = {}) {
  const outgoing = overrides.outgoing ?? false
  return {
    id: nextId(), kind: 14, type: 'text',
    sender: outgoing ? (overrides.me ?? ME) : partner, recipient: outgoing ? partner : (overrides.me ?? ME),
    partner, outgoing, createdAt: 1000, text: 'hi', replyTo: null,
    request: null, status: null, payment: null, reaction: null, degraded: false,
    ...overrides,
  }
}

const requestMsg = (partner, o = {}) => msg(partner, {
  type: 'request', text: 'request',
  request: { amountSats: 1000, note: null, lud16: 'bob@x.org', validUntil: 5000 },
  ...o,
})
const statusMsg = (partner, requestId, value, o = {}) => msg(partner, {
  type: 'status', text: value, replyTo: requestId, status: { requestId, value, preimage: null }, ...o,
})
const reactionMsg = (partner, targetId, emoji, o = {}) => msg(partner, {
  kind: 7, type: 'reaction', text: emoji, reaction: { targetId, emoji }, ...o,
})

/** A manual clock and timer queue. */
function fakeTimers() {
  const t = { ms: 0, timers: new Map(), seq: 0 }
  t.setTimer = (fn, delay) => { t.timers.set(++t.seq, { fn, at: t.ms + delay }); return t.seq }
  t.clearTimer = (h) => { t.timers.delete(h) }
  t.advance = (ms) => {
    t.ms += ms
    for (const [h, timer] of [...t.timers]) {
      if (timer.at <= t.ms) { t.timers.delete(h); timer.fn() }
    }
  }
  return t
}

let backend, storage, clock, warnings, nowSeconds

function freshStore() {
  setActivePinia(createPinia())
  return useMessagesStore()
}

beforeEach(() => {
  backend = createMemoryBackend()
  warnings = []
  storage = createDmStorage({
    backend,
    cipher: { encrypt: async s => `e:${s}`, decrypt: async s => s.slice(2) },
    warn: () => {},
  })
  clock = fakeTimers()
  nowSeconds = 2000
  resetMessagesConfig()
  configureMessages({
    storage,
    now: () => nowSeconds,
    nowMs: () => clock.ms,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    isKnownContact: pk => pk === ALICE,
    warn: (m, d) => warnings.push([m, d]),
  })
})

async function scoped(pubkey = ME) {
  const store = freshStore()
  await store.setScope(pubkey)
  return store
}

// ---------------------------------------------------------------------------

test('without a scope nothing is stored or saved', async () => {
  const store = freshStore()
  assert.equal(store.ingest(msg(ALICE)), false)
  assert.equal(store.addOutgoing(msg(ALICE, { outgoing: true })), false)
  assert.equal(store.block(BOB), false)
  clock.advance(10_000)
  assert.deepEqual(await backend.keys(), [])
})

test('setScope loads that identity and never mixes', async () => {
  const store = await scoped(ME)
  store.ingest(msg(ALICE, { text: 'for me' }))
  await store.setScope(OTHER_ME)
  assert.equal(store.thread(ALICE).messages.length, 0)
  assert.equal(store.totalUnread, 0)
  store.ingest(msg(BOB, { me: OTHER_ME }))
  await store.setScope(ME)
  assert.equal(store.thread(ALICE).messages.length, 1)
  assert.equal(store.thread(BOB).messages.length, 0)
  assert.equal(store.thread(ALICE).messages[0].text, 'for me')
})

test('switching saves the old identity under its own key', async () => {
  const store = await scoped(ME)
  store.ingest(msg(ALICE))
  await store.setScope(OTHER_ME)
  assert.deepEqual(await backend.keys(), [`chat:${ME}`])
  assert.equal((await storage.loadChatState(ME)).threads[ALICE].messages.length, 1)
  assert.equal(await storage.loadChatState(OTHER_ME), null)
})

test('setScope(null) clears memory and later writes go nowhere', async () => {
  const store = await scoped()
  store.ingest(msg(ALICE))
  await store.setScope(null)
  assert.equal(store.scope, null)
  assert.equal(store.threadsSorted.length, 0)
  assert.equal(store.ingest(msg(ALICE)), false)
  clock.advance(10_000)
  assert.equal((await storage.loadChatState(ME)).threads[ALICE].messages.length, 1)
})

test('a superseded setScope does not clobber the newer one', async () => {
  await storage.saveChatState(ME, { version: STATE_VERSION, threads: {}, blocked: [BOB] })
  const store = freshStore()
  const slow = store.setScope(ME)
  const fast = store.setScope(OTHER_ME)
  assert.equal(await slow, false)
  assert.equal(await fast, true)
  assert.equal(store.scope, OTHER_ME)
  assert.deepEqual(store.blocked, [])
})

test('invalid scope throws', async () => {
  const store = freshStore()
  await assert.rejects(() => store.setScope('nope'), TypeError)
})

test('ingest dedupes by id and reports newness', async () => {
  const store = await scoped()
  const m = msg(ALICE)
  assert.equal(store.ingest(m), true)
  assert.equal(store.ingest({ ...m }), false)
  assert.equal(store.thread(ALICE).messages.length, 1)
})

test('messages sort by createdAt then id regardless of arrival order', async () => {
  const store = await scoped()
  store.ingest(msg(ALICE, { id: rid(5), createdAt: 30 }))
  store.ingest(msg(ALICE, { id: rid(9), createdAt: 20 }))
  store.ingest(msg(ALICE, { id: rid(3), createdAt: 20 }))
  store.ingest(msg(ALICE, { id: rid(1), createdAt: 10 }))
  assert.deepEqual(store.thread(ALICE).messages.map(m => m.id), [rid(1), rid(3), rid(9), rid(5)])
})

test('malformed or inconsistent messages are rejected', async () => {
  const store = await scoped()
  assert.equal(store.ingest(null), false)
  assert.equal(store.ingest(msg(ALICE, { id: 'short' })), false)
  assert.equal(store.ingest(msg(ALICE, { type: 'weird' })), false)
  assert.equal(store.ingest(msg(ALICE, { sender: BOB })), false) // sender is not the partner
  assert.equal(store.ingest(msg(ALICE, { outgoing: true, sender: ALICE })), false)
  assert.equal(store.ingest(msg(ME)), false) // a thread with myself
  assert.equal(store.ingest(statusMsg(ALICE, 'bad', 'paid')), false)
  assert.equal(store.threadsSorted.length, 0)
})

test('thread() is an empty view for unknown partners', async () => {
  const store = await scoped()
  assert.deepEqual(store.thread(ALICE), { partner: ALICE, messages: [], unread: 0, lastReadAt: 0, muted: false })
})

// ----- unread --------------------------------------------------------------

test('incoming messages count as unread, outgoing and reactions do not', async () => {
  const store = await scoped()
  const first = msg(ALICE)
  store.ingest(first)
  store.ingest(msg(ALICE, { outgoing: true, createdAt: 1001 }))
  store.ingest(reactionMsg(ALICE, first.id, '👍', { createdAt: 1002 }))
  assert.equal(store.unreadFor(ALICE), 1)
  assert.equal(store.totalUnread, 1)
})

test('request, status and payment messages are unread too', async () => {
  const store = await scoped()
  store.ingest(requestMsg(ALICE, { createdAt: 1001 }))
  store.ingest(msg(ALICE, { type: 'payment', payment: { amountSats: 1, note: null, preimage: null, requestId: null }, createdAt: 1002 }))
  assert.equal(store.unreadFor(ALICE), 2)
})

test('markRead clears unread and old arrivals stay read', async () => {
  const store = await scoped()
  store.ingest(msg(ALICE, { createdAt: 1000 }))
  store.ingest(msg(ALICE, { createdAt: 1010 }))
  store.markRead(ALICE)
  assert.equal(store.unreadFor(ALICE), 0)
  assert.equal(store.thread(ALICE).lastReadAt, 1010)
  store.ingest(msg(ALICE, { createdAt: 1005 })) // backfilled, older than the read mark
  assert.equal(store.unreadFor(ALICE), 0)
  store.ingest(msg(ALICE, { createdAt: 1011 }))
  assert.equal(store.unreadFor(ALICE), 1)
})

test('an open thread does not accumulate unread; opening reads it', async () => {
  const store = await scoped()
  store.ingest(msg(ALICE, { createdAt: 1000 }))
  assert.equal(store.unreadFor(ALICE), 1)
  store.setOpenThread(ALICE)
  assert.equal(store.unreadFor(ALICE), 0)
  store.ingest(msg(ALICE, { createdAt: 1050 }))
  assert.equal(store.unreadFor(ALICE), 0)
  store.setOpenThread(null)
  store.ingest(msg(ALICE, { createdAt: 1049 })) // not newer than what was seen
  assert.equal(store.unreadFor(ALICE), 0)
  store.ingest(msg(ALICE, { createdAt: 1060 }))
  assert.equal(store.unreadFor(ALICE), 1)
})

test('muted threads count for the chat but not the app badge', async () => {
  const store = await scoped()
  store.ingest(msg(ALICE))
  store.ingest(msg(BOB))
  assert.equal(store.mute(ALICE, true), true)
  assert.equal(store.unreadFor(ALICE), 1)
  assert.equal(store.totalUnread, 1)
  assert.equal(store.mute(ALICE, true), false)
  store.mute(ALICE, false)
  assert.equal(store.totalUnread, 2)
})

// ----- delivery ------------------------------------------------------------

test('addOutgoing stores delivery state and sent is final', async () => {
  const store = await scoped()
  const m = msg(ALICE, { outgoing: true })
  assert.equal(store.addOutgoing(m), true)
  assert.equal(store.addOutgoing(m), false)
  assert.equal(store.thread(ALICE).messages[0].delivery, DELIVERY.QUEUED)
  assert.equal(store.unreadFor(ALICE), 0)
  assert.equal(store.setDelivery(m.id, DELIVERY.SENDING), true)
  assert.equal(store.setDelivery(m.id, DELIVERY.SENDING), false)
  assert.equal(store.setDelivery(m.id, DELIVERY.SENT), true)
  assert.equal(store.setDelivery(m.id, DELIVERY.FAILED), false)
  assert.equal(store.thread(ALICE).messages[0].delivery, DELIVERY.SENT)
  assert.equal(store.setDelivery(rid(77), DELIVERY.SENT), false)
})

test('addOutgoing honours the delivery option and rejects bad input', async () => {
  const store = await scoped()
  const m = msg(ALICE, { outgoing: true })
  store.addOutgoing(m, { delivery: DELIVERY.SENDING })
  assert.equal(store.thread(ALICE).messages[0].delivery, DELIVERY.SENDING)
  assert.throws(() => store.addOutgoing(msg(ALICE)), TypeError)
  assert.throws(() => store.addOutgoing(msg(ALICE, { outgoing: true }), { delivery: 'maybe' }), TypeError)
  assert.throws(() => store.setDelivery(m.id, 'maybe'), TypeError)
})

test('the self copy coming back changes nothing: only the partner relay accepting it makes it sent', async () => {
  const store = await scoped()
  const m = msg(ALICE, { outgoing: true })
  store.addOutgoing(m, { delivery: DELIVERY.FAILED })
  assert.equal(store.ingest({ ...m }), false)
  assert.equal(store.thread(ALICE).messages[0].delivery, DELIVERY.FAILED)
})

test('an outgoing message from another device arrives as sent', async () => {
  const store = await scoped()
  store.ingest(msg(ALICE, { outgoing: true }))
  assert.equal(store.thread(ALICE).messages[0].delivery, DELIVERY.SENT)
  assert.equal(store.unreadFor(ALICE), 0)
})

// ----- reactions -----------------------------------------------------------

test('reactions are aggregated on the target and never become bubbles', async () => {
  const store = await scoped()
  const target = msg(ALICE, { createdAt: 1000 })
  store.ingest(target)
  assert.equal(store.ingest(reactionMsg(ALICE, target.id, '👍', { createdAt: 1001 })), true)
  assert.equal(store.ingest(reactionMsg(ALICE, target.id, '❤️', { createdAt: 1002, outgoing: true })), true)
  assert.equal(store.thread(ALICE).messages.length, 1)
  assert.deepEqual(
    store.reactionsFor(ALICE, target.id).map(r => [r.emoji, r.count, r.mine]).sort(),
    [['❤️', 1, true], ['👍', 1, false]].sort(),
  )
})

test('the latest reaction per sender wins; stale and duplicate ones are ignored', async () => {
  const store = await scoped()
  const target = msg(ALICE)
  store.ingest(target)
  const first = reactionMsg(ALICE, target.id, '👍', { createdAt: 1001 })
  const second = reactionMsg(ALICE, target.id, '😂', { createdAt: 1005 })
  assert.equal(store.ingest(second), true)
  assert.equal(store.ingest(first), false) // older
  assert.equal(store.ingest({ ...second }), false) // duplicate
  assert.deepEqual(store.reactionsFor(ALICE, target.id).map(r => r.emoji), ['😂'])
})

test('reactions count per emoji, most used first', async () => {
  const store = await scoped()
  const target = msg(ALICE)
  store.ingest(target)
  store.ingest(reactionMsg(ALICE, target.id, '👍', { createdAt: 1001 }))
  store.ingest(reactionMsg(ALICE, target.id, '👍', { createdAt: 1002, outgoing: true }))
  const groups = store.reactionsFor(ALICE, target.id)
  assert.equal(groups[0].emoji, '👍')
  assert.equal(groups[0].count, 2)
  assert.equal(groups[0].mine, true)
})

test('a reaction may arrive before its target', async () => {
  const store = await scoped()
  const target = msg(ALICE)
  store.ingest(reactionMsg(ALICE, target.id, '👍', { createdAt: 1001 }))
  assert.equal(store.threadsSorted.length, 0)
  store.ingest(target)
  assert.equal(store.reactionsFor(ALICE, target.id).length, 1)
})

// ----- requests ------------------------------------------------------------

const IN = (o = {}) => requestMsg(ALICE, { createdAt: 1000, ...o }) // alice asks me
const OUT = (o = {}) => requestMsg(ALICE, { outgoing: true, createdAt: 1000, ...o }) // I ask alice

test('a request is pending, then expires with its valid_until', async () => {
  const store = await scoped()
  const req = IN()
  store.ingest(req)
  assert.equal(store.requestStatus(req.id, 4999), REQUEST_STATE.PENDING)
  assert.equal(store.requestStatus(req.id, 5000), REQUEST_STATE.PENDING)
  assert.equal(store.requestStatus(req.id, 5001), REQUEST_STATE.EXPIRED)
  assert.equal(store.requestStatus(rid(1)), null)
})

test('requestStatus defaults to the injected clock', async () => {
  const store = await scoped()
  const req = IN()
  store.ingest(req)
  assert.equal(store.requestStatus(req.id), REQUEST_STATE.PENDING)
  nowSeconds = 9999
  assert.equal(store.requestStatus(req.id), REQUEST_STATE.EXPIRED)
})

test('paid and declined count from the payer (request recipient) only', async () => {
  const store = await scoped()
  const req = OUT() // I am the requester, alice the payer
  store.ingest(req)
  // Wrong party: me (the requester) claiming "paid" or "declined".
  store.ingest(statusMsg(ALICE, req.id, 'paid', { outgoing: true, createdAt: 1010 }))
  store.ingest(statusMsg(ALICE, req.id, 'declined', { outgoing: true, createdAt: 1011 }))
  assert.equal(store.requestStatus(req.id, 1500), REQUEST_STATE.PENDING)
  store.ingest(statusMsg(ALICE, req.id, 'declined', { createdAt: 1020 }))
  assert.equal(store.requestStatus(req.id, 1500), REQUEST_STATE.DECLINED)
  store.ingest(statusMsg(ALICE, req.id, 'paid', { createdAt: 1030 }))
  assert.equal(store.requestStatus(req.id, 1500), REQUEST_STATE.PAID)
})

test('cancelled counts from the requester only', async () => {
  const store = await scoped()
  const req = IN() // alice is the requester
  store.ingest(req)
  store.ingest(statusMsg(ALICE, req.id, 'cancelled', { outgoing: true, createdAt: 1010 })) // payer cannot cancel
  assert.equal(store.requestStatus(req.id, 1500), REQUEST_STATE.PENDING)
  store.ingest(statusMsg(ALICE, req.id, 'cancelled', { createdAt: 1020 }))
  assert.equal(store.requestStatus(req.id, 1500), REQUEST_STATE.CANCELLED)
})

test('reminders never change a status and only the requester sends them', async () => {
  const store = await scoped()
  const req = IN()
  store.ingest(req)
  store.ingest(statusMsg(ALICE, req.id, 'reminder', { createdAt: 1010 }))
  assert.equal(store.requestStatus(req.id, 1500), REQUEST_STATE.PENDING)
})

test('the latest valid status wins and paid is final', async () => {
  const store = await scoped()
  const req = OUT()
  store.ingest(req)
  store.ingest(statusMsg(ALICE, req.id, 'declined', { createdAt: 1010 }))
  store.ingest(statusMsg(ALICE, req.id, 'cancelled', { outgoing: true, createdAt: 1020 }))
  assert.equal(store.requestStatus(req.id, 1500), REQUEST_STATE.CANCELLED)
  store.ingest(statusMsg(ALICE, req.id, 'paid', { createdAt: 1030 }))
  store.ingest(statusMsg(ALICE, req.id, 'declined', { createdAt: 1040 }))
  store.ingest(statusMsg(ALICE, req.id, 'cancelled', { outgoing: true, createdAt: 1050 }))
  assert.equal(store.requestStatus(req.id, 1500), REQUEST_STATE.PAID)
  assert.equal(store.requestStatus(req.id, 999999), REQUEST_STATE.PAID) // never expires once paid
})

test('a status that arrives before its request still applies', async () => {
  const store = await scoped()
  const req = OUT()
  store.ingest(statusMsg(ALICE, req.id, 'paid', { createdAt: 1010 }))
  store.ingest(req)
  assert.equal(store.requestStatus(req.id, 1500), REQUEST_STATE.PAID)
})

test('declined or cancelled requests stay so after the request expires', async () => {
  const store = await scoped()
  const req = IN()
  store.ingest(req)
  store.ingest(statusMsg(ALICE, req.id, 'cancelled', { createdAt: 1010 }))
  assert.equal(store.requestStatus(req.id, 99999), REQUEST_STATE.CANCELLED)
})

test('a status for a request in another thread does not apply', async () => {
  const store = await scoped()
  const req = IN()
  store.ingest(req)
  store.ingest(statusMsg(BOB, req.id, 'paid', { createdAt: 1010 }))
  assert.equal(store.requestStatus(req.id, 1500), REQUEST_STATE.PENDING)
})

test('a request ends with its valid_until; paid wins over expired', async () => {
  const store = await scoped()
  const base = { amountSats: 1000, note: null, lud16: 'bob@x.org' }
  const open = IN({ createdAt: 1000, request: { ...base, validUntil: 9000 } })
  const late = IN({ createdAt: 1003, request: { ...base, validUntil: 3000 } })
  for (const m of [open, late]) store.ingest(m)
  assert.equal(store.requestStatus(open.id, 9000), REQUEST_STATE.PENDING)
  assert.equal(store.requestStatus(open.id, 9001), REQUEST_STATE.EXPIRED)
  // a payment after the lifetime still turns it paid; declined stays declined
  assert.equal(store.requestStatus(late.id, 4000), REQUEST_STATE.EXPIRED)
  store.ingest(statusMsg(ALICE, late.id, 'paid', { outgoing: true, createdAt: 3500 }))
  assert.equal(store.requestStatus(late.id, 4000), REQUEST_STATE.PAID)
  store.ingest(statusMsg(ALICE, open.id, 'declined', { outgoing: true, createdAt: 1500 }))
  assert.equal(store.requestStatus(open.id, 9999), REQUEST_STATE.DECLINED)
})

test('pendingRequestsFrom lists only open incoming requests', async () => {
  const store = await scoped()
  const open = IN({ createdAt: 1000 })
  const paid = IN({ createdAt: 1001 })
  const expired = IN({ createdAt: 1002, request: { amountSats: 1, note: null, lud16: 'bob@x.org', validUntil: 1500 } })
  const mine = OUT({ createdAt: 1003 })
  for (const m of [open, paid, expired, mine]) store.ingest(m)
  store.ingest(statusMsg(ALICE, paid.id, 'cancelled', { createdAt: 1010 }))
  assert.deepEqual(store.pendingRequestsFrom(ALICE, 2000).map(m => m.id), [open.id])
  assert.deepEqual(store.pendingRequestsFrom(BOB, 2000), [])
})

// ----- blocking, lists -----------------------------------------------------

test('blocked senders are dropped, unblocking restores', async () => {
  const store = await scoped()
  store.ingest(msg(ALICE))
  assert.equal(store.block(ALICE), true)
  assert.equal(store.block(ALICE), false)
  assert.equal(store.isBlocked(ALICE), true)
  assert.equal(store.unreadFor(ALICE), 0)
  assert.equal(store.ingest(msg(ALICE)), false)
  assert.equal(store.thread(ALICE).messages.length, 1)
  assert.equal(store.unblock(ALICE), true)
  assert.equal(store.unblock(ALICE), false)
  assert.equal(store.ingest(msg(ALICE)), true)
  assert.equal(store.block(ME), false)
})

test('threadsSorted orders by last activity; unknown/known split uses the address book', async () => {
  const store = await scoped()
  store.ingest(msg(ALICE, { createdAt: 100 }))
  store.ingest(msg(BOB, { createdAt: 300 }))
  store.ingest(msg(ALICE, { createdAt: 200 }))
  store.mute(hex('c'), true) // empty thread: not listed
  assert.deepEqual(store.threadsSorted.map(r => r.partner), [BOB, ALICE])
  assert.deepEqual(store.unknownThreads.map(r => r.partner), [BOB])
  assert.deepEqual(store.knownThreads.map(r => r.partner), [ALICE])
  assert.equal(store.threadsSorted[1].lastActivityAt, 200)
})

// ----- sync cursor, outbox, relay snapshot --------------------------------

test('sync cursor only moves forward; null clears it', async () => {
  const store = await scoped()
  assert.equal(store.setSyncCursor(100), true)
  assert.equal(store.setSyncCursor(50), false)
  assert.equal(store.syncCursor, 100)
  assert.equal(store.setSyncCursor(null), true)
  assert.equal(store.syncCursor, null)
  assert.throws(() => store.setSyncCursor(1.5), TypeError)
})

test('outbox keeps order, replaces by id and dequeues', async () => {
  const store = await scoped()
  const a = { id: rid(1), partner: ALICE, wrapsByRelay: { 'wss://r.example': [{ id: 'w1' }] } }
  const b = { id: rid(2), partner: BOB, wrapsByRelay: {} }
  store.enqueueOutbox(a)
  store.enqueueOutbox(b)
  store.enqueueOutbox({ ...a, attempts: 2 })
  assert.deepEqual(store.outbox.map(i => i.id), [rid(1), rid(2)])
  assert.equal(store.outbox[0].attempts, 2)
  assert.equal(store.dequeueOutbox(rid(1)), true)
  assert.equal(store.dequeueOutbox(rid(1)), false)
  assert.deepEqual(store.outbox.map(i => i.id), [rid(2)])
  assert.throws(() => store.enqueueOutbox({ id: 'x', partner: ALICE }), TypeError)
})

test('outbox items are copied, not aliased', async () => {
  const store = await scoped()
  const item = { id: rid(1), partner: ALICE, data: { n: 1 } }
  store.enqueueOutbox(item)
  item.data.n = 2
  assert.equal(store.outbox[0].data.n, 1)
})

test('inbox relay snapshot is kept and persisted', async () => {
  const store = await scoped()
  const snap = { version: 1, entries: { [ALICE]: { status: 'found', relays: ['wss://r.example'], checkedAt: 5 } } }
  store.setInboxRelaySnapshot(snap)
  await store.flush()
  const again = await scoped()
  assert.deepEqual(again.inboxRelays, snap)
  assert.throws(() => store.setInboxRelaySnapshot('x'), TypeError)
})

// ----- prune ---------------------------------------------------------------

test('prune keeps the last N messages', async () => {
  const store = await scoped()
  for (let i = 0; i < MAX_MESSAGES_PER_THREAD + 20; i += 1) {
    store.ingest(msg(ALICE, { id: rid(i + 1), createdAt: 100 + i }))
  }
  assert.equal(store.thread(ALICE).messages.length, MAX_MESSAGES_PER_THREAD + 20)
  assert.equal(store.prune(), 20)
  const { messages } = store.thread(ALICE)
  assert.equal(messages.length, MAX_MESSAGES_PER_THREAD)
  assert.equal(messages[0].id, rid(21))
  assert.ok(store.unreadFor(ALICE) <= MAX_MESSAGES_PER_THREAD)
})

test('prune never drops a pending request or the status that settles a kept one', async () => {
  const store = await scoped()
  const pending = IN({ id: rid(1), createdAt: 10 })
  const old = IN({ id: rid(2), createdAt: 11 })
  const oldPaid = statusMsg(ALICE, old.id, 'paid', { id: rid(3), createdAt: 12, outgoing: true })
  store.ingest(pending)
  store.ingest(old)
  store.ingest(oldPaid)
  store.ingest(reactionMsg(ALICE, old.id, '👍', { createdAt: 13 }))
  for (let i = 0; i < MAX_MESSAGES_PER_THREAD + 5; i += 1) {
    store.ingest(msg(ALICE, { id: rid(100 + i), createdAt: 100 + i }))
  }
  store.prune()
  const ids = store.thread(ALICE).messages.map(m => m.id)
  assert.ok(ids.includes(pending.id), 'pending request kept')
  assert.ok(!ids.includes(old.id), 'settled old request dropped')
  assert.ok(!ids.includes(oldPaid.id))
  assert.equal(store.reactionsFor(ALICE, old.id).length, 0)
  assert.equal(store.requestStatus(pending.id, 1500), REQUEST_STATE.PENDING)
})

test('a long-expired unanswered request is not protected', async () => {
  const store = await scoped()
  const stale = IN({ id: rid(1), createdAt: 10, request: { amountSats: 1, note: null, lud16: 'bob@x.org', validUntil: 100 } })
  store.ingest(stale)
  for (let i = 0; i < MAX_MESSAGES_PER_THREAD; i += 1) store.ingest(msg(ALICE, { id: rid(100 + i), createdAt: 100 + i }))
  store.prune()
  assert.ok(!store.thread(ALICE).messages.some(m => m.id === stale.id))
})

test('ingest prunes by itself well past the cap', async () => {
  const store = await scoped()
  for (let i = 0; i < MAX_MESSAGES_PER_THREAD + 150; i += 1) store.ingest(msg(ALICE, { id: rid(i + 1), createdAt: 100 + i }))
  assert.ok(store.thread(ALICE).messages.length <= MAX_MESSAGES_PER_THREAD + 100)
})

// ----- persistence ---------------------------------------------------------

test('state survives a round trip through encrypted storage', async () => {
  const store = await scoped()
  const req = OUT()
  const target = msg(ALICE, { createdAt: 1001 })
  store.ingest(req)
  store.ingest(target)
  store.ingest(reactionMsg(ALICE, target.id, '👍', { createdAt: 1002 }))
  store.ingest(statusMsg(ALICE, req.id, 'paid', { createdAt: 1003 }))
  store.addOutgoing(msg(ALICE, { outgoing: true, createdAt: 1004 }), { delivery: DELIVERY.FAILED })
  store.markRead(BOB)
  store.mute(ALICE, true)
  store.block(BOB)
  store.setSyncCursor(1234)
  store.enqueueOutbox({ id: rid(9), partner: ALICE, wraps: [] })
  assert.equal(await store.flush(), true)

  const record = await storage.loadChatState(ME)
  assert.equal(record.version, STATE_VERSION)

  const again = await scoped()
  assert.deepEqual(again.thread(ALICE).messages, store.thread(ALICE).messages)
  assert.equal(again.requestStatus(req.id, 1500), REQUEST_STATE.PAID)
  assert.equal(again.reactionsFor(ALICE, target.id).length, 1)
  assert.equal(again.unreadFor(ALICE), store.unreadFor(ALICE))
  assert.equal(again.thread(ALICE).muted, true)
  assert.equal(again.isBlocked(BOB), true)
  assert.equal(again.syncCursor, 1234)
  assert.deepEqual(again.outbox.map(i => i.id), [rid(9)])
})

test('nothing readable reaches the backend', async () => {
  const realBackend = createMemoryBackend()
  configureMessages({ storage: createDmStorage({ backend: realBackend, warn: () => {} }) })
  const store = await scoped()
  store.ingest(msg(ALICE, { text: 'private words' }))
  await store.flush()
  const [key] = await realBackend.keys()
  const stored = await realBackend.get(key)
  assert.ok(!stored.includes('private words'))
  assert.ok(!stored.includes(ALICE))
  const again = await scoped()
  assert.equal(again.thread(ALICE).messages[0].text, 'private words')
})

test('writes are debounced into one save', async () => {
  const saves = []
  configureMessages({ storage: { ...storage, saveChatState: async (pk, s) => { saves.push(s); await storage.saveChatState(pk, s) } } })
  const store = await scoped()
  store.ingest(msg(ALICE))
  clock.advance(SAVE_DEBOUNCE_MS - 1)
  store.ingest(msg(ALICE, { createdAt: 1001 }))
  clock.advance(SAVE_DEBOUNCE_MS - 1)
  assert.equal(saves.length, 0)
  clock.advance(1)
  await store.flush()
  assert.equal(saves.length, 1)
  assert.equal(saves[0].threads[ALICE].messages.length, 2)
})

test('a steady stream cannot postpone saving forever', async () => {
  const saves = []
  configureMessages({ storage: { ...storage, saveChatState: async (pk, s) => { saves.push(s) } } })
  const store = await scoped()
  for (let i = 0; i < 40; i += 1) {
    store.ingest(msg(ALICE, { createdAt: 1000 + i }))
    clock.advance(SAVE_DEBOUNCE_MS - 50)
  }
  await Promise.resolve()
  assert.ok(clock.ms > SAVE_MAX_WAIT_MS)
  assert.ok(saves.length >= 1)
})

test('flush saves immediately and a clean store does not write', async () => {
  const saves = []
  configureMessages({ storage: { ...storage, saveChatState: async (pk, s) => { saves.push(s) } } })
  const store = await scoped()
  assert.equal(await store.flush(), true)
  assert.equal(saves.length, 0)
  store.ingest(msg(ALICE))
  assert.equal(await store.flush(), true)
  assert.equal(saves.length, 1)
  clock.advance(10_000)
  assert.equal(saves.length, 1) // timer was cancelled
  assert.equal(await store.flush(), true)
  assert.equal(saves.length, 1)
})

test('a failed save is reported, logged without content, and retried on the next flush', async () => {
  let fail = true
  const saves = []
  configureMessages({ storage: { ...storage, saveChatState: async (pk, s) => { if (fail) throw new Error('quota private words'); saves.push(s) } } })
  const store = await scoped()
  store.ingest(msg(ALICE, { text: 'private words' }))
  assert.equal(await store.flush(), false)
  assert.ok(!JSON.stringify(warnings).includes('private words'))
  fail = false
  assert.equal(await store.flush(), true)
  assert.equal(saves.length, 1)
})

test('an unreadable record starts empty and is replaced by the next save', async () => {
  await backend.set(`chat:${ME}`, 'e:{broken')
  const store = await scoped()
  assert.equal(store.threadsSorted.length, 0)
  store.ingest(msg(ALICE))
  await store.flush()
  assert.equal((await storage.loadChatState(ME)).threads[ALICE].messages.length, 1)
})

test('a storage failure on load never overwrites the record', async () => {
  await storage.saveChatState(ME, { version: STATE_VERSION, threads: {}, blocked: [BOB] })
  const saves = []
  configureMessages({ storage: { loadChatState: async () => { throw new Error('IDB down') }, saveChatState: async (...a) => { saves.push(a) }, deleteChatState: async () => {} } })
  const store = freshStore()
  assert.equal(await store.setScope(ME), false)
  assert.equal(store.scope, ME)
  store.ingest(msg(ALICE))
  clock.advance(10_000)
  await store.flush()
  await store.setScope(null)
  assert.equal(saves.length, 0)
})

test('a record from a newer app version is left untouched', async () => {
  await storage.saveChatState(ME, { version: STATE_VERSION + 1, threads: { future: true } })
  const store = await scoped()
  store.ingest(msg(ALICE))
  await store.flush()
  assert.deepEqual(await storage.loadChatState(ME), { version: STATE_VERSION + 1, threads: { future: true } })
})

test('a record without a known version is treated as unusable, not trusted', async () => {
  await storage.saveChatState(ME, { threads: { [ALICE]: { messages: [msg(ALICE)] } } })
  const store = await scoped()
  assert.equal(store.threadsSorted.length, 0)
})

test('restore skips invalid entries and normalises the rest', async () => {
  const good = msg(ALICE, { createdAt: 50 })
  await storage.saveChatState(ME, {
    version: STATE_VERSION,
    threads: {
      [ALICE]: {
        messages: [good, { ...good }, { id: 'bad' }, msg(BOB), reactionMsg(ALICE, good.id, '👍')],
        unread: 99, lastReadAt: 'x', muted: 'yes', reactions: { nope: {} },
      },
      notAPubkey: { messages: [msg(BOB)] },
      [ME]: { messages: [] },
    },
    blocked: [BOB, BOB, 'x'], syncCursor: -4, outbox: [{ id: 'x' }, { id: rid(1), partner: ALICE }],
  })
  const store = await scoped()
  assert.deepEqual(Object.keys(store.threads), [ALICE])
  assert.equal(store.thread(ALICE).messages.length, 1)
  assert.equal(store.thread(ALICE).unread, 1)
  assert.equal(store.thread(ALICE).lastReadAt, 0)
  assert.equal(store.thread(ALICE).muted, false)
  assert.deepEqual(store.blocked, [BOB])
  assert.equal(store.syncCursor, null)
  assert.deepEqual(store.outbox.map(i => i.id), [rid(1)])
})

test('a message stuck in "sending" is requeued or failed after a restart', async () => {
  const queued = msg(ALICE, { outgoing: true, createdAt: 1 })
  const orphan = msg(ALICE, { outgoing: true, createdAt: 2 })
  await storage.saveChatState(ME, {
    version: STATE_VERSION,
    threads: { [ALICE]: { messages: [{ ...queued, delivery: 'sending' }, { ...orphan, delivery: 'sending' }] } },
    outbox: [{ id: queued.id, partner: ALICE }],
  })
  const store = await scoped()
  const byId = Object.fromEntries(store.thread(ALICE).messages.map(m => [m.id, m.delivery]))
  assert.equal(byId[queued.id], DELIVERY.QUEUED)
  assert.equal(byId[orphan.id], DELIVERY.FAILED)
})

test('deleteHistory removes the record and clears the active scope', async () => {
  const store = await scoped()
  store.ingest(msg(ALICE))
  await store.flush()
  await store.deleteHistory()
  assert.equal(store.scope, null)
  assert.equal(await storage.loadChatState(ME), null)
  clock.advance(10_000)
  assert.equal(await storage.loadChatState(ME), null)
})

test('saving on a scope switch does not leak the old state into the new key', async () => {
  const store = await scoped(ME)
  store.ingest(msg(ALICE, { text: 'mine' }))
  const switching = store.setScope(OTHER_ME)
  await switching
  store.ingest(msg(BOB, { me: OTHER_ME, text: 'theirs' }))
  await store.flush()
  const mine = await storage.loadChatState(ME)
  const theirs = await storage.loadChatState(OTHER_ME)
  assert.deepEqual(Object.keys(mine.threads), [ALICE])
  assert.deepEqual(Object.keys(theirs.threads), [BOB])
})

test('settlements are stored per request, survive a restart and stay out of other scopes', async () => {
  const store = await scoped(ME)
  const req = requestMsg(ALICE, { outgoing: true })
  store.addOutgoing(req)
  assert.equal(store.settlement(req.id), null)
  assert.equal(store.setSettlement(req.id, { walletId: 'w1', paidAt: 1234 }), true)
  assert.deepEqual(store.settlement(req.id), { walletId: 'w1', paidAt: 1234 })
  const hash = 'a'.repeat(64)
  assert.equal(store.setSettlement(req.id, { address: 'me@getalby.com', paymentHash: hash, paidAt: 1235 }), true)
  assert.deepEqual(store.settlement(req.id), { address: 'me@getalby.com', paymentHash: hash, paidAt: 1235 })
  store.setSettlement(req.id, { walletId: 'w1', paidAt: 1234 })
  assert.equal(store.setSettlement('nope', { a: 1 }), false)
  assert.throws(() => store.setSettlement(req.id, 'x'), TypeError)
  await store.flush()

  const again = await scoped(ME)
  assert.deepEqual(again.settlement(req.id), { walletId: 'w1', paidAt: 1234 })
  await again.setScope(OTHER_ME)
  assert.equal(again.settlement(req.id), null)
})

test('prune drops settlements whose request is gone and without a scope nothing is stored', async () => {
  const bare = freshStore()
  assert.equal(bare.setSettlement(rid(5), { a: 1 }), false)

  const store = await scoped(ME)
  const req = requestMsg(ALICE, { outgoing: true })
  store.addOutgoing(req)
  store.setSettlement(req.id, { walletId: 'w1', paidAt: 1 })
  store.setSettlement(rid(777), { walletId: 'w2', paidAt: 2 })
  store.prune()
  assert.deepEqual(Object.keys(store.settlements), [req.id])
})

test('handled wraps survive a restart, stay per identity, and are forgotten once out of the inbox window', async () => {
  const store = await scoped(ME)
  const wrap = rid(901)
  assert.equal(store.hasHandledWrap(wrap), false)
  assert.equal(store.rememberHandledWrap(wrap, 5_000_000), true)
  assert.equal(store.rememberHandledWrap(wrap, 5_000_000), false, 'once is enough')
  assert.equal(store.rememberHandledWrap('nope', 1), false)
  store.rememberHandledWrap(rid(902), 1_000)
  await store.flush()

  const again = await scoped(ME)
  assert.equal(again.hasHandledWrap(wrap), true)
  await again.setScope(OTHER_ME)
  assert.equal(again.hasHandledWrap(wrap), false)

  // The inbox re-reads from (cursor - 2 days); older wraps can never come back.
  const back = await scoped(ME)
  back.setSyncCursor(5_000_000)
  back.prune()
  assert.equal(back.hasHandledWrap(wrap), true)
  assert.equal(back.hasHandledWrap(rid(902)), false)
})

test('strangers cannot grow the store without bound: the least recently active stranger thread makes room', async () => {
  const store = await scoped(ME)
  const stranger = (n) => n.toString(16).padStart(64, 'f')
  for (let n = 0; n < MAX_UNKNOWN_THREADS + 3; n += 1) {
    store.ingest(msg(stranger(n), { id: rid(10_000 + n), createdAt: 1_000 + n }))
  }
  assert.equal(store.unknownThreads.length, MAX_UNKNOWN_THREADS)
  assert.equal(store.thread(stranger(0)).messages.length, 0, 'the oldest stranger thread went first')
  assert.equal(store.thread(stranger(MAX_UNKNOWN_THREADS + 2)).messages.length, 1)
  // A contact's thread is never evicted for a stranger.
  store.ingest(msg(ALICE, { id: rid(20_000), createdAt: 1 }))
  store.ingest(msg(stranger(999), { id: rid(20_001), createdAt: 5_000 }))
  assert.equal(store.thread(ALICE).messages.length, 1)
})
