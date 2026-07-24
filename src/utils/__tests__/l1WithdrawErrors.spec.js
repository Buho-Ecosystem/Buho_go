/**
 * l1WithdrawErrors — error-category mapping tests.
 *
 * Coverage focus:
 *   - each substring family maps to its title (order matters: the
 *     matcher runs top-down, so e.g. "insufficient" wins over the
 *     generic "wallet" family)
 *   - unknown errors and non-Error inputs fall back to the friendly
 *     generic instead of leaking raw text
 *
 * Run directly with Node:
 *   node src/utils/__tests__/l1WithdrawErrors.spec.js
 */

import { strict as assert } from 'node:assert';
import { describeL1WithdrawError } from '../l1WithdrawErrors.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

const t = (key) => key; // identity translate — assert on the English key

const titleFor = (message) => describeL1WithdrawError(new Error(message), t).title;

test('balance family', () => {
  assert.equal(titleFor('Amount exceeds available balance'), 'Not enough funds');
  assert.equal(titleFor('insufficient funds for tx'), 'Not enough funds');
});

test('dust / minimum family', () => {
  assert.equal(titleFor('below minimum withdrawal'), 'Amount too small');
  assert.equal(titleFor('output is dust'), 'Amount too small');
});

test('address family', () => {
  assert.equal(titleFor('invalid address checksum'), 'Invalid address');
});

test('network family', () => {
  assert.equal(titleFor('fetch failed'), 'Connection problem');
  assert.equal(titleFor('request timeout'), 'Connection problem');
});

test('expired-quote family', () => {
  assert.equal(titleFor('fee quote expired'), 'Please try again');
});

test('locked / not-ready families', () => {
  assert.equal(titleFor('wallet is not unlocked'), 'Wallet locked');
  assert.equal(titleFor('withdrawal not supported'), 'Wallet not ready');
});

test('precedence: insufficient beats the wallet family', () => {
  assert.equal(titleFor('wallet has insufficient balance'), 'Not enough funds');
});

test('fallback: unknown errors and non-Errors stay generic', () => {
  assert.equal(titleFor('some opaque SDK failure'), 'Something went wrong');
  assert.equal(describeL1WithdrawError(null, t).title, 'Something went wrong');
  assert.equal(describeL1WithdrawError(undefined, t).title, 'Something went wrong');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
