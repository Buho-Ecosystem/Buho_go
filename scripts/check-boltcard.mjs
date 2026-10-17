/** Browser check for the Bolt Card flow and kiosk parking, driven through the
 * running app against a stand-in card service (LNURL-withdraw with a 10,000
 * sat pinLimit, PIN 1234, "Card blocked" after three wrong PINs). Start
 * `pnpm dev --port 9031` first (or set BOLTCARD_BASE_URL). Every other
 * external request is blocked; wallets are seeded into the store.
 *
 * Wallet: the tap opens the sheet at once, the slide (with its lock when a
 * PIN follows), the PIN in the sheet, a wrong PIN, the last try, a locked
 * card. Kiosk: a card held before the amount, the pay screen's card lane,
 * pay on tap below the PIN limit, the customer's PIN above it, a decline
 * that keeps the sale, and parked sales (several, watched, listed). */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.BOLTCARD_BASE_URL || 'http://localhost:9031';
const output = process.env.BOLTCARD_OUTPUT || new URL('../output/boltcard-check', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const CARD = 'lnurlw://boltcard.example/ln?p=4E2F9A1C0B7D3E5F&c=8A1B2C3D4E5F6071';
const PIN = '1234';
const browser = await chromium.launch({ headless: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let n = 0;
const shot = async (page, name) => { n++; await page.screenshot({ path: `${output}/${String(n).padStart(2, '0')}-${name}.png` }); };

function cardService({ readMs = 0, checkMs = 900 } = {}) {
  let wrong = 0;
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  return async (url, route) => {
    if (url.pathname === '/ln') {
      await pause(readMs);
      return json(route, { tag: 'withdrawRequest', k1: `k1-${Date.now()}`, callback: 'https://boltcard.example/cb', minWithdrawable: 1000, maxWithdrawable: 150_000_000, defaultDescription: 'Bolt Card', pinLimit: 10_000_000 });
    }
    await pause(checkMs);
    const pin = url.searchParams.get('pin');
    if (pin && pin !== PIN) {
      wrong++;
      return json(route, { status: 'ERROR', reason: wrong >= 3 ? 'Card blocked: too many incorrect PIN attempts' : 'Invalid PIN' });
    }
    return json(route, { status: 'OK' });
  };
}

async function open({ theme = 'light', service }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });
  if (process.env.BOLTCARD_DEBUG) page.on('console', (m) => console.log('console:', m.text().slice(0, 300)));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'boltcard.example') return service(url, route);
    return url.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.iconify.design'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.routeWebSocket('**', (socket) => { if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close(); });
  await page.addInitScript(({ theme }) => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buho-theme-mode', theme);
  }, { theme });
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => window.__audit?.app?.config?.globalProperties?.$pinia, null, { timeout: 90000 });
  await page.evaluate(() => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    store.$patch({ savedStateLoaded: true });
    store.wallets = [{ id: 'main', type: 'lnbits', name: 'Main', metadata: {}, createdAt: 1, lastUsed: 1 }];
    store.activeWalletId = 'main';
    store.connectionStates.main = { connected: true, error: null };
    store.balanceStates.main = { value: 184250, source: 'sync', verifiedAt: Date.now(), updatedAt: Date.now() };
    store.exchangeRates = { EUR: 92000, eur: 92000 };
    store.preferredFiatCurrency = 'EUR';
  });
  await page.waitForSelector('.wallet-toolbar', { timeout: 60000 });
  await pause(1500);
  return { page, context, errors };
}

const vmOf = (page, name) => page.evaluateHandle((name) => {
  for (const el of document.querySelectorAll('*')) {
    for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === name) return c.proxy;
  }
  return null;
}, name);
const typePin = async (page, digits) => { for (const d of digits) { await page.locator('.card-pin-key', { hasText: new RegExp(`^\\s*${d}\\s*$`) }).first().click(); await pause(80); } };
const tapCard = (page, target) => page.evaluate(({ card, target }) => {
  window.__audit.app.config.globalProperties.$pinia._s.get('wallet').pendingDeepLink = target
    ? { type: 'lnurl', data: card, target, receivedAt: Date.now() }
    : { type: 'lnurl', data: card };
}, { card: CARD, target });

