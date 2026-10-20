/** Controlled UI check for Pay again: History's swipe, Transaction Details' row, and the send sheet they open.
 * Start `pnpm dev --port 9036` first (or set PAY_AGAIN_BASE_URL). External requests are blocked; no wallet
 * keys, invoices or payments are used. Screenshots go to PAY_AGAIN_OUTPUT. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.PAY_AGAIN_BASE_URL || 'http://localhost:9036';
const output = process.env.PAY_AGAIN_OUTPUT || '/private/tmp/pay-again-review';
await mkdir(output, { recursive: true });

const t = Math.floor(Date.now() / 1000);
// Newest first: a payment that can be made again, one whose recipient was only
// matched by time, and a receive. Shaped as the wallet connection lists them.
const TXS = [
  { payment_hash: 'tx-rent', type: 'outgoing', amount: 1500, fees_paid: 2, settled_at: t - 120, status: 'completed', description: 'Rent' },
  { payment_hash: 'tx-guess', type: 'outgoing', amount: 2100, fees_paid: 1, settled_at: t - 240, status: 'completed', description: 'Order 4471' },
  { payment_hash: 'tx-in', type: 'incoming', amount: 12500, fees_paid: 0, settled_at: t - 360, status: 'completed', description: 'Dinner split' },
  // An on-chain send that can be paid again.
  { payment_hash: 'tx-btc', type: 'outgoing', amount: 50000, fees_paid: 780, settled_at: t - 480, status: 'completed', description: 'Savings', rawType: 'withdrawal' },
  // Last month's rent: the same recipient, listed among the payments to it.
  { payment_hash: 'tx-rent-sep', type: 'outgoing', amount: 1400, fees_paid: 2, settled_at: t - 30 * 86400, status: 'completed', description: 'Rent' },
];
const NWC = `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.example&secret=${'5e'.repeat(32)}`;
const WALLET = { id: 'main', type: 'nwc', name: 'Main', nwcUrl: NWC, metadata: { methods: ['pay_invoice', 'get_balance', 'list_transactions'] } };
const payRequest = {
  tag: 'payRequest', callback: 'https://pay.example/cb', minSendable: 1000, maxSendable: 100000000,
  metadata: JSON.stringify([['text/plain', 'Rent'], ['text/identifier', 'rent@pay.example']]), commentAllowed: 0,
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const errors = [];
const invoiceRequests = [];
page.on('pageerror', (error) => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });
page.on('console', (m) => { if (m.type() === 'error' && /Vue warn|is not a function|Cannot read/.test(m.text())) errors.push(m.text().slice(0, 200)); });
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === 'pay.example') {
    if (url.pathname === '/cb') { invoiceRequests.push(url.href); return route.fulfill({ status: 500, body: 'no invoice in this check' }); }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(payRequest) });
  }
  return url.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.iconify.design'].includes(url.hostname) ? route.continue() : route.abort();
});
await page.routeWebSocket('**', (socket) => { if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close(); });
await page.addInitScript(() => {
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
});

await page.goto(`${base}/#/wallet`);
await page.waitForFunction(() => window.__audit?.app?.config?.globalProperties?.$pinia, null, { timeout: 120000 });
await page.evaluate(async ({ wallet, txs }) => {
  const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
  store.$patch({ savedStateLoaded: true, isInitialized: true, useBip177Format: false, preferredFiatCurrency: 'USD' });
  store.exchangeRates = { ...store.exchangeRates, usd: 85000 };
  store.wallets = [{ ...wallet, createdAt: 1, lastUsed: 1 }];
  store.activeWalletId = wallet.id;
  store.hasBackedUp = true;
  // A stand-in for the wallet's one connection: it lists the fixture, nothing else.
  store.connectionStates[wallet.id] = { connected: true, error: null, nwcInstance: { listTransactions: async () => ({ transactions: txs }) } };
  store.balanceStates[wallet.id] = { value: 184250, known: true, source: 'sync', verifiedAt: Date.now(), updatedAt: Date.now() };
  store.refreshBalance = async () => {};
  const { useTransactionMetadataStore } = await import('/src/stores/transactionMetadata.js');
  const metadata = useTransactionMetadataStore();
  await metadata.initialize();
  await metadata.setRecipientAddressForTransaction('tx-rent', wallet.id, 'rent@pay.example');
  await metadata.setPayAgainForTransaction('tx-rent', wallet.id, { address: 'rent@pay.example', addressType: 'lightning', amountSats: 1500 });
  // Matched by time only: the address shows, but it is never paid again.
  await metadata.setRecipientAddressForTransaction('tx-guess', wallet.id, 'guess@pay.example');
  await metadata.setRecipientAddressForTransaction('tx-rent-sep', wallet.id, 'rent@pay.example');
  await metadata.setPayAgainForTransaction('tx-btc', wallet.id, { address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', addressType: 'bitcoin', amountSats: 50000 });
  // The list History last showed, which the payments sheet reads for a wallet without a provider.
  localStorage.setItem('buhoGO_tx_cache_v1', JSON.stringify({ [wallet.id]: txs.map(({ payment_hash: id, ...tx }) => ({ ...tx, id })) }));
}, { wallet: WALLET, txs: TXS });

const go = async (path) => { await page.evaluate((p) => window.__audit.app.config.globalProperties.$router.push(p), path); await pause(1500); };
const rows = () => page.locator('.tx-slide');
const offset = (row) => row.locator('.q-slide-item__content').evaluate((el) => el.style.transform || 'none');
/** Drag a row left by `dx` px with the mouse; `hold` leaves the button down (for a screenshot). */
async function drag(row, dx, { hold = false } = {}) {
  const box = await row.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 30, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 30 - dx, y, { steps: 12 });
  if (!hold) await page.mouse.up();
}
async function release(row) {
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await pause(400);
}
async function openHistory() {
  // History reads the active wallet from the saved wallet state.
  await page.evaluate((wallet) => localStorage.setItem('buhoGO_wallet_state', JSON.stringify({
    activeWalletId: wallet.id, preferredFiatCurrency: 'USD', connectedWallets: [{ id: wallet.id, type: 'nwc', name: wallet.name, nwcString: wallet.nwcUrl }],
  })), WALLET);
  await go('/transactions');
  await rows().nth(2).waitFor();
}
/** Open Transaction Details for one fixture payment, loaded from the wallet's connection as History opens it. */
async function openDetails(id) {
  await go(`/transaction/${id}?wallet=main`);
  await page.locator('.hero-card').first().waitFor();
  await page.waitForFunction((txId) => {
    for (const el of document.querySelectorAll('*')) for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'TransactionDetailsPage') return c.proxy.transaction?.id === txId;
    return false;
  }, id);
  await pause(400);
}
async function expectSheet(from) {
  await page.waitForFunction(() => location.hash.startsWith('#/wallet'));
  const sheet = page.locator('.sheet-card:not(.sheet-card--redeem)');
  await sheet.waitFor({ timeout: 20000 });
  await pause(500);
  assert.equal(await sheet.locator('.amount-input').first().inputValue(), '1500', 'the last amount, as sats');
  assert.equal(await sheet.locator('.slide-track').count(), 1, 'a payment made again ends on the slide');
  assert.equal(invoiceRequests.length, 0, 'nothing is requested, let alone paid, before the slide');
  await page.screenshot({ path: `${output}/${from}-sheet.png` });
  await sheet.locator('.top-btn').first().click();
  await sheet.waitFor({ state: 'detached' });
  await pause(800);
}

