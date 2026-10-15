import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { createRumor, getPublicKey } from 'nostr-core'
import {
  createRequestGoalService,
  normalizeRequestGoal,
  requestGoalProgress
} from '../requestGoals.js'
import { parseRumor, buildPaymentTemplate } from '../protocol.js'
import { DmError, DM_ERROR } from '../errors.js'
import {
  matchIncomingPayments,
  hashOfPreimage
} from '../paymentConfirmation.js'
import {
  createMemoryBackend,
  createDmStorage
} from '../../../utils/dmStorage.js'

globalThis.localStorage = {
  data: new Map(),
  getItem(key) {
    return this.data.get(key) ?? null
  },
  setItem(key, value) {
    this.data.set(key, String(value))
  },
  removeItem(key) {
    this.data.delete(key)
  }
}
const {
  useMessagesStore,
  configureMessages,
  resetMessagesConfig,
  MAX_MESSAGES_PER_THREAD,
  deriveRequestStates
} = await import('../../../stores/messages.js')
const pubkey = (n) => getPublicKey(Uint8Array.from({ length: 32 }, () => n))
const ME = pubkey(1),
  OTHER = pubkey(2)
const PEOPLE = [3, 4, 5].map((n, index) => ({
  pubkey: pubkey(n),
  name: ['Ben', 'Clara', 'Diego'][index]
}))
let store, storage, backend, sent, service, failPerson, failSave, nonce, clock

beforeEach(async () => {
  setActivePinia(createPinia())
  backend = createMemoryBackend()
  failSave = false
  const durableBackend = {
    ...backend,
    set: async (key, value) => {
      if (failSave) throw new Error('offline storage')
      return backend.set(key, value)
    }
  }
  storage = createDmStorage({ backend: durableBackend, warn: () => {} })
  configureMessages({ storage, isKnownContact: () => true, warn: () => {} })
  store = useMessagesStore()
  await store.setScope(ME)
  sent = []
  nonce = 0
  failPerson = null
  clock = 1000
  service = createRequestGoalService({
    me: ME,
    store,
    requests: { checkOwnAddress: async () => 'anna@example.com' },
    assertUsable: () => {
      if (store.scope !== ME)
        throw new DmError(DM_ERROR.NO_IDENTITY, 'identity changed')
    },
    nowSeconds: () => clock,
    randomId: () => `nonce-${++nonce}`,
    send: async (partner, template) => {
      const saved = await storage.loadChatState(ME)
      assert.ok(
        Object.values(saved.requestGoals).some((goal) =>
          goal.shares.some(
            (share) => share.requestId === createRumor(template, ME).id
          )
        ),
        'manifest persisted before send'
      )
      if (partner === failPerson)
        throw new DmError(DM_ERROR.NO_INBOX_RELAYS, 'missing inbox')
      const message = parseRumor(createRumor(template, ME), { me: ME })
      store.addOutgoing(message, { delivery: 'sent' })
      sent.push(message)
      return message
    },
    retry: async (id) => {
      store.setDelivery(id, 'sent')
      return true
    }
  })
})
afterEach(async () => {
  await store.setScope(null)
  resetMessagesConfig()
})
const request = (extra = {}) => ({
  id: 'goal-one',
  people: PEOPLE,
  method: 'equal',
  totalSats: 48000,
  repayment: true,
  note: 'Dinner',
  source: { walletId: 'spark', transactionId: 'dinner' },
  ...extra
})

