/** Curated, locale-aware payment-error copy tests. */

import { strict as assert } from 'node:assert';
import de from '../../i18n/de/index.js';
import es from '../../i18n/es/index.js';
import { getUnsupportedBolt12OfferCopy, classifyTransportFailure, buildPaymentError, translateErrorCode, unreachableReason } from '../userErrors.js';
import { counterpartyError, isCounterpartyError, keepOrigin } from '../errorOrigin.js';

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

// The Spark SDK's failure when nothing answered (a phone whose VPN blocked
// all traffic, 2026-10-15), shortened from the user's report.
const SPARK_UNREACHABLE = 'SparkSdkError: Service error: service provider error: authentication error: '
  + 'network error: Request error: error sending request : JsValue(TypeError: Failed to fetch\n'
  + 'TypeError: Failed to fetch\n    at a (https://localhost/assets/breezSdk-vtUOD6Wq.js:2:1075))';

test('classifyTransportFailure sees through the Spark SDK wrapping the browser error', () => {
  assert.equal(classifyTransportFailure(SPARK_UNREACHABLE), 'offline');
  assert.equal(classifyTransportFailure('network error: Request error: error sending request : JsValue(TypeError: Load failed)'), 'offline');
  assert.equal(classifyTransportFailure('NetworkError when attempting to fetch resource.'), 'offline');
  const e = buildPaymentError(new Error(SPARK_UNREACHABLE), { context: 'payment', walletType: 'spark' });
  assert.equal(e.reason, OFFLINE_COPY);
  assert.equal(e.reasonSource, 'curated');
});

