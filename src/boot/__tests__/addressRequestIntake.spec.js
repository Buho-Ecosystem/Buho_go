import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { bech32 } from 'bech32';
import { isAddressRequest } from '../../utils/lud23.js';
import { addressRequestState, createAddressRequestSession } from '../../utils/addressRequestSession.js';

const url = `https://game.example/request?tag=addressRequest&k1=${'a'.repeat(64)}`;
const encoded = bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), 4096);
const direct = `lightning:addressRequest?callback=https%3A%2F%2Fgame.example%2Fshare&k1=${'a'.repeat(64)}&description=Rewards`;

function harness(file, launchInput, kiosk = false) {
  const listeners = {};
  let foregroundScan;
  let pending = launchInput;
  const state = addressRequestState();
  const session = createAddressRequestSession({ state, allowed: () => !kiosk,
    prepare: async () => {}, snapshot: () => ({ identity: 'alice', address: 'alice@example.com' }),
    resolve: async () => assert.fail('must wait for unlock'), submit: () => assert.fail('must await consent'),
  });
  const dependencies = {
    'quasar/wrappers': { boot: callback => callback },
    quasar: { Notify: { create: () => assert.fail('sharing must not hit a payment error') } },
    '@capacitor/core': { Capacitor: { isNativePlatform: () => true } },
    '@capacitor/app': { App: {
      addListener: (name, fn) => { listeners[name] = fn; },
      getLaunchUrl: async () => ({ url: launchInput }),
    } },
    '../services/addressRequestIntake.js': { offerAddressRequest: input => {
      if (!isAddressRequest(input)) return false;
      session.open(input);
      return true;
    } },
    '../providers/WalletFactory': { parsePaymentDestination: () => assert.fail('sharing must precede payment parsing') },
    '../stores/wallet': { useWalletStore: () => ({ activeWallet: null, kioskEnabled: kiosk }) },
    '../utils/walletHydration': { triggerWalletStoreHydration: () => assert.fail('must not connect wallets for sharing') },
    '../utils/nostrLookup': { classifyIdentifier: () => null },
    '../utils/profileLink': { profileLinkRoute: () => null },
    '../utils/logRedaction': { redactPaymentInput: () => '(redacted)' },
    '../utils/nfc': {
      addNfcListener: callback => { foregroundScan = callback; }, addNfcErrorListener: () => {}, isNfcAvailable: async () => true,
      consumePendingNfcScan: async () => { const raw = pending; pending = null; return raw ? { raw, source: 'system_dispatch' } : null; },
    },
  };
  const { code } = transformSync(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    format: 'cjs', supported: { 'dynamic-import': false },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, name); return dependencies[name];
  }, module, module.exports);
  return { state, session, listeners,
    start: () => module.exports.default({ router: { push: () => assert.fail('must preserve the current page') } }),
    tap: input => foregroundScan(input), setPending: input => { pending = input; },
  };
}

for (const input of [url, direct, `lightning:${encoded.toUpperCase()}`]) {
  test(`native link queues once without a wallet: ${input.slice(0, 30)}`, async () => {
    const h = harness('deep-links.js', input);
    await h.start(); await Promise.resolve();
    assert.equal(h.state.stage, 'waiting');
    h.listeners.appUrlOpen({ url: input });
    assert.equal(h.state.stage, 'waiting');
    h.session.close(); h.listeners.appUrlOpen({ url: input });
    assert.equal(h.state.stage, 'waiting', 'declined request can be explicitly reopened');
  });
}

test('NFC cold buffer, foreground taps, and resumed buffer use the same consent session', async () => {
  const h = harness('nfc.js', direct);
  await h.start(); assert.equal(h.state.stage, 'waiting');
  h.tap(direct); assert.equal(h.state.stage, 'waiting');
  h.session.close(); h.tap(url); assert.equal(h.state.stage, 'waiting');
  h.session.close(); h.setPending(encoded); await h.listeners.resume();
  assert.equal(h.state.stage, 'waiting');
});

test('kiosk rejects both native entry points without retaining a request', async () => {
  for (const file of ['deep-links.js', 'nfc.js']) {
    const h = harness(file, direct, true); await h.start(); await Promise.resolve();
    assert.equal(h.state.stage, 'idle');
  }
});
