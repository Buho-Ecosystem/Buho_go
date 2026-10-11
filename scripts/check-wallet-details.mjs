// Local, isolated wallet-management review. No real wallets or connections.
// Start `npm run dev -- --port 9012` (or set WALLET_DETAIL_BASE_URL), then run this.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.WALLET_DETAIL_BASE_URL || 'http://localhost:9012';
const output = 'output/wallet-details';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'warning' && message.text().includes('[Vue warn]')) errors.push(message.text().slice(0, 200));
});
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
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
  // Saved wallets so the router opens Settings; the test reshapes them below.
  const wallets = [
    { id: 'arkade', type: 'arkade', name: 'Arkade', connectionData: { encryptedMnemonic: 'x' }, metadata: { cachedBalance: 2094 } },
    { id: 'spark', type: 'spark', name: 'Spark Privat 2', connectionData: { accountNumber: 2, network: 'MAINNET', encryptedMnemonic: 'x' }, metadata: { cachedBalance: 0, lud16: 'privat@btc.mybuho.de' } },
    { id: 'nwc', type: 'nwc', name: 'My Lightning wallet', nwcUrl: 'nostr+walletconnect://example', metadata: { cachedBalance: 321 } },
    { id: 'lnbits', type: 'lnbits', name: 'LNbits', connectionData: { serverUrl: 'https://lnbits.invalid', adminKey: 'k' }, metadata: { cachedBalance: 4500 } },
  ];
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets, activeWalletId: 'arkade', biometricsEnabled: false, sparkModelVersion: 2 }));
});
const panel = page.locator('.wallet-detail-panel');
const row = id => page.locator(`[data-wallet-id="${id}"]`);
const shot = name => page.screenshot({ path: `${output}/${name}.png` });
async function back() { await panel.getByRole('button', { name: 'Back', exact: true }).click(); await panel.waitFor({ state: 'detached' }); }

