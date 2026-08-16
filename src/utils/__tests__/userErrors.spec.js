/** Curated, locale-aware payment-error copy tests. */

import { strict as assert } from 'node:assert';
import de from '../../i18n/de/index.js';
import es from '../../i18n/es/index.js';
import { getUnsupportedBolt12OfferCopy, classifyTransportFailure, buildPaymentError } from '../userErrors.js';

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

// ─── classifyTransportFailure ───────────────────────────────────────────

const TIMEOUT_COPY = 'The server did not respond or the link is no longer valid';
const OFFLINE_COPY = "Couldn't reach the network. Please check your internet and try again.";

test('classifyTransportFailure recognizes timeouts across transports', () => {
  assert.equal(classifyTransportFailure('The server did not respond in time'), 'timeout');
  assert.equal(classifyTransportFailure('Invalid Lightning Address: The server did not respond in time'), 'timeout');
  assert.equal(classifyTransportFailure('Read timed out'), 'timeout');
  assert.equal(classifyTransportFailure('The request timed out.'), 'timeout');
  assert.equal(classifyTransportFailure('connect timed out'), 'timeout');
});

test('classifyTransportFailure recognizes offline/DNS failures across platforms', () => {
  assert.equal(classifyTransportFailure('Failed to fetch'), 'offline');
  assert.equal(classifyTransportFailure('Load failed'), 'offline');
  assert.equal(
    classifyTransportFailure('Unable to resolve host "pay.wave.space": No address associated with hostname'),
    'offline',
  );
  assert.equal(
    classifyTransportFailure('failed to connect to pay.example/1.2.3.4 (port 443) from /10.0.0.5 (port 40202) after 30000ms'),
    'offline',
  );
  assert.equal(classifyTransportFailure('The Internet connection appears to be offline.'), 'offline');
});

test('classifyTransportFailure leaves upstream server prose untouched', () => {
  // Server-authored reasons that merely mention connectivity words must
  // keep their exact text (they are attributed upstream in the dialog).
  assert.equal(classifyTransportFailure('Payment timeout exceeded, please retry'), null);
  assert.equal(classifyTransportFailure('Payment attempt timed out'), null);
  assert.equal(classifyTransportFailure('Invoice request timed out by upstream node'), null);
  assert.equal(classifyTransportFailure('failed to connect to peer for route'), null);
  assert.equal(classifyTransportFailure('Error: failed to fetch invoice from node'), null);
  assert.equal(classifyTransportFailure(''), null);
  assert.equal(classifyTransportFailure(null), null);
});

test('buildPaymentError curates the LNURL timeout instead of attributing it upstream', () => {
  const e = buildPaymentError(new Error('The server did not respond in time'), { context: 'withdraw' });
  assert.equal(e.reason, TIMEOUT_COPY);
  assert.equal(e.reasonSource, 'curated');
  assert.equal(e.reasonAttribution, null);
});

test('buildPaymentError curates native DNS failures as network copy', () => {
  const e = buildPaymentError(
    new Error('Unable to resolve host "pay.wave.space": No address associated with hostname'),
    { context: 'payment' },
  );
  assert.equal(e.reason, OFFLINE_COPY);
  assert.equal(e.reasonSource, 'curated');
});

test('transport-failure copy has German and Spanish translations', () => {
  for (const messages of [de, es]) {
    assert.ok(messages[TIMEOUT_COPY], 'timeout copy key missing');
    assert.ok(messages[OFFLINE_COPY], 'offline copy key missing');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
