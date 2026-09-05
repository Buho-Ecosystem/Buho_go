/**
 * Breez SDK Spark — module singleton.
 *
 * Owns every piece of Breez state that must outlive a provider instance:
 *
 *  - The WASM init latch. The package's default export installs the
 *    IndexedDB storage globals and then loads the WASM module; it must run
 *    exactly once per app lifecycle, and only when the Breez engine is
 *    actually used (dynamic import keeps the ~12.5 MB module off the boot
 *    path entirely).
 *
 *  - The per-wallet instance registry with an init mutex. The direct Spark
 *    SDK dedupes live instances internally (getOrCreateWallet); Breez has no
 *    equivalent, and BuhoGO reconnects the same wallet from many call sites
 *    (startup, wallet switch, balance poll, self-heal). Without the registry
 *    every reconnect would leak an SDK instance, duplicate its event stream,
 *    and open a second handle on the same IndexedDB database — which the SDK
 *    forbids. Multiple *different* wallets may be live at once (internal
 *    transfer connects both halves; kiosk can pin a non-active wallet); each
 *    gets its own storage database.
 *
 *  - One SDK event listener per instance, fanned out to any number of
 *    provider-level subscribers, so provider objects can be replaced freely
 *    without listener churn.
 *
 *  - Caches that must survive provider churn: invoice records (payment hash
 *    → expiry) and withdrawal fee-quote prepare responses.
 *
 * On web, `storageDir` is not a filesystem path — it becomes the IndexedDB
 * database name (plus a `<name>-tree` sibling). Created names are tracked in
 * localStorage so wallet deletion and full resets can remove them.
 */

import { BREEZ_API_KEY, BREEZ_LNURL_DOMAIN } from '../config/breez.js';

const DB_NAMES_KEY = 'buhoGO_breez_dbs';

let sdkModulePromise = null;
let wasmInitPromise = null;
let loggingArmed = false;

/** walletId -> { sdk, listenerId, subscribers:Set<fn>, storageDir } */
const instances = new Map();
/** walletId -> in-flight acquire promise (init mutex) */
const initLocks = new Map();

/**
 * paymentHash -> { expiresAt (unix s), createdAt (unix s) }.
 * Persisted: the expiry judgment must survive an app reload, or a
 * reopened receive screen would poll an expired invoice forever and the
 * status scan would lose its time bound.
 */
const INVOICE_RECORDS_KEY = 'buhoGO_breez_invoices';
const INVOICE_RECORDS_MAX = 200;
const invoiceRecords = loadInvoiceRecords();

function loadInvoiceRecords() {
  try {
    const raw = JSON.parse(localStorage.getItem(INVOICE_RECORDS_KEY) || '[]');
    return new Map(Array.isArray(raw) ? raw : []);
  } catch (e) {
    return new Map();
  }
}

function saveInvoiceRecords() {
  try {
    localStorage.setItem(INVOICE_RECORDS_KEY, JSON.stringify([...invoiceRecords]));
  } catch (e) { /* persistence is best-effort */ }
}

/** `${walletId}:${quoteId}` -> { prepareResponse, amountSats, destinationAddress, expiresAt } */
const withdrawQuotes = new Map();
const WITHDRAW_QUOTES_MAX = 20;

async function loadSdkModule() {
  if (!sdkModulePromise) {
    sdkModulePromise = import('@breeztech/breez-sdk-spark');
  }
  return sdkModulePromise;
}

/**
 * Load the WASM module (once). Must complete before any other SDK call.
 */
export async function ensureWasmInit() {
  const mod = await loadSdkModule();
  // Latch on the PROMISE, not a done-flag: the module's own init has no
  // in-flight guard, and a second concurrent instantiation would replace
  // the wasm binding under live handles.
  if (!wasmInitPromise) {
    wasmInitPromise = typeof mod.default === 'function'
      ? mod.default()
      : Promise.resolve();
  }
  await wasmInitPromise;
  // SDK log lines carry invoices, hashes, and addresses - dev builds only.
  if (!loggingArmed && import.meta.env?.DEV) {
    loggingArmed = true;
    try {
      await mod.initLogging(
        { log: (entry) => console.debug(`[breez:${entry.level}] ${entry.line}`) },
        'info'
      );
    } catch (e) {
      // Repeat initLogging calls (or an unsupported env) throw; ignore.
    }
  }
  return mod;
}

