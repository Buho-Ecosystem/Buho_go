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

const address = (h, wallet) => h.store.lightningAddressOf(wallet);

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
  assert.ok(result.sourceAddress && result.sourceAddress !== result.moved);
  assert.equal(address(h, h.main), result.sourceAddress, 'the source gets the confirmed fresh address');
  assert.equal(h.server.byPubkey.get('pk-1'), result.sourceAddress.split('@')[0]);
  assert.equal(h.server.byPubkey.get('pk-2'), 'random1');
  assert.equal(h.saved().wallets.find((w) => w.id === h.main.id).metadata.lud16, result.sourceAddress);
});

test('when the source cannot get its new address yet, it shows none rather than the moved one', async () => {
  const h = await twoWallets();
  h.server.failRegistrationFor = 'pk-1';
  const result = await h.store.moveSparkLightningAddress(h.main.id, h.savings.id);
  assert.equal(result.sourceAddress, null);
  assert.ok(!address(h, h.main), 'the moved name is shown on the wallet that holds it only');
  assert.equal(h.saved().wallets.find((w) => w.id === h.main.id).metadata.lud16, undefined, 'never reclaimed on the next connect');
  h.server.failRegistrationFor = null;
  await h.store._ensureSparkLightningAddress(h.main.id);
  assert.ok(address(h, h.main));
  assert.notEqual(address(h, h.main), result.moved);
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
  assert.equal(address(h, h.savings), null, 'an in-flight assignment is not shared as verified');
  release();
  await moving;
  assert.equal(address(h, h.savings), 'random1@btc.example.com');
  assert.ok(address(h, h.main));
  assert.notEqual(address(h, h.main), address(h, h.savings));
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

test('a transfer committed before its reply was lost is reconciled as success', async () => {
  const h = await twoWallets();
  h.server.loseClaimResponse = true;
  // SDK-facing cached reads are deliberately wrong. Reconciliation must use
  // the independent server lookup, not either live provider's cached getter.
  h.store.providers[h.savings.id].getLightningAddress = async () => ({ lightningAddress: 'random2@btc.example.com' });
  const result = await h.store.moveSparkLightningAddress(h.main.id, h.savings.id);
  assert.equal(result.moved, 'random1@btc.example.com');
  assert.equal(address(h, h.savings), result.moved);
  assert.notEqual(address(h, h.main), result.moved);
});

test('unknown transfer outcomes remain hidden and durable until a fresh check succeeds', async () => {
  const h = await twoWallets();
  const provider = h.store.providers[h.savings.id];
  const claim = provider.claimLightningAddressTransfer.bind(provider);
  provider.claimLightningAddressTransfer = async (authorization) => {
    await claim(authorization);
    h.server.lookupOffline = true;
    throw new Error('response lost');
  };
  await assert.rejects(() => h.store.moveSparkLightningAddress(h.main.id, h.savings.id), e => e.code === 'LN_ADDRESS_UNCONFIRMED');
  for (const wallet of [h.main, h.savings]) {
    assert.equal(address(h, wallet), null);
    assert.equal(h.saved().wallets.find(w => w.id === wallet.id).metadata.lightningAddressPending, true);
  }
  h.server.lookupOffline = false;
  await h.store.refreshSparkLightningAddress(h.savings.id);
  await h.store._ensureSparkLightningAddress(h.main.id);
  assert.equal(address(h, h.savings), 'random1@btc.example.com');
  assert.ok(address(h, h.main));
  assert.notEqual(address(h, h.main), address(h, h.savings));
});

test('a rename with a lost success reply follows the server and updates the saved address', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  h.server.loseRegistrationResponse = true;
  const result = await h.store.renameSparkLightningAddress(h.main.id, 'newname', { expectedAddress: previous });
  assert.equal(result.lightningAddress, 'newname@btc.example.com');
  assert.equal(address(h, h.main), result.lightningAddress);
  assert.equal(h.saved().wallets.find(w => w.id === h.main.id).metadata.lightningAddressPending, undefined);
});

test('a failed lookup cannot start a rename or erase the last known assignment', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  h.server.lookupOffline = true;
  await assert.rejects(() => h.store.renameSparkLightningAddress(h.main.id, 'newname', { expectedAddress: previous }), /lookup failed/);
  assert.equal(address(h, h.main), previous);
  assert.equal(h.server.byPubkey.get('pk-1'), 'random1');
});

