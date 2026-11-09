/** Browser check for South African till codes in the Send sheet: what a typed
 * address does, what the camera does, and that a crafted code cannot freeze the
 * app. The provider and the example Lightning address are local stand-ins, so
 * nothing leaves the machine. The camera is stood in for by the same handler
 * its `scanned` event calls.
 * Start `npx quasar dev --port 9047` first (or set MERCHANT_QR_BASE_URL). */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.MERCHANT_QR_BASE_URL || 'http://localhost:9047';

const TILL_CODE = '00020129530023za.co.electrum.picknpay0122TSHP6SJNKTR3IY/confirm520458125303710540115802ZA5916cryptoqrtestscan6002CT6304821D';
const CRAFTED = `1.zap.pe${'a'.repeat(2038)}\rX`;
const WARNING = 'SA Retailer QR detected';

const browser = await chromium.launch({ headless: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function open() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  const lookups = [];
  page.on('pageerror', (error) => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/.well-known/lnurlp/')) {
      lookups.push(url.href);
      return route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: {
          tag: 'payRequest',
          callback: `${url.origin}/callback`,
          minSendable: 1000,
          maxSendable: 100000000,
          metadata: '[["text/plain","Pick n Pay"]]',
        },
      });
    }
    return url.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.iconify.design'].includes(url.hostname)
      ? route.continue()
      : route.abort();
  });
  await page.routeWebSocket('**', (socket) => {
    if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
    else socket.close();
  });
  await page.addInitScript(() => {
    window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
  });
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => window.__audit?.app?.config?.globalProperties?.$pinia, null, { timeout: 90000 });
  await page.evaluate(() => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    store.$patch({ savedStateLoaded: true, isInitialized: true });
    store.wallets = [{ id: 'main', type: 'spark', name: 'Main', metadata: {}, createdAt: 1, lastUsed: 1 }];
    store.activeWalletId = 'main';
    store.hasBackedUp = true;
    store.connectionStates.main = { connected: true, error: null };
    store.balanceStates.main = { value: 184250, known: true, source: 'sync', verifiedAt: Date.now(), updatedAt: Date.now() };
    store.refreshBalance = async () => {};
    window.__audit.app.config.globalProperties.$router.push('/wallet');
  });
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some((el) => {
    for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'WalletPage') return true;
    return false;
  }), null, { timeout: 30000 });
  await pause(800);
  return { page, context, errors, lookups };
}

async function openSend(page) {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((node) => {
      for (let c = node.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'WalletPage') return true;
      return false;
    });
    let c = el.__vueParentComponent;
    while (c.type?.name !== 'WalletPage') c = c.parent;
    c.proxy.openSend();
  });
  await page.locator('[data-audit="send-input"]').waitFor();
  await pause(300);
}

/** What the camera does on a read: the `scanned` event's own handler. */
const scan = (page, text) => page.evaluate(async (value) => {
  const input = document.querySelector('[data-audit="send-input"]');
  let c = input.__vueParentComponent;
  while (c && c.type?.name !== 'SendModal') c = c.parent;
  const started = performance.now();
  await c.proxy.onQRDetect(value);
  return performance.now() - started;
}, text);

const warning = (page) => page.getByText(WARNING).count();

{
  const { page, context, errors, lookups } = await open();
  await openSend(page);
  await page.locator('[data-audit="send-input"]').fill('snapscan@example.com');
  await page.locator('[data-audit="send-continue"]').click();
  await pause(1200);
  assert.equal(await warning(page), 0, 'a Lightning address named after a retailer is not a till code');
  assert.ok(lookups.some((url) => url.includes('/.well-known/lnurlp/snapscan')), 'the address itself is resolved');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  typed snapscan@example.com resolves as an address');
}

{
  const { page, context, errors } = await open();
  await openSend(page);
  await page.locator('[data-audit="send-input"]').fill('0821234567');
  await pause(500);
  assert.equal(await page.locator('[data-audit="send-continue"]').count(), 0, 'a typed number offers nothing to continue');
  assert.equal(await warning(page), 0, 'a typed number shows no retailer warning');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  typed ten digits stay a number');
}

{
  const { page, context, errors, lookups } = await open();
  await openSend(page);
  await scan(page, TILL_CODE);
  await pause(1200);
  assert.equal(await warning(page), 0, 'a shop the provider takes shows no warning');
  assert.equal(lookups.length, 1);
  assert.ok(lookups[0].includes('TSHP6SJNKTR3IY%2Fconfirm'), 'the code goes out encoded once, with its case');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  scanned shop code goes to the provider');
}

for (const [code, shop] of [['0821234567', 'Scan to Pay'], ['https://pos.snapscan.io/qr/TEST', 'SnapScan']]) {
  const { page, context, errors, lookups } = await open();
  await openSend(page);
  await scan(page, code);
  await pause(600);
  assert.equal(await warning(page), 1, `${code} still gets the retailer warning`);
  assert.equal(await page.getByText(`${shop} - not yet supported`).count(), 1);
  assert.deepEqual(lookups, []);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`ok  scanned ${code} says ${shop} is not yet supported`);
}

{
  const { page, context, errors } = await open();
  await openSend(page);
  const elapsed = await scan(page, CRAFTED);
  assert.ok(elapsed < 500, `took ${Math.round(elapsed)} ms`);
  assert.equal(await page.evaluate(() => 1 + 1), 2);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`ok  crafted code answered in ${Math.round(elapsed)} ms`);
}

await browser.close();
console.log('All merchant QR checks passed.');
