/**
 * The emergency exit driver: quotes, waits for fee money, signs with the
 * SDK, broadcasts packages in dependency order, waits out the timelock and
 * finishes the sweep. Resumable: every step reads the ledger and the chain,
 * never memory, so closing the app is always safe.
 *
 * Collaborators are injected (`createExitDriver`) so the whole life cycle
 * runs under test; `exitDriver()` is the app-wired instance.
 */

import { deriveExitAddresses, deriveFundingKey, classifyDestination } from '../utils/exitKeys.js';
import { toExitNetwork } from '../utils/exitKit.js';
import { packageFor } from '../utils/exitPlan.js';
import {
  newExit, withQuote, withDestination, withFunding, withBuild, withChain, withError, withoutError, canCancel, canChangeDestination, isActive, selectFundingInputs,
} from '../utils/exitLedger.js';

const STATUS_CONCURRENCY = 4;
const REMINDER_DRIFT_MS = 60 * 60 * 1000;
const SYNC_TIMEOUT_MS = 15000;

export class ExitError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

export function createExitDriver({
  getWallet, getProvider, getMnemonic, ledger, esplora, createSigner,
  reminders = { schedule: async () => false, cancel: async () => {} },
  now = () => Date.now(),
}) {
  const inFlight = new Map();

  /** One operation per wallet at a time, in call order: a cancel queued behind a poll sees the poll's result, never the other way round. */
  function exclusive(walletId, task) {
    const previous = inFlight.get(walletId) || Promise.resolve();
    const run = previous.catch(() => {}).then(task).finally(() => { if (inFlight.get(walletId) === run) inFlight.delete(walletId); });
    inFlight.set(walletId, run);
    return run;
  }

  function requireProvider(walletId) {
    const provider = getProvider(walletId);
    if (!provider?.isConnected) throw new ExitError('NOT_CONNECTED', 'Spark wallet is not connected');
    return provider;
  }

  async function addressesFor(wallet) {
    const network = toExitNetwork(wallet.connectionData?.network);
    return { network, ...deriveExitAddresses(await getMnemonic(wallet.id), { network }) };
  }

  /** Quote and open the ledger record. Free, offline-capable, cancellable. */
  async function start(walletId, { destination = null, excluded = [] } = {}) {
    return exclusive(walletId, async () => {
      const wallet = getWallet(walletId);
      if (!wallet) throw new ExitError('NO_WALLET', 'Wallet not found');
      if (isActive(ledger.exitFor(walletId))) return ledger.exitFor(walletId);
      const provider = requireProvider(walletId);
      const derived = await addressesFor(wallet);
      const target = destination
        ? { address: assertDestination(destination, derived.network, excluded), source: 'custom' }
        : { address: derived.destination.address, source: 'derived' };
      const feeRateSatPerVbyte = (await esplora.recommendedFees()).medium;
      const quote = await provider.prepareUnilateralExit({ feeRateSatPerVbyte, destination: target.address });
      if (!(quote.recoverableValueSat > 0) || !(quote.leaves || []).length) throw new ExitError('NOTHING_TO_EXIT', 'Nothing can be moved at today\'s fees');
      const balanceSat = await provider.getBalanceSatsLocal();
      return ledger.set(newExit({
        walletId, walletName: wallet.name, network: derived.network, destination: target,
        funding: derived.funding, quote, balanceSat, now: now(),
      }));
    });
  }

  function assertDestination(address, network, excluded = []) {
    const verdict = classifyDestination(address, { network, excluded });
    if (!verdict.ok) throw new ExitError(`DESTINATION_${verdict.reason.toUpperCase()}`, 'Not a usable Bitcoin address');
    return verdict.address;
  }

  /** Change where the money arrives; re-quotes because the sweep pays that address. */
  async function setDestination(walletId, address, { excluded = [] } = {}) {
    return exclusive(walletId, async () => {
      const exit = ledger.exitFor(walletId);
      if (!exit || !canChangeDestination(exit)) throw new ExitError('LOCKED', 'Destination cannot change now');
      const provider = requireProvider(walletId);
      const clean = assertDestination(address, exit.network, excluded);
      const quote = await provider.prepareUnilateralExit({ feeRateSatPerVbyte: exit.quote.feeRateSatPerVbyte, destination: clean });
      return ledger.set(withQuote(withDestination(exit, clean, 'custom', now()), quote, exit.balanceSat, now()));
    });
  }

  /** Look at the fee money address. Moves fund -> ready once enough is confirmed. */
  async function refreshFunding(walletId) {
    return exclusive(walletId, async () => {
      const exit = ledger.exitFor(walletId);
      if (!exit || !canCancel(exit)) return exit;
      try {
        const utxos = await esplora.utxos(exit.funding.address);
        return ledger.set(withoutError(withFunding(exit, utxos, now()), now()));
      } catch (error) {
        return ledger.set(withError(exit, error, now()));
      }
    });
  }

  /** Nothing signed yet: forget the record. Fee money stays on its address, under the words. */
  async function cancel(walletId) {
    // Exclusive, so a funding poll in flight cannot write the record back.
    return exclusive(walletId, async () => {
      const exit = ledger.exitFor(walletId);
      if (!exit) return;
      if (!canCancel(exit)) throw new ExitError('LOCKED', 'The exit cannot be stopped now');
      ledger.remove(walletId);
      await reminders.cancel(walletId).catch(() => {});
    });
  }

  /**
   * The point of no return: re-quote for the same leaves at today's fees,
   * sign everything with the fee money key, then start broadcasting.
   */
  async function confirmSend(walletId) {
    return exclusive(walletId, async () => {
      let exit = ledger.exitFor(walletId);
      if (!exit || exit.stage !== 'ready') throw new ExitError('NOT_READY', 'Fee money is not confirmed yet');
      const wallet = getWallet(walletId);
      const provider = requireProvider(walletId);
      const feeRateSatPerVbyte = Math.max(exit.quote.feeRateSatPerVbyte, (await esplora.recommendedFees().catch(() => ({ medium: 0 }))).medium || 0);
      const prepared = await provider.prepareUnilateralExit({
        feeRateSatPerVbyte, destination: exit.destination.address,
        selection: exit.quote.leafIds.length ? { type: 'specific', leafIds: exit.quote.leafIds } : { type: 'auto' },
      });
      exit = withQuote(exit, prepared, exit.balanceSat, now());
      if (exit.stage !== 'ready') {
        ledger.set(exit);
        throw new ExitError('MORE_FEE_MONEY', 'Fees rose; more fee money is needed');
      }
      // Only the inputs the requirement needs: extra fee money on the address
      // is left alone rather than handed to the fee-paying children.
      const fundingInputs = selectFundingInputs(exit.funding.utxos, exit.funding.requiredSat).inputs
        .map(u => ({ type: 'p2wpkh', txid: u.txid, vout: u.vout, value: u.value, pubkey: exit.funding.publicKeyHex }));
      const key = deriveFundingKey(await getMnemonic(wallet.id), { network: exit.network });
      if (key.address !== exit.funding.address) throw new ExitError('KEY_MISMATCH', 'Fee money key does not match');
      let response;
      const signer = await createSigner(key.privateKey);
      try {
        response = await provider.buildUnilateralExit({ prepared, fundingInputs, signer });
      } finally {
        // The secret's job is done: release the WASM signer and wipe the bytes.
        try { signer?.free?.(); } catch { /* already released */ }
        key.privateKey.fill(0);
      }
      exit = ledger.set(withBuild(exit, response, now()));
      return advance(exit);
    });
  }

  async function statusesFor(exit) {
    // Anything not confirmed at a known height is asked again: a timelock
    // counts from the parent's height, so "confirmed" alone is not enough.
    const settled = status => status?.confirmed && Number.isInteger(status.blockHeight);
    const targets = exit.built.transactions.filter(tx => !settled(exit.statuses[tx.txid])).map(tx => tx.txid);
    const statuses = {};
    for (let i = 0; i < targets.length; i += STATUS_CONCURRENCY) {
      const batch = targets.slice(i, i + STATUS_CONCURRENCY);
      const results = await Promise.all(batch.map(txid => esplora.txStatus(txid)));
      batch.forEach((txid, index) => { statuses[txid] = results[index]; });
    }
    return statuses;
  }

  /** One pass: read the chain, broadcast whatever is ready, update the stage. */
  async function advance(exit) {
    if (!exit.built || !isActive(exit)) return exit;
    try {
      const tipHeight = await esplora.tipHeight();
      let next = withChain(exit, { statuses: await statusesFor(exit), tipHeight, now: now() });
      const broadcast = {};
      for (const txid of next.broadcastable) {
        const tx = next.built.transactions.find(t => t.txid === txid);
        const hexes = packageFor(tx);
        if (hexes.length > 1) await esplora.broadcastPackage(hexes);
        else await esplora.broadcastTx(hexes[0]);
        broadcast[txid] = { known: true, confirmed: false };
      }
      if (Object.keys(broadcast).length) next = withChain(next, { statuses: broadcast, tipHeight, now: now() });
      next = withoutError(next, now());
      ledger.set(next);
      return syncReminder(exit, next);
    } catch (error) {
      return ledger.set(withError(exit, error, now()));
    }
  }

  async function syncReminder(before, after) {
    let exit = after;
    const at = after.unlock?.estimatedAt;
    // The estimate moves a little on every pass; only a real drift reschedules.
    const drifted = !after.reminderAt || Math.abs(at - after.reminderAt) > REMINDER_DRIFT_MS;
    if (after.stage === 'unlock' && at && drifted) {
      const ok = await reminders.schedule({ walletId: after.walletId, at }).catch(() => false);
      exit = ledger.set({ ...after, reminderAt: ok ? at : null });
    }
    if (after.stage === 'done' && before.stage !== 'done') await reminders.cancel(after.walletId).catch(() => {});
    return exit;
  }

  /** The periodic pass for one exit, whatever its stage. */
  async function tick(walletId) {
    const exit = ledger.exitFor(walletId);
    if (!exit || !isActive(exit)) return exit;
    if (canCancel(exit)) return refreshFunding(walletId);
    return exclusive(walletId, () => advance(exit));
  }

  async function tickAll() {
    const results = [];
    for (const exit of ledger.activeExits) results.push(await tick(exit.walletId));
    return results;
  }

  return { start, setDestination, refreshFunding, cancel, confirmSend, tick, tickAll };
}

