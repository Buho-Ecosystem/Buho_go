/** Controlled browser check for incoming payments of the wallets the app
 * watches by payment (docs/INCOMING_PAYMENTS.md): the Arkade Receive sheet
 * confirms only a receipt of its own wallet that arrived while it was open,
 * the app-wide announcement then stays quiet, and a burst of receipts from
 * one catch-up adds up instead of showing only the last. Start
 * `npx quasar dev --port 9415` first (or set DETECT_BASE_URL). Every external
 * request is blocked; receipts are put in the wallet store the way the
 * receipt ledger delivers them. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.DETECT_BASE_URL || 'http://localhost:9415';
const output = process.env.DETECT_OUTPUT || new URL('../output/incoming-detection/check', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const WALLETS = [
  { id: 'ark', name: 'Arkade', type: 'arkade', balance: 50000, metadata: {}, connectionData: {} },
  { id: 'shop', name: 'Shop', type: 'lnbits', balance: 906645, metadata: {}, connectionData: {} },
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

async function open() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) => { const u = new URL(r.request().url()); return u.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname) ? r.continue() : r.abort(); });
  await page.routeWebSocket('**', (s) => { if (new URL(s.url()).host === new URL(base).host) s.connectToServer(); else s.close(); });
  await page.addInitScript(() => {
    window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buho-theme-mode', 'light');
  });
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
    window.__store = store;
    // What paymentReceiptsApp.deliverReceipt writes for one receipt.
    window.__receive = (receipt) => { store.lastReceipt = { at: Date.now(), paymentHash: null, settledWhileAway: false, ...receipt }; };
    window.__home = () => { let c = document.querySelector('.q-page').__vueParentComponent; while (c && !('showReceiveModal' in (c.proxy || {}))) c = c.parent; return c.proxy; };
  }, WALLETS);
  await page.waitForTimeout(1200);
  lastPage = page;
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${output}/${name}.png` }); console.log('shot', name); };
const pass = (name) => console.log('  ✓', name);
const received = (page) => page.locator('.app-toast', { hasText: 'Bitcoin received' });

// 1. The Arkade Receive sheet takes only its own wallet's new receipts.
{
  const page = await open();
  await page.evaluate(() => { window.__home().showReceiveModal = true; });
  await page.waitForTimeout(1500);

  // Another wallet's payment: the app says so, the sheet keeps waiting.
  await page.evaluate(() => window.__receive({ walletId: 'shop', amountSats: 21, paymentId: 'shop-1' }));
  await received(page).first().waitFor();
  assert.match(await received(page).first().innerText(), /Shop/);
  assert.equal(await page.locator('.payment-confirmation').count(), 0, 'the sheet did not confirm another wallet\'s payment');
  pass('another wallet\'s payment is a toast; the sheet keeps waiting');

  // A receipt from before the sheet opened (a late catch-up): not this sheet's.
  await page.evaluate(() => window.__receive({ walletId: 'ark', amountSats: 5, paymentId: 'old', at: Date.now() - 60000 }));
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.payment-confirmation').count(), 0, 'an older receipt does not confirm the sheet');
  pass('a receipt from before the sheet opened does not confirm it');

  // Its own wallet's payment: the sheet confirms, with that payment's amount, and only once.
  const toastsBefore = await received(page).count();
  await page.evaluate(() => window.__receive({ walletId: 'ark', amountSats: 777, paymentId: 'ark-1' }));
  const amount = page.locator('.payment-confirmation .amount-value').first();
  await amount.waitFor();
  await page.waitForTimeout(900);
  assert.match(await amount.innerText(), /777/);
  assert.equal(await page.locator('.payment-confirmation').count(), 1, 'one confirmation, not the sheet\'s and the app\'s');
  assert.equal(await received(page).filter({ hasText: '777' }).count(), 0, 'no toast repeats it');
  assert.ok((await received(page).count()) <= toastsBefore);
  await shot(page, '01-arkade-sheet-confirms');
  pass('its own payment confirms the sheet with its amount, announced once');
  await page.close();
}

// 2. One catch-up reporting three payments of one wallet: they add up.
{
  const page = await open();
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/settings'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.__receive({ walletId: 'shop', amountSats: 10, paymentId: 'b1' });
    window.__receive({ walletId: 'shop', amountSats: 20, paymentId: 'b2' });
    window.__receive({ walletId: 'shop', amountSats: 30, paymentId: 'b3' });
  });
  await received(page).first().waitFor();
  await page.waitForTimeout(600);
  assert.equal(await received(page).count(), 1, 'one toast for the wallet');
  assert.match(await received(page).first().innerText(), /\b60\b/, 'all three counted, not only the last');
  await shot(page, '02-burst-adds-up');
  pass('three payments in one catch-up add up to ₿ 60 in one toast');
  await page.close();
}

assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
await browser.close();
console.log('✓ incoming detection check passed');
