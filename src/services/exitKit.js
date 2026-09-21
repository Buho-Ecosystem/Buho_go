/**
 * Emergency exit kit lifecycle for Spark wallets.
 *
 * The kit is the SDK's exported exit state: with it and the recovery words,
 * the money can leave Spark without the operators. Its value is freshness,
 * so it is refreshed after every settled payment, checked with an offline
 * quote, kept in app-owned storage that outlives the wallet's own databases,
 * carried along in the Drive backup, and shareable as an encrypted file.
 *
 * `createExitKitService` takes its collaborators as arguments so the whole
 * lifecycle runs under test without a wallet; `exitKitService` is the
 * app-wired instance.
 */

import { deriveExitAddresses } from '../utils/exitKeys.js';
import { triageFromQuote } from '../utils/exitPlan.js';
import { deriveKitPassphrase, kitFilePayload, kitFilename, toExitNetwork } from '../utils/exitKit.js';
import { kitKey } from '../utils/kitStorage.js';
import { useExitKitStore } from '../stores/exitKit.js';

const REFRESH_DEBOUNCE_MS = 60 * 1000;
const EVENT_SETTLE_MS = 5 * 1000;
const CONNECT_SETTLE_MS = 3 * 1000;
const FALLBACK_FEE_RATE = 2;

