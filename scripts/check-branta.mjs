/** Browser check for Branta merchant verification (utils/branta.js, the
 * confirm sheet, the paid screen, History, Transaction Details, Settings).
 * Branta's service is a local stand-in: a verified business with a logo, a
 * slow answer, and an on-chain code whose visible address was changed (the
 * real SDK decrypts and refuses it). Light and dark.
 * Start `pnpm dev --port 9032` first (or set BRANTA_BASE_URL). Screenshots go
 * to output/branta-check/. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { AesEncryptionService } from '@branta-ops/branta';

const base = process.env.BRANTA_BASE_URL || 'http://localhost:9032';
const output = process.env.BRANTA_OUTPUT || new URL('../output/branta-check', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const GUARDRAIL = 'https://guardrail.branta.pro';
// A signed regtest invoice (also used by lightningInvoice.spec.js): 4,519 sats.
const INVOICE = 'lnbcrt45190n1p42dta6pp5g4ncw5dxn8qc4q5py4xwehshxfvfqqm5fl85rp5yef4act4x03lsdzu2pskjepqw3hjq3zf2dgycs2eyp2y2565ypz9y56gf9r9ggpgfaexgetjypy5gw3qgdfj6v3sxgmrqwf3xvknqvps8y5scqzzsxqzuysp5esvpf02e8wlpsttednes9nl4p30k30adw3mu8a63q3yvhyfjqayq9qxpqysgqq8mwenpwd8t07qu9y5ev0ngh98xhxssxfxyp89qupqnu47tgf8gqk2zvd8n3jf4fv922jceyqc5uzefxry0lvnp7xcckzxar8l8uxlqpht6qxr';
const SHOWN_ADDRESS = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const REGISTERED_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BRANTA_ID = 'docs-zk-id';
const BRANTA_SECRET = 'c0ffee-secret';
const CHANGED_CODE = `bitcoin:${SHOWN_ADDRESS}?amount=0.0005&branta_id=${BRANTA_ID}&branta_secret=${BRANTA_SECRET}`;
const LOGO = `${GUARDRAIL}/logos/kaffeehaus.svg`;
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><circle cx="15" cy="15" r="14" fill="#5B3A29"/><text x="15" y="19.5" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="800" fill="#F7E9D7">KL</text></svg>';
const VERIFIED = [{ platform: 'Kaffeehaus Lindgren', platform_logo_light_url: LOGO, description: 'Flat white and cake', destinations: [] }];
// The business registered another address than the code shows.
const CHANGED = [{
  platform: 'Kaffeehaus Lindgren',
  destinations: [{ type: 'bitcoin_address', zk: true, zk_id: '1', value: await new AesEncryptionService().encrypt(REGISTERED_ADDRESS, BRANTA_SECRET) }],
}];

const WALLETS = [
  { id: 'main', type: 'spark', name: 'Main', metadata: {} },
  { id: 'savings', type: 'spark', name: 'Savings', metadata: {} },
];
// History reads a connected wallet's list; a locked Spark wallet sends it back to Home.
const NWC = `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&secret=${'5e'.repeat(32)}`;
const HISTORY_WALLETS = [{ id: 'main', type: 'nwc', name: 'Main', nwcUrl: NWC, metadata: { methods: ['pay_invoice', 'get_balance', 'list_transactions'] } }];

const browser = await chromium.launch({ headless: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let n = 0;
const shot = async (page, name) => { n++; await page.screenshot({ path: `${output}/${String(n).padStart(2, '0')}-${name}.png` }); };

/** Open the app with two Spark wallets; `answer(url)` plays Branta's service. */
async function open({ theme = 'light', answer = () => ({ json: [] }), enabled = true, wallets = WALLETS } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  const lookups = [];
  page.on('pageerror', (error) => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });
  page.on('console', (m) => { if (m.type() === 'error' && /Vue warn|is not a function|Cannot read/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === GUARDRAIL) {
      if (url.pathname === new URL(LOGO).pathname) return route.fulfill({ body: LOGO_SVG, contentType: 'image/svg+xml' });
      lookups.push(url.pathname);
      const { json, delay = 0 } = answer(url);
      if (delay) await pause(delay);
      return route.fulfill({ json }).catch(() => {});
    }
    return url.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.iconify.design'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.routeWebSocket('**', (socket) => { if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close(); });
  await page.addInitScript(([theme, enabled]) => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buhoGO_bitcoin_preferences', JSON.stringify({ brantaVerificationEnabled: enabled }));
  }, [theme, enabled]);
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => window.__audit?.app?.config?.globalProperties?.$pinia, null, { timeout: 90000 });
  await page.evaluate(async (wallets) => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    store.$patch({ savedStateLoaded: true, isInitialized: true, useBip177Format: false, preferredFiatCurrency: 'USD' });
    store.exchangeRates = { ...store.exchangeRates, usd: 85000 };
    store.wallets = wallets.map((w, i) => ({ ...w, createdAt: i + 1, lastUsed: 10 - i }));
    store.activeWalletId = wallets[0].id;
    store.hasBackedUp = true;
    for (const w of wallets) {
      store.connectionStates[w.id] = { connected: true, error: null };
      store.balanceStates[w.id] = { value: 184250, known: true, source: 'sync', verifiedAt: Date.now(), updatedAt: Date.now() };
    }
    store.refreshBalance = async () => {};
  }, wallets);
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/wallet'));
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some((el) => {
    for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'WalletPage') return true;
    return false;
  }), null, { timeout: 30000 });
  await pause(800);
  return { page, context, errors, lookups };
}

