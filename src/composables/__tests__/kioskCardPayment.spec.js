import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectScope, shallowRef } from 'vue';
import { useKioskCardPayment } from '../useKioskCardPayment.js';

const info = { callback: 'https://card.example/callback', k1: 'test', minSats: 1, maxSats: 1000, defaultDescription: 'Bolt Card' };
const invoice = { paymentRequest: 'lnbc-test', amountSats: 100, walletId: 'kiosk-wallet' };
const tap = () => ({ data: 'lnurlw://card.example/tap', receivedAt: Date.now() });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function harness(ctx, options = {}) {
  const scope = effectScope();
  ctx.after(() => scope.stop());
  const sale = shallowRef(null);
  const errors = [];
  const submissions = [];
  const resolutions = [];
  const card = scope.run(() => useKioskCardPayment({ sale,
    onError: error => errors.push(error),
    resolve: async (...args) => { resolutions.push(args); return options.resolve ? options.resolve(...args) : info; },
    authorize: async (...args) => { submissions.push(args); return options.authorize?.(...args); },
  }));
  return { card, sale, errors, submissions, resolutions, scope };
}

test('tap before amount waits for a sale, then reviews its fixed amount without paying', async ctx => {
  const h = harness(ctx);
  h.card.accept(tap());
  assert.equal(h.card.phase.value, 'ready');
  assert.equal(h.resolutions.length, 0);
  h.sale.value = invoice;
  await settle();
  assert.equal(h.card.phase.value, 'review');
  assert.deepEqual(h.card.payment.value.amount, { mode: 'fixed', fixedSats: 100 });
  assert.equal(h.submissions.length, 0);
  await h.card.confirm({ amountSats: 100 });
  assert.equal(h.submissions[0][1], invoice.paymentRequest);
  assert.equal(h.submissions[0][2], 100);
  assert.equal(h.card.phase.value, 'waiting', 'callback acceptance is not receipt');
});

test('tap on existing QR uses that invoice; duplicate taps and confirmations do not pay twice', async ctx => {
  const pending = deferred();
  const h = harness(ctx, { authorize: () => pending.promise });
  h.sale.value = invoice;
  h.card.accept(tap());
  await settle();
  assert.equal(h.card.accept(tap()), false);
  const submitting = h.card.confirm({ amountSats: 100 });
  await h.card.confirm({ amountSats: 100 });
  assert.equal(h.submissions.length, 1);
  pending.resolve();
  await submitting;
  assert.equal(h.card.accept(tap()), false);
});

test('card bounds never change the sale amount and mismatched confirmation is rejected', async ctx => {
  const h = harness(ctx);
  h.sale.value = { ...invoice, amountSats: 2000 };
  h.card.accept(tap());
  await settle();
  assert.equal(h.card.phase.value, 'empty');
  assert.match(h.errors[0].message, /limits/);
  assert.equal(h.submissions.length, 0);
  h.sale.value = invoice;
  h.card.accept(tap());
  await settle();
  await h.card.confirm({ amountSats: 99 });
  assert.equal(h.submissions.length, 0);
});

test('expired cold-start card is discarded', ctx => {
  const h = harness(ctx);
  assert.equal(h.card.accept({ ...tap(), receivedAt: Date.now() - 121000 }), false);
  assert.equal(h.resolutions.length, 0);
});

for (const stage of ['metadata', 'authorization']) {
  for (const reason of ['cancel', 'new sale', 'paid or parked', 'unmount']) {
    test(`${reason} invalidates late ${stage} completion`, async ctx => {
      const pending = deferred();
      const h = harness(ctx, stage === 'metadata' ? { resolve: () => pending.promise } : { authorize: () => pending.promise });
      h.sale.value = invoice;
      h.card.accept(tap());
      await settle();
      const submitting = stage === 'authorization' ? h.card.confirm({ amountSats: 100 }) : null;
      const signal = stage === 'metadata' ? h.resolutions[0][1].signal : h.submissions[0][3].signal;
      if (reason === 'cancel') h.card.reset();
      if (reason === 'new sale') h.sale.value = { ...invoice, walletId: 'different-wallet' };
      if (reason === 'paid or parked') h.sale.value = null;
      if (reason === 'unmount') h.scope.stop();
      assert.equal(signal.aborted, true);
      pending.resolve(info);
      await submitting;
      await settle();
      assert.equal(h.card.phase.value, 'empty');
      assert.equal(h.card.payment.value, null);
      assert.equal(h.errors.length, 0);
    });
  }
}

test('a failed callback is not automatically retried', async ctx => {
  const h = harness(ctx, { authorize: async () => { throw new Error('network timeout'); } });
  h.sale.value = invoice;
  h.card.accept(tap());
  await settle();
  await h.card.confirm({ amountSats: 100 });
  await h.card.confirm({ amountSats: 100 });
  assert.equal(h.submissions.length, 1);
  assert.equal(h.errors.length, 1);
  assert.equal(h.sale.value, invoice, 'keep the existing invoice available for settlement');
});
