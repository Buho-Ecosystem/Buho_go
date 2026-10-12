/**
 * The Spark multi-wallet model in the real store: one recovery phrase, up to
 * six equal wallets (accounts 0..5), one at onboarding. Covers creation,
 * adding, restore and resumable discovery, removal rules, renaming, the
 * one-time migration of saved pairs, and how the saved wallets survive a
 * reload and a second window: nothing is saved before they are loaded, a
 * wallet added meanwhile joins them instead of replacing them, an add or a
 * removal that cannot be saved changes nothing, and the screens say why.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import * as userErrors from '../../utils/userErrors.js';
import * as walletNames from '../../utils/walletNames.js';
import * as sparkAccountRules from '../../utils/sparkAccounts.js';
import * as backupStatus from '../../utils/backupStatus.js';
import * as recoveryPhraseFlow from '../../composables/useRecoveryPhraseFlow.js';
import { createHarness, memoryStorage, savedSpark, PHRASE, OTHER_PHRASE, tick } from './sparkWalletHarness.js';

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
  assert.equal(h.store.sparkDiscoveryFound.unchecked, 1, 'and the person is told');
});

test('being offline never uses up discovery attempts', async () => {
  const offline = new Error('offline');
  const evidence = { 2: offline, 3: offline, 4: offline, 5: offline, 0: offline };
  const h = createHarness({ evidence });
  await h.store.restoreSparkWallets({ mnemonic: PHRASE });
  for (let i = 0; i < 8; i += 1) await h.store.discoverSparkAccounts();
  assert.deepEqual(h.store.sparkDiscovery.pending, [2, 3, 4, 5, 0], 'still queued for when the network is back');
  assert.equal(h.store.sparkDiscovery.attempts, 0);
  evidence[0] = used();
  await h.store.discoverSparkAccounts();
  assert.ok(accounts(h.store).includes(0), 'the pre-1.6 account is found once online');
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
  await h.store.confirmBackup(h.store.sparkWallets[0].id);
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

test('the last Spark wallet goes only with a backed-up phrase, whatever its balance', async () => {
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
  empty.setBalance(fresh.id, 0);
  assert.deepEqual(empty.store.removalCheckFor(fresh.id).blockers, ['needs_backup'], 'an empty wallet still takes the phrase off the device');
});

test('a wallet that is not the last goes only once the network has just shown it empty', async () => {
  const h = createHarness();
  await h.store.createSparkWallet({ mnemonic: PHRASE });
  const savings = await h.store.addSparkWallet({ name: 'Savings' });
  h.store.applyBalance(savings.id, 0, { source: 'cache' });
  assert.deepEqual(h.store.removalCheckFor(savings.id).blockers, ['balance_unverified'], 'a saved zero');
  h.store.forgetBalance(savings.id);
  assert.deepEqual(h.store.removalCheckFor(savings.id).blockers, ['balance_unverified'], 'no balance yet');
  await assert.rejects(() => h.store.removeWallet(savings.id), (e) => e.blockers.includes('balance_unverified'));
  h.setBalance(savings.id, 0);
  assert.equal(h.store.removalCheckFor(savings.id).allowed, true);
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

// ---- Fiat -----------------------------------------------------------------

test('every balance converts to the person\'s currency, and nothing shows without a rate', () => {
  const { store } = createHarness();
  store.preferredFiatCurrency = 'EUR';
  store.exchangeRates = { eur: 80000 };
  assert.equal(store.fiatValueOf(250000), 'EUR 200.00');
  assert.equal(store.fiatValueOf(0), 'EUR 0.00', 'a known zero is a value');
  store.exchangeRates = {};
  assert.equal(store.fiatValueOf(250000), '', 'no rate, no made-up figure');
  store.exchangeRates = { eur: 80000 };
  assert.equal(store.fiatValueOf(undefined), '');
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
  assert.equal(h.saved().wallets.length, 3, 'the shorter list is saved: the store read the entries it set aside');
  assert.notEqual(h.store.activeWalletId, 'X');
  assert.deepEqual(h.store.setAsideSparkWallets().map((w) => w.id), ['X'], 'the other phrase stays reachable');
  assert.equal(await h.store.getMnemonicForWallet('X'), OTHER_PHRASE, 'and its words can be shown');
});

test('the load saves the migration itself, so it lands while Spark is offline too', async () => {
  const other = await savedSpark('X', 1, { phrase: OTHER_PHRASE, group: 'group-2' });
  const h = createHarness({
    // Nothing connects, so no later balance save writes the migrated list instead.
    connect: () => { throw new Error('offline'); },
    storage: { buhoGO_wallet_store: JSON.stringify({ wallets: [await savedSpark('B', 1), await savedSpark('P', 2), other], activeWalletId: 'B', hasBackedUp: true }) },
  });
  await h.store.initialize();
  const saved = h.saved();
  assert.equal(saved.sparkModelVersion, 2);
  assert.deepEqual(saved.wallets.map((w) => w.id), ['B', 'P'], 'the entry on another phrase left the list');
  assert.ok(saved.wallets.every((w) => w.connectionData.walletGroupId === undefined), 'grouping is dropped');
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
  assert.deepEqual(h.saved().wallets.map((w) => w.connectionData.accountNumber), [1, 3], 'what it found is saved');
});

// ---- Saved state across a reload -------------------------------------------

const STORE_KEY = 'buhoGO_wallet_store';
const UNREADABLE_PREFIX = 'buhoGO_wallet_store_unreadable_';
const NWC_URL = 'nostr+walletconnect://f00d?relay=wss%3A%2F%2Frelay.example&secret=5ec7';
// Settings the person changed: nothing may put the defaults back.
const SETTINGS = {
  preferredFiatCurrency: 'EUR', denominationCurrency: 'btc', useBip177Format: false, balanceHidden: true,
  biometricsEnabled: true, kioskTipValues: [7, 14, 21], kioskDisplayCurrency: 'fiat',
};
// The rest of what a reload once put back to its defaults: the kiosk, screen
// privacy and the backup state.
const DEVICE = {
  ...SETTINGS, defaultDisplayCurrency: 'fiat', hasBackedUp: true, privacyScreenEnabled: true,
  kioskEnabled: true, kioskPin: '2468', kioskWalletId: 'B', kioskTipEnabled: true, kioskRoundUpEnabled: true,
};
const LNBITS = { name: 'Kitty', serverUrl: 'https://lnbits.example', adminKey: 'admin-key' };
const OTHER_WINDOW_WALLET = { id: 'X', type: 'nwc', name: 'Added in another tab', nwcUrl: 'nostr+walletconnect://beef?relay=wss%3A%2F%2Frelay.example&secret=0the' };

const ids = (wallets) => wallets.map((w) => w.id);
const offline = () => { throw new Error('offline'); };
const nwcWallet = () => ({ id: 'N', type: 'nwc', name: 'Alby', nwcUrl: NWC_URL, metadata: {} });
const kittyWallet = () => ({ id: 'L', type: 'lnbits', name: 'Kitty', connectionData: { serverUrl: 'https://lnbits.example', walletId: 'lnbits-1', adminKey: 'k' }, metadata: {} });
const shopWallet = () => ({ id: 'K', type: 'lnbits', name: 'Shop', connectionData: { serverUrl: 'https://shop.example', walletId: 'shop-1', adminKey: 'shop-key' }, metadata: {} });

/** Stand-ins for the providers of the other wallet types. */
function otherProviders({ arkadeConnect = null, lnbitsConnect = null } = {}) {
  class LNBitsWalletProvider {
    static async validateCredentials(serverUrl) {
      return { valid: true, serverUrl, walletInfo: { id: 'lnbits-1', name: 'Kitty', balance: 2100 } };
    }
    constructor() { this.isConnected = false; }
    async connect() { if (lnbitsConnect) await lnbitsConnect(); this.isConnected = true; }
    async getBalance() { return { balance: 2100 }; }
    async getInfo() { return { alias: 'Kitty' }; }
    async disconnect() { this.isConnected = false; }
  }
  class NostrWebLNProvider {
    async enable() {}
    async getInfo() { return { alias: 'Alby', pubkey: 'pk-nwc', network: 'mainnet', methods: ['pay_invoice'] }; }
    async getBalance() { return { balance: 1500 }; }
    close() {}
  }
  class ArkadeWalletProvider {
    static generateMnemonic() { return OTHER_PHRASE; }
    static isValidMnemonic() { return true; }
    constructor() { this.isConnected = false; }
    async connect() { if (arkadeConnect) await arkadeConnect(); this.isConnected = true; }
    async getBalance() { return { balance: 0, pending: 0, recoverable: 0 }; }
    async getInfo() { return { arkadeAddress: 'ark1example' }; }
    async disconnect() { this.isConnected = false; }
  }
  return {
    '../providers/LNBitsWalletProvider': { LNBitsWalletProvider },
    '@getalby/sdk': { NostrWebLNProvider },
    '../providers/ArkadeWalletProvider': { ArkadeWalletProvider },
  };
}

