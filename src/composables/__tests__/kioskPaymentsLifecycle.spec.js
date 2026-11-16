import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reactive, nextTick } from 'vue';
import { profileInvoiceFixture } from '../../../scripts/fixtures/profileInvoice.mjs';
import { createKioskPaymentRuntime, useKioskPayments, validateKioskInvoice } from '../useKioskPayments.js';

const hash = 'a'.repeat(64), otherHash = 'b'.repeat(64);
const invoice = { paymentRequest: 'lnbc10u1qqqq', paymentHash: hash, preimage: 'NEVER-PERSIST', accessToken: 'NEVER-PERSIST', invoice_id: 'receive-id' };
const snapshot = () => ({ walletId: 'wallet', walletName: 'Register', currency: 'USD', baseSats: 1000, tipSats: 0, roundUpSats: 0, totalSats: 1000, items: [{ id: 'amount', name: 'Amount', unit: 'sats', unitSats: 1000, qty: 1 }] });
const decode = () => ({ paymentHash: hash, amountSats: 1000, expiresAt: 2_000_000_000 });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function flush() { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick(); } }
function fakeMerchant(events) {
  return reactive({ orders: [], activeOrderId: null, failAttach: false, failSettle: false,
    async initialize() {}, getOrder(id) { return this.orders.find(o => o.id === id); },
    get pendingAttempts() { return this.orders.flatMap(order => order.attempts.filter(a => a.status !== 'paid' && a.status !== 'failed').map(a => ({ ...a, orderId: order.id, attemptId: a.id }))); },
    async createOrder(value) { const order = { ...value, id: `order-${this.orders.length}`, status: 'preparing', attempts: [], activeAttemptId: null }; events.push('persist-order'); this.orders.push(order); this.activeOrderId = order.id; return this.getOrder(order.id); },
    async beginAttempt(id) { const o = this.getOrder(id); assert.ok(!o.attempts.some(a => ['creating', 'uncertain', 'waiting'].includes(a.status))); const a = { id: `${id}-attempt-${o.attempts.length}`, walletId: o.walletId, amountSats: o.totalSats, status: 'creating' }; events.push('persist-intent'); o.attempts.push(a); o.activeAttemptId = a.id; return a; },
    async attachInvoice(id, aid, value) { if (this.failAttach) throw Object.assign(new Error('quota'), { code: 'KIOSK_STORAGE_FAILED' }); const o = this.getOrder(id); Object.assign(o.attempts.find(a => a.id === aid), value, { status: 'waiting' }); o.status = 'waiting'; events.push('persist-invoice'); },
    async markCreationUncertain(id, aid, reason) { const o = this.getOrder(id), a = o.attempts.find(a => a.id === aid); if (a.status !== 'creating' && a.status !== 'uncertain') return; a.status = 'uncertain'; a.reason = reason; o.status = 'uncertain'; },
    async markAttemptExpired(id, aid) { const o = this.getOrder(id); o.attempts.find(a => a.id === aid).status = 'expired'; o.status = 'expired'; },
    async settleAttempt(id, aid, proof) { if (this.failSettle) throw new Error('storage'); const o = this.getOrder(id), a = o.attempts.find(a => a.id === aid); assert.equal(proof.walletId, a.walletId); assert.equal(proof.paymentHash, a.paymentHash); if (proof.settledSats != null) assert.equal(proof.settledSats, o.totalSats); const newlyPaid = o.status !== 'paid', duplicate = a.status === 'paid'; a.status = 'paid'; o.status = 'paid'; events.push('persist-paid'); return { order: o, attempt: a, newlyPaid, duplicate, duplicatePayment: !newlyPaid && !duplicate }; },
    async setActiveOrder(id) { this.activeOrderId = id; }, async startNextSale() { this.activeOrderId = null; events.push('clear-draft'); },
  });
}
function harness(ctx, options = {}) {
  const events = [], calls = [], paid = [];
  const merchant = options.merchant || fakeMerchant(events);
  const walletStore = reactive({ wallets: [{ id: 'wallet', type: 'lnbits' }], kioskEnabled: true, kioskOwnerAccess: false, kioskWalletId: 'wallet',
    async ensureWalletConnectedForTransfer() { return {}; },
    async createInvoiceDetailsOnWallet(...args) { calls.push(args); events.push('provider-create'); return options.create ? options.create(...args) : invoice; },
    async lookupInvoiceOnWallet(...args) { return options.lookup ? options.lookup(...args) : { paid: false }; },
  });
  const runtime = createKioskPaymentRuntime({ merchant, walletStore, decodeInvoice: decode, document: null,
    onPaid: (...args) => { paid.push(args); events.push('callback-paid'); }, ...options });
  ctx.after(() => runtime.dispose());
  return { merchant, walletStore, runtime, events, calls, paid };
}

