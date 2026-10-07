import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { offerKioskPayment } from '../../services/kioskPaymentIntake.js';
const card = 'lnurlw://card.example/tap?p=ONE-TIME';
function load(file, dependencies) {
  const { code } = transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  return module.exports.default;
}
for (const delivery of ['foreground', 'cold', 'resume']) {
  test(`NFC ${delivery} hands card to locked kiosk without opening the wallet`, async () => {
    const store = { kioskEnabled: true, kioskOwnerAccess: false };
    let scan, resume, buffered = delivery === 'cold' ? { raw: card } : null;
    const pushes = [];
    const boot = load('../nfc.js', {
      'quasar/wrappers': { boot: fn => fn }, quasar: { Notify: { create: () => assert.fail('no warning expected') } },
      '@capacitor/core': { Capacitor: { isNativePlatform: () => true } },
      '@capacitor/app': { App: { addListener: (_, fn) => { resume = fn; } } },
      '../stores/wallet': { useWalletStore: () => store },
      '../services/kioskPaymentIntake.js': { offerKioskPayment },
      '../services/addressRequestIntake.js': { offerAddressRequest: () => false },
      '../providers/WalletFactory': { parsePaymentDestination: () => assert.fail('must not reach outgoing wallet flow') },
      '../utils/walletHydration': { triggerWalletStoreHydration() {} },
      '../utils/logRedaction': { redactPaymentInput: () => '[redacted]' },
      '../utils/nfc': {
        addNfcListener: fn => { scan = fn; }, addNfcErrorListener() {}, isNfcAvailable: async () => true,
        consumePendingNfcScan: async () => { const result = buffered; buffered = null; return result; },
      },
    });
    await boot({ router: { currentRoute: { value: { path: '/' } }, push: async path => pushes.push(path) } });
    if (delivery === 'foreground') scan(card);
    if (delivery === 'resume') { buffered = { raw: card }; await resume(); }
    assert.equal(store.pendingDeepLink.target, 'kiosk');
    assert.equal(store.pendingDeepLink.data, card);
    assert.deepEqual(pushes, ['/kiosk']);
    assert.equal(store.kioskOwnerAccess, false);
  });
}
test('locked kiosk rejects outgoing, login and profile inputs', () => {
  for (const input of ['lnbc123', 'alice@example.com', 'bitcoin:bc1qtest', 'nostr:npub123', 'lnurlp://pay.example/a', 'keyauth://login.example/a']) {
    const store = { kioskEnabled: true, kioskOwnerAccess: false };
    assert.equal(offerKioskPayment(input, store, {}), true);
    assert.equal(store.pendingDeepLink, undefined);
  }
});
test('owner mode retains the ordinary wallet path', () => {
  assert.equal(offerKioskPayment(card, { kioskEnabled: true, kioskOwnerAccess: true }, {}), false);
});
test('receiving cards does not weaken kiosk route restrictions, including cold start', () => {
  for (const hydrated of [true, false]) {
    let guard;
    const boot = load('../kiosk.js', {
      'quasar/wrappers': { boot: fn => fn },
      'stores/wallet': { useWalletStore: () => ({ kioskEnabled: hydrated, kioskOwnerAccess: false }) },
      'src/utils/walletHydration': { readPersistedWalletState: () => ({ kioskEnabled: true }) },
    });
    boot({ router: { beforeEach: fn => { guard = fn; } } });
    assert.equal(guard({ path: '/kiosk' }), true);
    for (const path of ['/wallet', '/settings', '/identity']) assert.deepEqual(guard({ path }), { path: '/kiosk' });
  }
});
