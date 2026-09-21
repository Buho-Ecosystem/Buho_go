/** Controlled UI regression check. Start `pnpm dev --port 9003` first.
 * External requests are blocked; no wallet keys, invoices, or payments are used. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { bech32 } from 'bech32';

const base = process.env.LUD08_BASE_URL || 'http://localhost:9003';
const output = process.env.LUD08_OUTPUT || '/private/tmp/lud08-review';
await mkdir(output, { recursive: true });
const metadata = { tag: 'withdrawRequest', k1: 'Voucher-A+B', callback: 'https://cash.example/Callback?session=KeepCase',
  minWithdrawable: 1000, maxWithdrawable: 25000, defaultDescription: 'Rewards for Alice@Example.com' };
const endpoint = data => `https://cash.example/withdraw?${new URLSearchParams(data)}`;
const encode = data => bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(endpoint(data))), 16384);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
const requests = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'cash.example') {
    requests.push(url.href);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metadata) });
  }
  return url.origin === base ? route.continue() : route.abort();
});
await page.routeWebSocket('**', socket => socket.close());
await page.addInitScript(() => {
  window.__AUDIT__ = { theme: 'light' };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
});
async function open(data = metadata) {
  await page.evaluate(async input => {
    await window.__withdrawPage.onPaymentDetected({ type: 'lnurl', data: input });
  }, encode(data));
  await page.locator('.sheet-card--redeem').waitFor();
  await page.waitForTimeout(350);
}
async function close() {
  await page.locator('.sheet-card--redeem .top-btn').click();
  await page.locator('.sheet-card--redeem').waitFor({ state: 'detached' });
}
try {
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => !!window.__audit?.app && !!document.querySelector('.wallet-page-light, .wallet-page-dark'));
  await page.evaluate(() => {
    let component = document.querySelector('.wallet-page-light, .wallet-page-dark').__vueParentComponent;
    while (component && component.type.name !== 'WalletPage') component = component.parent;
    if (!component) throw new Error('Wallet component not mounted');
    const vm = component.proxy;
    window.__withdrawPage = vm;
    // Public display fixture only. Provider methods fail if confirmation or
    // opening a request accidentally attempts invoice creation or submission.
    Object.defineProperty(component.ctx, 'walletDisplayName', { configurable: true, get: () => 'Personal wallet' });
    vm.createInvoiceForWithdraw = () => { throw new Error('unexpected invoice creation'); };
    vm.submitWithdrawCallback = () => { throw new Error('unexpected callback submission'); };
    vm.showLoadingScreen = false;
  });

  await open();
  assert.equal(requests.length, 0);
  await page.getByText('cash.example', { exact: true }).waitFor();
  await page.getByText('Receiving wallet: Personal wallet', { exact: true }).waitFor();
  const amount = page.getByRole('textbox', { name: 'Amount', exact: true });
  await amount.fill('12');
  assert.equal(await page.locator('.sheet-card--redeem .primary-cta').isEnabled(), true);
  await page.screenshot({ path: `${output}/redeem-light.png` });
  await close();
  assert.equal(requests.length, 0);
  console.log('✓ inline review, amount entry, service/wallet context, and cancellation without network');

  await page.evaluate(() => { window.__withdrawPage.pendingWithdrawTargetSats = 15; });
  await open();
  assert.equal(await amount.inputValue(), '15');
  await close();
  console.log('✓ Receive amount survives the Redeem handoff');

  await open();
  await page.keyboard.press('Escape');
  await page.locator('.sheet-card--redeem').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__withdrawPage.pendingPayment), null);
  await open();
  const header = await page.locator('.sheet-card--redeem .top-row').boundingBox();
  await page.mouse.move(header.x + header.width / 2, header.y + 10);
  await page.mouse.down();
  await page.mouse.move(header.x + header.width / 2, header.y + 150, { steps: 5 });
  await page.mouse.up();
  await page.locator('.sheet-card--redeem').waitFor({ state: 'detached' });
  await open();
  await page.evaluate(() => { window.__withdrawPage.lnurlWithdrawStatus = 'submitting'; });
  assert.equal(await page.locator('.sheet-card--redeem .top-btn').isDisabled(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sheet-card--redeem').isVisible(), true);
  await page.evaluate(() => { window.__withdrawPage.lnurlWithdrawStatus = 'idle'; });
  await close();
  console.log('✓ Cancel, Escape, and header swipe dismiss review; submitting stays visible');

  await open({ ...metadata, minWithdrawable: 12000, maxWithdrawable: 12000 });
  assert.equal(await amount.inputValue(), '12');
  assert.equal(await amount.getAttribute('readonly'), '');
  await close();

  await open({ ...metadata, minWithdrawable: 0, maxWithdrawable: 0 });
  await page.getByText('There are no funds to redeem from this request.', { exact: true }).waitFor();
  assert.equal(await page.locator('.sheet-card--redeem .primary-cta').isDisabled(), true);
  await close();
  console.log('✓ fixed amounts stay fixed; zero balance has a clear disabled state');

  await open({ ...metadata, minWithdrawable: 'bad' });
  assert.equal(requests.length, 1);
  await close();
  console.log('✓ malformed inline metadata falls back once and opens the same review');

  // Actual Send adapter: a literal @ in a LUD-17 description must not
  // lowercase the service's callback, challenge, or human-readable content.
  await page.evaluate(async input => {
    const { default: Send } = await import('/src/components/SendModal.vue');
    const emitted = [];
    const vm = { ...Send.methods, walletStore: { activeWalletType: 'spark' }, $t: key => key,
      $emit: (name, value) => emitted.push([name, value]), $q: { notify() { throw new Error('unexpected send error'); } } };
    await vm.processPaymentData(input);
    const payload = emitted.find(([name]) => name === 'payment-detected')?.[1];
    if (!payload || payload.data !== input || payload.type !== 'lnurl') throw new Error('Send altered the withdraw URL');
  }, endpoint(metadata).replace('https:', 'lnurlw:').replace('%40', '@'));
  console.log('✓ Send preserves mixed-case withdraw URLs containing @');

  for (const [locale, title, theme, width, height, scale] of [
    ['en-US', 'Redeem from', 'dark', 390, 844, 1],
    ['de', 'Einlösen von', 'light', 320, 568, 2],
    ['es', 'Canjear desde', 'dark', 768, 1024, 1],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ locale, theme, scale }) => {
      window.__audit.app._instance.proxy.$i18n.locale = locale;
      window.__audit.setDark(theme === 'dark');
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, { locale, theme, scale });
    await open({ ...metadata, defaultDescription: 'Voucher for Alice@Example.com — '.repeat(8) });
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.waitForTimeout(300);
    const bounds = await page.locator('.sheet-card--redeem').evaluate(el => {
      const rect = el.getBoundingClientRect();
      const button = el.querySelector('.primary-cta').getBoundingClientRect();
      return { width: rect.width, scrollWidth: el.scrollWidth, top: button.top, bottom: button.bottom, buttonHeight: button.height, viewport: innerHeight };
    });
    assert.ok(bounds.scrollWidth <= bounds.width + 1, JSON.stringify(bounds));
    assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.viewport && bounds.buttonHeight >= 44, JSON.stringify(bounds));
    await page.screenshot({ path: `${output}/${locale}-${theme}-${scale}x.png` });
    await close();
    console.log(`✓ ${locale}, ${theme}, ${width}px, ${scale}x text`);
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
