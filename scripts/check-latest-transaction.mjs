/**
 * Actual Home preview/Receive-sheet browser regression for #437. Start
 * `npx quasar dev --port 9415`, then run this file. Only the remote LNbits
 * history is controlled; the real page, preview controller, activity store,
 * metadata and card run together. External requests are blocked.
 * Screenshots and light/dark motion recordings land in output/latest-transaction-preview.
 */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.PREVIEW_BASE_URL || 'http://localhost:9415';
const output = process.env.PREVIEW_OUTPUT || new URL('../output/latest-transaction-preview', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
let activePage;

const pass = name => { results.push(name); console.log(`  ✓ ${name}`); };
const shot = async (page, name) => page.screenshot({ path: `${output}/${name}.png` });
const phase = (page, value) => page.waitForFunction(value => window.__home().latestTransactionState.phase === value, value);
const transaction = (page, id) => page.waitForFunction(id => window.__home().lastTransaction?.id === id, id);
const card = page => page.locator('.last-tx-card');
const cardHeight = async page => Math.round((await card(page).boundingBox()).height);

async function open({ theme = 'light', reducedMotion = 'no-preference', video = null } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion,
    ...(video ? { recordVideo: { dir: `${output}/raw-video`, size: { width: 390, height: 844 } } } : {}),
  });
  const page = await context.newPage();
  activePage = page;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === base ? route.continue() : route.abort();
  });
  await page.routeWebSocket('**', socket => {
    if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close();
  });
  await page.addInitScript(theme => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buho-theme-mode', theme);
  }, theme);
  await page.goto(`${base}/#/wallet`, { timeout: 180000 });
  await page.waitForFunction(() => window.__audit?.app, null, { timeout: 180000 });
  await page.waitForFunction(() => {
    let component = document.querySelector('.q-page')?.__vueParentComponent;
    while (component && !('latestTransactionState' in (component.proxy || {}))) component = component.parent;
    return !!component;
  }, null, { timeout: 180000 });
  await page.evaluate(async () => {
    const { walletWatch } = await import('/src/services/walletWatch.js');
    walletWatch()?.stop();
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    window.__home = () => {
      let component = document.querySelector('.q-page')?.__vueParentComponent;
      while (component && !('latestTransactionState' in (component.proxy || {}))) component = component.parent;
      if (!component) throw new Error('Home component is not mounted');
      return component.proxy;
    };
    window.__store = store;
    window.__rows = { A: [], B: [] };
    window.__modes = { A: 'rows', B: 'rows' };
    window.__reads = { A: 0, B: 0 };
    window.__pending = [];
    window.__lookupRows = {};
    window.__row = (id, amount = 2100, description = 'Birthday', timestamp = Date.now(), type = 'receive') => ({
      id, paymentHash: id, type, amount, description, timestamp: timestamp / 1000,
      settled_at: timestamp / 1000, status: 'completed', fee: 0,
    });
    const old = window.__row('coffee', 450, 'Coffee', Date.now() - 60000, 'send');
    window.__rows.A = [old];
    const provider = walletId => ({
      listPayments: async () => {
        window.__reads[walletId]++;
        if (window.__modes[walletId] === 'fail') throw new Error('Controlled history outage');
        if (window.__modes[walletId] === 'hold') return new Promise(resolve => window.__pending.push({ walletId, resolve }));
        return structuredClone(window.__rows[walletId]);
      },
      getTransactions: async () => { throw new Error('Home must use the strict LNbits listPayments API'); },
      getPayment: async hash => structuredClone(window.__lookupRows[hash] || null),
      getBalance: async () => ({ balance: 50000, pending: 0 }),
      getInfo: async () => ({ alias: 'Controlled LNbits' }),
    });
    const wallets = ['A', 'B'].map(id => ({ id, name: `Wallet ${id}`, type: 'lnbits', balance: 50000, metadata: {}, connectionData: {} }));
    store.wallets = wallets;
    store.providers = { A: provider('A'), B: provider('B') };
    store.activeWalletId = 'A';
    store.balanceStates = Object.fromEntries(wallets.map(wallet => [wallet.id, { value: wallet.balance, source: 'provider', verifiedAt: Date.now(), updatedAt: Date.now(), refreshing: false, error: null }]));
    store.connectionStates = { A: { connected: true }, B: { connected: true } };
    store.balanceHidden = false;
    const home = window.__home();
    home.showLoadingScreen = false;
    // Prove immediate activity works independently of the fallback timer.
    clearInterval(home.refreshInterval);
    home.refreshInterval = null;
    await home.loadLastTransaction();
    window.__receive = (id, amountSats = 2100, extra = {}) => store.recordConfirmedReceive({
      walletId: 'A', paymentId: id, paymentHash: id, amountSats,
      settledAt: Date.now(), ...extra,
    });
    window.__release = rows => {
      window.__modes.A = 'rows';
      window.__rows.A = rows;
      const pending = window.__pending.splice(0);
      for (const read of pending) read.resolve(structuredClone(window.__rows[read.walletId]));
    };
  });
  await transaction(page, 'coffee');
  await card(page).waitFor();
  return { page, async close() {
    const recording = page.video();
    await context.close();
    if (video && recording) await recording.saveAs(`${output}/${video}.webm`);
  } };
}

