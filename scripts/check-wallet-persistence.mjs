/**
 * Saved wallets survive a reload on any screen. A device holds a Spark
 * wallet and settings the person changed, then reloads:
 *
 *   - on every setup, restore and first-load route the wallet store is
 *     loaded at first paint, and nothing tries to save before that;
 *   - an LNbits wallet added through the real form after a reload on its
 *     setup screen joins the Spark wallet, and every setting stays;
 *   - a kiosk device stays locked to the kiosk, with its PIN and wallet;
 *   - Spark or Arkade setup opened again with that wallet already saved goes
 *     to the wallet instead of making a second one.
 *
 * Start `npm run dev -- --port 9016` (or set WALLET_PERSISTENCE_BASE_URL),
 * then run `node scripts/check-wallet-persistence.mjs`. Every host except the
 * dev server is blocked; the LNbits server is a stand-in, so no keys or
 * money are involved. Screenshots land in output/wallet-persistence/.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.WALLET_PERSISTENCE_BASE_URL || 'http://localhost:9016';
const output = 'output/wallet-persistence';
await mkdir(output, { recursive: true });

const STORE_KEY = 'buhoGO_wallet_store';
const DEVICE_KEY = 'buhoGO_device_key';
const LNBITS_HOST = 'lnbits.example';

// A returning install: a device key and the envelope it sealed, made by the
// app's own device crypto. The phrase is the public BIP39 test vector. A
// stand-in envelope would read as an install still on the old PIN encryption
// and open the PIN upgrade instead.
const keyStore = new Map();
globalThis.localStorage = { getItem: (key) => keyStore.get(key) ?? null, setItem: (key, value) => keyStore.set(key, String(value)), removeItem: (key) => keyStore.delete(key) };
const { encryptString } = await import('../src/utils/deviceCrypto.js');
const envelope = await encryptString('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const deviceKey = keyStore.get(DEVICE_KEY);

const spark = {
  id: 'spark-main', type: 'spark', name: 'Wallet', createdAt: 1001, isActive: true, isDefault: true,
  connectionData: { accountNumber: 1, network: 'MAINNET', encryptedMnemonic: envelope },
  metadata: { sparkAddress: 'spark1main', hasBackedUp: true, cachedBalance: 21000 },
};
const arkade = {
  id: 'arkade-main', type: 'arkade', name: 'Arkade', createdAt: 1002, isActive: true, isDefault: true,
  connectionData: { encryptedMnemonic: envelope, arkServerUrl: 'https://ark.example', network: 'bitcoin' },
  metadata: { hasBackedUp: true },
};
// Settings the person changed: a reload must never put the defaults back.
const settings = { preferredFiatCurrency: 'EUR', useBip177Format: false, balanceHidden: true, biometricsEnabled: true, kioskTipValues: [7, 14, 21] };
const device = (wallets = [spark], extra = {}) => ({
  balanceSchemaVersion: 1, wallets, activeWalletId: wallets[0].id, sparkModelVersion: 2, hasBackedUp: true, ...settings, ...extra,
});
const ROUTES = [
  '/', '/spark-setup', '/arkade-setup', '/restore', '/spark-restore', '/arkade-restore', '/nwc-setup', '/lnbits-setup',
  '/wallet', '/settings', '/security', '/about', '/spend', '/identity', '/identity/identities', '/transactions',
  '/address-book', '/p/alice',
];

const browser = await chromium.launch({ headless: true });
const errors = [];

/** The LNbits API the form talks to: one wallet, no Lightning address extension. */
function fakeLnbits(route, url) {
  if (url.pathname === '/api/v1/wallet') return route.fulfill({ json: { id: 'kitty-wallet', name: 'Kitty', balance: 2100000 } });
  return route.fulfill({ status: 404, json: { detail: 'Not found' } });
}

/**
 * A browser tab on a device that saved `seed` with its device key. The seed
 * is written once per tab, so a reload sees what the app itself saved. Under
 * the audit flag the app skips Spark connects and the automatic setup, and
 * records whether the wallet store was loaded when the app first painted.
 */
