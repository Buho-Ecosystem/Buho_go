/**
 * useTransactionGrouping — micropayment burst grouping for
 * TransactionHistory's tx list.
 *
 * Coverage focus:
 *   - cluster-based grouping survives an unrelated transaction
 *     interleaved in a burst (the strictly-adjacent-run regression)
 *   - rolling time window: a long steady stream keeps extending a
 *     cluster even though its first-to-last span exceeds timeWindowSeconds
 *   - direction isolation (incoming/outgoing never merge, even sharing a key)
 *   - minGroupSize / maxGroupSize enforcement, with no transaction ever lost
 *   - counterpartyKey as a stable identity: takes precedence in
 *     extractRecipient, and lets shouldGroupTransactions decide outright
 *     (never falling through to a shared generic memo like "BuhoGO
 *     Payment") when two transactions carry known, different counterparties
 *   - description-similarity grouping preserved as a fallback when no
 *     stable identity is known on either side (backward compatibility)
 *   - output ordering (newest first) and the group object shape
 *
 * Run directly with Node:
 *   node src/composables/__tests__/transactionGrouping.spec.js
 */

import { strict as assert } from 'node:assert'
import {
  groupMicropayments,
  shouldGroupTransactions,
  extractRecipient,
  extractStableCounterparty,
  DEFAULT_GROUPING_OPTIONS,
} from '../useTransactionGrouping.js'

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let uid = 0
function tx(overrides = {}) {
  uid += 1
  return {
    id: `tx-${uid}`,
    type: 'incoming',
    amount: 1,
    settled_at: 0,
    ...overrides,
  }
}

// Total transaction count represented by a groupMicropayments() output:
// every member inside a group plus every standalone transaction. This is
// the invariant that matters more than any single grouping decision -
// nothing is ever dropped.
function countTransactions(output) {
  return output.reduce((sum, item) => sum + (item.type === 'group' ? item.count : 1), 0)
}

// ---------------------------------------------------------------------------
// The regression: adjacency-run grouping fragments a burst that has an
// unrelated transaction interleaved in it
// ---------------------------------------------------------------------------

test('4 incoming payments to the same counterpartyKey, interleaved with outgoing txs, group into ONE group of 4', () => {
  const base = 1_000_000
  const incoming = [0, 60, 120, 180].map(offset => tx({
    type: 'incoming',
    counterpartyKey: 'streamer@getalby.com',
    settled_at: base + offset,
  }))
  // Each outgoing leg has its own distinct counterparty and no shared
  // description, so they must never group with each other either - they
  // are the "loose rows" the live bug produced alongside the fragment.
  const outgoing = [30, 90, 150, 210].map((offset, i) => tx({
    type: 'outgoing',
    counterpartyKey: `out-${i}@wallet.com`,
    settled_at: base + offset,
  }))

  const all = [...incoming, ...outgoing]
  const result = groupMicropayments(all, { timeWindowSeconds: 3600, minGroupSize: 2 })

  const groups = result.filter(item => item.type === 'group')
  assert.equal(groups.length, 1, 'exactly one group should form')
  assert.equal(groups[0].count, 4)
  assert.equal(groups[0].transactionType, 'incoming')
  assert.deepEqual(
    groups[0].transactions.map(t => t.id).sort(),
    incoming.map(t => t.id).sort(),
  )

  const standalone = result.filter(item => item.type !== 'group')
  assert.equal(standalone.length, 4)
  assert.ok(standalone.every(t => t.type === 'outgoing'))

  assert.equal(countTransactions(result), 8, 'no transaction should be dropped')
})

// ---------------------------------------------------------------------------
// Rolling window
// ---------------------------------------------------------------------------