try {
  await page.goto(`${base}/#/settings`);
  await page.locator('.settings-page').waitFor();
  await page.evaluate(async () => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const store = useWalletStore();
    store.activeWalletId = 'arkade';
    store.connectionStates = { arkade: { connected: true }, spark: { connected: false }, nwc: { connected: false, error: 'Connection unavailable. Please try again.' }, lnbits: { connected: true } };
    store.switchActiveWallet = async id => {
      store.walletSwitching = true;
      window.switchTarget = id;
      await new Promise(resolve => { window.finishSwitch = resolve; });
      store.activeWalletId = id;
      store.connectionStates[id] = { connected: true };
      store.walletSwitching = false;
    };
    store.connectWallet = async id => { window.reconnectTarget = id; store.connectionStates[id] = { connected: true }; };
    store.connectSparkWallet = async id => { window.reconnectTarget = id; store.connectionStates[id] = { connected: true }; };
    await store.persistState();
  });
  await page.locator('.settings-page').getByText('Manage Wallets', { exact: true }).click();
  await row('arkade').click();
  assert.equal(await page.locator('.q-dialog[aria-modal="true"]').count(), 1);
  assert.equal(await panel.locator('input').count(), 0, 'opening details must not focus an editable title');
  assert.match(await panel.locator('.detail-active').textContent(), /Active$/);
  await page.evaluate(() => document.fonts.ready);
  for (const dark of [false, true]) {
    await page.evaluate(dark => window.__audit.setDark(dark), dark);
    await page.waitForTimeout(200);
    await shot(`arkade-${dark ? 'dark' : 'light'}`);
  }
  await panel.getByRole('button', { name: 'Rename wallet' }).click();
  await panel.getByLabel('Wallet Name', { exact: true }).fill('Discard this');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await panel.locator('h2').textContent(), 'Arkade');
  await panel.getByRole('button', { name: 'Rename wallet' }).click();
  await panel.getByLabel('Wallet Name', { exact: true }).fill('  ');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await panel.getByRole('alert').waitFor();
  await panel.getByLabel('Wallet Name', { exact: true }).fill('Travel wallet');
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'buhoGO_wallet_store') throw new DOMException('Test storage full', 'QuotaExceededError');
      return window.originalSetItem.call(this, key, value);
    };
  });
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await panel.getByText("Couldn't save wallet name", { exact: true }).waitFor();
  assert.equal(await panel.locator('h2').textContent(), 'Arkade');
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await panel.locator('input').waitFor({ state: 'detached' });
  assert.equal(await panel.locator('h2').textContent(), 'Travel wallet');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('buhoGO_wallet_store')).wallets.find(w => w.id === 'arkade').name), 'Travel wallet');
  await back();
  assert.equal(await row('arkade').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Enter');
  await panel.waitFor();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.q-dialog[aria-modal="true"]').count(), 1);
  console.log('PASS: one sheet, deliberate editing, cancel, validation, durable rename, storage-error recovery and keyboard Back');

  await row('spark').click();
  // Every Spark wallet stays live, so an offline one reconnects from here too.
  assert.equal(await panel.getByRole('button', { name: 'Reconnect', exact: true }).count(), 1);
  assert.equal(await panel.getByText('privat@btc.mybuho.de', { exact: true }).count(), 1, 'the wallet\'s own Lightning address');
  for (const dark of [false, true]) {
    await page.evaluate(dark => window.__audit.setDark(dark), dark);
    await page.waitForTimeout(200);
    await shot(`spark-${dark ? 'dark' : 'light'}`);
  }
  await panel.getByRole('button', { name: 'Use this wallet' }).click();
  assert.equal(await panel.getByRole('button', { name: 'Use this wallet' }).isDisabled(), true);
  await page.evaluate(() => window.finishSwitch());
  await panel.locator('.detail-active').waitFor();
  assert.equal(await page.evaluate(() => window.switchTarget), 'spark');
  await back();
  await row('nwc').click();
  await panel.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await panel.getByRole('button', { name: 'Reconnect', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.reconnectTarget), 'nwc');
  await panel.getByRole('button', { name: 'Remove Wallet', exact: true }).click();
  await page.locator('.danger-confirm-card').waitFor();
  assert.equal(await page.evaluate(async () => (await import('/src/stores/wallet.js')).useWalletStore().wallets.length), 4);
  await page.locator('.danger-confirm-card').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.danger-confirm-card').waitFor({ state: 'detached' });
  console.log('PASS: correct switch/reconnect targets, busy state, Spark reconnect and address, and removal confirmation preserved');

  await page.evaluate(async () => {
    const store = (await import('/src/stores/wallet.js')).useWalletStore();
    store.wallets.find(w => w.id === 'nwc').name = 'Eine sehr lange Wallet-Bezeichnung für Reisen und gemeinsame Ausgaben';
    store.balanceHidden = true;
    (await import('/src/boot/i18n.js')).i18n.global.locale = 'de';
    const { toastItems, toastController } = await import('/src/services/toasts.js');
    toastItems.value.forEach(toast => toastController.dismiss(toast.id));
    document.documentElement.style.fontSize = '24px';
    document.documentElement.style.setProperty('--safe-bottom', '34px');
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await panel.locator('.detail-danger').scrollIntoViewIfNeeded();
  const metrics = await panel.evaluate(node => ({
    width: node.getBoundingClientRect().width,
    scrollWidth: node.scrollWidth,
    controls: [...node.querySelectorAll('button')].map(button => button.getBoundingClientRect().height),
    balance: node.querySelector('.detail-balance').textContent.trim(),
  }));
  assert.ok(metrics.width <= 320 && metrics.scrollWidth <= 320);
  assert.ok(metrics.controls.every(height => height >= 44));
  assert.equal(metrics.balance, '••••');
  await shot('large-text-german-privacy');
  await panel.locator('.detail-content').evaluate(node => { node.scrollTop = 0; });
  await shot('large-text-german-top');
  console.log('PASS: long names, larger text, German, 320px layout, safe-area spacing and hidden balance');
  await page.evaluate(async () => {
    const store = (await import('/src/stores/wallet.js')).useWalletStore();
    store.wallets.find(w => w.id === 'nwc').name = 'My Lightning wallet';
    store.balanceHidden = false;
    (await import('/src/boot/i18n.js')).i18n.global.locale = 'es';
    document.documentElement.style.removeProperty('font-size');
    document.documentElement.style.removeProperty('--safe-bottom');
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  for (const dark of [false, true]) {
    await page.evaluate(dark => window.__audit.setDark(dark), dark);
    await page.waitForTimeout(200);
    const width = await panel.evaluate(node => node.getBoundingClientRect().width);
    assert.ok(width <= 560);
    await shot(`desktop-es-${dark ? 'dark' : 'light'}`);
  }
  console.log('PASS: bounded desktop sheet in both themes and Spanish');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