try {
  for (const theme of ['light', 'dark']) {
    const session = await open({ theme, video: `motion-${theme}` });
    const { page } = session;
    const height = await cardHeight(page);
    const before = await page.evaluate(() => window.__reads.A);
    await shot(page, `${theme}-01-before`);
    await page.evaluate(() => { window.__modes.A = 'hold'; window.__receive('incoming-1', 2100); });
    await phase(page, 'receipt');
    assert.ok(await page.evaluate(before => window.__reads.A > before, before), 'history starts without the timer');
    await expect(card(page)).toContainText('Bitcoin received');
    await expect(card(page)).toContainText('2,100');
    await expect(card(page)).not.toContainText(/loading/i);
    assert.equal(await cardHeight(page), height);
    assert.equal(height, 64);
    await expect(page.locator('.last-tx-detail-orbit')).toBeVisible();
    await shot(page, `${theme}-02-receipt`);
    const arrival = await page.evaluate(() => window.__home().latestTransactionState.arrivalKey);
    await page.evaluate(() => window.__receive('incoming-1', 2100));
    assert.equal(await page.evaluate(() => window.__home().latestTransactionState.arrivalKey), arrival, 'duplicate does not replay arrival');
    await page.waitForTimeout(1300); // Let the actual motion be visible in the recording.
    await page.evaluate(() => window.__release([window.__row('incoming-1', 2100, 'Birthday')]));
    await phase(page, 'ready');
    await transaction(page, 'incoming-1');
    await expect(card(page)).toContainText('Birthday');
    await expect(page.locator('.last-tx-detail-orbit')).toHaveCount(0);
    assert.equal(await cardHeight(page), height);
    await page.waitForTimeout(350);
    await shot(page, `${theme}-03-completed`);
    pass(`${theme}: immediate acknowledgement, stable 64px card, delayed details, duplicate suppression and completed motion`);
    await session.close();
  }

  // Deadline, failure and recovery use the production 15-second budget.
  {
    const session = await open();
    const { page } = session;
    await page.evaluate(() => { window.__modes.A = 'fail'; window.__receive('retry-payment', 777); });
    await phase(page, 'receipt');
    await page.waitForFunction(() => window.__home().latestTransactionState.phase === 'unavailable', null, { timeout: 18000 });
    await expect(card(page)).toContainText('Bitcoin received');
    await expect(card(page)).toContainText('777');
    await expect(page.locator('.last-tx-detail-orbit')).toHaveCount(0);
    await shot(page, 'failure-static-receipt');
    await page.evaluate(() => { window.__modes.A = 'rows'; window.__rows.A = [window.__row('retry-payment', 777, 'Recovered receipt')]; });
    await page.locator('.last-tx-retry').click();
    await transaction(page, 'retry-payment');
    await phase(page, 'ready');
    await shot(page, 'retry-completed');
    pass('failed history stops motion at the production deadline; Retry recovers the confirmed payment');

    // Hidden amounts remove their numeric DOM, including during motion.
    await page.evaluate(() => { window.__store.balanceHidden = true; window.__modes.A = 'hold'; window.__receive('private-payment', 987654); });
    await phase(page, 'receipt');
    assert.equal(await page.locator('.last-tx-amount-value').count(), 0);
    assert.doesNotMatch(await page.locator('.last-tx-section').textContent(), /987.?654/);
    await expect(page.locator('.last-tx-amount')).toContainText('••••');
    await shot(page, 'hidden-receipt');
    await page.evaluate(() => window.__release([window.__row('private-payment', 987654, 'Private receipt')]));
    await transaction(page, 'private-payment');
    assert.equal(await page.locator('.last-tx-amount-value').count(), 0);
    pass('hidden balances contain no amount nodes during receipt motion or completed content');
    await session.close();
  }

  // The actual Receive sheet completes its own invoice without lastReceipt.
  {
    const session = await open();
    const { page } = session;
    await page.evaluate(() => {
      const modal = window.__home().$refs.receiveModal;
      const hash = 'a'.repeat(64);
      window.__modes.A = 'hold';
      modal.isPaymentConfirmed = false;
      modal.generatedInvoice = { walletId: 'A', payment_hash: hash, amount: 3210 };
      modal.handlePaymentStatus('confirmed', { amount: 3210 });
    });
    await phase(page, 'receipt');
    assert.equal(await page.evaluate(() => window.__store.lastReceipt), null, 'sheet-only input did not depend on the notification channel');
    await expect(card(page)).toContainText('3,210');
    await page.evaluate(() => { window.__home().$refs.receiveModal.showPaymentConfirmation = false; });
    await page.waitForTimeout(300);
    await shot(page, 'receive-sheet-updates-home');
    await page.evaluate(() => window.__release([window.__row('a'.repeat(64), 3210, 'Sheet receipt')]));
    await transaction(page, 'a'.repeat(64));
    pass('ReceiveModal.handlePaymentStatus updates Home independently of lastReceipt and resolves its exact invoice');
    await session.close();
  }

  // Exercise receipt delivery itself, including its existing confirmation,
  // with an invoice created long before its verified settlement.
  {
    const session = await open();
    const { page } = session;
    await page.evaluate(async () => {
      const now = Date.now();
      window.__modes.A = 'hold';
      window.__lookupRows['old-invoice'] = {
        ...window.__row('old-invoice', 2100, 'Paid old invoice', now - 3600000),
        settled_at: now / 1000, amount: 2105, fee: 5,
      };
      const { deliverReceipt } = await import('/src/services/paymentReceiptsApp.js');
      await deliverReceipt({ walletId: 'A', id: 'old-invoice', paymentHash: 'old-invoice', amountSats: 2100,
        timestamp: (now - 3600000) / 1000, settlementKnown: false });
    });
    await phase(page, 'receipt');
    await expect(page.locator('.payment-confirmation')).toHaveCount(1);
    await expect(page.locator('.payment-confirmation .amount-value')).toContainText('2,100');
    await page.locator('.confirmation-backdrop').click({ position: { x: 20, y: 20 } });
    await expect(page.locator('.payment-confirmation')).toHaveCount(0);
    await expect(card(page)).toContainText('2,100');
    await page.evaluate(() => window.__release([
      window.__row('coffee', 450, 'Coffee', Date.now() - 60000, 'send'),
      { ...window.__lookupRows['old-invoice'], settled_at: undefined, receiptTimeIsCreation: true },
    ]));
    await transaction(page, 'old-invoice');
    await expect(card(page)).toContainText('Paid old invoice');
    await expect(card(page)).toContainText('2,100');
    pass('real receipt delivery preserves confirmation and exact lookup orders a paid old invoice with its net amount');
    await session.close();
  }

  {
    const session = await open();
    const { page } = session;
    await page.evaluate(() => { window.__modes.A = 'hold'; window.__receive('remount-payment', 501); });
    await phase(page, 'receipt');
    await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/settings'));
    await page.waitForURL('**/#/settings');
    await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/wallet'));
    await page.waitForURL('**/#/wallet');
    await phase(page, 'receipt');
    assert.equal(await page.evaluate(() => window.__home().latestTransactionState.arrivalKey), 0, 'restored receipt does not replay arrival');
    await expect(card(page)).toContainText('501');
    await page.evaluate(() => window.__release([window.__row('remount-payment', 501, 'Restored receipt')]));
    await transaction(page, 'remount-payment');
    pass('navigating away and back restores unresolved receipt details without replaying success entrance');
    await session.close();
  }

  {
    const session = await open({ reducedMotion: 'reduce' });
    const { page } = session;
    await page.evaluate(() => { window.__modes.A = 'hold'; window.__receive('reduced-payment', 100); });
    await phase(page, 'receipt');
    const animations = await page.locator('.last-tx-section').evaluate(root => [...root.querySelectorAll('*')]
      .map(element => getComputedStyle(element).animationName).filter(name => name !== 'none'));
    assert.deepEqual(animations, []);
    await shot(page, 'reduced-motion-receipt');
    await page.evaluate(() => window.__release([window.__row('reduced-payment', 100)]));
    await transaction(page, 'reduced-payment');
    await page.locator('.history-link').click();
    await page.waitForURL('**/#/transactions');
    pass('reduced motion disables activity/entrance animations and History navigation remains usable');
    await session.close();
  }

  {
    const session = await open();
    const { page } = session;
    // A read begun before switching away cannot replace the new A result.
    await page.evaluate(() => { window.__modes.A = 'hold'; window.__home().loadLastTransaction(); });
    await page.waitForFunction(() => window.__pending.length > 0);
    await page.evaluate(async () => {
      window.__store.activeWalletId = 'B';
      await window.__home().$nextTick();
      window.__rows.A = [window.__row('fresh-A', 400, 'Fresh A')];
      window.__modes.A = 'rows';
      window.__store.activeWalletId = 'A';
    });
    await transaction(page, 'fresh-A');
    await page.evaluate(() => { for (const read of window.__pending.splice(0)) read.resolve([window.__row('stale-A', 1, 'Stale A', Date.now() - 60000)]); });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__home().lastTransaction.id), 'fresh-A');
    pass('A → B → A rejects the original A read');

    await page.evaluate(() => {
      const now = Date.now();
      window.__rows.A = [window.__row('burst-new', 300, 'Newest receipt', now), window.__row('burst-old', 200, 'Older receipt', now - 1000)];
      window.__receive('burst-old', 200, { settledAt: now - 1000 });
      window.__receive('burst-new', 300, { settledAt: now });
      window.__receive('burst-new', 300, { settledAt: now });
    });
    await transaction(page, 'burst-new');
    await expect(card(page)).toContainText('300');
    await expect(card(page)).not.toContainText('500');
    pass('burst/duplicate receives resolve to one actual newest payment, without summing the preview');
    await session.close();
  }

  {
    const session = await open();
    const { page } = session;
    await page.evaluate(async () => { window.__rows.A = []; await window.__home().loadLastTransaction(); });
    await phase(page, 'empty');
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('.history-link')).toBeVisible();
    pass('a successful empty history resolves to History without a card or perpetual skeleton');
    await session.close();
  }

  assert.deepEqual(errors, [], 'no uncaught browser errors');
  await writeFile(`${output}/results.json`, JSON.stringify({ checks: results, pageErrors: errors }, null, 2));
  console.log(`\n${results.length} browser checks passed. Evidence: ${output}`);
} catch (error) {
  if (activePage && !activePage.isClosed()) console.error('Preview diagnostic:', await activePage.evaluate(() => {
    const home = window.__home?.();
    return { state: home?.latestTransactionState, reads: window.__reads, pending: window.__pending?.length,
      current: home?.lastPreviewContext?.isCurrent(), owner: !!home?.lastPreviewContext?.owner, wallet: window.__store?.activeWalletId,
      controller: !!home?._transactionPreview };
  }).catch(() => null));
  if (activePage && !activePage.isClosed()) await shot(activePage, 'failure').catch(() => {});
  console.error('Browser page errors:', errors);
  throw error;
} finally {
  await browser.close();
}
