/** Deposit status regression with controlled provider promises; no keys or payments.
 * Start pnpm dev --port 9012, then run this script. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.env.DEPOSIT_BASE_URL || 'http://localhost:9012';
const output = process.env.DEPOSIT_OUTPUT || 'output/axel-onchain/screenshots';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(120000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ USD: 85871, EUR: 78000 }) });
  if (url.origin === base || ['api.iconify.design', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
  return route.abort();
});
await page.routeWebSocket('**', socket => {
  if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
  else socket.close();
});
await page.addInitScript(() => {
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
});
const shot = async name => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
};
try {
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => !!window.__audit?.app?._instance && !!document.querySelector('.wallet-page-light'));
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    let component = document.querySelector('.wallet-page-light').__vueParentComponent;
    while (component && component.type.name !== 'WalletPage') component = component.parent;
    const vm = component.proxy;
    window.vm = vm;
    vm.stopBitcoinDepositPolling();
    clearInterval(vm.refreshInterval);
    const wallet = { id: 'deposit-fixture', type: 'spark', name: 'Personal', connectionData: { accountNumber: 1 } };
    const fixture = window.depositFixture = {
      deposit: { txId: 'fixture-deposit', outputIndex: 0, amount: 66610, confirmed: false }, balance: 0, calls: 0,
    };
    const provider = {
      isConnected: true,
      getL1DepositAddress: async () => 'bc1qexampledepositaddress',
      createInvoice: async () => ({}),
      getClaimFeeQuote: async () => ({ feeSats: 4000, creditAmountSats: 62610 }),
      getPendingDeposits: async () => [fixture.deposit],
      classifyConfirmedDeposit: () => new Promise(resolve => { fixture.quoteReady = resolve; }),
      claimDeposit: () => { fixture.calls++; return new Promise(resolve => { fixture.claimReady = resolve; }); },
      getBalance: () => fixture.holdBalance
        ? new Promise(resolve => { fixture.balanceReady = resolve; })
        : Promise.resolve({ balance: fixture.balance }),
      getTransactions: async () => fixture.balance ? [{ id: 'deposit-payment', type: 'receive', amount: 66610, fee: 396, status: 'completed', timestamp: Math.floor(Date.now() / 1000), rawType: 'STATIC_DEPOSIT', description: '' }] : [],
      getInfo: async () => ({}),
    };
    window.depositProvider = provider;
    const store = vm.walletStore;
    store.ensureSparkConnected = async () => provider;
    store.connectSparkWallet = async () => { throw Error('unexpected real connection'); };
    store.$patch({ wallets: [wallet], activeWalletId: wallet.id, providers: { [wallet.id]: provider },
      connectionStates: { [wallet.id]: { connected: true } }, balances: { [wallet.id]: 0 } });
    vm.walletState.connectedWallets = [wallet];
    vm.walletState.activeWalletId = wallet.id;
    vm.walletState.balance = 0;
    vm.walletState.exchangeRates = { usd: 85871 };
    vm.showLoadingScreen = false;
    vm.bitcoinPrefsStore.autoAddIncomingBitcoin = true;
    await vm.$nextTick();
    await vm.checkPendingBitcoinDeposits();
  });
  await page.getByText('Incoming', { exact: true }).waitFor();
  await page.evaluate(() => {
    window.manualFlashes = [];
    const selector = '.btc-chip, .chip-status, .claim-sheet .confirm-btn, .claim-confirm-btn, .tx-deposit-action, .tx-pending-ready, .q-notification__message';
    const forbidden = /Ready to claim|Add to Wallet|\bClaim\b|\bready\b|Bereit zum Abholen|Zum Wallet hinzufügen/i;
    const inspect = node => {
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      if (!(node instanceof Element)) return;
      for (const element of [node.closest(selector), ...node.querySelectorAll(selector)]) {
        if (element && forbidden.test(element.textContent)) window.manualFlashes.push(element.textContent.trim());
      }
    };
    window.manualObserver = new MutationObserver(records => {
      for (const record of records) {
        inspect(record.target);
        for (const node of record.addedNodes) inspect(node);
      }
    });
    window.manualObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await shot('01-incoming');
  await page.evaluate(() => { window.vm.showReceiveModal = true; });
  await page.locator('.deposit-chip').waitFor();
  await page.locator('.deposit-chip').click();
  await page.locator('.claim-sheet').waitFor();
  await page.evaluate(() => {
    let component = document.querySelector('.l1-bitcoin-receive').__vueParentComponent;
    while (component && component.type.name !== 'L1BitcoinReceive') component = component.parent;
    window.l1 = component.proxy;
  });
  await shot('01b-receive-confirming');
  await page.evaluate(() => {
    window.depositFixture.deposit = { ...window.depositFixture.deposit, confirmed: true };
    return Promise.all([window.vm.checkPendingBitcoinDeposits(), window.l1.checkDeposits()]);
  });
  await page.waitForFunction(() => !!window.depositFixture.quoteReady);
  assert.equal((await page.locator('.btc-chip').textContent()).trim(), 'Incoming');
  assert.equal(await page.getByText('Ready to claim', { exact: true }).count(), 0);
  await page.locator('[data-audit="deposit-automatic"]').waitFor();
  await shot('02-confirmed-auto-add');
  for (const [locale, dark, scale] of [['en-US', true, 1], ['de', false, 2]]) {
    await page.setViewportSize({ width: scale === 2 ? 320 : 390, height: 844 });
    await page.evaluate(({ locale, dark, scale }) => {
      window.vm.$i18n.locale = locale;
      window.__audit.setDark(dark);
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, { locale, dark, scale });
    await shot(`02-auto-${locale}-${dark ? 'dark' : 'light'}-${scale}x`);
    assert.equal(await page.locator('.claim-sheet .confirm-btn').count(), 0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.vm.$i18n.locale = 'en-US';
    window.__audit.setDark(false);
    document.documentElement.style.fontSize = '16px';
  });
  await page.evaluate(() => window.depositFixture.quoteReady({ category: 'eligible', classifiedAt: Date.now(), feeSats: 396, quote: { creditAmountSats: 66214, feeSats: 396 } }));
  await page.waitForFunction(() => !!window.depositFixture.claimReady);
  await shot('03-adding');
  await page.evaluate(() => { window.l1.cancelClaim(); window.vm.showReceiveModal = false; });
  await page.locator('.l1-bitcoin-receive').waitFor({ state: 'detached' });
  await page.evaluate(() => {
    const fixture = window.depositFixture;
    fixture.holdBalance = true;
    fixture.claimReady({ amount: 66214, processing: false });
  });
  await page.waitForFunction(() => !!window.depositFixture.balanceReady);
  assert.equal(await page.locator('.q-notification').count(), 0);
  assert.equal(await page.evaluate(() => window.vm.walletState.balance), 0);
  await page.evaluate(() => {
    const fixture = window.depositFixture;
    fixture.balance = 66214;
    fixture.holdBalance = false;
    fixture.balanceReady({ balance: 66214 });
  });
  await page.waitForFunction(() => window.vm.walletState.balance === 66214 && !!window.vm.lastTransaction);
  await page.locator('.btc-chip').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.q-notification').count(), 0);
  assert.equal(await page.evaluate(() => window.depositFixture.calls), 1);
  assert.equal(await page.evaluate(() => window.vm.lastTxDisplayAmountSats), 66214, 'receipt and balance agree on the net deposit');
  await shot('04-received');
  console.log('PASS: incoming → confirmed → auto-add → updated home balance; no premature manual prompt or success banner');

  // History must use the same decision, including on a direct route entry.
  await page.evaluate(() => {
    window.depositFixture.deposit = { ...window.depositFixture.deposit, txId: 'second-deposit' };
    window.depositFixture.quoteReady = null;
    return window.__audit.app.config.globalProperties.$router.push('/transactions');
  });
  await page.locator('.tx-pending-deposits').waitFor();
  await page.waitForFunction(() => !!window.depositFixture.quoteReady);
  await shot('05-history-checking');
  assert.equal(await page.locator('.tx-deposit-action').count(), 0);
  // Simulate a technical fee-fetch failure. It must not make Claim appear.
  await page.evaluate(() => window.depositFixture.quoteReady({ category: 'quote_failed' }));
  await page.getByText('Retrying', { exact: true }).waitFor();
  await shot('06-history-retrying');
  assert.equal(await page.locator('.tx-deposit-action').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.manualFlashes), [], 'no manual claim DOM appeared during any automatic transition');
  console.log('PASS: DOM observer saw zero manual-claim flashes across home, Receive, confirmation and History, including quote failure');

  // Only a proven policy exception may reveal the action.
  await page.evaluate(async () => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('bitcoinDeposits');
    for (const entry of Object.values(store.entries)) entry.retryAt = 0;
    window.depositFixture.quoteReady = null;
    void store.processDeposits([window.depositFixture.deposit]);
  });
  await page.waitForFunction(() => !!window.depositFixture.quoteReady);
  await page.evaluate(() => {
    window.manualObserver.disconnect();
    window.depositFixture.quoteReady({ category: 'needs_approval', classifiedAt: Date.now(), feeSats: 4000,
      quote: { feeSats: 4000, creditAmountSats: 62610 } });
  });
  await page.locator('.tx-deposit-action').waitFor();
  await shot('07-history-fee-exception');
  await page.locator('.tx-row-ready').click();
  await page.locator('.claim-action-sheet').waitFor();
  await shot('08-manual-fee-review');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/wallet'));
  await page.waitForFunction(() => !!document.querySelector('.wallet-page-light'));
  await page.evaluate(() => {
    let component = document.querySelector('.wallet-page-light').__vueParentComponent;
    while (component && component.type.name !== 'WalletPage') component = component.parent;
    window.vm = component.proxy;
    window.vm.showReceiveModal = true;
  });
  await page.locator('.deposit-chip').waitFor();
  await page.locator('.deposit-chip').click();
  await page.locator('.claim-sheet .confirm-btn').waitFor();
  await shot('09-receive-fee-exception');
  for (const [locale, dark, scale] of [['en-US', true, 1], ['de', false, 2]]) {
    await page.setViewportSize({ width: scale === 2 ? 320 : 390, height: 844 });
    await page.evaluate(({ locale, dark, scale }) => {
      window.vm.$i18n.locale = locale;
      window.__audit.setDark(dark);
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, { locale, dark, scale });
    await shot(`10-fee-exception-${locale}-${dark ? 'dark' : 'light'}-${scale}x`);
    assert.equal(await page.locator('.claim-sheet .confirm-btn').count(), 1);
  }
  console.log('PASS: manual deposit status remains visible in light/dark and German at 200% text');

  assert.deepEqual(errors, [], 'no browser errors');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
