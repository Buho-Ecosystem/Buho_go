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
  await tick(); // the queued invalidations are checked after the move lock releases
  assert.equal(address(h, h.savings), 'random1@btc.example.com');
  assert.ok(address(h, h.main));
  assert.notEqual(address(h, h.main), address(h, h.savings));
});

test('an address the server takes away is replaced; one it reports is recorded', async () => {
  const h = await twoWallets();
  h.server.byPubkey.delete('pk-2');
  await h.store.noteSparkLightningAddress(h.savings.id, null);
  assert.ok(address(h, h.savings), 'a confirmed replacement is assigned');
  assert.notEqual(address(h, h.savings), 'random2@btc.example.com', 'the address that left is not reclaimed');
  h.server.byPubkey.set('pk-2', 'chosen');
  await h.store.noteSparkLightningAddress(h.savings.id, 'chosen@btc.example.com');
  assert.equal(address(h, h.savings), 'chosen@btc.example.com');
});

test('two assignments for one wallet at once run as one', async () => {
  const h = await twoWallets();
  h.server.byPubkey.delete('pk-1');
  const provider = h.store.providers[h.main.id];
  const register = provider.registerLightningAddress.bind(provider);
  let registrations = 0;
  provider.registerLightningAddress = async username => { registrations += 1; return register(username); };
  const [a, b] = await Promise.all([
    h.store._ensureSparkLightningAddress(h.main.id, { previousAddress: null }),
    h.store._ensureSparkLightningAddress(h.main.id, { previousAddress: null }),
  ]);
  assert.equal(registrations, 1);
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

test('a delayed old SDK event cannot roll back a freshly confirmed rename', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  await h.store.renameSparkLightningAddress(h.main.id, 'renamed', { expectedAddress: previous });
  await h.store.noteSparkLightningAddress(h.main.id, previous);
  assert.equal(address(h, h.main), 'renamed@btc.example.com');
  assert.equal(h.server.byPubkey.get('pk-1'), 'renamed');
});

test('a delayed destination event cannot restore its inactive pre-transfer address', async () => {
  const h = await twoWallets();
  const previous = address(h, h.savings);
  const result = await h.store.moveSparkLightningAddress(h.main.id, h.savings.id);
  await h.store.noteSparkLightningAddress(h.savings.id, previous);
  assert.equal(address(h, h.savings), result.moved);
  assert.equal(h.server.byPubkey.get('pk-2'), result.moved.split('@')[0]);
});

test('a delayed null event never makes the real provider replace an active name', async () => {
  const h = await twoWallets();
  // The real provider deliberately skips its cached getter after it is told
  // there is no address. The old event handler did exactly that, then caused
  // ensureLightningAddress to allocate another name without a server read.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network disabled under test'); };
  const { BreezSparkWalletProvider } = await import('../../providers/BreezSparkWalletProvider.js');
  const { fiatRatesService } = await import('../../utils/fiatRates.js');
  fiatRatesService.stopAutoUpdate();
  await fiatRatesService.inflight?.catch(() => {});
  globalThis.fetch = originalFetch;
  const previous = address(h, h.main);
  let registrations = 0;
  const provider = new BreezSparkWalletProvider(h.main.id, { _testSdk: {
    getLightningAddress: async () => ({ lightningAddress: previous }),
    checkLightningAddressAvailable: async () => true,
    registerLightningAddress: async ({ username }) => {
      registrations += 1;
      h.server.byPubkey.set('pk-1', username);
      return { lightningAddress: `${username}@btc.example.com`, username };
    },
  } });
  provider.isConnected = true;
  provider.noteLightningAddress({ lightningAddress: previous });
  h.store.providers[h.main.id] = provider;
  await h.store.noteSparkLightningAddress(h.main.id, null);
  assert.equal(registrations, 0);
  assert.equal(address(h, h.main), previous);
  assert.equal(h.server.byPubkey.get('pk-1'), previous.split('@')[0]);
});

test('failed event reconciliation withholds the cached address and preserves its retry candidate', async () => {
  const h = await twoWallets();
  await h.store._markSparkAddressPending([h.main.id], { username: 'intendedname' });
  h.server.lookupOffline = true;
  await assert.rejects(() => h.store.noteSparkLightningAddress(h.main.id, 'stale@btc.example.com'), /lookup failed/);
  assert.equal(address(h, h.main), null);
  const saved = h.saved().wallets.find(w => w.id === h.main.id).metadata;
  assert.equal(saved.lightningAddressPending, true);
  assert.equal(saved.lightningAddressRequestedUsername, 'intendedname');
  h.server.lookupOffline = false;
  await h.store.noteSparkLightningAddress(h.main.id, null);
  assert.equal(address(h, h.main), 'random1@btc.example.com');
});

test('a queued event with failed lookup keeps a completed mutation withheld until checked', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  const provider = h.store.providers[h.main.id];
  const register = provider.registerLightningAddress.bind(provider);
  provider.registerLightningAddress = async username => {
    const result = await register(username);
    await h.store.noteSparkLightningAddress(h.main.id, previous);
    h.server.lookupOffline = true;
    return result;
  };
  await h.store.renameSparkLightningAddress(h.main.id, 'renamed', { expectedAddress: previous });
  await tick();
  assert.equal(address(h, h.main), null);
  assert.equal(h.saved().wallets.find(w => w.id === h.main.id).metadata.lightningAddressPending, true);
  h.server.lookupOffline = false;
  await h.store.refreshSparkLightningAddress(h.main.id);
  assert.equal(address(h, h.main), 'renamed@btc.example.com');
});

