import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createBrantaVerification, createBrantaReview, brantaTargetFor, brantaVerificationOf, PAYMENT_REVIEW_REQUIRED } from '../brantaVerification.js'
import { BRANTA_STATUS } from '../../utils/branta.js'
const value = 'bc1qtest', target = { kind: 'bitcoin', value }
const result = name => ({ status: 'match', matchedDestinations: [{ type: 'bitcoin_address', value, isEncrypted: false }], payments: [{ platform: name, destinations: [{ type: 'bitcoin_address', value, isEncrypted: false }] }], verifyUrl: 'https://guardrail.branta.pro/v1/verify/id#local' })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const checks = []
afterEach(() => checks.splice(0).forEach(check => check.cancel()))
function check(verify, options = {}) { const changes = []; const session = createBrantaVerification({ verify, holdMs: 8, timeoutMs: 60, onChange: answer => changes.push(answer), ...options }); checks.push(session); session.start('bitcoin:request'); return { session, changes } }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('binding publishes only the business owning the actual selected destination', async () => {
  const { session, changes } = check(async () => result('Coffee'))
  const answer = await session.bind(target, 'wallet-A:100')
  assert.equal(changes[0].status, BRANTA_STATUS.CHECKING)
  assert.equal(answer.status, BRANTA_STATUS.VERIFIED)
  assert.equal(answer.verification.name, 'Coffee')
  assert.equal((await session.bind({ kind: 'optimizedSpark', value }, 'wallet-A:100')).status, BRANTA_STATUS.NONE)
})
test('a response beyond foreground budget cannot silently replace settled presentation', async () => {
  const response = deferred()
  const { session, changes } = check(() => response.promise)
  assert.equal((await session.bind(target, 'wallet-A:100')).status, BRANTA_STATUS.NONE)
  response.resolve(result('Late'))
  await sleep(1)
  assert.equal(changes.at(-1).status, BRANTA_STATUS.NONE)
  assert.equal((await session.bind(target, 'wallet-A:100')).status, BRANTA_STATUS.NONE)
  assert.equal((await session.bind(target, 'wallet-A:100', { refresh: true })).status, BRANTA_STATUS.VERIFIED, 'final confirmation may discover a changed identity but must return for review')
})
test('final confirmation waits another bounded budget and catches a pending tamper before debit', async () => {
  const response = deferred()
  const { session } = check(() => response.promise, { holdMs: 15 })
  assert.equal((await session.bind(target, 'wallet-A:100')).status, BRANTA_STATUS.NONE)
  const final = session.bind(target, 'wallet-A:100', { refresh: true })
  response.resolve({ status: 'tampered' })
  assert.equal((await final).status, BRANTA_STATUS.TAMPERED)
  assert.equal((await session.bind(target, 'wallet-B:200')).status, BRANTA_STATUS.TAMPERED)
  session.stale()
  assert.equal((await session.bind(target, 'wallet-B:200', { refresh: true })).status, BRANTA_STATUS.TAMPERED)
})
test('cancelled or superseded sessions ignore late lookup results', async () => {
  const response = deferred()
  const { session, changes } = check(({ signal }) => { assert.equal(signal.aborted, false); return response.promise })
  const old = session.bind(target, 'wallet-A')
  await sleep(1)
  session.cancel()
  response.resolve({ status: 'tampered' })
  await old
  assert.notEqual(changes.at(-1).status, BRANTA_STATUS.TAMPERED)
  assert.equal(session.tampered, false)
})
test('wallet and amount ABA rebinding cannot make an older binding publish', async () => {
  const response = deferred()
  const { session, changes } = check(() => response.promise)
  const first = session.bind(target, 'wallet-A:100')
  const other = session.bind(target, 'wallet-B:200')
  const current = session.bind(target, 'wallet-A:100')
  response.resolve(result('Current'))
  assert.equal((await first).status, BRANTA_STATUS.NONE)
  assert.equal((await other).status, BRANTA_STATUS.NONE)
  assert.equal((await current).status, BRANTA_STATUS.VERIFIED)
  assert.equal(changes.filter(answer => answer.status === BRANTA_STATUS.VERIFIED).length, 1)
})
test('returning to a settled route cancels an intervening pending binding', async () => {
  const response = deferred()
  const { session, changes } = check(() => response.promise, { timeoutMs: 1000 })
  assert.equal((await session.bind(target, 'wallet-A:100')).status, BRANTA_STATUS.NONE)
  const otherTarget = { kind: 'bitcoin', value: 'bc1qother' }
  const other = session.bind(otherTarget, 'wallet-B:200')
  assert.equal((await session.bind(target, 'wallet-A:100')).status, BRANTA_STATUS.NONE)
  response.resolve({
    status: 'match',
    matchedDestinations: [{ type: 'bitcoin_address', value: otherTarget.value, isEncrypted: false }],
    payments: [{ platform: 'Other route business', destinations: [{ type: 'bitcoin_address', value: otherTarget.value, isEncrypted: false }] }],
  })
  assert.equal((await other).status, BRANTA_STATUS.NONE)
  assert.equal(changes.at(-1).status, BRANTA_STATUS.NONE)
  assert.equal(changes.some(answer => answer.status === BRANTA_STATUS.VERIFIED), false)
})
test('stale/resumed checks refresh and keep original checked time until another lookup completes', async () => {
  let now = 100, calls = 0
  const { session } = check(async ({ fresh }) => { calls += 1; assert.equal(fresh, calls > 1); return result(calls === 1 ? 'Before' : 'After') }, { now: () => now })
  const first = await session.bind(target, 'wallet-A')
  assert.equal(first.verification.checkedAt, 100)
  now = 200
  assert.equal((await session.bind(target, 'wallet-A', { refresh: true })).verification.checkedAt, 100)
  session.stale()
  const latest = await session.bind(target, 'wallet-A', { refresh: true })
  assert.equal(latest.verification.name, 'After')
  assert.equal(latest.verification.checkedAt, 200)
})
test('deadline aborts a service that never answers without replacing ordinary presentation later', async () => {
  let signal
  const { session, changes } = check(args => { signal = args.signal; return new Promise(() => {}) }, { timeoutMs: 15 })
  await session.bind(target, 'wallet-A')
  await sleep(20)
  assert.equal(signal.aborted, true)
  assert.equal(changes.at(-1).status, BRANTA_STATUS.NONE)
})