test('unreachableReason names Spark only when the Spark SDK reported the failure', () => {
  assert.match(unreachableReason('offline', SPARK_UNREACHABLE), /^You're offline\./);
  assert.match(unreachableReason('no-internet', SPARK_UNREACHABLE), /^No internet connection\..*VPN/);
  assert.match(unreachableReason('service', SPARK_UNREACHABLE), /^Spark can't be reached/);
  // A recipient's server that is down is not Spark's doing.
  assert.match(unreachableReason('service', 'Failed to fetch'), /^The service can't be reached/);
});

test('connection copy has German and Spanish translations', () => {
  const copy = [
    'Checking your connection...',
    ...['offline', 'no-internet'].map((kind) => unreachableReason(kind, '')),
    unreachableReason('service', SPARK_UNREACHABLE),
    unreachableReason('service', ''),
  ];
  for (const messages of [de, es]) {
    for (const text of copy) assert.ok(messages[text] && messages[text] !== text, `missing: ${text}`);
  }
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

// ─── Saved wallets that could not be changed ───────────────────────────

const WALLET_STATE_COPY = {
  WALLET_STATE_UNAVAILABLE: 'Your wallets could not be loaded, so nothing was changed. Close and reopen BuhoGO, then try again.',
  WALLET_STATE_CONFLICT: 'Your wallets were changed in another tab or window, so nothing was saved here. Reload BuhoGO, then try again.',
};
const ADD_REFUSED_TITLE = "Couldn't add the wallet";

test('a refused wallet save is explained by BuhoGO, never attributed to a service', () => {
  for (const [code, copy] of Object.entries(WALLET_STATE_COPY)) {
    const e = buildPaymentError(Object.assign(new Error('The saved wallets could not be loaded'), { code }), { context: 'connect' });
    assert.equal(e.title, ADD_REFUSED_TITLE, 'an add that saved nothing never blames the connection');
    assert.equal(e.reason, copy);
    assert.equal(e.reasonSource, 'curated');
    assert.equal(e.reasonAttribution, null);
    assert.equal(translateErrorCode({ code }, (key) => key), copy, 'one-line error surfaces show the same copy');
    assert.equal(buildPaymentError({ code }, {}).title, 'Something went wrong', 'elsewhere (a removal) the headline claims no add');
    assert.equal(buildPaymentError({ code }, { context: 'connect', title: 'Own headline' }).title, 'Own headline');
  }
  assert.equal(buildPaymentError(new Error('relay offline'), { context: 'connect' }).title, "Couldn't connect", 'a failed connect keeps its headline');
});

test('the refused-save copy has German and Spanish translations, without em dashes or a raw @', () => {
  for (const copy of [...Object.values(WALLET_STATE_COPY), ADD_REFUSED_TITLE]) {
    assert.doesNotMatch(copy, /—|@/);
    for (const messages of [de, es]) {
      assert.ok(messages[copy] && messages[copy] !== copy, `translation missing: ${copy}`);
      assert.doesNotMatch(messages[copy], /—|@/);
    }
  }
});


test('a wallet that holds too little is said in our words, never attributed to the recipient', () => {
  const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name);
  const said = [
    new Error('insufficient funds'),                                          // Breez SDK
    new Error('LNBits API error: Insufficient balance.'),                     // LNbits
    new Error('LNBits API error: You must reserve at least (1%) 10 sat to cover potential routing fees.'),
    new Error('Not enough funds'),                                            // Arkade
    Object.assign(new Error('Wallet refused'), { code: 'INSUFFICIENT_BALANCE' }), // NWC
  ];
  for (const error of said) {
    const e = buildPaymentError(error, { context: 'payment', walletName: 'Business' }, t);
    assert.equal(e.reason, 'Not enough balance in Business.', error.message);
    assert.equal(e.reasonSource, 'curated');
    assert.equal(e.reasonAttribution, null, error.message);
  }
  assert.equal(buildPaymentError(new Error('insufficient funds'), { context: 'payment' }).reason, 'Not enough funds.');
  // Numbers still get the breakdown, which says more.
  assert.match(buildPaymentError(new Error('Insufficient funds 109 / 50551'), { context: 'payment', amountSats: 50000, walletName: 'Business' }, t).reason, /Balance: 109 sats/);
  // A recipient's own refusal is not a shortfall.
  const theirs = buildPaymentError(counterpartyError('Amount is above the maximum'), { context: 'payment', walletName: 'Business' });
  assert.equal(theirs.reasonSource, 'upstream');
  // A withdrawal service short of funds is the service's shortfall, not the user's.
  const service = buildPaymentError(counterpartyError('Insufficient balance'), { context: 'withdraw' });
  assert.deepEqual([service.reasonSource, service.reasonAttribution], ['upstream', 'Reported by the withdrawal service']);
  assert.equal(buildPaymentError(new Error('insufficient funds'), { context: 'transfer' }).reasonAttribution, null, 'an internal transfer pays from the user\'s wallet');
});


test('"Reported by" names a party only for text that party sent', () => {
  const server = buildPaymentError(counterpartyError('Amount is above the maximum', 'Invoice request failed'), { context: 'payment' });
  assert.deepEqual([server.reason, server.reasonSource, server.reasonAttribution], ['Amount is above the maximum', 'upstream', 'Reported by the recipient']);
  // Text of unknown origin (a wallet SDK, BuhoGO itself) is shown, unlabelled.
  for (const context of ['payment', 'transfer', 'connect', 'kiosk', 'link']) {
    const e = buildPaymentError(new Error('Route not found'), { context });
    assert.deepEqual([e.reason, e.reasonSource, e.reasonAttribution], ['Route not found', 'passthrough', null], context);
  }
  // A server that gave no reason leaves our own fallback, unmarked.
  const silent = counterpartyError('  ', 'Invoice request failed');
  assert.deepEqual([silent.message, isCounterpartyError(silent)], ['Invoice request failed', false]);
  // Rebuilding an error (to scrub or translate it) keeps the mark.
  assert.equal(isCounterpartyError(keepOrigin(counterpartyError('Card limit reached'), new Error('Kartenlimit erreicht'))), true);
  assert.equal(isCounterpartyError(keepOrigin(new Error('ours'), new Error('ours'))), false);
});

test('a wallet that is already connected is said by BuhoGO, in every language', () => {
  const e = buildPaymentError(Object.assign(new Error('This LNBits wallet is already connected'), { code: 'WALLET_ALREADY_CONNECTED' }), { context: 'connect' });
  assert.deepEqual([e.title, e.reason, e.reasonSource, e.reasonAttribution], [ADD_REFUSED_TITLE, 'This wallet is already connected.', 'curated', null]);
  for (const messages of [de, es]) {
    assert.ok(messages['This wallet is already connected.'] && messages['This wallet is already connected.'] !== 'This wallet is already connected.');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
