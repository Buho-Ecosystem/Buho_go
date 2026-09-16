/**
 * Reading the time off a transaction.
 *
 * Small module, two ways to get it wrong, both of which produce a document
 * that looks authoritative and is not: dropping a row that has a perfectly
 * good time on it, and dating a row that has none.
 *
 * Run directly with Node:
 *   node src/services/taxReport/__tests__/time.spec.js
 */

import { strict as assert } from 'node:assert'
import { txTimeMs } from '../time.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    failed += 1
  }
}

const SEC = 1787774933
const MS = SEC * 1000

test('unix seconds, which is what every provider here sends', () => {
  assert.equal(txTimeMs({ settled_at: SEC }), MS)
})

test('settled_at wins: when the money moved is the date a record is about', () => {
  assert.equal(txTimeMs({ settled_at: SEC, created_at: SEC - 600 }), MS)
})

test('created_at only stands in when nothing settled it', () => {
  assert.equal(txTimeMs({ created_at: SEC }), MS)
  assert.equal(txTimeMs({ time: SEC }), MS)
})

test('a value already in milliseconds is not scaled again', () => {
  // 1e12 apart is the difference between 2026 and the year 58000.
  assert.equal(txTimeMs({ settled_at: MS }), MS)
})

test('an ISO string is accepted', () => {
  assert.equal(txTimeMs({ settled_at: '2026-08-27T10:00:00Z' }), Date.parse('2026-08-27T10:00:00Z'))
})

test('a numeric string is a unix time, not a date to parse', () => {
  // Date.parse('0') is the year 2000. A row with no time must not acquire one.
  assert.equal(txTimeMs({ settled_at: String(SEC) }), MS)
  assert.equal(txTimeMs({ settled_at: '0' }), null)
})

test('no time is null, never the epoch and never today', () => {
  for (const tx of [
    {}, null, undefined,
    { settled_at: 0 }, { settled_at: -1 }, { settled_at: null }, { settled_at: '' },
    { settled_at: 'soon' }, { settled_at: NaN }, { settled_at: {} }, { settled_at: [] },
  ]) {
    assert.equal(txTimeMs(tx), null, JSON.stringify(tx))
  }
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
