import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectScope } from 'vue';
import { useProfileInvoice } from '../useProfileInvoice.js';

function harness(ctx) {
  const requests = [];
  const scope = effectScope();
  const state = scope.run(() => useProfileInvoice(input => new Promise((resolve, reject) => {
    requests.push({ input, resolve, reject });
  })));
  ctx.after(() => scope.stop());
  return { state, requests, scope };
}

test('duplicate taps create only one invoice and release loading state on success', async ctx => {
  const { state, requests } = harness(ctx);
  const first = state.create({ amountSats: 1000 });
  await state.create({ amountSats: 1000 });
  assert.equal(requests.length, 1);
  assert.equal(state.loading.value, true);
  requests[0].resolve({ invoice: 'first' });
  await first;
  assert.deepEqual(state.invoice.value, { invoice: 'first' });
  assert.equal(state.loading.value, false);
});

for (const staleOutcome of ['resolve', 'reject']) {
  test(`edited amount/recipient cancels request; late ${staleOutcome} cannot overwrite new invoice`, async ctx => {
    const { state, requests } = harness(ctx);
    const old = state.create({ amountSats: 1000 });
    state.invalidate();
    assert.equal(requests[0].input.signal.aborted, true);
    const current = state.create({ amountSats: 2000 });
    requests[1].resolve({ invoice: 'current', amountSats: 2000 });
    await current;
    requests[0][staleOutcome](new Error('stale result'));
    await old;
    assert.equal(state.invoice.value.invoice, 'current');
    assert.equal(state.error.value, null);
    assert.equal(state.loading.value, false);
  });
}

test('unmount aborts outstanding requests and ignores their response', async ctx => {
  const { state, requests, scope } = harness(ctx);
  const pending = state.create({ amountSats: 1000 });
  scope.stop();
  assert.equal(requests[0].input.signal.aborted, true);
  requests[0].resolve({ invoice: 'late' });
  await pending;
  assert.equal(state.invoice.value, null);
  assert.equal(state.loading.value, false);
});

test('a failed request can be retried without preserving the old error', async ctx => {
  const { state, requests } = harness(ctx);
  const first = state.create({ amountSats: 1000 });
  const failure = new Error('offline');
  requests[0].reject(failure);
  await first;
  assert.equal(state.error.value, failure);
  const retry = state.create({ amountSats: 1000 });
  assert.equal(state.error.value, null);
  requests[1].resolve({ invoice: 'retry' });
  await retry;
  assert.equal(state.invoice.value.invoice, 'retry');
});