test('every persisted post-transfer source state remains pending until its replacement is known', async () => {
  for (const loseClaimResponse of [false, true]) {
    const h = await twoWallets();
    h.server.loseClaimResponse = loseClaimResponse;
    const persist = h.store.persistState.bind(h.store);
    const snapshots = [];
    h.store.persistState = async options => {
      await persist(options);
      if (h.server.byPubkey.get('pk-2') === 'random1') snapshots.push(h.saved());
    };
    await h.store.moveSparkLightningAddress(h.main.id, h.savings.id);
    assert.ok(snapshots.length >= 3);
    for (const snapshot of snapshots) {
      const source = snapshot.wallets.find(w => w.id === h.main.id);
      if (!source.metadata.lud16) {
        assert.equal(source.metadata.lightningAddressPending, true, 'a restart must not trust the source SDK’s transferred-name cache');
      }
    }
  }
});

test('a startup null event joins an assignment already in progress without assigning twice', async () => {
  const h = await twoWallets();
  h.server.byPubkey.delete('pk-1');
  const provider = h.store.providers[h.main.id];
  const register = provider.registerLightningAddress.bind(provider);
  let release;
  let registrations = 0;
  const gate = new Promise(resolve => { release = resolve; });
  provider.registerLightningAddress = async username => {
    registrations += 1;
    await gate;
    return register(username);
  };
  const assignment = h.store._ensureSparkLightningAddress(h.main.id, { previousAddress: null });
  await tick();
  assert.equal(registrations, 1);
  const event = h.store.noteSparkLightningAddress(h.main.id, null);
  await tick();
  release();
  await Promise.all([assignment, event]);
  assert.equal(registrations, 1);
  assert.equal(address(h, h.main), `${h.server.byPubkey.get('pk-1')}@btc.example.com`);
});

test('queued events are reconciled before a successful mutation returns to its UI', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  const provider = h.store.providers[h.main.id];
  const register = provider.registerLightningAddress.bind(provider);
  provider.registerLightningAddress = async username => {
    const result = await register(username);
    await h.store.noteSparkLightningAddress(h.main.id, previous);
    return result;
  };
  const result = await h.store.renameSparkLightningAddress(h.main.id, 'renamed', { expectedAddress: previous });
  assert.equal(address(h, h.main), result.lightningAddress);
  assert.equal(h.main.metadata.lightningAddressPending, undefined);
});

test('an event whose persistence yields to an earlier refresh queues another authoritative check', async () => {
  const h = await twoWallets();
  const deferred = () => {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
  };
  const firstSave = deferred();
  const secondSave = deferred();
  const firstRead = deferred();
  const persist = h.store.persistState.bind(h.store);
  let saves = 0;
  let reads = 0;
  h.store.persistState = async options => {
    const save = ++saves;
    if (save === 1) await firstSave.promise;
    if (save === 2) await secondSave.promise;
    return persist(options);
  };
  h.store._readSparkLightningAddress = async () => {
    const username = h.server.byPubkey.get('pk-1');
    const info = { lightningAddress: `${username}@btc.example.com`, username };
    if (++reads === 1) await firstRead.promise;
    return info;
  };
  const earlier = h.store.noteSparkLightningAddress(h.main.id, 'first-event@btc.example.com');
  const later = h.store.noteSparkLightningAddress(h.main.id, 'later-event@btc.example.com');
  firstSave.release();
  await tick();
  assert.equal(reads, 1);
  h.server.byPubkey.set('pk-1', 'newest');
  secondSave.release();
  await later;
  firstRead.release();
  await earlier;
  assert.equal(reads, 2, 'the newer invalidation must not be lost to a busy refresh');
  assert.equal(address(h, h.main), 'newest@btc.example.com');
});

