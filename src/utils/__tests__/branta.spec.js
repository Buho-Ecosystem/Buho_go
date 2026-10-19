import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrantaPaymentException, BrantaPaymentExceptionReason } from '@branta-ops/branta';
import {
  BRANTA_STATUS,
  brantaAvatar,
  brantaLookupText,
  checkWithBranta,
  clearBrantaCache,
  hasBrantaParams,
  normalizeBrantaResult,
} from '../branta.js';

const INVOICE = 'lnbc42u1pdemo7kaffeehauslindgren0flatwhite';
const ARK = 'ark1qdemoarkaddressxxxxxxxxxxxxxxxxxxxxxxxx';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ZK_CODE = `bitcoin:${ADDRESS}?amount=0.0001&branta_id=abc&branta_secret=def`;

const service = (answer) => ({
  calls: [],
  async getPaymentsByQrCode(text) {
    this.calls.push(text);
    if (answer instanceof Error) throw answer;
    return answer;
  },
});

test('Branta key parameters are found in any case, and only in a URI', () => {
  assert.equal(hasBrantaParams(ZK_CODE), true);
  assert.equal(hasBrantaParams(`bitcoin:${ADDRESS}?BRANTA_ID=a&Branta_Secret=b`), true);
  assert.equal(hasBrantaParams(`bitcoin:${ADDRESS}?branta_id=a`), false);
  assert.equal(hasBrantaParams(ADDRESS), false);
  assert.equal(hasBrantaParams(''), false);
});

test('what is checked: the whole code with a Branta key, else the invoice or Ark address', () => {
  assert.equal(brantaLookupText({ type: 'bitcoin_address', data: ADDRESS, rawInput: ZK_CODE }), ZK_CODE);
  // A code with a Branta key wins even when BuhoGO pays its Lightning part.
  assert.equal(brantaLookupText({ type: 'lightning_invoice', invoice: INVOICE, rawInput: `${ZK_CODE}&lightning=${INVOICE}` }), `${ZK_CODE}&lightning=${INVOICE}`);
  assert.equal(brantaLookupText({ type: 'lightning_invoice', invoice: `lightning:${INVOICE}` }), INVOICE);
  assert.equal(brantaLookupText({ type: 'arkade_address', arkadeAddress: ARK }), ARK);
});

test('a unified code without a Branta key is checked by the part that is paid', () => {
  const unified = `bitcoin:${ADDRESS}?amount=0.0001&lightning=${INVOICE}&ark=${ARK}`;
  assert.equal(brantaLookupText({ type: 'lightning_invoice', invoice: INVOICE, rawInput: unified }), INVOICE);
  assert.equal(brantaLookupText({ type: 'arkade_address', arkadeAddress: ARK, rawInput: unified }), ARK);
  // Paying the Spark or on-chain part: those cannot be checked, and the
  // invoice next to them proves nothing about them.
  assert.equal(brantaLookupText({ type: 'spark_address', data: 'sp1x', rawInput: unified }), null);
  assert.equal(brantaLookupText({ type: 'bitcoin_address', data: ADDRESS, rawInput: unified }), null);
});

test('nothing to check: plain addresses, Lightning addresses, Spark', () => {
  assert.equal(brantaLookupText({ type: 'bitcoin_address', data: ADDRESS, rawInput: ADDRESS }), null);
  assert.equal(brantaLookupText({ type: 'lightning_address', data: 'shop@example.com' }), null);
  assert.equal(brantaLookupText({ type: 'spark_address', data: 'sp1x' }), null);
  assert.equal(brantaLookupText(null), null);
});

test('the avatar uses the light-background logo, a dark plate only for a dark-only logo', () => {
  assert.deepEqual(brantaAvatar({ logoUrl: 'https://a/dark.png', logoLightUrl: 'https://a/light.png' }), { url: 'https://a/light.png', background: '' });
  assert.deepEqual(brantaAvatar({ logoUrl: 'https://a/dark.png' }), { url: 'https://a/dark.png', background: '#1A1A1C' });
  assert.equal(brantaAvatar({}), null);
});

test('only https links are kept, and an answer with nothing to show is none', () => {
  const verification = normalizeBrantaResult({
    payments: [{ platform: ' Kaffeehaus Lindgren ', platformLogoUrl: 'http://insecure/logo.png', platformLogoLightUrl: 'https://cdn/logo.png', description: 'Coffee' }],
    verifyUrl: 'https://guardrail.branta.pro/v2/verify/x',
  });
  assert.deepEqual(verification, {
    name: 'Kaffeehaus Lindgren',
    logoUrl: '',
    logoLightUrl: 'https://cdn/logo.png',
    description: 'Coffee',
    verifyUrl: 'https://guardrail.branta.pro/v2/verify/x',
  });
  assert.equal(normalizeBrantaResult({ payments: [{ platform: '' }], verifyUrl: 'javascript:alert(1)' }), null);
  assert.equal(normalizeBrantaResult({ payments: [] }), null);
});

test('a verified answer is remembered for the session', async () => {
  clearBrantaCache();
  const stub = service({ payments: [{ platform: 'Kaffeehaus Lindgren' }], verifyUrl: 'https://v/x' });
  const first = await checkWithBranta({ qrText: INVOICE, service: stub });
  const again = await checkWithBranta({ qrText: INVOICE, service: stub });
  assert.equal(first.status, BRANTA_STATUS.VERIFIED);
  assert.equal(first.verification.name, 'Kaffeehaus Lindgren');
  assert.equal(again, first);
  assert.equal(stub.calls.length, 1);
});

test('a changed code is told apart from a miss and never cached', async () => {
  clearBrantaCache();
  const stub = service(new BrantaPaymentException('mismatch', BrantaPaymentExceptionReason.Tampered));
  assert.deepEqual(await checkWithBranta({ qrText: ZK_CODE, service: stub }), { status: BRANTA_STATUS.TAMPERED });
  assert.deepEqual(await checkWithBranta({ qrText: ZK_CODE, service: stub }), { status: BRANTA_STATUS.TAMPERED });
  assert.equal(stub.calls.length, 2);
});

test('errors read as no answer: offline, no Web Crypto, strict-mode refusals', async () => {
  clearBrantaCache();
  for (const error of [
    new TypeError('Failed to fetch'),
    new BrantaPaymentException('no crypto', BrantaPaymentExceptionReason.CryptoUnavailable),
    new BrantaPaymentException('PrivacyMode.Strict does not permit plain-text lookups'),
  ]) {
    assert.deepEqual(await checkWithBranta({ qrText: INVOICE, service: service(error) }), { status: BRANTA_STATUS.NONE });
  }
  assert.deepEqual(await checkWithBranta({ qrText: '' }), { status: BRANTA_STATUS.NONE });
});