async function durableHarness(ctx, options = {}) {
  const { createPinia, setActivePinia } = await import('pinia');
  const { useKioskMerchantStore } = await import('../../stores/kioskMerchant.js');
  const { buildSaleSnapshot } = await import('../../utils/kioskMerchant.js');
  let saved = null;
  const repository = {
    failCommit: false,
    async load() { return saved && structuredClone(saved); },
    async commit(next, previous) {
      if (this.failCommit) throw Object.assign(new Error('quota'), { code: 'KIOSK_STORAGE_FAILED' });
      assert.equal(saved?.revision || 0, previous?.revision || 0);
      saved = JSON.parse(JSON.stringify(next));
    },
  };
  setActivePinia(createPinia());
  const merchant = useKioskMerchantStore();
  await merchant.initialize({ storage: repository, legacyStorage: null });
  const h = harness(ctx, { ...options, merchant });
  return { ...h, snapshot: buildSaleSnapshot(snapshot()), saved: () => saved, repository };
}

test('intent is durable before provider creation and only the exact public request is displayed', async ctx => {
  const h = harness(ctx);
  const a = h.runtime.createCharge(snapshot()), b = h.runtime.createCharge(snapshot());
  assert.equal(a, b, 'double charge press shares the same task');
  await a;
  assert.deepEqual(h.events, ['persist-order', 'persist-intent', 'provider-create', 'persist-invoice']);
  assert.equal(h.calls.length, 1);
  assert.equal(h.runtime.status.value, 'waiting');
  assert.equal(h.runtime.activeInvoice.value.paymentHash, hash);
  assert.ok(!JSON.stringify(h.merchant.orders).includes('NEVER-PERSIST'));
  await h.runtime.createCharge(snapshot());
  assert.equal(h.calls.length, 1, 'unresolved request cannot be blindly recreated');
});

test('an unknown creation error keeps an unresolved durable attempt and does not retry', async ctx => {
  const h = harness(ctx, { create: async () => { throw new Error('token=PRIVATE'); } });
  await h.runtime.createCharge(snapshot());
  assert.equal(h.runtime.status.value, 'uncertain');
  assert.equal(h.runtime.activeInvoice.value, null);
  assert.ok(!JSON.stringify(h.merchant.orders).includes('PRIVATE'));
  await h.runtime.createCharge(snapshot());
  assert.equal(h.calls.length, 1);
});

test('a creation timeout retains a late returned invoice without paying or attaching it to another customer', async ctx => {
  const pending = deferred();
  const h = harness(ctx, { creationTimeoutMs: 5, create: () => pending.promise });
  await h.runtime.createCharge(snapshot());
  assert.equal(h.runtime.status.value, 'uncertain');
  await h.runtime.nextCustomer();
  pending.resolve(invoice);
  await flush();
  assert.equal(h.merchant.orders[0].attempts[0].paymentHash, hash);
  assert.equal(h.runtime.activeInvoice.value, null);
  assert.equal(h.paid.length, 0);
  await h.runtime.resume(h.merchant.orders[0].id);
  assert.equal(h.runtime.activeInvoice.value.paymentHash, hash);
});

test('source context change retains the current order and an already-created late request', async ctx => {
  const pending = deferred(), called = deferred();
  const h = harness(ctx, { create: () => { called.resolve(); return pending.promise; } });
  const task = h.runtime.createCharge(snapshot());
  await called.promise;
  h.walletStore.kioskOwnerAccess = true;
  await flush();
  pending.resolve(invoice);
  await task;
  assert.equal(h.runtime.activeOrder.value.id, h.merchant.orders[0].id);
  assert.equal(h.merchant.orders[0].attempts[0].status, 'waiting');
});