const vmOf = async (page, name) => {
  const find = (name) => {
    for (const el of document.querySelectorAll('*')) for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === name) return c.proxy;
    return null;
  };
  await page.waitForFunction(find, name, { timeout: 30000 });
  return page.evaluateHandle(find, name);
};
const detect = async (page, payment) => {
  const wallet = await vmOf(page, 'WalletPage');
  await wallet.evaluate((vm, p) => { vm.onPaymentDetected(p); }, payment);
};
const go = async (page, path) => { await page.evaluate((p) => window.__audit.app.config.globalProperties.$router.push(p), path); await pause(1500); };
const sheet = (page) => page.locator('.sheet-card').first();
const sendDisabled = (page) => sheet(page).locator('.confirm-cta button.primary-cta, .confirm-cta .slide-track').first().evaluate((el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('slide-track--disabled'));

// 1 · An invoice from a verified business: checking, then the business, the badge.
for (const theme of ['light', 'dark']) {
  const { page, context, errors, lookups } = await open({ theme, answer: () => ({ json: VERIFIED, delay: 700 }) });
  await detect(page, { type: 'lightning_invoice', data: INVOICE, rawInput: INVOICE });
  await page.locator('.recipient-cell--checking').waitFor({ timeout: 4000 });
  assert.equal(await sendDisabled(page), true, 'sending waits for the check');
  if (theme === 'light') await shot(page, 'checking');
  await page.locator('.branta-badge').waitFor({ timeout: 4000 });
  assert.equal(await page.locator('.recipient-cell--checking').count(), 0);
  assert.equal(await sheet(page).locator('.recipient-name').innerText(), 'Kaffeehaus Lindgren');
  assert.equal(await sheet(page).locator('.recipient-addr').count(), 0, 'named, not addressed');
  assert.equal(await sheet(page).locator('.recipient-info').count(), 1, 'the raw invoice stays one tap away');
  assert.match(await page.locator('.branta-badge').getAttribute('aria-label'), /Verified by Branta\. Opens Branta's verification\./);
  assert.equal(await sendDisabled(page), false, 'sending opens once the check settles');
  assert.equal(lookups.length, 1);
  await pause(400);
  await shot(page, `verified-${theme}`);
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ verified: the row waits while checking, then the business is the recipient and the badge opens Branta');

// 2 · A slow answer: the sheet settles after the hold and nothing pops in later.
{
  const { page, context, errors } = await open({ answer: () => ({ json: VERIFIED, delay: 3200 }) });
  await detect(page, { type: 'lightning_invoice', data: INVOICE, rawInput: INVOICE });
  await page.locator('.recipient-cell--checking').waitFor({ timeout: 4000 });
  await pause(1900);
  assert.equal(await page.locator('.recipient-cell--checking').count(), 0, 'settled after the hold');
  assert.equal(await sendDisabled(page), false);
  await pause(2200);
  assert.equal(await page.locator('.branta-badge').count(), 0, 'a late answer does not change the sheet');
  assert.notEqual(await sheet(page).locator('.recipient-name').innerText(), 'Kaffeehaus Lindgren');
  await shot(page, 'late-answer');
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ a slow answer: settles after 1.5 s, no pop-in afterwards');

// 3 · A changed on-chain code: the real SDK decrypts it and the sheet stops the payment.
{
  const { page, context, errors, lookups } = await open({ answer: () => ({ json: CHANGED }) });
  await detect(page, { type: 'bitcoin_address', data: SHOWN_ADDRESS, rawInput: CHANGED_CODE });
  await page.locator('.changed-code').waitFor({ timeout: 6000 });
  assert.match(await page.locator('.changed-code').innerText(), /This code was changed[\s\S]*Sending could pay someone else\.[\s\S]*Nothing was sent/);
  assert.equal(await page.locator('.confirm-cta').isVisible(), false, 'no way to send');
  assert.equal(await page.locator('.branta-badge').count(), 0);
  assert.deepEqual(lookups, [`/v2/payments/${BRANTA_ID}`]);
  await pause(300);
  await shot(page, 'changed-code');
  await page.locator('.changed-code-close').click();
  await pause(600);
  assert.equal(await page.locator('.changed-code').count(), 0, 'Close drops the payment');
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ a changed code: the sheet stops the payment, Close drops it');

// 4 · No lookup when it is off, or for a BuhoGO user's own invoice.
{
  const off = await open({ enabled: false, answer: () => ({ json: VERIFIED }) });
  await detect(off.page, { type: 'lightning_invoice', data: INVOICE, rawInput: INVOICE });
  await pause(900);
  assert.equal(off.lookups.length, 0, 'switched off');
  assert.equal(await off.page.locator('.recipient-cell--checking').count(), 0);
  await off.context.close();

  const own = await open({ answer: () => ({ json: VERIFIED }) });
  await detect(own.page, { type: 'lightning_invoice', data: INVOICE, firstParty: true });
  await pause(900);
  assert.equal(own.lookups.length, 0, 'first-party invoice');
  await own.context.close();
}
console.log('✓ not looked up: switched off, or a BuhoGO user\'s own invoice');

// 5 · After sending: the paid pill, the History row (no badge), the details.
{
  const { page, context, errors } = await open();
  const wallet = await vmOf(page, 'WalletPage');
  await wallet.evaluate((vm, logo) => {
    vm.openSendSuccess({ amount: 4519, recipient: 'Bitcoin payment', status: 'completed', showSaveContact: false, verifiedBusiness: { name: 'Kaffeehaus Lindgren', logoUrl: '', logoLightUrl: logo, description: '', verifyUrl: 'https://guardrail.branta.pro/v2/verify/x' } });
  }, LOGO);
  await page.locator('.verified-recipient').waitFor({ timeout: 4000 });
  await pause(1200);
  assert.match(await page.locator('.verified-recipient').innerText(), /To Kaffeehaus Lindgren/);
  await shot(page, 'paid');
  assert.deepEqual(errors, []);
  await context.close();
}

{
  const { page, context, errors } = await open({ wallets: HISTORY_WALLETS });
  await page.evaluate(async (logo) => {
    const s = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    s.providers.main = { getTransactions: async () => [], listTransactions: async () => [] };
    const { useTransactionMetadataStore } = await import('/src/stores/transactionMetadata.js');
    await useTransactionMetadataStore().setMerchantVerificationForTransaction('tx-coffee', 'main', { name: 'Kaffeehaus Lindgren', logoUrl: '', logoLightUrl: logo, description: 'Flat white and cake', verifyUrl: 'https://guardrail.branta.pro/v2/verify/x' });
  }, LOGO);
  const t = Math.floor(Date.now() / 1000);
  const coffee = { id: 'tx-coffee', type: 'outgoing', amount: -4519, settled_at: t - 300, status: 'completed', description: 'Flat white and cake', fee: 1 };
  await go(page, '/transactions');
  const history = await vmOf(page, 'TransactionHistoryPage');
  await history.evaluate((vm, txs) => {
    vm.walletState = { ...(vm.walletState || {}), activeWalletId: 'main' };
    vm.isLoading = false; vm.showLoadingScreen = false; vm.hasMoreTransactions = false;
    vm.transactions = txs;
  }, [coffee, { id: 'tx-in', type: 'incoming', amount: 12500, settled_at: t - 900, status: 'completed', description: 'Dinner split', fee: 0 }]);
  await pause(900);
  const row = page.locator('.tx-row', { hasText: 'Kaffeehaus Lindgren' }).first();
  await row.waitFor({ timeout: 4000 });
  assert.equal(await row.locator('[class*="rosette"], .branta-badge').count(), 0, 'no badge in the list');
  await shot(page, 'history');

  await go(page, '/transaction/tx-coffee?wallet=main');
  const details = await vmOf(page, 'TransactionDetailsPage');
  await details.evaluate((vm, tx) => { vm.isLoading = false; vm.transaction = { ...tx, walletId: 'main' }; }, coffee);
  await pause(900);
  assert.match(await page.locator('.hero-business').innerText(), /Kaffeehaus Lindgren/);
  const verifiedRow = page.locator('button.tx-row-verified');
  assert.match(await verifiedRow.getAttribute('aria-label'), /Verified by Branta, Kaffeehaus Lindgren\. Opens Branta's verification\./);
  await shot(page, 'details');
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ after sending: paid pill, History row without a badge, details hero and button row');

// 6 · Settings: a footer under the switch, no info button.
for (const theme of ['light', 'dark']) {
  const { page, context, errors } = await open({ theme });
  await go(page, '/settings?section=advanced');
  const footer = page.locator('.settings-section-footer', { hasText: 'Checked privately with Branta' });
  await footer.waitFor({ timeout: 4000 });
  await footer.scrollIntoViewIfNeeded();
  assert.match(await footer.innerText(), /About Branta/);
  assert.equal(await page.locator('[aria-label="About merchant verification"]').count(), 0);
  await pause(300);
  await shot(page, `settings-${theme}`);
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ settings: the switch with a footer and About Branta');

await browser.close();
console.log(`Screenshots: ${output}`);