async function open(seed, { audit = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const refused = [];
  // Without the audit flag every boot task runs offline; its noise is shown,
  // not judged.
  page.on('pageerror', (error) => (audit ? errors.push(error.message) : console.warn(`page error (${seed.wallets[0].type} setup): ${error.message}`)));
  page.on('console', (message) => {
    if (/nothing was saved|Refusing to persist/i.test(message.text())) refused.push(message.text().slice(0, 300));
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
    if (url.hostname === LNBITS_HOST) return fakeLnbits(route, url);
    return route.abort();
  });
  await page.routeWebSocket('**', (socket) => { if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close(); });
  await page.addInitScript(({ seed, audit, key, deviceKeyName, deviceKey }) => {
    if (audit) {
      window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
      new MutationObserver((_, observer) => {
        if (!document.querySelector('#q-app')?.children.length) return;
        observer.disconnect();
        const store = window.__audit?.app?.config.globalProperties.$pinia?._s.get('wallet');
        window.__firstPaint = store
          ? { hydrated: store.hydrated, loaded: store.savedStateLoaded, wallets: store.wallets.map((w) => w.id), fiat: store.preferredFiatCurrency }
          : null;
      }).observe(document, { childList: true, subtree: true });
    }
    if (sessionStorage.getItem('wallet-persistence-seeded')) return;
    sessionStorage.setItem('wallet-persistence-seeded', '1');
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem(deviceKeyName, deviceKey);
    localStorage.setItem(key, JSON.stringify(seed));
  }, { seed, audit, key: STORE_KEY, deviceKeyName: DEVICE_KEY, deviceKey });
  return { page, refused, close: () => context.close() };
}

/** page.evaluate, once more when a redirect replaced the document meanwhile. */
async function evaluate(page, fn, arg) {
  try {
    return await page.evaluate(fn, arg);
  } catch (error) {
    if (!/context was destroyed|navigat/i.test(error.message)) throw error;
    await page.waitForLoadState('load');
    return page.evaluate(fn, arg);
  }
}

/**
 * page.reload, once more when the app navigated meanwhile and cut it short (a
 * redirect, or chunk recovery reloading after a lazy import failed while the
 * dev server was still compiling the route).
 */
async function reload(page) {
  try {
    await page.reload();
  } catch (error) {
    if (!/ERR_ABORTED|interrupted by another navigation/i.test(error.message)) throw error;
    await page.waitForLoadState('load');
    await page.reload();
  }
}

const firstPaint = async (page) => {
  await page.waitForFunction(() => window.__firstPaint !== undefined);
  return evaluate(page, () => window.__firstPaint);
};
const saved = (page) => evaluate(page, (key) => JSON.parse(localStorage.getItem(key)), STORE_KEY);
const storeState = (page) => evaluate(page, async () => {
  const { useWalletStore } = await import('/src/stores/wallet.js');
  const store = useWalletStore();
  return { kioskEnabled: store.kioskEnabled, kioskOwnerAccess: store.kioskOwnerAccess };
});
const settingsOf = (state) => Object.fromEntries(Object.keys(settings).map((key) => [key, state[key]]));
const shot = (page, name) => page.screenshot({ path: `${output}/${name}.png` });
const at = (page, hash) => page.waitForFunction((value) => location.hash === value || location.hash.startsWith(`${value}?`), hash);

try {
  // ---- Every first-load route: loaded at first paint, nothing saved over it --
  for (const route of ROUTES) {
    const { page, refused, close } = await open(device());
    await page.goto(`${base}/#${route}`);
    await firstPaint(page);
    await reload(page);
    const first = await firstPaint(page);
    assert.ok(first, `${route}: the wallet store is readable at first paint`);
    assert.equal(first.hydrated && first.loaded, true, `${route}: loaded before the first paint`);
    assert.deepEqual(first.wallets, [spark.id], `${route}: the saved Spark wallet is there`);
    assert.equal(first.fiat, 'EUR', `${route}: the saved settings are there`);
    const state = await saved(page);
    assert.deepEqual(state.wallets.map((w) => w.id), [spark.id], `${route}: no wallet added or dropped`);
    assert.deepEqual(state.wallets[0].connectionData, spark.connectionData, `${route}: the recovery phrase is kept`);
    assert.deepEqual(settingsOf(state), settings, `${route}: every setting is kept`);
    assert.deepEqual(refused, [], `${route}: nothing tried to save before the load`);
    if (route === '/lnbits-setup' || route === '/spark-restore') await shot(page, `reload${route.replace('/', '-')}`);
    await close();
  }
  console.log(`PASS: ${ROUTES.length} routes reloaded; the store was loaded at first paint and the saved wallets and settings were kept`);

  // ---- LNbits through the real form, straight after a reload ---------------
  {
    const { page, refused, close } = await open(device());
    await page.goto(`${base}/#/lnbits-setup`);
    await firstPaint(page);
    // The reload a browser may do on its own while the admin key is copied.
    await reload(page);
    await firstPaint(page);
    await page.getByPlaceholder('https://your.lnbits.server').fill(`https://${LNBITS_HOST}`);
    await page.getByPlaceholder('Paste your admin key here').fill('stand-in-admin-key');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    const add = page.getByRole('button', { name: 'Add Wallet', exact: true });
    await add.waitFor();
    await add.click();
    await at(page, '#/wallet');
    const state = await saved(page);
    assert.deepEqual(state.wallets.map((w) => `${w.type}:${w.name}`), ['spark:Wallet', 'lnbits:Kitty'], 'the LNbits wallet joins the Spark wallet');
    assert.deepEqual(state.wallets[0].connectionData, spark.connectionData, 'the Spark recovery phrase is kept');
    assert.deepEqual(settingsOf(state), settings, 'every setting is kept');
    assert.deepEqual(refused, []);
    await page.waitForTimeout(400);
    await shot(page, 'lnbits-added-after-reload');
    await close();
  }
  console.log('PASS: an LNbits wallet added after a reload on its setup screen joins the saved Spark wallet');

  // ---- Kiosk device ---------------------------------------------------------
  {
    const { page, close } = await open(device([spark], { kioskEnabled: true, kioskPin: '2468', kioskWalletId: spark.id, kioskTipEnabled: true }));
    await page.goto(`${base}/#/settings`);
    await at(page, '#/kiosk');
    await reload(page);
    await firstPaint(page);
    await at(page, '#/kiosk');
    assert.deepEqual(await storeState(page), { kioskEnabled: true, kioskOwnerAccess: false }, 'still locked to the kiosk');
    const state = await saved(page);
    assert.equal(state.kioskPin, '2468');
    assert.equal(state.kioskWalletId, spark.id);
    assert.equal(state.kioskTipEnabled, true);
    assert.deepEqual(settingsOf(state), settings);
    await page.waitForTimeout(400);
    await shot(page, 'kiosk-after-reload');
    await close();
  }
  console.log('PASS: a kiosk device reloads into the kiosk with its PIN, wallet and tips kept');

  // ---- Setup opened again with the wallet already saved ---------------------
  // Without the audit flag, so the pages really try to create a wallet.
  for (const [route, wallet] of [['/spark-setup', spark], ['/arkade-setup', arkade]]) {
    const { page, close } = await open(device([wallet]), { audit: false });
    await page.goto(`${base}/#${route}`);
    await at(page, '#/wallet');
    const state = await saved(page);
    assert.deepEqual(state.wallets.map((w) => w.id), [wallet.id], `${route}: no second wallet`);
    assert.deepEqual(state.wallets[0].connectionData, wallet.connectionData, `${route}: its recovery phrase is kept`);
    const needsPinMigration = await evaluate(page, async () => {
      const { useWalletStore } = await import('/src/stores/wallet.js');
      const store = useWalletStore();
      await store.initialize();
      return store.needsPinMigration;
    });
    assert.equal(needsPinMigration, false, `${route}: a returning install, not one still on the old PIN encryption`);
    await page.waitForTimeout(400);
    await shot(page, `reopened${route.replace('/', '-')}`);
    await close();
  }
  console.log('PASS: Spark and Arkade setup opened again with the wallet saved go to the wallet');

  const unexpected = errors.filter((e) => !/Failed to fetch|ERR_FAILED|fiat rates|NetworkError/i.test(e));
  assert.deepEqual(unexpected, [], 'no page errors');
} finally {
  await browser.close();
}
