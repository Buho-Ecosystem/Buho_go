// Real app/store/components with scripted wallets. No production connections or funds.
// Start npm run dev -- --port 9024, then node scripts/check-arkade.mjs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { ArkAddress } from '@arkade-os/sdk';

const base = process.env.ARKADE_BASE_URL || 'http://localhost:9024';
const output = process.env.ARKADE_OUTPUT || 'output/arkade-reliability';
await mkdir(output, { recursive: true });
const bitcoinAddress = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const arkadeAddress = new ArkAddress(new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)).encode();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
const shot = async name => {
  await page.waitForTimeout(400); // Quasar's sheet/menu entrance transition
  await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
};
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') return route.fulfill({ contentType: 'application/json', body: '{"USD":85000,"EUR":78000}' });
  return url.origin === base || url.hostname === 'api.iconify.design' ? route.continue() : route.abort();
});
await page.routeWebSocket('**', socket => {
  if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
  else socket.close();
});
await page.addInitScript(() => {
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedText = text; } }, configurable: true });
});

async function openReceive() {
  await page.evaluate(() => { window.walletPage.showReceiveModal = true; });
  await page.locator('.receive-card .qr-code').waitFor();
  await page.evaluate(() => {
    let component = document.querySelector('.receive-card').__vueParentComponent;
    while (component && component.type.name !== 'ReceiveModal') component = component.parent;
    window.receiveModal = component.proxy;
    component.proxy.generatedInvoice = { amount: 2100, description: 'Lunch', payment_request: '' };
  });
}

