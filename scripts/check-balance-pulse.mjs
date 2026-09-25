/**
 * Balance pulse check. Start `npx quasar dev --port 9013` first.
 *
 * Renders the real home screen with scripted wallets whose balance reads
 * wait until this script releases them: no network, no keys, no funds.
 * Checks that the balance pulses while it is not loaded yet and while a
 * refresh the user waits on is under way, stays still during the routine
 * tick, and that the wallet sheet does the same per wallet. Screenshots
 * land in PULSE_OUTPUT (default output/balance-pulse).
 *
 *   node scripts/check-balance-pulse.mjs
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.PULSE_BASE_URL || 'http://localhost:9013';
const output = process.env.PULSE_OUTPUT || 'output/balance-pulse';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === base || ['api.iconify.design', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
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
  // Let the page finish starting up (with no wallets) before scripting any.
  await page.waitForFunction(() => {
    let component = document.querySelector('.wallet-page-dark, .wallet-page-light')?.__vueParentComponent;
    while (component && component.type.name !== 'WalletPage') component = component.parent;
    return component?.proxy.showLoadingScreen === false;
  });
  await page.waitForTimeout(500);

  await page.evaluate(async () => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const store = useWalletStore();
    let component = document.querySelector('.wallet-page-dark, .wallet-page-light').__vueParentComponent;
    while (component && component.type.name !== 'WalletPage') component = component.parent;
    const vm = component.proxy;
    clearInterval(vm.refreshInterval);
    vm.loadLastTransaction = async () => {};
    // Every balance read waits here until the check releases it.
    window.pending = [];
    const held = value => new Promise(resolve => window.pending.push(() => resolve(value)));
    window.release = () => { for (const go of window.pending.splice(0)) go(); };
    const provider = {
      isConnected: true,
      getBalance: () => held({ balance: 6000 }),
      getCachedBalance: () => held({ balance: 6000 }),
      getTransactions: async () => [],
    };
    store.wallets = [
      { id: 'business', type: 'spark', name: 'Business', metadata: {}, connectionData: {} },
      { id: 'personal', type: 'spark', name: 'Personal', metadata: {}, connectionData: {} },
      { id: 'savings', type: 'nwc', name: 'Savings', metadata: {}, connectionData: {} },
    ];
    store.providers = { business: provider };
    store.connectionStates = { business: { connected: true }, personal: { connected: false }, savings: { connected: true } };
    store.ensureSparkConnected = async () => provider;
    store.connectAllSparkWallets = async () => {};
    window.sheetRefreshes = [];
    store.refreshWalletData = id => {
      window.sheetRefreshes.push(id);
      return held().then(() => { store.balances = { ...store.balances, [id]: 6000 }; });
    };
    store.balances = { business: 5000, personal: 3000 };
    store.activeWalletId = 'business';
    vm.walletState.connectedWallets = store.wallets.map(w => ({ ...w }));
    vm.walletState.activeWalletId = 'business';
    vm.walletState.balance = 5000;
    vm.balanceReadFor = null;
    vm.showLoadingScreen = false;
    window.page = vm;
  });

  const pulsing = selector => page.evaluate(sel => {
    const el = document.querySelector(sel);
    return !!el && el.getAnimations().some(a => a.playState === 'running' && a.effect.getComputedTiming().iterations === Infinity);
  }, selector);
  const settled = selector => page.waitForFunction(sel => document.querySelector(sel)?.getAnimations().length === 0, selector);
  const home = '.balance-container';

  // Not read yet this session: the saved figure pulses.
  await page.locator(home).waitFor();
  assert.ok(await pulsing(home), 'a balance not loaded yet pulses');

  // A refresh the user waits on (switch, payment, transfer): it pulses until it lands.
  await page.evaluate(() => { window.page.updateWalletBalance(); });
  await page.waitForFunction(() => window.pending.length === 1);
  assert.ok(await pulsing(home));
  await page.waitForTimeout(900); // mid-pulse, for the screenshot
  await page.screenshot({ path: `${output}/home-refreshing.png` });
  await page.evaluate(() => window.release());
  await page.waitForFunction(() => window.page.walletState.balance === 6000);
  await settled(home);
  assert.equal(await pulsing(home), false, 'a loaded balance is still');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${output}/home-loaded.png` });

  // The routine tick reads a figure already on screen: no pulse.
  await page.evaluate(() => { window.page.updateWalletBalance({ preferCached: true }); });
  await page.waitForFunction(() => window.pending.length === 1);
  await page.waitForTimeout(300);
  assert.equal(await pulsing(home), false, 'the routine tick stays quiet');
  await page.evaluate(() => window.release());

  // Wallet sheet: each refreshed wallet pulses; one never loaded shows a placeholder.
  await page.evaluate(() => { window.page.openWalletManagement(); });
  await page.waitForFunction(() => window.sheetRefreshes.length === 2);
  assert.deepEqual(await page.evaluate(() => window.sheetRefreshes.sort()), ['business', 'savings'], 'the active Spark wallet and the NWC wallet');
  const row = name => `.wallet-switch-card:has(.switch-name:text-is("${name}")) .switch-balance`;
  const rowPulsing = name => page.locator(row(name)).evaluate(el => el.getAnimations().some(a => a.effect.getComputedTiming().iterations === Infinity));
  await page.locator(row('Business')).waitFor();
  assert.ok(await rowPulsing('Business'), 'a refreshing wallet pulses in the sheet');
  assert.ok(await rowPulsing('Savings'));
  assert.equal(await page.locator(`${row('Savings')} .balance-placeholder`).count(), 1, 'never loaded: a placeholder, not a number');
  assert.equal(await rowPulsing('Personal'), false, 'the inactive Spark wallet is not refreshed here, so it stays still');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${output}/sheet-refreshing.png` });
  await page.evaluate(() => window.release());
  await page.waitForFunction(() => Object.values(window.page.refreshingWalletIds).every(v => !v));
  await page.locator(row('Savings')).evaluate(el => new Promise(resolve => {
    const done = () => (el.getAnimations().length === 0 ? resolve() : requestAnimationFrame(done));
    done();
  }));
  assert.equal(await page.locator(`${row('Savings')} .balance-placeholder`).count(), 0);

  assert.deepEqual(errors, []);
  console.log('PASS: the home balance pulses until it is loaded and while a refresh is awaited, stays still on the routine tick; the wallet sheet pulses per refreshing wallet with a placeholder for one never loaded. No network, no funds.');
} finally {
  await browser.close();
}
