/** Browser check: how many relay connections an NWC wallet uses (#395).
 *
 * A stand-in NWC wallet (scripts/fixtures/nwcStandIn.mjs) answers on its own
 * relay and counts the page's connections to it. The check adds the wallet
 * the real way, then walks every place that talks to it: Home, history and
 * its next page, a transaction, Receive (invoice and payment check), a send,
 * a batch send, the relay dropping the connection, and removing the wallet.
 * One NWC wallet should hold one connection while the app runs, reconnect
 * once after a drop, and hold none once removed.
 *
 * Start `pnpm dev --port 9034` first (or set CONNECTIONS_BASE_URL). Every
 * other external request is blocked. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createNwcStandIn } from './fixtures/nwcStandIn.mjs';

const base = process.env.CONNECTIONS_BASE_URL || 'http://localhost:9034';
const PAY_HOST = 'pay.standin.test';
const standIn = createNwcStandIn();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

// A Lightning-address server for the batch: pay requests and invoices.
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === PAY_HOST) {
    const body = url.pathname.startsWith('/.well-known/lnurlp/')
      ? { tag: 'payRequest', callback: `https://${PAY_HOST}/cb`, minSendable: 1000, maxSendable: 1e9, metadata: '[["text/plain","Stand-in"]]' }
      : { pr: standIn.payableInvoice(Math.round(Number(url.searchParams.get('amount') || 1000) / 1000)), routes: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  }
  const passthrough = ['fonts.googleapis.com', 'fonts.gstatic.com'];
  return url.origin === base || passthrough.includes(url.hostname) ? route.continue() : route.abort();
});
// Every other socket is refused; the dev server's own passes; the stand-in relay is answered.
await page.routeWebSocket('**', (socket) => {
  if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
  else socket.close();
});
await standIn.attach(page);
await page.addInitScript(() => {
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
});

const store = (fn, arg) => page.evaluate(([source, a]) => {
  const s = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
  return new Function('store', 'arg', `return (${source})(store, arg)`)(s, a);
}, [fn.toString(), arg]);
const go = (path) => page.evaluate((p) => window.__audit.app.config.globalProperties.$router.push(p), path);
/** The first mounted component instance that has `key` (a method or state). */
const onComponent = (key, fn, arg) => page.evaluate(([k, source, a]) => {
  const seen = new Set();
  const walk = (vnode) => {
    const inst = vnode?.component;
    if (inst && !seen.has(inst)) {
      seen.add(inst);
      const target = (inst.setupState && k in inst.setupState) ? inst.setupState : (inst.proxy && k in inst.proxy ? inst.proxy : null);
      if (target) return target;
      const found = walk(inst.subTree);
      if (found) return found;
    }
    for (const child of [].concat(vnode?.children || [], vnode?.dynamicChildren || [])) {
      if (child && typeof child === 'object') {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  const target = walk(window.__audit.app._instance.subTree);
  if (!target) throw new Error(`no component with ${k}`);
  return new Function('vm', 'arg', `return (${source})(vm, arg)`)(target, a);
}, [key, fn.toString(), arg]);

const results = [];
let seenOpened = 0;
function phase(name) {
  const opened = standIn.sockets.opened - seenOpened;
  seenOpened = standIn.sockets.opened;
  results.push({ phase: name, opened, open: standIn.sockets.open });
  console.log(`${name.padEnd(34)} new connections: ${opened}   open now: ${standIn.sockets.open}`);
}
const settle = (ms = 1500) => page.waitForTimeout(ms);

try {
  await page.goto(`${base}/#/`);
  await page.waitForFunction(() => !!window.__audit?.app?._instance, null, { timeout: 120000 });

  // Add the wallet as the connect sheet does: test it, then keep it.
  const walletId = await store(async (s, nwcUrl) => (await s.addWallet({ name: 'Stand-in Hub', nwcUrl })).id, standIn.connection);
  await settle();
  phase('add (test + keep)');

  await go('/wallet');
  await page.getByText('Stand-in Hub').first().waitFor({ timeout: 60000 });
  await settle(2500);
  phase('Home');

  await go('/transactions');
  await page.getByText(/Stand-in 1\b/).first().waitFor({ timeout: 60000 });
  await settle();
  await onComponent('loadNWCTransactionsBatch', (vm) => vm.loadNWCTransactionsBatch());
  await settle();
  phase('history, two pages');

  await go(`/transaction/${'0'.repeat(63)}1`);
  await settle(3000);
  phase('a transaction');

  await go('/wallet');
  await page.getByText('Stand-in Hub').first().waitFor();
  await onComponent('showReceiveModal', (vm) => { vm.showReceiveModal = true; });
  await settle(800);
  await onComponent('createInvoice', async (vm) => { vm.keypadValue = '1000'; vm.isFiatMode = false; await vm.createInvoice(); });
  await settle(4000);
  phase('Receive: invoice + payment check');
  await onComponent('showReceiveModal', (vm) => { vm.showReceiveModal = false; });
  await settle(800);

  await onComponent('sendNWCPayment', async (vm, arg) => {
    vm.pendingPayment = { type: 'lightning_invoice', invoice: arg.invoice, amount: 1000 };
    window.__sendResult = await vm.sendNWCPayment(1000, '', arg.walletId).then((r) => ({ ok: true, preimage: r?.preimage }), (e) => ({ ok: false, error: e.message }));
  }, { walletId, invoice: standIn.payableInvoice(1) });
  await settle();
  phase('a send');

  await onComponent('showBatchSend', (vm) => { vm.showBatchSend = true; });
  await settle(800);
  await onComponent('startBatch', async (vm) => {
    vm.selectedContacts = [
      { id: 'c1', name: 'Ada', address: `ada@${'pay.standin.test'}`, addressType: 'lightning' },
      { id: 'c2', name: 'Bo', address: `bo@${'pay.standin.test'}`, addressType: 'lightning' },
      { id: 'c3', name: 'Cy', address: `cy@${'pay.standin.test'}`, addressType: 'lightning' },
    ];
    vm.customAmountsMode = true;
    vm.customAmounts = { c1: 100, c2: 100, c3: 100 };
    await vm.startBatch();
  });
  await settle(3000);
  const batchRows = await onComponent('paymentResults', (vm) => vm.paymentResults.map((r) => r.status));
  const sendResult = await page.evaluate(() => window.__sendResult);
  console.log('send:', JSON.stringify(sendResult), '  batch rows:', JSON.stringify(batchRows));
  phase('a batch of 3');

  standIn.dropAll();
  await settle(500);
  await store((s, id) => s.refreshNwcDetails(id), walletId);
  await settle();
  phase('relay dropped, then asked again');

  await store((s, id) => s.removeWallet(id), walletId);
  await settle(1500);
  phase('wallet removed');

  console.log('\nrequests the wallet answered:', standIn.requests.join(', '));
  if (errors.length) console.log('page errors:', errors);

  if (process.env.CONNECTIONS_EXPECT === 'one') {
    const by = Object.fromEntries(results.map((r) => [r.phase, r]));
    // The test's own connection is closed; the kept one opens on its first request (Home).
    assert.equal(by['add (test + keep)'].open, 0, 'the connection test closes its own connection');
    assert.equal(by.Home.opened, 1, 'the wallet\'s one connection');
    for (const name of ['history, two pages', 'a transaction', 'Receive: invoice + payment check', 'a send', 'a batch of 3']) {
      assert.equal(by[name].opened, 0, `${name}: reuses the wallet's connection`);
      assert.equal(by[name].open, 1, `${name}: one connection open`);
    }
    assert.equal(by['relay dropped, then asked again'].opened, 1, 'reconnects once after a drop');
    assert.equal(by['relay dropped, then asked again'].open, 1);
    assert.equal(by['wallet removed'].open, 0, 'no connection left after removing the wallet');
    // And every flow still reached the wallet.
    const asked = (method) => standIn.requests.filter((m) => m === method).length;
    assert.ok(asked('list_transactions') >= 3, 'history pages and the transaction were read');
    assert.equal(asked('make_invoice'), 1, 'Receive created its invoice');
    assert.ok(asked('lookup_invoice') >= 1, 'Receive checked for the payment');
    assert.equal(asked('pay_invoice'), 4, 'the send and the three batch payments were sent');
    assert.equal(sendResult.ok, true, 'the send succeeded');
    assert.deepEqual(batchRows, ['success', 'success', 'success'], 'every batch payment succeeded');
    console.log('\nOne connection per NWC wallet: all checks passed.');
  }
} finally {
  await browser.close();
}
