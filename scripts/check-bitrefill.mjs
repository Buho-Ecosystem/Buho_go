/** Browser check for the Bitrefill shop (pages/BitrefillPage.vue).
 *
 * Part 1 runs Bitrefill's real widget: the email step on first open, then the
 * widget loads with the documented parameters and the email filled in.
 * Part 2 stands a local page in for the widget at its real origin and sends
 * the widget's documented messages, so the payment runs end to end without
 * an order at Bitrefill: the confirm sheet, the payment, never paying an
 * invoice twice, a refused payment, an expired price, messages from elsewhere.
 *
 * Start the dev server first, with the shop switched on and Bitrefill's demo
 * source until BuhoGO is approved (the real widget refuses unapproved names):
 *   VITE_BITREFILL_ENABLED=true VITE_BITREFILL_UTM_SOURCE=bitrefill_demo npx quasar dev --port 9311
 * Then: BITREFILL_BASE_URL=http://localhost:9311 node scripts/check-bitrefill.mjs
 * BITREFILL_MOCK_ONLY=1 skips part 1, so nothing contacts the real storefront.
 * Screenshots go to output/bitrefill-check/. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

const base = process.env.BITREFILL_BASE_URL || 'http://localhost:9311';
const output = process.env.BITREFILL_OUTPUT || new URL('../output/bitrefill-check', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const WIDGET = 'https://embed.bitrefill.com';
// Signed, unpayable test invoices (random key), fresh on every run because
// they expire after 10 minutes. Every order gets its own: the app knows an
// invoice by its payment hash, so the same one twice is the same payment.
const { execFileSync } = await import('node:child_process');
const signInvoice = (sats, memo, age = 0) => execFileSync('node', [new URL('./fixtures/bitrefill-invoice.mjs', import.meta.url).pathname, String(sats), memo, String(age)]).toString().trim();
const AMAZON = 139740;
const REWE = 55900;
const amazon = () => signInvoice(AMAZON, 'Amazon.de Germany 100 EUR');
const INVOICE = amazon();
const EXPIRED_INVOICE = signInvoice(REWE, 'REWE 40 EUR', 3600);
const OTHER_INVOICE = signInvoice(REWE, 'REWE 40 EUR');

const WALLETS = [
  { id: 'daily', type: 'spark', name: 'Daily', metadata: {} },
  { id: 'savings', type: 'spark', name: 'Savings', metadata: {} },
];

// The stand-in widget: relays whatever the test asks it to post, exactly as
// the real widget posts (a JSON string to the parent window).
const STUB = `<!doctype html><html><body style="margin:0;background:#1a1a1a;color:#fff;font:16px sans-serif">
<p style="padding:24px">Stand-in widget</p>
<script>
addEventListener('message', function (e) {
  if (e.data && e.data.post) parent.postMessage(JSON.stringify(e.data.post), '*');
});
</script></body></html>`;

const browser = await chromium.launch({ headless: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let n = 0;
const shot = async (page, name) => { n++; await page.screenshot({ path: `${output}/${String(n).padStart(2, '0')}-${name}.png` }); };

async function open({ theme = 'dark', stubWidget = false, emailAsked = false, email = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });
  page.on('console', (m) => { if (m.type() === 'error' && /Vue warn|is not a function|Cannot read/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  const widgetUrls = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === WIDGET && route.request().resourceType() === 'document') widgetUrls.push(url.href);
    if (url.origin === WIDGET && stubWidget) return route.fulfill({ body: STUB, contentType: 'text/html' });
    if (url.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.iconify.design'].includes(url.hostname)) return route.continue();
    // The real widget, and everything it loads itself (a request from inside
    // its frame). Blocking its own scripts makes it misbehave.
    let fromWidgetFrame = false;
    try { fromWidgetFrame = route.request().frame().parentFrame() !== null; } catch { fromWidgetFrame = false; }
    if (!stubWidget && (url.origin === WIDGET || fromWidgetFrame)) return route.continue();
    return route.abort();
  });
  await page.routeWebSocket('**', (socket) => { if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close(); });
  await page.addInitScript(([theme, emailAsked]) => {
    // Init scripts run in every frame; the widget's own frames are not ours.
    if (window.top !== window) return;
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    if (emailAsked) localStorage.setItem('buhoGO_bitrefill_email_asked', '1');
  }, [theme, emailAsked]);
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => window.__audit?.app?.config?.globalProperties?.$pinia, null, { timeout: 120000 });
  await page.evaluate(async ([wallets, email]) => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    store.$patch({ savedStateLoaded: true, isInitialized: true, useBip177Format: false, preferredFiatCurrency: 'EUR' });
    store.exchangeRates = { ...store.exchangeRates, eur: 71500 };
    store.wallets = wallets.map((w, i) => ({ ...w, createdAt: i + 1, lastUsed: 10 - i }));
    store.activeWalletId = wallets[0].id;
    store.hasBackedUp = true;
    for (const w of wallets) {
      store.connectionStates[w.id] = { connected: true, error: null };
      store.balanceStates[w.id] = { value: w.id === 'daily' ? 412380 : 90000, known: true, source: 'sync', verifiedAt: Date.now(), updatedAt: Date.now() };
    }
    store.refreshBalance = async () => {};
    store.refreshWalletData = async () => {};
    // The payment stand-in: counts invoices handed to a wallet, and answers
    // the way window.__payBehaviour says.
    window.__payments = [];
    window.__payBehaviour = 'ok';
    window.__walletRecords = [];
    store.ensureWalletConnectedForTransfer = async (walletId) => ({
      getLightningSendFeeEstimate: async () => ({ estimatedFeeSats: 3 }),
      getTransactions: async () => window.__walletRecords,
      payInvoice: async ({ invoice, maxFee }) => {
        window.__payments.push({ walletId, invoice, maxFee });
        const id = `tx-${window.__payments.length}`;
        const how = window.__payBehaviour;
        // Refused before any money moves: certainly not paid.
        if (how === 'refuse') throw Object.assign(new Error('Lightning payment failed: fee 900 sats exceeds the 8 sats limit'), { code: 'LIGHTNING_FEE_ABOVE_LIMIT' });
        // An error that says nothing about the payment.
        if (how === 'throw') throw new Error('connection reset');
        if (how === 'pending') return { id, status: 'pending' };
        if (how === 'slow') await new Promise((r) => setTimeout(r, 1500));
        return { id, status: 'completed' };
      },
    });
    if (email) {
      const { encryptString } = await import('/src/utils/deviceCrypto.js');
      localStorage.setItem('buhoGO_bitrefill_email', await encryptString(email));
      localStorage.setItem('buhoGO_bitrefill_email_asked', '1');
    }
  }, [WALLETS, email]);
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/bitrefill'));
  return { page, context, errors, widgetUrls };
}

const post = (page, data) => page.evaluate((d) => document.querySelector('iframe.bitrefill-frame').contentWindow.postMessage({ post: d }, '*'), data);
// The widget states the order's amount in BTC; the app checks it against the invoice.
const intent = (invoiceId, invoice = INVOICE, sats = AMAZON) => ({ event: 'payment_intent', invoiceId, paymentUri: `lightning:${invoice}`, paymentMethod: 'lightning', paymentAmount: sats / 1e8, paymentCurrency: 'BTC' });
const sheet = (page) => page.locator('.sheet-card').first();
// Paying from the shop always takes the slide, whatever the amount.
const slide = async (page) => {
  const track = sheet(page).locator('.slide-track');
  await track.waitFor({ timeout: 5000 });
  await page.waitForFunction(() => !document.querySelector('.sheet-card .fee-pending'), null, { timeout: 10000 });
  await track.focus();
  await page.keyboard.press('Enter');
};
const toastText = (page) => page.locator('.q-notification, .toast, [role="status"]').allInnerTexts();
const said = async (page, pattern) => (await toastText(page)).some((t) => pattern.test(t));
const waitSaid = (page, text, timeout = 5000) => page.waitForFunction((needle) => [...document.querySelectorAll('.q-notification, .toast, [role="status"]')].some((n) => n.innerText.includes(needle)), text, { timeout });
const ledgerEntry = (page, invoiceId) => page.evaluate((id) => (JSON.parse(localStorage.getItem('buhoGO_bitrefill_invoices')) || []).find((e) => e.invoiceId === id) || null, invoiceId);
const noSheet = (page, timeout = 6000) => page.waitForFunction(() => !document.querySelector('.sheet-card'), null, { timeout });

// ── Part 1 · the real widget ──────────────────────────────────────────────
if (process.env.BITREFILL_MOCK_ONLY !== '1') {
  const { page, context, errors, widgetUrls } = await open({ theme: 'dark' });
  // First open: the email step, before anything loads.
  await page.getByText('Email for your vouchers').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('iframe.bitrefill-frame').count(), 0, 'the widget waits for the email step');
  // Title, field label and button all say this address receives the vouchers.
  assert.match(await page.locator('.brmail-lead').innerText(), /sends every voucher you buy to this address/);
  assert.equal((await page.locator('.brmail-label').innerText()).trim(), 'Send vouchers to');
  assert.equal((await page.locator('.brmail-primary').innerText()).trim(), 'Use this email');
  assert.match(await page.locator('.brmail-notes').innerText(), /Anyone who can read this inbox can open your vouchers/);
  await page.waitForFunction(() => { const i = document.querySelector('.brmail-tile img'); return i && i.complete && i.naturalWidth > 0; });
  await pause(400);
  await shot(page, 'email-step');
  // An invalid address is refused in place.
  await page.locator('.brmail-input').fill('not-an-email');
  await page.locator('.brmail-primary').click();
  await page.getByText('Enter a valid email address.').waitFor();
  await page.locator('.brmail-input').fill('me@example.com');
  await page.locator('.brmail-primary').click();
  await page.locator('iframe.bitrefill-frame').waitFor({ timeout: 10000 });
  const src = new URL(await page.locator('iframe.bitrefill-frame').getAttribute('src'));
  assert.equal(src.origin, WIDGET);
  assert.equal(src.searchParams.get('email'), 'me@example.com');
  assert.equal(src.searchParams.get('paymentMethods'), 'lightning');
  assert.equal(src.searchParams.get('showPaymentInfo'), 'false');
  assert.equal(src.searchParams.get('theme'), 'dark');
  assert.equal(src.searchParams.get('hl'), 'en');
  assert.equal(src.searchParams.has('customStyles'), false, 'the widget keeps its own look');
  // Stored encrypted, never in the clear.
  const stored = await page.evaluate(() => localStorage.getItem('buhoGO_bitrefill_email'));
  assert.ok(stored && !stored.includes('example.com'), 'the email is stored encrypted');
  await page.waitForFunction(() => document.querySelector('.bitrefill-state') === null, null, { timeout: 30000 });
  await pause(5000);
  await shot(page, 'real-widget');
  console.log(`  widget loaded from ${widgetUrls[0] || src.href}`);
  assert.deepEqual(errors, []);
  await context.close();
console.log('✓ real widget: the email step comes first, then the widget opens with the documented parameters and the email, stored encrypted');
}

// ── Part 1b · "Not now" and editing ──────────────────────────────────────
{
  const { page, context, errors } = await open({ theme: 'light', stubWidget: true });
  await page.getByText('Email for your vouchers').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.locator('iframe.bitrefill-frame').waitFor();
  assert.equal(new URL(await page.locator('iframe.bitrefill-frame').getAttribute('src')).searchParams.has('email'), false, 'no email, no parameter');
  assert.equal(await page.evaluate(() => localStorage.getItem('buhoGO_bitrefill_email_asked')), '1', 'asked once');
  // The header button opens it again, as an editor.
  await page.getByRole('button', { name: 'Voucher email' }).click();
  await page.getByText('Email for your vouchers').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Not now' }).count(), 0, 'editing has no Not now');
  await page.locator('.brmail-input').fill('later@example.com');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => new URL(document.querySelector('iframe.bitrefill-frame').src).searchParams.get('email') === 'later@example.com');
  await page.locator('.brmail-sheet').waitFor({ state: 'detached' });
  await shot(page, 'light-after-edit');
  // Editing says what it changes; removing asks first and says the shop reloads.
  await page.getByRole('button', { name: 'Voucher email' }).click();
  await page.getByText('Applies to your next order. The shop reloads when you save.').waitFor();
  await page.getByRole('button', { name: 'Remove email' }).click();
  await page.getByText('Remove this email?').waitFor();
  await page.getByText('Bitrefill will ask for an email at checkout. The shop reloads.').waitFor();
  await shot(page, 'remove-email-asks');
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(new URL(await page.locator('iframe.bitrefill-frame').getAttribute('src')).searchParams.get('email'), 'later@example.com', 'Cancel keeps the email');
  await page.getByRole('button', { name: 'Remove email' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.waitForFunction(() => !new URL(document.querySelector('iframe.bitrefill-frame').src).searchParams.has('email'));
  assert.equal(await page.evaluate(() => localStorage.getItem('buhoGO_bitrefill_email')), null);
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ "Not now" opens the shop without an email and is not asked again; the header edits it and reloads the widget; removing it asks first');

// ── Part 2 · paying ───────────────────────────────────────────────────────
{
  const { page, context, errors } = await open({ stubWidget: true, email: 'me@example.com' });
  await page.locator('iframe.bitrefill-frame').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.bitrefill-state') === null);

  // Messages from anywhere but the widget frame are ignored.
  await page.evaluate((m) => window.postMessage(JSON.stringify(m), '*'), intent('forged'));
  await pause(600);
  assert.equal(await page.locator('.sheet-card').count(), 0, 'a message from the page itself opens nothing');

  // Payment may have happened elsewhere before this page tried it.
  await post(page, { event: 'invoice_update', invoiceId: 'already-paid-elsewhere', status: 'payment_detected' });
  await post(page, intent('already-paid-elsewhere', amazon()));
  await pause(500);
  assert.equal(await page.locator('.sheet-card').count(), 0, 'an earlier paid update prevents a later payment intent');
  assert.equal(await page.evaluate(() => window.__payments.length), 0);

  // The widget hands over the invoice: the confirm sheet, Bitrefill as
  // recipient, the fee the wallet quoted and the total, always with the slide.
  await post(page, intent('inv-1'));
  await sheet(page).waitFor({ timeout: 5000 });
  await sheet(page).locator('.slide-track').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => /Total/.test(document.querySelector('.sheet-card')?.innerText || ''), null, { timeout: 10000 });
  const text = await sheet(page).innerText();
  assert.match(text, /Bitrefill/);
  assert.match(text, /139[,.]?740/);
  assert.match(text, /Amazon\.de Germany 100 EUR/);
  assert.match(text, /Daily/);
  assert.match(text, /Network fee/, 'the fee is on the sheet before the slide');
  assert.match(text, /139[,.]?743/, 'and so is the total');
  assert.doesNotMatch(text, /lightning|invoice/i, 'no rail names on the sheet');
  assert.equal(await page.evaluate(() => window.__payments.length), 0, 'nothing is paid before the slide');
  await pause(500);
  await shot(page, 'confirm-sheet');

  await slide(page);
  await page.waitForFunction(() => window.__payments.length === 1, null, { timeout: 5000 });
  await noSheet(page);
  assert.equal(await page.evaluate(() => window.__payments[0].walletId), 'daily');
  assert.equal(await page.evaluate(() => window.__payments[0].maxFee), 3, 'the quoted fee is the cap');
  assert.equal((await ledgerEntry(page, 'inv-1')).state, 'paid');
  assert.ok((await ledgerEntry(page, 'inv-1')).paymentHash, 'the ledger knows the invoice by its payment hash');
  await waitSaid(page, 'Paid. Bitrefill is preparing your order.');
  assert.equal(await said(page, /voucher appears/i), false, 'paid is not delivered: no voucher is promised yet');
  await pause(300);
  await shot(page, 'paid');

  // Bitrefill reports the order delivered: only now is it called ready.
  await post(page, { event: 'invoice_complete', invoiceId: 'inv-1', deliveryStatus: 'delivered', refundNeeded: false });
  await waitSaid(page, 'Your order is ready');

  // The same invoice again, under its own id and under a new one: refused.
  await post(page, intent('inv-1'));
  await pause(800);
  assert.equal(await page.locator('.sheet-card').count(), 0, 'a paid invoice never opens the sheet again');
  await post(page, intent('inv-1-renamed'));
  await pause(800);
  assert.equal(await page.locator('.sheet-card').count(), 0, 'nor under another order id');
  assert.equal(await page.evaluate(() => window.__payments.length), 1);
  assert.ok(await said(page, /already paid/), 'it says so');

  // An order whose stated amount is not the invoice's amount is not paid.
  await post(page, intent('inv-wrong-amount', amazon(), AMAZON * 10));
  await pause(700);
  assert.equal(await page.locator('.sheet-card').count(), 0, 'amount and invoice must describe the same order');

  // A refused payment: the error, the invoice freed for a retry.
  await page.evaluate(() => { window.__payBehaviour = 'refuse'; });
  await post(page, intent('inv-2', amazon()));
  await sheet(page).waitFor();
  await slide(page);
  await page.waitForFunction(() => window.__payments.length === 2);
  await pause(4800); // waits for the widget to report the payment anyway
  assert.equal((await ledgerEntry(page, 'inv-2')).state, 'failed');
  await pause(300);
  await shot(page, 'refused');
  await page.evaluate(() => { const s = window.__audit.app.config.globalProperties.$pinia._s.get('wallet'); s.paymentError = { ...s.paymentError, visible: false }; });
  // The sheet stays for a retry; while it is open no other order replaces it.
  assert.equal(await page.locator('.sheet-card').count(), 1, 'a refused payment keeps the sheet for a retry');
  await post(page, intent('inv-9', OTHER_INVOICE, REWE));
  await pause(500);
  assert.match(await sheet(page).innerText(), /139[,.]?740/, 'the order on screen is not swapped');
  await sheet(page).locator('.top-btn').first().click();
  await noSheet(page, 4000);

  // An error that says nothing about the payment: the invoice stays blocked.
  await page.evaluate(() => { window.__payBehaviour = 'throw'; });
  await post(page, intent('inv-unknown', amazon()));
  await sheet(page).waitFor();
  await slide(page);
  await noSheet(page, 9000);
  assert.equal((await ledgerEntry(page, 'inv-unknown')).state, 'attempted', 'an unknown outcome is not "failed"');
  assert.ok(await said(page, /couldn't confirm this payment/), 'it says to check before ordering again');
  await post(page, intent('inv-unknown'));
  await pause(700);
  assert.equal(await page.locator('.sheet-card').count(), 0, 'and it is not handed to a wallet again');

  // A thrown error the widget contradicts: it saw the money, so it counts as paid.
  await post(page, intent('inv-3', amazon()));
  await sheet(page).waitFor();
  await slide(page);
  await pause(400);
  await post(page, { event: 'invoice_update', invoiceId: 'inv-3', status: 'payment_detected' });
  await noSheet(page);
  assert.equal((await ledgerEntry(page, 'inv-3')).state, 'paid');

  // A payment still on its way: nothing is celebrated, the invoice stays
  // blocked, and the shop's "paid" settles it.
  await page.evaluate(() => { window.__payBehaviour = 'pending'; });
  await post(page, intent('inv-pending', amazon()));
  await sheet(page).waitFor();
  await slide(page);
  await noSheet(page);
  assert.equal((await ledgerEntry(page, 'inv-pending')).state, 'attempted');
  assert.ok(await said(page, /This payment is on its way/));
  await pause(300);
  await shot(page, 'on-its-way');
  await post(page, { event: 'invoice_update', invoiceId: 'inv-pending', status: 'payment_confirmed' });
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('buhoGO_bitrefill_invoices')) || []).find((e) => e.invoiceId === 'inv-pending')?.state === 'paid', null, { timeout: 4000 });

  // An expired price closes the sheet without paying.
  await page.evaluate(() => { window.__payBehaviour = 'ok'; });
  const before = await page.evaluate(() => window.__payments.length);
  await post(page, intent('inv-4', amazon()));
  await sheet(page).waitFor();
  await post(page, { event: 'invoice_update', invoiceId: 'inv-4', status: 'expired' });
  await noSheet(page, 4000);
  assert.equal(await page.evaluate(() => window.__payments.length), before, 'an expired invoice is never paid');

  // An invoice that ran out before it arrived: said, never shown for paying.
  await post(page, intent('inv-6', EXPIRED_INVOICE, REWE));
  await pause(700);
  assert.equal(await page.locator('.sheet-card').count(), 0, 'an expired invoice opens nothing');
  assert.ok(await said(page, /price ran out/));

  // A second order arriving while a payment is on its way changes nothing,
  // and neither does the sheet's own close button.
  await page.evaluate(() => { window.__payBehaviour = 'slow'; });
  const count = await page.evaluate(() => window.__payments.length);
  await post(page, intent('inv-7', amazon()));
  await sheet(page).waitFor();
  await slide(page);
  await pause(300);
  await post(page, intent('inv-8', OTHER_INVOICE, REWE));
  await noSheet(page);
  assert.equal(await page.evaluate(() => window.__payments.length), count + 1, 'only the first order was paid');
  assert.equal((await ledgerEntry(page, 'inv-7')).state, 'paid');
  assert.equal(await ledgerEntry(page, 'inv-8'), null, 'the second order was never started');

  // An invoice that is not Lightning, or not an invoice: nothing opens.
  await post(page, { ...intent('inv-5'), paymentMethod: 'bitcoin', paymentUri: 'bitcoin:bc1qxyz' });
  await pause(600);
  assert.equal(await page.locator('.sheet-card').count(), 0);

  // Bitrefill took the money and could not deliver: one plain line, kept
  // until it is read.
  await post(page, { event: 'invoice_complete', invoiceId: 'inv-7', deliveryStatus: 'failed', refundNeeded: true });
  await page.locator('.bitrefill-line').waitFor({ timeout: 4000 });
  assert.match(await page.locator('.bitrefill-line').innerText(), /could not deliver an order/);
  await pause(300);
  await shot(page, 'refund-line');

  // Leaving with an order on screen asks first; the header leads to Spend.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByText('Leave the shop?').waitFor({ timeout: 4000 });
  await pause(300);
  await shot(page, 'leave-asks');
  await page.getByRole('button', { name: 'Stay' }).click();
  await pause(400);
  assert.match(page.url(), /#\/bitrefill$/, 'Stay stays');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await page.waitForFunction(() => /#\/spend$/.test(location.href), null, { timeout: 10000 });

  // The refund line is still there on the next visit, until dismissed.
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/bitrefill'));
  await page.locator('.bitrefill-line').waitFor({ timeout: 6000 });
  await page.locator('.bitrefill-line-close').click();
  await page.locator('.bitrefill-line').waitFor({ state: 'detached' });

  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ paying: only the widget frame is heard; the sheet names Bitrefill, the product, the wallet, the fee and the total; paid once, also under another order id; a refusal frees the invoice; an unknown or pending outcome keeps it blocked; the widget\'s own "paid" wins; an expired price closes the sheet or never opens it; a refund shows one line; leaving asks first');

await browser.close();
console.log(`Screenshots: ${output}`);
