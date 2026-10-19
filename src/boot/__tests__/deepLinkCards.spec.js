import * as kioskIntake from '../../services/kioskPaymentIntake.js';
/**
 * src/boot/deep-links.js wiring (issue #301).
 *
 * nostr:npub / nostr:nprofile open the card screen, with or without a wallet,
 * instead of the pay sheet or "Please set up a wallet first". Payment links
 * keep their path. A second tap on the same link, later, is handled.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as routing from '../../utils/deepLinkRouting.js';
import * as nwcIntake from '../../services/nwcConnectionIntake.js';
import { invoiceAppIntent } from '../../utils/publicProfilePayment.js';
import { profileInvoiceFixture } from '../../../scripts/fixtures/profileInvoice.mjs';

const NPUB = 'npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7';
const NPROFILE = 'nprofile1qqsw308nsgmxj3zdpdy663wk2zyx8mulmpgq5ad47g94n2l044dpgnchl3h4r';

function harness({ activeWallet = null, kiosk = false, launchUrl = null } = {}) {
  const listeners = {};
  const pushes = [];
  const notices = [];
  let clock = 10_000;
  const walletStore = { activeWallet, kioskEnabled: kiosk, kioskOwnerAccess: false, pendingDeepLink: null };
  const dependencies = {
    '../services/kioskPaymentIntake.js': kioskIntake,
    './i18n': { i18n: { global: { t: (key) => `t:${key}` } } },
    'quasar/wrappers': { boot: (callback) => callback },
    quasar: { Notify: { create: (n) => notices.push(n) } },
    '@capacitor/core': { Capacitor: { isNativePlatform: () => true } },
    '@capacitor/app': { App: {
      addListener: (name, fn) => { listeners[name] = fn; },
      getLaunchUrl: async () => launchUrl ? { url: launchUrl } : null,
    } },
    '../services/addressRequestIntake.js': { offerAddressRequest: () => false },
    '../services/nwcConnectionIntake.js': nwcIntake,
    '../providers/WalletFactory': {
      parsePaymentDestination: (input) => (input.startsWith('lightning:')
        ? { valid: true, type: input.startsWith('lightning:ln') ? 'lightning_invoice' : 'lightning_address', data: input.slice('lightning:'.length) }
        : { valid: false, type: 'unknown' }),
    },
    '../stores/wallet': { useWalletStore: () => walletStore },
    '../utils/walletHydration': { triggerWalletStoreHydration: () => {} },
    '../utils/nostrLookup': { classifyIdentifier: () => null },
    '../utils/deepLinkRouting': {
      cardRouteForDeepLink: routing.cardRouteForDeepLink,
      createDeepLinkDeduper: () => routing.createDeepLinkDeduper({ now: () => clock }),
    },
    '../utils/logRedaction': { redactPaymentInput: () => '(redacted)' },
  };
  const { code } = transformSync(readFileSync(new URL('../deep-links.js', import.meta.url), 'utf8'), {
    format: 'cjs', supported: { 'dynamic-import': false },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(name in dependencies, name); return dependencies[name];
  }, module, module.exports);
  const router = {
    currentRoute: { value: { path: '/' } },
    push: (to) => { pushes.push(to); return Promise.resolve(); },
  };
  return {
    pushes, notices, walletStore,
    start: () => module.exports.default({ router }),
    open: (url) => listeners.appUrlOpen({ url }),
    advance: (ms) => { clock += ms; },
  };
}

for (const id of [NPUB, NPROFILE]) {
  test(`nostr:${id.slice(0, 9)}… opens the card, even with no wallet`, async () => {
    const h = harness();
    await h.start();
    h.open(`nostr:${id}`);
    assert.deepEqual(h.pushes, [{ path: `/p/${id}`, query: {} }]);
    assert.equal(h.notices.length, 0, 'no "Please set up a wallet first"');
    assert.equal(h.walletStore.pendingDeepLink, null, 'no pay sheet');
  });
}

test('a repeated tap on the same link is handled once the short window passes', async () => {
  const h = harness();
  await h.start();
  h.open(`nostr:${NPUB}`);
  h.advance(100);
  h.open(`nostr:${NPUB}`); // the same intent delivered twice
  assert.equal(h.pushes.length, 1);
  h.advance(routing.DEEP_LINK_DEDUPE_MS);
  h.open(`nostr:${NPUB}`);
  assert.equal(h.pushes.length, 2);
});

test('a lightning link still goes to the payment path', async () => {
  const h = harness({ activeWallet: { id: 'w' } });
  await h.start();
  h.open('lightning:maria@mybuho.de');
  // The link as it came rides along (rawInput), for the merchant check.
  assert.deepEqual(h.walletStore.pendingDeepLink, { data: 'maria@mybuho.de', type: 'lightning_address', rawInput: 'lightning:maria@mybuho.de' });
  assert.deepEqual(h.pushes, ['/wallet']);
});

for (const cold of [true, false]) {
  test(`shared-profile invoice survives ${cold ? 'cold' : 'warm'} native app handoff`, async () => {
    const invoice = profileInvoiceFixture();
    const uri = invoiceAppIntent(invoice).split('#')[0].replace(/^intent:/, 'lightning:');
    const h = harness({ activeWallet: { id: 'w' }, launchUrl: cold ? uri : null });
    await h.start();
    if (!cold) h.open(uri);
    assert.deepEqual(h.walletStore.pendingDeepLink, { type: 'lightning_invoice', data: invoice, rawInput: uri });
    assert.deepEqual(h.pushes, ['/wallet']);
    assert.equal(h.notices.length, 0);
  });
}

test('a wallet connection link opens the connect sheet, even with no wallet', async () => {
  const connection = `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&secret=${'5e'.repeat(32)}`;
  const h = harness();
  await h.start();
  h.open(connection);
  assert.deepEqual(h.pushes, ['/nwc-setup'], 'the secret is not in the route');
  assert.equal(nwcIntake.takeNwcConnection(), connection);
  assert.equal(h.walletStore.pendingDeepLink, null, 'not a payment');
  assert.equal(h.notices.length, 0);
});

test('kiosk mode blocks wallet connection links', async () => {
  const h = harness({ kiosk: true });
  await h.start();
  h.open(`nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Fr.example&secret=${'5e'.repeat(32)}`);
  assert.deepEqual(h.pushes, []);
  assert.equal(nwcIntake.takeNwcConnection(), '');
});

test('kiosk mode still blocks card links', async () => {
  const h = harness({ kiosk: true });
  await h.start();
  h.open(`nostr:${NPUB}`);
  assert.equal(h.pushes.length, 0);
});

test('what a link cannot do is said in the person\'s language', async () => {
  const unknown = harness({ activeWallet: { id: 'w' } });
  await unknown.start();
  unknown.open('ftp://example.com/file');
  assert.deepEqual(unknown.notices.map((n) => n.message), ["t:BuhoGO can't open this link"]);

  const noWallet = harness();
  await noWallet.start();
  noWallet.open('lightning:maria@mybuho.de');
  assert.deepEqual(noWallet.notices.map((n) => [n.message, n.caption]), [['t:Set up a wallet first', 't:Payment links need a wallet.']]);
});
