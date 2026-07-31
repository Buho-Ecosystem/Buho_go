/** Curated, locale-aware payment-error copy tests. */

import { strict as assert } from 'node:assert';
import de from '../../i18n/de/index.js';
import es from '../../i18n/es/index.js';
import { getUnsupportedBolt12OfferCopy } from '../userErrors.js';

const BOLT12_TITLE = "This payment request isn't supported yet";
const BOLT12_REASON = 'This is a specific type of Lightning payment request. BuhoGO cannot pay BOLT12 offers yet, so no money was sent. Ask the recipient for a Lightning invoice or Lightning address instead.';

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

test('BOLT12 copy leads with an accessible headline and confirms no money was sent', () => {
  const copy = getUnsupportedBolt12OfferCopy();
  assert.equal(copy.title, BOLT12_TITLE);
  assert.match(copy.reason, /no money was sent/i);
  assert.match(copy.reason, /Lightning invoice or Lightning address/i);
});

test('BOLT12 copy uses the caller translation function for every visible string', () => {
  const keys = [];
  const copy = getUnsupportedBolt12OfferCopy((key) => {
    keys.push(key);
    return `translated:${key}`;
  });
  assert.equal(keys.length, 2);
  assert.match(copy.title, /^translated:/);
  assert.match(copy.reason, /^translated:/);
});

test('BOLT12 copy has complete German and Spanish translations', () => {
  for (const messages of [de, es]) {
    const copy = getUnsupportedBolt12OfferCopy((key) => messages[key] || key);
    assert.notEqual(copy.title, BOLT12_TITLE);
    assert.notEqual(copy.reason, BOLT12_REASON);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
