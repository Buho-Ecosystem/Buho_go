/**
 * claimedDeposits — double-claim guard registry tests.
 *
 * The registry is what makes "instant claim, then the 3-conf handler
 * claims the same UTXO again" impossible, so the tests focus on the
 * properties that guarantee that: durable membership across instances,
 * dedupe, FIFO eviction that cannot resurrect recent claims, and
 * graceful degradation when storage is corrupt or throwing.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/claimedDeposits.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  createClaimedDepositRegistry,
  CLAIMED_DEPOSITS_STORAGE_KEY,
} from '../claimedDeposits.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

test('add + has: a claimed txid stays claimed', () => {
  const reg = createClaimedDepositRegistry();
  assert.equal(reg.has('tx1'), false);
  reg.add('tx1');
  assert.equal(reg.has('tx1'), true);
  assert.equal(reg.has('tx2'), false);
  assert.equal(reg.size(), 1);
});

test('adding the same txid twice keeps one entry', () => {
  const reg = createClaimedDepositRegistry();
  reg.add('tx1');
  reg.add('tx1');
  assert.equal(reg.size(), 1);
});

test('falsy and non-string txids are ignored', () => {
  const reg = createClaimedDepositRegistry();
  reg.add('');
  reg.add(null);
  reg.add(undefined);
  reg.add(42);
  assert.equal(reg.size(), 0);
  assert.equal(reg.has(''), false);
  assert.equal(reg.has(null), false);
});

test('persists to storage and survives a new instance (app restart)', () => {
  const storage = fakeStorage();
  const first = createClaimedDepositRegistry({ storage });
  first.add('txA');
  first.add('txB');

  const second = createClaimedDepositRegistry({ storage });
  assert.equal(second.has('txA'), true);
  assert.equal(second.has('txB'), true);
  assert.equal(second.size(), 2);
});

test('the double-claim scenario end to end', () => {
  // Instant claim happens, app restarts mid confirmation window, the
  // 3-conf handler sees the deposit again — and must skip it.
  const storage = fakeStorage();
  const beforeRestart = createClaimedDepositRegistry({ storage });
  beforeRestart.add('deposit-tx');

  const afterRestart = createClaimedDepositRegistry({ storage });
  assert.equal(afterRestart.has('deposit-tx'), true, '3-conf handler must see the claim');
});

test('FIFO eviction caps growth, evicting oldest first', () => {
  const storage = fakeStorage();
  const reg = createClaimedDepositRegistry({ storage, maxEntries: 3 });
  reg.add('tx1');
  reg.add('tx2');
  reg.add('tx3');
  reg.add('tx4');
  assert.equal(reg.size(), 3);
  assert.equal(reg.has('tx1'), false, 'oldest evicted');
  assert.equal(reg.has('tx2'), true);
  assert.equal(reg.has('tx4'), true);
  // Persisted state matches: a reload sees the same membership.
  const reloaded = createClaimedDepositRegistry({ storage, maxEntries: 3 });
  assert.equal(reloaded.has('tx1'), false);
  assert.equal(reloaded.has('tx4'), true);
});

test('corrupt stored JSON starts empty instead of blocking claims', () => {
  const storage = fakeStorage({ [CLAIMED_DEPOSITS_STORAGE_KEY]: '{not json[' });
  const reg = createClaimedDepositRegistry({ storage });
  assert.equal(reg.size(), 0);
  reg.add('tx1');
  assert.equal(reg.has('tx1'), true);
});

test('non-array stored JSON is discarded', () => {
  const storage = fakeStorage({ [CLAIMED_DEPOSITS_STORAGE_KEY]: '{"a":1}' });
  const reg = createClaimedDepositRegistry({ storage });
  assert.equal(reg.size(), 0);
});

test('junk entries inside stored array are filtered on hydrate', () => {
  const storage = fakeStorage({
    [CLAIMED_DEPOSITS_STORAGE_KEY]: JSON.stringify(['tx1', 7, null, '', 'tx1', 'tx2']),
  });
  const reg = createClaimedDepositRegistry({ storage });
  assert.equal(reg.size(), 2);
  assert.equal(reg.has('tx1'), true);
  assert.equal(reg.has('tx2'), true);
});

test('a throwing storage degrades to in-memory tracking, never throws', () => {
  const storage = {
    getItem: () => { throw new Error('quota'); },
    setItem: () => { throw new Error('quota'); },
  };
  const reg = createClaimedDepositRegistry({ storage });
  reg.add('tx1'); // must not throw
  assert.equal(reg.has('tx1'), true, 'session still protected');
});

test('custom storage key is honored', () => {
  const storage = fakeStorage();
  const reg = createClaimedDepositRegistry({ storage, key: 'custom_key' });
  reg.add('tx1');
  assert.ok(storage.data.custom_key.includes('tx1'));
  assert.equal(CLAIMED_DEPOSITS_STORAGE_KEY in storage.data, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
