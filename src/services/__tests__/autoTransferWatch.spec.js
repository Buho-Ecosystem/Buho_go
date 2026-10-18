import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESUME_SETTLE_MS, WATCH_INTERVAL_MS, createAutoTransferWatch } from '../autoTransferWatch.js';

function setup({ clock = { t: 1_000_000 } } = {}) {
  const wallets = [
    { id: 'spark', type: 'spark' },
    { id: 'hub', type: 'nwc' },
    { id: 'kitty', type: 'lnbits' },
    { id: 'ark', type: 'arkade' },
    { id: 'legacy' }, // saved without a type: an NWC connection
  ];
  const rules = { spark: { enabled: true }, hub: { enabled: true }, kitty: { enabled: false }, ark: { enabled: true }, legacy: { enabled: true } };
  const timers = [];
  const refreshed = [];
  const watch = createAutoTransferWatch({
    wallets: () => wallets,
    ruleFor: (id) => rules[id] || null,
    refresh: async (id) => { refreshed.push(id); if (id === 'ark') throw new Error('offline'); },
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
    now: () => clock.t,
  });
  return { watch, timers, refreshed, rules, clock };
}

test('only wallets with a switched-on rule that Spark does not already keep fresh are read', () => {
  const { watch } = setup();
  assert.deepEqual(watch.watched().map((w) => w.id), ['hub', 'ark', 'legacy']);
});

test('every minute while running, one failing wallet does not stop the others or the next round', async () => {
  const { watch, timers, refreshed } = setup();
  watch.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, WATCH_INTERVAL_MS);
  timers[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(refreshed, ['hub', 'ark', 'legacy']);
  assert.equal(timers.length, 2, 'the next round is scheduled after a failure too');
});

test('returning to the app reads at once; a stopped watch does nothing', async () => {
  const { watch, timers, refreshed, rules } = setup();
  watch.start();
  await watch.resume();
  assert.deepEqual(refreshed, ['hub', 'ark', 'legacy']);
  assert.equal(timers[0].cleared, true, 'the pending round is replaced, not doubled');
  watch.stop();
  rules.kitty.enabled = true;
  await watch.resume();
  assert.equal(refreshed.length, 3);
});

test('coming back raises several events and the thawed timer at once: one read covers them all', async () => {
  const { watch, timers, refreshed, clock } = setup();
  watch.start();
  const thawed = timers[0].fn(); // the frozen round fires on thaw
  await Promise.all([watch.resume(), watch.resume(), watch.resume(), thawed]);
  assert.deepEqual(refreshed, ['hub', 'ark', 'legacy'], 'one round, not four');
  clock.t += RESUME_SETTLE_MS - 1;
  await watch.resume();
  assert.equal(refreshed.length, 3, 'a resume right after a round adds nothing');
  clock.t += 2;
  await watch.resume();
  assert.equal(refreshed.length, 6, 'a later return reads again');
});
