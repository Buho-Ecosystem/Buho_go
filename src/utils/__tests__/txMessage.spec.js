/**
 * txMessage — what human text a transaction carries, and which strings
 * only look like text.
 *
 * Coverage focus:
 *   - the placeholder memos BuhoGO writes on undescribed invoices never
 *     count as content, whatever their casing or padding
 *   - a payer's comment outranks an invoice description
 *   - nothing is ever invented: no text in, empty string out
 *
 * Run directly with Node:
 *   node src/utils/__tests__/txMessage.spec.js
 */

import { strict as assert } from 'node:assert'
import { getTxDescription, getTxMessage, isPlaceholderDescription } from '../txMessage.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (error) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${error.message}`)
    failed += 1
  }
}

console.log('\ntxMessage\n')

// ── isPlaceholderDescription ────────────────────────────────────────

test('the default memo BuhoGO stamps on an undescribed invoice is a placeholder', () => {
  assert.equal(isPlaceholderDescription('BuhoGO Payment'), true)
})

test('the legacy generic memo is a placeholder too', () => {
  assert.equal(isPlaceholderDescription('Lightning transaction'), true)
})

test('placeholders are recognised whatever their casing or padding — the same string reaches us from several code paths and providers', () => {
  assert.equal(isPlaceholderDescription('  buhogo payment  '), true)
  assert.equal(isPlaceholderDescription('BUHOGO PAYMENT'), true)
})

test('empty, whitespace and nullish descriptions count as placeholders — to the reader they are identical to filler', () => {
  assert.equal(isPlaceholderDescription(''), true)
  assert.equal(isPlaceholderDescription('   '), true)
  assert.equal(isPlaceholderDescription(null), true)
  assert.equal(isPlaceholderDescription(undefined), true)
})

test('text a person actually wrote is never a placeholder, even when it mentions BuhoGO', () => {
  assert.equal(isPlaceholderDescription('Have a beer on me'), false)
  assert.equal(isPlaceholderDescription('BuhoGO Payment for the invoice'), false)
})

// ── getTxDescription ────────────────────────────────────────────────

test('a real description is returned trimmed', () => {
  assert.equal(getTxDescription({ description: '  Coffee round  ' }), 'Coffee round')
})

test('memo stands in when the provider sent no description', () => {
  assert.equal(getTxDescription({ memo: 'Team lunch' }), 'Team lunch')
})

test('a placeholder description resolves to nothing, so callers can say something honest instead', () => {
  assert.equal(getTxDescription({ description: 'BuhoGO Payment' }), '')
})

test('no transaction, no description', () => {
  assert.equal(getTxDescription(null), '')
  assert.equal(getTxDescription(undefined), '')
  assert.equal(getTxDescription({}), '')
})

// ── getTxMessage ────────────────────────────────────────────────────

test("the payer's comment outranks the invoice description — a comment is always deliberate", () => {
  const tx = { comment: 'Have a beer on me', description: 'Invoice 42' }
  assert.equal(getTxMessage(tx), 'Have a beer on me')
})

test('the description carries the message when there is no comment', () => {
  assert.equal(getTxMessage({ description: 'Invoice 42' }), 'Invoice 42')
})

test('a comment rescues a payment whose description is only a placeholder', () => {
  const tx = { comment: 'Thanks!', description: 'BuhoGO Payment' }
  assert.equal(getTxMessage(tx), 'Thanks!')
})

test('a placeholder description with no comment leaves the payment with no message at all', () => {
  assert.equal(getTxMessage({ description: 'BuhoGO Payment' }), '')
})

test('a whitespace-only comment falls through to the description rather than blanking the row', () => {
  const tx = { comment: '   ', description: 'Invoice 42' }
  assert.equal(getTxMessage(tx), 'Invoice 42')
})

test('nothing is ever invented', () => {
  assert.equal(getTxMessage(null), '')
  assert.equal(getTxMessage({}), '')
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