test('all three private request references are saved before any publication', async () => {
  await service.create(request())
  const goal = store.requestGoal('goal-one')
  assert.equal(sent.length, 3)
  assert.equal(goal.ownSats, 12000)
  assert.deepEqual(
    sent.map((message) => message.request.amountSats),
    [12000, 12000, 12000]
  )
  for (const message of sent) {
    assert.equal(message.request.note, 'Dinner')
    assert.ok(
      !message.text.includes('Clara') && !message.text.includes('Diego')
    )
    assert.equal(
      message.template,
      undefined,
      'manifest never travels as a chat payload'
    )
  }
  const encrypted = await backend.get('chat:' + ME)
  assert.ok(
    !encrypted.includes('Dinner') && !encrypted.includes(PEOPLE[0].pubkey)
  )
})
test('double submission, retry and the same receipt never duplicate obligations', async () => {
  await Promise.all([service.create(request()), service.create(request())])
  const ids = store
    .requestGoal('goal-one')
    .shares.map((share) => share.requestId)
  await service.create(request())
  await service.create(request({ id: 'another-click' }))
  assert.equal(sent.length, 3)
  assert.deepEqual(
    store.requestGoal('goal-one').shares.map((share) => share.requestId),
    ids
  )
  assert.equal(store.requestGoalsSorted.length, 1)
})
test('partial delivery preserves the successful requests and retries only the missing reference', async () => {
  failPerson = PEOPLE[1].pubkey
  await service.create(request())
  const share = store.requestGoal('goal-one').shares[1],
    id = share.requestId
  assert.equal(sent.length, 2)
  assert.equal(share.errorCode, DM_ERROR.NO_INBOX_RELAYS)
  failPerson = null
  await service.deliver('goal-one', id)
  assert.equal(sent.length, 3)
  assert.equal(store.requestGoal('goal-one').shares[1].requestId, id)
})
test('storage failure publishes nothing and the same draft resumes after storage recovers', async () => {
  failSave = true
  await assert.rejects(
    service.create(request()),
    (error) => error.code === DM_ERROR.STORAGE_UNAVAILABLE
  )
  assert.equal(sent.length, 0)
  const ids = store
    .requestGoal('goal-one')
    .shares.map((share) => share.requestId)
  failSave = false
  await service.create(request())
  assert.equal(sent.length, 3)
  assert.deepEqual(
    store.requestGoal('goal-one').shares.map((share) => share.requestId),
    ids
  )
})
test('an identity switch during preflight never writes a goal into the next identity', async () => {
  const interrupted = createRequestGoalService({
    me: ME,
    store,
    requests: {
      checkOwnAddress: async () => {
        await store.setScope(OTHER)
        return 'anna@example.com'
      }
    },
    send: () => assert.fail('sent after switch'),
    retry: () => {},
    nowSeconds: () => 1000,
    assertUsable: () => {
      if (store.scope !== ME)
        throw new DmError(DM_ERROR.NO_IDENTITY, 'switched')
    }
  })
  await assert.rejects(
    interrupted.create(request()),
    (error) => error.code === DM_ERROR.NO_IDENTITY
  )
  assert.equal(store.requestGoalsSorted.length, 0)
})
test('manifests and statuses survive restart, stay private to their identity and withstand pruning', async () => {
  await service.create(request())
  const goal = store.requestGoal('goal-one')
  const id = goal.shares[0].requestId
  store.setSettlement(id, { paymentHash: 'a'.repeat(64), paidAt: 1100 })
  for (let index = 0; index < MAX_MESSAGES_PER_THREAD + 101; index++) {
    store.addOutgoing({
      id: (index + 1).toString(16).padStart(64, '0'),
      kind: 14,
      type: 'text',
      sender: ME,
      recipient: PEOPLE[0].pubkey,
      partner: PEOPLE[0].pubkey,
      outgoing: true,
      createdAt: 2000 + index,
      text: 'hello',
      request: null,
      status: null,
      payment: null,
      reaction: null
    })
  }
  store.prune()
  assert.ok(
    store.thread(PEOPLE[0].pubkey).messages.some((message) => message.id === id)
  )
  assert.ok(store.settlement(id))
  await store.flush()
  await store.setScope(OTHER)
  assert.equal(store.requestGoalsSorted.length, 0)
  await store.setScope(ME)
  assert.equal(store.requestGoal('goal-one').shares[0].requestId, id)
  assert.ok(store.settlement(id))
  const bad = JSON.parse(JSON.stringify(goal))
  bad.shares[0].amountSats++
  assert.equal(normalizeRequestGoal(bad, ME), null)
  assert.equal(normalizeRequestGoal(goal, OTHER), null)
})
test('equal-amount goals require exact payment evidence and one transaction settles once', () => {
  const preimage = '2'.repeat(64),
    hash = hashOfPreimage(preimage)
  const tx = {
    amountSats: 12000,
    settledAt: 2000,
    paymentHash: hash,
    walletId: 'spark',
    id: 'incoming'
  }
  const claim = {
    id: 'a',
    createdAt: 2000,
    requireProof: true,
    payment: { amountSats: 12000 }
  }
  assert.equal(
    matchIncomingPayments([claim], [tx], { nowSeconds: 2100 }).size,
    0
  )
  const proved = { ...claim, payment: { ...claim.payment, paymentHash: hash } }
  assert.equal(
    matchIncomingPayments([proved, { ...proved, id: 'b' }], [tx], {
      nowSeconds: 2100
    }).size,
    1
  )
  assert.equal(
    matchIncomingPayments(
      [proved, { ...proved, id: 'b' }],
      [tx, { ...tx, walletId: 'nwc' }],
      { nowSeconds: 2100 }
    ).size,
    1,
    'two connections exposing one wallet cannot double-count its receipt'
  )
  assert.equal(
    matchIncomingPayments(
      [proved],
      [{ ...tx, paymentHash: hash.toUpperCase() }],
      { nowSeconds: 2100, consumed: new Set([hash.toUpperCase()]) }
    ).size,
    0
  )
  assert.equal(
    matchIncomingPayments([proved], [tx], {
      nowSeconds: 2100,
      consumed: new Set([hash])
    }).size,
    0
  )
  const contradictory = {
    ...proved,
    payment: { ...proved.payment, preimage, paymentHash: 'a'.repeat(64) }
  }
  assert.equal(
    matchIncomingPayments([contradictory], [tx], { nowSeconds: 2100 }).size,
    0
  )
  assert.equal(
    matchIncomingPayments([{ ...claim, requireProof: false }], [tx], {
      nowSeconds: 2100
    }).size,
    1,
    'ordinary legacy chats retain their fallback'
  )
})
test('reported payments are visibly checking and never advance a goal', async () => {
  await service.create(request())
  const goal = store.requestGoal('goal-one')
  const result = requestGoalProgress(goal, {
    messageFor: () => ({ delivery: 'sent' }),
    stateFor: () => 'paid',
    settlementFor: () => ({ verified: false })
  })
  assert.equal(result.receivedSats, 0)
  assert.ok(result.shares.every((share) => share.state === 'checking'))
})