// ---- App wiring ------------------------------------------------------------

let instance = null;
let walletStoreFactory = null;
let exitStoreFactory = null;
let monitor = null;

/** The boot file registers both Pinia store factories, so this module imports no store. */
export function attachExitWalletStore(factory) {
  walletStoreFactory = factory;
}

export function attachEmergencyExitStore(factory) {
  exitStoreFactory = factory;
}

function walletStore() {
  if (!walletStoreFactory) throw new Error('exit driver used before the wallet store attached');
  return walletStoreFactory();
}

function exitStore() {
  if (!exitStoreFactory) throw new Error('exit driver used before the exit store attached');
  return exitStoreFactory();
}

/** The persisted ledger, seen through the store. */
const ledger = {
  exitFor: (walletId) => exitStore().exitFor(walletId),
  set: (exit) => exitStore().set(exit),
  remove: (walletId) => exitStore().remove(walletId),
  get activeExits() { return exitStore().activeExits; },
};

export function exitDriver() {
  if (instance) return instance;
  instance = createExitDriver({
    getWallet: (walletId) => walletStore().wallets.find(w => w.id === walletId) || null,
    getProvider: (walletId) => walletStore().getSparkProvider(walletId),
    getMnemonic: (walletId) => walletStore().getSparkMnemonic(walletId),
    ledger,
    esplora: lazyEsplora(),
    createSigner: async (privateKey) => (await import('./breezSdk.js')).createCpfpSigner(privateKey),
    reminders: {
      schedule: async ({ walletId, at }) => {
        const [{ scheduleUnlockReminder }, { i18n }] = await Promise.all([import('./exitNotifications.js'), import('../boot/i18n')]);
        return scheduleUnlockReminder({
          walletId, at, title: i18n.global.t('Bitcoin ready to move'), body: i18n.global.t('Your emergency exit can finish now. Open BuhoGO.'),
        });
      },
      cancel: async (walletId) => (await import('./exitNotifications.js')).cancelUnlockReminder(walletId),
    },
  });
  return instance;
}

