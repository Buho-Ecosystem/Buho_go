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
import { pollWhilePending } from '../client.js'

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

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

run()
