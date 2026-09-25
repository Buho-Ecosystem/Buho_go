// Local UI integration check. Real store/modal/router; scripted providers only.
// Run against `pnpm dev --port 9012`. Never sends a real payment.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.TRANSFER_BASE_URL || 'http://localhost:9012';
const output = 'output/transfer-completion';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') return route.fulfill({ contentType: 'application/json', body: '{"USD":85000,"EUR":78000}' });
  if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
  return route.abort();
});
await page.routeWebSocket('**', socket => {
  if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close();
});
await page.addInitScript(() => {
  window.__AUDIT__ = { theme: 'dark', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
});

async function openSuccess() {
  await page.evaluate(async () => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const store = useWalletStore();
    const wallets = [{ id: 'transfer-source', type: 'spark', name: 'Personal' }, { id: 'transfer-destination', type: 'spark', name: 'Business' }];
    store.wallets = wallets;
    store.activeWalletId = 'transfer-source';
    store.balances = { 'transfer-source': 100, 'transfer-destination': 10 };
    store.connectionStates = Object.fromEntries(wallets.map(w => [w.id, { connected: true }]));
    window.transferReads = [];
    window.transferSends = 0;
    const provider = {
      isConnected: true,
      getSparkAddress: async () => 'scripted-destination',
      transferToSparkAddress: async () => { window.transferSends++; return { id: 'exact-transfer-id', status: 'completed' }; },
      getTransaction: async id => {
        window.transferReads.push(id);
        return { id, type: 'send', amount: 2, fee: 0, timestamp: 1790000000, status: 'completed', sparkTransfer: true };
      },
      getTransactions: async () => [],
      getBalance: async () => 100,
    };
    store.providers = Object.fromEntries(wallets.map(w => [w.id, provider]));
    store.ensureWalletConnectedForTransfer = async () => provider;
    store.ensureSparkConnected = async walletId => {
      window.transferReadWallet = walletId;
      return provider;
    };
    store.refreshWalletData = async () => {};
    store.connectAllSparkWallets = async () => {};
    // A stale unscoped cache contains the receiving leg of the same hash.
    localStorage.setItem('buhoGO_cached_transactions', JSON.stringify([{ id: 'exact-transfer-id', type: 'incoming', amount: 999 }]));
    let wallet = document.querySelector('.wallet-page-light, .wallet-page-dark').__vueParentComponent;
    while (wallet && wallet.type.name !== 'WalletPage') wallet = wallet.parent;
    wallet.proxy.showTransferModal = true;
    window.walletPage = wallet.proxy;
  });
  const modal = page.locator('.modal-card');
  await modal.waitFor();
  // Select through the actual pickers and submit through the real store action.
  await modal.locator('.wallet-btn').nth(1).click();
  await page.locator('.picker-row').filter({ hasText: 'Business' }).click();
  await modal.locator('.btn-main').click();
  await modal.locator('.amount-input').fill('2');
  await modal.locator('.btn-main').click();
  await modal.locator('.btn-main').click();
  await modal.locator('.completion-actions').waitFor();
  assert.equal(await page.evaluate(() => window.transferSends), 1);
  assert.equal(await page.locator('.app-toast').count(), 0, 'completion screen needs no duplicate toast');
  return modal;
}

try {
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => !!window.__audit?.app?._instance);
  await page.locator('.wallet-page-light, .wallet-page-dark').waitFor();
  const modal = await openSuccess();
  for (const locale of ['en-US', 'de', 'es']) {
    for (const dark of [false, true]) {
      await page.evaluate(async ({ locale, dark }) => {
        const { i18n } = await import('/src/boot/i18n.js');
        i18n.global.locale = locale;
        window.__audit.setDark(dark);
      }, { locale, dark });
      await page.setViewportSize({ width: 320, height: 740 });
      await page.waitForTimeout(250);
      const metrics = await modal.locator('.completion-button').evaluateAll(buttons => buttons.map(button => {
        const rect = button.getBoundingClientRect();
        const content = button.querySelector('.q-btn__content');
        return { width: rect.width, height: rect.height, fits: content.scrollWidth <= content.clientWidth, left: rect.left, right: rect.right };
      }));
      assert.equal(metrics.length, 2);
      assert.ok(Math.abs(metrics[0].width - metrics[1].width) < 1);
      assert.ok(metrics.every(m => m.height >= 44 && m.fits && m.left >= 0 && m.right <= 320));
      await page.screenshot({ path: `${output}/${locale}-${dark ? 'dark' : 'light'}-320.png` });
    }
  }
  console.log('PASS: equal buttons, single-line labels and touch targets in all locales/themes at 320px');
  await page.evaluate(async () => { const { i18n } = await import('/src/boot/i18n.js'); i18n.global.locale = 'en-US'; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/completion-dark.png` });
  const link = modal.locator('.completion-button--details');
  assert.equal(await link.getAttribute('href'), '#/transaction/exact-transfer-id?wallet=transfer-source');
  // Simulate another active wallet; the explicit source must still win.
  await page.evaluate(async () => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    useWalletStore().activeWalletId = 'transfer-destination';
    window.transferRoutes = [];
    window.__audit.app.config.globalProperties.$router.afterEach(to => window.transferRoutes.push(to.fullPath));
  });
  await link.click();
  await page.locator('.transaction-details-page .hero-amount').waitFor();
  assert.deepEqual(await page.evaluate(() => window.transferRoutes), ['/transaction/exact-transfer-id?wallet=transfer-source']);
  assert.deepEqual(await page.evaluate(() => window.transferReads), ['exact-transfer-id']);
  assert.equal(await page.evaluate(() => window.transferReadWallet), 'transfer-source');
  assert.equal(await page.locator('.q-dialog').count(), 0);
  const transaction = await page.locator('.transaction-details-page').evaluate(node => {
    let component = node.__vueParentComponent;
    while (component && component.type.name !== 'TransactionDetailsPage') component = component.parent;
    return component.proxy.transaction;
  });
  assert.equal(transaction.type, 'outgoing');
  assert.equal(transaction.amount, 2);
  assert.equal(await page.evaluate(async () => {
    const { useTransactionMetadataStore } = await import('/src/stores/transactionMetadata.js');
    return useTransactionMetadataStore().getSourceForTransaction('exact-transfer-id', 'transfer-source');
  }), 'internal-transfer');
  await page.screenshot({ path: `${output}/direct-details.png` });
  await page.locator('.transaction-details-page .back-btn').click();
  await page.locator('.wallet-page-light, .wallet-page-dark').waitFor();
  assert.equal(await page.locator('.modal-card').count(), 0);
  assert.equal(await page.evaluate(() => window.transferSends), 1);
  console.log('PASS: exact source payment, one route, no stale cache or modal, Back returns home without resending');
  const again = await openSuccess();
  await again.locator('.completion-button--done').click();
  await again.waitFor({ state: 'detached' });
  assert.ok(page.url().endsWith('/#/wallet'));
  console.log('PASS: Done only dismisses the completion screen');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
