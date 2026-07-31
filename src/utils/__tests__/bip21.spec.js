/** BIP21 destination-selection coverage, including BOLT12 safety handling. */

import { strict as assert } from 'node:assert';
import { bech32m } from 'bech32';
import { parseBip21, selectBip21Destination } from '../bip21.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
