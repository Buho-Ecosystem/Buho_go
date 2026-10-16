import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { parse } from '@vue/compiler-sfc';
import * as nwcPayment from '../../services/nwcPayment.js';

// Load the real handlers and store accessor without starting wallet SDKs.
function load(file, dependencies = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const script = file.endsWith('.vue') ? parse(source).descriptor.script.content : source;
  const { code } = transformSync(script, { format: 'cjs' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (name) => dependencies[name] || {}, module, module.exports,
  );
  return module.exports;
}

const walletOptions = load('../../stores/wallet.js', {
  pinia: { defineStore: (_id, options) => options },
  '../providers/WalletFactory': {
    WALLET_TYPES: { SPARK: 'spark', LNBITS: 'lnbits', ARKADE: 'arkade', NWC: 'nwc' },
  },
  '../utils/claimedDeposits.js': { createClaimedDepositRegistry: () => ({}) },
}).useWalletStore;
// NWC pays through the real proof-checking helper (services/nwcPayment).
const shop = load('../shop/PurchaseSheet.vue', { '../../services/nwcPayment.js': nwcPayment }).default;
const username = load('../Nip05MarketplaceSheet.vue', { '../services/nwcPayment.js': nwcPayment }).default;

function harness(flow, type = 'nwc', { available = true, failPayment = false, settled = false } = {}) {
  const events = [];
  const wallet = { id: 'selected', name: 'Selected wallet', type };
  const invoice = 'lnbc-test-invoice';
  const pay = async (request) => {
    events.push(['pay', request]);
    if (failPayment) throw new Error('Payment rejected');
  };
  // An NWC wallet answers with a preimage; the test invoice has no hash to
  // check it against, so the answer itself is the outcome (services/nwcPayment).
  const provider = type === 'nwc' ? { sendPayment: async (request) => { await pay(request); return { preimage: 'ab'.repeat(32) }; } } : { payInvoice: pay };
  const walletStore = {
    wallets: [wallet],
    providers: type !== 'nwc' && available ? { [wallet.id]: provider } : {},
    connectionStates: {
      [wallet.id]: { connected: available, nwcInstance: type === 'nwc' && available ? provider : null },
    },
    getProvider: walletOptions.actions.getProvider,
    nwcLimitFor: () => null,
  };
  const vm = {
    walletStore,
    $t: (text) => text,
    canPay: true,
    selectedWalletId: wallet.id,
    selectedWallet: wallet,
    busy: false,
    actionInflight: false,
    paid: false,
    orderId: 'order',
    order: { paymentAttempted: false },
    invoice: { paymentRequest: invoice },
    priceSats: 1000,
    ordersStore: {
      markPaymentAttempted: () => events.push(['attempt']),
      markPaid: (_id, payment) => events.push(['paid', payment.walletId]),
    },
    probeSettled: async () => { events.push(['probe']); return settled; },
    runRedeem: () => events.push(['redeem']),
    prepareInvoice: async () => {
      events.push(['prepare']);
      return { invoice, pubkey: 'buyer', paymentHash: 'hash', handle: 'alice' };
    },
    identity: {
      nostrPubkeyHex: 'buyer',
      updatePendingNip05Claim: (update, scope) => {
        assert.ok(update.paidAt);
        assert.deepEqual(scope, { pubkey: 'buyer', paymentHash: 'hash' });
        events.push(['paid']);
      },
    },
    labelPayment: (id) => events.push(['label', id]),
    observePurchase: () => events.push(['observe']),
  };
  return {
    vm, events, invoice,
    run: () => (flow === 'shop' ? shop.methods.onPay : username.methods.getWithWallet).call(vm),
  };
}

for (const flow of ['shop', 'username']) {
  for (const type of ['nwc', 'spark', 'lnbits']) {
    test(`${flow}: ${type} pays once and records payment before fulfilment`, async () => {
      const h = harness(flow, type);
      await h.run();
      const request = type === 'nwc' ? h.invoice : { invoice: h.invoice };
      assert.deepEqual(h.events, flow === 'shop'
        ? [['attempt'], ['pay', request], ['paid', 'selected'], ['redeem']]
        : [['prepare'], ['pay', request], ['paid'], ['label', 'selected'], ['observe']]);
      assert.equal(h.vm.actionInflight, false);
      assert.equal(h.vm.busy, false);
      if (flow === 'shop') assert.equal(h.vm.paid, true);
      else assert.equal(h.vm.resultHandle, 'alice');
    });
  }

  test(`${flow}: unavailable NWC stops before preparing or paying`, async () => {
    const h = harness(flow, 'nwc', { available: false });
    await h.run();
    assert.deepEqual(h.events, []);
    assert.match(flow === 'shop' ? h.vm.payError : h.vm.notice, /That wallet isn't ready/);
  });

  test(`${flow}: rejected NWC payment is not marked paid or fulfilled`, async (ctx) => {
    ctx.mock.method(console, 'warn', () => {});
    const h = harness(flow, 'nwc', { failPayment: true });
    await h.run();
    assert.deepEqual(h.events, flow === 'shop'
      ? [['attempt'], ['pay', h.invoice], ['probe']]
      : [['prepare'], ['pay', h.invoice]]);
    assert.ok(flow === 'shop' ? h.vm.payError : h.vm.notice);
    assert.equal(h.vm.paid, false);
    assert.equal(h.vm.busy, false);
    assert.equal(h.vm.actionInflight, false);
  });
}

test('shop: an already settled previous attempt does not send another NWC payment', async () => {
  const h = harness('shop', 'nwc', { settled: true });
  h.vm.order.paymentAttempted = true;
  await h.run();
  assert.deepEqual(h.events, [['probe']]);
});