/**
 * A device that saved `wallets` and `state` (SETTINGS unless given), opened
 * again. Nothing is loaded yet, exactly as a screen opened straight after a
 * reload finds the store.
 */
function reloaded(wallets, { state = SETTINGS, arkadeConnect, lnbitsConnect, deps = {}, ...options } = {}) {
  const raw = JSON.stringify({ balanceSchemaVersion: 1, wallets, activeWalletId: wallets[0]?.id ?? null, sparkModelVersion: 2, ...state });
  const h = createHarness({ ...options, storage: { [STORE_KEY]: raw }, deps: { ...otherProviders({ arkadeConnect, lnbitsConnect }), ...deps } });
  return { ...h, raw };
}

/** Another window saves a wallet this store never saw. */
function saveInOtherWindow(h) {
  const saved = h.saved();
  saved.wallets.push(OTHER_WINDOW_WALLET);
  h.local.setItem(STORE_KEY, JSON.stringify(saved));
}

/** A module from src, or the `<script>` of a page, run with stand-ins for its imports. */
function loadModule(file, deps) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const script = file.endsWith('.vue') ? source.match(/<script>([\s\S]*?)<\/script>/)[1] : source;
  const { code } = transformSync(script, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports);
  return module.exports.default;
}

for (const [kind, add] of [
  ['LNbits', (store) => store.addLNBitsWallet(LNBITS)],
  ['NWC', (store) => store.addWallet({ name: 'Alby', nwcUrl: NWC_URL })],
]) {
  test(`an ${kind} wallet added straight after a reload joins the saved wallets and keeps every setting`, async () => {
    const device = [await savedSpark('B', 1, { group: null }), shopWallet()];
    // Spark stays offline, so no connect refreshes its saved entry meanwhile.
    const h = reloaded(device, { state: DEVICE, connect: offline });
    assert.equal(h.store.hydrated, false);
    assert.deepEqual(h.store.wallets, []);
    const wallet = await add(h.store);
    const saved = h.saved();
    assert.deepEqual(ids(saved.wallets), ['B', 'K', wallet.id]);
    for (const entry of device) {
      assert.equal(JSON.stringify(saved.wallets.find((w) => w.id === entry.id)), JSON.stringify(entry), `${entry.name} and its secret, byte for byte`);
    }
    for (const [key, value] of Object.entries(JSON.parse(h.raw))) {
      if (key !== 'wallets' && key !== 'activeWalletId') assert.deepEqual(saved[key], value, `${key} is kept`);
    }
    assert.equal(h.store.activeWalletId, wallet.id);
  });
}

