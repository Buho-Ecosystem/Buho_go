/**
 * The Spark multi-wallet model in the real store: one recovery phrase, up to
 * six equal wallets (accounts 0..5), one at onboarding. Covers creation,
 * adding, restore and resumable discovery, removal rules, renaming, and the
 * one-time migration of saved pairs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness, savedSpark, PHRASE, OTHER_PHRASE, tick } from './sparkWalletHarness.js';

const accounts = (store) => store.sparkWallets.map((w) => w.connectionData.accountNumber);

// ---- Create & add ---------------------------------------------------------

test('a new install gets exactly one Spark wallet, on account 1, and lands in it', async () => {
  const { store, saved } = createHarness();
  const wallet = await store.createSparkWallet({ mnemonic: PHRASE });
  assert.deepEqual(accounts(store), [1]);
  assert.equal(wallet.name, 'Wallet');
  assert.equal(store.activeWalletId, wallet.id);
  assert.equal(wallet.isDefault, true);
  assert.equal(wallet.metadata.hasBackedUp, false, 'a fresh phrase is not backed up yet');
  assert.equal(wallet.connectionData.walletGroupId, undefined, 'no pairing');
  assert.equal(saved().wallets.length, 1);
  assert.equal(saved().sparkModelVersion, 2);
  await assert.rejects(() => store.createSparkWallet({ mnemonic: PHRASE }), (e) => e.code === 'SPARK_WALLET_EXISTS');
});

test('adding wallets fills accounts 2..5 then 0, refuses a seventh, and switches to each new one', async () => {
  const { store } = createHarness();
  await store.createSparkWallet({ mnemonic: PHRASE });
  for (const name of ['Savings', 'Shop', 'Family', 'Travel', 'Gifts']) {
    const wallet = await store.addSparkWallet({ name });
    assert.equal(store.activeWalletId, wallet.id);
  }
  assert.deepEqual(accounts(store), [1, 2, 3, 4, 5, 0]);
  assert.equal(store.canAddSparkWallet, false);
  assert.equal(store.remainingSparkSlots, 0);
  await assert.rejects(() => store.addSparkWallet({ name: 'Seventh' }), (e) => e.code === 'SPARK_WALLET_LIMIT');
  const envelopes = new Set(store.sparkWallets.map((w) => w.connectionData.encryptedMnemonic));
  assert.equal(envelopes.size, 6, 'each entry holds its own envelope of the same phrase');
});

test('an added wallet needs a unique, non-empty name of at most 32 characters', async () => {
  const { store } = createHarness();
  await store.createSparkWallet({ mnemonic: PHRASE });
  await assert.rejects(() => store.addSparkWallet({ name: '   ' }), (e) => e.code === 'WALLET_NAME_EMPTY');
  await assert.rejects(() => store.addSparkWallet({ name: ' wallet ' }), (e) => e.code === 'WALLET_NAME_TAKEN');
  await assert.rejects(() => store.addSparkWallet({ name: 'x'.repeat(33) }), (e) => e.code === 'WALLET_NAME_TOO_LONG');
  const wallet = await store.addSparkWallet({ name: '  Rainy   day ' });
  assert.equal(wallet.name, 'Rainy day');
  await assert.rejects(() => store.addSparkWallet({ name: 'Savings' }).then(() => store.addSparkWallet({ name: 'SAVINGS' })), (e) => e.code === 'WALLET_NAME_TAKEN');
});

test('two adds at once never claim the same account', async () => {
  const { store } = createHarness();
  await store.createSparkWallet({ mnemonic: PHRASE });
  await Promise.all([store.addSparkWallet({ name: 'A' }), store.addSparkWallet({ name: 'B' }), store.addSparkWallet({ name: 'C' })]);
  assert.deepEqual(accounts(store).sort(), [1, 2, 3, 4]);
});

test('a wallet that cannot connect is not added, and nothing is left behind', async () => {
  let fail = false;
  const { store, calls } = createHarness({ connect: () => { if (fail) throw new Error('offline'); } });
  await store.createSparkWallet({ mnemonic: PHRASE });
  fail = true;
  await assert.rejects(() => store.addSparkWallet({ name: 'Savings' }), /offline/);
  assert.deepEqual(accounts(store), [1]);
  assert.equal(calls.deletedStorage.length, 1, 'the half-built engine storage is deleted');
  fail = false;
  const wallet = await store.addSparkWallet({ name: 'Savings' });
  assert.equal(wallet.connectionData.accountNumber, 2, 'the account is still free');
});

test('new wallets on a phrase already backed up count as backed up', async () => {
  const { store } = createHarness();
  await store.createSparkWallet({ mnemonic: PHRASE });
  await store.confirmBackup(store.sparkWallets[0].id);
  const wallet = await store.addSparkWallet({ name: 'Savings' });
  assert.equal(wallet.metadata.hasBackedUp, true);
});

// ---- Restore & discovery --------------------------------------------------

const used = (extra = {}) => ({ balanceSats: 0, paymentCount: 1, hasUnclaimedDeposit: false, lightningAddress: null, synced: true, ...extra });

test('restoring a phrase brings back account 1 at once and every used account in the background', async () => {
  const { store, calls } = createHarness({ evidence: { 2: used(), 4: used({ balanceSats: 0, paymentCount: 0, lightningAddress: 'kept@example.com' }), 0: used({ balanceSats: 500, paymentCount: 0 }) } });
  const { wallet, merged } = await store.restoreSparkWallets({ mnemonic: PHRASE });
  assert.equal(merged, false);
  assert.equal(wallet.connectionData.accountNumber, 1);
  assert.equal(store.activeWalletId, wallet.id);
  assert.equal(wallet.metadata.hasBackedUp, true);
  await store.discoverSparkAccounts();
  assert.deepEqual(accounts(store), [1, 2, 4, 0]);
  assert.deepEqual(calls.probes.sort(), [0, 2, 3, 4, 5]);
  assert.equal(store.sparkDiscovery, null, 'every account was checked');
  assert.equal(store.sparkDiscoveryFound.count, 3);
  assert.equal(store.activeWalletId, wallet.id, 'discovery never moves the person');
  assert.ok(store.sparkWallets.every((w) => w.metadata.hasBackedUp));
});

test('an account that could not be checked stays queued across restarts, then is given up', async () => {
  const offline = new Error('offline');
  const evidence = { 2: offline, 3: { ...used({ paymentCount: 0 }), synced: false } };
  const h = createHarness({ evidence });
  await h.store.restoreSparkWallets({ mnemonic: PHRASE });
  await h.store.discoverSparkAccounts();
  assert.deepEqual(h.store.sparkDiscovery.pending, [2, 3], 'thrown and unsynced-empty are inconclusive');
  assert.deepEqual(h.saved().sparkDiscovery.pending, [2, 3], 'persisted for the next start');
  evidence[2] = used();
  await h.store.discoverSparkAccounts();
  assert.deepEqual(accounts(h.store), [1, 2]);
  assert.deepEqual(h.store.sparkDiscovery.pending, [3]);
  for (let i = 0; i < 5; i += 1) await h.store.discoverSparkAccounts();
  assert.equal(h.store.sparkDiscovery, null, 'after the attempt limit the rest is left to Add wallet');
});

test('a restore that lists wallets creates them with their names, then looks for the rest', async () => {
  const { store, calls } = createHarness({ evidence: { 5: used() } });
  const { added } = await store.restoreSparkWallets({ mnemonic: PHRASE, accounts: [{ accountNumber: 3, name: 'Shop' }, { accountNumber: 1, name: 'Main' }, { accountNumber: 9, name: 'Bad' }] });
  assert.deepEqual(added.map((w) => [w.connectionData.accountNumber, w.name]), [[1, 'Main'], [3, 'Shop']]);
  assert.equal(store.connectionStates[added[0].id]?.connected, true, 'the first wallet proves the phrase before the restore returns');
  assert.equal(store.connectionStates[added[1].id], undefined, 'the others do not hold up the restore');
  assert.ok(calls.reconciled.includes(added[1].id), 'the lifecycle connects them in the background');
  await store.discoverSparkAccounts();
  assert.deepEqual(accounts(store), [1, 3, 5]);
});

test('restoring the phrase already on the device adds only what is missing; another phrase is refused', async () => {
  const { store } = createHarness({ evidence: { 3: used() } });
  await store.createSparkWallet({ mnemonic: PHRASE });
  await store.addSparkWallet({ name: 'Savings' });
  const result = await store.restoreSparkWallets({ mnemonic: ` ${PHRASE.toUpperCase()} ` });
  assert.equal(result.merged, true);
  await store.discoverSparkAccounts();
  assert.deepEqual(accounts(store), [1, 2, 3]);
  await assert.rejects(() => store.restoreSparkWallets({ mnemonic: OTHER_PHRASE }), (e) => e.code === 'SPARK_OTHER_PHRASE');
  assert.deepEqual(accounts(store), [1, 2, 3]);
});

test('discovery started for one phrase never adds wallets after that phrase left the device', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = createHarness({ evidence: { 2: async () => { await gate; return used(); } } });
  await h.store.restoreSparkWallets({ mnemonic: PHRASE });
  h.store.sparkDiscovery = { pending: [2], attempts: 0, names: {} };
  const running = h.store.discoverSparkAccounts();
  await tick();
  // While the probe for account 2 is in flight, the phrase goes and another arrives.
  await h.store.removeSparkFromDevice();
  await h.store.createSparkWallet({ mnemonic: OTHER_PHRASE });
  release();
  assert.deepEqual(await running, []);
  assert.deepEqual(accounts(h.store), [1], 'nothing of the old phrase joined the new one');
});

test('a cloud restore does not count as having written the phrase down', async () => {
  const { store } = createHarness({ evidence: { 2: used() } });
  const { wallet } = await store.restoreSparkWallets({ mnemonic: PHRASE, phraseConfirmed: false, accounts: [{ accountNumber: 1 }, { accountNumber: 2 }] });
  assert.equal(wallet.metadata.hasBackedUp, false);
  assert.equal(store.hasBackedUp, false);
  assert.ok(store.sparkWallets.every((w) => !w.metadata.hasBackedUp));
});

test('accounts queued while a discovery run is scanning are not lost when it finishes', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = createHarness({ evidence: { 2: async () => { await gate; return used({ paymentCount: 0 }); }, 4: used() } });
  await h.store.createSparkWallet({ mnemonic: PHRASE });
  h.store.sparkDiscovery = { pending: [2], attempts: 0, names: {} };
  const running = h.store.discoverSparkAccounts();
  await tick();
  // A merge restore re-plans meanwhile.
  await h.store.restoreSparkWallets({ mnemonic: PHRASE });
  assert.deepEqual(h.store.sparkDiscovery.pending, [2, 3, 4, 5, 0]);
  release();
  await running;
  await tick();
  await h.store.discoverSparkAccounts();
  assert.deepEqual(accounts(h.store), [1, 4], 'the newer plan was scanned too');
});

// ---- Removal --------------------------------------------------------------

test('removing one Spark wallet keeps every other wallet and clears what belonged to it', async () => {
  const h = createHarness();
  await h.store.createSparkWallet({ mnemonic: PHRASE });
  const savings = await h.store.addSparkWallet({ name: 'Savings' });
  h.store.wallets.push({ id: 'N', type: 'nwc', name: 'Alby', connectionData: {}, metadata: {} });
  h.store.kioskWalletId = savings.id;
  await h.store.removeWallet(savings.id);
  assert.deepEqual(h.store.wallets.map((w) => w.name), ['Wallet', 'Alby']);
  assert.equal(h.store.kioskWalletId, null, 'the kiosk no longer points at a removed wallet');
  assert.ok(h.calls.removedConfigs.includes(savings.id));
  assert.ok(h.calls.kitsRemoved.includes(savings.id));
  assert.ok(h.calls.preserved.includes(savings.id), 'the exit kit is exported before the databases go');
  assert.ok(h.calls.deletedStorage.includes(savings.id));
  assert.equal(h.store.activeWalletId, h.store.sparkWallets[0].id, 'selection stays on Spark');
  assert.equal(h.saved().wallets.length, 2, 'the shorter list is saved');
  const again = await h.store.addSparkWallet({ name: 'Savings again' });
  assert.equal(again.connectionData.accountNumber, 2, 'the freed account comes back');
});

test('a wallet holding money, receiving a deposit or exiting is not removed', async () => {
  const h = createHarness();
  await h.store.createSparkWallet({ mnemonic: PHRASE });
  const savings = await h.store.addSparkWallet({ name: 'Savings' });
  h.setBalance(savings.id, 2500);
  assert.deepEqual(h.store.removalCheckFor(savings.id).blockers, ['has_balance']);
  await assert.rejects(() => h.store.removeWallet(savings.id), (e) => e.code === 'WALLET_REMOVAL_BLOCKED' && e.blockers.includes('has_balance'));
  h.setBalance(savings.id, 0);
  h.store.pendingDepositsByWallet[savings.id] = [{ txId: 'abc' }];
  assert.deepEqual(h.store.removalCheckFor(savings.id).blockers, ['deposit_pending']);
  h.store.pendingDepositsByWallet[savings.id] = [];
  h.exits[savings.id] = { walletId: savings.id, stage: 'unlock' };
  assert.deepEqual(h.store.removalCheckFor(savings.id).blockers, ['exit_in_progress']);
  h.exits[savings.id] = { walletId: savings.id, stage: 'done' };
  assert.equal(h.store.removalCheckFor(savings.id).allowed, true, 'a finished exit no longer blocks');
  assert.equal(h.store.sparkWallets.length, 2);
});

test('the last Spark wallet goes only with a backed-up phrase, unless it is empty', async () => {
  const h = createHarness();
  const wallet = await h.store.createSparkWallet({ mnemonic: PHRASE });
  h.setBalance(wallet.id, 900);
  const check = h.store.removalCheckFor(wallet.id);
  assert.deepEqual(check.blockers, ['needs_backup']);
  assert.ok(check.notes.includes('last_spark_wallet'));
  await h.store.confirmBackup(wallet.id);
  assert.equal(h.store.removalCheckFor(wallet.id).allowed, true);
  await h.store.removeWallet(wallet.id);
  assert.equal(h.store.sparkWallets.length, 0);
  assert.equal(h.store.hasBackedUp, false, 'the backup state left with the phrase');

  const empty = createHarness();
  const fresh = await empty.store.createSparkWallet({ mnemonic: PHRASE });
  assert.equal(empty.store.removalCheckFor(fresh.id).allowed, true, 'an empty, never backed up wallet may go');
});

test('Spark leaves the device in one step under the last-wallet rules', async () => {
  const h = createHarness();
  await h.store.createSparkWallet({ mnemonic: PHRASE });
  const savings = await h.store.addSparkWallet({ name: 'Savings' });
  h.setBalance(savings.id, 10);
  await assert.rejects(() => h.store.removeSparkFromDevice(), (e) => e.blockers.includes('needs_backup'));
  await h.store.confirmBackup(savings.id);
  h.store.sparkDiscovery = { pending: [3], attempts: 0, names: {} };
  await h.store.removeSparkFromDevice();
  assert.equal(h.store.sparkWallets.length, 0);
  assert.equal(h.store.sparkDiscovery, null);
  assert.equal(h.saved().wallets.length, 0);
});

// ---- Rename ---------------------------------------------------------------

test('a rename is validated, saved at once, and rolled back when it cannot be saved', async () => {
  const h = createHarness();
  const first = await h.store.createSparkWallet({ mnemonic: PHRASE });
  await h.store.addSparkWallet({ name: 'Savings' });
  await assert.rejects(() => h.store.updateWalletName(first.id, 'savings'), (e) => e.code === 'WALLET_NAME_TAKEN');
  await h.store.updateWalletName(first.id, ' Everyday ');
  assert.equal(first.name, 'Everyday');
  assert.equal(h.saved().wallets.find((w) => w.id === first.id).name, 'Everyday');
  await h.store.updateWalletName(first.id, 'EVERYDAY');
  assert.equal(first.name, 'EVERYDAY', 'its own name in another case is fine');
  h.local.setItem = () => { throw new Error('quota'); };
  await assert.rejects(() => h.store.updateWalletName(first.id, 'Daily'), /quota/);
  assert.equal(first.name, 'EVERYDAY');
});

test('every change to the wallet list asks the Drive backup to refresh', async () => {
  const h = createHarness({ evidence: { 3: used() } });
  const notes = () => h.calls.backupNotes;
  await h.store.createSparkWallet({ mnemonic: PHRASE });
  await tick();
  assert.equal(notes(), 1, 'create');
  const savings = await h.store.addSparkWallet({ name: 'Savings' });
  await tick();
  assert.equal(notes(), 2, 'add');
  await h.store.updateWalletName(savings.id, 'Rainy day');
  await tick();
  assert.equal(notes(), 3, 'rename');
  await h.store.restoreSparkWallets({ mnemonic: PHRASE });
  await h.store.discoverSparkAccounts();
  await tick();
  assert.equal(notes(), 4, 'a wallet found by discovery');
  await h.store.removeWallet(savings.id);
  await tick();
  assert.equal(notes(), 5, 'remove');
});

// ---- Migration of saved installs ------------------------------------------

async function startWith(wallets, extra = {}) {
  const h = createHarness({ storage: { buhoGO_wallet_store: JSON.stringify({ wallets, activeWalletId: extra.active ?? wallets[0]?.id ?? null, hasBackedUp: true, ...extra.state }) } });
  await h.store.initialize();
  // Wallets beyond the selected one connect in the background after
  // initialize resolves; let them settle so they never write into the next
  // test's storage.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return h;
}

test('a saved Business/Personal pair becomes two ordinary wallets, names kept, once', async () => {
  const h = await startWith([await savedSpark('B', 1, { name: 'Business' }), await savedSpark('P', 2, { name: 'Personal' })], { active: 'P' });
  assert.equal(h.store.lastError, null);
  assert.deepEqual(h.store.wallets.map((w) => [w.name, w.connectionData.accountNumber]), [['Business', 1], ['Personal', 2]]);
  assert.ok(h.store.wallets.every((w) => w.connectionData.walletGroupId === undefined));
  assert.equal(h.store.activeWalletId, 'P');
  assert.equal(h.saved().sparkModelVersion, 2);
  assert.ok(h.saved().wallets.every((w) => w.connectionData.walletGroupId === undefined));
});

test('a lone account-1 wallet stays alone: no Personal is created, no rename', async () => {
  const h = await startWith([await savedSpark('B', 1, { name: 'My money' })]);
  assert.deepEqual(h.store.wallets.map((w) => w.name), ['My money']);
});

test('a legacy {1, 0} pair keeps both, and an extra Personal from the old migration survives as a wallet', async () => {
  const legacy = await startWith([await savedSpark('B', 1, { name: 'Business' }), await savedSpark('L', 0, { name: 'Personal' })]);
  assert.deepEqual(legacy.store.wallets.map((w) => w.connectionData.accountNumber), [1, 0]);
  const broken = await startWith([await savedSpark('B', 1), await savedSpark('L', 0), await savedSpark('P', 2)]);
  assert.deepEqual(broken.store.wallets.map((w) => w.connectionData.accountNumber), [1, 0, 2], 'three accounts, three wallets');
});

test('entries on another phrase or duplicating an account are set aside, never deleted', async () => {
  const other = await savedSpark('X', 1, { phrase: OTHER_PHRASE, group: 'group-2' });
  const duplicate = await savedSpark('D', 2, { extra: { sparkAddress: null } });
  const h = await startWith([await savedSpark('B', 1), await savedSpark('P', 2), other, duplicate, { id: 'N', type: 'nwc', name: 'Alby', connectionData: {}, metadata: {} }], { active: 'X' });
  assert.deepEqual(h.store.wallets.map((w) => w.id), ['B', 'P', 'N']);
  const aside = JSON.parse(h.local.getItem('buhoGO_spark_set_aside_v1'));
  assert.deepEqual(aside.map((entry) => [entry.wallet.id, entry.reason]).sort(), [['D', 'duplicate_account'], ['X', 'other_phrase']]);
  assert.equal(aside.find((entry) => entry.wallet.id === 'X').wallet.connectionData.encryptedMnemonic, other.connectionData.encryptedMnemonic, 'the phrase envelope is kept');
  assert.equal(h.saved().wallets.length, 3, 'the shorter list was allowed through the persist guard');
  assert.notEqual(h.store.activeWalletId, 'X');
});

test('when a phrase cannot be read yet, nothing is set aside and the migration waits', async () => {
  const unreadable = { ...(await savedSpark('X', 1, { phrase: OTHER_PHRASE })), connectionData: { encryptedMnemonic: 'pin-format', network: 'MAINNET', accountNumber: 1, walletGroupId: 'g' } };
  const h = await startWith([await savedSpark('B', 1), unreadable]);
  assert.equal(h.store.wallets.length, 2);
  assert.equal(h.local.getItem('buhoGO_spark_set_aside_v1'), null);
  assert.equal(h.saved().sparkModelVersion, 1, 'runs again on the next start');
  assert.ok(h.saved().wallets.every((w) => w.connectionData.walletGroupId === undefined), 'grouping is dropped regardless');
});

test('a migration that sets the selected or kiosk wallet aside leaves both pointing at a real wallet', async () => {
  const other = await savedSpark('X', 2, { phrase: OTHER_PHRASE, group: 'group-2' });
  const h = await startWith([other, await savedSpark('B', 1), await savedSpark('P', 3)], { active: 'X', state: { kioskWalletId: 'X' } });
  assert.deepEqual(h.store.wallets.map((w) => w.id), ['B', 'P'], 'the other phrase was set aside');
  assert.ok(h.store.wallets.some((w) => w.id === h.store.activeWalletId), 'a wallet is selected');
  assert.notEqual(h.store.activeWalletId, 'X');
  assert.equal(h.store.kioskWalletId, null);
});

test('at start only the wallets on screen hold up loading; the rest connect behind', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const wallets = [await savedSpark('A', 1, { group: null }), await savedSpark('B', 2, { group: null }), await savedSpark('C', 3, { group: null })];
  const h = createHarness({
    connect: async (wallet) => { if (wallet.id !== 'A' && wallet.id !== 'C') await gate; },
    storage: { buhoGO_wallet_store: JSON.stringify({ wallets, activeWalletId: 'A', kioskWalletId: 'C', sparkModelVersion: 2 }) },
  });
  await h.store.initialize();
  assert.equal(h.store.connectionStates.A?.connected, true);
  assert.equal(h.store.connectionStates.C?.connected, true, 'the kiosk wallet is ready with the active one');
  assert.notEqual(h.store.connectionStates.B?.connected, true, 'B is still connecting in the background');
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.store.connectionStates.B?.connected, true);
});

test('pockets from the oldest model become wallets on the same phrase', async () => {
  const pocketed = await savedSpark('B', 1, { name: 'Main', extra: { accounts: [{ accountNumber: 2, name: 'Pocket', sparkAddress: 'spark-2' }], activeAccountNumber: 2 } });
  const h = await startWith([pocketed], { active: 'B' });
  assert.deepEqual(h.store.wallets.map((w) => [w.name, w.connectionData.accountNumber]), [['Main', 1], ['Pocket', 2]]);
  assert.equal(h.store.wallets[1].connectionData.encryptedMnemonic, pocketed.connectionData.encryptedMnemonic);
  assert.equal(h.store.activeWalletId, h.store.wallets[1].id, 'the active pocket stays active');
  assert.equal(h.store.wallets[0].metadata.accounts, undefined);
});

test('a saved discovery plan resumes at start', async () => {
  const h = createHarness({
    evidence: { 3: used() },
    storage: { buhoGO_wallet_store: JSON.stringify({ wallets: [await savedSpark('B', 1, { group: null })], activeWalletId: 'B', sparkModelVersion: 2, sparkDiscovery: { pending: [3, 7, 'x'], attempts: 1 } }) },
  });
  await h.store.initialize();
  await h.store.discoverSparkAccounts();
  await tick();
  assert.deepEqual(h.store.sparkWallets.map((w) => w.connectionData.accountNumber), [1, 3]);
  assert.equal(h.store.sparkDiscovery, null);
});