test('a recheck keeps what is shown: no checking flicker, and a slow link is not a lost business', async () => {
  let calls = 0
  const slow = deferred()
  const { session, changes } = check(async () => { calls += 1; return calls === 1 ? result('Coffee') : slow.promise })
  assert.equal((await session.bind(target, 'wallet-A')).status, BRANTA_STATUS.VERIFIED)
  const seen = changes.length
  session.stale()
  const recheck = await session.bind(target, 'wallet-A', { refresh: true })
  assert.equal(recheck.status, BRANTA_STATUS.VERIFIED, 'still unanswered after the hold')
  assert.equal(recheck.verification.name, 'Coffee')
  assert.equal(changes.slice(seen).some(answer => answer.status !== BRANTA_STATUS.VERIFIED), false)
  // The answer, once it is there, is what the next confirmation sees.
  slow.resolve({ status: 'unknown' })
  await sleep(1)
  assert.equal((await session.bind(target, 'wallet-A', { refresh: true })).status, BRANTA_STATUS.NONE)
})
test('another route never inherits the business kept for the one before', async () => {
  let calls = 0
  const { session } = check(async () => { calls += 1; return calls === 1 ? result('Coffee') : new Promise(() => {}) })
  assert.equal((await session.bind(target, 'wallet-A')).status, BRANTA_STATUS.VERIFIED)
  session.stale()
  await session.bind(target, 'wallet-A', { refresh: true })
  assert.equal((await session.bind({ kind: 'bitcoin', value: 'bc1qother' }, 'wallet-A')).status, BRANTA_STATUS.NONE)
})

