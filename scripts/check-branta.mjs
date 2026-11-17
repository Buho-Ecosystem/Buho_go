// Real Vue + Branta 4.4 cryptography. Guardrail, artwork and wallet SDK are
// local fixtures. No publishing request, funds or external messages.
// Start the dev server (npm run dev -- --port 9019), then npm run check:branta.
// Optional BRANTA_BASE_URL/BRANTA_CASE/BRANTA_OUTPUT.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { bech32 } from 'bech32';
import { InvoiceLedger, LnurlServer } from './fixtures/contactChat.mjs';
import { brantaFixture, GUARDRAIL, MERCHANT, LOGO, LOGO_SVG, ADDRESS, OTHER_ADDRESS, proofUri } from './fixtures/branta.mjs';

const base = process.env.BRANTA_BASE_URL || 'http://localhost:9019';
const output = process.env.BRANTA_OUTPUT || 'output/branta-check';
const filter = (process.env.BRANTA_CASE || '').toLowerCase();
await mkdir(output, { recursive: true });
const ledger = new InvoiceLedger();
const payoutServer = new LnurlServer({ ledger, domain: 'branta-local.example' });
const INVOICE = ledger.mint({ amountSats: 2400 }).bolt11;
const OTHER_INVOICE = ledger.mint({ amountSats: 3900 }).bolt11;
const AMOUNTLESS = bech32.encode('lnbc', bech32.decode(INVOICE, 4096).words, 4096);
const bolt = await brantaFixture({ destinations: [{ value: INVOICE, type: 'bolt11' }] });
const bitcoin = await brantaFixture({ destinations: [{ value: ADDRESS, type: 'bitcoin_address' }] });
await bolt.verify(INVOICE); await bitcoin.verify(proofUri());
await bitcoin.verify(proofUri(OTHER_ADDRESS, { encoded: true }), 'tampered');
const browser = await chromium.launch({ headless: true });
const contexts = new Set(), errors = [];
let page, stepName = 'startup';
const step = async (name, work) => {
  if (filter && !name.toLowerCase().includes(filter)) return;
  stepName = name; await work(); console.log(`  ok  ${name}`);
};
const sheet = () => page.locator('.sheet-card:visible');
const amount = () => sheet().locator('.amount-input');
const primary = () => sheet().locator('.confirm-cta button.primary-cta');
const ready = async () => { await sheet().waitFor(); await sheet().locator('.pay-with-field').waitFor(); };
const detect = async (payment = { type: 'lightning_invoice', data: INVOICE, rawInput: INVOICE }) => page.evaluate(value => { void window.__brantaWallet.onPaymentDetected(value); }, payment);
const cancel = async () => { await sheet().locator('.top-btn').click(); await sheet().waitFor({ state: 'hidden' }); };
const go = path => page.evaluate(value => document.querySelector('#q-app').__vue_app__.config.globalProperties.$router.push(value), path);
const sends = () => page.evaluate(() => window.__brantaSends || []);
const rawSats = () => sheet().evaluate(node => {
  let component = node.__vueParentComponent;
  while (component && component.type.name !== 'PaymentConfirmSheet') component = component.parent;
  return component.proxy.amountInSats;
});
const canSubmit = () => sheet().evaluate(node => {
  let component = node.__vueParentComponent;
  while (component && component.type.name !== 'PaymentConfirmSheet') component = component.parent;
  return component.proxy.canSubmit;
});
const currency = () => sheet().evaluate(node => {
  let component = node.__vueParentComponent;
  while (component && component.type.name !== 'PaymentConfirmSheet') component = component.parent;
  return component.proxy.currentCurrency;
});
const selectCurrency = async expected => {
  for (let index = 0; index < 5; index++) {
    const selected = await currency();
    if (selected === expected || expected === 'EUR' && selected === 'fiat') return;
    await sheet().locator('.unit-pill').click();
  }
  assert.fail(`Denomination ${expected} was not available`);
};
const shot = async name => {
  for (const dark of [false, true]) {
    await page.evaluate(value => document.querySelector('#q-app').__vue_app__.config.globalProperties.$q.dark.set(value), dark);
    await page.waitForTimeout(350); await page.screenshot({ path: `${output}/${name}-${dark ? 'dark' : 'light'}.png` });
  }
};
const showProof = async detailsScreenshot => {
  await sheet().locator('.recipient-info').click(); await sheet().locator('.payment-details-view').waitFor();
  if (detailsScreenshot) await shot(detailsScreenshot);
  await sheet().locator('.branta-current-check').click(); await sheet().locator('.branta-verification-view').waitFor();
};
const fits = async label => {
  await page.waitForTimeout(350);
  const bad = await page.evaluate(() => [...document.querySelectorAll('.q-dialog__inner *')].filter(node => {
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height || !node.checkVisibility()) return false;
    return r.left < -1 || r.right > document.documentElement.clientWidth + 1 || node.matches('.top-row,.confirm-cta') && (r.top < -1 || r.bottom > innerHeight + 1);
  }).map(node => node.className).slice(0, 8));
  assert.deepEqual(bad, [], label);
};
// `locale` is the app language; `deviceLocale` the phone's, which decides how
// numbers are written and what the keypad's decimal key types.
async function open({ answer = () => ({ json: [bolt.wire] }), enabled = true, bip177 = true, locale = 'en-US', deviceLocale = locale, denomination = 'sats', brokenLogo = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: deviceLocale });
  contexts.add(context); context.setDefaultTimeout(15000);
  const requests = [], logs = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (payoutServer.owns(url.hostname)) {
      const response = payoutServer.handle(url);
      if (response.body.tag === 'payRequest') response.body.currency = { code: 'KES', multiplier: 2000, decimals: 2, minSendable: 1, maxSendable: 10000 };
      return route.fulfill({ status: response.status, json: response.body });
    }
    if (url.origin === GUARDRAIL) {
      if (url.pathname === new URL(LOGO).pathname) return brokenLogo ? route.abort() : route.fulfill({ body: LOGO_SVG, contentType: 'image/svg+xml' });
      if (url.pathname.startsWith('/v2/verify/')) return route.fulfill({ contentType: 'text/html', body: '<title>Local Branta record fixture</title>' });
      assert.equal(route.request().method(), 'GET', 'wallet verification never publishes');
      requests.push(url.pathname);
      const response = answer({ url, index: requests.length });
      if (response.delay) await new Promise(resolve => setTimeout(resolve, response.delay));
      if (response.offline) return route.abort();
      return route.fulfill({ status: response.status || 200, json: response.json ?? [] }).catch(() => {});
    }
    if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
    if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') return route.fulfill({ json: { EUR: 78000, USD: 85000 } });
    return route.abort();
  });
  await context.routeWebSocket(/.*/, socket => new URL(socket.url()).host === new URL(base).host ? socket.connectToServer() : socket.close());
  await context.addInitScript(({ enabled, locale }) => {
    window.__AUDIT__ = { noExitMonitor: true };
    localStorage.setItem('buhoGO_language', locale);
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
    localStorage.setItem('buhoGO_bitcoin_preferences', JSON.stringify({ brantaVerificationEnabled: enabled }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__brantaCopied = value; }, readText: async () => '' } });
  }, { enabled, locale });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(`${stepName}: ${error.message}`));
  page.on('console', message => logs.push(message.text()));
  await page.goto(`${base}/#/wallet`); await page.locator('[data-audit="fab-send"]').waitFor();
  await page.evaluate(async ({ bip177, denomination }) => {
    const { BreezSparkWalletProvider } = await import('/src/providers/BreezSparkWalletProvider.js');
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const { usePaymentPreferencesStore } = await import('/src/stores/paymentPreferences.js');
    const { parseLightningInvoice } = await import('/src/utils/lightningInvoice.js');
    const store = useWalletStore(); await store.initialize();
    store.useBip177Format = bip177; store.preferredFiatCurrency = 'EUR'; store.denominationCurrency = denomination; store.hasBackedUp = true;
    store.wallets = ['main', 'savings'].map(id => ({ id, name: id === 'main' ? 'Main' : 'Savings', type: 'spark' }));
    store.activeWalletId = 'main'; store.connectionStates = { main: { connected: true }, savings: { connected: true } }; store.providers = {};
    window.__brantaRoute = 'lightning'; window.__brantaSends = []; window.__brantaTransactions = []; window.__brantaQuotes = []; window.__brantaSdkPayments = [];
    for (const id of ['main', 'savings']) {
      const sdk = {
        // Background lifecycle reads the cached balance as soon as wallets
        // appear. Supply the real SDK read contract as well as prepare/send.
        getInfo: async () => ({ balanceSats: 184250n }),
        getPayment: async ({ paymentId }) => ({ payment: window.__brantaSdkPayments.find(payment => payment.id === paymentId) }),
        prepareSendPayment: async request => ({ amount: request.amount ?? BigInt(parseLightningInvoice(request.paymentRequest.input).amount || 0), paymentMethod: {
          type: 'bolt11Invoice', lightningFeeSats: 7, sparkTransferFeeSats: window.__brantaRoute === 'spark' ? 1 : null,
          invoiceDetails: { invoice: { bolt11: request.paymentRequest.input } },
        } }),
        sendPayment: async request => {
          const amount = Number(request.prepareResponse.amount), invoice = request.prepareResponse.paymentMethod.invoiceDetails.invoice.bolt11;
          const paymentId = `branta-${id}-${window.__brantaSends.length + 1}`;
          window.__brantaSends.push({ walletId: id, amount, invoice, preferSpark: request.options.preferSpark });
          window.__brantaTransactions.push({ id: paymentId, type: 'outgoing', amount: -(amount + 7), fee: 7, status: 'completed', description: 'Flat white and cake', settled_at: Math.floor(Date.now() / 1000) });
          const payment = { id: paymentId, status: 'completed', paymentType: 'send', method: 'lightning', timestamp: Math.floor(Date.now() / 1000), amount: BigInt(amount), fees: 7n, details: { type: 'lightning', invoice, description: 'Flat white and cake', htlcDetails: { preimage: 'ab'.repeat(32) } } };
          window.__brantaSdkPayments.push(payment);
          return { payment };
        },
      };
      const provider = new BreezSparkWalletProvider(id, { name: id, _testSdk: sdk }); provider.isConnected = true;
      if (!provider.sdk) throw new Error('Fixture SDK was not installed');
      const quote = provider.getLightningSendFeeEstimate.bind(provider);
      provider.getLightningSendFeeEstimate = async (...args) => {
        try { const result = await quote(...args); window.__brantaQuotes.push({ fee: result.estimatedFeeSats, estimated: result.isEstimated, target: result.preparedRoute?.kind }); return result; }
        catch (error) { window.__brantaQuotes.push({ error: error.message }); throw error; }
      };
      provider.getBalance = async () => 184250; provider.getTransactions = async () => window.__brantaTransactions;
      provider.getPendingDeposits = async () => [];
      provider.getSparkAddress = async () => 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uc489gg2';
      provider.getWithdrawalFeeQuote = async () => Object.fromEntries(['slow','medium','fast'].map(speed => [speed, { feeQuoteId: `fixture-${id}-${speed}`, serviceFee: 10, networkFee: 30, totalFee: 40, timeEstimate: 'About 30 minutes' }]));
      store.providers[id] = provider; store.applyBalance(id, 184250);
    }
    const provider = async id => store.getProvider(id || store.activeWalletId);
    store.ensureSparkConnected = provider; store.ensureWalletConnectedForTransfer = provider;
    store.refreshWalletData = async () => {}; store.refreshBalance = async () => {}; store.connectAllSparkWallets = async () => {};
    const prefs = usePaymentPreferencesStore(); prefs.initialize(); prefs.setPreferred(null);
    let component = document.querySelector('.wallet-toolbar').__vueParentComponent;
    while (component && component.type.name !== 'WalletPage') component = component.parent;
    window.__brantaWallet = component.proxy; window.__brantaWallet.stopBitcoinDepositPolling(); clearInterval(window.__brantaWallet.refreshInterval);
  }, { bip177, denomination });
  return { context, requests, logs, close: async () => { await context.close(); contexts.delete(context); } };
}
try {
  await step('Real 4.4 match gives a clean review and same-sheet proof with Back and focus restoration', async () => {
    const scenario = await open({ answer: () => ({ json: [bolt.wire], delay: 600 }) });
    await detect(); await ready(); await sheet().locator('.recipient-cell--checking').waitFor(); assert.equal(await primary().isDisabled(), true);
    await sheet().locator('.recipient-verified').waitFor(); assert.equal(await rawSats(), 2400); assert.equal(await amount().inputValue(), '2,400');
    // The business is named on the review itself: logo, name and the seal in words.
    assert.equal((await sheet().locator('.recipient-name').innerText()).trim(), MERCHANT);
    assert.match(await sheet().locator('.recipient-verified').innerText(), /Verified business/);
    await sheet().locator('.recipient-logo').waitFor();
    assert.equal(await sheet().locator('.recipient-logo').getAttribute('src'), LOGO);
    assert.equal((await primary().innerText()).trim(), 'Send'); await shot('01-review');
    // Tapping the row opens the check directly; Back returns to the review.
    await sheet().locator('.recipient-identity').click(); await sheet().locator('.branta-verification-view').waitFor();
    await sheet().locator('.top-btn').click(); await page.waitForFunction(() => document.activeElement?.classList.contains('recipient-identity'));
    assert.equal(await rawSats(), 2400);
    await showProof('01b-payment-details');
    assert.equal(await page.locator('.q-dialog:visible').count(), 1); assert.equal(scenario.context.pages().length, 1);
    assert.match(await sheet().locator('.branta-verification-details').innerText(), /Kaffeehaus Lindgren/); await shot('02-current-verification');
    assert.match(await sheet().locator('.branta-proof-time').innerText(), /Checked/);
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); });
    await sheet().locator('.branta-record-link').click(); await sheet().locator('.branta-record-error').waitFor();
    assert.equal(scenario.context.pages().length, 1, 'offline record action stays inside the proof view');
    await page.evaluate(() => { delete navigator.onLine; });
    const popupPromise = scenario.context.waitForEvent('page', { timeout: 4000 });
    await sheet().locator('.branta-record-link').click(); const popup = await popupPromise;
    await popup.waitForURL(url => url.origin === GUARDRAIL, { timeout: 4000 }); await popup.close();
    assert.ok(scenario.requests.every(path => !path.includes(INVOICE)), 'raw invoice never appears in the Guardrail request path');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => document.activeElement?.classList.contains('branta-current-check'));
    await sheet().locator('.branta-current-check').click();
    await sheet().locator('.top-btn').click(); await page.waitForFunction(() => document.activeElement?.classList.contains('branta-current-check'));
    await sheet().locator('.top-btn').click(); await page.waitForFunction(() => document.activeElement?.classList.contains('recipient-info'));
    assert.equal(await rawSats(), 2400); assert.equal((await sends()).length, 0); await scenario.close();
  });
  await step('Unknown unavailable expired and ambiguous records never fake merchant branding', async () => {
    for (const answer of [() => ({ json: [] }), () => ({ offline: true }), () => ({ json: [{ ...bolt.wire, created_at: '2000-01-01T00:00:00Z', ttl: 1 }] }), () => ({ json: [bolt.wire, { ...bolt.wire, platform: 'Other merchant' }] })]) {
      const scenario = await open({ answer }); await detect(); await ready(); await page.waitForFunction(() => !document.querySelector('.recipient-cell--checking'));
      assert.equal(await sheet().locator('.recipient-verified').count(), 0); assert.ok(!(await sheet().innerText()).includes(MERCHANT)); assert.equal((await sends()).length, 0); await scenario.close();
    }
  });
  await step('Changed codes encoded proof keys and duplicate keys hard-stop before any debit', async () => {
    const valid = await open({ answer: () => ({ json: [bitcoin.wire] }) });
    await detect({ type: 'bitcoin_address', data: ADDRESS, rawInput: proofUri(), bip21: { address: ADDRESS, amount: '0.000024' } });
    await sheet().locator('.recipient-verified').waitFor();
    await sheet().locator('.onchain-panel .summary').waitFor();
    assert.equal(await sheet().locator('.onchain-panel .speed-card').count(), 3, 'on-chain speed choices remain directly on review');
    assert.equal(await rawSats(), 2400); assert.match(await sheet().locator('.onchain-panel .summary').innerText(), /2,440/);
    await shot('03a-onchain'); await valid.close();
    for (const input of [proofUri(OTHER_ADDRESS), proofUri(OTHER_ADDRESS, { encoded: true }), `${proofUri(OTHER_ADDRESS)}&branta%5fid=conflicting`]) {
      const scenario = await open({ answer: () => ({ json: [bitcoin.wire] }) });
      await detect({ type: 'bitcoin_address', data: OTHER_ADDRESS, rawInput: input, bip21: { address: OTHER_ADDRESS, amount: '0.000024' } });
      await page.locator('.changed-code').waitFor(); assert.equal((await sends()).length, 0); assert.equal(await sheet().locator('.confirm-cta:visible').count(), 0);
      await page.evaluate(async () => { const { useBitcoinPreferencesStore } = await import('/src/stores/bitcoinPreferences.js'); useBitcoinPreferencesStore().brantaVerificationEnabled = false; });
      assert.equal(await page.locator('.changed-code').isVisible(), true); await shot('03-changed-code');
      await page.locator('.changed-code-close').click(); await sheet().waitFor({ state: 'hidden' }); await scenario.close();
    }
  });
  await step('Cancel replacement and late tampered answers respect payment lifecycle', async () => {
    let scenario = await open({ answer: () => ({ json: [bolt.wire], delay: 900 }) });
    await detect(); await ready(); await cancel(); await page.waitForTimeout(1000); assert.equal(await sheet().count(), 0);
    await detect(); await ready(); await detect({ type: 'lightning_invoice', data: OTHER_INVOICE, rawInput: OTHER_INVOICE }); await page.waitForTimeout(1300);
    assert.equal(await sheet().locator('.recipient-verified').count(), 0); assert.equal(await rawSats(), 3900); await scenario.close();
    scenario = await open({ answer: () => ({ json: [bitcoin.wire], delay: 2300 }) });
    await detect({ type: 'bitcoin_address', data: OTHER_ADDRESS, rawInput: proofUri(OTHER_ADDRESS, { encoded: true }), bip21: { address: OTHER_ADDRESS, amount: '0.000024' } });
    await ready(); await page.waitForFunction(() => !document.querySelector('.recipient-cell--checking'));
    await page.evaluate(() => window.__brantaWallet.onSendSheetConfirm({ amountSats: 2400, comment: '' }));
    await page.locator('.changed-code').waitFor(); assert.equal((await sends()).length, 0); await scenario.close();
  });
  await step('Optimized Spark cannot inherit Lightning identity and route drift requires fresh review', async () => {
    let scenario = await open(); await page.evaluate(() => { window.__brantaRoute = 'spark'; }); await detect(); await ready();
    await page.waitForFunction(() => !document.querySelector('.recipient-cell--checking')); assert.equal(await sheet().locator('.recipient-verified').count(), 0); await scenario.close();
    scenario = await open(); await detect(); await sheet().locator('.recipient-verified').waitFor();
    await page.evaluate(async () => { const { useWalletStore } = await import('/src/stores/wallet.js'); window.__brantaRoute = 'spark'; useWalletStore().getProvider('main')._preparedSends.clear(); });
    await primary().click(); await page.waitForTimeout(500); assert.equal((await sends()).length, 0); assert.equal(await page.locator('.error-dialog:visible').count(), 0);
    assert.match(await sheet().locator('.wallet-hint').innerText(), /business check is not available/i, 'the sheet says why it came back, in one line');
    assert.equal(await page.locator('.q-notification:visible').count(), 0);
    assert.equal(await sheet().locator('.recipient-verified').count(), 0); assert.equal(await rawSats(), 2400); await scenario.close();
  });
  await step('Artwork failure keeps a verified local fallback without changing amount', async () => {
    const scenario = await open({ brokenLogo: true }); await detect(); await sheet().locator('.recipient-verified').waitFor(); await page.waitForTimeout(400);
    assert.equal((await sheet().locator('.recipient-name').innerText()).trim(), MERCHANT);
    assert.equal(await sheet().locator('.recipient-bitcoin-logo').count(), 0, 'its own initial, never the generic mark');
    assert.equal(await rawSats(), 2400); await shot('04-artwork-fallback'); await scenario.close();
  });
  await step('Grouped hero units fees totals and decimal BTC preserve exact monetary values', async () => {
    for (const [locale, bip177, denomination] of [['en-US', true, 'sats'], ['de', true, 'sats'], ['es', false, 'sats'], ['en-US', false, 'sats'], ['en-US', true, 'btc'], ['de', true, 'btc'], ['en-US', true, 'fiat']]) {
      const scenario = await open({ locale, bip177, denomination }); await detect(); await sheet().locator('.recipient-verified').waitFor();
      const digits = denomination === 'btc' ? 8 : denomination === 'fiat' ? 2 : 0;
      const converted = sats => denomination === 'btc' ? sats / 100000000 : denomination === 'fiat' ? sats * 78000 / 100000000 : sats;
      const formatted = sats => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(converted(sats));
      // A fixed amount shown in fiat is a conversion, and says so on the anchor too.
      assert.equal(await amount().inputValue(), (denomination === 'fiat' ? '≈\u00a0' : '') + formatted(2400)); assert.equal(await rawSats(), 2400);
      const unit = (await sheet().locator('.unit-pill').innerText()).trim();
      assert.ok(denomination === 'btc' ? unit === 'BTC' : denomination === 'fiat' ? unit === 'EUR' : bip177 ? unit.includes('₿') : /sats/i.test(unit));
      const fee = await sheet().locator('.fee-row-value').innerText();
      if (denomination === 'fiat') assert.match(fee, /<.*0\.01.*EUR/); else assert.ok(fee.includes(formatted(7)));
      const total = await sheet().locator('.payment-total-row').innerText(); assert.ok(total.includes(formatted(2407)));
      assert.ok(denomination === 'btc' ? total.includes('BTC') : denomination === 'fiat' ? total.includes('EUR') : bip177 ? total.includes('₿') : /sats/i.test(total));
      await shot(`05-amount-${locale}-${denomination}-${bip177 ? 'bip177' : 'sats'}`); await scenario.close();
    }
    const scenario = await open({ denomination: 'btc', answer: () => ({ json: [] }) }); await detect({ type: 'lightning_invoice', data: AMOUNTLESS, rawInput: AMOUNTLESS }); await ready();
    assert.equal(await currency(), 'btc'); await amount().fill('0.00000029'); await amount().blur(); assert.equal(await rawSats(), 29, 'decimal BTC must not round down to 28 sats'); await scenario.close();
  });
  await step('App in English on a German phone: the comma key is a decimal and numbers read the German way', async () => {
    const fiat = await open({ locale: 'en-US', deviceLocale: 'de', denomination: 'fiat', answer: () => ({ json: [] }) });
    await detect({ type: 'lightning_invoice', data: AMOUNTLESS, rawInput: AMOUNTLESS }); await ready();
    await selectCurrency('EUR'); await amount().fill(''); await amount().pressSequentially('1,5'); await amount().blur();
    assert.equal(await rawSats(), Math.floor(1.5 / 78000 * 100000000), 'a comma keypad with the app in English means 1.5');
    await amount().fill('1,234'); assert.equal(await rawSats(), 0); assert.equal(await primary().isDisabled(), true, 'thousands or decimal: refused, never guessed');
    await fiat.close();
    const fixed = await open({ locale: 'en-US', deviceLocale: 'de' }); await detect(); await sheet().locator('.recipient-verified').waitFor();
    assert.equal(await amount().inputValue(), '2.400', 'grouped like the balance and the receipt on this phone');
    assert.ok((await sheet().locator('.payment-total-row').innerText()).includes('2.407')); await fixed.close();
  });
  await step('Locale keyboards grouped pastes and payout precision never change the intended amount', async () => {
    for (const [locale, grouped, decimal, malformed] of [['en-US', '2,400', '.', '2,40'], ['de', '2.400', ',', '2.40']]) {
      const scenario = await open({ locale, answer: () => ({ json: [] }) });
      await detect({ type: 'lightning_invoice', data: AMOUNTLESS, rawInput: AMOUNTLESS }); await ready();
      await selectCurrency('sats'); await amount().fill(grouped); await amount().blur();
      assert.equal(await rawSats(), 2400, `${locale} grouped satoshi paste`);
      for (const invalid of [malformed, `2${decimal}5`]) {
        await amount().fill(invalid); assert.equal(await rawSats(), 0); assert.equal(await primary().isDisabled(), true, 'fractional or malformed satoshis cannot silently truncate');
      }
      await scenario.close();
      const btc = await open({ locale, denomination: 'btc', answer: () => ({ json: [] }) });
      await detect({ type: 'lightning_invoice', data: AMOUNTLESS, rawInput: AMOUNTLESS }); await ready();
      assert.equal(await currency(), 'btc'); await amount().fill(''); await amount().pressSequentially(`0${decimal}00000029`); await amount().blur();
      assert.equal(await rawSats(), 29, `${locale} decimal keyboard BTC`);
      await amount().fill(''); await amount().pressSequentially(`1${decimal}234`); await amount().blur();
      assert.equal(await rawSats(), 123400000, `${locale} accepted decimal survives incremental typing and blur`);
      await amount().fill(`0${decimal}000000291`); assert.equal(await rawSats(), 0); assert.equal(await canSubmit(), false, 'fractional satoshi precision is rejected even when the CTA offers a wallet change');
      await btc.close();
      const fiat = await open({ locale, denomination: 'fiat', answer: () => ({ json: [] }) });
      await detect({ type: 'lightning_invoice', data: AMOUNTLESS, rawInput: AMOUNTLESS }); await ready();
      await selectCurrency('EUR'); await amount().fill(''); await amount().pressSequentially(`10${decimal}5`); await amount().blur();
      assert.equal(await rawSats(), Math.floor(10.5 / 78000 * 100000000), `${locale} decimal keyboard fiat means 10.5, never 105`);
      await fiat.close();
      const payout = await open({ locale, answer: () => ({ json: [] }) });
      await detect({ type: 'lightning_address', data: 'payout@branta-local.example', rawInput: 'payout@branta-local.example' }); await ready(); await selectCurrency('KES');
      await amount().fill(''); await amount().pressSequentially(`10${decimal}25`); await amount().blur();
      assert.equal(await rawSats(), 20, 'payout satoshi estimate retains the entered local amount');
      // Capture the sheet's actual confirmation event for the payout draft;
      // replacing a parent method does not replace Vue's cached listener.
      await sheet().evaluate(node => {
        let component = node.__vueParentComponent;
        while (component && component.type.name !== 'PaymentConfirmSheet') component = component.parent;
        component.vnode.props.onConfirm = payload => { window.__brantaCaptured = payload; };
      });
      await primary().click();
      assert.deepEqual(await page.evaluate(() => window.__brantaCaptured?.payout), { code: 'KES', amount: 10.25 }, 'confirm keeps exact payout minor units');
      await amount().fill(`10${decimal}251`); assert.equal(await rawSats(), 0); assert.equal(await primary().isDisabled(), true, 'excess payout precision cannot silently round');
      assert.equal((await sends()).length, 0); await payout.close();
    }
  });
  await step('A real mocked send saves exact-payment historical proof and the saved check is a sheet over the receipt', async () => {
    const scenario = await open(); await detect(); await sheet().locator('.recipient-verified').waitFor(); await primary().click();
    await page.locator('.payment-confirmation:visible .amount-label').waitFor(); const paid = await sends();
    assert.equal(paid.length, 1); assert.equal(paid[0].amount, 2400); assert.equal(paid[0].invoice, INVOICE); assert.equal(paid[0].walletId, 'main');
    assert.ok((await page.locator('.payment-confirmation:visible .verified-recipient').innerText()).includes(MERCHANT), 'the paid screen names the business');
    await shot('06-sent'); await page.locator('.payment-confirmation:visible .amount-label').click();
    await page.waitForFunction(async () => { const { useTransactionMetadataStore } = await import('/src/stores/transactionMetadata.js'); return !!useTransactionMetadataStore().getMerchantVerificationForTransaction('branta-main-1', 'main'); });
    const saved = await page.evaluate(async () => { const { useTransactionMetadataStore } = await import('/src/stores/transactionMetadata.js'); const s=useTransactionMetadataStore(); return { own:s.getMerchantVerificationForTransaction('branta-main-1','main'),other:s.getMerchantVerificationForTransaction('branta-main-1','savings') }; });
    assert.equal(saved.own.name, MERCHANT); assert.ok(saved.own.checkedAt > 0); assert.equal(saved.other, null);
    assert.equal('destination' in saved.own, false, 'the paid destination is not saved with the check'); assert.equal('sdkVersion' in saved.own, false);
    await go('/transaction/branta-main-1?wallet=main'); await page.locator('.receipt-verification-button').waitFor(); await shot('07-receipt');
    const source = new URL(page.url()).hash; const saveSheet = page.locator('.check-sheet');
    await page.locator('.receipt-verification-button').click(); await saveSheet.waitFor();
    assert.match(await page.locator('.branta-verification-details').innerText(), /saved|before|Checked/i); await shot('08-saved-verification');
    await page.keyboard.press('Escape'); await saveSheet.waitFor({ state: 'hidden' }); assert.equal(new URL(page.url()).hash, source, 'closing the sheet keeps the receipt');
    await page.locator('.receipt-verification-button').click(); await saveSheet.waitFor();
    await page.locator('.check-sheet__done').click(); await saveSheet.waitFor({ state: 'hidden' }); assert.equal(new URL(page.url()).hash, source);
    await page.locator('.receipt-verification-button').click(); await saveSheet.waitFor(); await go('/settings'); await saveSheet.waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).hash.split('?')[0], '#/settings');
    assert.ok(!scenario.logs.some(message => message.includes(INVOICE) || /branta_secret=|#k-/.test(message)), 'request secrets and record fragments must not enter console logs'); await scenario.close();
  });
  await step('Opt-out and first-party invoices avoid lookups without claiming merchant verification', async () => {
    for (const firstParty of [false,true]) {
      const scenario = await open({ enabled:firstParty }); await detect({ type:'lightning_invoice',data:INVOICE,firstParty }); await ready(); await page.waitForTimeout(300);
      assert.equal(scenario.requests.length,0); assert.equal(await sheet().locator('.recipient-verified').count(),0); await scenario.close();
    }
  });
  await step('Review and both proof levels fit 320px 200 percent translated text', async () => {
    for (const locale of ['en-US','de','es']) {
      const scenario = await open({ locale }); await page.setViewportSize({width:320,height:844}); await page.evaluate(() => { document.documentElement.style.fontSize='200%'; });
      await detect(); await sheet().locator('.recipient-verified').waitFor(); await fits(`${locale}: review`); await shot(`09-large-review-${locale}`);
      await showProof(); await fits(`${locale}: proof`); await shot(`10-large-proof-${locale}`); await scenario.close();
    }
  });
  assert.deepEqual(errors,[]); console.log('PASS: Branta 4.4 verification, monetary values and saved proof');
} catch (error) {
  console.error(`FAIL at ${stepName}`); console.error(error); if(errors.length)console.error(errors);
  console.error(await page?.evaluate(() => ({ quotes: window.__brantaQuotes, status: window.__brantaWallet?.pendingPayment?.branta?.status,
    walletId: window.__brantaWallet?.getSendingWallet()?.id, walletType: window.__brantaWallet?.getSendingWalletType(),
    amount: window.__brantaWallet?.payingAmountSats, hasInvoice: !!window.__brantaWallet?.pendingPayment?.invoice,
    pendingType: window.__brantaWallet?.pendingPayment?.type,
    target: window.__brantaWallet?.brantaReview().target(window.__brantaWallet?.pendingPayment)?.kind })).catch(() => null));
  await page?.screenshot({path:`${output}/FAIL.png`}).catch(()=>{}); process.exitCode=1;
} finally { await Promise.allSettled([...contexts].map(context=>context.close())); await browser.close(); }