/** Drag the slider's thumb to `share` of the track (and let go when asked). */
async function drag(page, share, release) {
  const thumb = await page.locator('.slide-thumb').boundingBox();
  const track = await page.locator('.slide-track').boundingBox();
  const startX = thumb.x + thumb.width / 2, y = thumb.y + thumb.height / 2;
  const travel = track.width - thumb.width - 8;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(startX + (travel * share * i) / 12, y); await pause(16); }
  if (release) await page.mouse.up();
}

// ── Wallet ──────────────────────────────────────────────────────────────────
{
  const { page, context, errors } = await open({ service: cardService({ readMs: 1600 }) });
  const vm = await vmOf(page, 'WalletPage');
  await vm.evaluate((vm) => {
    vm.createInvoiceForWithdraw = async (amount) => ({ payment_request: 'lnbc210u1pboltcard', payment_hash: 'ab'.repeat(32), amount });
    vm.startWithdrawPaymentMonitor = async () => {};
  });
  await tapCard(page);
  await page.waitForSelector('.stage-reading', { timeout: 5000 });
  await pause(500);
  await shot(page, 'wallet-tap-reading');
  await page.waitForSelector('.stage-compose', { timeout: 10000 });
  await pause(500);
  assert.equal(await page.locator('.top-title').first().textContent(), 'Receive from card');
  await vm.evaluate((vm) => vm.$refs.withdrawSheetRef.setAmountSats(4000));
  await pause(300);
  assert.equal(await page.locator('.card-pin-note').count(), 0, 'below the PIN limit nothing mentions a PIN');
  assert.equal(await page.locator('.slide-end').count(), 0);
  await vm.evaluate((vm) => vm.$refs.withdrawSheetRef.setAmountSats(21000));
  await pause(400);
  assert.equal(await page.locator('.card-pin-note').count(), 1, 'at the limit the sheet says a PIN follows');
  assert.equal(await page.locator('.slide-end').count(), 1, 'and the slide ends at a lock');
  await shot(page, 'wallet-amount-slide');
  await drag(page, 0.55, false);
  await shot(page, 'wallet-slide-dragging');
  await page.mouse.up();
  await pause(700);
  assert.equal(await page.locator('.card-pin').count(), 0, 'let go halfway: it springs back, nothing sent');
  await drag(page, 1, true);
  await page.waitForSelector('.card-pin .card-pin-key', { timeout: 10000 });
  await pause(500);
  await shot(page, 'wallet-pin-in-sheet');
  assert.equal(await page.locator('.top-title').first().textContent(), 'Card PIN');
  await typePin(page, '0000');
  await pause(300);
  await shot(page, 'wallet-pin-checking');
  await page.waitForSelector('.card-pin-error', { timeout: 5000 });
  await pause(300);
  assert.equal((await page.locator('.card-pin-error').textContent()).trim(), 'Wrong PIN. 2 tries left.');
  await shot(page, 'wallet-pin-wrong');
  await typePin(page, '9999');
  await page.waitForFunction(() => /1 try left/.test(document.querySelector('.card-pin-error')?.textContent || ''), null, { timeout: 5000 });
  await pause(400);
  await shot(page, 'wallet-pin-last-try');
  await typePin(page, '9999');
  await page.waitForSelector('.withdraw-card-result', { timeout: 5000 });
  await pause(500);
  await shot(page, 'wallet-card-locked');
  assert.equal(await page.locator('.payment-error-dialog, .q-dialog .error-dialog').count(), 0, 'a locked card is not an error dialog');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ wallet: the sheet on the tap, the slide, the PIN in the sheet, wrong PIN, last try, a locked card');
}