// ── The review around a session: what the page calls ─────────────────────
const INVOICE = 'lnbc2400invoice'
const bolt = name => ({ status: 'match', matchedDestinations: [{ type: 'bolt11', value: INVOICE, isEncrypted: false }], payments: [{ platform: name, destinations: [{ type: 'bolt11', value: INVOICE, isEncrypted: false }] }] })
function review({ verify = async () => bolt('Coffee'), walletType = 'lnbits' } = {}) {
  const state = { payment: { type: 'lightning_invoice', invoice: INVOICE }, busy: false, enabled: true, walletId: 'payer', walletType, amount: 2400, confirming: [] }
  const subject = createBrantaReview({
    payment: () => state.payment, busy: () => state.busy, gone: () => false, enabled: () => state.enabled, excluded: payment => !!payment.firstParty,
    walletId: () => state.walletId, walletType: () => state.walletType, amount: () => state.amount,
    confirming: value => state.confirming.push(value),
  }, { createSession: options => createBrantaVerification({ ...options, verify: args => verify(args), holdMs: 8, timeoutMs: 60 }) })
  checks.push(subject)
  return { subject, state }
}
test('the destination checked is the one the selected wallet pays', () => {
  assert.deepEqual(brantaTargetFor({ invoice: `lightning:${INVOICE}` }, { walletType: 'nwc' }), { kind: 'lightning', value: INVOICE })
  assert.deepEqual(brantaTargetFor({ bitcoinAddress: 'bitcoin:bc1qtest?amount=1' }, {}), { kind: 'bitcoin', value: 'bc1qtest' })
  assert.deepEqual(brantaTargetFor({ arkadeAddress: 'ark1x' }, {}), { kind: 'arkade', value: 'ark1x' })
  // Spark decides the rail when it prepares: nothing is assumed before, or for another wallet or amount.
  const payment = { invoice: INVOICE }
  const spark = { walletType: 'spark', walletId: 'payer', amount: 2400 }
  assert.equal(brantaTargetFor(payment, spark), null)
  const route = { payment, walletId: 'payer', amount: 2400, request: INVOICE, target: { kind: 'lightning', value: INVOICE } }
  assert.deepEqual(brantaTargetFor(payment, { ...spark, route }), { kind: 'lightning', value: INVOICE })
  assert.equal(brantaTargetFor(payment, { ...spark, route, amount: 2500 }), null)
  assert.equal(brantaTargetFor(payment, { ...spark, route, walletId: 'other' }), null)
  assert.equal(brantaTargetFor({ ...payment }, { ...spark, route }), null, 'a route prepared for another payment')
  assert.equal(brantaTargetFor(null, spark), null)
})
test('the watch key moves with payer, amount, prepared route and the setting, and with nothing else', () => {
  const { subject, state } = review({ walletType: 'spark' })
  const first = subject.key(state.payment)
  assert.equal(subject.key(state.payment), first)
  subject.prepared(state.payment, { walletId: 'payer', amount: 2400, request: INVOICE, target: { kind: 'lightning', value: INVOICE } })
  const routed = subject.key(state.payment)
  assert.notEqual(routed, first)
  for (const change of [() => { state.amount = 2500 }, () => { state.walletId = 'other' }, () => { state.enabled = false }]) {
    const before = subject.key(state.payment)
    change()
    assert.notEqual(subject.key(state.payment), before)
  }
  assert.equal(subject.key(null), '')
})
test('accept keeps the reviewed business for the receipt and tells the page while it runs', async () => {
  const { subject, state } = review()
  await subject.run(state.payment)
  assert.equal(brantaVerificationOf(state.payment).name, 'Coffee')
  assert.deepEqual(await subject.accept(state.payment), { ok: true })
  assert.deepEqual(state.confirming, [true, false])
  const receipt = subject.receipt(state.payment)
  assert.equal(receipt.name, 'Coffee')
  assert.equal('destination' in receipt, false, 'the paid destination is not saved with the check')
  assert.equal(subject.receipt({ ...state.payment }), null)
})
test('accept stops for another business or a lost one, never for a check that merely finished', async () => {
  let answer = bolt('Coffee')
  const { subject, state } = review({ verify: async () => answer })
  await subject.run(state.payment)
  answer = bolt('Other shop'); subject.stale()
  assert.deepEqual(await subject.accept(state.payment), { ok: false, reason: 'changed' })
  assert.equal(subject.receipt(state.payment), null)
  answer = { status: 'unknown' }; subject.stale()
  assert.deepEqual(await subject.accept(state.payment), { ok: false, reason: 'unavailable' })
  answer = bolt('Coffee'); subject.stale()
  assert.deepEqual(await subject.accept(state.payment), { ok: true }, 'none to verified goes on')
  assert.equal(subject.receipt(state.payment).name, 'Coffee')
})
test('accept refuses a changed code, a payment that moved on and a payer or amount changed underneath it', async () => {
  const slow = deferred()
  const { subject, state } = review({ verify: () => slow.promise })
  await subject.run(state.payment)
  const pending = subject.accept(state.payment)
  assert.deepEqual(await subject.accept(state.payment), { ok: false }, 'one confirmation at a time')
  state.amount = 9999
  assert.deepEqual(await pending, { ok: false })
  state.amount = 2400
  const tampering = subject.accept(state.payment)
  slow.resolve({ status: 'tampered' })
  assert.deepEqual(await tampering, { ok: false })
  assert.equal(state.payment.brantaMismatch, true)
  assert.deepEqual(await subject.accept(state.payment), { ok: false })
  state.busy = true
  assert.equal(await subject.run(state.payment), null)
})
test('payments that are never looked up are accepted without a claim', async () => {
  const { subject, state } = review({ verify: () => assert.fail('must not query') })
  state.payment.firstParty = true
  assert.equal(subject.checks(state.payment), false)
  assert.deepEqual(subject.skip(state.payment), { ok: true }, 'synchronous: the page takes ownership in the same tick')
  assert.deepEqual(await subject.accept(state.payment), { ok: true })
  assert.equal(subject.receipt(state.payment), null)
  state.payment.firstParty = false; state.enabled = false
  assert.equal((await subject.run(state.payment)).status, BRANTA_STATUS.NONE)
  assert.deepEqual(await subject.accept(state.payment), { ok: true })
})
test('a prepared route that is not the reviewed destination stops before the debit and drops the claim', async () => {
  const { subject, state } = review()
  await subject.run(state.payment)
  await subject.accept(state.payment)
  assert.doesNotThrow(() => subject.assertPrepared(state.payment, { kind: 'lightning', value: INVOICE.toUpperCase() }))
  assert.throws(() => subject.assertPrepared(state.payment, { kind: 'optimizedSpark', value: INVOICE }), { code: PAYMENT_REVIEW_REQUIRED, reason: 'unavailable' })
  assert.equal(state.payment.branta.status, BRANTA_STATUS.NONE)
  assert.equal(subject.receipt(state.payment), null)
  state.walletType = 'spark'
  assert.deepEqual(subject.target(state.payment), { kind: 'optimizedSpark', value: INVOICE }, 'the next review checks the route that will be paid')
  assert.doesNotThrow(() => subject.assertPrepared(state.payment, { kind: 'optimizedSpark', value: INVOICE }), 'nothing is claimed any more')
  assert.throws(() => subject.assertPrepared({ ...state.payment }, { kind: 'lightning', value: INVOICE }), { code: PAYMENT_REVIEW_REQUIRED })
})

test('the check writes only its result to the payment: the page re-estimates fees whenever that object changes', async () => {
  const { subject, state } = review({ walletType: 'spark' })
  const before = Object.keys(state.payment).sort()
  subject.prepared(state.payment, { walletId: 'payer', amount: 2400, request: INVOICE, target: { kind: 'lightning', value: INVOICE } })
  assert.deepEqual(Object.keys(state.payment).sort(), before, 'a prepared route never touches the payment')
  const key = subject.key(state.payment)
  subject.prepared(state.payment, { walletId: 'payer', amount: 2400, request: INVOICE, target: { kind: 'lightning', value: INVOICE } })
  assert.equal(subject.key(state.payment), key, 'the same route again changes nothing')
  await subject.run(state.payment)
  await subject.accept(state.payment)
  assert.deepEqual(Object.keys(state.payment).sort(), [...before, 'branta'].sort())
})