test('invoice amount, amountless requests, fractional sats and conflicting hashes fail closed', () => {
  assert.throws(() => validateKioskInvoice({ ...invoice, paymentRequest: 'lnbc11u1qqq' }, { walletId: 'wallet', amountSats: 1000 }, decode));
  assert.throws(() => validateKioskInvoice({ ...invoice, paymentRequest: 'lnbc1qqq' }, { walletId: 'wallet', amountSats: 1000 }, decode));
  assert.throws(() => validateKioskInvoice({ ...invoice, paymentRequest: 'lnbc10001n1qqq' }, { walletId: 'wallet', amountSats: 1000 }, decode));
  assert.throws(() => validateKioskInvoice({ ...invoice, paymentHash: otherHash }, { walletId: 'wallet', amountSats: 1000 }, decode));
});

test('failed invoice persistence hides the request, and checking retries the write without another invoice', async ctx => {
  const h = harness(ctx);
  h.merchant.failAttach = true;
  await h.runtime.createCharge(snapshot());
  assert.equal(h.runtime.status.value, 'error');
  assert.equal(h.runtime.activeInvoice.value, null);
  h.merchant.failAttach = false;
  await h.runtime.checkNow();
  assert.equal(h.runtime.activeInvoice.value.paymentHash, hash);
  assert.equal(h.calls.length, 1);
});

test('only a receiving wallet settlement confirms; a receiving fee does not change the gross invoice', async ctx => {
  let answer = { paid: false, accepted: true };
  const lookups = [];
  const h = harness(ctx, { lookup: async (...args) => { lookups.push(args); return answer; } });
  await h.runtime.createCharge(snapshot());
  await h.runtime.checkNow();
  assert.equal(h.runtime.status.value, 'waiting');
  assert.equal(h.paid.length, 0);
  answer = { paid: true, amount: 1000, receivedSats: 995, transactionId: 'actual-history-id' };
  await h.runtime.checkNow();
  await h.runtime.checkNow();
  assert.equal(h.runtime.status.value, 'paid');
  assert.equal(h.paid.length, 1);
  assert.deepEqual(lookups[0], ['wallet', hash, { createdAt: undefined, strict: true }]);
  assert.deepEqual(h.events.slice(-2), ['persist-paid', 'callback-paid']);
  assert.equal(h.paid[0][2].receivedSats, 995);
});

for (const badProof of [{ paid: true, amount: 999 }, { paid: true, amount: 1000, payment_hash: otherHash }]) {
  test('mismatched settlement proof cannot mark the order paid', async ctx => {
    const h = harness(ctx, { lookup: async () => badProof });
    await h.runtime.createCharge(snapshot());
    await h.runtime.checkNow();
    assert.equal(h.runtime.status.value, 'waiting');
    assert.equal(h.runtime.problem.value.code, 'KIOSK_PAYMENT_MISMATCH');
    assert.equal(h.paid.length, 0);
  });
}

test('expiry retains monitoring and a later payment belongs to the original detached order', async ctx => {
  let paid = false;
  const h = harness(ctx, { now: () => 2_000_000_001_000, lookup: async () => ({ paid, amount: 1000 }) });
  await h.runtime.createCharge(snapshot());
  await h.runtime.checkNow();
  assert.equal(h.runtime.status.value, 'expired');
  await h.runtime.nextCustomer();
  paid = true;
  await h.runtime.checkNow();
  assert.equal(h.merchant.orders[0].status, 'paid');
  assert.equal(h.runtime.activeOrder.value, null);
  assert.equal(h.paid.length, 1);
});

test('settlement write failure cannot show success; a subsequent verified check can recover', async ctx => {
  const h = harness(ctx, { lookup: async () => ({ paid: true, amount: 1000 }) });
  await h.runtime.createCharge(snapshot());
  h.merchant.failSettle = true;
  await h.runtime.checkNow();
  assert.equal(h.runtime.status.value, 'error');
  assert.equal(h.paid.length, 0);
  h.merchant.failSettle = false;
  await h.runtime.checkNow();
  assert.equal(h.runtime.status.value, 'paid');
  assert.equal(h.paid.length, 1);
});

test('interrupted creating intent becomes uncertain on hydration without creating another request', async ctx => {
  const merchant = fakeMerchant([]);
  const o = await merchant.createOrder(snapshot());
  await merchant.beginAttempt(o.id);
  const h = harness(ctx, { merchant });
  await h.runtime.ready;
  assert.equal(h.runtime.status.value, 'uncertain');
  await h.runtime.createCharge(snapshot());
  assert.equal(h.calls.length, 0);
});

