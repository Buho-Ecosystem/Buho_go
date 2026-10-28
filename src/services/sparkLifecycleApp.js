/**
 * The app's one Spark lifecycle coordinator, wired to the real world:
 * the Breez registry's event fan-out, the wallet store, the shared receipt
 * ledger and its delivery (paymentReceiptsApp), deposit processing, exit
 * kits, and the triggers (native resume, page visibility, network
 * restoration).
 *
 * The coordination logic lives in sparkLifecycle.js and is tested there;
 * this module only connects it. Created lazily on first use so importing
 * the wallet store never starts timers (tests, SSR, the audit harness).
 */

import { createSparkLifecycle } from './sparkLifecycle.js';
import { receiptLedger, deliverReceipt, forgetWalletReceipts, trackAppVisibility } from './paymentReceiptsApp.js';
import * as breezSdk from './breezSdk.js';

let instance = null;
let detachTriggers = null;

function attachTriggers(lifecycle) {
  if (detachTriggers || typeof window === 'undefined') return;
  const cleanups = [];

  const onVisibility = () => {
    if (document.visibilityState !== 'hidden') lifecycle.trigger('visible');
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

  const onOnline = () => lifecycle.trigger('online');
  window.addEventListener('online', onOnline);
  cleanups.push(() => window.removeEventListener('online', onOnline));

  // Native resume: the WebView's visibility event is not reliable on every
  // Android build after a long pause, so listen to Capacitor as well. The
  // lifecycle coalesces the duplicate trigger.
  import('@capacitor/app')
    .then(({ App }) => Promise.all([
      App.addListener('resume', () => lifecycle.trigger('resume')),
      // Some Android builds report foreground changes only here.
      App.addListener('appStateChange', ({ isActive }) => { if (isActive) lifecycle.trigger('resume'); }),
    ]))
    .then((handles) => cleanups.push(() => handles.forEach((h) => h?.remove?.())))
    .catch(() => { /* web without the plugin: visibility covers it */ });

  detachTriggers = () => { cleanups.forEach((fn) => fn()); detachTriggers = null; };
}

/**
 * The shared coordinator, created on first call. Returns null outside a
 * browser-like environment.
 */
export function sparkLifecycle() {
  if (instance) return instance;
  if (typeof window === 'undefined') return null;

  let storeRef = null;
  const store = new Proxy({}, {
    get(_, key) {
      if (!storeRef) return undefined;
      const value = storeRef[key];
      return typeof value === 'function' ? value.bind(storeRef) : value;
    },
  });
  import('../stores/wallet.js').then(({ useWalletStore }) => { storeRef = useWalletStore(); }).catch(() => {});

  instance = createSparkLifecycle({
    store,
    subscribe: breezSdk.subscribe,
    peekEntry: breezSdk.peek,
    syncedEventVerified: () => breezSdk.sparkNetwork()?.answeredRecently() ?? false,
    ledger: receiptLedger(),
    deliverReceipt,
    processDeposits: async (deposits, walletId) => {
      const { useBitcoinDepositsStore } = await import('../stores/bitcoinDeposits.js');
      await useBitcoinDepositsStore().processDeposits(deposits, walletId);
    },
    onActivity: (walletId, reason) => {
      // Keep each wallet's exit kit current after activity in either
      // direction (#292: both kits, not only the selected wallet's).
      import('./exitKit.js')
        .then(({ exitKitService }) => exitKitService().refresh(walletId, { reason: `lifecycle:${reason}` }))
        .catch(() => {});
    },
    log: (entry) => {
      if (import.meta.env?.DEV) console.debug('[spark-lifecycle]', entry);
    },
  });

  // Start only once the store exists; initialize() calls start().
  const start = instance.start;
  instance.start = () => {
    const go = () => { trackAppVisibility(); attachTriggers(instance); start(); };
    if (storeRef) go();
    else import('../stores/wallet.js').then(({ useWalletStore }) => { storeRef = useWalletStore(); go(); });
  };
  if (typeof window !== 'undefined') window.__buhoSparkLifecycle = instance; // diagnostics from devtools
  return instance;
}

/** Wallet removed or reset: drop its lifecycle work and receipt history. */
export function forgetSparkWallet(walletId) {
  instance?.forget(walletId);
  forgetWalletReceipts(walletId);
}
