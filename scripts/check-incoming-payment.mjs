/** Controlled browser check for Bitcoin that arrives while the app is open
 * (IncomingPaymentHost). Start `npx quasar dev --port 9412` first (or set
 * INCOMING_BASE_URL). Every external request is blocked; receipts are put in
 * the wallet store the way the Spark lifecycle and the balance refresh do. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.INCOMING_BASE_URL || 'http://localhost:9412';
const output = process.env.INCOMING_OUTPUT || new URL('../output/incoming-payment/check', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const WALLET = { id: 'w1', name: 'Daily', type: 'spark', balance: 48250, metadata: {}, connectionData: {} };
const browser = await chromium.launch({ headless: true });
const errors = [];

async function open(theme = 'light') {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) => { const u = new URL(r.request().url()); return u.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname) ? r.continue() : r.abort(); });
  await page.routeWebSocket('**', (s) => { if (new URL(s.url()).host === new URL(base).host) s.connectToServer(); else s.close(); });
  await page.addInitScript((theme) => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buho-theme-mode', theme);
  }, theme);
  await page.goto(`${base}/#/wallet`, { timeout: 180000 });
  await page.waitForFunction(() => window.__audit?.app, null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  await page.evaluate((w) => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    const now = Date.now();
    store.wallets = [w];
    store.activeWalletId = w.id;
    store.balanceStates = { [w.id]: { value: w.balance, source: 'provider', verifiedAt: now, updatedAt: now, refreshing: false, error: null } };
    store.preferredFiatCurrency = 'EUR';
    store.exchangeRates = { ...store.exchangeRates, eur: 75446 };
    store.exchangeRatesAvailable = true;
    import('/src/utils/fiatRates.js').then(({ fiatRatesService }) => {
      Object.assign(fiatRatesService, { rates: { EUR: 75446 }, ratesAvailable: true, lastUpdate: new Date() });
    });
    window.__receive = (receipt) => { store.lastReceipt = { walletId: w.id, at: Date.now(), paymentId: null, paymentHash: null, settledWhileAway: false, ...receipt }; };
    window.__go = (path) => window.__audit.app.config.globalProperties.$router.push(path);
    window.__path = () => window.__audit.app.config.globalProperties.$router.currentRoute.value.fullPath;
  }, WALLET);
  await page.waitForTimeout(1200);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(900); await page.screenshot({ path: `${output}/${name}.png` }); console.log('shot', name); };
const toastText = (page) => page.locator('.app-toast').allInnerTexts();
const pass = (name) => console.log('  ✓', name);

// 1. Home, nothing open: the full screen; a second payment to the same wallet adds up.
{
  const page = await open();
  await page.evaluate(() => window.__receive({ amountSats: 2100, paymentId: 'tx1' }));
  await page.locator('.amount-label', { hasText: 'Bitcoin received' }).waitFor();
  await shot(page, '01-home-screen');
  await page.evaluate(() => window.__receive({ amountSats: 900, paymentId: 'tx2' }));
  await page.waitForTimeout(400);
  assert.match(await page.locator('.amount-value').innerText(), /3,000/);
  assert.deepEqual(await toastText(page), []);
  pass('Home shows the screen, and a second payment to the wallet adds up on it');
  await page.close();
}

// 2. Settings: the bottom toast; a tap opens the payment in Transaction details.
{
  const page = await open();
  await page.evaluate(() => window.__go('/settings'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__receive({ amountSats: 2100, paymentId: 'tx9' }));
  await page.locator('.app-toast', { hasText: 'Bitcoin received' }).waitFor();
  await shot(page, '02-settings-toast');
  assert.equal(await page.locator('.amount-label').count(), 0);
  await page.locator('.app-toast__tap-dismiss').click();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.__path()), '/transaction/tx9?wallet=w1');
  pass('Settings shows the toast; a tap opens /transaction/tx9 for its wallet');

  // A swipe dismisses it and opens nothing.
  await page.evaluate(() => window.__go('/settings'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__receive({ amountSats: 500, paymentId: 'tx10' }));
  const card = page.locator('.app-toast', { hasText: 'Bitcoin received' });
  await card.waitFor();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let dx = 0; dx <= 220; dx += 20) await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  assert.equal(await card.count(), 0);
  assert.equal(await page.evaluate(() => window.__path()), '/settings');
  pass('a swipe dismisses the toast and stays on Settings');
  await page.close();
}

// 3. Home with the Send sheet open: a toast, not the screen.
{
  const page = await open('dark');
  await page.evaluate(() => {
    let c = document.querySelector('.q-page').__vueParentComponent;
    while (c && !('showSendModal' in (c.proxy || {}))) c = c.parent;
    c.proxy.openSend();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__receive({ amountSats: 2100, paymentId: 'tx3' }));
  await page.locator('.app-toast', { hasText: 'Bitcoin received' }).waitFor();
  await shot(page, '03-home-send-open-toast-dark');
  assert.equal(await page.locator('.amount-label').count(), 0);
  pass('Home with the Send sheet open shows the toast, not the screen');
  await page.close();
}

// 4. A wallet that reports no payment id: the tap finds it in the wallet's history.
{
  const page = await open();
  await page.evaluate(() => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    const now = Math.floor(Date.now() / 1000);
    store.wallets = [{ ...store.wallets[0], type: 'nwc' }];
    store.providers = { w1: { getTransactions: async () => [
      { id: 'older', type: 'incoming', amount: 2100, settled_at: now - 7200 },
      { id: 'nwc-match', type: 'incoming', amount: 2100, settled_at: now - 40 },
    ] } };
  });
  await page.evaluate(() => window.__go('/settings'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__receive({ amountSats: 2100 }));
  await page.locator('.app-toast', { hasText: 'Bitcoin received' }).waitFor();
  await page.locator('.app-toast__tap-dismiss').click();
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => window.__path()), '/transaction/nwc-match?wallet=w1');
  pass('a balance-based receipt opens the matching payment from history');
  await page.close();
}

// 5. Not shown: kiosk mode, settled while away, an invoice the Receive sheet confirms.
{
  const page = await open();
  await page.evaluate(() => window.__receive({ amountSats: 2100, paymentId: 'away', settledWhileAway: true }));
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.amount-label').count(), 0);
  pass('a payment that settled while the app was away is left to the system notification');

  await page.evaluate(async () => {
    const { expectReceiveInvoice } = await import('/src/services/incomingPayments.js');
    expectReceiveInvoice({ walletId: 'w1', paymentHash: 'feed', amountSats: 0 });
    window.__receive({ amountSats: 2100, paymentId: 'inv', paymentHash: 'feed' });
  });
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.amount-label').count(), 0);
  assert.deepEqual(await toastText(page), []);
  pass('an invoice the Receive sheet shows is left to the sheet');

  await page.evaluate(() => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    store.kioskEnabled = true;
    store.kioskOwnerAccess = false;
    window.__receive({ amountSats: 2100, paymentId: 'kiosk' });
  });
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.amount-label').count(), 0);
  assert.deepEqual(await toastText(page), []);
  pass('kiosk mode shows nothing');
  await page.close();
}

// Screenshots of the remaining states.
{
  const page = await open('dark');
  await page.evaluate(() => window.__receive({ amountSats: 2100, paymentId: 'tx1' }));
  await page.locator('.amount-label', { hasText: 'Bitcoin received' }).waitFor();
  await shot(page, '04-home-screen-dark');
  await page.close();
}

await browser.close();
const real = errors.filter((e) => !/reading 'send'/.test(e));
assert.deepEqual(real, [], 'page errors');
console.log('all checks passed');
