import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = 'http://127.0.0.1:9012';
await mkdir('output/pr296-review', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') return route.fulfill({ contentType: 'application/json', body: '{"USD":85000,"EUR":78000}' });
    if (url.origin === base) return route.continue();
    return route.abort();
  });
  await page.routeWebSocket('**', socket => {
    if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
    else socket.close();
  });
  await page.addInitScript(() => {
    window.__AUDIT__ = { theme: 'dark', noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
  });
  await page.goto(`${base}/#/wallet`);
  await page.locator('.wallet-page-dark, .wallet-page-light').waitFor();
  await page.evaluate(async () => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const store = useWalletStore();
    let component = document.querySelector('.wallet-page-dark, .wallet-page-light').__vueParentComponent;
    while (component && component.type.name !== 'WalletPage') component = component.parent;
    const vm = component.proxy;
    vm.updateWalletBalance = async () => {};
    vm.loadLastTransaction = async () => {};
    store.connectAllSparkWallets = async () => {};
    store.refreshWalletData = async () => {};
    store.persistState = async () => {};
    store.wallets = [{ id: 'business', type: 'spark', name: 'Business', metadata: {}, connectionData: {} },
      { id: 'personal', type: 'spark', name: 'Personal', metadata: {}, connectionData: {} }];
    const provider = { isConnected: true, getTransactions: async () => [], getCachedBalance: async () => ({ balance: 5000 }), getPendingDeposits: async () => [] };
    store.providers = { business: { ...provider }, personal: { ...provider } };
    store.ensureSparkConnected = async id => store.providers[id || store.activeWalletId];
    store.connectionStates = { business: { connected: true }, personal: { connected: true } };
    store.balances = {}; store.balanceMeta = {};
    store.activeWalletId = 'personal';
    vm.walletState.activeWalletId = 'personal';
    vm.walletState.balance = 999999;
    vm.showLoadingScreen = false;
    window.reviewStore = store; window.reviewPage = vm;
  });
  await page.locator('.balance-amount [aria-label="Balance not loaded yet"]').waitFor();
  assert.equal(await page.locator('.balance-amount').innerText(), '—');
  await page.screenshot({ path: 'output/pr296-review/unknown.png' });
  await page.evaluate(() => window.reviewStore.acceptBalance('personal', 0, { verified: true }));
  await page.waitForFunction(() => document.querySelector('.balance-amount [aria-label="Balance not loaded yet"]') === null);
  assert.equal(await page.evaluate(() => window.reviewPage.balanceNumericValue), 0);
  await page.evaluate(() => {
    const store = window.reviewStore;
    store.acceptBalance('business', 5000, { verified: true });
    store.markBalanceError('business', 'temporary network failure');
    store.activeWalletId = 'business';
  });
  await page.getByText('Last known balance', { exact: true }).first().waitFor();
  assert.equal(await page.evaluate(() => window.reviewPage.balanceNumericValue), 5000);
  assert.equal(await page.evaluate(() => window.reviewStore.totalBalanceView.total), 5000);
  await page.waitForTimeout(800); // Let the number component finish its first render.
  await page.screenshot({ path: 'output/pr296-review/stale-business.png' });
  const rendered = await page.locator('.balance-amount number-flow-vue').evaluate(el => Array.from(el.shadowRoot.querySelectorAll('.digit__num:not([inert]), .symbol__value:not([inert])')).map(n => n.textContent).join(''));
  assert.match(rendered.replace(/[,\s]/g, ''), /5000/);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(async i => {
      const id = i % 2 ? 'business' : 'personal';
      await window.reviewStore.switchActiveWallet(id);
    }, i);
  }
  assert.ok(await page.evaluate(() => Object.values(window.reviewStore.providers).every(p => p.isConnected)));
  assert.deepEqual(errors, []);
  console.log('PASS: real home renders unknown, verified zero and stale funds accurately; repeated selection keeps both providers connected. External requests blocked; no real funds used.');
} finally { await browser.close(); }