test('the shared receiving runtime survives the checkout view lifecycle', async ctx => {
  const { effectScope } = await import('vue');
  const events = [], merchant = fakeMerchant(events);
  const walletStore = reactive({ wallets: [{ id: 'wallet', type: 'lnbits' }], kioskEnabled: true, kioskOwnerAccess: false, kioskWalletId: 'wallet', ensureWalletConnectedForTransfer: async () => ({}), createInvoiceDetailsOnWallet: async () => invoice, lookupInvoiceOnWallet: async () => ({ paid: true, amount: 1000 }) });
  const view = effectScope();
  const runtime = view.run(() => useKioskPayments({ merchant, walletStore, document: null, decodeInvoice: decode }));
  ctx.after(() => runtime.dispose());
  await runtime.createCharge(snapshot());
  view.stop();
  assert.equal(useKioskPayments({ merchant, walletStore }), runtime);
  await runtime.checkNow();
  assert.equal(merchant.orders[0].status, 'paid');
});

test('production invoice decoder verifies a real fixed-amount fixture and rejects a different quoted amount', () => {
  const paymentRequest = profileInvoiceFixture(21, 1_800_000_000_000);
  const request = validateKioskInvoice({ paymentRequest }, { walletId: 'wallet', amountSats: 21 });
  assert.match(request.paymentHash, /^[a-f0-9]{64}$/);
  assert.equal(request.amountSats, 21);
  assert.throws(() => validateKioskInvoice({ paymentRequest }, { walletId: 'wallet', amountSats: 22 }));
});

test('retrying an expired request links both attempts to the same immutable receipt', async ctx => {
  const h = harness(ctx, { now: () => 2_000_000_001_000 });
  await h.runtime.createCharge(snapshot());
  await h.runtime.checkNow();
  assert.equal(h.runtime.status.value, 'expired');
  await h.runtime.createCharge(snapshot());
  assert.equal(h.merchant.orders.length, 1);
  assert.equal(h.merchant.orders[0].attempts.length, 2);
  assert.equal(h.calls.length, 2);
});

test('an expired retry authoritatively reconciles a paid original before issuing any replacement', async ctx => {
  let paid = false;
  const lookups = [];
  const h = await durableHarness(ctx, {
    now: () => 2_000_000_001_000,
    lookup: async (...args) => { lookups.push(args); return { paid, amount: 1000, paymentHash: hash }; },
  });
  await h.runtime.createCharge(h.snapshot);
  await h.runtime.checkNow();
  assert.equal(h.runtime.status.value, 'expired');
  const count = lookups.length;
  paid = true;
  await h.runtime.createCharge(h.snapshot);
  assert.equal(lookups.length, count + 1, 'replacement requires a new receiving-wallet lookup');
  assert.equal(h.calls.length, 1);
  assert.equal(h.runtime.status.value, 'paid');
  assert.equal(h.merchant.orders[0].attempts.length, 1);
  assert.equal(h.saved().orders[0].status, 'paid');
  assert.equal(h.paid.length, 1);
});

test('a stale charge or retry confirmation cannot start another order after the displayed sale is paid', async ctx => {
  const h = await durableHarness(ctx, { lookup: async () => ({ paid: true, amount: 1000 }) });
  await h.runtime.createCharge(h.snapshot);
  await h.runtime.checkNow();
  assert.equal(h.runtime.status.value, 'paid');
  await h.runtime.createCharge(h.snapshot);
  assert.equal(h.calls.length, 1);
  assert.equal(h.merchant.orders.length, 1);
  assert.equal(h.runtime.status.value, 'paid');
});

for (const answer of ['throws', 'unknown']) {
  test(`an expired retry does not resend when authoritative settlement lookup ${answer}`, async ctx => {
    let uncertain = false;
    const h = await durableHarness(ctx, {
      now: () => 2_000_000_001_000,
      lookup: async () => {
        if (uncertain) {
          if (answer === 'throws') throw new Error('Connection interrupted');
          return undefined;
        }
        return { paid: false };
      },
    });
    await h.runtime.createCharge(h.snapshot);
    await h.runtime.checkNow();
    assert.equal(h.runtime.status.value, 'expired');
    uncertain = true;
    await h.runtime.createCharge(h.snapshot);
    assert.equal(h.calls.length, 1);
    assert.equal(h.merchant.orders[0].attempts.length, 1);
    assert.equal(h.runtime.problem.value.code, 'KIOSK_CONNECTION_FAILED');
  });
}