try {
  await page.goto(`${base}/#/wallet`, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__audit?.app?._instance, null, { timeout: 120000 });
  await page.locator('.wallet-page-light, .wallet-page-dark').waitFor();
  await page.evaluate(async ({ bitcoinAddress, arkadeAddress }) => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const store = useWalletStore();
    store.wallets = [{ id: 'ark', type: 'arkade', name: 'Arkade', metadata: { arkadeAddress, hasBackedUp: true }, connectionData: { encryptedMnemonic: 'scripted' } }];
    store.activeWalletId = 'ark';
    store.connectionStates = { ark: { connected: true } };
    store.applyBalance('ark', 20000, { source: 'sync' });
    store.walletInfos = { ark: { arkadeAddress, type: 'arkade' } };
    window.arkadeRows = [];
    const provider = {
      isConnected: true,
      getBalance: async () => ({ balance: 20000 }),
      getInfo: async () => ({ arkadeAddress, type: 'arkade' }),
      getBoardingAddress: async () => bitcoinAddress,
      getTransactions: async () => window.arkadeRows,
      watchPayments: async callback => { window.arkadeEvent = callback; return { stop() { window.arkadeEvent = null; } }; },
      getBitcoinSendFeeEstimate: async ({ amount }) => ({ amount, fee: 130, total: amount + 130 }),
      offboardToBitcoin: async args => { window.arkadeSend = args; return { id: 'scripted-exit', status: 'completed', fee: 130 }; },
    };
    store.providers = { ark: provider };
    store.ensureArkadeConnected = async () => provider;
    store.refreshWalletData = async () => {};
    const { walletWatch, startWalletWatch } = await import('/src/services/walletWatch.js');
    window.arkadeWatch = walletWatch() || startWalletWatch(store, { getConfig: () => null });
    await window.arkadeWatch.check('ark');
    let component = document.querySelector('.wallet-page-light, .wallet-page-dark').__vueParentComponent;
    while (component && component.type.name !== 'WalletPage') component = component.parent;
    window.walletPage = component.proxy;
  }, { bitcoinAddress, arkadeAddress });

  for (const dark of [false, true]) {
    await page.evaluate(dark => window.__audit.setDark(dark), dark);
    await openReceive();
    await page.getByRole('button', { name: 'Copy payment code', exact: true }).click();
    assert.match(await page.evaluate(() => window.copiedText), /amount=0\.000021/);
    assert.match(await page.evaluate(() => window.copiedText), /ark=ark1/);
    await shot(`receive-${dark ? 'dark' : 'light'}`);
    await page.locator('.receive-card .cta').nth(1).click();
    await page.locator('.copy-menu').waitFor();
    await shot(`copy-${dark ? 'dark' : 'light'}`);
    await page.locator('.copy-menu .q-item').filter({ hasText: 'Payment request' }).click();
    assert.match(await page.evaluate(() => window.copiedText), /amount=0\.000021/);
    await page.locator('.receive-card .cta').nth(1).click();
    await page.locator('.copy-menu .q-item').filter({ hasText: 'Bitcoin address' }).click();
    assert.equal(await page.evaluate(() => window.copiedText), bitcoinAddress);
    await page.evaluate(() => { window.walletPage.showReceiveModal = false; });
    await page.locator('.receive-card').waitFor({ state: 'detached' });
  }
  console.log('PASS: full payment request and bare-address copying in both themes');

  await openReceive();
  await page.evaluate(async () => {
    window.arkadeRows = [{ id: 'spend', type: 'outgoing', status: 'completed', amount: 1000, timestamp: Math.floor(Date.now() / 1000) }];
    window.arkadeEvent({ type: 'vtxo', newVtxos: [], spentVtxos: [{ value: 1000 }] });
    await window.arkadeWatch.check('ark');
  });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.receiveModal.isPaymentConfirmed), false);
  await page.evaluate(async () => {
    window.arkadeRows = [{ id: 'boarding', type: 'incoming', status: 'pending', amount: 1000, timestamp: Math.floor(Date.now() / 1000) }];
    window.arkadeEvent({ type: 'utxo', coins: [{ value: 1000, status: { confirmed: false } }] });
    await window.arkadeWatch.check('ark');
  });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.receiveModal.isPaymentConfirmed), false);
  await page.evaluate(async () => {
    window.arkadeRows[0].status = 'completed';
    window.arkadeEvent({ type: 'vtxo', newVtxos: [{ value: 1000 }] });
    await window.arkadeWatch.check('ark');
  });
  await page.waitForFunction(() => window.receiveModal.isPaymentConfirmed);
  assert.equal(await page.evaluate(() => window.receiveModal.confirmedAmount), 1000, 'actual receipt, not the requested 2100');
  await page.evaluate(() => { window.receiveModal.showPaymentConfirmation = false; });
  await page.waitForTimeout(300);
  console.log('PASS: spend and pending deposit do not confirm; completed incoming shows its real amount');

  await page.evaluate(async bitcoinAddress => {
    await window.walletPage.onPaymentDetected({ type: 'bitcoin_address', data: bitcoinAddress, fixedAmountSats: 2100, sendingWalletId: 'ark' });
  }, bitcoinAddress);
  await page.locator('.sheet-card').waitFor();
  await page.waitForFunction(() => window.walletPage.sendSheetCommitGate);
  assert.equal(await page.locator('.sheet-card .fee-row-value').innerText(), '130 sats');
  await page.waitForTimeout(5500); // let copy notifications leave the review screen
  for (const dark of [false, true]) {
    await page.evaluate(dark => window.__audit.setDark(dark), dark);
    await shot(`fee-${dark ? 'dark' : 'light'}`);
  }
  for (const locale of ['de', 'es']) {
    await page.evaluate(async locale => {
      const { i18n } = await import('/src/boot/i18n.js');
      i18n.global.locale = locale;
    }, locale);
    await page.setViewportSize({ width: 320, height: 740 });
    const bounds = await page.locator('.sheet-card .fee-row').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 321);
    assert.equal(await page.locator('.sheet-card .fee-row-value').innerText(), '130 sats');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: exact-payout fee review in both themes and narrow German/Spanish layouts; no page errors');
} finally {
  await browser.close();
}
