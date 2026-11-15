/** Controlled browser check for Bitcoin that arrives in a wallet other than
 * the active one (#434, #435): the Switch Wallet pill, the Manage Wallets
 * line, the toast's chevron and the wallet named on the Home screen. Start
 * `npx quasar dev --port 9412` first (or set INCOMING_BASE_URL). Every
 * external request is blocked; receipts are put in the wallet store the way
 * the Spark lifecycle does. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.INCOMING_BASE_URL || 'http://localhost:9412';
const output = process.env.INCOMING_OUTPUT || new URL('../output/received-elsewhere/check', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const WALLETS = [
  { id: 'w1', name: 'Daily', type: 'spark', balance: 48250, metadata: {}, connectionData: {} },
  { id: 'w2', name: 'Savings', type: 'spark', balance: 128, metadata: {}, connectionData: {} },
  { id: 'w3', name: 'Shop', type: 'lnbits', balance: 906645, metadata: {}, connectionData: {} },
];
const browser = await chromium.launch({ headless: true });
const errors = [];
let lastPage = null;
process.on('uncaughtException', async (error) => {
  console.error(error);
  if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  if (errors.length) console.error('page errors:', errors.join('\n'));
  process.exit(1);
});

async function open(theme = 'light', { keepStorage = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) => { const u = new URL(r.request().url()); return u.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname) ? r.continue() : r.abort(); });
  await page.routeWebSocket('**', (s) => { if (new URL(s.url()).host === new URL(base).host) s.connectToServer(); else s.close(); });
  await page.addInitScript(({ theme, keepStorage }) => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buho-theme-mode', theme);
    if (keepStorage) for (const [key, value] of Object.entries(keepStorage)) localStorage.setItem(key, value);
  }, { theme, keepStorage });
  await page.goto(`${base}/#/wallet`, { timeout: 180000 });
  await page.waitForFunction(() => window.__audit?.app, null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  await page.evaluate((wallets) => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    const now = Date.now();
    store.wallets = wallets;
    store.activeWalletId = wallets[0].id;
    store.balanceStates = Object.fromEntries(wallets.map((w) => [w.id, { value: w.balance, source: 'provider', verifiedAt: now, updatedAt: now, refreshing: false, error: null }]));
    store.connectionStates = Object.fromEntries(wallets.map((w) => [w.id, { connected: true }]));
    store.preferredFiatCurrency = 'EUR';
    store.exchangeRates = { ...store.exchangeRates, eur: 75446 };
    store.exchangeRatesAvailable = true;
    import('/src/utils/fiatRates.js').then(({ fiatRatesService }) => {
      Object.assign(fiatRatesService, { rates: { EUR: 75446 }, ratesAvailable: true, lastUpdate: new Date() });
    });
    window.__store = store;
    window.__unseen = () => window.__audit.app.config.globalProperties.$pinia._s.get('unseenReceipts').entries;
    window.__receive = (receipt) => { store.lastReceipt = { walletId: 'w2', at: Date.now(), paymentId: null, paymentHash: null, settledWhileAway: false, ...receipt }; };
    window.__go = (path) => window.__audit.app.config.globalProperties.$router.push(path);
    window.__path = () => window.__audit.app.config.globalProperties.$router.currentRoute.value.fullPath;
    window.__home = () => { let c = document.querySelector('.q-page').__vueParentComponent; while (c && !('showWalletSwitcher' in (c.proxy || {}))) c = c.parent; return c.proxy; };
  }, WALLETS);
  await page.waitForTimeout(1200);
  lastPage = page;
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(900); await page.screenshot({ path: `${output}/${name}.png` }); console.log('shot', name); };
const pass = (name) => console.log('  ✓', name);
const openSwitcher = async (page) => {
  // The page refreshes every wallet on open; without providers that settles at once.
  await page.evaluate(() => { window.__home().openWalletManagement().catch(() => {}); });
  await page.locator('.wallet-switcher-card').waitFor();
  await page.waitForTimeout(600);
};

// 1. Home, nothing open, money for Savings: the screen names the wallet.
{
  const page = await open();
  await page.evaluate(() => window.__receive({ amountSats: 13, paymentId: 'tx1' }));
  await page.locator('.amount-label', { hasText: 'Bitcoin received' }).waitFor();
  assert.match(await page.locator('.recipient-line').innerText(), /to Savings/);
  await shot(page, '01-home-screen-to-savings');
  assert.deepEqual(await page.evaluate(() => window.__unseen()), { w2: await page.evaluate(() => window.__unseen().w2) });
  assert.equal((await page.evaluate(() => window.__unseen())).w2.sats, 13);
  pass('Home screen says "to Savings" and Savings is marked unseen');

  // Closing the screen leaves the mark: the user has not looked at Savings.
  await page.locator('.confirmation-backdrop').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(900);
  await openSwitcher(page);
  const pill = page.locator('[data-wallet-id="w2"] .switch-unseen-pill');
  assert.match(await pill.innerText(), /\+ ₿ 13/);
  assert.equal(await page.locator('[data-wallet-id="w1"] .switch-unseen-pill').count(), 0);
  await shot(page, '02-switcher-pill');
  pass('Switch Wallet shows "+ ₿ 13" on Savings only');

  // Switching to Savings is looking at it.
  await page.locator('[data-wallet-id="w2"]').click();
  await page.waitForTimeout(1200);
  assert.deepEqual(await page.evaluate(() => window.__unseen()), {});
  await openSwitcher(page);
  assert.equal(await page.locator('.switch-unseen-pill').count(), 0);
  await shot(page, '03-switcher-after-switch');
  pass('switching to Savings clears the mark');
  await page.close();
}

// 2. The mark survives a restart; dark switcher and Manage Wallets show it.
{
  let page = await open('dark');
  await page.evaluate(() => window.__go('/settings'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__receive({ amountSats: 13, paymentId: 'tx2' }));
  const toast = page.locator('.app-toast', { hasText: 'Bitcoin received' });
  await toast.waitFor();
  assert.equal(await toast.locator('.app-toast__chevron').count(), 1);
  assert.match(await toast.innerText(), /Savings/);
  await shot(page, '04-settings-toast-chevron-dark');
  pass('the toast names Savings and shows the chevron');
  const saved = await page.evaluate(() => ({ buhoGO_unseen_receipts_v1: localStorage.getItem('buhoGO_unseen_receipts_v1') }));
  assert.ok(saved.buhoGO_unseen_receipts_v1);
  await page.close();

  page = await open('dark', { keepStorage: saved });
  assert.equal((await page.evaluate(() => window.__unseen())).w2.sats, 13);
  await openSwitcher(page);
  await shot(page, '05-switcher-pill-dark');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__go('/settings?section=wallets'));
  await page.locator('[data-wallet-id="w2"] .row-sub-unseen').waitFor();
  assert.match(await page.locator('[data-wallet-id="w2"] .row-sub-unseen').innerText(), /\+ ₿ 13/);
  await shot(page, '06-manage-wallets-dark');
  pass('after a restart the mark is still on Savings, in the switcher and in Manage Wallets');
  await page.close();
}

// 3. Several payments: the tap switches to Savings and opens History.
{
  const page = await open();
  await page.evaluate(() => window.__go('/settings'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__receive({ amountSats: 13, paymentId: 'tx3' }));
  await page.evaluate(() => window.__receive({ amountSats: 7, paymentId: 'tx4' }));
  const toast = page.locator('.app-toast', { hasText: 'Bitcoin received' });
  await toast.waitFor();
  assert.match(await toast.innerText(), /₿ 20/);
  // No Breez here: the switch's connect is a no-op, as it is for a live Spark wallet.
  await page.evaluate(() => { window.__store.connectSparkWallet = async () => {}; window.__store.persistState = async () => {}; });
  await page.locator('.app-toast__tap-dismiss').click();
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.__path()), '/transactions');
  assert.equal(await page.evaluate(() => window.__store.activeWalletId), 'w2');
  assert.deepEqual(await page.evaluate(() => window.__unseen()), {});
  pass('two payments: the tap makes Savings active and opens History; the mark is cleared');
  await page.close();
}

// 4. Money for the active wallet is never unseen; a Receive-sheet invoice is not either.
{
  const page = await open();
  await page.evaluate(() => window.__go('/settings'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__receive({ walletId: 'w1', amountSats: 500, paymentId: 'tx5' }));
  await page.waitForTimeout(600);
  await page.evaluate(() => import('/src/services/incomingPayments.js').then((m) => m.expectReceiveInvoice({ walletId: 'w2', paymentHash: 'abcd', amountSats: 300 })));
  await page.evaluate(() => window.__receive({ amountSats: 300, paymentId: 'tx6', paymentHash: 'abcd' }));
  await page.waitForTimeout(600);
  assert.deepEqual(await page.evaluate(() => window.__unseen()), {});
  pass('the active wallet and a Receive-sheet invoice leave no mark');
  await page.close();
}

await browser.close();
assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
console.log('all checks passed');