test('retry checks every previous payable attempt, including an older linked request', async ctx => {
  const seen = [];
  const h = await durableHarness(ctx, {
    now: () => 2_000_000_001_000,
    decodeInvoice: request => ({ ...decode(), paymentHash: request.endsWith('2') ? otherHash : hash }),
    lookup: async (_wallet, paymentHash) => { seen.push(paymentHash); return { paid: paymentHash === otherHash, amount: 1000, paymentHash }; },
  });
  await h.runtime.ready;
  const order = await h.merchant.createOrder(h.snapshot);
  for (const [paymentHash, paymentRequest] of [[hash, invoice.paymentRequest], [otherHash, 'lnbc10u1qqqq2']]) {
    const attempt = await h.merchant.beginAttempt(order.id);
    await h.merchant.attachInvoice(order.id, attempt.id, { walletId: 'wallet', amountSats: 1000, paymentHash, paymentRequest, expiresAt: 2_000_000_000 });
    await h.merchant.markAttemptExpired(order.id, attempt.id);
  }
  await h.runtime.createCharge(h.snapshot);
  assert.deepEqual(seen, [hash, otherHash]);
  assert.equal(h.calls.length, 0);
  assert.equal(h.merchant.orders[0].attempts.length, 2);
  assert.equal(h.merchant.orders[0].status, 'paid');
  assert.equal(h.runtime.pendingOrders.value.length, 0, 'paid orders leave the staff waiting list');
});

test('a paid order leaves waiting payments while its remaining request is still checked for a second payment', async ctx => {
  let creates = 0;
  const paidHashes = new Set();
  const h = await durableHarness(ctx, {
    now: () => 2_000_000_001_000,
    decodeInvoice: request => ({ ...decode(), paymentHash: request.endsWith('2') ? otherHash : hash }),
    create: async () => ++creates === 1 ? invoice : { paymentRequest: 'lnbc10u1qqqq2', paymentHash: otherHash },
    lookup: async (_wallet, paymentHash) => ({ paid: paidHashes.has(paymentHash), amount: 1000, paymentHash }),
  });
  await h.runtime.createCharge(h.snapshot);
  await h.runtime.checkNow();
  await h.runtime.createCharge(h.snapshot);
  paidHashes.add(hash);
  await h.runtime.checkNow();
  assert.equal(h.runtime.status.value, 'paid');
  assert.equal(h.runtime.pendingOrders.value.length, 0);
  assert(h.merchant.pendingAttempts.some(attempt => attempt.paymentHash === otherHash), 'second issued request retains monitoring');
  paidHashes.add(otherHash);
  await h.runtime.checkNow();
  assert.equal(h.merchant.orders[0].duplicatePayment, true);
  assert.equal(h.merchant.orders[0].attempts.filter(attempt => attempt.status === 'paid').length, 2);
  assert.equal(h.merchant.sales.length, 1);
  assert.equal(h.saved().orders[0].duplicatePayment, true);
});

test('an expired and authoritatively unpaid request can be replaced within its original durable order', async ctx => {
  let creates = 0;
  const lookups = [];
  const h = await durableHarness(ctx, {
    now: () => 2_000_000_001_000,
    decodeInvoice: request => ({ ...decode(), paymentHash: request.endsWith('2') ? otherHash : hash }),
    create: async () => ++creates === 1 ? invoice : { paymentRequest: 'lnbc10u1qqqq2', paymentHash: otherHash },
    lookup: async (_wallet, paymentHash) => { lookups.push(paymentHash); return { paid: false, paymentHash }; },
  });
  await h.runtime.createCharge(h.snapshot);
  await h.runtime.checkNow();
  const orderId = h.merchant.activeOrderId;
  await h.runtime.createCharge(h.snapshot);
  assert.deepEqual(lookups, [hash, hash]);
  assert.equal(h.calls.length, 2);
  assert.equal(h.merchant.orders.length, 1);
  assert.equal(h.merchant.activeOrderId, orderId);
  assert.equal(h.merchant.orders[0].attempts.length, 2);
  assert.equal(h.runtime.activeInvoice.value.paymentHash, otherHash);
  assert.equal(h.saved().orders[0].attempts[0].status, 'expired');
});