test('a 31-payment burst spread over 35 minutes groups into ONE group via the rolling window', () => {
  const base = 2_000_000
  const gapSeconds = 70 // 30 gaps * 70s = 2100s = 35 minutes end-to-end
  const timeWindowSeconds = 120 // each individual gap (70s) is comfortably under this

  const burst = Array.from({ length: 31 }, (_, i) => tx({
    type: 'incoming',
    counterpartyKey: 'zapper@getalby.com',
    settled_at: base + i * gapSeconds,
  }))

  // Sanity check: the naive (non-rolling) reading of the window would
  // reject this burst outright, because first-to-last exceeds it.
  assert.ok(burst[30].settled_at - burst[0].settled_at > timeWindowSeconds)

  const result = groupMicropayments(burst, { timeWindowSeconds, minGroupSize: 2, maxGroupSize: 50 })

  assert.equal(result.length, 1)
  assert.equal(result[0].type, 'group')
  assert.equal(result[0].count, 31)
  assert.equal(countTransactions(result), 31)
})

// ---------------------------------------------------------------------------
// Time window boundary
// ---------------------------------------------------------------------------

test('two payments to the same counterpartyKey more than timeWindowSeconds apart are NOT grouped', () => {
  const timeWindowSeconds = 3600
  const a = tx({ type: 'incoming', counterpartyKey: 'far@apart.com', settled_at: 1000 })
  const b = tx({ type: 'incoming', counterpartyKey: 'far@apart.com', settled_at: 1000 + timeWindowSeconds + 1 })

  const result = groupMicropayments([a, b], { timeWindowSeconds, minGroupSize: 2 })

  assert.equal(result.filter(item => item.type === 'group').length, 0)
  assert.equal(result.length, 2)
  assert.equal(countTransactions(result), 2)
})

// ---------------------------------------------------------------------------
// Direction isolation
// ---------------------------------------------------------------------------

test('mixed directions sharing the same counterpartyKey are never grouped together', () => {
  const key = 'selfpayment@buho.app'
  const incoming = [0, 30, 60].map(offset => tx({ type: 'incoming', counterpartyKey: key, settled_at: 1000 + offset }))
  const outgoing = [10, 40, 70].map(offset => tx({ type: 'outgoing', counterpartyKey: key, settled_at: 1000 + offset }))

  const result = groupMicropayments([...incoming, ...outgoing], { timeWindowSeconds: 3600, minGroupSize: 2 })

  const groups = result.filter(item => item.type === 'group')
  assert.equal(groups.length, 2, 'one incoming group and one outgoing group, never merged into one')
  assert.ok(groups.every(g => g.transactions.every(t => t.type === g.transactionType)))
  assert.equal(countTransactions(result), 6)
})

// ---------------------------------------------------------------------------
// minGroupSize
// ---------------------------------------------------------------------------

test('below minGroupSize, a cluster is emitted as standalone transactions, never wrapped in a group', () => {
  const key = 'shop@merchant.com'
  const pair = [0, 30].map(offset => tx({ type: 'incoming', counterpartyKey: key, settled_at: 1000 + offset }))
  const solo = tx({ type: 'incoming', counterpartyKey: 'other@merchant.com', settled_at: 5000 })

  // minGroupSize 3 means even the 2-payment cluster must stay standalone.
  const result = groupMicropayments([...pair, solo], { timeWindowSeconds: 3600, minGroupSize: 3 })

  assert.equal(result.filter(item => item.type === 'group').length, 0)
  assert.equal(result.length, 3)
  assert.ok(result.every(item => item.type !== 'group'))
  assert.equal(countTransactions(result), 3)
})

// ---------------------------------------------------------------------------
// maxGroupSize
// ---------------------------------------------------------------------------

test('maxGroupSize is respected: a 60-payment burst with maxGroupSize 50 caps at 50, and the remaining 10 are conserved', () => {
  const key = 'firehose@getalby.com'
  const burst = Array.from({ length: 60 }, (_, i) => tx({
    type: 'incoming',
    counterpartyKey: key,
    settled_at: 1000 + i * 5, // 5s apart, well within the window
  }))

  const result = groupMicropayments(burst, { timeWindowSeconds: 3600, minGroupSize: 2, maxGroupSize: 50 })

  const groups = result.filter(item => item.type === 'group')
  assert.ok(groups.every(g => g.count <= 50), 'no group ever exceeds maxGroupSize')
  assert.ok(groups.some(g => g.count === 50), 'the capped cluster of exactly 50 should exist')
  assert.equal(countTransactions(result), 60, 'total transaction count is conserved across the output')
})