test('an unconfirmed rename hides the old address and is recovered after reconnect', async () => {
  const h = await twoWallets();
  const provider = h.store.providers[h.main.id];
  const register = provider.registerLightningAddress.bind(provider);
  provider.registerLightningAddress = async (username) => {
    await register(username);
    h.server.lookupOffline = true;
    throw new Error('reply lost');
  };
  await assert.rejects(() => h.store.renameSparkLightningAddress(h.main.id, 'newname', { expectedAddress: address(h, h.main) }), e => e.code === 'LN_ADDRESS_UNCONFIRMED');
  assert.equal(address(h, h.main), null);
  h.server.lookupOffline = false;
  await h.store._ensureSparkLightningAddress(h.main.id);
  assert.equal(address(h, h.main), 'newname@btc.example.com');
});

test('rate limiting is actionable and leaves the confirmed current address available', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  h.store.providers[h.main.id].registerLightningAddress = async () => { throw new Error('Network error (status 429)'); };
  await assert.rejects(() => h.store.renameSparkLightningAddress(h.main.id, 'newname', { expectedAddress: previous }), e => e.code === 'LN_ADDRESS_RATE_LIMITED');
  assert.equal(address(h, h.main), previous);
});

test('a rename cannot overwrite an address changed since the person reviewed it', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  h.server.byPubkey.set('pk-1', 'elsewhere');
  await assert.rejects(() => h.store.renameSparkLightningAddress(h.main.id, 'newname', { expectedAddress: previous }), e => e.code === 'LN_ADDRESS_CHANGED');
  assert.equal(address(h, h.main), 'elsewhere@btc.example.com');
  assert.equal(h.server.byPubkey.get('pk-1'), 'elsewhere');
});

test('renames, moves, and automatic setup cannot overlap on the same wallet', async () => {
  const h = await twoWallets();
  let release;
  h.server.lookupGate = new Promise(resolve => { release = resolve; });
  const renaming = h.store.renameSparkLightningAddress(h.main.id, 'newname', { expectedAddress: address(h, h.main) });
  await tick();
  await assert.rejects(() => h.store.moveSparkLightningAddress(h.main.id, h.savings.id), e => e.code === 'LN_ADDRESS_BUSY');
  await assert.rejects(() => h.store.renameSparkLightningAddress(h.main.id, 'another'), e => e.code === 'LN_ADDRESS_BUSY');
  assert.equal(await h.store._ensureSparkLightningAddress(h.main.id), null);
  release();
  await renaming;
  assert.equal(address(h, h.main), 'newname@btc.example.com');
});

test('address changes stop before submission when the pending state cannot be saved', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  h.local.setItem = () => { throw new Error('disk full'); };
  await assert.rejects(() => h.store.renameSparkLightningAddress(h.main.id, 'newname', { expectedAddress: previous }), /disk full/);
  assert.equal(h.server.byPubkey.get('pk-1'), 'random1');
  assert.equal(address(h, h.main), previous, 'no mutation was sent, so the confirmed address remains usable');
});

test('a recovered transfer carries the destination profile from its previous address', async () => {
  const h = await twoWallets();
  const changes = [];
  h.store._syncProfilePaymentAddress = async change => { changes.push(change); };
  h.server.loseClaimResponse = true;
  await h.store.moveSparkLightningAddress(h.main.id, h.savings.id);
  assert.ok(changes.some(change => change.previousAddresses.includes('random2@btc.example.com') && change.renamedTo === 'random1@btc.example.com'));
});

test('transfer authorization is produced from the freshly recovered registration, not the stale live SDK', async () => {
  const h = await twoWallets();
  h.server.byPubkey.set('pk-1', 'changedelsewhere');
  h.store.providers[h.main.id].authorizeLightningAddressTransfer = async () => { assert.fail('the live SDK would sign its stale name'); };
  const result = await h.store.moveSparkLightningAddress(h.main.id, h.savings.id);
  assert.equal(result.moved, 'changedelsewhere@btc.example.com');
  assert.equal(address(h, h.savings), result.moved);
});

test('a fresh lookup can reconcile a move from another device despite the previous owner’s stale local address', async () => {
  const h = await twoWallets();
  h.server.byPubkey.delete('pk-1');
  h.server.byPubkey.set('pk-2', 'random1');
  await h.store.refreshSparkLightningAddress(h.savings.id);
  assert.equal(address(h, h.savings), 'random1@btc.example.com');
  assert.equal(address(h, h.main), null);
  await h.store._ensureSparkLightningAddress(h.main.id);
  assert.ok(address(h, h.main));
  assert.notEqual(address(h, h.main), address(h, h.savings));
});

test('automatic recovery retries the persisted candidate instead of consuming another name', async () => {
  const h = await twoWallets();
  h.server.byPubkey.delete('pk-1');
  await h.store._markSparkAddressPending([h.main.id], { username: 'intendedname' });
  await h.store._ensureSparkLightningAddress(h.main.id);
  assert.equal(address(h, h.main), 'intendedname@btc.example.com');
  assert.equal(h.main.metadata.lightningAddressRequestedUsername, undefined);
});
