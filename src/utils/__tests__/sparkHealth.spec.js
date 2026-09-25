import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSparkHealth, SUSTAINED_OUTAGE_MS } from '../sparkHealth.js';

function memory() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), map: m }; }

test('an outage counts from the first failure and clears on success', () => {
  let clock = 1000;
  const storage = memory();
  const health = createSparkHealth({ storage, now: () => clock });
  assert.equal(health.unreachableFor('w1'), 0);
  health.recordFailure('w1');
  clock += 5000;
  health.recordFailure('w1');
  assert.equal(health.unreachableFor('w1'), 5000);
  assert.equal(health.isSustainedOutage('w1'), false);
  clock += SUSTAINED_OUTAGE_MS;
  assert.equal(health.isSustainedOutage('w1'), false, 'two misses are not sustained');
  health.recordFailure('w1');
  assert.equal(health.isSustainedOutage('w1'), true);
  health.recordSuccess('w1');
  assert.equal(health.unreachableFor('w1'), 0);
  assert.equal(health.lastSuccessAt('w1'), clock);
  const reloaded = createSparkHealth({ storage, now: () => clock });
  assert.equal(reloaded.lastSuccessAt('w1'), clock);
});

test('broken storage degrades to memory', () => {
  const health = createSparkHealth({ storage: { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } } });
  health.recordFailure('w1');
  assert.ok(health.unreachableFor('w1') >= 0);
});
