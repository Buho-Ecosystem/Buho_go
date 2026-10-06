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
    'quasar/wrappers': { boot: (callback) => callback },
    quasar: { Notify: { create: (n) => notices.push(n) } },
    '@capacitor/core': { Capacitor: { isNativePlatform: () => true } },
    '@capacitor/app': { App: {
      addListener: (name, fn) => { listeners[name] = fn; },
      getLaunchUrl: async () => launchUrl ? { url: launchUrl } : null,
    } },
    '../services/addressRequestIntake.js': { offerAddressRequest: () => false },
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
  assert.deepEqual(h.walletStore.pendingDeepLink, { data: 'maria@mybuho.de', type: 'lightning_address' });
  assert.deepEqual(h.pushes, ['/wallet']);
});

for (const cold of [true, false]) {
  test(`shared-profile invoice survives ${cold ? 'cold' : 'warm'} native app handoff`, async () => {
    const invoice = profileInvoiceFixture();
    const uri = invoiceAppIntent(invoice).split('#')[0].replace(/^intent:/, 'lightning:');
    const h = harness({ activeWallet: { id: 'w' }, launchUrl: cold ? uri : null });
    await h.start();
    if (!cold) h.open(uri);
    assert.deepEqual(h.walletStore.pendingDeepLink, { type: 'lightning_invoice', data: invoice });
    assert.deepEqual(h.pushes, ['/wallet']);
    assert.equal(h.notices.length, 0);
  });
}

test('kiosk mode still blocks card links', async () => {
  const h = harness({ kiosk: true });
  await h.start();
  h.open(`nostr:${NPUB}`);
  assert.equal(h.pushes.length, 0);
});
