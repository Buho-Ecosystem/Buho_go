/** Browser check for Mobile Money in the Send sheet: the country the person
 * picks decides a national number, a number it can't take says so in the
 * field, nothing goes to another country, and the chosen country stays while
 * its number resolves. Every lookup is answered locally.
 * Start `npx quasar dev --port 9047` first (or set MOBILE_MONEY_BASE_URL). */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.MOBILE_MONEY_BASE_URL || 'http://localhost:9047';

const browser = await chromium.launch({ headless: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** The wallet page, every lookup answered over a plain pay request after `delay` ms. */
async function open({ delay = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  const lookups = [];
  page.on('pageerror', (error) => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/.well-known/lnurlp/')) {
      lookups.push(url.href);
      if (delay) await pause(delay);
      return route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: { tag: 'payRequest', callback: `${url.origin}/callback`, minSendable: 1000, maxSendable: 100000000, metadata: '[["text/plain","Payout"]]' },
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

/** The Send sheet, in Mobile Money, with `country` chosen. */
async function mobileMoney(page, country) {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((node) => {
      for (let c = node.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'WalletPage') return true;
      return false;
    });
    let c = el.__vueParentComponent;
    while (c.type?.name !== 'WalletPage') c = c.parent;
    c.proxy.openSend();
  });
  await page.locator('[data-audit="send-mobile-money"]').click();
  await page.locator(`[data-audit="send-mm-country-${country}"]`).click();
  await pause(300);
}

const hosts = (lookups) => lookups.map((url) => new URL(url).hostname);

// Issue #479: a real Tanzanian number on Yas, and Kenyan on Safaricom.
{
  const { page, context, errors, lookups } = await open();
  await mobileMoney(page, 'tz');
  await page.locator('[data-audit="send-input"]').fill('0712345678');
  await pause(1500);
  assert.deepEqual(lookups, [], 'nothing looked up, in Kenya or anywhere');
  assert.equal(await page.locator('[data-audit="send-mm-unpayable"]').innerText(), "You can't pay this number in Tanzania · Vodacom M-Pesa only");
  assert.equal(await page.getByText('Kenya').count(), 1, 'Kenya shows only as its own country tile');
  assert.equal(await page.locator('[data-audit="send-continue"]').count(), 0, 'nothing to continue with');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  Tanzania chosen, 0712345678 says it can\'t be paid there and goes nowhere');
}

{
  const { page, context, errors, lookups } = await open();
  await mobileMoney(page, 'ke');
  await page.locator('[data-audit="send-input"]').fill('0971234567');
  await pause(1500);
  assert.deepEqual(lookups, [], 'not sent to Zambia');
  assert.equal(await page.locator('[data-audit="send-mm-unpayable"]').innerText(), "You can't pay this number in Kenya");
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  Kenya chosen, a Zambian number says it can\'t be paid there');
}

for (const typing of ['071234567', '+254 712 345']) {
  const { page, context, errors, lookups } = await open();
  await mobileMoney(page, 'tz');
  await page.locator('[data-audit="send-input"]').fill(typing);
  await pause(300);
  assert.equal(await page.locator('[data-audit="send-mm-unpayable"]').count(), 0, 'not while it is still being typed');
  assert.deepEqual(lookups, []);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`ok  ${typing}, still being typed, is not called unpayable`);
}

{
  // Turning the country off is no answer to "Which country?": nothing goes
  // to Kenya until Continue, under the label that says Kenya.
  const { page, context, errors, lookups } = await open();
  await mobileMoney(page, 'tz');
  await page.locator('[data-audit="send-input"]').fill('0712345678');
  await page.locator('[data-audit="send-mm-unpayable"]').waitFor();
  await page.locator('[data-audit="send-mm-country-tz"]').click();
  await pause(1500);
  assert.deepEqual(lookups, [], 'nothing looked up by itself');
  await page.locator('[data-audit="send-continue"]').click();
  await pause(800);
  assert.deepEqual(hosts(lookups), ['bitcoin.co.ke'], 'Continue goes on with the country the label shows');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  Tanzania turned off, 0712345678 waits for Continue');
}

// Valid in Kenya, Zambia and Tanzania: chosen, the country answers.
for (const [country, host] of [['tz', 'chapsmart.com'], ['zm', 'bitzed.xyz']]) {
  const { page, context, errors, lookups } = await open();
  await mobileMoney(page, country);
  await page.locator('[data-audit="send-input"]').fill('0751234567');
  await pause(1500);
  assert.deepEqual(hosts(lookups), [host], `${country} chosen`);
  assert.equal(await page.getByText('Which country?').count(), 0, 'no question: the country is chosen');
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`ok  ${country.toUpperCase()} chosen, 0751234567 is paid there`);
}

{
  // Its own calling code says Kenya, and the label says so.
  const { page, context, errors, lookups } = await open();
  await mobileMoney(page, 'tz');
  await page.locator('[data-audit="send-input"]').fill('+254712345678');
  await pause(1500);
  assert.deepEqual(hosts(lookups), ['bitcoin.co.ke']);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  Tanzania chosen, +254712345678 is a Kenyan payout, as its calling code says');
}

{
  // Issue #480: while Zambia's lookup runs, the other countries can't be tapped.
  const { page, context, errors, lookups } = await open({ delay: 4000 });
  await mobileMoney(page, 'zm');
  await page.locator('[data-audit="send-input"]').fill('0751234567');
  await page.locator('.progress-cta').waitFor(); // the loading button: resolving
  const tile = (code) => page.locator(`[data-audit="send-mm-country-${code}"]`);
  for (const code of ['ke', 'tz', 'zm']) assert.equal(await tile(code).isDisabled(), true, `${code} tile while resolving`);
  // The tiles fade (0.15 s): read them once they have settled.
  const opacity = (code, settled) => page.waitForFunction(
    ([selector, value]) => getComputedStyle(document.querySelector(selector)).opacity === value,
    [`[data-audit="send-mm-country-${code}"]`, settled],
    { timeout: 2000 },
  );
  await opacity('ke', '0.6'); // the others dim, as any disabled control
  await opacity('zm', '1'); // the chosen country stays lit
  assert.deepEqual(hosts(lookups), ['bitzed.xyz']);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  while Zambia\'s number resolves, the other countries dim and can\'t be tapped');
}

{
  // While Kenya's number resolves, the back arrow is the way out of the
  // sheet: the lookup carries on, and nothing else is offered meanwhile.
  const { page, context, errors, lookups } = await open({ delay: 3000 });
  await mobileMoney(page, 'ke');
  await page.locator('[data-audit="send-input"]').fill('0712345678');
  await page.locator('.progress-cta').waitFor();
  await page.locator('.mm-back').click();
  await page.locator('[data-audit="send-input"]').waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-audit="send-mobile-money"]').count(), 0, 'no resting sheet over the lookup');
  assert.deepEqual(hosts(lookups), ['bitcoin.co.ke']);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  the back arrow mid-lookup closes the sheet; the lookup carries on');
}

await browser.close();
console.log('All Mobile Money checks passed.');
