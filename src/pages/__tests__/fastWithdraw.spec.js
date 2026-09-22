import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { bech32 } from 'bech32';
import * as withdraw from '../../utils/lnurlWithdraw.js';
import * as addresses from '../../utils/addressUtils.js';
import * as bip21 from '../../utils/bip21.js';
import * as lud4 from '../../utils/lud4.js';
import * as lnurlMetadata from '../../utils/lnurlMetadata.js';
import * as userErrors from '../../utils/userErrors.js';

// Execute the production Options-API methods, replacing provider/UI imports
// that these paths never use. IO is explicit so an accidental GET fails.
function evaluate(file, dependencies = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1] || source;
  const { code } = transformSync(script, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => dependencies[name] || {}, module, module.exports);
  return module.exports;
}
const lightning = evaluate('../../utils/lightning.js');
// Also run unchanged when testing the combined LUD-23 branch. Its intent
// parser remains real; provider and consent UI stay outside these tests.
const addressRequests = existsSync(new URL('../../utils/lud23.js', import.meta.url))
  ? evaluate('../../utils/lud23.js', { bech32: { bech32 } }) : {};
const factory = evaluate('../../providers/WalletFactory.js', {
  '../utils/addressUtils': addresses, '../utils/bip21': bip21,
  '../utils/lud23.js': addressRequests,
});
const metadata = { tag: 'withdrawRequest', k1: 'Voucher-A+B', callback: 'https://cash.example/Callback?session=KeepCase',
  minWithdrawable: 1000, maxWithdrawable: 25000, defaultDescription: 'Rewards for Alice@Example.com' };
const url = `https://cash.example/withdraw?${new URLSearchParams(metadata)}`;
const encoded = value => bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(value)), 16384);

function harness(get = () => assert.fail('unexpected network request')) {
  const calls = [];
  const component = evaluate('../Wallet.vue', {
    '../utils/lnurlWithdraw.js': withdraw, '../utils/addressUtils.js': addresses,
    '../utils/lud23.js': addressRequests,
    '../utils/lnurlMetadata.js': lnurlMetadata,
    '../utils/userErrors.js': userErrors,
    '../services/addressRequestIntake.js': { offerAddressRequest: input => {
      assert.notEqual(addressRequests.isAddressRequest?.(input), true, 'withdrawal must not enter address-sharing consent');
      return false;
    } },
    '../utils/lightning.js': lightning, '../utils/lud4.js': lud4,
    '../utils/lnurlHttp.js': { lnurlGetJson: async (...args) => { calls.push(args); return get(...args); } },
  }).default;
  const vm = { $t: text => text, ...component.methods, $refs: {},
    walletStore: { activeWalletType: 'spark' },
    // LUD-14: the page hands every resolved withdrawRequest to the voucher
    // store. Tracking is a side note to a withdrawal and must never be in its
    // way, so the stub records instead of asserting.
    withdrawVouchersStore: { tracked: [], track(info) { this.tracked.push(info); return Promise.resolve(null); } },
    preferNativeBip21Rail: data => data, runBrantaVerification() {}, runNostrRecipientEnrichment() {},
    resetWithdrawState() { this.lnurlWithdrawStatus = 'idle'; },
    failSendResolution() { assert.fail('valid withdrawal must reach review'); },
  };
  return { component, vm, calls };
}

for (const [name, input] of Object.entries({ bech32: encoded(url), lightning: `lightning:${encoded(url).toUpperCase()}`,
  wrapper: `lnurl:${encoded(url)}`, lud17: url.replace('https:', 'lnurlw:'), nfc: url })) {
  test(`${name} resolves inline with zero metadata GETs`, async () => {
    const { vm, calls } = harness();
    const result = await vm.fetchLNURLInfo(input);
    // LUD-14: the decoded link travels with the answer as `sourceUrl`.
    assert.deepEqual(result, withdraw.withdrawInfo(metadata, { sourceUrl: url })); assert.equal(calls.length, 0);
  });
}