test('nothing is saved before the saved state is loaded, not even settings on a device without wallets', async () => {
  for (const wallets of [[], [await savedSpark('B', 1, { group: null })]]) {
    const h = reloaded(wallets, { deps: { '../utils/secureScreen': { isScreenPrivacyEnabled: async () => true } } });
    h.store.updateBip177Preference(true);
    h.store.setBalanceHidden(false);
    h.store.updateBiometricsEnabled(false);
    await h.store.syncPrivacyScreenFromNative();
    await h.store.persistState();
    await tick();
    assert.equal(h.local.getItem(STORE_KEY), h.raw, `${wallets.length} saved wallet(s): untouched`);
    await assert.rejects(() => h.store.persistState({ requireDurable: true }), (e) => e.code === 'WALLET_STATE_UNAVAILABLE');
  }
});

test('a fresh install has nothing to load and saves its first wallet', async () => {
  const h = createHarness({ deps: otherProviders() });
  const wallet = await h.store.addLNBitsWallet(LNBITS);
  assert.equal(h.store.savedStateLoaded, true);
  assert.deepEqual(ids(h.saved().wallets), [wallet.id]);
});

test('creating or restoring Spark straight after a reload meets the phrase already saved', async () => {
  const spark = await savedSpark('B', 1, { group: null });
  const h = reloaded([spark]);
  await assert.rejects(() => h.store.createSparkWallet({ mnemonic: OTHER_PHRASE }), (e) => e.code === 'SPARK_WALLET_EXISTS');
  await assert.rejects(() => h.store.restoreSparkWallets({ mnemonic: OTHER_PHRASE }), (e) => e.code === 'SPARK_OTHER_PHRASE');
  assert.deepEqual(ids(h.saved().wallets), ['B']);
  assert.equal(h.saved().wallets[0].connectionData.encryptedMnemonic, spark.connectionData.encryptedMnemonic, 'its recovery phrase is kept');
});

test('an Arkade wallet that cannot connect after a reload leaves the loaded selection and the saved list alone', async () => {
  const h = reloaded([await savedSpark('B', 1, { group: null })], { arkadeConnect: () => { throw new Error('ark server offline'); } });
  await assert.rejects(() => h.store.addArkadeWallet(), /ark server offline/);
  assert.equal(h.store.activeWalletId, 'B', 'the selection the load found, not the empty one before it');
  assert.deepEqual(ids(h.store.wallets), ['B']);
  assert.deepEqual(ids(h.saved().wallets), ['B']);
  assert.equal(h.store.lastError, 'ark server offline');
});

test('an LNbits wallet that cannot connect is taken back out, so adding it again works', async () => {
  let reachable = false;
  const h = reloaded([await savedSpark('B', 1, { group: null })], {
    connect: offline,
    lnbitsConnect: () => { if (!reachable) throw new Error('LNbits server unreachable'); },
  });
  await assert.rejects(() => h.store.addLNBitsWallet(LNBITS), /LNbits server unreachable/);
  assert.deepEqual(ids(h.store.wallets), ['B'], 'not left in memory');
  assert.equal(h.store.activeWalletId, 'B');
  assert.deepEqual(ids(h.saved().wallets), ['B']);
  reachable = true;
  const wallet = await h.store.addLNBitsWallet(LNBITS);
  assert.deepEqual(ids(h.saved().wallets), ['B', wallet.id], 'not refused as already connected');
});

test('removing wallets saves the shorter list, even when another save lands meanwhile', async () => {
  const h = reloaded([await savedSpark('B', 1, { group: null }), kittyWallet()]);
  await h.store.initialize();
  let release;
  const closing = new Promise((resolve) => { release = resolve; });
  h.store.providers.L = { disconnect: () => closing };
  const removal = h.store.disconnectLNBitsWallets();
  await tick();
  // A balance or settings save while the LNbits wallet is still closing.
  await h.store.persistState();
  release();
  await removal;
  assert.deepEqual(ids(h.saved().wallets), ['B']);
});