/** One Esplora client, created on first use so tests never touch the network. */
function lazyEsplora() {
  let client = null;
  const get = async () => client || (client = await (await import('./esplora.js')).appEsploraClient());
  return {
    tipHeight: async () => (await get()).tipHeight(),
    txStatus: async (txid) => (await get()).txStatus(txid),
    utxos: async (address) => (await get()).utxos(address),
    recommendedFees: async () => (await get()).recommendedFees(),
    broadcastTx: async (hex) => (await get()).broadcastTx(hex),
    broadcastPackage: async (hexes) => (await get()).broadcastPackage(hexes),
  };
}

/**
 * One bounded real sync per connected Spark wallet, recording only whether
 * Spark answered. This is what lets the home screen notice a sustained
 * outage while the app sits open on cached balances. Every live wallet, not
 * just the selected one: both halves of the pair hold funds that may need
 * the exit, and each keeps its own outage record.
 */
async function probeSparkHealth() {
  const store = walletStore();
  for (const wallet of store.sparkWallets || []) {
    const provider = store.getSparkProvider(wallet.id);
    if (provider?.isConnected && typeof provider.probeReachability === 'function') {
      await provider.probeReachability({ timeoutMs: SYNC_TIMEOUT_MS });
    }
  }
}

/** Keep every active exit moving and Spark's reachability known while the app is open. Safe to call repeatedly. */
export function startExitMonitor({ intervalMs = 5 * 60 * 1000 } = {}) {
  if (monitor) return monitor;
  const run = async () => {
    await exitDriver().tickAll().catch(error => console.warn('exit monitor pass failed:', error?.message || error));
    await probeSparkHealth().catch(() => {});
  };
  const timer = setInterval(run, intervalMs);
  const onVisible = () => { if (document.visibilityState === 'visible') run(); };
  document.addEventListener('visibilitychange', onVisible);
  monitor = { stop() { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); monitor = null; }, run };
  run();
  return monitor;
}
