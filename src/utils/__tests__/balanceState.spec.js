import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emptyBalanceState, hydrateBalanceState, nextBalanceState, describeBalance, summarizeTotal,
  BALANCE_STATUS, FRESH_FOR_MS,
} from '../balanceState.js';

const NOW = 1_790_000_000_000;

test('cold hydration keeps saved funds, labelled stale — never an invented zero', () => {
  const s = hydrateBalanceState({ metadata: { cachedBalance: 25000, balanceUpdatedAt: NOW - 86400000 } });
  const d = describeBalance(s, { now: NOW });
  assert.equal(d.value, 25000);
  assert.equal(d.status, BALANCE_STATUS.STALE);
  assert.equal(s.source, 'persisted');
  // Nothing saved: unknown, not zero.
  const none = describeBalance(hydrateBalanceState({ metadata: {} }), { now: NOW });
  assert.equal(none.known, false);
  assert.equal(none.value, null);
  assert.equal(none.status, BALANCE_STATUS.UNKNOWN);
});

test('a verified zero is a real, fresh zero', () => {
  const s = nextBalanceState(emptyBalanceState(), { value: 0, source: 'sync', at: NOW });
  const d = describeBalance(s, { now: NOW });
  assert.equal(d.known, true);
  assert.equal(d.value, 0);
  assert.equal(d.status, BALANCE_STATUS.FRESH);
});

test('unknown, loading, stale cache, error and stalled sync stay distinguishable', () => {
  assert.equal(describeBalance(emptyBalanceState()).status, BALANCE_STATUS.UNKNOWN);
  assert.equal(describeBalance({ ...emptyBalanceState(), refreshing: true }).status, BALANCE_STATUS.LOADING);
  assert.equal(describeBalance({ ...emptyBalanceState(), error: 'timeout' }).status, BALANCE_STATUS.ERROR);
  const cached = nextBalanceState(emptyBalanceState(), { value: 10, source: 'cache', fresh: false, at: NOW });
  assert.equal(describeBalance(cached, { now: NOW }).status, BALANCE_STATUS.STALE);
  const fresh = nextBalanceState(emptyBalanceState(), { value: 10, source: 'sync', at: NOW });
  assert.equal(describeBalance(fresh, { now: NOW + FRESH_FOR_MS + 1 }).status, BALANCE_STATUS.STALE, 'a sync that stalled ages into stale');
  const failed = nextBalanceState(fresh, { value: 10, source: 'cache', fresh: false, at: NOW + 1000, error: 'breez sync timeout' });
  assert.equal(describeBalance(failed, { now: NOW + 1000 }).status, BALANCE_STATUS.STALE);
  assert.equal(failed.error, 'breez sync timeout');
});

test('a timeout keeps the last known value instead of reporting zero', () => {
  const fresh = nextBalanceState(emptyBalanceState(), { value: 2686, source: 'sync', at: NOW });
  const afterTimeout = nextBalanceState(fresh, { value: undefined, source: 'sync', at: NOW + 5000, error: 'timeout' });
  assert.equal(afterTimeout.value, 2686);
  assert.equal(afterTimeout.error, 'timeout');
});

test('late reads cannot overwrite newer verified state', () => {
  const newer = nextBalanceState(emptyBalanceState(), { value: 900, source: 'sync', at: NOW + 1000 });
  const late = nextBalanceState(newer, { value: 1000, source: 'sync', at: NOW });
  assert.equal(late.value, 900);
  const lateCache = nextBalanceState(newer, { value: 1000, source: 'cache', fresh: false, at: NOW });
  assert.equal(lateCache.value, 900);
  const newerRead = nextBalanceState(newer, { value: 950, source: 'event', at: NOW + 2000 });
  assert.equal(newerRead.value, 950);
});

test('totals cover every configured wallet and say when they are incomplete or stale', () => {
  const states = {
    A: nextBalanceState(emptyBalanceState(), { value: 1000, source: 'sync', at: NOW }),
    B: hydrateBalanceState({ metadata: { cachedBalance: 25000 } }),
    C: emptyBalanceState(),
  };
  const total = summarizeTotal(['A', 'B', 'C'], states, { now: NOW });
  assert.equal(total.total, 26000, 'saved funds count — the old total dropped them to zero');
  assert.equal(total.complete, false);
  assert.deepEqual(total.unknownIds, ['C']);
  assert.equal(total.stale, true);
  assert.deepEqual(total.staleIds, ['B']);
  const exact = summarizeTotal(['A'], states, { now: NOW });
  assert.deepEqual([exact.total, exact.complete, exact.stale], [1000, true, false]);
  const verifiedZero = summarizeTotal(['Z'], { Z: nextBalanceState(emptyBalanceState(), { value: 0, at: NOW }) }, { now: NOW });
  assert.deepEqual([verifiedZero.total, verifiedZero.complete, verifiedZero.stale], [0, true, false]);
});

test('invalid numbers never replace a value', () => {
  const s = nextBalanceState(emptyBalanceState(), { value: 7, at: NOW });
  for (const bad of [NaN, -1, 'abc', null]) assert.equal(nextBalanceState(s, { value: bad, at: NOW + 1 }).value, 7);
});
