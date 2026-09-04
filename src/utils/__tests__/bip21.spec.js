/** BIP21 destination-selection coverage, including BOLT12 safety handling. */

import { strict as assert } from 'node:assert';
import { bech32m } from 'bech32';
import {
  parseBip21,
  selectBip21Destination,
  composeUnifiedBip21,
  bip21AmountToSats,
} from '../bip21.js';

const VALID_BOLT12_OFFER = bech32m.encode('lno', [1, 2, 3, 4, 5, 6], 4096);

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

test('BIP21 lno= is selected before the on-chain fallback', () => {
  const parsed = parseBip21(`bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?lno=${VALID_BOLT12_OFFER.toUpperCase()}`);
  assert.deepEqual(selectBip21Destination(parsed), {
    kind: 'bolt12_offer',
    value: VALID_BOLT12_OFFER.toUpperCase(),
    bip21: parsed,
  });
});

test('BIP21 keeps a payable BOLT11 invoice ahead of an offer', () => {
  const parsed = parseBip21(`bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?lightning=lnbc10n1pjxyz&lno=${VALID_BOLT12_OFFER}`);
  assert.equal(selectBip21Destination(parsed).kind, 'lightning_invoice');
});

test('BIP21 ignores an invalid lno= value and keeps the on-chain fallback', () => {
  const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
  const parsed = parseBip21(`bitcoin:${address}?lno=lno1incomplete`);
  assert.equal(selectBip21Destination(parsed).kind, 'bitcoin_address');
});

test('unified BIP21 carries every rail in order', () => {
  assert.equal(
    composeUnifiedBip21({
      address: 'bc1qabc',
      lightning: 'lnbc1xyz',
      spark: 'spark1pgss',
      ark: 'ark1qqel',
      amountSats: 16667,
    }),
    'bitcoin:bc1qabc?amount=0.00016667&lightning=lnbc1xyz&spark=spark1pgss&ark=ark1qqel'
  );
});

test('unified BIP21 amounts are BTC with trimmed zeros', () => {
  assert.ok(composeUnifiedBip21({ address: 'a', amountSats: 100000000 }).endsWith('?amount=1'));
  assert.ok(composeUnifiedBip21({ address: 'a', amountSats: 150000000 }).endsWith('?amount=1.5'));
  // Amountless request: no amount param at all, never amount=0.
  assert.equal(composeUnifiedBip21({ address: 'a', lightning: 'ln' }), 'bitcoin:a?lightning=ln');
});

test('unified BIP21 degrades and never fabricates', () => {
  assert.equal(composeUnifiedBip21({ address: '' }), '');
  assert.equal(composeUnifiedBip21({ address: 'bc1qabc' }), 'bitcoin:bc1qabc');
});

test('unified BIP21 round-trips through our own parser', () => {
  const uri = composeUnifiedBip21({
    address: 'bc1qabc',
    lightning: 'lnbc1xyz',
    spark: 'spark1pgss',
    ark: 'ark1qqel',
    amountSats: 21000,
  });
  const parsed = parseBip21(uri);
  assert.equal(parsed.address, 'bc1qabc');
  assert.equal(parsed.lightning, 'lnbc1xyz');
  assert.equal(parsed.params.spark, 'spark1pgss');
  assert.equal(parsed.params.ark, 'ark1qqel');
  assert.equal(parsed.amount, '0.00021');
});

test('bip21AmountToSats parses digit-precise and rejects the unusable', () => {
  assert.equal(bip21AmountToSats('0.00016667'), 16667);
  assert.equal(bip21AmountToSats('1'), 100000000);
  assert.equal(bip21AmountToSats('1.5'), 150000000);
  assert.equal(bip21AmountToSats('0.00021'), 21000);
  assert.equal(bip21AmountToSats('0'), null);
  assert.equal(bip21AmountToSats(''), null);
  assert.equal(bip21AmountToSats('0.000000001'), null); // sub-sat precision
  assert.equal(bip21AmountToSats('-1'), null);
  assert.equal(bip21AmountToSats('1e-4'), null);
  assert.equal(bip21AmountToSats(null), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