/** BuhoGO network name -> Breez Network. Breez supports mainnet/regtest only. */
function toBreezNetwork(network) {
  const key = String(network || 'MAINNET').toUpperCase();
  if (key === 'MAINNET') return 'mainnet';
  if (key === 'REGTEST') return 'regtest';
  throw new Error(`Breez engine does not support the ${key} network`);
}

function storageDirFor(walletId) {
  return `breez-${walletId}`;
}

function trackDbName(name) {
  try {
    const list = JSON.parse(localStorage.getItem(DB_NAMES_KEY) || '[]');
    if (!list.includes(name)) {
      list.push(name);
      localStorage.setItem(DB_NAMES_KEY, JSON.stringify(list));
    }
  } catch (e) { /* tracking is best-effort */ }
}

function untrackDbName(name) {
  try {
    const list = JSON.parse(localStorage.getItem(DB_NAMES_KEY) || '[]');
    const next = list.filter((n) => n !== name);
    localStorage.setItem(DB_NAMES_KEY, JSON.stringify(next));
  } catch (e) { /* ignore */ }
}

async function buildInstance(walletId, { mnemonic, accountNumber, network }) {
  // The SDK itself refuses to build on mainnet without a key ("Missing
  // Breez API key", verified in-browser); fail before WASM init with a
  // message that names the fix.
  if (!BREEZ_API_KEY) {
    const err = new Error(
      'Breez engine needs an API key — set VITE_BREEZ_API_KEY in .env.local and rebuild.'
    );
    err.code = 'BREEZ_API_KEY_MISSING';
    throw err;
  }

  const mod = await ensureWasmInit();

  const config = mod.defaultConfig(toBreezNetwork(network));
  config.apiKey = BREEZ_API_KEY;
  // Spark private mode from the first initialization onward; the provider
  // additionally re-asserts it per connect via updateUserSettings.
  config.privateEnabledDefault = true;
  // Disable SDK-side auto-claiming: BuhoGO's own deposit classifier is the
  // only claimer (fee disclosure + approval thresholds live in the app), and
  // a racing SDK claim would leave the app's claimed-registry unrecorded.
  // A fixed 0-sat bound declines every automatic claim; explicit
  // claimDeposit({maxFee}) calls are unaffected.
  config.maxDepositClaimFee = { type: 'fixed', amount: 0 };
  if (BREEZ_LNURL_DOMAIN) {
    config.lnurlDomain = BREEZ_LNURL_DOMAIN;
  }

  const storageDir = storageDirFor(walletId);

  // wasm-bindgen consumes the receiver handle on every builder step —
  // reassignment is mandatory, and withDefaultStorage returns a Promise.
  let builder = mod.SdkBuilder.new(config, {
    type: 'mnemonic',
    mnemonic,
    passphrase: undefined,
  });
  builder = builder.withAccountNumber(accountNumber);
  builder = await builder.withDefaultStorage(storageDir);
  const sdk = await builder.build();
  trackDbName(storageDir);

  const entry = { sdk, listenerId: null, subscribers: new Set(), storageDir };

  try {
    entry.listenerId = await sdk.addEventListener({
      onEvent: (event) => {
        for (const fn of entry.subscribers) {
          try {
            fn(event);
          } catch (e) {
            console.warn('[breez] event subscriber failed:', e?.message || e);
          }
        }
      },
    });
  } catch (e) {
    // A wallet without events still works (polling covers the contract);
    // never fail the connect over the listener.
    console.warn('[breez] addEventListener failed:', e?.message || e);
  }

  return entry;
}

async function teardownEntry(entry) {
  if (!entry) return;
  try {
    if (entry.listenerId) {
      await entry.sdk.removeEventListener(entry.listenerId);
    }
  } catch (e) { /* listener may already be gone */ }
  try {
    await entry.sdk.disconnect();
  } catch (e) {
    console.warn('[breez] disconnect failed:', e?.message || e);
  }
}

