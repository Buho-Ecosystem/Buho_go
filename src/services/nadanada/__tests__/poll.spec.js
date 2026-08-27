/**
 * pollWhilePending — settlement/fulfilment polling behaviour.
 *
 * Coverage focus:
 *   - resolves with the first truthy result
 *   - HTTP 402 ("payment pending") never triggers the error bailout
 *   - persistent non-402 errors bail out after maxConsecutiveErrors
 *   - a clean "pending" (null) return keeps polling until the deadline
 *   - an aborted signal rejects with AbortError and never calls fn
 *
 * Run directly with Node:
 *   node src/services/nadanada/__tests__/poll.spec.js
 */

import { strict as assert } from 'node:assert'
import { pollWhilePending, NadanadaError, isFatalError, isPendingError } from '../client.js'

let passed = 0
let failed = 0

async function test(name, fn) {
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

const FAST = { baseMs: 1, maxIntervalMs: 2 }

async function run() {
  await test('resolves with the first truthy result', async () => {
    let calls = 0
    const out = await pollWhilePending(async () => {
      calls += 1
      return calls >= 3 ? { iccid: 'ABC' } : null
    }, { ...FAST, maxMs: 1000 })
    assert.deepEqual(out, { iccid: 'ABC' })
    assert.equal(calls, 3)
  })

  await test('402 pending never triggers the error bailout', async () => {
    let calls = 0
    const out = await pollWhilePending(async () => {
      calls += 1
      const err = new Error('Payment Required'); err.status = 402; throw err
    }, { ...FAST, maxMs: 60 })
    assert.equal(out, null)            // timed out, not bailed
    assert.ok(calls > 6, `expected many polls, got ${calls}`)
  })

  await test('persistent non-402 errors bail after maxConsecutiveErrors', async () => {
    let calls = 0
    const out = await pollWhilePending(async () => {
      calls += 1
      const err = new Error('boom'); err.status = 500; throw err
    }, { ...FAST, maxMs: 5000, maxConsecutiveErrors: 6 })
    assert.equal(out, null)
    assert.equal(calls, 6)             // stopped hammering a failing endpoint
  })

  await test('clean pending (null) keeps polling until the deadline', async () => {
    let calls = 0
    const out = await pollWhilePending(async () => { calls += 1; return null }, { ...FAST, maxMs: 40 })
    assert.equal(out, null)
    assert.ok(calls >= 2, `expected repeated polls, got ${calls}`)
  })

  await test('aborted signal rejects with AbortError and never calls fn', async () => {
    const c = new AbortController()
    c.abort()
    let calls = 0
    await assert.rejects(
      pollWhilePending(async () => { calls += 1; return null }, { ...FAST, maxMs: 1000, signal: c.signal }),
      (e) => e.name === 'AbortError',
    )
    assert.equal(calls, 0)
  })

  // ── the failure modes that used to lose money ────────────────────────────

  await test('a fatal status is rethrown instead of being buried as "still waiting"', async () => {
    // 404 means this checkout session does not exist. Retrying it for three
    // minutes behind a reassuring spinner is how a dead order looked pending.
    let calls = 0
    await assert.rejects(
      pollWhilePending(async () => {
        calls += 1
        throw new NadanadaError('Checkout session not found for this payment', { status: 404, fatal: true })
      }, { ...FAST, maxMs: 5000 }),
      (e) => e.status === 404 && e.fatal === true,
    )
    assert.equal(calls, 1, 'must stop on the first fatal answer')
  })

  await test('409 CONFIG_ALREADY_GENERATED stops the poll', async () => {
    // The VPN config is issued once per payment. Polling past a 409 can never
    // succeed and only hides the fact that the config already went out.
    let calls = 0
    await assert.rejects(
      pollWhilePending(async () => {
        calls += 1
        throw new NadanadaError('Configuration already generated', { status: 409, fatal: true, code: 'CONFIG_ALREADY_GENERATED' })
      }, { ...FAST, maxMs: 5000 }),
      (e) => e.code === 'CONFIG_ALREADY_GENERATED',
    )
    assert.equal(calls, 1)
  })

  await test('a hung request cannot outlive maxMs', async () => {
    // CapacitorHttp requests cannot be cancelled, and the old loop only checked
    // its budget BETWEEN attempts — so one stuck request pinned the sheet on an
    // uncloseable spinner forever.
    const started = Date.now()
    const out = await pollWhilePending(
      () => new Promise(() => {}), // never settles
      { ...FAST, maxMs: 120 },
    )
    assert.equal(out, null)
    assert.ok(Date.now() - started < 2000, 'the poll must settle on its own')
  })

  await test('a real one-shot probe gets at least one attempt', async () => {
    // The settled-but-errored safety net used to run zero attempts because it
    // was called with maxMs: 1, so a payment that had landed was reported as
    // failed and then lost.
    let calls = 0
    const out = await pollWhilePending(async () => { calls += 1; return { ok: true } }, { ...FAST, maxMs: 6000 })
    assert.deepEqual(out, { ok: true })
    assert.equal(calls, 1)
  })

  await test('error classifiers agree with the documented statuses', async () => {
    assert.equal(isPendingError({ status: 402 }), true)
    assert.equal(isFatalError({ status: 404 }), true)
    assert.equal(isFatalError({ status: 409 }), true)
    assert.equal(isFatalError({ status: 500 }), false, '5xx is transient, keep retrying')
    assert.equal(isFatalError({ status: 402 }), false)
    assert.equal(isFatalError(null), false)
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

run()
