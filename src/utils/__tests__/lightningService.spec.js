/**
 * The NWC payment service (utils/lightning.js) on the shared LNURL-pay path:
 * it reads and pays Lightning addresses and LNURLs the way every other wallet
 * type does, so a refusal keeps the service's reason and an invoice for any
 * other amount is never handed to the wallet.
 *
 * Run: node --test src/utils/__tests__/lightningService.spec.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { bech32 } from 'bech32';
import * as lightningTools from '@getalby/lightning-tools';
import * as addresses from '../addressUtils.js';
import * as lud23 from '../lud23.js';
import { isCounterpartyError } from '../errorOrigin.js';
import { PAY_REQUEST_ERROR } from '../lnurlPay.js';
import { buildPaymentError } from '../userErrors.js';
import { PAY_REQUEST, failed, fakeService, invoiceFor, lnurlPayWith, ok } from './lnurlPayFixtures.js';

/** The real service, asking through `get` and paying into `paid`. */
function serviceWith(...answers) {
  const { get, asked } = fakeService(...answers);
  const paid = [];
  const source = readFileSync(new URL('../lightning.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { format: 'cjs' });
  const module = { exports: {} };
  const dependencies = {
    './lud23.js': lud23,
    './addressUtils': addresses,
    './lnurlPay.js': lnurlPayWith(get),
    '@getalby/lightning-tools': lightningTools,
    bech32: { bech32 },
    '../services/nwcPayment.js': { payWithNwc: async (nwc, invoice) => { paid.push(invoice); return { preimage: 'ff' }; } },
  };
  new Function('require', 'module', 'exports', code)((name) => dependencies[name] || {}, module, module.exports);
  const service = new module.exports.LightningPaymentService({ walletId: 'nwc' });
  return { service, asked, paid };
}

const lnurl = (url) => bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), 1023);

test('reading an address keeps the pay request\'s terms', async () => {
  const { service, asked } = serviceWith(ok(PAY_REQUEST));
  const data = await service.processPaymentInput('alice@example.com');
  assert.equal(asked[0].url, 'https://example.com/.well-known/lnurlp/alice');
  assert.deepEqual(
    [data.type, data.address, data.callback, data.minSats, data.maxSats, data.commentAllowed, data.isFixedAmount],
    ['lightning_address', 'alice@example.com', PAY_REQUEST.callback, 1, 100000, 32, false],
  );
});

test('a refusal reaches the person in the service\'s words, not wrapped in ours', async () => {
  const { service } = serviceWith(failed(500, { status: 'ERROR', reason: 'User not found' }));
  const error = await service.processPaymentInput('alice@example.com').catch((e) => e);
  assert.equal(error.message, 'User not found');
  assert.equal(isCounterpartyError(error), true);
  assert.equal(buildPaymentError(error, { context: 'payment' }).reasonAttribution, 'Reported by the recipient');
});

test('an offline phone still reads as offline', async () => {
  const { service } = serviceWith(new TypeError('Failed to fetch'));
  const error = await service.processPaymentInput('alice@example.com').catch((e) => e);
  assert.equal(buildPaymentError(error, { context: 'payment' }).reason, "Couldn't reach the network. Please check your internet and try again.");
});

test('paying an address uses the pay request already read, and the invoice it asked for', async () => {
  const { service, asked, paid } = serviceWith(ok(PAY_REQUEST), ok({ pr: invoiceFor(21), successAction: { tag: 'message', message: 'Thanks' } }));
  const data = await service.processPaymentInput('alice@example.com');
  const result = await service.sendPayment(data, 21, 'hi');
  assert.equal(asked.length, 2, 'no second look-up');
  assert.equal(asked[1].url, `${PAY_REQUEST.callback}?amount=21000&comment=hi`);
  assert.deepEqual(paid, [invoiceFor(21)]);
  assert.deepEqual(result.successAction, { tag: 'message', message: 'Thanks' });
});

test('an invoice for another amount never reaches the wallet', async () => {
  const { service, paid } = serviceWith(ok(PAY_REQUEST), ok({ pr: invoiceFor(2100) }));
  const data = await service.processPaymentInput('alice@example.com');
  await assert.rejects(service.sendPayment(data, 21), (error) => error.code === PAY_REQUEST_ERROR.INVOICE_MISMATCH);
  assert.deepEqual(paid, []);
});

test('an amount outside the limits is never asked for', async () => {
  const { service, asked, paid } = serviceWith(ok({ ...PAY_REQUEST, minSendable: 50000 }));
  const data = await service.processPaymentInput('alice@example.com');
  await assert.rejects(service.sendPayment(data, 21), (error) => error.code === PAY_REQUEST_ERROR.AMOUNT_OUT_OF_RANGE && error.minSats === 50);
  assert.equal(asked.length, 1);
  assert.deepEqual(paid, []);
});

test('a payment read for another wallet type looks the address up first', async () => {
  const { service, asked, paid } = serviceWith(ok(PAY_REQUEST), ok({ pr: invoiceFor(5) }));
  await service.sendPayment({ type: 'lightning_address', address: 'alice@example.com', minSendable: 1000, maxSendable: 1e9 }, 5);
  assert.equal(asked[0].url, 'https://example.com/.well-known/lnurlp/alice');
  assert.deepEqual(paid, [invoiceFor(5)]);
});

test('an LNURL is decoded strictly, pays with the comment, and keeps a reusable link', async () => {
  const link = lnurl('https://shop.example/lnurlp/coffee');
  const { service, asked, paid } = serviceWith(ok(PAY_REQUEST), ok({ pr: invoiceFor(7), disposable: false }));
  const result = await service.sendPayment({ type: 'lnurl', data: link }, 7, 'two shots');
  assert.equal(asked[0].url, 'https://shop.example/lnurlp/coffee');
  assert.equal(asked[1].url, `${PAY_REQUEST.callback}?amount=7000&comment=two%20shots`);
  assert.deepEqual(paid, [invoiceFor(7)]);
  assert.equal(result.payLink, link);
});

test('an LNURL that points at plain http is never asked', async () => {
  const { service, asked } = serviceWith();
  await assert.rejects(service.sendPayment({ type: 'lnurl', data: lnurl('http://shop.example/lnurlp/coffee') }, 7), /Invalid LNURL/);
  assert.deepEqual(asked, []);
});