try {
  // 1. Only the payment with a send-time record slides; the others do not move at all.
  await openHistory();
  await page.screenshot({ path: `${output}/history-light.png` });
  // Without the action there is no pan on the row at all (QSlideItem adds it
  // only for a slot), so it cannot be swiped; a tap still opens its details.
  assert.equal(await rows().nth(0).locator('.q-slide-item__right').count(), 1);
  for (const i of [1, 2]) assert.equal(await rows().nth(i).locator('.q-slide-item__right').count(), 0, `row ${i} has no Pay again`);
  // A Bitcoin address can be paid again too.
  assert.equal(await rows().nth(3).locator('.q-slide-item__right').count(), 1, 'the on-chain payment has Pay again');
  await drag(rows().nth(3), 150, { hold: true });
  await pause(150);
  await page.screenshot({ path: `${output}/history-swipe-onchain.png` });
  await release(rows().nth(3));
  console.log('✓ a row whose recipient was only matched by time, and a receive, never slide');

  // 2. A short swipe reveals the action and springs back without paying.
  await drag(rows().nth(0), 150, { hold: true });
  await pause(150);
  await page.screenshot({ path: `${output}/history-swipe-light.png` });
  await release(rows().nth(0));
  assert.ok(page.url().includes('#/transactions'), 'a short swipe does nothing');
  console.log('✓ a short swipe reveals Pay again and springs back');

  // 3. A full swipe opens the normal send sheet, and closing it comes back to History.
  await drag(rows().nth(0), 300);
  await expectSheet('history');
  await page.waitForFunction(() => location.hash.startsWith('#/transactions'));
  await rows().nth(0).waitFor();
  assert.notEqual(await offset(rows().nth(0)), 'translateX(-100%)', 'the row is back in place');
  console.log('✓ a full swipe opens the send sheet with the last amount and the slide; closing returns to History');

  // 4. Transaction Details: the visible row does the same; a time-matched recipient offers none.
  await openDetails('tx-rent');
  await page.locator('.pay-again-row').waitFor();
  assert.ok((await page.locator('.pay-again-row').boundingBox()).height >= 44);
  await page.screenshot({ path: `${output}/details-light.png`, fullPage: true });
  await page.locator('.pay-again-row').click();
  await expectSheet('details');
  await page.waitForFunction(() => location.hash.startsWith('#/transaction/tx-rent'));
  await openDetails('tx-guess');
  await page.locator('.receipt-more').waitFor();
  assert.equal(await page.locator('.pay-again-row').count(), 0);
  console.log('✓ Details: the Pay again row opens the same sheet and returns; none for a time-matched recipient');

  // 5. Payments to this recipient: from the To row and from More options, each one opens its receipt.
  await openDetails('tx-rent');
  const paymentsSheet = page.locator('.payments-sheet');
  await page.locator('.tx-row--link', { hasText: 'rent@pay.example' }).click();
  await paymentsSheet.waitFor();
  await pause(400);
  const stats = await paymentsSheet.locator('.payments-stat strong').allInnerTexts();
  assert.deepEqual(stats, ['2,900 sats', '2'], 'two payments, 1,500 + 1,400 sats');
  assert.match(await paymentsSheet.innerText(), /Sent in total/);
  assert.equal(await paymentsSheet.locator('.payments-row').count(), 2);
  assert.equal(await paymentsSheet.locator('.payments-row--current').count(), 1, 'this payment is marked');
  assert.equal(await page.getByText('Order 4471').count(), 0, 'another recipient is not listed');
  await page.screenshot({ path: `${output}/payments-sheet-light.png` });
  await paymentsSheet.getByRole('button', { name: 'Done' }).click();
  await paymentsSheet.waitFor({ state: 'detached' });
  await page.locator('.receipt-more').click();
  await page.getByText('Payments to this recipient', { exact: true }).click();
  await paymentsSheet.waitFor();
  await paymentsSheet.locator('.payments-row:not(.payments-row--current)').click();
  await page.waitForFunction(() => location.hash.startsWith('#/transaction/tx-rent-sep'));
  // The other receipt itself is shown, not only its address.
  await page.waitForFunction(() => {
    for (const el of document.querySelectorAll('*')) for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'TransactionDetailsPage') return c.proxy.transaction?.id === 'tx-rent-sep';
    return false;
  });
  await openDetails('tx-guess');
  await page.getByText('Order 4471').first().waitFor();
  assert.equal(await page.locator('.tx-row--link', { hasText: 'guess@pay.example' }).count(), 0, 'no list for a recipient that cannot be paid again');
  console.log('✓ payments to this recipient: from the To row and More options, totals, this one marked, each opens its receipt');

  // 6. Dark mode, and German, for the swipe and the row.
  await openHistory();
  await page.evaluate(() => { window.__audit.setDark(true); window.__audit.app._instance.proxy.$i18n.locale = 'de'; });
  await pause(300);
  await drag(rows().nth(0), 150, { hold: true });
  await pause(150);
  await page.screenshot({ path: `${output}/history-swipe-dark-de.png` });
  await release(rows().nth(0));
  await openDetails('tx-rent');
  await page.locator('.pay-again-row').waitFor();
  await page.screenshot({ path: `${output}/details-dark-de.png`, fullPage: true });
  await page.locator('.tx-row--link', { hasText: 'rent@pay.example' }).click();
  await paymentsSheet.waitFor();
  await pause(400);
  await page.screenshot({ path: `${output}/payments-sheet-dark-de.png` });
  console.log('✓ dark mode and German');

  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
