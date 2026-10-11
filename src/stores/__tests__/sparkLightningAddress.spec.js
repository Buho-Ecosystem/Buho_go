/**
 * Lightning addresses across several Spark wallets: every wallet keeps one,
 * one assignment at a time per wallet, server-side changes are followed,
 * and an address can move from one wallet to another without leaving
 * either without an address.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness, PHRASE, tick } from './sparkWalletHarness.js';

async function twoWallets(options) {
  const h = createHarness(options);
  const main = await h.store.createSparkWallet({ mnemonic: PHRASE });
  const savings = await h.store.addSparkWallet({ name: 'Savings' });
  await tick();
  return { ...h, main, savings };
}

const address = (h, wallet) => h.store.walletInfos[wallet.id]?.lightningAddress || wallet.metadata?.lud16;

test('every Spark wallet gets its own address on connect', async () => {
  const h = await twoWallets();
  assert.equal(address(h, h.main), 'random1@btc.example.com');
  assert.equal(address(h, h.savings), 'random2@btc.example.com');
});

test('moving an address hands it to the other wallet and gives the source a fresh one', async () => {
  const h = await twoWallets();
  const result = await h.store.moveSparkLightningAddress(h.main.id, h.savings.id);
  assert.equal(result.moved, 'random1@btc.example.com');
  assert.equal(address(h, h.savings), 'random1@btc.example.com', 'the target now receives at the moved name');
  assert.equal(h.savings.metadata.lud16, 'random1@btc.example.com');
  assert.equal(result.sourceAddress, 'random3@btc.example.com');
  assert.equal(address(h, h.main), 'random3@btc.example.com', 'the source is never left without an address');
  assert.equal(h.server.byPubkey.get('pk-1'), 'random3');
  assert.equal(h.server.byPubkey.get('pk-2'), 'random1');
  assert.equal(h.saved().wallets.find((w) => w.id === h.main.id).metadata.lud16, 'random3@btc.example.com');
});

test('when the source cannot get its new address yet, it shows none rather than the moved one', async () => {
  const h = await twoWallets();
  h.server.offlineFor = 'pk-1';
  const result = await h.store.moveSparkLightningAddress(h.main.id, h.savings.id);
  assert.equal(result.sourceAddress, null);
  assert.ok(!address(h, h.main), 'the moved name is shown on the wallet that holds it only');
  assert.equal(h.saved().wallets.find((w) => w.id === h.main.id).metadata.lud16, undefined, 'never reclaimed on the next connect');
  h.server.offlineFor = null;
  await h.store.noteSparkLightningAddress(h.main.id, null);
  assert.equal(address(h, h.main), 'random3@btc.example.com');
});

test('a refused transfer changes nothing', async () => {
  const h = await twoWallets();
  h.server.failClaim = true;
  await assert.rejects(() => h.store.moveSparkLightningAddress(h.main.id, h.savings.id), (e) => e.code === 'LN_ADDRESS_TRANSFER_FAILED');
  assert.equal(address(h, h.main), 'random1@btc.example.com');
  assert.equal(address(h, h.savings), 'random2@btc.example.com');
  h.server.failClaim = false;
  await h.store.moveSparkLightningAddress(h.main.id, h.savings.id);
  assert.equal(address(h, h.savings), 'random1@btc.example.com', 'a retry works');
});

test('a move needs two different, connected Spark wallets and an address to move', async () => {
  const h = await twoWallets();
  await assert.rejects(() => h.store.moveSparkLightningAddress(h.main.id, h.main.id), (e) => e.code === 'LN_ADDRESS_INVALID_TARGET');
  await assert.rejects(() => h.store.moveSparkLightningAddress(h.main.id, 'missing'), (e) => e.code === 'LN_ADDRESS_INVALID_TARGET');
  h.server.byPubkey.delete('pk-1');
  await assert.rejects(() => h.store.moveSparkLightningAddress(h.main.id, h.savings.id), (e) => e.code === 'LN_ADDRESS_NONE');
  h.store.providers[h.savings.id].isConnected = false;
  h.store.connectSparkWallet = async () => {};
  await assert.rejects(() => h.store.moveSparkLightningAddress(h.main.id, h.savings.id), (e) => e.code === 'LN_ADDRESS_NOT_CONNECTED');
});

test('change events for wallets in the middle of a move are left to the move', async () => {
  const h = await twoWallets();
  let release;
  h.server.claimGate = new Promise((resolve) => { release = resolve; });
  const moving = h.store.moveSparkLightningAddress(h.main.id, h.savings.id);
  await tick();
  const before = h.server.ensures;
  await h.store.noteSparkLightningAddress(h.main.id, null);
  await h.store.noteSparkLightningAddress(h.savings.id, 'stale@btc.example.com');
  assert.equal(h.server.ensures, before, 'no second assignment raced the move');
  assert.equal(address(h, h.savings), 'random2@btc.example.com', 'nothing recorded while the move runs');
  release();
  await moving;
  assert.equal(address(h, h.savings), 'random1@btc.example.com');
  assert.equal(address(h, h.main), 'random3@btc.example.com');
});

test('an address the server takes away is replaced; one it reports is recorded', async () => {
  const h = await twoWallets();
  h.server.byPubkey.delete('pk-2');
  await h.store.noteSparkLightningAddress(h.savings.id, null);
  assert.equal(address(h, h.savings), 'random3@btc.example.com', 'a fresh name, never the one that left');
  await h.store.noteSparkLightningAddress(h.savings.id, 'chosen@btc.example.com');
  assert.equal(address(h, h.savings), 'chosen@btc.example.com');
});

test('two assignments for one wallet at once run as one', async () => {
  const h = await twoWallets();
  h.server.byPubkey.delete('pk-1');
  const before = h.server.ensures;
  const [a, b] = await Promise.all([
    h.store._ensureSparkLightningAddress(h.main.id, { previousAddress: null }),
    h.store._ensureSparkLightningAddress(h.main.id, { previousAddress: null }),
  ]);
  assert.equal(h.server.ensures - before, 1);
  assert.equal(a, b);
});
