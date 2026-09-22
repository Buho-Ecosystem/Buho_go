/** Controlled UI regression check for LUD-14 vouchers. Start `pnpm dev --port 9003` first.
 * External requests are blocked; no wallet keys, invoices, or payments are used. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.LUD14_BASE_URL || 'http://localhost:9003';
const output = process.env.LUD14_OUTPUT || '/private/tmp/lud14-review';
await mkdir(output, { recursive: true });

const now = Date.now();
const voucher = (id, balanceCheck, title, sats, extra = {}) => ({
  id, balanceCheck, knownUrls: [balanceCheck], domain: 'cash.example', title,
  minSats: 1, maxSats: sats, currentBalanceSats: null, exhausted: false, exhaustedAt: null,
  lastCheckedAt: 0, lastError: null, createdAt: now - 1000, updatedAt: now - 1000, ...extra,
});
const seed = { vouchers: [
  voucher('v-atm', 'https://cash.example/balance/abc', 'ATM voucher', 25000, { updatedAt: now }),
  voucher('v-gift', 'https://cash.example/balance/def', 'Gift card', 1200),
] };

// What the service answers: the ATM voucher rotates its URL on every check
// (abc → abc2 → abc3 …); the gift card answers with a service ERROR, which
// must read as "couldn't check", never as "empty".
const withdrawRequest = (balanceCheck, maxSats) => ({
  tag: 'withdrawRequest', k1: 'Voucher-A+B', callback: 'https://cash.example/Callback?session=KeepCase',
  minWithdrawable: 1000, maxWithdrawable: maxSats * 1000, defaultDescription: 'ATM voucher', balanceCheck,
});
let rotation = 1;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.setDefaultNavigationTimeout(120000);
page.setDefaultTimeout(60000);
const errors = [];
const requests = [];
// The dev server's HMR client throws on its closed socket; that noise is not the app.
page.on('pageerror', error => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'cash.example') {
    requests.push(url.href);
    if (url.pathname.startsWith('/balance/def')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ERROR', reason: 'Voucher already used' }) });
    }
    rotation += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(withdrawRequest(`https://cash.example/balance/abc${rotation}`, 25000)) });
  }
  if (url.origin === base) return route.continue();
  if (url.hostname === 'api.iconify.design' || url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) return route.continue();
  return route.abort();
});
await page.routeWebSocket('**', socket => {
  if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
  else socket.close();
});
await page.addInitScript(seed => {
  window.__AUDIT__ = { theme: 'light' };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
  localStorage.setItem('buhoGO_withdraw_vouchers', JSON.stringify(seed));
}, seed);

const store = () => page.evaluate(() => {
  const s = window.__audit.app.config.globalProperties.$pinia._s.get('withdrawVouchers');
  return { count: s.list.length, active: s.active.map(v => ({ id: v.id, balanceCheck: v.balanceCheck, title: v.title, error: v.lastError })) };
});
const heights = selector => page.locator(selector).evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)));
async function openReceive() {
  await page.evaluate(() => { window.__walletPage.showReceiveModal = true; });
  await page.locator('.voucher-summary').waitFor();
  await page.waitForTimeout(450); // let the sheet's slide-in settle before measuring or shooting
}
async function openSheet() {
  await page.locator('.voucher-summary').click();
  await page.locator('.voucher-sheet').waitFor();
  await page.waitForTimeout(450); // let the sheet's slide-in settle before measuring or shooting
}
async function closeAll() {
  await page.evaluate(() => { window.__walletPage.showReceiveModal = false; });
  await page.locator('.voucher-sheet').waitFor({ state: 'detached' });
  await page.waitForTimeout(350);
}

try {
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => !!window.__audit?.app && !!document.querySelector('.wallet-page-light, .wallet-page-dark'), null, { timeout: 120000 });
  await page.evaluate(() => {
    let component = document.querySelector('.wallet-page-light, .wallet-page-dark').__vueParentComponent;
    while (component && component.type.name !== 'WalletPage') component = component.parent;
    if (!component) throw new Error('Wallet component not mounted');
    const vm = component.proxy;
    window.__walletPage = vm;
    Object.defineProperty(component.ctx, 'walletDisplayName', { configurable: true, get: () => 'Personal wallet' });
    vm.createInvoiceForWithdraw = () => { throw new Error('unexpected invoice creation'); };
    vm.submitWithdrawCallback = () => { throw new Error('unexpected callback submission'); };
    vm.showLoadingScreen = false;
  });
  await page.waitForTimeout(500);

  // 1. Home: only a dot. Receive: one summary line.
  assert.equal(await page.locator('.action-btn-receive .action-dot').count(), 1);
  assert.equal(await page.locator('.action-btn-receive').getAttribute('aria-label'), 'Receive payment, vouchers saved');
  await page.screenshot({ path: `${output}/home-dot-light.png` });
  await openReceive();
  await page.getByText('2 vouchers', { exact: true }).waitFor();
  await page.locator('.voucher-summary', { hasText: 'left' }).waitFor();
  assert.ok((await heights('.voucher-summary'))[0] >= 44);
  assert.equal(requests.length, 0, 'opening Receive never calls a service');
  await page.screenshot({ path: `${output}/receive-summary-light.png` });
  console.log('✓ home shows a dot, Receive shows one summary row, nothing is fetched');

  // 2. The sheet re-checks stale vouchers on open; rotation stays one record; ERROR is a failed check.
  await page.evaluate(() => {
    const receive = window.__walletPage.$refs.receiveModal;
    receive.keypadValue = '123';
    receive.showAmountInput = true;
  });
  await openSheet();
  await page.locator('.voucher-row', { hasText: 'Voucher already used' }).waitFor();
  await page.locator('.voucher-row', { hasText: '25,000' }).waitFor();
  assert.match(await page.locator('.voucher-row', { hasText: 'Voucher already used' }).innerText(), /1,200/);
  assert.equal(requests.filter(r => r.includes('/balance/abc')).length, 1);
  assert.equal(requests.filter(r => r.includes('/balance/def')).length, 1);
  let state = await store();
  assert.equal(state.count, 2);
  assert.equal(state.active.find(v => v.id === 'v-atm').balanceCheck, 'https://cash.example/balance/abc2');
  assert.deepEqual(state.active.find(v => v.id === 'v-gift').error, { kind: 'service', reason: 'Voucher already used' });
  assert.equal(await page.locator('.voucher-row').count(), 2);
  assert.equal(await page.getByRole('dialog', { name: 'Vouchers', exact: true }).count(), 1);
  assert.equal(await page.locator('.q-dialog:visible').count(), 1, 'Receive and Vouchers share one dialog');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('.voucher-summary').waitFor();
  assert.equal(await page.locator('.voucher-summary').evaluate(el => document.activeElement === el), true);
  assert.equal(await page.evaluate(() => window.__walletPage.$refs.receiveModal.keypadValue), '123');
  await openSheet();
  assert.ok((await heights('.voucher-row')).every(h => h >= 44));
  assert.equal(await page.locator('.voucher-row button, .voucher-row [role="button"]').count(), 0, 'no nested controls');
  await page.screenshot({ path: `${output}/vouchers-sheet-light.png` });
  console.log('✓ opening the list re-checks once per stale voucher; rotation keeps one record; ERROR keeps the figure');

  // 3. Enter on a row does exactly one thing: sweep through the dispatcher, no invoice, one fetch.
  const before = requests.length;
  await page.locator('.voucher-row').first().focus();
  await page.keyboard.press('Enter');
  await page.locator('.sheet-card--redeem').waitFor();
  await page.getByText('cash.example', { exact: true }).waitFor();
  assert.equal(requests.length - before, 1, 'one GET of the balanceCheck URL');
  await page.locator('.voucher-sheet').waitFor({ state: 'detached', timeout: 5000 });
  state = await store();
  assert.equal(state.count, 2, 'a sweep on a rotating service does not duplicate the voucher');
  assert.equal(state.active.find(v => v.id === 'v-atm').balanceCheck, 'https://cash.example/balance/abc3');
  await page.locator('.sheet-card--redeem .top-btn').click();
  await page.locator('.sheet-card--redeem').waitFor({ state: 'detached' });
  console.log('✓ a row tap sweeps through the same review as a scanned code, with one fetch and no invoice');

  // 4. Edit → Remove asks first; Cancel keeps, Remove forgets. Empty state reads as such.
  await openReceive();
  await openSheet();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.locator('.voucher-remove').count(), 2);
  assert.ok((await heights('.voucher-remove')).every(h => h >= 44));
  await page.locator('.voucher-remove').first().click();
  await page.getByText('Remove voucher?', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal((await store()).count, 2);
  await page.locator('.voucher-remove').first().click();
  await page.getByText('Remove voucher?', { exact: true }).waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${output}/remove-confirm-light.png` });
  await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
  await page.waitForTimeout(400);
  assert.equal((await store()).count, 1);
  assert.equal(await page.locator('.voucher-row').count(), 1);
  await page.evaluate(async () => {
    const s = window.__audit.app.config.globalProperties.$pinia._s.get('withdrawVouchers');
    await s.forget(s.list[0].id);
  });
  await page.getByText('No vouchers saved.', { exact: true }).waitFor();
  await closeAll();
  assert.equal(await page.locator('.action-dot').count(), 0);
  await page.evaluate(() => { window.__walletPage.showReceiveModal = true; });
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.voucher-summary').count(), 0);
  await page.evaluate(() => { window.__walletPage.showReceiveModal = false; });
  await page.waitForTimeout(350);
  console.log('✓ Remove asks first; the last removal leaves an honest empty state and no traces on Receive or Home');

  // 5. Locales, themes, text scale.
  for (const [locale, title, theme, width, height, scale] of [
    ['en-US', 'Vouchers', 'dark', 390, 844, 1],
    ['en-US', 'Vouchers', 'light', 320, 568, 2],
    ['es', 'Vales', 'dark', 320, 568, 2],
    ['de', 'Gutscheine', 'light', 320, 568, 2],
    ['es', 'Vales', 'dark', 768, 1024, 1],
  ]) {
    await page.evaluate(async seed => {
      const s = window.__audit.app.config.globalProperties.$pinia._s.get('withdrawVouchers');
      s.vouchers = seed.vouchers.map(v => ({ ...v, lastCheckedAt: Date.now() }));
      await s.persist();
    }, seed);
    await page.setViewportSize({ width, height });
    await page.evaluate(({ locale, theme, scale }) => {
      window.__audit.app._instance.proxy.$i18n.locale = locale;
      window.__audit.setDark(theme === 'dark');
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, { locale, theme, scale });
    await openReceive();
    await openSheet();
    await page.getByText(title, { exact: true }).first().waitFor();
    await page.waitForTimeout(300);
    const bounds = await page.locator('.voucher-sheet').evaluate(el => ({ width: el.getBoundingClientRect().width, scrollWidth: el.scrollWidth }));
    assert.ok(bounds.scrollWidth <= bounds.width + 1, JSON.stringify(bounds));
    const textSize = await page.locator('.voucher-title').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.equal(textSize, 15 * scale, 'voucher text must actually scale');
    const titleLines = await page.locator('.sheet-title').evaluate(el => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
    assert.ok(titleLines <= 2.1, 'the title must not become a narrow column');
    assert.equal(await page.locator('.q-dialog:visible').count(), 1);
    assert.ok((await heights('.voucher-row')).every(h => h >= 44));
    await page.screenshot({ path: `${output}/${locale}-${theme}-${scale}x.png` });
    await page.locator('.sheet-edit').click();
    await page.screenshot({ path: `${output}/editing-${locale}-${theme}-${scale}x.png` });
    const copyWidth = await page.locator('.voucher-row--editing .voucher-copy').first().evaluate(el => el.getBoundingClientRect().width);
    assert.ok(copyWidth >= 180, 'editing must leave room for the voucher identity');
    await page.locator('.voucher-remove').first().click();
    await page.locator('.voucher-remove-dialog').waitFor();
    await page.waitForTimeout(350);
    const messageSize = await page.locator('.voucher-remove-dialog .q-dialog__message').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.equal(messageSize, 16 * scale, 'warning text scales with the title');
    const actionsVisible = await page.locator('.voucher-remove-dialog .q-card__actions').evaluate(el => {
      const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;
    });
    assert.ok(actionsVisible, 'confirmation actions stay visible at large text');
    const contrast = await page.locator('.voucher-danger-action').evaluate(el => {
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = color => rgb(color).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const foreground = luminance(getComputedStyle(el).color);
      const background = luminance(getComputedStyle(el.closest('.voucher-remove-dialog')).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    assert.ok(contrast >= 4.5, `destructive action needs legible contrast, got ${contrast}`);
    assert.ok((await heights('.voucher-remove-dialog .q-btn')).every(h => h >= 44));
    await page.screenshot({ path: `${output}/removal-${locale}-${theme}-${scale}x.png` });
    await page.locator('.voucher-cancel-action').click();
    await page.locator('.voucher-remove-dialog').waitFor({ state: 'detached' });
    await closeAll();
    console.log(`✓ ${locale}, ${theme}, ${width}px, ${scale}x text`);
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