export function createExitKitService({
  getWallet,          // walletId -> wallet entry { id, name, connectionData: { network, accountNumber }, metadata: { sparkAddress } }
  getProvider,        // walletId -> connected provider or null
  getMnemonic,        // walletId -> Promise<string>
  storage,            // kit storage: get/set/delete/keys
  meta,               // exit kit store: kitFor/upsert/markFailed/setRefreshing
  feeRate,            // () => Promise<number> sat/vB for the offline quote
  encrypt,            // (payload, passphrase) => Promise<envelope>
  deliver,            // ({ filename, data, title }) => Promise<{ saved, shared }>
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
}) {
  const lastRun = new Map();
  const timers = new Map();
  const subscriptions = new Map();

  function identity(wallet) {
    const sparkAddress = wallet?.metadata?.sparkAddress;
    if (!sparkAddress) throw new Error('Wallet has no Spark address yet');
    return {
      sparkAddress,
      network: toExitNetwork(wallet.connectionData?.network),
      accountNumber: wallet.connectionData?.accountNumber ?? null,
    };
  }

  async function ensureAddresses(wallet) {
    const existing = meta.kitFor(wallet.id);
    if (existing?.destinationAddress && existing?.fundingAddress) return existing;
    const { network } = identity(wallet);
    const addresses = deriveExitAddresses(await getMnemonic(wallet.id), { network });
    return meta.upsert(wallet.id, {
      destinationAddress: addresses.destination.address,
      fundingAddress: addresses.funding.address,
      fundingPublicKeyHex: addresses.funding.publicKeyHex,
      network,
    });
  }

  /** Put a stored kit back into a wallet whose SDK databases may be new or empty. Idempotent. */
  async function importStoredKit(walletId) {
    const wallet = getWallet(walletId);
    const provider = getProvider(walletId);
    if (!wallet || !provider?.isConnected) return false;
    let record;
    try { record = await storage.get(kitKey(identity(wallet).sparkAddress)); } catch { return false; }
    if (!record?.exitState || record.importedFor === walletId) return false;
    await provider.importUnilateralExitState(record.exitState);
    await storage.set(kitKey(record.sparkAddress), { ...record, importedFor: walletId, importedAt: now() });
    meta.upsert(walletId, { importedAt: now() });
    return true;
  }

  /**
   * Export the kit, store it, and check it with an offline quote. Returns
   * `{ ok, reason }`; failures are recorded on the kit, never thrown.
   */
  async function refresh(walletId, { reason = 'manual', force = false } = {}) {
    const wallet = getWallet(walletId);
    const provider = getProvider(walletId);
    if (!wallet || !provider?.isConnected) return { ok: false, reason: 'not_connected' };
    if (!force && now() - (lastRun.get(walletId) || 0) < REFRESH_DEBOUNCE_MS) return { ok: false, reason: 'debounced' };
    lastRun.set(walletId, now());
    meta.setRefreshing(walletId, true);
    try {
      const id = identity(wallet);
      const addresses = await ensureAddresses(wallet);

      const exitState = await provider.exportUnilateralExitState();
      if (typeof exitState !== 'string' || !exitState.length) throw new Error('Empty exit state');
      const exportedAt = now();
      await storage.set(kitKey(id.sparkAddress), {
        v: 1, ...id, walletId, walletName: wallet.name || '', exitState, exportedAt, importedFor: walletId,
      });
      meta.upsert(walletId, { ...id, exportedAt, exportBytes: exitState.length, failedSince: null, lastError: null, lastReason: reason });

      // The check: an offline quote at today's fees says what could leave.
      try {
        const rate = await feeRate().catch(() => meta.kitFor(walletId)?.feeRate || FALLBACK_FEE_RATE);
        const prepared = await provider.prepareUnilateralExit({ feeRateSatPerVbyte: rate, destination: addresses.destinationAddress });
        const balanceSat = await provider.getBalanceSatsLocal();
        meta.upsert(walletId, { checkedAt: now(), feeRate: rate, balanceSat, ...triageFromQuote(prepared, balanceSat), quoteError: null });
      } catch (error) {
        meta.upsert(walletId, { quoteError: String(error?.message || error).slice(0, 300) });
      }
      return { ok: true };
    } catch (error) {
      meta.markFailed(walletId, error?.message || error);
      return { ok: false, reason: 'failed', error };
    } finally {
      meta.setRefreshing(walletId, false);
    }
  }

  function scheduleRefresh(walletId, delayMs, reason) {
    if (timers.has(walletId)) return;
    timers.set(walletId, null);
    const handle = schedule(() => {
      timers.delete(walletId);
      refresh(walletId, { reason }).catch(() => {});
    }, delayMs);
    // A scheduler that ran the task synchronously has already cleared the slot.
    if (timers.get(walletId) === null) timers.set(walletId, handle);
  }

  /** Called once per successful Spark connect: restore a stored kit, then keep the kit fresh. */
  function onSparkConnected(walletId) {
    const provider = getProvider(walletId);
    if (!provider) return;
    subscriptions.get(walletId)?.();
    if (typeof provider.onExitDataChanged === 'function') {
      subscriptions.set(walletId, provider.onExitDataChanged(type => scheduleRefresh(walletId, EVENT_SETTLE_MS, type)));
    }
    importStoredKit(walletId)
      .catch(error => console.warn('exit kit import skipped:', error?.message || error))
      .finally(() => scheduleRefresh(walletId, CONNECT_SETTLE_MS, 'connect'));
  }

  function onSparkDisconnected(walletId) {
    subscriptions.get(walletId)?.();
    subscriptions.delete(walletId);
  }

  /** Before a wallet's databases are deleted: take one last export while the SDK still has it. */
  async function preserveBeforeRemoval(walletId) {
    const provider = getProvider(walletId);
    if (!provider?.isConnected) return { ok: false, reason: 'not_connected' };
    return refresh(walletId, { reason: 'removal', force: true });
  }

  /** Everything the Drive backup should carry. Kits are already plaintext-safe inside the encrypted payload. */
  async function kitsForBackup(walletIds) {
    const kits = [];
    for (const walletId of walletIds) {
      const wallet = getWallet(walletId);
      if (!wallet?.metadata?.sparkAddress) continue;
      const record = await storage.get(kitKey(wallet.metadata.sparkAddress)).catch(() => null);
      if (record?.exitState) {
        const { sparkAddress, network, accountNumber, exitState, exportedAt } = record;
        kits.push({ sparkAddress, network, accountNumber, exitState, exportedAt });
      }
    }
    return kits;
  }

  function markBackedUp(walletIds, at = now()) {
    for (const walletId of walletIds) if (meta.kitFor(walletId)) meta.upsert(walletId, { driveAt: at });
  }

  /** Kits arriving with a restored backup: stored now, imported at the wallet's next connect. */
  async function stashRestoredKits(kits) {
    let stored = 0;
    for (const kit of kits || []) {
      if (!kit?.sparkAddress || typeof kit.exitState !== 'string') continue;
      const existing = await storage.get(kitKey(kit.sparkAddress)).catch(() => null);
      if (existing && (existing.exportedAt || 0) >= (kit.exportedAt || 0)) continue;
      await storage.set(kitKey(kit.sparkAddress), { v: 1, ...kit, importedFor: null });
      stored++;
    }
    return stored;
  }

  /** Share the kit as an encrypted file the person keeps with their recovery words. */
  async function share(walletId) {
    const wallet = getWallet(walletId);
    if (!wallet) throw new Error('Wallet not found');
    const id = identity(wallet);
    const record = await storage.get(kitKey(id.sparkAddress));
    if (!record?.exitState) throw Object.assign(new Error('No exit kit saved yet'), { code: 'NO_KIT' });
    const passphrase = deriveKitPassphrase(await getMnemonic(walletId));
    const envelope = await encrypt(kitFilePayload({ ...record, walletName: wallet.name || '' }), passphrase);
    const result = await deliver({
      filename: kitFilename(wallet.name, now()),
      data: JSON.stringify(envelope),
      title: 'Emergency exit kit',
    });
    if (result?.saved) meta.upsert(walletId, { sharedAt: now() });
    return result;
  }

  return { refresh, importStoredKit, onSparkConnected, onSparkDisconnected, preserveBeforeRemoval, kitsForBackup, markBackedUp, stashRestoredKits, share };
}

