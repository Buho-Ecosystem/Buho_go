/** Browser check for Auto-Transfer (stores/autoWithdraw.js, utils/autoTransfer.js):
 * the Settings card, the empty page, building a rule through the sheet (wallet,
 * a fiat amount, keep some, a destination from My wallets, a pasted Bitcoin
 * address), the rule page (meter, switch, activity), a rule that needs
 * attention on its page and on Home, history and transaction details, and the
 * wallet's details row. Light and dark.
 * Start `pnpm dev --port 9031` first (or set AT_BASE_URL). Screenshots go to
 * output/auto-transfer-check/. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.AT_BASE_URL || 'http://localhost:9031';
const output = process.env.AT_OUTPUT || new URL('../output/auto-transfer-check', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const NWC = `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&secret=${'5e'.repeat(32)}`;
const BTC = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const WALLETS = [
  { id: 'shop', type: 'spark', name: 'Shop', metadata: {} },
  { id: 'savings', type: 'spark', name: 'Savings', metadata: {} },
  { id: 'ark', type: 'arkade', name: 'Arkade', metadata: {} },
  { id: 'hub', type: 'nwc', name: 'Alby Hub', nwcUrl: NWC, metadata: { methods: ['pay_invoice', 'make_invoice', 'get_balance', 'lookup_invoice'] } },
];
const BALANCES = { shop: 184250, savings: 1250000, ark: 12000, hub: 48210 };
const now = Date.now();
const RULES = {
  hub: { enabled: false, threshold: { sats: 50000 }, keep: null, destination: { kind: 'lightning', address: 'satoshi@getalby.com', name: 'Satoshi' }, feeSpeed: 'medium', pausedReason: null, failureStreak: 0, events: [{ at: now - 26 * 3600e3, outcome: 'sent', amount: 51000, txId: 'tx-old' }], lastTriggeredAt: null },
  ark: { enabled: true, threshold: { sats: 10000 }, keep: null, destination: { kind: 'lightning', address: 'satoshi@getalby.com' }, feeSpeed: 'medium', pausedReason: null, failureStreak: 0, events: [{ at: now - 120e3, outcome: 'skipped', reason: 'cannot_pay' }], lastTriggeredAt: null },
};

const browser = await chromium.launch({ headless: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let n = 0;
const shot = async (page, name) => { n++; await page.screenshot({ path: `${output}/${String(n).padStart(2, '0')}-${name}.png` }); };

async function open({ theme = 'light', rules = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });
  page.on('console', (m) => { if (m.type() === 'error' && /Vue warn|is not a function|Cannot read/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'getalby.com' && url.pathname.startsWith('/.well-known/lnurlp/')) {
      return route.fulfill({ json: { tag: 'payRequest', callback: 'https://getalby.com/cb', minSendable: 1000, maxSendable: 1e11 } });
    }
    return url.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.iconify.design'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.routeWebSocket('**', (socket) => { if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close(); });
  await page.addInitScript(([theme, rules]) => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buhoGO_auto_withdraw', JSON.stringify({ configs: rules }));
  }, [theme, rules]);
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => window.__audit?.app?.config?.globalProperties?.$pinia, null, { timeout: 90000 });
  await page.evaluate(async ({ wallets, balances, rules }) => {
    const pinia = window.__audit.app.config.globalProperties.$pinia;
    const store = pinia._s.get('wallet');
    store.$patch({ savedStateLoaded: true, isInitialized: true, useBip177Format: false, preferredFiatCurrency: 'USD' });
    store.exchangeRates = { ...store.exchangeRates, usd: 50000, eur: 46000 };
    store.wallets = wallets.map((w, i) => ({ ...w, createdAt: i + 1, lastUsed: 10 - i }));
    store.activeWalletId = wallets[0].id;
    store.hasBackedUp = true;
    for (const w of wallets) {
      store.connectionStates[w.id] = { connected: true, error: null };
      store.balanceStates[w.id] = { value: balances[w.id], known: true, source: 'sync', verifiedAt: Date.now(), updatedAt: Date.now() };
    }
    store.refreshBalance = async () => {};
    const { useAutoWithdrawStore } = await import('/src/stores/autoWithdraw.js');
    const aw = useAutoWithdrawStore();
    await aw.initialize({ wallets: store.wallets });
    // The UI checks move no money; section 6 puts the real engine back.
    window.__realCheckAndExecute = aw.checkAndExecute;
    aw.checkAndExecute = async () => {};
    const book = pinia._s.get('addressBook');
    if (book) book.entries = [{ id: 'c1', name: 'Satoshi', address: 'satoshi@getalby.com', addressType: 'lightning', color: '#3B82F6' }];
  }, { wallets: WALLETS, balances: BALANCES, rules });
  await pause(700);
  return { page, context, errors };
}
const go = async (page, path) => { await page.evaluate((p) => window.__audit.app.config.globalProperties.$router.push(p), path); await pause(1600); };
const awState = (page) => page.evaluate(async () => {
  const { useAutoWithdrawStore } = await import('/src/stores/autoWithdraw.js');
  return JSON.parse(JSON.stringify(useAutoWithdrawStore().configs));
});
const sheet = (page) => page.locator('.at-sheet');
const tapLine = (page, text) => sheet(page).locator('.iform-line', { hasText: text }).first().click();

// 1 · Settings card and the empty page; build a rule through the sheet.
{
  const { page, context, errors } = await open();
  await go(page, '/settings');
  await shot(page, 'settings-card');
  await page.getByText('Auto-Transfer', { exact: true }).first().click();
  await page.waitForFunction(() => location.hash === '#/auto-transfer');
  await pause(900);
  assert.match(await page.locator('.at-empty').innerText(), /Move money on its own/);
  await shot(page, 'empty');

  await page.getByRole('button', { name: 'New Rule' }).click();
  await sheet(page).waitFor();
  await pause(700);
  assert.equal(await page.locator('.at-sheet .at-primary').isDisabled(), true, 'Turn On waits for a complete rule');
  await shot(page, 'new-rule-opened');

  // A fiat amount: swap the keypad to USD and type 500.
  await tapLine(page, 'Holds more than');
  await pause(500);
  await shot(page, 'threshold-sats');
  await page.locator('.amount-keypad__secondary').click();
  for (const key of ['5', '0', '0']) await page.locator('.amount-keypad').getByRole('button', { name: key, exact: true }).click();
  await pause(300);
  await shot(page, 'threshold-fiat');
  await sheet(page).getByRole('button', { name: 'Done' }).click();
  await pause(400);

  // Keep some: $50.
  await tapLine(page, 'Everything');
  await pause(300);
  await tapLine(page, 'Keep some in Shop');
  for (const key of ['5', '0']) await page.locator('.amount-keypad').getByRole('button', { name: key, exact: true }).click();
  await pause(300);
  await shot(page, 'keep-some');
  await sheet(page).getByRole('button', { name: 'Done' }).click();
  await pause(400);

  // Destination: My wallets → Savings.
  await tapLine(page, 'Destination');
  await pause(500);
  await shot(page, 'destination-picker');
  await sheet(page).locator('.iform-line', { hasText: 'Savings' }).click();
  await pause(500);
  const preview = await sheet(page).locator('.iform-foot').innerText();
  assert.match(preview, /Shop holds 184,250 sats now, so nothing moves yet\./);
  assert.equal(await page.locator('.at-sheet .at-primary').isDisabled(), false);
  await shot(page, 'rule-filled');

  await page.locator('.at-sheet .at-primary').click();
  await page.waitForFunction(() => location.hash === '#/auto-transfer/shop', null, { timeout: 5000 });
  await pause(900);
  const saved = (await awState(page)).shop;
  assert.deepEqual([saved.enabled, saved.threshold, saved.keep, saved.destination], [true, { fiat: 500, currency: 'USD' }, { fiat: 50, currency: 'USD' }, { kind: 'wallet', walletId: 'savings' }]);
  assert.match(await page.locator('.at-sentence').innerText(), /When Shop holds more than \$500\.00, move everything above \$50\.00 to Savings\./);
  assert.match(await page.locator('.at-meter-figure').innerText(), /\$92\.13\s*of \$500\.00/, 'the meter in the unit the rule was set in');
  await shot(page, 'rule-page');

  // The switch acts at once.
  await page.locator('.q-toggle').click();
  await pause(300);
  assert.equal((await awState(page)).shop.enabled, false);
  await page.locator('.q-toggle').click();
  await pause(300);
  assert.equal((await awState(page)).shop.enabled, true);
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ setup: fiat amount, keep some, my wallet, live preview; the rule saves and the switch acts at once');

// 2 · A pasted Bitcoin address, its speed, and a checked Lightning address.
{
  const { page, context, errors } = await open();
  await go(page, '/auto-transfer');
  await page.getByRole('button', { name: 'New Rule' }).click();
  await sheet(page).waitFor();
  await tapLine(page, 'Destination');
  await pause(400);
  const vm = await page.evaluateHandle(() => {
    for (let c = document.querySelector('.at-sheet').__vueParentComponent; c; c = c.parent) if (c.type?.name === 'AutoTransferSheet') return c.proxy;
  });
  await vm.evaluate((vm, btc) => vm.takeText(`bitcoin:${btc}?amount=0.1`), BTC);
  await pause(500);
  assert.match(await sheet(page).innerText(), /bc1qxy2k…hx0wlh/);
  assert.match(await sheet(page).innerText(), /Arrives\s*About 30 minutes/);
  await shot(page, 'pasted-bitcoin');
  await tapLine(page, 'Arrives');
  await pause(400);
  await shot(page, 'speed');
  await tapLine(page, 'Next block');
  await pause(300);
  await tapLine(page, 'bc1qxy2k');
  await vm.evaluate((vm) => vm.takeText('satoshi@getalbu.com'));
  await page.waitForFunction(() => !document.querySelector('.at-sheet').innerText.includes('Checking…'), null, { timeout: 12000 });
  assert.match(await sheet(page).innerText(), /satoshi@getalbu\.com didn't answer\./, 'a Lightning address is checked when chosen');
  await shot(page, 'lightning-no-answer');
  await vm.evaluate((vm) => vm.takeText('hello there'));
  await pause(300);
  assert.match(await sheet(page).innerText(), /That is not an address this wallet can send to\./);
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ destinations: a pasted Bitcoin address with its speed; a Lightning address that does not answer is refused');

// 3 · Several rules: the list, a rule needing attention, Home's line and sheet.
{
  const { page, context, errors } = await open({ rules: RULES });
  await go(page, '/auto-transfer');
  const rows = await page.locator('[data-audit="auto-transfer-rule"]').allInnerTexts();
  assert.deepEqual(rows.map((r) => r.replace(/\s+/g, ' ').trim()), ["Arkade → satoshi@getalby.com Can't send", 'Alby Hub → Satoshi Paused']);
  await shot(page, 'list');
  await go(page, '/auto-transfer/ark');
  assert.match(await page.locator('.at-card--warn').innerText(), /Can't send to satoshi@getalby\.com\s*Arkade can't pay this destination right now\./);
  await shot(page, 'rule-attention');
  await go(page, '/wallet');
  assert.equal(await page.locator('[data-audit="auto-transfer-line"]').innerText(), "Auto-Transfer can't send from Arkade");
  await shot(page, 'home-line');
  await page.locator('[data-audit="auto-transfer-line"]').click();
  await pause(700);
  await shot(page, 'home-sheet');
  await page.getByRole('button', { name: 'Pause Rule' }).click();
  await pause(600);
  assert.equal((await awState(page)).ark.enabled, false);
  assert.equal(await page.locator('[data-audit="auto-transfer-line"]').count(), 0, 'the line leaves once nothing needs the person');
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ attention: the list says it, the rule page explains it, Home shows one line and a sheet, Pause clears it');

// 4 · After a transfer: toast, history row, transaction details; the wallet's details row.
{
  const { page, context, errors } = await open({ rules: { shop: { ...RULES.hub, enabled: true, destination: { kind: 'wallet', walletId: 'savings' }, events: [] } } });
  await go(page, '/wallet');
  await page.evaluate(async () => {
    const { useAutoWithdrawStore } = await import('/src/stores/autoWithdraw.js');
    useAutoWithdrawStore().lastResult = { walletId: 'shop', amount: 178722, destinationName: 'Savings' };
  });
  await page.waitForFunction(() => document.body.innerText.includes('Moved 178,722 sats'), null, { timeout: 4000 });
  await pause(300);
  await shot(page, 'toast');
  await pause(4500);

  await page.evaluate(async () => {
    const pinia = window.__audit.app.config.globalProperties.$pinia;
    const s = pinia._s.get('wallet');
    for (const w of s.wallets) s.connectionStates[w.id] = { connected: true, error: null };
    s.providers.shop = { getTransactions: async () => [], listTransactions: async () => [] };
    const { useTransactionMetadataStore } = await import('/src/stores/transactionMetadata.js');
    const meta = useTransactionMetadataStore();
    await meta.addTagToTransaction('tx-at', 'shop', 'auto-withdraw');
    await meta.setSourceForTransaction('tx-at', 'shop', 'auto-transfer');
    await meta.setLabelForTransaction('tx-at', 'shop', 'Savings');
  });
  await go(page, '/transactions');
  await page.evaluate(() => {
    let vm;
    for (const el of document.querySelectorAll('*')) for (let c = el.__vueParentComponent; c; c = c.parent) if (!vm && c.type?.name === 'TransactionHistoryPage') vm = c.proxy;
    const t = Math.floor(Date.now() / 1000);
    vm.walletState = { ...(vm.walletState || {}), activeWalletId: 'shop' };
    vm.isLoading = false; vm.showLoadingScreen = false; vm.hasMoreTransactions = false;
    vm.transactions = [
      { id: 'tx-in', type: 'incoming', amount: 21000, settled_at: t - 600, status: 'completed', description: 'Coffee x3', fee: 0 },
      { id: 'tx-at', type: 'outgoing', amount: -178722, settled_at: t - 3 * 3600, status: 'completed', description: '', fee: 0 },
      { id: 'tx-in2', type: 'incoming', amount: 45000, settled_at: t - 4 * 3600, status: 'completed', description: 'Lunch', fee: 0 },
    ];
  });
  await pause(900);
  assert.match(await page.locator('body').innerText(), /To Savings/);
  await shot(page, 'history');
  assert.deepEqual(errors, []);

  await go(page, '/settings');
  const vm = await page.evaluateHandle(() => {
    for (const el of document.querySelectorAll('*')) for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'SettingsPage') return c.proxy;
  });
  await vm.evaluate((vm) => { vm.showWalletsDialog = true; vm.detailWalletId = 'shop'; });
  await pause(900);
  assert.match(await page.locator('[data-audit="detail-auto-transfer"]').innerText(), /Auto-Transfer\s*To Savings/);
  await page.locator('[data-audit="detail-auto-transfer"]').scrollIntoViewIfNeeded();
  await shot(page, 'wallet-details');
  await page.locator('[data-audit="detail-auto-transfer"]').click();
  await page.waitForFunction(() => location.hash === '#/auto-transfer/shop', null, { timeout: 5000 });
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ afterwards: the toast names where it went, history says "To Savings", the wallet\'s details lead to the rule');

// 5 · Dark.
{
  const { page, context, errors } = await open({ theme: 'dark', rules: { ...RULES, shop: { ...RULES.hub, enabled: true, threshold: { sats: 500000 }, keep: { sats: 100000 }, destination: { kind: 'wallet', walletId: 'savings' }, events: [{ at: now - 3 * 3600e3, outcome: 'sent', amount: 402310, txId: 'x' }, { at: now - 30 * 3600e3, outcome: 'failed', reason: 'offline' }] } } });
  await go(page, '/auto-transfer');
  await shot(page, 'dark-list');
  await go(page, '/auto-transfer/shop');
  await shot(page, 'dark-rule-page');
  await page.getByRole('button', { name: 'Edit' }).click();
  await sheet(page).waitFor();
  await pause(700);
  await shot(page, 'dark-edit-sheet');
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ dark: list, rule page, edit sheet');

// 6 · The real chain: a verified balance → the engine → a wallet-to-wallet
// transfer → history stamp → toast; a failure → no alert, the Home line;
// five in a row → paused. Only the network providers are stand-ins.
{
  const { page, context, errors } = await open({ rules: { shop: { enabled: true, threshold: { sats: 500000 }, keep: { sats: 100000 }, destination: { kind: 'wallet', walletId: 'savings' }, feeSpeed: 'medium', events: [] } } });
  await go(page, '/wallet');
  const run = (balance) => page.evaluate(async (balance) => {
    const pinia = window.__audit.app.config.globalProperties.$pinia;
    const store = pinia._s.get('wallet');
    const { useAutoWithdrawStore } = await import('/src/stores/autoWithdraw.js');
    const aw = useAutoWithdrawStore();
    // The real engine this time (the open() helper stubbed it for the UI checks).
    aw.checkAndExecute = window.__realCheckAndExecute;
    window.__sent = window.__sent || [];
    store.providers.shop = {
      getBalance: async () => ({ balance }),
      transferToSparkAddress: async (address, amount) => {
        if (window.__failNext) throw new Error('Request timed out');
        window.__sent.push([address, amount]);
        return { id: `sp-${window.__sent.length}` };
      },
    };
    store.providers.savings = { getSparkAddress: async () => 'sp1qsavingsaddress' };
    store.ensureWalletConnectedForTransfer = async (id) => store.providers[id];
    store.refreshWalletData = async () => {};
    store.balanceStates.shop = { ...store.balanceStates.shop, value: balance, verifiedAt: Date.now() };
    store.applyBalance('shop', balance, { source: 'sync', at: Date.now() + Math.random() });
    for (let i = 0; i < 40 && Object.keys(aw.configs.shop.events || {}).length === (window.__events || 0); i++) await new Promise((r) => setTimeout(r, 50));
    window.__events = aw.configs.shop.events.length;
    return JSON.parse(JSON.stringify({ sent: window.__sent, rule: aw.configs.shop }));
  }, balance);

  let state = await run(612400);
  assert.deepEqual(state.sent, [['sp1qsavingsaddress', 512400]], 'everything above the 100,000 kept, free between Spark wallets');
  assert.deepEqual(state.rule.events.map((e) => [e.outcome, e.amount]), [['sent', 512400]]);
  await page.waitForFunction(() => document.body.innerText.includes('Moved 512,400 sats'), null, { timeout: 4000 });
  const stamp = await page.evaluate(async () => {
    const { useTransactionMetadataStore } = await import('/src/stores/transactionMetadata.js');
    const meta = useTransactionMetadataStore();
    return { source: meta.getSourceForTransaction('sp-1', 'shop'), label: meta.getLabelForTransaction('sp-1', 'shop') };
  });
  assert.deepEqual(stamp, { source: 'auto-transfer', label: 'Savings' });
  await shot(page, 'real-sent-toast');

  // Within the minute after a transfer the rule rests, whatever arrives.
  state = await run(700000);
  assert.equal(state.sent.length, 1, 'cooldown after a transfer');

  // Failures: no alert over Home, the line instead; five in a row pause it.
  await page.evaluate(async () => {
    window.__failNext = true;
    const { useAutoWithdrawStore } = await import('/src/stores/autoWithdraw.js');
    const aw = useAutoWithdrawStore();
    aw.configs.shop = { ...aw.configs.shop, events: [] };
    window.__events = 0;
  });
  const tryNow = () => page.evaluate(async () => {
    // Past the cooldown, the way "Try Again" goes.
    const { useAutoWithdrawStore } = await import('/src/stores/autoWithdraw.js');
    const aw = useAutoWithdrawStore();
    await aw.tryNow('shop', window.__audit.app.config.globalProperties.$pinia._s.get('wallet'));
    return JSON.parse(JSON.stringify(aw.configs.shop));
  });
  state = await tryNow();
  assert.deepEqual([state.events[0].outcome, state.events[0].reason, state.enabled], ['failed', 'offline', true]);
  await pause(500);
  assert.equal(await page.locator('.q-dialog').count(), 0, 'no alert opened over Home');
  assert.equal(await page.locator('[data-audit="auto-transfer-line"]').innerText(), "Auto-Transfer couldn't send to Savings");
  await shot(page, 'real-failed-line');
  for (let i = 0; i < 4; i++) state = await tryNow();
  assert.deepEqual([state.enabled, state.pausedReason, state.failureStreak], [false, 'failures', 5], 'five in a row pause the rule');
  await pause(300);
  assert.equal(await page.locator('[data-audit="auto-transfer-line"]').innerText(), 'Auto-Transfer paused · Shop');

  // Try Again from Home's sheet: the rule turns back on and sends.
  await page.evaluate(() => { window.__failNext = false; });
  await page.locator('[data-audit="auto-transfer-line"]').click();
  await pause(600);
  await shot(page, 'real-paused-sheet');
  await page.getByRole('button', { name: 'Try Again' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-audit="auto-transfer-line"]'), null, { timeout: 5000 });
  state = await page.evaluate(async () => {
    const { useAutoWithdrawStore } = await import('/src/stores/autoWithdraw.js');
    return { sent: window.__sent, rule: JSON.parse(JSON.stringify(useAutoWithdrawStore().configs.shop)) };
  });
  assert.equal(state.rule.enabled, true);
  assert.equal(state.rule.events[0].outcome, 'sent');
  assert.equal(state.sent.length, 2);
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ real chain: balance → engine → wallet transfer → history stamp → toast; failures speak on Home, never in an alert');

await browser.close();
console.log(`Screenshots: ${output}`);
