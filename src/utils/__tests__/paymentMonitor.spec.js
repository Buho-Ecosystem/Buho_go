import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPaymentMonitor, PaymentStatus } from '../paymentMonitor.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness(ctx, config = {}) {
  const monitor = createPaymentMonitor({ initialInterval: 60000, ...config });
  ctx.after(() => monitor.stop());
  const events = [];
  const start = (lookupInvoice, invoice = {}) => monitor.start({ invoice: { payment_hash: 'sale-hash', amount: 100, ...invoice }, provider: { lookupInvoice }, onStatusChange: status => events.push(status) });
  return { monitor, events, start };
}
test('checks only the invoice hash and never wallet balance', async ctx => {
  const h = harness(ctx);
  await h.start(async hash => { assert.equal(hash, 'sale-hash'); return { paid: false, balance: 100000 }; });
  await h.monitor.checkNow();
  assert.ok(!h.events.includes(PaymentStatus.CONFIRMED));
});

for (const paid of [true, false]) {
  test(`resume after expiry checks settlement before reporting ${paid ? 'paid' : 'expired'}`, async ctx => {
    const h = harness(ctx, { expiryBuffer: 0 });
    let lookups = 0;
    await h.start(async () => { lookups++; return { paid }; }, { expires_at: Math.floor(Date.now() / 1000) - 1 });
    await h.monitor.checkNow();
    assert.equal(lookups, 1);
    assert.equal(h.events.at(-1), paid ? PaymentStatus.CONFIRMED : PaymentStatus.EXPIRED);
    assert.equal(h.monitor.isActive(), false);
  });
}

test('an unavailable wallet cannot prove an expired invoice was unpaid', async ctx => {
  const h = harness(ctx, { expiryBuffer: 0, maxConsecutiveErrors: 1 });
  await h.start(async () => { throw new Error('offline'); }, { expires_at: 1 });
  await h.monitor.checkNow();
  assert.equal(h.events.at(-1), PaymentStatus.ERROR);
  assert.ok(!h.events.includes(PaymentStatus.EXPIRED));
});
test('foreground catch-up and scheduled polls share a single lookup', async ctx => {
  const h = harness(ctx), pending = deferred();
  let calls = 0;
  await h.start(() => { calls++; return pending.promise; });
  const first = h.monitor.checkNow();
  await h.monitor.checkNow();
  assert.equal(calls, 1);
  pending.resolve({ paid: true });
  await first;
  assert.equal(h.events.filter(s => s === PaymentStatus.CONFIRMED).length, 1);
});
test('a stopped monitor ignores a late paid result', async ctx => {
  const h = harness(ctx), pending = deferred();
  await h.start(() => pending.promise);
  const poll = h.monitor.checkNow();
  h.monitor.stop();
  pending.resolve({ paid: true });
  await poll;
  assert.ok(!h.events.includes(PaymentStatus.CONFIRMED));
});
test('restarting a monitor cannot let its previous lookup settle the new sale', async ctx => {
  const h = harness(ctx), old = deferred(), current = deferred();
  await h.start(() => old.promise);
  const first = h.monitor.checkNow();
  await h.start(() => current.promise);
  const second = h.monitor.checkNow();
  old.resolve({ paid: true });
  await first;
  assert.ok(!h.events.includes(PaymentStatus.CONFIRMED));
  assert.equal(h.monitor.checking, true);
  current.resolve({ paid: false });
  await second;
  assert.equal(h.monitor.checking, false);
});
