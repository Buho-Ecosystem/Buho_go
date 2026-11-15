import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { brantaFixture, proofUri, ADDRESS as REAL_ADDRESS, OTHER_ADDRESS } from '../../../scripts/fixtures/branta.mjs'
import {
  BRANTA_STATUS, brantaAvatar, brantaLookupText, checkWithBranta, clearBrantaCache,
  hasBrantaParams, invalidBrantaInput, normalizeBrantaResult, safeBrantaUrl, resolveBrantaEnvironment, brantaReceiptOf,
} from '../branta.js'
const ADDRESS = REAL_ADDRESS, INVOICE = 'lnbc42u1invoice-under-test', ARK = 'ark1destination'
const ORIGIN = 'https://guardrail.branta.pro'
const target = { kind: 'bitcoin', value: ADDRESS }
const destination = (value = ADDRESS, type = 'bitcoin_address') => ({ type, value, isEncrypted: false })
const owner = (name = 'Coffee', destinations = [destination()]) => ({ platform: name, destinations, platformLogoLightUrl: `${ORIGIN}/logo.png`, description: 'A coffee' })
const match = (payments = [owner()]) => ({ status: 'match', matchedDestinations: [destination()], payments, verifyUrl: `${ORIGIN}/v1/verify/id#local-secret` })
beforeEach(clearBrantaCache)

