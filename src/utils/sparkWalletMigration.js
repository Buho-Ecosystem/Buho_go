/**
 * One-time move of saved Spark wallets onto the multi-wallet model: every
 * Spark wallet is an equal account of one recovery phrase.
 *
 * What it does, in order:
 *   1. Pockets (`metadata.accounts[]`, a pre-1.6 model) become wallets.
 *   2. The Business/Personal grouping (`connectionData.walletGroupId`) goes:
 *      a pair is simply two wallets now, keeping its names.
 *   3. One phrase: wallets on another phrase, and a second entry for an
 *      account already present, are set aside. Earlier versions hid them at
 *      runtime; nothing is deleted here, the caller keeps them in storage.
 *
 * It never creates a wallet, never renames one, and never drops one silently.
 * Pure apart from `readSeed` (decrypts a wallet's phrase); the caller owns
 * all storage. Seeds are compared in memory and never returned or logged.
 */

import { sparkAccountNumberOf } from './sparkAccounts.js';

export const SPARK_MODEL_VERSION = 2;

const SPARK = 'spark';

const normalizeSeed = seed => String(seed || '').trim().toLowerCase().split(/\s+/).join(' ');

function newWalletId() {
  return `wallet-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Step 1: pockets become wallets on the same phrase. Returns the new active id. */
function convertPockets(wallets, activeWalletId) {
  let active = activeWalletId;
  for (const wallet of wallets.filter(w => w.type === SPARK && w.metadata?.accounts?.length)) {
    for (const account of wallet.metadata.accounts) {
      const id = newWalletId();
      wallets.push({
        id,
        type: SPARK,
        name: account.name || 'Wallet',
        isActive: false,
        isDefault: false,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        connectionData: {
          encryptedMnemonic: wallet.connectionData.encryptedMnemonic,
          network: wallet.connectionData.network,
          accountNumber: account.accountNumber,
        },
        metadata: {
          sparkAddress: account.sparkAddress || null,
          hasBackedUp: wallet.metadata?.hasBackedUp || false,
        },
      });
      if (active === wallet.id && wallet.metadata.activeAccountNumber === account.accountNumber) active = id;
    }
    delete wallet.metadata.accounts;
    delete wallet.metadata.activeAccountNumber;
  }
  return active;
}

/** The phrase the app keeps: the account-1 wallet's (what earlier versions showed), else the active one, else the first. */
function primaryOf(sparkWallets, activeWalletId) {
  return sparkWallets.find(w => sparkAccountNumberOf(w) === 1)
    || sparkWallets.find(w => w.id === activeWalletId)
    || sparkWallets[0];
}

/**
 * @param {object[]} input           saved wallets (any type), already typed
 * @param {object}   options
 * @param {string}   options.activeWalletId
 * @param {(wallet) => Promise<string>} options.readSeed  decrypts a Spark wallet's phrase
 * @returns {Promise<{ wallets, all, activeWalletId, allActiveWalletId, setAside: {wallet, reason}[], complete: boolean }>}
 *   `wallets` is what stays in the list; `all` is the list before anything
 *   was set aside, for a caller that cannot store the set-aside entries.
 *   `complete` is false when a phrase could not be read (for example an
 *   install still on the old PIN encryption); the seed check then waits for
 *   a later start, and nothing is set aside.
 */
export async function migrateSparkWallets(input, { activeWalletId = null, readSeed } = {}) {
  const wallets = (input || []).map(w => (w?.type === SPARK
    ? { ...w, connectionData: { ...w.connectionData }, metadata: { ...(w.metadata || {}) } }
    : w));
  let active = convertPockets(wallets, activeWalletId);

  for (const wallet of wallets) {
    if (wallet.type === SPARK) delete wallet.connectionData.walletGroupId;
  }

  const spark = wallets.filter(w => w.type === SPARK);
  if (spark.length === 0) return { wallets, all: wallets, activeWalletId: active, allActiveWalletId: active, setAside: [], complete: true };

  const seeds = new Map();
  try {
    for (const wallet of spark) seeds.set(wallet, normalizeSeed(await readSeed(wallet)));
  } catch {
    return { wallets, all: wallets, activeWalletId: active, allActiveWalletId: active, setAside: [], complete: false };
  }

  const primarySeed = seeds.get(primaryOf(spark, active));
  const setAside = [];
  const claimed = new Map();
  // The active entry wins a duplicate account, then the one already
  // connected once (it holds the identity every connect asserts against).
  const preference = w => (w.id === active ? 0 : w.metadata?.sparkAddress ? 1 : 2);
  for (const wallet of [...spark].sort((a, b) => preference(a) - preference(b))) {
    if (seeds.get(wallet) !== primarySeed) {
      setAside.push({ wallet, reason: 'other_phrase' });
      continue;
    }
    const account = sparkAccountNumberOf(wallet);
    if (claimed.has(account)) {
      setAside.push({ wallet, reason: 'duplicate_account' });
      continue;
    }
    claimed.set(account, wallet);
  }

  const asideIds = new Set(setAside.map(entry => entry.wallet.id));
  const kept = wallets.filter(w => !asideIds.has(w.id));
  const keptActive = asideIds.has(active) ? null : active;
  return { wallets: kept, all: wallets, activeWalletId: keptActive, allActiveWalletId: active, setAside, complete: true };
}
