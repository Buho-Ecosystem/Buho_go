import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bech32 } from 'bech32';
import { invoiceDescriptionHash, parseLightningInvoice } from '../lightningInvoice.js';
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

// BOLT11's own test vectors (11-payment-encoding.md, "Examples"): the hash
// is of the list of things the invoice is for, as the spec gives it.
const BOLT11_LIST_HASH = '3925b6f67e2c340036ed12093dd44e0368df1b6ea26c53dbe4811f58fd5db8c1';
const BOLT11_HASHED = 'lnbc20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqs9qrsgq7ea976txfraylvgzuxs8kgcw23ezlrszfnh8r6qtfpr6cxga50aj6txm9rxrydzd06dfeawfk6swupvz4erwnyutnjq7x39ymw6j38gp7ynn44';
const BOLT11_HASH_FIRST = 'lnbc20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygshp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqfppj3a24vwu6r8ejrss3axul8rxldph2q7z99qrsgqz6qsgww34xlatfj6e3sngrwfy3ytkt29d2qttr8qz2mnedfqysuqypgqex4haa2h8fx3wnypranf3pdwyluftwe680jjcfp438u82xqphf75ym';
const BOLT11_WITH_ROUTES = 'lnbc20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqsfpp3qjmp7lwpagxun9pygexvgpjdc4jdj85fr9yq20q82gphp2nflc7jtzrcazrra7wwgzxqc8u7754cdlpfrmccae92qgzqvzq2ps8pqqqqqqpqqqqq9qqqvpeuqafqxu92d8lr6fvg0r5gv0heeeqgcrqlnm6jhphu9y00rrhy4grqszsvpcgpy9qqqqqqgqqqqq7qqzq9qrsgqdfjcdk6w3ak5pca9hwfwfh63zrrz06wwfya0ydlzpgzxkn5xagsqz7x9j4jwe7yj7vaf2k9lqsdk45kts2fd0fkr28am0u4w95tt2nsq76cqw0';
const BOLT11_DONATION = 'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql';

test('the description hash is read wherever the invoice puts it', () => {
  for (const invoice of [BOLT11_HASHED, BOLT11_HASH_FIRST, BOLT11_WITH_ROUTES]) {
    assert.equal(invoiceDescriptionHash(invoice), BOLT11_LIST_HASH);
    assert.equal(invoiceDescriptionHash(invoice.toUpperCase()), BOLT11_LIST_HASH, 'a QR code may carry it in capitals');
    assert.equal(parseLightningInvoice(invoice).descriptionHash, BOLT11_LIST_HASH);
  }
});

test('an invoice with a plain description has no hash', () => {
  assert.equal(invoiceDescriptionHash(BOLT11_DONATION), null);
  assert.equal(parseLightningInvoice(BOLT11_DONATION).description, 'Please consider supporting this project');
  assert.equal(invoiceDescriptionHash(REGTEST_INVOICE), null);
});

test('nothing that cannot be read yields a hash', () => {
  for (const input of ['', 'lnbc1notaninvoice', null, undefined, 42, BOLT11_HASHED.slice(0, -1), BOLT11_HASHED.slice(0, 120)]) {
    assert.equal(invoiceDescriptionHash(input), null, String(input).slice(0, 20));
  }
});
