/**
 * Offline send check. A phone whose network reaches nothing (a VPN that
 * blocked all traffic, reported 2026-10-15) still shows every icon, can
 * leave the send sheet, and is told why the payment cannot go through:
 * offline, no internet, or Spark down. Start `npx quasar dev --port 9052`
 * first. External requests are blocked or scripted; no wallet keys,
 * invoices that can be paid, or payments are used.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { InvoiceLedger } from './fixtures/contactChat.mjs';

const base = process.env.OFFLINE_SEND_BASE_URL || 'http://localhost:9052';
const output = process.env.OFFLINE_SEND_OUTPUT || 'output/offline-send';
await mkdir(output, { recursive: true });

// The Spark SDK's own failure when nothing answered, as the user reported it.
const SPARK_UNREACHABLE = 'SparkSdkError: Service error: service provider error: authentication error: '
  + 'network error: Request error: error sending request : JsValue(TypeError: Failed to fetch)';
const ICON_HOSTS = ['api.iconify.design', 'api.simplesvg.com', 'api.unisvg.com'];
const PROBE_HOSTS = ['go.mybuho.de', 'mempool.space'];
const SAYS = {
  checking: 'Checking your connection...',
  noInternet: 'No internet connection. Check your Wi-Fi, mobile data or VPN, then try again.',
  sparkDown: "Spark can't be reached right now. Your internet works, so try again in a moment.",
  offline: "You're offline. Connect to Wi-Fi or mobile data, then try again.",
};

const ledger = new InvoiceLedger();
const walletStore = {
  wallets: [{ id: 'w-spark', type: 'spark', name: 'Personal', connectionData: { encryptedMnemonic: 'audit-fixture-not-a-seed' } }],
  activeWalletId: 'w-spark',
  biometricsEnabled: false,
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.setDefaultNavigationTimeout(120000);
page.setDefaultTimeout(30000);
const errors = [];
// The dev server's HMR client throws on its closed socket; that noise is not the app.
page.on('pageerror', (error) => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });

// Nothing outside the dev server answers, except the two connection probes
// once `internet` is on (the internet works, Spark does not).
const seen = { icons: [], probes: [] };
let internet = false;
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.origin === base) return route.continue();
  if (ICON_HOSTS.includes(url.hostname)) seen.icons.push(url.href);
  if (PROBE_HOSTS.includes(url.hostname) && url.pathname === '/') {
    seen.probes.push(`${route.request().method()} ${url.href}`);
    if (internet) return route.fulfill({ status: 200, body: '' });
  }
  return route.abort('internetdisconnected');
});
await page.routeWebSocket('**', (socket) => {
  if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
  else socket.close();
});
await page.addInitScript((walletStore) => {
  window.__AUDIT__ = { theme: 'light' };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify(walletStore));
  localStorage.setItem('buhoGO_wallet_state', JSON.stringify({ balance: 10000, activeWalletId: 'w-spark', connectedWallets: [] }));
}, walletStore);

/** A Spark wallet whose every request fails the way the report's did. */
async function seedUnreachableSpark() {
  await page.evaluate(async (raw) => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const store = useWalletStore();
    const unreachable = async () => { throw new Error(raw); };
    const provider = {
      isConnected: true,
      getBalance: async () => 10000,
      getTransactions: async () => [],
      getLightningSendFeeEstimate: unreachable,
      payInvoice: unreachable,
    };
    store.providers = { 'w-spark': provider };
    store.connectionStates = { 'w-spark': { connected: true } };
    store.applyBalance('w-spark', 10000);
    const providerOf = async () => provider;
    store.ensureSparkConnected = providerOf;
    store.ensureWalletConnectedForTransfer = providerOf;
    store.refreshWalletData = async () => {};
    store.connectAllSparkWallets = async () => {};
  }, SPARK_UNREACHABLE);
}

const sheet = page.locator('.sheet-card:not(.sheet-card--redeem)');
const notice = sheet.locator('.wallet-hint[role="status"]');
const dialog = page.locator('.error-dialog');

/** The chat's pay hand-over: the wallet page opens the sheet, then clears its URL. */
async function openSheet() {
  const { bolt11 } = ledger.mint({ amountSats: 6 });
  await page.evaluate((invoice) => {
    location.hash = `#/wallet?action=pay_contact&addressType=invoice&contactName=Axel&address=${invoice}`;
  }, bolt11);
  await sheet.waitFor();
  await page.waitForFunction(() => !location.hash.includes('action='));
  // Slid in and settled, so gestures land on it.
  await page.waitForFunction(() => document.querySelector('.sheet-top')?.getBoundingClientRect().bottom < innerHeight);
  await page.waitForTimeout(400);
}