test('a wallet read at load can be removed at once: no save has to have written it first', async () => {
  for (const remove of [(store) => store.removeWallet('L'), (store) => store.disconnectLNBitsWallets()]) {
    // Spark stays offline, so nothing is saved between the load and the removal.
    const h = reloaded([await savedSpark('B', 1, { group: null }), kittyWallet()], { connect: offline });
    await h.store.initialize();
    assert.equal(h.local.getItem(STORE_KEY), h.raw, 'nothing saved since the load');
    await remove(h.store);
    assert.deepEqual(ids(h.saved().wallets), ['B']);
  }
});

test('a wallet another window saved is never dropped: saves are refused instead', async () => {
  const h = reloaded([await savedSpark('B', 1, { group: null })]);
  await h.store.initialize();
  saveInOtherWindow(h);
  const onDisk = h.local.getItem(STORE_KEY);
  await h.store.setDefaultWallet('B');
  h.store.setBalanceHidden(false);
  await tick();
  assert.equal(h.local.getItem(STORE_KEY), onDisk, 'nothing was written over it');
  const name = h.store.wallets[0].name;
  await assert.rejects(() => h.store.updateWalletName('B', 'Main'), (e) => e.code === 'WALLET_STATE_CONFLICT');
  assert.equal(h.store.wallets[0].name, name, 'the rename is rolled back');
});

test('a removal another window would undo is refused before anything is torn down', async () => {
  for (const [what, remove] of [
    ['Spark from this device', (store) => store.removeSparkFromDevice()],
    ['one wallet', (store) => store.removeWallet('L')],
    ['every LNbits wallet', (store) => store.disconnectLNBitsWallets()],
    ['every NWC wallet', (store) => store.disconnectNwcWallets()],
  ]) {
    const h = reloaded([await savedSpark('B', 1, { group: null }), kittyWallet(), nwcWallet()]);
    await h.store.initialize();
    saveInOtherWindow(h);
    const onDisk = h.local.getItem(STORE_KEY);
    await assert.rejects(() => remove(h.store), (e) => e.code === 'WALLET_STATE_CONFLICT', what);
    assert.deepEqual(ids(h.store.wallets), ['B', 'L', 'N'], `${what}: every wallet is still here`);
    assert.equal(h.store.providers.B?.isConnected, true, `${what}: nothing was disconnected`);
    assert.deepEqual(h.calls.deletedStorage, [], `${what}: no engine storage was deleted`);
    assert.equal(h.local.getItem(STORE_KEY), onDisk, `${what}: the saved wallets, the other window's too, are as they were`);
  }
});

test('a removal whose save is refused says so instead of reporting success', async () => {
  const h = reloaded([await savedSpark('B', 1, { group: null }), kittyWallet()]);
  await h.store.initialize();
  let release;
  h.store.providers.L = { disconnect: () => new Promise((resolve) => { release = resolve; }) };
  const removal = h.store.removeWallet('L');
  await tick();
  // Another window saves a wallet while this one is still closing the LNbits wallet.
  saveInOtherWindow(h);
  release();
  await assert.rejects(removal, (e) => e.code === 'WALLET_STATE_CONFLICT');
  assert.deepEqual(ids(h.saved().wallets), ['B', 'L', 'X'], 'nothing was saved over the other window\'s wallet');
});

for (const [action, device, add] of [
  ['creating Spark', () => [nwcWallet()], (store) => store.createSparkWallet({ mnemonic: PHRASE })],
  ['restoring Spark', () => [nwcWallet()], (store) => store.restoreSparkWallets({ mnemonic: PHRASE })],
  ['restoring the phrase already here', () => savedSpark('B', 1, { group: null }).then((w) => [w]), (store) => store.restoreSparkWallets({ mnemonic: PHRASE, accounts: [{ accountNumber: 1 }, { accountNumber: 2 }] })],
  ['adding a Spark wallet', () => savedSpark('B', 1, { group: null }).then((w) => [w]), (store) => store.addSparkWallet({ name: 'Savings' })],
  ['adding Arkade', () => savedSpark('B', 1, { group: null }).then((w) => [w]), (store) => store.addArkadeWallet()],
  ['adding NWC', () => savedSpark('B', 1, { group: null }).then((w) => [w]), (store) => store.addWallet({ name: 'Alby', nwcUrl: NWC_URL })],
  ['adding LNbits', () => savedSpark('B', 1, { group: null }).then((w) => [w]), (store) => store.addLNBitsWallet(LNBITS)],
]) {
  test(`${action} while another window saved a wallet fails and leaves the store as it found it`, async () => {
    const h = reloaded(await device());
    await h.store.initialize();
    saveInOtherWindow(h);
    const before = ids(h.store.wallets);
    const selection = h.store.activeWalletId;
    const plan = h.store.sparkDiscovery;
    await assert.rejects(() => add(h.store), (e) => e.code === 'WALLET_STATE_CONFLICT');
    assert.deepEqual(ids(h.store.wallets), before, 'no wallet exists only in memory');
    for (const map of ['providers', 'connectionStates', 'walletInfos', 'balanceStates']) {
      assert.deepEqual(Object.keys(h.store[map]).filter((id) => !before.includes(id)), [], `nothing of it stays in ${map}`);
    }
    assert.equal(h.store.activeWalletId, selection);
    assert.deepEqual(ids(h.store.wallets.filter((w) => w.isActive)), [selection], 'only the selection it found is active');
    assert.deepEqual(h.store.sparkDiscovery, plan, 'the discovery plan as it was');
    assert.deepEqual(ids(h.saved().wallets), [...before, 'X'], 'the other window\'s wallet is still saved');
  });
}