test('expiry renewal stays in its original share, survives restart and includes late receipts only once', async () => {
  await service.create(request())
  const original = store.requestGoal('goal-one').shares[0].requestId
  clock += 31 * 24 * 60 * 60
  const [nextId, repeat] = await Promise.all([
    service.renew(PEOPLE[0].pubkey, original),
    service.renew(PEOPLE[0].pubkey, original)
  ])
  assert.equal(nextId, repeat)
  assert.notEqual(nextId, original)
  assert.equal(sent.length, 4)
  assert.equal(store.requestGoalFor(original).id, 'goal-one')
  assert.equal(store.requestGoalFor(nextId).id, 'goal-one')
  const thread = store.thread(PEOPLE[0].pubkey)
  assert.equal(
    deriveRequestStates(thread.messages, clock).get(original),
    'cancelled'
  )
  await service.renew(PEOPLE[0].pubkey, original)
  assert.equal(sent.length, 4)
  store.setSettlement(original, { paymentHash: 'a'.repeat(64), paidAt: clock })
  store.setSettlement(nextId, { paymentHash: 'b'.repeat(64), paidAt: clock })
  const result = requestGoalProgress(store.requestGoal('goal-one'), {
    messageFor: () => ({ delivery: 'sent' }),
    stateFor: () => 'paid',
    settlementFor: (id) => (store.settlement(id) ? { verified: true } : null)
  })
  assert.equal(result.receivedSats, 12000)
  assert.equal(result.paidCount, 1)
  await store.flush()
  await store.setScope(OTHER)
  await store.setScope(ME)
  assert.equal(
    store.requestGoal('goal-one').shares[0].previousRequests[0].requestId,
    original
  )
})

test('a payer on the new client sees both versions paid while the original payment is still routing or settled', async () => {
  await service.create(request())
  const original = store.requestGoal('goal-one').shares[0].requestId
  clock += 31 * 24 * 60 * 60
  await service.renew(PEOPLE[0].pubkey, original)
  const nextId = store.requestGoal('goal-one').shares[0].requestId
  const payerMessages = sent
    .filter((message) => message.partner === PEOPLE[0].pubkey)
    .map((message) => ({ ...message, outgoing: false }))
  const pending = deriveRequestStates(payerMessages, clock, {
    [original]: { status: 'pending' }
  })
  assert.equal(pending.get(original), 'paying')
  assert.equal(pending.get(nextId), 'paying')
  const paid = deriveRequestStates(payerMessages, clock, {
    [original]: { status: 'sent' }
  })
  assert.equal(paid.get(original), 'paid')
  assert.equal(paid.get(nextId), 'paid')
})

test('NWC-style hash-only payment messages round trip without affecting older payment payloads', () => {
  const hash = 'a'.repeat(64)
  const template = buildPaymentTemplate({
    recipient: ME,
    amountSats: 12000,
    paymentHash: hash,
    now: () => 1000
  })
  assert.equal(
    parseRumor(createRumor(template, PEOPLE[0].pubkey), { me: ME }).payment
      .paymentHash,
    hash
  )
  const legacy = buildPaymentTemplate({
    recipient: ME,
    amountSats: 12000,
    now: () => 1000
  })
  assert.equal(
    Object.hasOwn(
      parseRumor(createRumor(legacy, PEOPLE[0].pubkey), { me: ME }).payment,
      'paymentHash'
    ),
    false
  )
})
