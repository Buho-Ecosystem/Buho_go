/**
 * lnurlVerify — LUD-21 verification helpers.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/lnurlVerify.spec.js
 */
import { strict as assert } from 'node:assert'
import { validateVerifyUrl, normalizeVerify, pollVerify } from '../lnurlVerify.js'

const tests = []
function test(name, fn) { tests.push([name, fn]) }

// ── validateVerifyUrl ──────────────────────────────────────────────────────

test('validateVerifyUrl accepts https on the same host as the callback', () => {
  const u = validateVerifyUrl(
    'https://chapsmart.com/.well-known/lnurlp/verify/abc',
    'https://chapsmart.com/.well-known/lnurlp/255740034110',
  )
  assert.equal(u, 'https://chapsmart.com/.well-known/lnurlp/verify/abc')
})

test('validateVerifyUrl rejects a different host (no third-party polling)', () => {
  assert.equal(
    validateVerifyUrl('https://evil.example/verify/abc', 'https://chapsmart.com/cb'),
    null,
  )
})

test('validateVerifyUrl rejects non-https and junk', () => {
  assert.equal(validateVerifyUrl('http://chapsmart.com/v', 'https://chapsmart.com/cb'), null)
  assert.equal(validateVerifyUrl('not-a-url', 'https://chapsmart.com/cb'), null)
  assert.equal(validateVerifyUrl('', 'https://chapsmart.com/cb'), null)
  assert.equal(validateVerifyUrl(null, 'https://chapsmart.com/cb'), null)
})

test('validateVerifyUrl fails closed when the callback is missing/unparseable', () => {
  assert.equal(validateVerifyUrl('https://a.example/v', null), null)
  assert.equal(validateVerifyUrl('https://a.example/v', 'not-a-url'), null)
})

test('validateVerifyUrl is port-insensitive on the same host (matches LUD-09 hostname rule)', () => {
  assert.equal(
    validateVerifyUrl('https://chapsmart.com:8443/verify/abc', 'https://chapsmart.com/cb'),
    'https://chapsmart.com:8443/verify/abc',
  )
})

// ── normalizeVerify ────────────────────────────────────────────────────────

test('normalizeVerify surfaces the mpesa delivery object', () => {
  const s = normalizeVerify({
    status: 'OK', settled: true, preimage: null,
    mpesa: { delivered: true, receipt: 'DG13G1LB8F', recipient: 'JOHN DOE', amount: 2500, completedAt: '2026-07-01T16:27:59Z' },
  })
  assert.equal(s.settled, true)
  assert.equal(s.delivered, true)
  assert.equal(s.receipt, 'DG13G1LB8F')
  assert.equal(s.recipient, 'JOHN DOE')
  assert.equal(s.amount, 2500)
})

test('normalizeVerify: settled but not yet delivered', () => {
  const s = normalizeVerify({ status: 'OK', settled: true, preimage: null })
  assert.equal(s.settled, true)
  assert.equal(s.delivered, false)
  assert.equal(s.receipt, null)
  assert.equal(s.recipient, null)
})

test('normalizeVerify: before payment / empty', () => {
  const s = normalizeVerify({ status: 'OK', settled: false })
  assert.equal(s.settled, false)
  assert.equal(s.delivered, false)
  const empty = normalizeVerify(null)
  assert.equal(empty.settled, false)
  assert.equal(empty.delivered, false)
})

// ── pollVerify ─────────────────────────────────────────────────────────────

test('pollVerify returns as soon as the payout is delivered', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return { ok: true, json: async () => ({ settled: true, mpesa: { delivered: true, receipt: 'DG13', recipient: 'JOHN DOE', amount: 2500 } }) }
  }
  const r = await pollVerify('https://x/verify/1', null, { fetchImpl, intervalMs: 0 })
  assert.equal(r.delivered, true)
  assert.equal(r.receipt, 'DG13')
  assert.equal(calls, 1)
})

test('pollVerify stops at the deadline with the last (undelivered) status', async () => {
  let t = 0
  const fetchImpl = async () => ({ ok: true, json: async () => ({ settled: true }) })
  const r = await pollVerify('https://x/verify/1', null, {
    fetchImpl, timeoutMs: 5, intervalMs: 0, now: () => (t += 10),
  })
  assert.equal(r.settled, true)
  assert.equal(r.delivered, false)
})

test('pollVerify fires onUpdate when the status changes and never throws on errors', async () => {
  const seen = []
  let t = 0
  let n = 0
  const fetchImpl = async () => {
    n += 1
    if (n === 1) throw new Error('transient')
    return { ok: true, json: async () => ({ settled: true, mpesa: { delivered: true, receipt: 'R', recipient: 'A', amount: 1 } }) }
  }
  const r = await pollVerify('https://x/verify/1', (s) => seen.push(s), {
    fetchImpl, timeoutMs: 1000, intervalMs: 0, now: () => (t += 1),
  })
  assert.equal(r.delivered, true)
  assert.equal(seen.length, 1) // one change: undelivered -> delivered (the throw is swallowed)
})

test('pollVerify stops immediately when the abort signal is already set', async () => {
  let calls = 0
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({ settled: true }) } }
  const controller = new AbortController()
  controller.abort()
  const r = await pollVerify('https://x/verify/1', null, {
    fetchImpl, signal: controller.signal, intervalMs: 0, timeoutMs: 1000, now: () => 0,
  })
  assert.equal(r, null)
  assert.equal(calls, 0)
})

;(async () => {
  let passed = 0
  let failed = 0
  for (const [name, fn] of tests) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
      passed += 1
    } catch (err) {
      console.error(`  ✗ ${name}`)
      console.error(`    ${err.message}`)
      failed += 1
    }
  }
  console.log(`\n  ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
})()