test('leaving checkout while replacement lookup is pending cannot create a request for the next customer', async ctx => {
  const checked = deferred(), result = deferred();
  let retry = false;
  const h = await durableHarness(ctx, {
    now: () => 2_000_000_001_000,
    lookup: async () => {
      if (!retry) return { paid: false };
      checked.resolve();
      return result.promise;
    },
  });
  await h.runtime.createCharge(h.snapshot);
  await h.runtime.checkNow();
  retry = true;
  const replacement = h.runtime.createCharge(h.snapshot);
  await checked.promise;
  await h.runtime.nextCustomer();
  result.resolve({ paid: false });
  await replacement;
  assert.equal(h.calls.length, 1);
  assert.equal(h.merchant.orders[0].attempts.length, 1);
  assert.equal(h.runtime.activeOrder.value, null);
});

test('a retry cannot replace a paid original whose receipt write fails', async ctx => {
  let paid = false;
  const h = await durableHarness(ctx, {
    now: () => 2_000_000_001_000,
    lookup: async () => ({ paid, amount: 1000 }),
  });
  await h.runtime.createCharge(h.snapshot);
  await h.runtime.checkNow();
  paid = true;
  h.repository.failCommit = true;
  await h.runtime.createCharge(h.snapshot);
  assert.equal(h.calls.length, 1);
  assert.equal(h.merchant.orders[0].attempts.length, 1);
  assert.equal(h.runtime.status.value, 'error');
  assert.equal(h.runtime.problem.value.code, 'KIOSK_STORAGE_FAILED');
  h.repository.failCommit = false;
  await h.runtime.checkNow();
  assert.equal(h.runtime.status.value, 'paid');
  assert.equal(h.saved().orders[0].status, 'paid');
  assert.equal(h.paid.length, 1);
});

test('a hashless uncertain request cannot issue a replacement after restoring the register', async ctx => {
  const h = await durableHarness(ctx);
  await h.runtime.ready;
  const order = await h.merchant.createOrder(h.snapshot);
  const attempt = await h.merchant.beginAttempt(order.id);
  await h.merchant.markCreationUncertain(order.id, attempt.id, 'CREATION_INTERRUPTED');
  await h.runtime.createCharge(h.snapshot);
  assert.equal(h.calls.length, 0);
  assert.equal(h.merchant.orders[0].attempts.length, 1);
  assert.equal(h.runtime.problem.value.code, 'KIOSK_REQUEST_UNRESOLVED');
});

test('entering staff mode before resuming an owner-selected request retains its exact QR', async ctx => {
  const h = await durableHarness(ctx);
  await h.runtime.createCharge(h.snapshot);
  const id = h.merchant.activeOrderId;
  h.walletStore.kioskOwnerAccess = true;
  await flush();
  assert.equal(h.runtime.activeOrder.value.id, id);
  h.walletStore.kioskOwnerAccess = false;
  await flush();
  await h.runtime.resume(id);
  await flush();
  assert.equal(h.runtime.activeOrder.value.id, id);
  assert.equal(h.runtime.activeInvoice.value.paymentRequest, invoice.paymentRequest);
  assert.equal(h.calls.length, 1);
});

test('owner access keeps the current order and basket bound to the existing request', async ctx => {
  const h = await durableHarness(ctx);
  await h.merchant.addItem(snapshot().items[0]);
  await h.runtime.createCharge(h.snapshot);
  const orderId = h.merchant.activeOrderId;
  h.walletStore.kioskOwnerAccess = true;
  await flush();
  assert.equal(h.merchant.activeOrderId, orderId, 'navigation cannot detach a payable basket');
  h.walletStore.kioskOwnerAccess = false;
  await flush();
  await h.runtime.createCharge(h.snapshot);
  assert.equal(h.calls.length, 1);
  assert.equal(h.merchant.orders.length, 1);
  assert.equal(h.runtime.activeInvoice.value.paymentHash, hash);
  assert.equal(h.merchant.draft.items.length, 1);
  assert.equal(h.saved().activeOrderId, orderId);
});

