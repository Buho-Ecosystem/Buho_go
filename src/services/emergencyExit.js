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
  newExit, withQuote, withDestination, withFunding, withBuild, withChain, withError, withoutError, canCancel, isActive,
} from '../utils/exitLedger.js';

const STATUS_CONCURRENCY = 4;

export class ExitError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

export function createExitDriver({
  getWallet, getProvider, getMnemonic, ledger, esplora, createSigner,
  reminders = { schedule: async () => false, cancel: async () => {} },
  now = () => Date.now(),
}) {
  const inFlight = new Map();

  function exclusive(walletId, task) {
    if (inFlight.has(walletId)) return inFlight.get(walletId);
    const run = (async () => { try { return await task(); } finally { inFlight.delete(walletId); } })();
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
  async function start(walletId, { destination = null } = {}) {
    return exclusive(walletId, async () => {
      const wallet = getWallet(walletId);
      if (!wallet) throw new ExitError('NO_WALLET', 'Wallet not found');
      if (isActive(ledger.exitFor(walletId))) return ledger.exitFor(walletId);
      const provider = requireProvider(walletId);
      const derived = await addressesFor(wallet);
      const target = destination
        ? { address: assertDestination(destination, derived.network), source: 'custom' }
        : { address: derived.destination.address, source: 'derived' };
      const feeRateSatPerVbyte = (await esplora.recommendedFees()).medium;
      const quote = await provider.prepareUnilateralExit({ feeRateSatPerVbyte, destination: target.address });
      if (!(quote.recoverableValueSat > 0) || !(quote.leaves || []).length) throw new ExitError('NOTHING_TO_EXIT', 'Nothing can be moved at today’s fees');
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
      if (!exit || !canCancel(exit)) throw new ExitError('LOCKED', 'Destination cannot change now');
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
    const exit = ledger.exitFor(walletId);
    if (!exit) return;
    if (!canCancel(exit)) throw new ExitError('LOCKED', 'The exit cannot be stopped now');
    ledger.remove(walletId);
    await reminders.cancel(walletId).catch(() => {});
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
      const fundingInputs = exit.funding.utxos.filter(u => u.confirmed)
        .map(u => ({ type: 'p2wpkh', txid: u.txid, vout: u.vout, value: u.value, pubkey: exit.funding.publicKeyHex }));
      const key = deriveFundingKey(await getMnemonic(wallet.id), { network: exit.network });
      if (key.address !== exit.funding.address) throw new ExitError('KEY_MISMATCH', 'Fee money key does not match');
      const signer = await createSigner(key.privateKey);
      const response = await provider.buildUnilateralExit({ prepared, fundingInputs, signer });
      exit = ledger.set(withBuild(exit, response, now()));
      return advance(exit);
    });
  }

  async function statusesFor(exit) {
    const targets = exit.built.transactions.filter(tx => !exit.statuses[tx.txid]?.confirmed).map(tx => tx.txid);
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
    if (after.stage === 'unlock' && at && at !== before.unlock?.estimatedAt) {
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
let monitor = null;

export function attachExitWalletStore(factory) {
  walletStoreFactory = factory;
}

function walletStore() {
  if (!walletStoreFactory) throw new Error('exit driver used before the wallet store attached');
  return walletStoreFactory();
}

export function exitDriver() {
  if (instance) return instance;
  instance = createExitDriver({
    getWallet: (walletId) => walletStore().wallets.find(w => w.id === walletId) || null,
    getProvider: (walletId) => walletStore().getSparkProvider(walletId),
    getMnemonic: (walletId) => walletStore().getSparkMnemonic(walletId),
    ledger: ledgerFacade(),
    esplora: lazyEsplora(),
    createSigner: async (privateKey) => (await import('./breezSdk.js')).createCpfpSigner(privateKey),
    reminders: {
      schedule: async ({ walletId, at }) => (await import('./exitNotifications.js')).scheduleUnlockReminder({
        walletId, at, title: 'Bitcoin ready to move', body: 'Your emergency exit can finish now. Open BuhoGO.',
      }),
      cancel: async (walletId) => (await import('./exitNotifications.js')).cancelUnlockReminder(walletId),
    },
  });
  return instance;
}

function ledgerFacade() {
  let store = null;
  const get = () => store || (store = useStoreLazily());
  return {
    exitFor: (id) => get().exitFor(id),
    set: (exit) => get().set(exit),
    remove: (id) => get().remove(id),
    get activeExits() { return get().activeExits; },
  };
}

let _useEmergencyExitStore = null;
function useStoreLazily() {
  if (!_useEmergencyExitStore) throw new Error('emergency exit store not attached');
  return _useEmergencyExitStore();
}

export function attachEmergencyExitStore(factory) {
  _useEmergencyExitStore = factory;
}

function lazyEsplora() {
  let client = null;
  const get = async () => client || (client = (await import('./esplora.js')).createEsploraClient());
  return {
    tipHeight: async () => (await get()).tipHeight(),
    txStatus: async (txid) => (await get()).txStatus(txid),
    utxos: async (address) => (await get()).utxos(address),
    recommendedFees: async () => (await get()).recommendedFees(),
    broadcastTx: async (hex) => (await get()).broadcastTx(hex),
    broadcastPackage: async (hexes) => (await get()).broadcastPackage(hexes),
  };
}

/** Keep every active exit moving while the app is open. Safe to call repeatedly. */
export function startExitMonitor({ intervalMs = 5 * 60 * 1000 } = {}) {
  if (monitor) return monitor;
  const run = () => exitDriver().tickAll().catch(error => console.warn('exit monitor pass failed:', error?.message || error));
  const timer = setInterval(run, intervalMs);
  const onVisible = () => { if (document.visibilityState === 'visible') run(); };
  document.addEventListener('visibilitychange', onVisible);
  monitor = { stop() { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); monitor = null; }, run };
  run();
  return monitor;
}