test('a refused add puts its discovery plan back; a restore takes its backup flag back only when no wallet of the phrase stays', async () => {
  const fresh = reloaded([nwcWallet()]);
  await fresh.store.initialize();
  saveInOtherWindow(fresh);
  await assert.rejects(() => fresh.store.restoreSparkWallets({ mnemonic: PHRASE }), (e) => e.code === 'WALLET_STATE_CONFLICT');
  assert.equal(fresh.store.sparkDiscovery, null, 'no plan for a phrase that is not here');
  assert.equal(fresh.store.hasBackedUp, false);

  const merging = reloaded([await savedSpark('B', 1, { group: null, extra: { hasBackedUp: false } })]);
  await merging.store.initialize();
  saveInOtherWindow(merging);
  await assert.rejects(() => merging.store.restoreSparkWallets({ mnemonic: PHRASE, accounts: [{ accountNumber: 2 }] }), (e) => e.code === 'WALLET_STATE_CONFLICT');
  assert.equal(merging.store.sparkDiscovery, null, 'the plan the restore made is gone');
  assert.equal(merging.store.wallets[0].metadata.hasBackedUp, true, 'the phrase was typed in, so the wallet already here counts as backed up');

  const adding = reloaded([await savedSpark('B', 1, { group: null })], {
    state: { ...SETTINGS, sparkDiscovery: { pending: [2, 3], attempts: 1, names: {} } },
    // The queued accounts cannot be checked now, so discovery leaves them queued.
    evidence: { 2: new Error('offline'), 3: new Error('offline') },
  });
  await adding.store.initialize();
  await adding.store.discoverSparkAccounts();
  saveInOtherWindow(adding);
  await assert.rejects(() => adding.store.addSparkWallet({ name: 'Savings' }), (e) => e.code === 'WALLET_STATE_CONFLICT');
  assert.deepEqual(adding.store.sparkDiscovery.pending, [2, 3], 'the account the add took is queued again');
});

test('an add whose own save fails puts the selection it moved back on disk too', async () => {
  const h = reloaded([await savedSpark('B', 1, { group: null })], { connect: offline });
  await h.store.initialize();
  const { setItem } = h.local;
  let full = true;
  h.local.setItem = (key, value) => {
    // Storage is full for the first save that holds the Arkade wallet; the
    // balance save made while it connected, with it selected, landed.
    if (key === STORE_KEY && full && JSON.parse(value).wallets.length > 1) {
      full = false;
      throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    }
    return setItem(key, value);
  };
  await assert.rejects(() => h.store.addArkadeWallet(), { name: 'QuotaExceededError' });
  assert.deepEqual(ids(h.saved().wallets), ['B']);
  assert.equal(h.saved().activeWalletId, 'B', 'not the Arkade wallet nobody saved');
});

test('an add whose own save fails leaves nothing on disk, and the profile follows only a saved wallet', async () => {
  const h = createHarness();
  await h.store.initialize();
  let followed = 0;
  h.store._syncProfilePaymentAddress = async () => { followed += 1; };
  const { setItem } = h.local;
  const written = [];
  let full = true;
  h.local.setItem = (key, value) => {
    if (key === STORE_KEY) {
      const { wallets } = JSON.parse(value);
      // Storage is full for the first save that holds the new wallet: the
      // saves made while it connected land, its own save does not.
      if (full && wallets.length) {
        full = false;
        throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
      }
      written.push(ids(wallets));
    }
    return setItem(key, value);
  };
  await assert.rejects(() => h.store.createSparkWallet({ mnemonic: PHRASE }), { name: 'QuotaExceededError' });
  assert.ok(written.length >= 3, 'the saves made while it connected landed');
  assert.ok(written.every((wallets) => !wallets.length), 'none of them wrote the new wallet');
  assert.deepEqual(h.store.wallets, []);
  assert.equal(followed, 0, 'the profile never points at an address whose phrase nobody kept');

  h.local.setItem = setItem;
  const wallet = await h.store.createSparkWallet({ mnemonic: PHRASE });
  assert.deepEqual(ids(h.saved().wallets), [wallet.id]);
  assert.ok(wallet.metadata.lud16);
  assert.equal(followed, 1, 'once saved, the profile follows the new wallet');
});