test('owner access during a durable attempt write retains the returned request on the same order', async ctx => {
  const began = deferred(), release = deferred();
  const h = await durableHarness(ctx);
  await h.merchant.addItem(snapshot().items[0]);
  const beginAttempt = h.merchant.beginAttempt.bind(h.merchant);
  h.merchant.beginAttempt = async (...args) => {
    const attempt = await beginAttempt(...args);
    began.resolve();
    await release.promise;
    return attempt;
  };
  const creation = h.runtime.createCharge(h.snapshot);
  await began.promise;
  const orderId = h.merchant.activeOrderId;
  h.walletStore.kioskOwnerAccess = true;
  await flush();
  release.resolve();
  await creation;
  assert.equal(h.merchant.activeOrderId, orderId);
  assert.equal(h.runtime.activeInvoice.value.paymentHash, hash);
  h.walletStore.kioskOwnerAccess = false;
  await flush();
  await h.runtime.createCharge(h.snapshot);
  assert.equal(h.calls.length, 1);
  assert.equal(h.merchant.orders[0].attempts.length, 1);
  assert.equal(h.merchant.draft.items.length, 1);
});

test('owner access while the wallet creates an invoice retains its original ownership', async ctx => {
  const called = deferred(), response = deferred();
  const h = await durableHarness(ctx, { create: async () => { called.resolve(); return response.promise; } });
  await h.merchant.addItem(snapshot().items[0]);
  const creation = h.runtime.createCharge(h.snapshot);
  await called.promise;
  const orderId = h.merchant.activeOrderId;
  h.walletStore.kioskOwnerAccess = true;
  await flush();
  response.resolve(invoice);
  await creation;
  h.walletStore.kioskOwnerAccess = false;
  await flush();
  assert.equal(h.merchant.activeOrderId, orderId);
  assert.equal(h.runtime.activeInvoice.value.paymentHash, hash);
  await h.runtime.createCharge(h.snapshot);
  assert.equal(h.calls.length, 1);
  assert.equal(h.merchant.orders.length, 1);
  assert.equal(h.merchant.draft.items.length, 1);
});

test('only next customer clears both active ownership and its basket while an invoice is being prepared', async ctx => {
  const called = deferred(), response = deferred();
  const h = await durableHarness(ctx, { create: async () => { called.resolve(); return response.promise; } });
  await h.merchant.addItem(snapshot().items[0]);
  const creation = h.runtime.createCharge(h.snapshot);
  await called.promise;
  await h.runtime.nextCustomer();
  assert.equal(h.merchant.activeOrderId, null);
  assert.equal(h.merchant.draft.items.length, 0);
  assert.equal(h.saved().activeOrderId, null);
  assert.equal(h.saved().draft.items.length, 0);
  await h.merchant.addItem({ ...snapshot().items[0], id: 'next-customer', name: 'Next customer amount', unitSats: 21 });
  response.resolve(invoice);
  await creation;
  assert.equal(h.runtime.activeOrder.value, null);
  assert.equal(h.merchant.orders[0].attempts[0].paymentHash, hash);
  assert.equal(h.merchant.draft.items[0].unitSats, 21);
});

test('resuming a waiting payment cannot replace another active payable order', async ctx => {
  let creates = 0;
  const h = await durableHarness(ctx, {
    decodeInvoice: request => ({ ...decode(), paymentHash: request.endsWith('2') ? otherHash : hash }),
    create: async () => ++creates === 1 ? invoice : { paymentRequest: 'lnbc10u1qqqq2', paymentHash: otherHash },
  });
  await h.runtime.createCharge(h.snapshot);
  const previousId = h.merchant.activeOrderId;
  await h.runtime.nextCustomer();
  await h.merchant.addItem(snapshot().items[0]);
  await h.runtime.createCharge(h.snapshot);
  const currentId = h.merchant.activeOrderId;
  await assert.rejects(h.runtime.resume(previousId), error => error.code === 'KIOSK_BASKET_CONFLICT');
  assert.equal(h.merchant.activeOrderId, currentId);
  assert.equal(h.runtime.activeInvoice.value.paymentHash, otherHash);
  assert.equal(h.merchant.draft.items.length, 1);
  assert.equal(h.calls.length, 2);
});

test('resuming a waiting payment cannot take ownership of a new unsent basket', async ctx => {
  const h = await durableHarness(ctx);
  await h.runtime.createCharge(h.snapshot);
  const previousId = h.merchant.activeOrderId;
  await h.runtime.nextCustomer();
  await h.merchant.addItem({ ...snapshot().items[0], id: 'next-sale', unitSats: 21 });
  await assert.rejects(h.runtime.resume(previousId), error => error.code === 'KIOSK_BASKET_CONFLICT');
  assert.equal(h.merchant.activeOrderId, null);
  assert.equal(h.merchant.draft.items[0].unitSats, 21);
  assert.equal(h.saved().draft.items[0].unitSats, 21);
  assert.equal(h.calls.length, 1);
});