/** Send, and read what the error says once its connection check is done. */
async function sendAndRead() {
  await sheet.getByRole('button', { name: /^Send .*sats$/ }).click();
  await dialog.waitFor();
  await page.waitForFunction((checking) => document.querySelector('.error-dialog .error-reason')?.textContent.trim() !== checking, SAYS.checking);
  return (await dialog.locator('.error-reason').textContent()).trim();
}

/** A finger's pace: Quasar ignores moves in the same millisecond as the press. */
async function swipeDown(locator) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.waitForTimeout(12);
    await page.mouse.move(x, y + step * 20);
  }
  await page.mouse.up();
}

/** The sheet's own Back handler, as Android's Back button calls it. */
const pressBack = () => page.evaluate(() => {
  let vm = document.querySelector('.sheet-card').__vueParentComponent;
  while (vm && !vm.ctx.onBackButton) vm = vm.parent;
  vm.ctx.onBackButton();
});

try {
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => !!window.__audit?.app?._instance, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await seedUnreachableSpark();

  // 1. Icons ship with the app: with nothing reachable, Home's Tabler icons
  //    (the map, the wallet chip's chevron) draw. A downloaded set would draw
  //    none. Every name in the code is checked by iconify.spec.js.
  for (const selector of ['svg.header-icon', 'svg.wallet-chip-disclosure']) {
    assert.ok(await page.locator(`${selector} path`).count() > 0, `${selector} draws`);
  }
  await page.screenshot({ path: `${output}/home-offline.png` });
  console.log('✓ icons draw with no network');

  // 2. No internet: the sheet stays open after the hand-over clears its URL, its
  //    back arrow draws, it says why before the slide, and shows no guessed fee.
  await openSheet();
  assert.ok(await sheet.locator('.top-btn svg path').count() > 0, 'the back arrow draws');
  await notice.waitFor();
  assert.equal((await notice.textContent()).trim(), SAYS.noInternet);
  assert.equal(await sheet.locator('.fee-row').count(), 0, 'no guessed fee');
  await page.screenshot({ path: `${output}/sheet-no-internet.png` });
  console.log('✓ no internet: said in the sheet before the slide, no guessed fee');

  assert.equal(await sendAndRead(), SAYS.noInternet);
  await page.screenshot({ path: `${output}/dialog-no-internet.png` });
  console.log('✓ no internet: the error says so');

  // 3. Back belongs to the dialog above the sheet; then it closes the sheet.
  await pressBack();
  await page.waitForTimeout(400);
  assert.equal(await sheet.count(), 1, 'Back with the error open leaves the sheet');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await dialog.waitFor({ state: 'detached' });
  await pressBack();
  await sheet.waitFor({ state: 'detached' });
  console.log('✓ Back: not while an error sits above the sheet, then it closes it');

  // 4. Swipe down on the header closes the sheet.
  await openSheet();
  await swipeDown(sheet.locator('.sheet-top'));
  await sheet.waitFor({ state: 'detached' });
  console.log('✓ swipe down on the header closes the sheet');

  // 5. The internet works, Spark does not.
  internet = true;
  await openSheet();
  await notice.waitFor();
  assert.equal((await notice.textContent()).trim(), SAYS.sparkDown);
  assert.equal(await sendAndRead(), SAYS.sparkDown);
  await page.screenshot({ path: `${output}/dialog-spark-down.png` });
  await dialog.getByRole('button', { name: 'OK' }).click();
  console.log('✓ Spark down: said as Spark, with the internet working');

  // 6. No network at all.
  await context.setOffline(true);
  assert.equal(await sendAndRead(), SAYS.offline);
  await page.screenshot({ path: `${output}/dialog-offline.png` });
  await context.setOffline(false);
  console.log('✓ offline: said as offline');

  // 7. Probes are bare HEAD requests; no icon was ever fetched.
  assert.ok(seen.probes.length > 0);
  assert.ok(seen.probes.every((p) => /^HEAD https:\/\/(go\.mybuho\.de|mempool\.space)\/$/.test(p)), seen.probes.join('\n'));
  assert.deepEqual(seen.icons, []);
  assert.deepEqual(errors, []);
  console.log(`✓ ${seen.probes.length} probes, all bare HEAD; no icon requests; no page errors`);
  console.log('Offline send: icons, leaving the sheet, and offline / no internet / Spark down passed.');
} finally {
  await browser.close();
}