test('an add refused because another window saved meanwhile leaves nothing of it on disk', async () => {
  const h = createHarness();
  await h.store.initialize();
  const { setItem } = h.local;
  const written = [];
  h.local.setItem = (key, value) => {
    setItem(key, value);
    if (key !== STORE_KEY) return;
    written.push(ids(JSON.parse(value).wallets));
    // Another window opens while the new wallet connects and saves a wallet of its own.
    if (written.length === 1) {
      const theirs = JSON.parse(value);
      theirs.wallets.push(OTHER_WINDOW_WALLET);
      setItem(STORE_KEY, JSON.stringify(theirs));
    }
  };
  await assert.rejects(() => h.store.createSparkWallet({ mnemonic: PHRASE }), (e) => e.code === 'WALLET_STATE_CONFLICT');
  assert.ok(written.every((wallets) => !wallets.length), 'this window never wrote the new wallet');
  assert.deepEqual(ids(h.saved().wallets), ['X'], 'nothing was saved here, as the message says');

  // The other window removes its wallet again: this one saves again, and
  // there is no wallet of the undone add for it to drop.
  h.local.setItem = setItem;
  setItem(STORE_KEY, JSON.stringify({ ...h.saved(), wallets: [] }));
  h.store.setBalanceHidden(true);
  await tick();
  assert.equal(h.saved().balanceHidden, true);
  assert.deepEqual(h.saved().wallets, []);
});

test('wallets this version cannot use stay saved, and settings saves still land', async () => {
  const unknownType = { id: 'X', type: 'cashu', name: 'From a newer version', connectionData: { encryptedMnemonic: 'enc:x:words' } };
  const noUrl = { id: 'N', type: 'nwc', name: 'Half saved', metadata: {} };
  const noId = { type: 'lnbits', name: 'No id', connectionData: { serverUrl: 'https://lnbits.example' } };
  const h = reloaded([await savedSpark('B', 1, { group: null }), unknownType, noUrl, noId], { validate: true });
  await h.store.initialize();
  assert.deepEqual(ids(h.store.wallets), ['B'], 'only usable wallets are listed');
  h.store.setBalanceHidden(false);
  await tick();
  const saved = h.saved();
  assert.equal(saved.balanceHidden, false, 'the settings save landed');
  for (const entry of [unknownType, noUrl, noId]) {
    assert.ok(saved.wallets.some((w) => JSON.stringify(w) === JSON.stringify(entry)), `${entry.name} is still saved as it was`);
  }
});

test('an entry without an id never blocks saving', async () => {
  const h = reloaded([await savedSpark('B', 1, { group: null })]);
  await h.store.initialize();
  const saved = h.saved();
  saved.wallets.push({ type: 'nwc', name: 'No id', nwcUrl: NWC_URL });
  h.local.setItem(STORE_KEY, JSON.stringify(saved));
  h.store.balanceHidden = false;
  await h.store.persistState({ requireDurable: true });
  assert.equal(h.saved().balanceHidden, false);
});

test('a saved value another writer left unreadable is never saved over', async () => {
  for (const value of ['not json', '{"wallets":{}}']) {
    const h = reloaded([await savedSpark('B', 1, { group: null })]);
    await h.store.initialize();
    h.local.setItem(STORE_KEY, value);
    await assert.rejects(() => h.store.persistState({ requireDurable: true }), (e) => e.code === 'WALLET_STATE_CONFLICT', value);
    assert.equal(h.local.getItem(STORE_KEY), value);
  }
});

test('a saved state that cannot be read is set aside, never deleted, and the person can start again', async () => {
  const unreadable = '{"wallets": [';
  const h = createHarness({ storage: { [STORE_KEY]: unreadable }, deps: otherProviders() });
  await h.store.initialize();
  assert.equal(h.store.savedStateLoaded, true);
  assert.equal(h.local.getItem(STORE_KEY), null);
  const kept = [...h.local.map].filter(([key]) => key.startsWith(UNREADABLE_PREFIX));
  assert.deepEqual(kept.map(([, value]) => value), [unreadable]);
  const wallet = await h.store.addLNBitsWallet(LNBITS);
  assert.deepEqual(ids(h.saved().wallets), [wallet.id]);
  assert.equal(h.local.getItem(kept[0][0]), unreadable, 'the unreadable copy stays');
});

test('an unreadable saved state never replaces one set aside before', async () => {
  const now = Date.now;
  Date.now = () => 1700000000000;
  try {
    const h = createHarness({ storage: { [STORE_KEY]: 'not json', [`${UNREADABLE_PREFIX}1700000000000`]: 'older' } });
    await h.store.initialize();
    assert.equal(h.local.getItem(`${UNREADABLE_PREFIX}1700000000000`), 'older');
    assert.equal(h.local.getItem(`${UNREADABLE_PREFIX}1700000000000_2`), 'not json');
  } finally {
    Date.now = now;
  }
});

test('when an unreadable saved state cannot be set aside, it stays and nothing is added or saved over it', async () => {
  const h = createHarness({ storage: { [STORE_KEY]: 'not json' }, deps: otherProviders() });
  const setItem = h.local.setItem;
  h.local.setItem = (key, value) => {
    if (key.startsWith(UNREADABLE_PREFIX)) throw new Error('quota');
    return setItem(key, value);
  };
  await h.store.initialize();
  assert.equal(h.store.hydrated, true, 'screens still paint');
  assert.equal(h.store.savedStateLoaded, false);
  await assert.rejects(() => h.store.addLNBitsWallet(LNBITS), (e) => e.code === 'WALLET_STATE_UNAVAILABLE');
  assert.deepEqual(h.store.wallets, []);
  assert.equal(h.local.getItem(STORE_KEY), 'not json');
});

