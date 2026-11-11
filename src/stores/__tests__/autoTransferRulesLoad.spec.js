/**
 * What the wallet store tells Auto-Transfer when the rules load: which
 * wallets the phone still holds, or nothing when it cannot be sure. A rule
 * whose wallet is not held is deleted, so "not sure" must never look like
 * "not held".
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness } from './sparkWalletHarness.js';

const URL_A = `nostr+walletconnect://${'a1'.repeat(32)}?relay=wss%3A%2F%2Frelay.example&secret=${'5e'.repeat(32)}`;
const SAVED = JSON.stringify({ wallets: [{ id: 'hub', type: 'nwc', name: 'Hub', nwcUrl: URL_A, metadata: {} }], activeWalletId: 'hub' });

async function start(storage, prepare = () => {}) {
  const harness = createHarness({ storage });
  harness.store.connectWallet = async () => null; // no relay in a unit test
  prepare(harness.store);
  await harness.store.initialize();
  return harness;
}

test('held: the list, wallets set aside as unusable, and Spark entries set aside by the migration', async () => {
  const { calls } = await start({
    buhoGO_wallet_store: SAVED,
    buhoGO_spark_set_aside_v1: JSON.stringify([{ reason: 'other-phrase', at: 1, wallet: { id: 'spark-aside' } }]),
  }, (store) => {
    store.validateWallets = async function () { this._unusableWallets = [{ id: 'broken' }]; };
  });
  assert.equal(calls.rulesLoaded.length, 1);
  assert.deepEqual([...calls.rulesLoaded[0].heldWalletIds].sort(), ['broken', 'hub', 'spark-aside']);
});

test('an unreadable wallet list leaves the rules alone, on that start and every later one', async () => {
  const first = await start({ buhoGO_wallet_store: '{not json' });
  assert.equal(first.calls.rulesLoaded[0].heldWalletIds, null);

  // The next start finds no list, only the copy set aside.
  const kept = Object.fromEntries(first.local.map);
  assert.equal(kept.buhoGO_wallet_store, undefined);
  const second = await start(kept);
  assert.equal(second.calls.rulesLoaded[0].heldWalletIds, null);

  // Even once there is a new list: the set-aside wallets may come back.
  const third = await start({ ...kept, buhoGO_wallet_store: SAVED });
  assert.equal(third.calls.rulesLoaded[0].heldWalletIds, null);
});

test('with no saved wallet list at all, nothing is settled', async () => {
  const { calls } = await start({});
  assert.equal(calls.rulesLoaded[0].heldWalletIds, null);
});
