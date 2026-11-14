import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createBrantaVerification } from '../brantaVerification.js'
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
