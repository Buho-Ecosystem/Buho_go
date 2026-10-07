/**
 * Start `npm run dev -- --port 9007`, then run this script.
 * Uses the real kiosk and confirmation/PIN screens with simulated NFC input,
 * card HTTP responses and an invoice provider. No real card or payment.
 */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = process.env.KIOSK_BASE_URL || 'http://localhost:9007';
const output = process.env.KIOSK_OUTPUT || '/private/tmp/buhogo-319-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const callbacks = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (['api.iconify.design', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
    if (url.hostname !== 'card.example') return route.abort();
    if (url.pathname === '/tap') return route.fulfill({ json: {
      tag: 'withdrawRequest', k1: 'dummy-challenge', callback: 'https://card.example/callback',
      minWithdrawable: 1000, maxWithdrawable: 1000000, defaultDescription: 'Bolt Card', pinLimit: 50000,
    } });
    assert.equal(url.pathname, '/callback');
    assert.equal(url.searchParams.get('pr'), 'lnbc-test-sale');
    assert.equal(url.searchParams.get('k1'), 'dummy-challenge');
    callbacks.push({ pin: url.searchParams.get('pin') });
    return route.fulfill({ json: url.searchParams.get('pin') === '1234'
      ? { status: 'OK' } : { status: 'ERROR', reason: 'Invalid PIN' } });
  });
  await page.routeWebSocket('**', socket => socket.close());
  await page.addInitScript(() => {
    window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null }));
  });
  await page.goto(base + '/#/settings');
  await page.waitForFunction(() => window.__audit?.app);
  await page.evaluate(async () => {
    const { app } = window.__audit;
    const store = app.config.globalProperties.$pinia._s.get('wallet');
    window.__kioskTest = { invoices: 0, paid: false };
    const provider = {
      async createInvoice({ amount }) {
        window.__kioskTest.invoices++;
        window.__kioskTest.amount = amount;
        return { paymentRequest: 'lnbc-test-sale', paymentHash: 'aa'.repeat(32) };
      },
      async lookupInvoice(hash) {
        if (hash !== 'aa'.repeat(32)) throw new Error('Wrong invoice');
        return { paid: window.__kioskTest.paid };
      },
      async getBalance() { return { balance: 100000 }; },
    };
    store.ensureWalletConnectedForTransfer = async id => {
      if (id !== 'register') throw new Error('Wrong receiving wallet');
      return provider;
    };
    store.initialize = async () => {};
    store.isInitialized = true;
    store.wallets = [{ id: 'register', type: 'lnbits', name: 'Shop register' }];
    store.providers = { register: provider };
    store.kioskWalletId = 'register';
    store.kioskEnabled = true;
    store.kioskOwnerAccess = false;
    store.kioskTipEnabled = false;
    store.kioskRoundUpEnabled = false;
    store.kioskDisplayCurrency = 'sats';
    await app.config.globalProperties.$router.push('/kiosk');
    const { offerKioskPayment } = await import('/src/services/kioskPaymentIntake.js');
    window.__tapCard = () => offerKioskPayment('lnurlw://card.example/tap', store, app.config.globalProperties.$router);
  });
  await page.locator('.kiosk-page').waitFor();
  await page.evaluate(() => window.__tapCard());
  await page.getByText('Card ready. Enter the sale amount to continue.').waitFor();
  for (const digit of ['1', '0', '0']) await page.locator('.pos-key-num').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  await page.locator('.pos-charge-btn').click();
  const sheet = page.locator('.sheet-card');
  await sheet.getByText('Charge card', { exact: true }).waitFor();
  assert.equal(await sheet.locator('.amount-input').inputValue(), '100');
  assert.equal(callbacks.length, 0);
  await page.waitForTimeout(400); // Let the shared sheet's opening transition finish.
  await page.screenshot({ path: output + '/01-card-confirmation.png' });
  await sheet.locator('.primary-cta').click();
  const pin = page.locator('.pin-card');
  await pin.getByText('Bolt Card PIN', { exact: true }).waitFor();
  for (const digit of ['0', '0', '0', '0']) await pin.locator('.numpad-key-digit').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  await pin.getByText('Invalid PIN. 2 attempts left.', { exact: true }).waitFor();
  await page.screenshot({ path: output + '/02-card-pin-retry.png' });
  for (const digit of ['1', '2', '3', '4']) await pin.locator('.numpad-key-digit').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  await page.waitForFunction(() => !document.querySelector('.pin-card'));
  await page.locator('.pos-qr-card').waitFor();
  assert.equal(await page.locator('.pos-paid-ring').count(), 0);
  await page.evaluate(() => {
    window.__kioskTest.paid = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('.pos-paid-ring').waitFor();
  await page.screenshot({ path: output + '/03-card-paid.png' });
  assert.equal(await page.evaluate(() => window.__kioskTest.invoices), 1);
  assert.equal(callbacks.length, 2);
  assert.equal(await page.evaluate(() => window.__audit.app.config.globalProperties.$pinia._s.get('wallet').kioskOwnerAccess), false);
  assert.deepEqual(errors, []);
  console.log('Kiosk NFC UI: confirmation, PIN retry, one invoice, verified settlement passed');
} finally { await browser.close(); }