test('missing/malformed parameters make exactly one normal GET and trust its result', async () => {
  for (const input of [url.replace('tag=withdrawRequest', 'tag=payRequest'), url.replace('minWithdrawable=1000', 'minWithdrawable=oops'), 'https://cash.example/ordinary']) {
    const { vm, calls } = harness(async endpoint => {
      assert.equal(endpoint, input); return { ok: true, data: { ...metadata, k1: 'server-authoritative' } };
    });
    assert.equal((await vm.fetchLNURLInfo(encoded(input))).k1, 'server-authoritative');
    assert.equal(calls.length, 1); assert.equal(calls[0][1].timeoutMs, 10000);
  }
});

test('fallback preserves endpoint errors and normal payment metadata', async () => {
  const h = harness(async () => ({ ok: true, data: { status: 'ERROR', reason: 'Expired voucher' } }));
  assert.deepEqual(await h.vm.fetchLNURLInfo('https://cash.example/ordinary'), { error: true, reason: 'Expired voucher' });
  const pay = harness(async () => ({ ok: true, data: { tag: 'payRequest', minSendable: 1000, maxSendable: 2000, callback: metadata.callback } }));
  const result = await pay.vm.fetchLNURLInfo('https://cash.example/pay');
  assert.equal(result.lnurlType, 'payRequest');
  assert.deepEqual(result.serviceMeta, lnurlMetadata.parsePayRequestMetadata(null));
});

test('all payment wallets open Redeem review without creating an invoice or submitting', async () => {
  for (const activeWalletType of ['spark', 'lnbits', 'nwc']) {
    const { vm, calls } = harness(); vm.walletStore.activeWalletType = activeWalletType;
    vm.createInvoiceForWithdraw = () => assert.fail('must await confirmation');
    vm.submitWithdrawCallback = () => assert.fail('must await confirmation');
    vm.pendingWithdrawTargetSats = 12;
    await vm.onPaymentDetected({ type: 'lnurl', data: encoded(url) });
    assert.equal(vm.showWithdrawSheet, true); assert.equal(vm.pendingPayment.type, 'lnurl_withdraw');
    assert.equal(vm.pendingPayment.receiveAmount, 12); assert.equal(vm.pendingWithdrawTargetSats, null);
    assert.equal(calls.length, 0);
  }
});

test('a balanceCheck link is remembered as a voucher, an ordinary withdraw link is not', async () => {
  const balanceCheck = 'https://cash.example/balance/abc';
  const voucherUrl = `https://cash.example/withdraw?${new URLSearchParams({ ...metadata, balanceCheck })}`;

  const voucher = harness();
  await voucher.vm.onPaymentDetected({ type: 'lnurl', data: encoded(voucherUrl) });
  assert.equal(voucher.vm.showWithdrawSheet, true);
  assert.equal(voucher.vm.withdrawVouchersStore.tracked.length, 1);
  assert.equal(voucher.vm.withdrawVouchersStore.tracked[0].balanceCheck, balanceCheck);

  // No balanceCheck: a one-shot code, tracked nowhere.
  const plain = harness();
  await plain.vm.onPaymentDetected({ type: 'lnurl', data: encoded(url) });
  assert.equal(plain.vm.showWithdrawSheet, true);
  assert.equal(plain.vm.withdrawVouchersStore.tracked[0].balanceCheck, null);
});

test('a balanceCheck pointing at another host is never stored', async () => {
  const foreign = `https://cash.example/withdraw?${new URLSearchParams({ ...metadata, balanceCheck: 'https://evil.example/balance/abc' })}`;
  const h = harness();
  await h.vm.onPaymentDetected({ type: 'lnurl', data: encoded(foreign) });
  assert.equal(h.vm.showWithdrawSheet, true, 'the withdrawal itself still works');
  assert.equal(h.vm.withdrawVouchersStore.tracked[0].balanceCheck, null);
});