/**
 * Get (or build) the live SDK instance for a wallet. Deduped: a second
 * acquire for the same wallet returns the existing instance; concurrent
 * acquires share one in-flight build. `forceReinit` tears the instance down
 * first — the recovery path for a suspended/dead WASM SDK.
 *
 * @returns {Promise<{ sdk: object }>} the registry entry
 */
export async function acquire(walletId, { mnemonic, accountNumber, network, forceReinit = false }) {
  // Fast path: a live instance and nobody rebuilding it.
  if (!forceReinit && !initLocks.get(walletId) && instances.has(walletId)) {
    return instances.get(walletId);
  }

  // Serialize per wallet by CHAINING onto whatever is in flight - two
  // concurrent forceReinits must run one after the other, never both
  // tearing down and rebuilding against the same IndexedDB database.
  const prev = initLocks.get(walletId) || Promise.resolve();
  const work = prev
    .catch(() => { /* a failed predecessor doesn't poison the chain */ })
    .then(async () => {
      const existing = instances.get(walletId);
      if (existing && !forceReinit) return existing;
      if (existing) {
        instances.delete(walletId);
        await teardownEntry(existing);
      }
      const entry = await buildInstance(walletId, { mnemonic, accountNumber, network });
      instances.set(walletId, entry);
      return entry;
    });

  initLocks.set(walletId, work);
  try {
    return await work;
  } finally {
    if (initLocks.get(walletId) === work) initLocks.delete(walletId);
  }
}

/** The live entry, or null. Never builds. */
export function peek(walletId) {
  return instances.get(walletId) || null;
}

/**
 * Subscribe to SDK events for a wallet. Returns an unsubscribe function.
 * Safe to call for a wallet without a live instance (no-op unsubscribe).
 */
export function subscribe(walletId, handler) {
  const entry = instances.get(walletId);
  if (!entry) return () => {};
  entry.subscribers.add(handler);
  return () => entry.subscribers.delete(handler);
}

/** Tear down a wallet's live instance (disconnect paths). */
export async function release(walletId) {
  const entry = instances.get(walletId);
  if (!entry) return;
  instances.delete(walletId);
  await teardownEntry(entry);
}

/**
 * Permanently delete a wallet's Breez storage (both IndexedDB databases).
 * Call only on wallet removal, after release(); a live handle would block
 * deletion in some browsers (best-effort either way).
 */
export async function deleteWalletStorage(walletId) {
  await release(walletId);
  const name = storageDirFor(walletId);
  for (const dbName of [name, `${name}-tree`]) {
    try {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    } catch (e) { /* best-effort */ }
  }
  untrackDbName(name);
}

/**
 * Delete every tracked Breez database — full-reset paths (clearAll).
 */
export async function deleteAllStorage() {
  let names = [];
  try {
    names = JSON.parse(localStorage.getItem(DB_NAMES_KEY) || '[]');
  } catch (e) { /* ignore */ }
  for (const name of names) {
    const walletId = name.replace(/^breez-/, '');
    await deleteWalletStorage(walletId);
  }
  try { localStorage.removeItem(DB_NAMES_KEY); } catch (e) { /* ignore */ }
}

// ==========================================
// Churn-surviving caches
// ==========================================

export function rememberInvoice(paymentHash, { expiresAt, createdAt }) {
  if (!paymentHash) return;
  invoiceRecords.set(paymentHash, { expiresAt, createdAt });
  if (invoiceRecords.size > INVOICE_RECORDS_MAX) {
    const oldest = invoiceRecords.keys().next().value;
    invoiceRecords.delete(oldest);
  }
  saveInvoiceRecords();
}

export function getInvoiceRecord(paymentHash) {
  return invoiceRecords.get(paymentHash) || null;
}

export function rememberWithdrawQuote(walletId, quoteId, data) {
  withdrawQuotes.set(`${walletId}:${quoteId}`, data);
  if (withdrawQuotes.size > WITHDRAW_QUOTES_MAX) {
    const oldest = withdrawQuotes.keys().next().value;
    withdrawQuotes.delete(oldest);
  }
}

export function getWithdrawQuote(walletId, quoteId) {
  return withdrawQuotes.get(`${walletId}:${quoteId}`) || null;
}
