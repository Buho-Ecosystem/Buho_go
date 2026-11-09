/** Browser check for South African till codes in the Send sheet: what a typed
 * address does, what the camera does, that a scanned `tel:` link is the
 * phone number it calls, and that a crafted code cannot freeze the app. The provider and the example Lightning address are local stand-ins, so
 * nothing leaves the machine. The camera is stood in for by the same handler
 * its `scanned` event calls.
 * Start `npx quasar dev --port 9047` first (or set MERCHANT_QR_BASE_URL). */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { encodeTillCode } from '../src/utils/merchantQR.js';

const base = process.env.MERCHANT_QR_BASE_URL || 'http://localhost:9047';

const TILL_CODE = '00020129530023za.co.electrum.picknpay0122TSHP6SJNKTR3IY/confirm520458125303710540115802ZA5916cryptoqrtestscan6002CT6304821D';
const CRAFTED = `1.zap.pe${'a'.repeat(2038)}\rX`;

const browser = await chromium.launch({ headless: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** The browser, with every lookup answered by `answer` over a plain pay request. */
async function open({ answer = {} } = {}) {
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
          ...answer,
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

/** The lookups that went to the till provider. */
const tillLookups = (lookups) => lookups.filter((url) => new URL(url).hostname === 'cryptoqr.net');

{
  const { page, context, errors, lookups } = await open();
  await openSend(page);
  await page.locator('[data-audit="send-input"]').fill('snapscan@example.com');
  await page.locator('[data-audit="send-continue"]').click();
  await pause(1200);
  assert.deepEqual(tillLookups(lookups), [], 'a Lightning address named after a retailer is not a till code');
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
  assert.equal(await page.getByText('Pick n Pay').count(), 0, 'a typed number opens no till payment');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  typed ten digits stay a number');
}

{
  const { page, context, errors, lookups } = await open();
  await openSend(page);
  await scan(page, TILL_CODE);
  await pause(1200);
  assert.equal(lookups.length, 1);
  assert.equal(tillLookups(lookups).length, 1);
  assert.ok(lookups[0].includes('TSHP6SJNKTR3IY%2Fconfirm'), 'the code goes out encoded once, with its case');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  scanned shop code goes to the provider');
}

{
  // Everything that matches is sent at once: a Wi-Fi code that names a network stays on the phone.
  const { page, context, errors, lookups } = await open();
  await openSend(page);
  await scan(page, 'WIFI:T:WPA;S:snapscan-guest;P:hunter2;;');
  await pause(1200);
  assert.deepEqual(tillLookups(lookups), [], 'a Wi-Fi code never reaches the provider');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  scanned Wi-Fi code stays on the phone');
}

{
  // Ten digits that are also a Kenyan number: scanned, the till's. The till
  // asks for more than the wallet holds: a failure with only a notice, which
  // leaves the field open on the code. The field must not then read it as a
  // typed phone number and pay that.
  const { page, context, errors, lookups } = await open({ answer: { minSendable: 1000000000, maxSendable: 1000000000 } });
  await openSend(page);
  await scan(page, '0712345678');
  await pause(1500);
  assert.deepEqual(lookups.map((url) => new URL(url).hostname), ['cryptoqr.net'], 'one lookup, the till\'s');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  scanned 0712345678 goes to the till once, never to a phone payout');
}

{
  const { page, context, errors, lookups } = await open();
  await openSend(page);
  await page.locator('[data-audit="send-input"]').fill('0712345678');
  await pause(1500);
  assert.deepEqual(lookups.map((url) => new URL(url).hostname), ['bitcoin.co.ke'], 'typed, a Kenyan number');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  typed 0712345678 is a Kenyan phone payout');
}

{
  // A phone number in a QR code is a tel: link: the number it calls.
  const { page, context, errors, lookups } = await open();
  await openSend(page);
  await scan(page, 'tel:+254712345678');
  await pause(1500);
  assert.deepEqual(lookups.map((url) => new URL(url).hostname), ['bitcoin.co.ke'], 'a Kenyan phone payout');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  scanned tel:+254712345678 is a Kenyan phone payout');
}

{
  // Valid in Kenya, Zambia and Tanzania: the link's context says Zambia.
  const { page, context, errors, lookups } = await open();
  await openSend(page);
  await scan(page, 'tel:0751234567;phone-context=+260');
  await pause(1500);
  assert.deepEqual(lookups.map((url) => new URL(url).hostname), ['bitzed.xyz'], 'the country the link names');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  scanned tel:0751234567;phone-context=+260 is a Zambian phone payout');
}

// No payout service takes it, or the link does not say which country it is in.
for (const link of ['tel:+12125551212', 'tel:0712345678']) {
  const { page, context, errors, lookups } = await open();
  await openSend(page);
  await scan(page, link);
  await page.getByText("You can't pay this phone number").waitFor();
  await pause(800);
  assert.deepEqual(lookups, [], 'nothing looked up, nothing sent to the till provider');
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`ok  scanned ${link} says it can't be paid`);
}

for (const code of ['0821234567', 'https://pos.snapscan.io/qr/TEST', 'https://www.zapper.com/url/TEST']) {
  const { page, context, errors, lookups } = await open();
  await openSend(page);
  await scan(page, code);
  await pause(1200);
  assert.equal(tillLookups(lookups).length, 1, `${code} goes to the provider, which says whether it takes it`);
  assert.ok(tillLookups(lookups)[0].endsWith(`/.well-known/lnurlp/${encodeTillCode(code)}`), 'encoded once, as scanned');
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`ok  scanned ${code} goes to the provider`);
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