test('zero and sub-satoshi-only bounds cannot pass the final confirmation guard', () => {
  const { component } = harness();
  for (const amount of [0, 500, 1500]) {
    const p = withdraw.withdrawInfo({ ...metadata, minWithdrawable: amount, maxWithdrawable: amount });
    assert.equal(component.computed.canConfirmWithdraw.call({ pendingPayment: { ...p, type: 'lnurl_withdraw' },
      lnurlWithdrawStatus: 'idle', withdrawAmountSats: p.fixedAmountSats }), false);
  }
});

test('LUD-17 requests containing @ retain case-sensitive values in dispatch', () => {
  // URLSearchParams normally escapes @; a URI may legally contain it literally.
  const input = url.replace('https:', 'lnurlw:').replace('%40', '@');
  const parsed = factory.parsePaymentDestination(input);
  assert.equal(parsed.type, 'lnurl'); assert.equal(parsed.lnurl, input);
  assert.equal(factory.parsePaymentDestination(url.replace('%40', '@')).type, 'unknown', 'HTTPS NFC must reach the URL fallback, not become an address');
});

test('callback still uses one 90-second request with the same challenge and invoice', async () => {
  const { vm, calls } = harness(async () => ({ ok: true, data: { status: 'OK' } }));
  await vm.submitWithdrawCallback(metadata, 'lnbc-fixture', null);
  assert.equal(calls.length, 1); assert.equal(calls[0][1].timeoutMs, 90000);
  const callback = new URL(calls[0][0]);
  assert.equal(callback.searchParams.get('k1'), metadata.k1);
  assert.equal(callback.searchParams.get('pr'), 'lnbc-fixture');
  assert.equal(callback.searchParams.get('session'), 'KeepCase');
});

for (const file of ['deep-links.js', 'nfc.js']) {
  test(`${file}: cold delivery buffers the intact withdrawal; locked kiosk discards it`, async () => {
    for (const kiosk of [false, true]) {
      const input = file === 'nfc.js' ? url.replace('%40', '@') : `lightning:${encoded(url)}`;
      const store = { activeWallet: { type: 'spark' }, kioskEnabled: kiosk, kioskOwnerAccess: false };
      const listeners = {};
      const boot = evaluate(`../../boot/${file}`, {
        'quasar/wrappers': { boot: fn => fn }, quasar: { Notify: { create: () => assert.fail('unexpected native intake warning') } },
        '@capacitor/core': { Capacitor: { isNativePlatform: () => true } },
        '@capacitor/app': { App: { getLaunchUrl: async () => ({ url: input }), addListener: (name, fn) => { listeners[name] = fn; } } },
        '../stores/wallet': { useWalletStore: () => store }, '../providers/WalletFactory': factory,
        '../utils/walletHydration': { triggerWalletStoreHydration() {} },
        '../utils/nostrLookup': { classifyIdentifier: () => null }, '../utils/profileLink': { profileLinkRoute: () => null },
        '../utils/logRedaction': { redactPaymentInput: () => '(redacted)' },
        '../services/addressRequestIntake.js': { offerAddressRequest: input => addressRequests.isAddressRequest?.(input) || false },
        '../utils/nfc': { addNfcListener() {}, addNfcErrorListener() {}, isNfcAvailable: async () => true,
          consumePendingNfcScan: async () => ({ raw: input, source: 'system_dispatch' }) },
      }).default;
      await boot({ router: { currentRoute: { value: { path: '/wallet' } }, push: async () => {} } });
      await Promise.resolve();
      if (kiosk) assert.equal(store.pendingDeepLink, undefined);
      else {
        assert.equal(store.pendingDeepLink.type, 'lnurl');
        const { vm, calls } = harness();
        // The NFC carrier is the raw URL with a literal @, so that is the sourceUrl it keeps.
        assert.deepEqual(await vm.fetchLNURLInfo(store.pendingDeepLink.data), withdraw.withdrawInfo(metadata, { sourceUrl: file === 'nfc.js' ? input : url }));
        assert.equal(calls.length, 0);
      }
    }
  });
}