// ---- App wiring ------------------------------------------------------------

let instance = null;
let walletStoreFactory = null;

/** The wallet store registers itself here, so this module never imports it (no cycle). */
export function attachWalletStore(factory) {
  walletStoreFactory = factory;
}

function walletStore() {
  if (!walletStoreFactory) throw new Error('exit kit service used before the wallet store attached');
  return walletStoreFactory();
}

export function exitKitService() {
  if (instance) return instance;
  instance = createExitKitService({
    getWallet: (walletId) => walletStore().wallets.find(w => w.id === walletId) || null,
    getProvider: (walletId) => walletStore().getSparkProvider(walletId),
    getMnemonic: (walletId) => walletStore().getSparkMnemonic(walletId),
    storage: lazyStorage(),
    meta: {
      kitFor: (id) => useExitKitStore().kitFor(id),
      upsert: (id, patch) => useExitKitStore().upsert(id, patch),
      markFailed: (id, message) => useExitKitStore().markFailed(id, message),
      setRefreshing: (id, value) => useExitKitStore().setRefreshing(id, value),
    },
    feeRate: async () => {
      const { createEsploraClient } = await import('./esplora.js');
      return (await createEsploraClient().recommendedFees()).slow;
    },
    encrypt: async (payload, passphrase) => (await import('../utils/backupCrypto.js')).encryptBackup(payload, passphrase, { hint: 'Spark emergency exit kit' }),
    deliver: async (args) => (await import('./taxReport/delivery.js')).deliverReport({ ...args, kind: 'json' }),
  });
  return instance;
}

function lazyStorage() {
  let store = null;
  const get = async () => (store ||= (await import('../utils/kitStorage.js')).kitStorage());
  return {
    get: async key => (await get()).get(key),
    set: async (key, value) => (await get()).set(key, value),
    delete: async key => (await get()).delete(key),
    keys: async () => (await get()).keys(),
  };
}
