/** Controlled browser check for the Spark status line and its help sheet (#381).
 * Start `pnpm dev --port 9031` first (or set SPARK_STATUS_BASE_URL). Every
 * external request is blocked; reachability verdicts are fed straight into
 * the app's own record, so each level renders exactly as a user sees it. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.SPARK_STATUS_BASE_URL || 'http://localhost:9031';
const output = process.env.SPARK_STATUS_OUTPUT || new URL('../output/spark-status', import.meta.url).pathname;
await mkdir(output, { recursive: true });

// Published BIP-39 all-zero test vector sealed with a fixed test-only key (see check-emergency-exit.mjs).
const AUDIT_DEVICE_KEY = 'DRQbIikwNz5FTFNaYWhvdn2Ei5KZoKeutbzDytHY3+Y=';
const AUDIT_SEED_ENVELOPE = 'AQIDBAUGBwgJCgsM5oeZavUf7bRrnLvfrRnjlmYhzZU1ngV33uyJHLa6BRi0XiXABbXW2piRbwX6+3otDTRGQaMsYbx7QIHyaSfxKE7Qpac/6BPd+mj7Cl3m4ODzaCnB384XShC+E5DD5KnMaTm2DzlNtXmT8dL23g==';
const PERSONAL = 'spark-personal-1';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'mempool.space' && url.pathname.endsWith('/prices')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ USD: 95000, EUR: 85000 }) });
  }
  const passthrough = ['fonts.googleapis.com', 'fonts.gstatic.com'];
  return url.origin === base || passthrough.includes(url.hostname) ? route.continue() : route.abort();
});
await page.routeWebSocket('**', socket => {
  if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
  else socket.close();
});
await page.addInitScript(({ key, seed }) => {
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buho-theme-mode', 'light');
  localStorage.setItem('buhoGO_device_key', key);
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({
    wallets: [
      { id: 'spark-personal-1', name: 'Personal', type: 'spark', balance: 0, metadata: { hasBackedUp: true, sparkAddress: 'spark1personaltestaddress' }, connectionData: { accountNumber: 2, network: 'MAINNET', encryptedMnemonic: seed } },
    ],
    activeWalletId: 'spark-personal-1', preferredFiatCurrency: 'EUR', defaultDisplayCurrency: 'sats', denominationCurrency: 'sats',
    exchangeRates: { EUR: 85000 }, exchangeRatesAvailable: true, exchangeRatesLastUpdate: Date.now(), hasBackedUp: true, biometricsEnabled: false,
  }));
  const now = Date.now();
  localStorage.setItem('buhoGO_exit_kit_v1', JSON.stringify({ v: 1, kits: { 'spark-personal-1': {
    walletId: 'spark-personal-1', network: 'mainnet', checkedAt: now, exportedAt: now, feeRate: 3, recoverableSat: 48210, notWorthSat: 0,
    feeSat: 4250, fundingSat: 3500, arrivesSat: 43960, balanceSat: 48210, leafCount: 3,
    destinationAddress: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', fundingAddress: 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',
  } } }));
}, { key: AUDIT_DEVICE_KEY, seed: AUDIT_SEED_ENVELOPE });

let n = 0;
async function shot(name) {
  await page.waitForTimeout(450);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  console.log('shot', file);
}
const go = path => page.evaluate(p => window.__audit.app.config.globalProperties.$router.push(p), path);
const line = page.locator('[data-audit="spark-status-line"]');

/** Put the app's own reachability record into a level, as real checks would. */
const setLevel = (level, { status = null } = {}) => page.evaluate(async ({ level, status }) => {
  const { sparkReachability, VERDICT, STORAGE_KEY } = await import('/src/utils/sparkReachability.js');
  const store = sparkReachability();
  store.clear();
  const realNow = Date.now;
  const at = (ms) => { Date.now = () => realNow() + ms; };
  try {
    if (level === 'answered') store.record(VERDICT.ANSWERED);
    if (level === 'no-internet') store.record(VERDICT.NO_INTERNET);
    if (level === 'unreachable' || level === 'long') {
      if (level === 'long') {
        // Two earlier sessions over a day, then this one.
        const t = realNow();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ firstDownAt: t - 26 * 3600e3, lastDownAt: t - 10 * 60e3, observedMs: 40 * 60e3, sessions: ['earlier-1', 'earlier-2'], lastAnsweredAt: null }));
        store.newSession('this-session');
      }
      at(-3 * 60e3);
      store.record(VERDICT.SPARK_DOWN);
      Date.now = realNow;
      store.record(VERDICT.SPARK_DOWN);
    }
  } finally {
    Date.now = realNow;
  }
  store.setStatus(status);
  return store.snapshot().level;
}, { level, status });