// ---------------------------------------------------------------------------
// Backward compatibility: description-only grouping (no counterpartyKey)
// ---------------------------------------------------------------------------

test('description similarity still groups transactions when no counterpartyKey is present', () => {
  const result = groupMicropayments([
    tx({ type: 'incoming', settled_at: 1000, description: 'Coffee tip for the stream' }),
    tx({ type: 'incoming', settled_at: 1030, description: 'Coffee tip for stream' }),
    tx({ type: 'incoming', settled_at: 1060, description: 'Coffee tip stream' }),
  ], { timeWindowSeconds: 3600, minGroupSize: 2, descriptionSimilarity: 0.75 })

  assert.equal(result.length, 1)
  assert.equal(result[0].type, 'group')
  assert.equal(result[0].count, 3)
  assert.equal(countTransactions(result), 3)
})

// ---------------------------------------------------------------------------
// Output ordering
// ---------------------------------------------------------------------------

test('output is ordered newest first, whether the item is a group or a standalone transaction', () => {
  const oldStandalone = tx({ type: 'incoming', settled_at: 1000, description: 'Unrelated old payment' })
  const groupA = [1100, 1130].map(t0 => tx({ type: 'incoming', counterpartyKey: 'early@group.com', settled_at: t0 }))
  const groupB = [5000, 5030].map(t0 => tx({ type: 'incoming', counterpartyKey: 'late@group.com', settled_at: t0 }))
  const newStandalone = tx({ type: 'incoming', settled_at: 9000, description: 'Unrelated new payment' })

  const result = groupMicropayments([oldStandalone, ...groupA, ...groupB, newStandalone], {
    timeWindowSeconds: 3600,
    minGroupSize: 2,
  })

  const orderTimes = result.map(item => (item.type === 'group' ? item.endTime : item.settled_at))
  const sortedDesc = [...orderTimes].sort((a, b) => b - a)
  assert.deepEqual(orderTimes, sortedDesc)
  assert.equal(orderTimes[0], 9000)
  assert.equal(orderTimes[orderTimes.length - 1], 1000)
  assert.equal(countTransactions(result), 6)
})

// ---------------------------------------------------------------------------
// Group object shape (deliverable 1: same shape as today, every field kept)
// ---------------------------------------------------------------------------

test('a produced group retains the exact current object shape, every field included', () => {
  const members = [
    tx({ type: 'incoming', counterpartyKey: 'shape@check.com', settled_at: 1000, amount: 5, description: 'Zap' }),
    tx({ type: 'incoming', counterpartyKey: 'shape@check.com', settled_at: 1030, amount: 7, description: 'Zap' }),
  ]
  const result = groupMicropayments(members, { timeWindowSeconds: 3600, minGroupSize: 2 })

  assert.equal(result.length, 1)
  const group = result[0]

  const expectedKeys = [
    'id', 'type', 'transactionType', 'transactions', 'count', 'totalAmount',
    'firstTransaction', 'lastTransaction', 'recipient', 'description',
    'startTime', 'endTime', 'settled_at', 'isGroup', 'expanded',
  ]
  expectedKeys.forEach(key => {
    assert.ok(Object.prototype.hasOwnProperty.call(group, key), `group is missing "${key}"`)
  })

  assert.equal(group.type, 'group')
  assert.equal(group.isGroup, true)
  assert.equal(group.transactionType, 'incoming')
  assert.equal(group.count, 2)
  assert.equal(group.totalAmount, 12)
  assert.equal(group.startTime, 1000)
  assert.equal(group.endTime, 1030)
  assert.equal(group.settled_at, 1030)
  assert.equal(group.expanded, false)
  assert.equal(group.recipient, 'shape@check.com')
})

// ---------------------------------------------------------------------------
// extractRecipient: counterpartyKey precedence
// ---------------------------------------------------------------------------

