/**
 * addressUtils — destination recognition + URI unwrapping tests.
 *
 * Coverage focus:
 *   - the predicate family (Spark / invoice / LNURL / Bitcoin / Lightning
 *     address) accepts the shapes the rest of the app relies on
 *   - normalizePaymentAddress unwraps the QR URI conventions (BIP21
 *     `bitcoin:`, `lightning:`) down to a bare identifier, and leaves
 *     everything else untouched
 *
 * Run directly with Node:
 *   node src/utils/__tests__/addressUtils.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  isSparkAddress,
  isLightningInvoice,
  isLnurl,
  isBitcoinAddress,
  isLightningAddress,
  normalizePaymentAddress,
  stripWrapperScheme,
} from '../addressUtils.js';

// A real LNURL-withdraw voucher (LNbits) reported from the field. It must be
// recognized whether bare, `lightning:`-wrapped, or `lnurl:`-wrapped — the
// last of which previously fell through to "Unsupported link format".
const FIELD_LNURL =
  'LNURL1DP68GURN8GHJ7MRWVF5HGUEWVFHHXTNPVSHHW6T5DPJ8YCTH9ASHQ6F0WCCJ7MRWW4EXCT6VTFG8QAN5XSUHZAT5VDXN2CTJF4ZX6A34FSHKKCTZTF6HGUP4GA8RWVN00FE42SMZVFFXK3S6XM7HC';

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

// ---------------------------------------------------------------------------
// Predicates (smoke coverage — the unwrapper leans on these)
// ---------------------------------------------------------------------------

test('isBitcoinAddress: accepts bech32 + base58, rejects junk', () => {
  assert.equal(isBitcoinAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), true);
  assert.equal(isBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), true);
  assert.equal(isBitcoinAddress('not-an-address'), false);
});

test('isLightningAddress: user@domain only', () => {
  assert.equal(isLightningAddress('alice@example.com'), true);
  assert.equal(isLightningAddress('bc1qsomething'), false);
});

test('isSparkAddress: new + legacy prefixes', () => {
  assert.equal(isSparkAddress('spark1abcdef'), true);
  assert.equal(isSparkAddress('sp1abcdef'), true);
  assert.equal(isSparkAddress('bc1qabc'), false);
});

test('isLightningInvoice / isLnurl: tolerate lightning: wrapper', () => {
  assert.equal(isLightningInvoice('lightning:lnbc10n1pjxyz'), true);
  assert.equal(isLnurl('lightning:lnurl1dp68'), true);
});

test('isLnurl: tolerates the lnurl: wrapper in any case (field regression)', () => {
  assert.equal(isLnurl(FIELD_LNURL), true);              // bare
  assert.equal(isLnurl(`lnurl:${FIELD_LNURL}`), true);   // lnurl: wrapper
  assert.equal(isLnurl(`LNURL:${FIELD_LNURL}`), true);   // uppercase scheme
  assert.equal(isLnurl(`lightning:${FIELD_LNURL}`), true);
});

// ---------------------------------------------------------------------------
// stripWrapperScheme — the single unwrap primitive every path now shares
// ---------------------------------------------------------------------------

test('stripWrapperScheme: removes lightning: / lnurl: case-insensitively', () => {
  assert.equal(stripWrapperScheme('lightning:lnbc10n1pjxyz'), 'lnbc10n1pjxyz');
  assert.equal(stripWrapperScheme(`lnurl:${FIELD_LNURL}`), FIELD_LNURL);
  assert.equal(stripWrapperScheme(`LNURL:${FIELD_LNURL}`), FIELD_LNURL);
  assert.equal(stripWrapperScheme('  lightning:lnbc1  '), 'lnbc1'); // trims both sides
});

test('stripWrapperScheme: leaves bare payloads and LUD-17 schemes untouched', () => {
  assert.equal(stripWrapperScheme(FIELD_LNURL), FIELD_LNURL);
  // LUD-17 schemes ARE the type — they must survive, not get clipped to `//…`.
  assert.equal(stripWrapperScheme('lnurlw://lnbits.bos.ad/x'), 'lnurlw://lnbits.bos.ad/x');
  assert.equal(stripWrapperScheme('lnurlp://v1.lnbits.de/lnurlp/3RXhUU'), 'lnurlp://v1.lnbits.de/lnurlp/3RXhUU');
  // The authority-style `lnurl://` alias must not lose its `//host`.
  assert.equal(stripWrapperScheme('lnurl://host/x'), 'lnurl://host/x');
});

test('stripWrapperScheme: non-strings → empty string', () => {
  assert.equal(stripWrapperScheme(null), '');
  assert.equal(stripWrapperScheme(undefined), '');
  assert.equal(stripWrapperScheme(42), '');
});

// ---------------------------------------------------------------------------
// normalizePaymentAddress — BIP21
// ---------------------------------------------------------------------------

test('BIP21: strips scheme + query, yields the on-chain address', () => {
  const addr = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
  assert.equal(
    normalizePaymentAddress(`bitcoin:${addr}?amount=0.001&label=Coffee`),
    addr,
  );
  // and the unwrapped value is still recognized as a Bitcoin address
  assert.equal(isBitcoinAddress(normalizePaymentAddress(`bitcoin:${addr}`)), true);
});

test('BIP21: case-insensitive scheme', () => {
  const addr = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
  assert.equal(normalizePaymentAddress(`BITCOIN:${addr}`), addr);
});

test('BIP21: percent-escapes in params do not corrupt the address', () => {
  const addr = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
  assert.equal(
    normalizePaymentAddress(`bitcoin:${addr}?label=Bob%20%26%20Co`),
    addr,
  );
});

test('BIP21: lightning-only QR has no on-chain address → empty', () => {
  // bitcoin:?lightning=… is a unified QR with no fallback address; we return
  // '' so the caller treats it as "nothing to save".
  assert.equal(normalizePaymentAddress('bitcoin:?lightning=lnbc10n1pjxyz'), '');
});

// ---------------------------------------------------------------------------
// normalizePaymentAddress — lightning: + passthrough
// ---------------------------------------------------------------------------

test('lightning: scheme is stripped', () => {
  assert.equal(normalizePaymentAddress('lightning:lnbc10n1pjxyz'), 'lnbc10n1pjxyz');
});

test('lightning: wrapper around an LNURL unwraps to a recognized LNURL', () => {
  const wrapped = 'lightning:LNURL1DP68GURN8GHJ7A339EKXUCNFW3EJUER99AKXUATJD3CZ7V6JTP5924GV0MDHZ';
  const bare = normalizePaymentAddress(wrapped);
  assert.equal(bare, 'LNURL1DP68GURN8GHJ7A339EKXUCNFW3EJUER99AKXUATJD3CZ7V6JTP5924GV0MDHZ');
  assert.equal(isLnurl(bare), true);
});

test('LUD-17 lnurlp:// passes through untouched and is recognized', () => {
  const lud17 = 'lnurlp://v1.lnbits.de/lnurlp/3RXhUU';
  assert.equal(normalizePaymentAddress(lud17), lud17);
  assert.equal(isLnurl(lud17), true);
});

test('lnurl: wrapper around an LNURL unwraps to a recognized LNURL', () => {
  const bare = normalizePaymentAddress(`lnurl:${FIELD_LNURL}`);
  assert.equal(bare, FIELD_LNURL);
  assert.equal(isLnurl(bare), true);
});

test('passthrough: bare address / npub / nostr URI returned trimmed, untouched', () => {
  assert.equal(normalizePaymentAddress('  alice@example.com  '), 'alice@example.com');
  assert.equal(normalizePaymentAddress('spark1abcdef'), 'spark1abcdef');
  assert.equal(normalizePaymentAddress('nostr:npub1xyz'), 'nostr:npub1xyz');
});

test('defensive: non-strings and empties → empty string', () => {
  assert.equal(normalizePaymentAddress(null), '');
  assert.equal(normalizePaymentAddress(undefined), '');
  assert.equal(normalizePaymentAddress(42), '');
  assert.equal(normalizePaymentAddress('   '), '');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
