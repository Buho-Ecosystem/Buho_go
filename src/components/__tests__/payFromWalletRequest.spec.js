/**
 * ReceiveModal: the request "Pay from another wallet" hands over, and the
 * kind it shows apps for before there is one.
 *
 *   node --test src/components/__tests__/payFromWalletRequest.spec.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../ReceiveModal.vue', import.meta.url), 'utf8');
const { code } = transformSync(source.match(/<script>([\s\S]*?)<\/script>/)[1], { format: 'cjs' });
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(() => ({}), module, module.exports);
const { payFromWalletRequest, payFromWalletKind } = module.exports.default.computed;

const INVOICE = 'LNBC210U1PJEXAMPLE';
const UNIFIED = 'bitcoin:bc1qexample?amount=0.00021&ark=ark1example';

test('an invoice with an amount goes over as a lower-case lightning: link', () => {
  const vm = { generatedInvoice: { amount: 21000, payment_request: INVOICE }, showArkadeUnifiedView: false };
  assert.equal(payFromWalletRequest.call(vm), 'lightning:lnbc210u1pjexample');
});

test('nothing to hand over without an amount', () => {
  assert.equal(payFromWalletRequest.call({ generatedInvoice: null }), '');
  assert.equal(payFromWalletRequest.call({ generatedInvoice: { amount: 0, payment_request: INVOICE } }), '', 'an amountless invoice');
});

test('Arkade without an invoice hands over its unified Bitcoin request', () => {
  const vm = { generatedInvoice: { amount: 21000 }, showArkadeUnifiedView: true, arkadeUnifiedQrValue: UNIFIED };
  assert.equal(payFromWalletRequest.call(vm), UNIFIED);
  assert.equal(payFromWalletRequest.call({ ...vm, showArkadeUnifiedView: false }), '', 'no invoice and no unified view: nothing');
});

test('before the amount, the apps shown are for the request to come', () => {
  assert.equal(payFromWalletKind.call({ isArkadeWallet: false }), 'lightning');
  assert.equal(payFromWalletKind.call({ isArkadeWallet: true }), 'bitcoin');
});
