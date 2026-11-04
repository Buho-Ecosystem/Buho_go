/**
 * BuhoGO's payment link (buhogo://pay?request=…): a checkout's "BuhoGO"
 * entry opens BuhoGO with the request exactly as the checkout made it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { payLink, readPaymentLink } from '../paymentLink.js';

const INVOICE = 'lnbc168u1p5qypq9pp5abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz0123';
const BIP21 = `bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.0005&label=Corner%20Caf%C3%A9&lightning=${INVOICE}`;

await test('a link made for a request gives back exactly that request', () => {
  for (const request of [`lightning:${INVOICE}`, BIP21, 'lightning:maria@mybuho.de', `LIGHTNING:${INVOICE.toUpperCase()}`]) {
    const link = payLink('buhogo', request);
    assert.match(link, /^buhogo:\/\/pay\?request=[^&?]+$/, 'one encoded parameter');
    assert.deepEqual(readPaymentLink(link), { request });
  }
});

await test('the documented examples read as written', () => {
  assert.deepEqual(readPaymentLink(`buhogo://pay?request=lightning%3A${INVOICE}`), { request: `lightning:${INVOICE}` });
  assert.deepEqual(
    readPaymentLink(`buhogo://pay?request=${encodeURIComponent(BIP21)}`),
    { request: BIP21 },
  );
});

await test('the scheme and host are read in any case, with or without a slash', () => {
  for (const link of [
    `BUHOGO://PAY?request=lightning%3A${INVOICE}`,
    `buhogo://pay/?request=lightning%3A${INVOICE}`,
    ` buhogo://pay?request=lightning%3A${INVOICE}\n`,
  ]) {
    assert.deepEqual(readPaymentLink(link), { request: `lightning:${INVOICE}` }, link);
  }
});

await test('wallet lists that build links by prefix work too', () => {
  assert.deepEqual(readPaymentLink(`buhogo:lightning:${INVOICE}`), { request: `lightning:${INVOICE}` });
  assert.deepEqual(readPaymentLink(`buhogo://lightning:${INVOICE}`), { request: `lightning:${INVOICE}` });
  assert.deepEqual(readPaymentLink(`buhogo:${BIP21}`), { request: BIP21 });
  assert.deepEqual(readPaymentLink(`buhogo://${INVOICE}`), { request: INVOICE });
});

await test('a payment link without a readable request is refused, not guessed', () => {
  for (const link of [
    'buhogo://pay',
    'buhogo://pay?',
    'buhogo://pay?request=',
    'buhogo://pay?request=%20',
    'buhogo://pay?invoice=lnbc1',
    'buhogo://pay/lnbc1',
    'buhogo:',
    'buhogo://',
    // Not encoded: the BIP21 request comes apart at its own "&", and
    // reading the first part would drop the Lightning payment.
    `buhogo://pay?request=${BIP21}`,
    // A link inside a link: refused, not unwrapped a second time.
    `buhogo://pay?request=${encodeURIComponent('buhogo://pay?request=lightning%3Alnbc1')}`,
    'buhogo:buhogo:lightning:lnbc1',
    'buhogo://pay?request=BUHOGO%3Alnbc1',
  ]) {
    assert.deepEqual(readPaymentLink(link), { request: '' }, link);
  }
});

await test('an unencoded request that does not come apart still reads whole', () => {
  assert.deepEqual(readPaymentLink(`buhogo://pay?request=lightning:${INVOICE}`), { request: `lightning:${INVOICE}` });
});

await test('other links are not payment links', () => {
  for (const link of [
    'buhogo://nwc/connected?request=abc',
    'BUHOGO://NWC/connected?request=abc',
    `lightning:${INVOICE}`,
    BIP21,
    'https://go.mybuho.de/p/maria',
    'buhogoo://pay?request=lightning%3Alnbc1',
    '',
    null,
    undefined,
  ]) {
    assert.equal(readPaymentLink(link), null, String(link));
  }
});
