/**
 * services/walletApps: when "Wallet app on this phone" is offered, and how.
 *
 *   node --test src/services/__tests__/walletApps.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAST_PAYING_APP_KEY, createAmountWait, findPayingApps, findWalletApps, openPayingApp, sheetFollowsAmount, walletAppOffer } from '../walletApps.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36';

test('the app asks the system, with any connection request', async () => {
  let asked = '';
  const plugin = { handlers: async ({ url }) => { asked = url; return { apps: [{ name: 'Alby Go', packageName: 'com.getalby.mobile' }, { name: '' }] }; } };
  assert.deepEqual(await findWalletApps({ native: true, plugin }), [{ name: 'Alby Go', packageName: 'com.getalby.mobile' }]);
  assert.equal(asked, 'nostr+walletauth://');
});

test('the web cannot know, and a build without the check says so', async () => {
  assert.equal(await findWalletApps({ native: false }), null);
  assert.equal(await findWalletApps({ native: true, plugin: { handlers: async () => { throw new Error('not implemented'); } } }), null);
});

test('in the app: offered with the apps found, by name, once each', () => {
  const apps = [{ name: 'Alby Go' }, { name: 'Blitz Wallet' }, { name: 'Alby Go' }];
  assert.deepEqual(walletAppOffer({ apps, native: true, userAgent: ANDROID }), { mode: 'open', names: ['Alby Go', 'Blitz Wallet'] });
  assert.equal(walletAppOffer({ apps: [], native: true, userAgent: ANDROID }), null, 'none installed');
  assert.equal(walletAppOffer({ apps: null, native: true, userAgent: ANDROID }), null, 'cannot tell (no native check)');
});

test('on the web: only an Android browser, which gets BuhoGO for Android', () => {
  assert.deepEqual(walletAppOffer({ apps: null, native: false, userAgent: ANDROID }), { mode: 'get-app' });
  assert.equal(walletAppOffer({ apps: null, native: false, userAgent: IPHONE }), null);
  assert.equal(walletAppOffer({ apps: null, native: false, userAgent: DESKTOP }), null);
});

// ── Pay from another wallet ─────────────────────────────────────────────────

const INVOICE = 'lightning:lnbc210u1pjexample';
const BITCOIN_REQUEST = 'bitcoin:bc1qexample?amount=0.0004';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = String(value); }, data };
}

test('system (android): the apps the system names for the request, with their icons, picked last first', async () => {
  let asked = null;
  const plugin = {
    handlers: async (options) => {
      asked ??= options;
      return { apps: [
        { name: 'Phoenix', packageName: 'fr.acinq.phoenix.mainnet', icon: 'data:image/png;base64,AA' },
        { name: 'BlueWallet', packageName: 'io.bluewallet.bluewallet' },
        { name: '', packageName: 'no.name' },
      ] };
    },
  };
  const storage = memoryStorage({ [LAST_PAYING_APP_KEY]: 'io.bluewallet.bluewallet' });
  const apps = await findPayingApps(INVOICE, { platform: 'android', plugin, storage });
  assert.deepEqual(asked, { url: INVOICE, icons: true }, 'the request itself is asked about, so only apps that take it are named');
  assert.deepEqual(apps, [
    { id: 'io.bluewallet.bluewallet', name: 'BlueWallet', icon: '', link: INVOICE, packageName: 'io.bluewallet.bluewallet', lastUsed: true },
    { id: 'fr.acinq.phoenix.mainnet', name: 'Phoenix', icon: 'data:image/png;base64,AA', link: INVOICE, packageName: 'fr.acinq.phoenix.mainnet', lastUsed: false },
  ]);
});

test('catalog (ios): only the wallets that pay this kind are asked about, each by its own link', async () => {
  let asked = [];
  const plugin = { installed: async ({ urls }) => { asked = urls; return { installed: urls.filter((url) => /^(phoenix|bitkit):/.test(url)) }; } };
  const apps = await findPayingApps(INVOICE, { platform: 'ios', plugin, storage: memoryStorage() });
  assert.ok(asked.includes(`phoenix:${INVOICE}`));
  assert.ok(asked.includes(`bitkit://${INVOICE}`), 'a slashes-form wallet gets <scheme>://');
  assert.ok(!asked.some((url) => url.startsWith('lightning:')), 'a plain lightning: link is never asked about');
  assert.deepEqual(apps.map(({ id, link }) => ({ id, link })), [
    { id: 'bitkit', link: `bitkit://${INVOICE}` },
    { id: 'phoenix', link: `phoenix:${INVOICE}` },
  ]);
  assert.ok(apps.every((app) => app.icon.startsWith('/wallet-apps/')), 'the catalog logos');

  await findPayingApps(BITCOIN_REQUEST, { platform: 'ios', plugin, storage: memoryStorage() });
  assert.ok(!asked.some((url) => url.startsWith('phoenix:')), 'a wallet that pays invoices only is skipped for a Bitcoin request');
  assert.ok(asked.some((url) => url.startsWith('bluewallet:bitcoin:')));
});

test('catalog (ios): a web-link wallet is found by its schemes and opened app-only', async () => {
  const plugin = { installed: async ({ urls }) => ({ installed: urls.filter((url) => url === 'squarecash://') }) };
  const [cashApp] = await findPayingApps(INVOICE, { platform: 'ios', plugin, storage: memoryStorage() });
  assert.deepEqual({ id: cashApp.id, link: cashApp.link, appOnly: cashApp.appOnly }, {
    id: 'cash-app', link: 'https://cash.app/launch/lightning/lnbc210u1pjexample', appOnly: true,
  });
  let opened;
  await openPayingApp(cashApp, { plugin: { open: async (options) => { opened = options; return { opened: true }; } }, storage: memoryStorage() });
  assert.deepEqual(opened, { url: cashApp.link, appOnly: true }, 'never falls back to the browser');
});

test('system (android): a web-link wallet is found by its package, once, and never the browser beside it', async () => {
  const asked = [];
  const plugin = {
    handlers: async ({ url }) => {
      asked.push(url);
      if (url.startsWith('https:')) return { apps: [{ name: 'Chrome', packageName: 'com.android.chrome' }, { name: 'Cash App', packageName: 'com.squareup.cash' }] };
      return { apps: [{ name: 'Phoenix', packageName: 'fr.acinq.phoenix.mainnet' }] };
    },
  };
  const apps = await findPayingApps(INVOICE, { platform: 'android', plugin, storage: memoryStorage() });
  assert.deepEqual(apps.map(({ name, link, appOnly }) => ({ name, link, appOnly })), [
    { name: 'Cash App', link: 'https://cash.app/launch/lightning/lnbc210u1pjexample', appOnly: true },
    { name: 'Phoenix', link: INVOICE, appOnly: undefined },
  ]);

  const listsCashApp = { handlers: async () => ({ apps: [{ name: 'Cash App', packageName: 'com.squareup.cash' }] }) };
  const once = await findPayingApps(INVOICE, { platform: 'android', plugin: listsCashApp, storage: memoryStorage() });
  assert.deepEqual(once.map((app) => app.link), [INVOICE], 'already named for lightning:, so not added again');
  assert.deepEqual(await findPayingApps(BITCOIN_REQUEST, { platform: 'android', plugin: { handlers: async () => ({ apps: [] }) }, storage: memoryStorage() }), [], 'a web-link wallet that pays invoices only is not asked about for a Bitcoin request');
});

test('nothing to pay, the web, or a build without the plugin', async () => {
  const plugin = { handlers: async () => assert.fail('not asked'), installed: async () => assert.fail('not asked') };
  assert.deepEqual(await findPayingApps('', { platform: 'android', plugin }), []);
  assert.deepEqual(await findPayingApps('lnbc210u1p', { platform: 'android', plugin }), [], 'a bare invoice is not a link');
  assert.equal(await findPayingApps(INVOICE, { platform: 'web', plugin }), null);
  const missing = { handlers: async () => { throw new Error('not implemented'); }, installed: async () => { throw new Error('not implemented'); } };
  assert.equal(await findPayingApps(INVOICE, { platform: 'android', plugin: missing }), null);
  assert.equal(await findPayingApps(INVOICE, { platform: 'ios', plugin: missing }), null);
});

test('opening: the app\'s own link, pinned to its package when it has one; only an opened app is remembered', async () => {
  const opened = [];
  const plugin = { open: async (options) => { opened.push(options); return { opened: true }; } };
  const storage = memoryStorage();
  const phoenix = { id: 'fr.acinq.phoenix.mainnet', name: 'Phoenix', link: INVOICE, packageName: 'fr.acinq.phoenix.mainnet' };
  assert.equal(await openPayingApp(phoenix, { plugin, storage }), true);
  assert.deepEqual(opened.pop(), { url: INVOICE, packageName: 'fr.acinq.phoenix.mainnet' });
  assert.equal(storage.data[LAST_PAYING_APP_KEY], 'fr.acinq.phoenix.mainnet');

  const catalogApp = { id: 'phoenix', name: 'Phoenix', link: `phoenix:${INVOICE}` };
  assert.equal(await openPayingApp(catalogApp, { plugin, storage }), true);
  assert.deepEqual(opened.pop(), { url: `phoenix:${INVOICE}` });
  assert.equal(storage.data[LAST_PAYING_APP_KEY], 'phoenix');

  const closed = memoryStorage();
  assert.equal(await openPayingApp(phoenix, { plugin: { open: async () => ({ opened: false }) }, storage: closed }), false);
  assert.equal(await openPayingApp(phoenix, { plugin: { open: async () => { throw new Error('gone'); } }, storage: closed }), false);
  assert.equal(closed.data[LAST_PAYING_APP_KEY], undefined);
});

test('storage that throws (private mode) never breaks finding or opening', async () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const plugin = { handlers: async () => ({ apps: [{ name: 'Phoenix', packageName: 'p' }] }), open: async () => ({ opened: true }) };
  const [app] = await findPayingApps(INVOICE, { platform: 'android', plugin, storage: broken });
  assert.equal(app.lastUsed, false);
  assert.equal(await openPayingApp(app, { plugin, storage: broken }), true);
});

test('asked without an amount, the sheet follows the amount by itself, except where it waits for a tap', () => {
  assert.equal(sheetFollowsAmount('android'), true);
  assert.equal(sheetFollowsAmount('ios'), false);

  const follows = createAmountWait(true);
  assert.equal(follows.arrived('lightning:lnbc1'), false, 'never asked: an amount alone opens nothing');
  follows.ask();
  assert.equal(follows.arrived(''), false, 'still no amount: keeps waiting');
  assert.equal(follows.arrived('lightning:lnbc1'), true, 'the amount arrived: the sheet opens');
  assert.equal(follows.arrived('lightning:lnbc2'), false, 'once only');

  const waitsForTap = createAmountWait(false);
  waitsForTap.ask();
  assert.equal(waitsForTap.arrived('lightning:lnbc1'), false);
});

test('back from the amount without one, the wait is off', () => {
  const wait = createAmountWait(true);
  wait.ask();
  wait.rowShown('');
  assert.equal(wait.arrived('lightning:lnbc1'), false);
  wait.ask();
  wait.rowShown('lightning:lnbc1');
  assert.equal(wait.arrived('lightning:lnbc1'), true, 'the row coming back with an amount keeps it');
});