test('extractRecipient prefers a non-empty counterpartyKey over every existing fallback', () => {
  assert.equal(
    extractRecipient({ counterpartyKey: 'me@getalby.com', senderNpub: 'npub1abc', description: 'something' }),
    'me@getalby.com',
  )
  // whitespace-only counterpartyKey is treated as absent
  assert.equal(
    extractRecipient({ counterpartyKey: '   ', senderNpub: 'npub1abc' }),
    'npub1abc',
  )
  // non-string counterpartyKey (defensive) falls through untouched
  assert.equal(
    extractRecipient({ counterpartyKey: 42, senderNpub: 'npub1xyz' }),
    'npub1xyz',
  )
  // existing fallbacks still work when no counterpartyKey is present
  const hash = 'abcdefghijklmnopqrstuvwxyz'
  assert.equal(extractRecipient({ payment_hash: hash }), hash.substring(0, 20))
})

// ---------------------------------------------------------------------------
// New correctness guard: stable-identity mismatch must veto description
// similarity (two different counterparties sharing a generic memo)
// ---------------------------------------------------------------------------

test('shouldGroupTransactions: same counterpartyKey with different memos still groups (stable identity wins)', () => {
  const a = tx({ type: 'incoming', counterpartyKey: 'zapper@getalby.com', settled_at: 1000, description: 'Enjoy the show!' })
  const b = tx({ type: 'incoming', counterpartyKey: 'zapper@getalby.com', settled_at: 1030, description: 'Great stream today' })
  assert.equal(shouldGroupTransactions(a, b, DEFAULT_GROUPING_OPTIONS), true)
})

test('shouldGroupTransactions: different counterpartyKeys with the identical generic memo "BuhoGO Payment" never group', () => {
  const a = tx({ type: 'incoming', counterpartyKey: 'alice@wallet.com', settled_at: 1000, description: 'BuhoGO Payment' })
  const b = tx({ type: 'incoming', counterpartyKey: 'bob@wallet.com', settled_at: 1030, description: 'BuhoGO Payment' })
  assert.equal(shouldGroupTransactions(a, b, DEFAULT_GROUPING_OPTIONS), false)
})

test('shouldGroupTransactions: no counterpartyKey on either side, identical memo still groups (backward compatible)', () => {
  const a = tx({ type: 'incoming', settled_at: 1000, description: 'BuhoGO Payment' })
  const b = tx({ type: 'incoming', settled_at: 1030, description: 'BuhoGO Payment' })
  assert.equal(shouldGroupTransactions(a, b, DEFAULT_GROUPING_OPTIONS), true)
})

test('groupMicropayments: two counterparties sharing the generic "BuhoGO Payment" memo form two separate groups, never one merged group', () => {
  const alice = [0, 30].map(offset => tx({
    type: 'incoming', counterpartyKey: 'alice@wallet.com', description: 'BuhoGO Payment', settled_at: 1000 + offset,
  }))
  const bob = [15, 45].map(offset => tx({
    type: 'incoming', counterpartyKey: 'bob@wallet.com', description: 'BuhoGO Payment', settled_at: 1000 + offset,
  }))

  const result = groupMicropayments([...alice, ...bob], { timeWindowSeconds: 3600, minGroupSize: 2 })

  const groups = result.filter(item => item.type === 'group')
  assert.equal(groups.length, 2, 'alice and bob must never merge into one group')
  assert.deepEqual(groups.map(g => g.count).sort(), [2, 2])
  assert.equal(countTransactions(result), 4)
})

test('extractStableCounterparty returns an identity only from counterpartyKey/npub sources, never from payment_request, payment_hash, or a plain description', () => {
  assert.equal(extractStableCounterparty({ counterpartyKey: 'me@getalby.com' }), 'me@getalby.com')
  assert.equal(extractStableCounterparty({ senderNpub: 'npub1abc' }), 'npub1abc')
  assert.equal(
    extractStableCounterparty({ description: `Zap from npub1${'a'.repeat(58)}` }),
    `npub1${'a'.repeat(58)}`,
  )
  assert.equal(extractStableCounterparty({ payment_request: 'lnbc1verylonginvoice' }), null)
  assert.equal(extractStableCounterparty({ payment_hash: 'abcabcabcabcabcabcabc' }), null)
  assert.equal(extractStableCounterparty({ description: 'BuhoGO Payment' }), null)
  assert.equal(extractStableCounterparty({}), null)
  assert.equal(extractStableCounterparty(null), null)
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