test('a malformed restored request cannot display a QR or confirm an unrelated invoice', async ctx => {
  const merchant = fakeMerchant([]);
  const order = await merchant.createOrder(snapshot());
  const attempt = await merchant.beginAttempt(order.id);
  await merchant.attachInvoice(order.id, attempt.id, { ...invoice, walletId: 'wallet', amountSats: 1000, paymentHash: otherHash });
  const h = harness(ctx, { merchant, lookup: () => assert.fail('invalid restored request must not be looked up') });
  await h.runtime.ready;
  await h.runtime.checkNow();
  assert.equal(h.runtime.status.value, 'error');
  assert.equal(h.runtime.activeInvoice.value, null);
  assert.equal(h.paid.length, 0);
});

test('real merchant store and receiving monitor recover a detached invoice after reload and persist the exact receipt', async ctx => {
  const { createPinia, setActivePinia } = await import('pinia');
  const { useKioskMerchantStore } = await import('../../stores/kioskMerchant.js');
  const { buildSaleSnapshot } = await import('../../utils/kioskMerchant.js');
  let saved = null, creates = 0;
  const repository = {
    async load() { return saved && structuredClone(saved); },
    async commit(next, previous) { assert.equal(saved?.revision || 0, previous?.revision || 0); saved = JSON.parse(JSON.stringify(next)); },
  };
  const request = profileInvoiceFixture(21, 1_800_000_000_000);
  const expected = validateKioskInvoice({ paymentRequest: request }, { walletId: 'wallet', amountSats: 21 });
  const lookups = [];
  const walletStore = reactive({ wallets: [{ id: 'wallet', type: 'lnbits' }], kioskEnabled: true, kioskOwnerAccess: false, kioskWalletId: 'wallet',
    ensureWalletConnectedForTransfer: async () => ({}),
    createInvoiceDetailsOnWallet: async () => { creates++; return { paymentRequest: request }; },
    lookupInvoiceOnWallet: async (...args) => { lookups.push(args); return { paid: true, amount: 21, receivedSats: 20, transactionId: 'exact-history-id', paymentHash: expected.paymentHash }; },
  });
  setActivePinia(createPinia());
  const first = useKioskMerchantStore();
  await first.initialize({ storage: repository, legacyStorage: null });
  const runtime = createKioskPaymentRuntime({ merchant: first, walletStore, document: null });
  await runtime.createCharge(buildSaleSnapshot({ ...snapshot(), items: [{ id: 'amount', name: 'Amount', unit: 'sats', unitSats: 21, qty: 1 }] }));
  await runtime.nextCustomer();
  runtime.dispose();
  setActivePinia(createPinia());
  const restored = useKioskMerchantStore();
  await restored.initialize({ storage: repository, legacyStorage: null });
  const receipts = [];
  const resumed = createKioskPaymentRuntime({ merchant: restored, walletStore, document: null, onPaid: (...args) => receipts.push(args) });
  ctx.after(() => resumed.dispose());
  await resumed.ready;
  await resumed.checkNow();
  assert.equal(creates, 1);
  assert.equal(receipts.length, 1);
  assert.equal(restored.activeOrderId, null, 'a previous customer payment never reopens checkout');
  assert.equal(saved.orders[0].status, 'paid');
  assert.equal(saved.orders[0].attempts[0].transactionId, 'exact-history-id');
  assert.equal(saved.orders[0].attempts[0].paymentHash, expected.paymentHash);
  assert.deepEqual(lookups[0].slice(0, 2), ['wallet', expected.paymentHash]);
  assert.equal(lookups[0][2].createdAt, saved.orders[0].attempts[0].createdAt);
});

test('a recovered connection clears the earlier register problem before displaying its request', async ctx => {
  const h = harness(ctx);
  h.walletStore.ensureWalletConnectedForTransfer = async () => { throw new Error('offline'); };
  await h.runtime.createCharge(snapshot());
  assert.equal(h.runtime.problem.value.code, 'KIOSK_CONNECTION_FAILED');
  h.walletStore.ensureWalletConnectedForTransfer = async () => ({});
  await h.runtime.createCharge(snapshot());
  assert.equal(h.runtime.problem.value, null);
  assert.equal(h.runtime.status.value, 'waiting');
});