{
  const { page, context, errors } = await open({ service: cardService() });
  const vm = await vmOf(page, 'WalletPage');
  await vm.evaluate((vm) => {
    vm.createInvoiceForWithdraw = async (amount) => ({ payment_request: 'lnbc210u1pboltcard', payment_hash: 'ab'.repeat(32), amount });
    vm.startWithdrawPaymentMonitor = async () => {};
  });
  await tapCard(page);
  await page.waitForSelector('.stage-compose', { timeout: 10000 });
  await vm.evaluate((vm) => vm.$refs.withdrawSheetRef.setAmountSats(21000));
  await pause(300);
  await drag(page, 1, true);
  await page.waitForSelector('.card-pin .card-pin-key', { timeout: 10000 });
  await typePin(page, PIN);
  await page.waitForSelector('.card-pin', { state: 'detached', timeout: 5000 });
  await pause(500);
  await shot(page, 'wallet-receiving');
  assert.equal(await vm.evaluate((vm) => vm.lnurlWithdrawStatus), 'monitoring', 'the callback OK is not "received"');
  // Cancel during PIN entry sends nothing and the slide comes back.
  await vm.evaluate((vm) => vm.handleWithdrawConfirmed(21000));
  await pause(1200);
  await shot(page, 'wallet-received');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ wallet: right PIN, receiving until settled, received');
}

{
  // Closed while the card is still being read: it stays closed.
  const { page, context, errors } = await open({ service: cardService({ readMs: 1500 }) });
  await tapCard(page);
  await page.waitForSelector('.stage-reading', { timeout: 5000 });
  await page.locator('.top-btn').first().click();
  await pause(2500);
  assert.equal(await page.locator('.stage-compose').count(), 0, 'the sheet does not come back when the card answers');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ wallet: a sheet closed during the read stays closed');
}

// ── Kiosk ───────────────────────────────────────────────────────────────────
async function kiosk(service) {
  const opened = await open({ theme: 'dark', service });
  const { page } = opened;
  await page.evaluate(() => {
    localStorage.removeItem('buhoGO_kiosk_parked_sales');
    const app = window.__audit.app.config.globalProperties;
    const store = app.$pinia._s.get('wallet');
    store.wallets = [{ id: 'shop', type: 'lnbits', name: 'Café Till', metadata: {}, createdAt: 1, lastUsed: 1 }];
    store.activeWalletId = 'shop';
    store.connectionStates.shop = { connected: true, error: null };
    store.providers.shop = {};
    window.__paid = new Set();
    let sale = 0;
    store.ensureWalletConnectedForTransfer = async () => ({});
    store.createInvoiceDetailsOnWallet = async () => { sale++; return { paymentRequest: `lnbc${sale}u1pkioskcardsale${'q'.repeat(180)}`, paymentHash: String(sale).padStart(64, 'c'), expiresAt: Math.floor(Date.now() / 1000) + 900 }; };
    store.lookupInvoiceOnWallet = async (walletId, hash) => ({ paid: window.__paid.has(hash) });
    Object.assign(store, { kioskEnabled: true, kioskOwnerAccess: false, kioskWalletId: 'shop', kioskTipEnabled: false, kioskRoundUpEnabled: false });
    app.$router.push('/kiosk');
  });
  await page.waitForSelector('.kiosk-shell', { timeout: 30000 });
  await pause(800);
  const k = await vmOf(page, 'KioskDashboard');
  await k.evaluate((k) => { k.nfcReady = true; });
  return { ...opened, k };
}
const charge = async (k, page, amount) => {
  await k.evaluate((k, amount) => { for (const d of String(amount)) k.handleNumpad(d); k.proceedToTipOrCharge(); }, amount);
  await page.waitForSelector('.pos-pay', { timeout: 10000 });
  await pause(600);
};

