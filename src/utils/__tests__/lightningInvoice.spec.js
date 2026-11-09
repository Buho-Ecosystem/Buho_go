import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bech32 } from 'bech32';
import { parseLightningInvoice } from '../lightningInvoice.js';
import { parseBip21, selectBip21Destination, bip21AmountToSats } from '../bip21.js';

// The reported QR's actual regtest invoice. Decoding requires no network calls.
const REGTEST_INVOICE = 'lnbcrt45190n1p42dta6pp5g4ncw5dxn8qc4q5py4xwehshxfvfqqm5fl85rp5yef4act4x03lsdzu2pskjepqw3hjq3zf2dgycs2eyp2y2565ypz9y56gf9r9ggpgfaexgetjypy5gw3qgdfj6v3sxgmrqwf3xvknqvps8y5scqzzsxqzuysp5esvpf02e8wlpsttednes9nl4p30k30adw3mu8a63q3yvhyfjqayq9qxpqysgqq8mwenpwd8t07qu9y5ev0ngh98xhxssxfxyp89qupqnu47tgf8gqk2zvd8n3jf4fv922jceyqc5uzefxry0lvnp7xcckzxar8l8uxlqpht6qxr';
const URI = 'bitcoin:bcrt1qfgy50zuakl4c6cmxzzhw38dr523ej5l9zf3fvd?amount=0.00004519&lightning=' + REGTEST_INVOICE;

test('reported BIP21 QR selects Lightning and decodes 4,519 sats', () => {
  const bip21 = parseBip21(URI);
  const destination = selectBip21Destination(bip21);
  assert.equal(destination.kind, 'lightning_invoice');
  const decoded = parseLightningInvoice(destination.value);
  assert.equal(decoded.amount, 4519);
  assert.equal(decoded.amount, bip21AmountToSats(bip21.amount));
  assert.equal(decoded.invoice, REGTEST_INVOICE);
  assert.equal(decoded.description, 'Paid to DISPLAY TEST DRSHIFT (Order ID: CS-20260913-0009)');
  const timestamp = bech32.decode(REGTEST_INVOICE, 4096).words.slice(0, 7)
    .reduce((value, word) => value * 32 + word, 0);
  assert.equal(decoded.expiry, timestamp + 900);
});

test('Lightning amount remains authoritative when BIP21 amount differs or is absent', () => {
  for (const amount of ['amount=1&', '']) {
    const destination = selectBip21Destination(parseBip21(`bitcoin:?${amount}lightning=${REGTEST_INVOICE}`));
    assert.equal(parseLightningInvoice(destination.value).amount, 4519);
  }
});

test('uppercase and lightning: wrappers preserve the amount', () => {
  assert.equal(parseLightningInvoice(`  LIGHTNING:${REGTEST_INVOICE.toUpperCase()}  `).amount, 4519);
});

// Re-encoded HRPs exercise display decoding only; these synthetic variants
// have valid checksums, but are not re-signed and must never be paid.
const words = bech32.decode(REGTEST_INVOICE, 4096).words;
test('network prefixes and all BOLT11 amount units decode correctly', () => {
  for (const network of ['lnbc', 'lntb', 'lntbs', 'lnbcrt']) {
    for (const [amount, sats] of [['1', 100000000], ['1m', 100000], ['1u', 100], ['45190n', 4519], ['45190000p', 4519], ['', 0]]) {
      const invoice = bech32.encode(network + amount, words, 4096);
      assert.equal(parseLightningInvoice(invoice).amount, sats, network + amount);
    }
  }
});

test('malformed invoices fail instead of being displayed as amountless', () => {
  assert.throws(() => parseLightningInvoice(REGTEST_INVOICE.slice(0, -1) + 'q'));
  assert.throws(() => parseLightningInvoice('lnbc45190n1invalid'));
  assert.throws(() => parseLightningInvoice(''));
});