/** Simulate opening a new provider while its persisted SDK cache is older than app metadata. */
async function reopenedProvider(h, wallet, cachedAddress) {
  const { BreezSparkWalletProvider } = await import('../../providers/BreezSparkWalletProvider.js');
  const provider = new BreezSparkWalletProvider(wallet.id, { _testSdk: {
    getLightningAddress: async () => cachedAddress ? { lightningAddress: cachedAddress, username: cachedAddress.split('@')[0] } : null,
    checkLightningAddressAvailable: async () => true,
    registerLightningAddress: async ({ username }) => {
      h.server.byPubkey.set(`pk-${wallet.connectionData.accountNumber}`, username);
      return { lightningAddress: `${username}@btc.example.com`, username };
    },
  } });
  provider.isConnected = true;
  h.store.providers[wallet.id] = provider;
  return provider;
}

test('a new provider cannot restore an older SDK cache over a recovered persisted address', async () => {
  const h = await twoWallets();
  const older = address(h, h.main);
  h.server.byPubkey.set('pk-1', 'recovered');
  await h.store.refreshSparkLightningAddress(h.main.id);
  assert.equal(h.main.metadata.lightningAddressPending, undefined);
  await reopenedProvider(h, h.main, older);
  await h.store._ensureSparkLightningAddress(h.main.id);
  assert.equal(address(h, h.main), 'recovered@btc.example.com');
  assert.equal(h.saved().wallets.find(w => w.id === h.main.id).metadata.lud16, 'recovered@btc.example.com');
});

test('a new provider with cached absence does not replace the current server address', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  const provider = await reopenedProvider(h, h.main, null);
  provider.sdk.registerLightningAddress = async () => { assert.fail('cached absence cannot authorize replacement'); };
  await h.store._ensureSparkLightningAddress(h.main.id);
  assert.equal(address(h, h.main), previous);
  assert.equal(h.server.byPubkey.get('pk-1'), previous.split('@')[0]);
});

test('confirmed absence permits first claim but cannot resurrect an old SDK cache on reconnect', async () => {
  const h = await twoWallets();
  const older = address(h, h.main);
  h.server.byPubkey.delete('pk-1');
  assert.equal(await h.store.refreshSparkLightningAddress(h.main.id), null);
  assert.equal(h.main.metadata.lightningAddressPending, undefined, 'first claim remains permitted');
  assert.equal(h.saved().wallets.find(w => w.id === h.main.id).metadata.lightningAddressCheckedAbsent, true);
  const provider = await reopenedProvider(h, h.main, older);
  // Fail a fresh read: setup must not silently fall back to its stale SDK.
  h.server.lookupOffline = true;
  await assert.rejects(() => h.store._ensureSparkLightningAddress(h.main.id), /lookup failed/);
  assert.equal(address(h, h.main), null);
  h.server.lookupOffline = false;
  const result = await h.store.renameSparkLightningAddress(h.main.id, 'firstclaim', { expectedAddress: null });
  assert.equal(result.lightningAddress, 'firstclaim@btc.example.com');
  assert.equal(h.main.metadata.lightningAddressCheckedAbsent, undefined);
  assert.equal(address(h, h.main), result.lightningAddress);
  assert.equal((await provider.getLightningAddress()).lightningAddress, result.lightningAddress);
});

test('confirmed absence still permits reclaiming a remembered reserved name during recovery', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  h.server.byPubkey.delete('pk-1');
  await reopenedProvider(h, h.main, null);
  await h.store._ensureSparkLightningAddress(h.main.id);
  assert.equal(address(h, h.main), previous);
  assert.equal(h.server.byPubkey.get('pk-1'), previous.split('@')[0]);
});

test('an older cached read cannot overwrite a new epoch’s recovered assignment', async () => {
  const h = await twoWallets();
  const old = address(h, h.main);
  const provider = h.store.providers[h.main.id];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  provider.getLightningAddress = async () => { await gate; return { lightningAddress: old }; };
  provider.ensureLightningAddress = async () => { assert.fail('cancelled setup must not continue'); };
  const setup = h.store._ensureSparkLightningAddress(h.main.id);
  await tick();
  h.store._bumpWalletEpoch(h.main.id);
  h.server.byPubkey.set('pk-1', 'newer');
  await h.store.setSparkLightningAddress(h.main.id, 'newer@btc.example.com');
  release();
  await assert.rejects(() => setup, error => error.code === 'LN_ADDRESS_NOT_CONNECTED');
  assert.equal(address(h, h.main), 'newer@btc.example.com');
});