test('environment override is explicitly development-only', () => {
  assert.equal(resolveBrantaEnvironment({}), 'Production')
  assert.equal(resolveBrantaEnvironment({ DEV: false, VITE_BRANTA_ENVIRONMENT: 'Staging' }), 'Production')
  assert.equal(resolveBrantaEnvironment({ DEV: true, VITE_BRANTA_ENVIRONMENT: 'Staging' }), 'Staging')
})
test('proof keys are decoded case-insensitively while proof values and full request remain untouched', () => {
  const input = proofUri(ADDRESS, { encoded: true })
  assert.equal(hasBrantaParams(input), true)
  assert.equal(hasBrantaParams(`bitcoin:${ADDRESS}?BRANTA_ID=A&Branta_Secret=CaseSensitive`), true)
  assert.equal(brantaLookupText({ type: 'bitcoin_address', data: ADDRESS, rawInput: input }), input)
  assert.equal(hasBrantaParams(ADDRESS), false)
  assert.equal(hasBrantaParams(`bitcoin:${ADDRESS}?branta_id=only`), false)
})
test('duplicate encoded proof or payment fields fail closed instead of selecting different parser values', async () => {
  for (const suffix of ['&branta%5fid=duplicate', '&BRANTA_SECRET=duplicate', '&Amount=0.5']) {
    const input = proofUri() + suffix
    assert.equal(invalidBrantaInput(input), true)
    assert.equal((await checkWithBranta({ qrText: input, service: { verify() { assert.fail('invalid proof must not reach SDK') } } })).status, 'tampered')
  }
})
test('unified proof-free lookups use only the paid invoice or Ark destination', () => {
  const unified = `bitcoin:${ADDRESS}?lightning=${INVOICE}&ark=${ARK}`
  assert.equal(brantaLookupText({ type: 'lightning_invoice', invoice: INVOICE, rawInput: unified }), INVOICE)
  assert.equal(brantaLookupText({ type: 'arkade_address', arkadeAddress: ARK, rawInput: unified }), ARK)
  for (const payment of [{ type: 'spark_address', sparkAddress: 'spark1x', rawInput: unified }, { type: 'bitcoin_address', bitcoinAddress: ADDRESS }, { type: 'lightning_address', lightningAddress: 'shop@example.com' }, { type: 'lnurl', lnurl: 'https://shop.example/pay' }]) assert.equal(brantaLookupText(payment), null)
})
test('record links require exact Branta HTTPS origin/path without credentials; fragment remains local', () => {
  assert.equal(safeBrantaUrl(`${ORIGIN}/v1/verify/id#local`, 'Production', { record: true }), `${ORIGIN}/v1/verify/id#local`)
  for (const url of ['http://guardrail.branta.pro/v1/verify/id', 'https://guardrail.branta.pro.evil/v1/verify/id', 'https://user@guardrail.branta.pro/v1/verify/id', `${ORIGIN}:444/v1/verify/id`, `${ORIGIN}/other/path`, 'javascript:alert(1)', 'https://staging.guardrail.branta.pro/v1/verify/id']) assert.equal(safeBrantaUrl(url, 'Production', { record: true }), '')
})
test('only exact decrypted matches may own a verified recipient; unrelated payments[0] is ignored', () => {
  const result = match([owner('Unrelated', [destination(OTHER_ADDRESS)]), owner('Actual owner')])
  const receipt = normalizeBrantaResult(result, target, { now: 100 })
  assert.equal(receipt.name, 'Actual owner')
  assert.equal(receipt.checkedAt, 100)
  assert.deepEqual(receipt.destination, target)
  assert.equal(receipt.verifyUrl.endsWith('#local-secret'), true)
  assert.equal(Object.isFrozen(receipt), true)
})
test('sibling rails, encrypted destinations, missing owner and conflicting owners never acquire branding', () => {
  const result = match()
  assert.equal(normalizeBrantaResult(result, { kind: 'lightning', value: INVOICE }), null)
  assert.equal(normalizeBrantaResult(result, { kind: 'optimizedSpark', value: ADDRESS }), null)
  assert.equal(normalizeBrantaResult({ ...result, matchedDestinations: [{ ...destination(), isEncrypted: true }] }, target), null)
  assert.equal(normalizeBrantaResult(match([owner('Wrong', [destination(OTHER_ADDRESS)])]), target), null)
  assert.equal(normalizeBrantaResult(match([owner('One'), owner('Two')]), target), null)
  assert.equal(normalizeBrantaResult({ payments: [owner()] }, target), null, 'legacy getPayments response is not a verify match')
})
test('Ark address matching is supported on its own, whatever other routes are excluded', () => {
  const ark = destination(ARK, 'ark_address')
  assert.equal(normalizeBrantaResult({ ...match([owner('Ark merchant', [ark])]), matchedDestinations: [ark] }, { kind: 'arkade', value: ARK }).name, 'Ark merchant')
})
test('a child business owns its name/logo; unsafe artwork is dropped and expired records stay ordinary', () => {
  const child = { ...owner(), childPlatform: { name: '  Local café\u0001 ', logoLightUrl: `${ORIGIN}/child.png` } }
  assert.equal(normalizeBrantaResult(match([child]), target).name, 'Local café')
  assert.equal(normalizeBrantaResult(match([{ ...owner(), platformLogoLightUrl: 'https://evil.example/logo.png' }]), target).logoLightUrl, '')
  assert.equal(normalizeBrantaResult(match([{ ...owner(), createdDate: '2020-01-01T00:00:00Z', ttl: 1 }]), target), null)
  assert.equal(brantaAvatar({ logoLightUrl: 'https://evil.example/a' }), null)
  assert.deepEqual(brantaAvatar({ logoLightUrl: `${ORIGIN}/logo.png` }), { url: `${ORIGIN}/logo.png`, background: '' })
})
test('expiry respects missing/zero TTL while malformed provided data never becomes a permanent match', () => {
  const now = Date.parse('2026-11-14T12:00:00Z')
  for (const expiry of [{}, { ttl: 0 }]) {
    assert.equal(normalizeBrantaResult(match([{ ...owner(), ...expiry }]), target, { now }).expiresAt, null)
  }
  const valid = { ...owner(), ttl: 3600, createdDate: '2026-11-14T11:30:00Z' }
  assert.equal(normalizeBrantaResult(match([valid]), target, { now }).expiresAt, Date.parse('2026-11-14T12:30:00Z'))
  assert.equal(normalizeBrantaResult(match([{ ...valid, createdDate: '2026-11-14T10:00:00Z' }]), target, { now }), null)
  for (const ttl of [null, '3600', {}, -1, NaN, Infinity, Number.MAX_VALUE]) {
    assert.equal(normalizeBrantaResult(match([{ ...valid, ttl }]), target, { now }), null, String(ttl))
  }
  for (const createdDate of [undefined, null, 42, '', '42', 'not a date', '2026-99-99T25:99:99Z', '2026-02-30T12:00:00Z', '2026-11-14T24:00:00Z']) {
    assert.equal(normalizeBrantaResult(match([{ ...valid, createdDate }]), target, { now }), null, String(createdDate))
  }
})
test('a saved check keeps who and when, never the destination, and ignores later changes to its source', () => {
  const original = { ...normalizeBrantaResult(match(), target, { now: 10 }), destination: { ...target } }
  const saved = brantaReceiptOf(original)
  original.name = 'Different'; original.destination.value = OTHER_ADDRESS
  assert.equal(saved.name, 'Coffee')
  assert.equal(saved.checkedAt, 10)
  assert.equal(Object.isFrozen(saved), true)
  assert.deepEqual(Object.keys(saved).sort(), ['checkedAt', 'description', 'environment', 'logoLightUrl', 'logoUrl', 'name', 'verifyUrl'])
  assert.equal(brantaReceiptOf(null), null)
})
test('public SDK verify uses a finite cache and never caches tampering or failures', async () => {
  let now = 1000, calls = 0
  const service = { async verify(input, ignored, signal) { assert.equal(input, INVOICE); assert.ok(signal); calls += 1; return match() } }
  const controller = new AbortController()
  const options = { qrText: INVOICE, signal: controller.signal, service, now: () => now }
  const first = await checkWithBranta(options)
  assert.equal(first.status, 'match')
  assert.equal(first.checkedAt, 1000)
  now += 100
  assert.equal((await checkWithBranta(options)).checkedAt, 1000)
  assert.equal(calls, 1)
  now += 60000
  await checkWithBranta(options)
  assert.equal(calls, 2)
  clearBrantaCache()
  const tampered = { verify: async () => { calls += 1; return { status: 'tampered' } } }
  await checkWithBranta({ ...options, service: tampered }); await checkWithBranta({ ...options, service: tampered })
  assert.equal(calls, 4)
  assert.equal((await checkWithBranta({ qrText: INVOICE, service: { verify: async () => { throw new Error('private detail') } } })).status, 'unknown')
})
test('unknown and incomplete SDK answers stay ordinary; aborted work cannot cache a match', async () => {
  for (const status of ['unknown', 'incomplete']) {
    clearBrantaCache()
    assert.equal((await checkWithBranta({ qrText: INVOICE, service: { verify: async () => ({ status }) } })).status, status)
    assert.equal(normalizeBrantaResult({ status }, target), null)
  }
  const controller = new AbortController()
  const result = await checkWithBranta({ qrText: INVOICE, signal: controller.signal, service: { verify: async () => { controller.abort(); return match() } } })
  assert.equal(result.status, 'unknown')
})
test('real SDK4.3 encrypted wire binds the exact Bitcoin proof and detects encoded-key tampering', async () => {
  const fixture = await brantaFixture({ destinations: [{ type: 'bitcoin_address', value: ADDRESS }] })
  const verified = await fixture.verify(proofUri(ADDRESS, { encoded: true }))
  assert.equal(normalizeBrantaResult(verified, target).name, 'Kaffeehaus Lindgren')
  const changed = await fixture.verify(proofUri(OTHER_ADDRESS, { encoded: true }), 'tampered')
  assert.equal(changed.status, 'tampered')
})
