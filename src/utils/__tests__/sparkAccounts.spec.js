/**
 * The pure rules behind Spark multi-wallet: account slots, restore evidence,
 * wallet names, and when a wallet may be removed (with what the person is told).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SPARK_ACCOUNT_ORDER, MAX_SPARK_WALLETS, isSparkAccountNumber, sparkAccountNumberOf, usedSparkAccounts,
  nextFreeSparkAccount, remainingSparkSlots, canAddSparkWallet, isRestorableAccount, isConclusiveScan, suggestWalletName,
} from '../sparkAccounts.js';
import { normalizeWalletName, walletNameProblem, walletNameCopy, MAX_WALLET_NAME_LENGTH } from '../walletNames.js';
import { removalCheck, removalCopy, removalBlockerLabel, sparkRemovalCopy, disconnectAllCopy, walletKind } from '../walletRemoval.js';

const spark = (accountNumber, extra = {}) => ({ id: `s${accountNumber}`, type: 'spark', name: `S${accountNumber}`, connectionData: { accountNumber, network: 'MAINNET' }, ...extra });
const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name);

test('six slots, account 1 first and account 0 last', () => {
  assert.deepEqual(SPARK_ACCOUNT_ORDER, [1, 2, 3, 4, 5, 0]);
  assert.equal(MAX_SPARK_WALLETS, 6);
  for (const n of [0, 1, 5]) assert.equal(isSparkAccountNumber(n), true);
  for (const n of [6, -1, 1.5, '1', null, undefined]) assert.equal(isSparkAccountNumber(n), false);
});

test('entries without a stored account open the SDK default for their network', () => {
  assert.equal(sparkAccountNumberOf({ connectionData: { accountNumber: 0 } }), 0);
  assert.equal(sparkAccountNumberOf({ connectionData: {} }), 1);
  assert.equal(sparkAccountNumberOf({ connectionData: { network: 'REGTEST' } }), 0);
});

test('the next wallet takes the lowest free slot, and a freed slot is reused', () => {
  assert.equal(nextFreeSparkAccount([]), 1);
  assert.equal(nextFreeSparkAccount([spark(1), spark(2)]), 3);
  assert.equal(nextFreeSparkAccount([spark(1), spark(3)]), 2, 'a removed account comes back first');
  assert.equal(nextFreeSparkAccount([1, 2, 3, 4, 5].map(n => spark(n))), 0);
  const full = SPARK_ACCOUNT_ORDER.map(n => spark(n));
  assert.equal(nextFreeSparkAccount(full), null);
  assert.equal(canAddSparkWallet(full), false);
  assert.equal(remainingSparkSlots([spark(1), { type: 'nwc' }]), 5, 'other wallet types do not count');
  assert.deepEqual([...usedSparkAccounts([spark(1), spark(0), { type: 'arkade' }])].sort(), [0, 1]);
});

test('an account is restored only on evidence of use', () => {
  const empty = { balanceSats: 0, paymentCount: 0, hasUnclaimedDeposit: false, lightningAddress: null, synced: true };
  assert.equal(isRestorableAccount(empty), false);
  assert.equal(isRestorableAccount(null), false);
  for (const evidence of [{ balanceSats: 1 }, { paymentCount: 1 }, { hasUnclaimedDeposit: true }, { lightningAddress: 'a@b.c' }]) {
    assert.equal(isRestorableAccount({ ...empty, ...evidence }), true, JSON.stringify(evidence));
  }
  assert.equal(isConclusiveScan(empty), true);
  assert.equal(isConclusiveScan({ ...empty, synced: false }), false, 'unsynced and empty is not proof of empty');
  assert.equal(isConclusiveScan({ ...empty, synced: false, balanceSats: 5 }), true, 'evidence is final even unsynced');
  assert.equal(isConclusiveScan(null), false);
});

test('default names never collide', () => {
  assert.equal(suggestWalletName('Wallet', []), 'Wallet');
  assert.equal(suggestWalletName('Wallet', [{ name: 'wallet' }, { name: 'Wallet 2' }]), 'Wallet 3');
});

test('names are trimmed, at most 32 characters and unique regardless of case', () => {
  assert.equal(normalizeWalletName('  Rainy   day \n'), 'Rainy day');
  const wallets = [{ id: 'a', name: 'Savings' }, { id: 'b', name: ' Shop ' }];
  assert.equal(walletNameProblem('', wallets), 'empty');
  assert.equal(walletNameProblem('x'.repeat(MAX_WALLET_NAME_LENGTH + 1), wallets), 'too_long');
  assert.equal(walletNameProblem('😀'.repeat(MAX_WALLET_NAME_LENGTH), wallets), null, 'counted in characters, not UTF-16 units');
  assert.equal(walletNameProblem('savings', wallets), 'taken');
  assert.equal(walletNameProblem('SHOP', wallets), 'taken');
  assert.equal(walletNameProblem('savings', wallets, { exceptId: 'a' }), null, 'a wallet may keep its own name');
  assert.match(walletNameCopy('too_long', t), /32/);
  assert.equal(walletNameCopy('unknown', t), '');
});

const check = (overrides = {}) => removalCheck({
  wallet: { type: 'spark' }, sparkWalletCount: 2, balance: { known: true, value: 0, fresh: true }, hasPendingDeposit: false, hasActiveExit: false, backedUp: false, ...overrides,
});

test('removal rules: money, deposits, exits and the last wallet', () => {
  assert.deepEqual(check(), { allowed: true, blockers: [], notes: [] });
  assert.deepEqual(check({ balance: { known: true, value: 1 } }).blockers, ['has_balance']);
  assert.deepEqual(check({ balance: { known: false, value: 0 } }).blockers, ['balance_unverified'], 'an unknown balance may hide money');
  assert.deepEqual(check({ balance: { known: true, value: 0, fresh: false } }).blockers, ['balance_unverified'], 'a saved zero proves nothing: money may have arrived since');
  assert.deepEqual(check({ hasPendingDeposit: true, hasActiveExit: true }).blockers, ['exit_in_progress', 'deposit_pending']);
  assert.deepEqual(check({ sparkWalletCount: 1, balance: { known: true, value: 5 } }).blockers, ['needs_backup'], 'the last wallet may hold money only with a backup');
  assert.equal(check({ sparkWalletCount: 1, balance: { known: true, value: 5 }, backedUp: true }).allowed, true);
  assert.deepEqual(check({ sparkWalletCount: 1 }).blockers, ['needs_backup'], 'even an empty last wallet takes the phrase, and every removed account with it');
  assert.deepEqual(check({ sparkWalletCount: 1, backedUp: true }).notes, ['phrase_leaves']);
  assert.equal(check({ sparkWalletCount: 1, balance: { known: false, value: 0 }, backedUp: true }).allowed, true);
});

test('an Arkade wallet keeps its own phrase: backed up, or just shown empty', () => {
  const arkade = (overrides) => removalCheck({ wallet: { type: 'arkade' }, balance: { known: true, value: 900, fresh: true }, ...overrides });
  assert.deepEqual(arkade().blockers, ['needs_backup']);
  assert.deepEqual(arkade({ balance: { known: true, value: 0, fresh: false } }).blockers, ['needs_backup'], 'a saved zero proves nothing');
  assert.equal(arkade({ balance: { known: true, value: 0, fresh: true } }).allowed, true);
  assert.equal(arkade({ backedUp: true }).allowed, true);
  assert.deepEqual(arkade({ backedUp: true }).notes, ['phrase_leaves']);
});

test('a connected wallet is only a connection: nothing blocks disconnecting it', () => {
  for (const type of ['nwc', 'lnbits', undefined]) {
    assert.equal(walletKind({ type }), 'connected');
    assert.deepEqual(removalCheck({ wallet: { type }, balance: { known: true, value: 9 } }), { allowed: true, blockers: [], notes: [] });
  }
  assert.equal(walletKind({ type: 'spark' }), 'on_phone');
  assert.equal(walletKind({ type: 'arkade' }), 'on_phone');
});

test('removal copy: one reason at a time, the step that unblocks it, and the verb of the kind', () => {
  const wallet = { type: 'spark', name: 'Savings' };
  const funded = removalCopy({ check: check({ balance: { known: true, value: 7 } }), wallet, t, formatAmount: n => `${n} sats`, balanceSats: 7 });
  assert.deepEqual([funded.blocked, funded.action, funded.message], [true, 'move_funds', 'Savings holds 7 sats.']);
  assert.equal(removalCopy({ check: check({ hasActiveExit: true, balance: { known: true, value: 7 } }), wallet, t }).title, 'Emergency exit in progress');
  const unbacked = removalCopy({ check: check({ sparkWalletCount: 1, balance: { known: true, value: 0 } }), wallet, t });
  assert.deepEqual([unbacked.action, unbacked.title], ['backup', 'Back up Savings first']);
  assert.deepEqual([removalCopy({ check: check({ balance: { known: false, value: 0 } }), wallet, t }).blocked], [true]);

  const one = removalCopy({ check: check(), wallet, t });
  assert.deepEqual([one.title, one.message, one.confirmLabel, one.typed], ['Remove Savings from this phone?', 'Your recovery phrase brings it back.', 'Remove', false]);
  const last = removalCopy({ check: check({ sparkWalletCount: 1, backedUp: true }), wallet, t });
  assert.deepEqual([last.message, last.typed], ['Its recovery phrase leaves too.', true], 'typed only when a phrase leaves');
  assert.equal(last.doneMessage, 'Savings removed from this phone');

  const hub = { type: 'nwc', name: 'Alby Hub' };
  const connected = removalCopy({ check: removalCheck({ wallet: hub }), wallet: hub, t });
  assert.deepEqual([connected.title, connected.message, connected.confirmLabel, connected.typed, connected.doneMessage],
    ['Disconnect Alby Hub?', 'Your money stays in Alby Hub.', 'Disconnect', false, 'Alby Hub disconnected']);
  const kiosk = removalCopy({ check: removalCheck({ wallet: hub }), wallet: hub, t, isKioskWallet: true });
  assert.equal(kiosk.message, 'Your money stays in Alby Hub. The kiosk stops taking payments.');

  for (const copy of [funded, unbacked, one, last, connected, kiosk]) {
    const text = `${copy.title} ${copy.message}`;
    assert.ok(!/—|delete|cannot be undone|permanently/i.test(text), `never "delete": ${text}`);
  }
});

test('Danger Zone: every wallet of a kind at once, and a short reason when it cannot run', () => {
  const spark = sparkRemovalCopy({ check: check({ sparkWalletCount: 1, backedUp: true }), t });
  assert.deepEqual([spark.title, spark.typed, spark.doneMessage], ['Remove Spark from this phone?', true, 'Spark removed from this phone']);
  assert.equal(sparkRemovalCopy({ check: check({ sparkWalletCount: 1 }), t }).action, 'backup');
  const listNames = (names) => names.join(' and ');
  const two = disconnectAllCopy({ wallets: [{ type: 'nwc', name: 'Alby Hub' }, { type: 'lnbits', name: 'Kitty' }], t, listNames });
  assert.deepEqual([two.title, two.message, two.typed, two.doneMessage],
    ['Disconnect 2 wallets?', 'Your money stays in Alby Hub and Kitty.', false, '2 wallets disconnected']);
  assert.equal(disconnectAllCopy({ wallets: [{ type: 'nwc', name: 'Alby Hub' }], t, listNames }).title, 'Disconnect Alby Hub?', 'one wallet: named');
  assert.equal(removalBlockerLabel(check({ sparkWalletCount: 1 }), t), 'Back up first');
  assert.equal(removalBlockerLabel(check({ balance: { known: true, value: 3 } }), t), 'Move the money first');
  assert.equal(removalBlockerLabel(check({ balance: { known: false, value: 0 } }), t), '', 'an unchecked balance is checked on tap');
  assert.equal(removalBlockerLabel(check(), t), '');
});