{
  const { page, context, errors, k } = await kiosk(cardService());
  await tapCard(page, 'kiosk');
  await page.waitForSelector('.pos-card-held', { timeout: 5000 });
  await shot(page, 'kiosk-card-held');
  await charge(k, page, 21000);
  await page.waitForSelector('.pos-card-confirm', { timeout: 10000 });
  await pause(400);
  await shot(page, 'kiosk-held-card-confirm');
  assert.equal(await k.evaluate((k) => k.card.phase.value), 'review', 'a card tapped before the sale waits for Charge');
  await page.locator('.pos-card-confirm').click();
  await page.waitForSelector('.pos-pay .card-pin-key', { timeout: 10000 });
  await pause(500);
  await shot(page, 'kiosk-customer-pin');
  await typePin(page, PIN);
  await page.waitForSelector('.pos-card-status', { timeout: 10000 });
  await pause(400);
  await shot(page, 'kiosk-paying');
  await page.evaluate(() => { window.__paid.add('1'.padStart(64, 'c')); });
  await page.waitForSelector('.pos-paid-method', { timeout: 10000 });
  await pause(500);
  await shot(page, 'kiosk-paid-by-card');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ kiosk: held card waits for Charge, customer PIN on the pay screen, paid by card');
}

{
  const { page, context, errors, k } = await kiosk(cardService());
  await charge(k, page, 4800);
  assert.equal(await page.locator('.pos-card-lane').count(), 1, 'the pay screen offers the card');
  await shot(page, 'kiosk-pay-screen');
  await tapCard(page, 'kiosk');
  await page.waitForSelector('.pos-card-status', { timeout: 10000 });
  assert.equal(await page.locator('.card-pin').count(), 0);
  assert.equal(await k.evaluate((k) => k.card.phase.value === 'submitting' || k.card.phase.value === 'waiting'), true, 'below the PIN limit a tap pays at once');
  await context.close();
  console.log('✓ kiosk: below the PIN limit a tap on the pay screen pays at once');
  assert.deepEqual(errors, []);
}

{
  const { page, context, errors, k } = await kiosk(cardService({ checkMs: 200 }));
  await charge(k, page, 21000);
  await tapCard(page, 'kiosk');
  for (let i = 0; i < 3; i++) {
    await page.waitForSelector('.pos-pay .card-pin-key', { timeout: 10000 });
    await pause(i ? 700 : 300);
    await typePin(page, '9999');
    await pause(600);
  }
  await page.waitForSelector('.pos-card-problem', { timeout: 10000 });
  await pause(400);
  await shot(page, 'kiosk-card-declined');
  assert.equal(await page.locator('.pos-qr-img').count(), 1, 'the QR is still there');
  assert.equal(await k.evaluate((k) => k.state), 'payment', 'the sale is kept');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ kiosk: a locked card says why, keeps the sale and its QR');
}

{
  const { page, context, errors, k } = await kiosk(cardService());
  await charge(k, page, 2500);
  await page.locator('.pos-payment-actions .pos-outline-btn').first().click();
  await pause(300);
  await charge(k, page, 12000);
  await page.locator('.pos-payment-actions .pos-outline-btn').first().click();
  await pause(700);
  assert.equal(await k.evaluate((k) => k.parkedCount), 2, 'a second park never drops the first');
  await shot(page, 'kiosk-parked-line');
  await page.locator('.pos-parked-line').click();
  await page.waitForSelector('.pos-parked-row', { timeout: 5000 });
  await pause(500);
  await shot(page, 'kiosk-parked-sheet');
  await page.keyboard.press('Escape');
  await pause(400);
  await charge(k, page, 800);
  await page.evaluate(() => { window.__paid.add('1'.padStart(64, 'c')); });
  await page.waitForFunction(() => document.body.innerText.includes('Parked sale paid'), null, { timeout: 12000 });
  await pause(400);
  await shot(page, 'kiosk-parked-paid');
  assert.equal(await k.evaluate((k) => k.parkedCount), 1);
  assert.equal(await k.evaluate((k) => k.state), 'payment', 'the sale on screen is untouched');
  await page.locator('.pos-payment-actions .pos-cancel-btn').click();
  await pause(300);
  assert.equal(await k.evaluate((k) => k.parkedCount), 1, 'cancelling the sale on screen keeps the parked one');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ kiosk: parked sales are kept, listed, watched and recorded when paid');
}

await browser.close();
console.log(`Screenshots: ${output}`);
