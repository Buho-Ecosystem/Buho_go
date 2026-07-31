/**
 * logRedaction.js tests.
 *
 * The module is a privacy boundary: every NFC / deep-link payload that gets
 * logged passes through it. A regression here silently leaks one-time card
 * authentication parameters, invoices or LNURLs into Android logcat, so the
 * contract "never emit the payload itself" is pinned by tests.
 *
 * Run with the Node runtime directly:
 *   node src/utils/__tests__/logRedaction.spec.js
 */

import { strict as assert } from 'node:assert';

import { redactPaymentInput } from '../logRedaction.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(err);
  }
}

test('URI input is reduced to scheme + length', () => {
  const raw = 'lnurlw://pay.example.com/tagid/api/v1/scan/abc123?p=SECRET1&c=SECRET2';
  assert.equal(redactPaymentInput(raw), `lnurlw:…(${raw.length} chars)`);
});

test('one-time card auth parameters never appear in the output', () => {
  const raw = 'lnurlw://pay.example.com/scan/x?p=4E3F...&c=94C1...';
  const redacted = redactPaymentInput(raw);
  assert.ok(!redacted.includes('4E3F'));
  assert.ok(!redacted.includes('94C1'));
  assert.ok(!redacted.includes('pay.example.com'));
});

test('schemeless bech32 input keeps only a short format prefix', () => {
  const raw = 'LNURL1DP68GURN8GHJ7MRWW4EXCTNXD9SHG6NPVCHXXMMD9AKXUATJDSKHQCTE8AEK2UMND9HKU';
  const redacted = redactPaymentInput(raw);
  assert.equal(redacted, `LNURL1:…(${raw.length} chars)`);
  assert.ok(!redacted.includes('DP68GURN'));
});

test('BOLT11 invoice keeps only a short format prefix', () => {
  const raw = 'lnbc210n1pn9zvxupp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq';
  const redacted = redactPaymentInput(raw);
  assert.ok(redacted.startsWith('lnbc21:'));
  assert.ok(!redacted.includes('pp5qqqsyq'));
});

test('non-string and empty inputs yield the neutral placeholder', () => {
  assert.equal(redactPaymentInput(null), '(empty)');
  assert.equal(redactPaymentInput(undefined), '(empty)');
  assert.equal(redactPaymentInput(42), '(empty)');
  assert.equal(redactPaymentInput(''), '(empty)');
  assert.equal(redactPaymentInput('   '), '(empty)');
});

test('surrounding whitespace does not distort scheme or length', () => {
  const raw = '  lightning:lnbc1abcdef  ';
  assert.equal(redactPaymentInput(raw), `lightning:…(${raw.trim().length} chars)`);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