test('the screen-privacy boot saves nothing on the web, and on Android only the privacy flag', async () => {
  for (const native of [false, true]) {
    const h = reloaded([], { deps: { '../utils/secureScreen': { isScreenPrivacyEnabled: async () => true } } });
    // The 'wallet-store' boot loaded the saved state first.
    await h.store.initialize();
    const boot = loadModule('../../boot/secure-screen.js', {
      'quasar/wrappers': { boot: (fn) => fn },
      vue: { watch() {} },
      'stores/wallet': { useWalletStore: () => h.store },
      '../utils/secureScreen': { isScreenPrivacySupported: () => native, applyScreenPrivacyTransient: async () => {} },
    });
    await boot({ router: { afterEach() {} } });
    if (!native) {
      assert.equal(h.local.getItem(STORE_KEY), h.raw, 'web: nothing saved');
      assert.equal(h.store.privacyScreenEnabled, false);
      continue;
    }
    const saved = h.saved();
    assert.equal(saved.privacyScreenEnabled, true, 'Android: the native value is saved');
    for (const [key, value] of Object.entries(JSON.parse(h.raw))) assert.deepEqual(saved[key], value, `${key} is kept`);
  }
});

test('a new Spark wallet becomes the profile payment address only once it is saved', async () => {
  const saved = createHarness();
  let followed = 0;
  saved.store._syncProfilePaymentAddress = async () => { followed += 1; };
  await saved.store.createSparkWallet({ mnemonic: PHRASE });
  assert.equal(followed, 1, 'a saved wallet: the profile follows its address');

  const refused = reloaded([nwcWallet()]);
  await refused.store.initialize();
  saveInOtherWindow(refused);
  let published = 0;
  refused.store._syncProfilePaymentAddress = async () => { published += 1; };
  await assert.rejects(() => refused.store.createSparkWallet({ mnemonic: PHRASE }), (e) => e.code === 'WALLET_STATE_CONFLICT');
  assert.equal(published, 0, 'no profile ever points at a recovery phrase nobody saved');
});

// ---- What the screens say when the saved wallets cannot be changed ---------

const WALLET_STATE_COPY = {
  WALLET_STATE_UNAVAILABLE: 'Your wallets could not be loaded, so nothing was changed. Close and reopen BuhoGO, then try again.',
  WALLET_STATE_CONFLICT: 'Your wallets were changed in another tab or window, so nothing was saved here. Reload BuhoGO, then try again.',
};
const refusal = (code) => Object.assign(new Error('nothing was saved'), { code });
const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name);
const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }), createText: (text) => ({ text }), createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node); }, remove() {},
  setElementText(node, text) { node.text = text; }, setText(node, text) { node.text = text; },
  parentNode: (node) => node.parent, nextSibling: () => null, patchProp() {},
});