test('a provider replaced without an epoch change cannot finish its old setup', async () => {
  const h = await twoWallets();
  const old = address(h, h.main);
  const provider = h.store.providers[h.main.id];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  provider.getLightningAddress = async () => { await gate; return { lightningAddress: old }; };
  const setup = h.store._ensureSparkLightningAddress(h.main.id);
  await tick();
  h.store.providers[h.main.id] = { ...provider };
  release();
  await assert.rejects(() => setup, error => error.code === 'LN_ADDRESS_NOT_CONNECTED');
});

test('a late registration reply cannot overwrite a replacement provider’s assignment', async () => {
  const h = await twoWallets();
  const provider = h.store.providers[h.main.id];
  h.server.byPubkey.delete('pk-1');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const register = provider.registerLightningAddress.bind(provider);
  provider.registerLightningAddress = async username => {
    const result = await register(username);
    await gate;
    return result;
  };
  const setup = h.store._ensureSparkLightningAddress(h.main.id, { previousAddress: null });
  await tick();
  h.store._bumpWalletEpoch(h.main.id);
  h.store.providers[h.main.id] = { ...provider };
  h.server.byPubkey.set('pk-1', 'newer');
  await h.store.setSparkLightningAddress(h.main.id, 'newer@btc.example.com');
  release();
  await assert.rejects(() => setup, error => error.code === 'LN_ADDRESS_NOT_CONNECTED');
  assert.equal(address(h, h.main), 'newer@btc.example.com');
  assert.equal(h.saved().wallets.find(w => w.id === h.main.id).metadata.lud16, 'newer@btc.example.com');
});

test('an assignment awaiting a registration reply cannot resurrect a removed wallet', async () => {
  const h = await twoWallets();
  const provider = h.store.providers[h.main.id];
  h.server.byPubkey.delete('pk-1');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const register = provider.registerLightningAddress.bind(provider);
  provider.registerLightningAddress = async username => { const result = await register(username); await gate; return result; };
  const setup = h.store._ensureSparkLightningAddress(h.main.id, { previousAddress: null });
  await tick();
  await h.store._dropWalletEntry(h.main);
  await h.store.persistState();
  release();
  await assert.rejects(() => setup, error => error.code === 'LN_ADDRESS_NOT_CONNECTED');
  assert.ok(!h.store.wallets.includes(h.main));
  assert.ok(!h.saved().wallets.some(w => w.id === h.main.id));
});

test('an epoch change during pending persistence stops registration before submission', async () => {
  const h = await twoWallets();
  const provider = h.store.providers[h.main.id];
  h.server.byPubkey.delete('pk-1');
  const persist = h.store.persistState.bind(h.store);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  h.store.persistState = async options => {
    await persist(options);
    if (options?.requireDurable) await gate;
  };
  provider.registerLightningAddress = async () => { assert.fail('cancelled setup must not register'); };
  const setup = h.store._ensureSparkLightningAddress(h.main.id, { previousAddress: null });
  await tick();
  h.store._bumpWalletEpoch(h.main.id);
  release();
  await assert.rejects(() => setup, error => error.code === 'LN_ADDRESS_NOT_CONNECTED');
  assert.equal(h.server.byPubkey.get('pk-1'), undefined);
});

test('a new claim after confirmed absence carries the published profile from its previous address', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  const changes = [];
  h.store._syncProfilePaymentAddress = async change => { changes.push(change); };
  h.server.byPubkey.delete('pk-1');
  await h.store.refreshSparkLightningAddress(h.main.id);
  assert.equal(address(h, h.main), null);
  await h.store.renameSparkLightningAddress(h.main.id, 'replacement', { expectedAddress: null });
  assert.ok(changes.some(change => change.previousAddresses.includes(previous) && change.renamedTo === 'replacement@btc.example.com'));
});

test('reclaiming the same address after confirmed absence durably clears its absence marker', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  h.server.byPubkey.delete('pk-1');
  await h.store.refreshSparkLightningAddress(h.main.id);
  await h.store.renameSparkLightningAddress(h.main.id, previous.split('@')[0], { expectedAddress: null });
  assert.equal(address(h, h.main), previous);
  assert.equal(h.saved().wallets.find(w => w.id === h.main.id).metadata.lightningAddressCheckedAbsent, undefined);
});

test('a legacy wallet with no remembered name cannot trust cached absence over an active server address', async () => {
  const h = await twoWallets();
  const previous = address(h, h.main);
  delete h.main.metadata.lud16;
  const provider = await reopenedProvider(h, h.main, null);
  provider.sdk.registerLightningAddress = async () => { assert.fail('unknown cached absence must be checked before registration'); };
  await h.store._ensureSparkLightningAddress(h.main.id);
  assert.equal(address(h, h.main), previous);
  assert.equal(h.server.byPubkey.get('pk-1'), previous.split('@')[0]);
});
