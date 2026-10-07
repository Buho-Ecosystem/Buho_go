import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emptyBalanceState, hydrateBalanceState, nextBalanceState, describeBalance, summarizeTotal,
  BALANCE_STATUS, FRESH_FOR_MS,
} from '../balanceState.js';

const NOW = 1_790_000_000_000;

test('legacy hydration accepts an unambiguous value per wallet, including zero and missing metadata', () => {
  const legacy = { activeWalletId: 'A', balance: 37, connectedWallets: [{ id: 'B', balance: 0 }] };
  assert.equal(hydrateBalanceState({ id: 'A' }, legacy).value, 37);
  assert.equal(hydrateBalanceState({ id: 'B' }, legacy).value, 0);
  assert.equal(hydrateBalanceState({ id: 'C' }, legacy).value, null);
  assert.equal(hydrateBalanceState({ id: 'A' }, { ...legacy, connectedWallets: {} }).value, 37);
  assert.equal(hydrateBalanceState({ metadata: { cachedBalance: -1 } }).value, null);
});

test('conflicting old snapshots cannot be ranked by amount or metadata timestamp', () => {
  for (const [cached, home] of [[1747, 37], [37, 1747], [37, 0]]) {
    const wallet = { id: 'A', metadata: { cachedBalance: cached, balanceUpdatedAt: NOW } };
    assert.equal(hydrateBalanceState(wallet, { activeWalletId: 'A', balance: home }).value, null);
    assert.equal(hydrateBalanceState(wallet, { connectedWallets: [{ id: 'A', balance: home }] }).value, null);
  }
});

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

test('after a failed sync, a cache read cannot replace saved funds or invent a zero (#297 review)', () => {
  const saved = hydrateBalanceState({ metadata: { cachedBalance: 25000 } });
  // Sync failed; the SDK cache is empty and reads 0.
  const afterFail = nextBalanceState(saved, { value: 0, source: 'cache', fresh: false, at: NOW, error: 'Spark did not answer the sync' });
  assert.equal(afterFail.value, 25000);
  assert.equal(afterFail.error, 'Spark did not answer the sync');
  // A later partial-event cache read neither replaces it nor clears the error.
  const partial = nextBalanceState(afterFail, { value: 0, source: 'cache', fresh: false, at: NOW + 1000 });
  assert.equal(partial.value, 25000);
  assert.ok(partial.error);
  // Unknown stays unknown after a failure.
  const unknown = nextBalanceState(emptyBalanceState(), { value: 0, source: 'cache', fresh: false, at: NOW, error: 'timeout' });
  assert.equal(unknown.value, null);
  assert.equal(describeBalance(unknown, { now: NOW }).status, BALANCE_STATUS.ERROR);
  // A verified refresh recovers, including a real zero.
  const recovered = nextBalanceState(partial, { value: 0, source: 'sync', at: NOW + 2000 });
  assert.equal(recovered.value, 0);
  assert.equal(recovered.error, null);
});

test('a cache read that changes a verified value is not presented as verified', () => {
  const verified = nextBalanceState(emptyBalanceState(), { value: 100, source: 'sync', at: NOW });
  const changed = nextBalanceState(verified, { value: 150, source: 'cache', fresh: false, at: NOW + 1000 });
  assert.equal(changed.value, 150);
  assert.equal(changed.verifiedAt, null);
  assert.equal(describeBalance(changed, { now: NOW + 1000 }).status, BALANCE_STATUS.STALE);
});