/** A `<script setup>` component, mounted without its template, with stand-ins for its imports. */
function mountSetup(file, { props = {}, deps = {} } = {}) {
  const { descriptor } = parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
  const { code } = transformSync(compileScript(descriptor, { id: file }).content, { format: 'cjs' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => ({ vue: Vue, ...deps })[name] || {}, module, module.exports);
  const app = renderer.createApp({ ...module.exports.default, render: () => Vue.h('div') }, props);
  app.config.globalProperties.$t = t;
  app.mount({ children: [] });
  return { state: app._instance.setupState, unmount: () => app.unmount() };
}

test('Spark and Arkade setup opened again with the wallet saved go to it; a refused add says why', async () => {
  for (const [file, method, action, exists, deps] of [
    ['../../pages/SparkSetupPage.vue', 'generateAndCreate', 'createSparkWallet', 'SPARK_WALLET_EXISTS', { '@scure/bip39': { generateMnemonic: () => PHRASE } }],
    ['../../pages/ArkadeSetupPage.vue', 'createWallet', 'addArkadeWallet', 'ARKADE_WALLET_EXISTS', {}],
  ]) {
    const page = loadModule(file, deps);
    for (const code of [exists, ...Object.keys(WALLET_STATE_COPY)]) {
      const routes = [];
      const shown = [];
      const vm = {
        $t: t,
        $router: { replace: (path) => routes.push(['replace', path]), push: (path) => routes.push(['push', path]) },
        walletStore: {
          [action]: async () => { throw refusal(code); },
          showPaymentError: (error, ctx) => shown.push(userErrors.buildPaymentError(error, ctx, ctx.t)),
        },
      };
      await page.methods[method].call(vm);
      if (code === exists) {
        assert.deepEqual(routes, [['replace', '/wallet']], `${file}: the wallet is there, so it opens`);
        assert.deepEqual(shown, [], `${file}: and no error is shown`);
      } else {
        assert.equal(shown[0].title, "Couldn't add the wallet", `${file}: the headline does not blame the connection`);
        assert.equal(shown[0].reason, WALLET_STATE_COPY[code]);
        assert.equal(shown[0].reasonAttribution, null);
      }
    }
  }
});

test('the NWC form says why an add saved nothing', async () => {
  const page = loadModule('../../pages/NWCSetupPage.vue', { pinia: { mapActions: () => ({}) }, '../utils/userErrors': userErrors });
  for (const [code, copy] of Object.entries(WALLET_STATE_COPY)) {
    const vm = {
      ...page.methods, $t: t, walletName: 'Alby', nwcString: NWC_URL, errorMessage: '',
      validateNwcString: () => true, addWallet: async () => { throw refusal(code); },
    };
    await vm.validateAndConnect();
    assert.equal(vm.errorMessage, copy);
  }
});

test('a restore that saved nothing says why', () => {
  const page = loadModule('../../pages/RestorePage.vue', { '../utils/userErrors': userErrors });
  for (const [code, copy] of Object.entries(WALLET_STATE_COPY)) {
    assert.deepEqual(page.methods._userFacingRestoreError.call({ $t: t }, refusal(code)), { message: "We couldn't restore your wallet", caption: copy });
  }
});

test('the welcome screen never deletes a saved state it cannot read', async () => {
  globalThis.localStorage = memoryStorage({ [STORE_KEY]: 'not json' });
  const page = loadModule('../../pages/WelcomePage.vue', {});
  const vm = { loadingText: '', showLoadingScreen: true, $router: { push: (path) => assert.fail(`went to ${path}`) } };
  await page.methods.initializeApp.call(vm);
  assert.equal(localStorage.getItem(STORE_KEY), 'not json', 'left for the wallet store to set aside');
  assert.equal(vm.showLoadingScreen, false);
});

test('the add-Spark sheet shows a refused save with the action, not on the name field', async () => {
  for (const [failure, expected] of [
    [refusal('WALLET_STATE_CONFLICT'), { formError: WALLET_STATE_COPY.WALLET_STATE_CONFLICT, nameError: '' }],
    [refusal('WALLET_STATE_UNAVAILABLE'), { formError: WALLET_STATE_COPY.WALLET_STATE_UNAVAILABLE, nameError: '' }],
    [new walletNames.WalletNameError('taken'), { formError: '', nameError: 'Another wallet already has this name.' }],
  ]) {
    const { state, unmount } = mountSetup('../../components/wallets/AddSparkWalletSheet.vue', {
      props: { modelValue: true },
      deps: {
        '../../stores/wallet': { useWalletStore: () => ({ wallets: [], remainingSparkSlots: 5, addSparkWallet: async () => { throw failure; } }) },
        '../../utils/sparkAccounts.js': sparkAccountRules,
        '../../utils/walletNames.js': walletNames,
        '../../utils/userErrors': userErrors,
      },
    });
    await state.create();
    assert.deepEqual({ formError: state.formError, nameError: state.nameError }, expected, failure.message);
    unmount();
  }
});

test('a rename or a backup confirmation the saved wallets refuse says why', async () => {
  const rename = mountSetup('../../components/settings/WalletDetailPanel.vue', {
    props: { wallet: { id: 'B', name: 'Wallet', type: 'spark' }, typeLabel: 'Spark', balance: '0', renameWallet: async () => { throw refusal('WALLET_STATE_CONFLICT'); } },
    deps: { '../../utils/walletNames.js': walletNames, '../../utils/userErrors': userErrors },
  });
  await rename.state.startEditing();
  rename.state.nameDraft = 'Main';
  await rename.state.saveName();
  assert.equal(rename.state.nameError, WALLET_STATE_COPY.WALLET_STATE_CONFLICT);
  rename.unmount();

  const previousDocument = globalThis.document;
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  try {
    const store = {
      wallets: [{ id: 'B', type: 'spark', name: 'Wallet', metadata: {} }], hasBackedUp: false, biometricsEnabled: false,
      setAsideSparkWallets: () => [], getMnemonicForWallet: async () => PHRASE,
      confirmBackup: async () => { throw refusal('WALLET_STATE_CONFLICT'); },
    };
    const backup = mountSetup('../../components/RecoveryPhraseDialog.vue', {
      props: { modelValue: true, kind: 'wallet', mode: 'backup', walletId: 'B' },
      deps: {
        '../stores/wallet': { useWalletStore: () => store },
        '../stores/identity': { useIdentityStore: () => ({ fingerprint: null }) },
        '../utils/biometric': { isBiometricAvailable: async () => ({ available: false }), authenticate: async () => true },
        '../composables/useRecoveryPhraseFlow.js': recoveryPhraseFlow,
        '../utils/backupStatus.js': backupStatus,
        '../utils/userErrors': userErrors,
      },
    });
    backup.state.acknowledged = true;
    await backup.state.advance(); // unlock, then the words
    await backup.state.advance(); // on to the check
    backup.state.checkComplete = true;
    await backup.state.advance(); // confirm
    assert.equal(backup.state.errorMessage, WALLET_STATE_COPY.WALLET_STATE_CONFLICT);
    backup.unmount();
  } finally {
    globalThis.document = previousDocument;
  }
});

test('a Drive restore that could not add its wallets says why', () => {
  const sheet = loadModule('../../components/CloudBackupSheet.vue', { '../utils/userErrors': userErrors });
  const summary = sheet.methods.describeRestoreResult.call({ $t: t }, {
    restored: ['identity'], skipped: [],
    failed: [{ label: 'spark', reason: 'not loaded', code: 'WALLET_STATE_UNAVAILABLE' }, { label: 'Alby', reason: 'not loaded', code: 'WALLET_STATE_UNAVAILABLE' }],
  });
  assert.equal(summary, `Restored: Nostr identity · Could not restore: Spark wallet, Alby. ${WALLET_STATE_COPY.WALLET_STATE_UNAVAILABLE}`);
});
