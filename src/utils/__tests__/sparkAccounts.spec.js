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
import { removalCheck, removalCopy } from '../walletRemoval.js';

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
  assert.equal(check({ sparkWalletCount: 1, balance: { known: false, value: 0 }, backedUp: true }).allowed, true);
  assert.deepEqual(removalCheck({ wallet: { type: 'nwc' }, balance: { known: true, value: 9 } }), { allowed: true, blockers: [], notes: [] });
});

test('removal copy names one reason at a time and offers the step that unblocks it', () => {
  const wallet = { type: 'spark', name: 'Savings' };
  const funded = removalCopy({ check: check({ balance: { known: true, value: 7 } }), wallet, t, formatAmount: n => `${n} sats`, balanceSats: 7 });
  assert.deepEqual([funded.blocked, funded.action], [true, 'move_funds']);
  assert.match(funded.message, /Savings still holds 7 sats/);
  const both = removalCopy({ check: check({ hasActiveExit: true, balance: { known: true, value: 7 } }), wallet, t });
  assert.equal(both.title, 'Emergency exit in progress');
  assert.equal(removalCopy({ check: check({ sparkWalletCount: 1, balance: { known: false, value: 0 } }), wallet, t }).action, 'backup');
  const last = removalCopy({ check: check({ sparkWalletCount: 1, backedUp: true }), wallet, t });
  assert.equal(last.blocked, false);
  assert.match(last.title, /Remove Spark from this phone/);
  assert.match(last.message, /exit kit stays/);
  const unknown = removalCopy({ check: check({ balance: { known: false, value: 0 } }), wallet, t });
  assert.deepEqual([unknown.blocked, unknown.title], [true, 'Balance not checked']);
  assert.equal(removalCopy({ check: removalCheck({ wallet: { type: 'nwc' } }), wallet: { type: 'nwc', name: 'Alby' }, t }).title, 'Remove Wallet');
  for (const copy of [funded, both, last, unknown]) assert.ok(!/—/.test(copy.title + copy.message), 'no em dashes in copy');
});