/** What a Spark wallet shows while unreachable: its local figure, out of date. */
const localBalance = () => page.evaluate(id => {
  const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
  store.applyBalance(id, 48210, { source: 'cache', fresh: false, error: 'Spark did not answer the sync' });
}, PERSONAL);

const openSheet = async () => {
  await line.click();
  await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
};
/** Long sheets scroll: show their end, where the exit part sits. */
const sheetEnd = () => page.locator('.spark-sheet').evaluate(el => el.scrollTo(0, el.scrollHeight));
const closeSheet = async () => {
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForTimeout(400);
};

try {
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => !!window.__audit?.app?._instance, null, { timeout: 120000 });
  await page.locator('.amount-number').first().waitFor({ timeout: 60000 });
  await localBalance();

  assert.equal(await setLevel('answered'), 0);
  await page.waitForTimeout(300);
  assert.equal(await line.count(), 0, 'nothing while Spark answers');
  assert.equal(await page.getByRole('button', { name: /^Emergency exit/ }).count(), 0);
  await shot('home-all-good');
  console.log('✓ nothing on Home while Spark answers');

  assert.equal(await setLevel('no-internet'), 1);
  await page.getByText('No internet connection', { exact: true }).waitFor();
  await shot('home-no-internet');
  await openSheet();
  await page.getByText('Things to check', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  await shot('sheet-no-internet');
  await closeSheet();
  console.log('✓ no internet: line, sheet with things to check, Try again');

  // Home mounting while a status is already showing (opening the app
  // offline) must render in full: nothing may translate during setup.
  await go('/security');
  await page.getByRole('button', { name: /^Emergency exit kit/ }).waitFor();
  await go('/wallet');
  await page.locator('.amount-number').first().waitFor({ timeout: 60000 });
  await page.getByText('No internet connection', { exact: true }).waitFor();
  console.log('✓ Home mounts in full with a status already showing');

  assert.equal(await setLevel('unreachable', { status: 'major' }), 2);
  await page.getByText("Spark can't be reached", { exact: true }).waitFor();
  await shot('home-spark-unreachable');
  await openSheet();
  await page.getByText('Spark reports an outage', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-audit="spark-status-exit"]').count(), 0, 'no exit in a short outage');
  await shot('sheet-spark-unreachable');
  await closeSheet();

  assert.equal(await setLevel('unreachable', { status: 'operational' }), 2);
  await openSheet();
  await page.getByText('Spark reports no problem', { exact: true }).waitFor();
  await shot('sheet-blocked-here');
  await closeSheet();
  console.log('✓ Spark unreachable: no exit; "operational" points at this network');

  assert.equal(await setLevel('long', { status: 'operational' }), 2, 'operational never reaches the exit');
  assert.equal(await setLevel('long', { status: 'major' }), 3);
  await page.getByText(/^Spark unreachable since /).waitFor();
  await shot('home-long-outage');
  await openSheet();
  await page.locator('[data-audit="spark-status-exit"]').waitFor();
  await page.getByText('About 4,250 sats in network fees', { exact: true }).waitFor();
  await shot('sheet-long-outage');
  await sheetEnd();
  await shot('sheet-long-outage-end');
  await page.locator('[data-audit="spark-status-exit"]').click();
  await page.locator('.exit-kit-sheet').waitFor();
  assert.ok(page.url().includes('/security'));
  await shot('exit-kit-from-sheet');
  await page.keyboard.press('Escape');
  await page.locator('.exit-kit-sheet').waitFor({ state: 'detached' });
  console.log('✓ long outage: exit row with the kit figures, leading to Security');

  await page.evaluate(id => {
    window.__audit.app.config.globalProperties.$pinia._s.get('exitKit').upsert(id, { recoverableSat: 3900, feeSat: 4250, arrivesSat: 0, notWorthSat: 2500 });
  }, PERSONAL);
  await go('/wallet');
  await page.locator('.amount-number').first().waitFor({ timeout: 60000 });
  await localBalance();
  await setLevel('long', { status: 'major' });
  await openSheet();
  await page.getByText(/waiting is the better choice/).waitFor();
  assert.equal(await page.locator('[data-audit="spark-status-exit"]').count(), 0, 'no way in when it is not worth it');
  await sheetEnd();
  await shot('sheet-long-outage-not-worth');
  await closeSheet();
  console.log('✓ not worth it: says so, offers no way in');

  await page.evaluate(() => window.__audit.setDark(true));
  await setLevel('unreachable', { status: 'major' });
  await shot('home-spark-unreachable-dark');
  await openSheet();
  await shot('sheet-spark-unreachable-dark');
  await closeSheet();
  console.log('✓ dark theme');

  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} catch (error) {
  console.log('page errors:', [...new Set(errors)]);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
