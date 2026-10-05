/**
 * The app's one Spark lifecycle coordinator, wired to the real world:
 * the Breez registry's event fan-out, the wallet store, the receipt ledger,
 * deposit processing, exit kits, notification delivery, and the triggers
 * (native resume, page visibility, network restoration).
 *
 * The coordination logic lives in sparkLifecycle.js and is tested there;
 * this module only connects it. Created lazily on first use so importing
 * the wallet store never starts timers (tests, SSR, the audit harness).
 */

import { createSparkLifecycle } from './sparkLifecycle.js';
import { createReceiptLedger, receiptDelivery } from './paymentReceipts.js';
import * as breezSdk from './breezSdk.js';

let instance = null;
let ledger = null;
let detachTriggers = null;

/** Hidden intervals [start, end|null] in unix seconds, newest last. */
const hiddenIntervals = [];
const HIDDEN_INTERVALS_MAX = 20;

function nowS() { return Math.floor(Date.now() / 1000); }

function markHidden() {
  const last = hiddenIntervals[hiddenIntervals.length - 1];
  if (last && last[1] === null) return;
  hiddenIntervals.push([nowS(), null]);
  if (hiddenIntervals.length > HIDDEN_INTERVALS_MAX) hiddenIntervals.shift();
}

function markVisible() {
  const last = hiddenIntervals[hiddenIntervals.length - 1];
  if (last && last[1] === null) last[1] = nowS();
}

function isHiddenNow() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
  const last = hiddenIntervals[hiddenIntervals.length - 1];
  return !!last && last[1] === null;
}

/** Recent visibility history, for the receipt delivery policy and tests. */
export function visibilitySnapshot() {
  return { hiddenNow: isHiddenNow(), hiddenIntervals: hiddenIntervals.map((i) => [...i]) };
}

export function receiptLedger() {
  return (ledger ||= createReceiptLedger());
}

async function deliverReceipt(receipt) {
  try {
    const [{ useWalletStore }, { useNotificationsStore }, { i18n }, { formatAmount }] = await Promise.all([
      import('../stores/wallet.js'),
      import('../stores/notifications.js'),
      import('../boot/i18n.js'),
      import('../utils/amountFormatting.js'),
    ]);
    const walletStore = useWalletStore();
    walletStore.lastReceipt = { walletId: receipt.walletId, amountSats: receipt.amountSats, at: Date.now() };

    const notifications = useNotificationsStore();
    if (!notifications.canNotify) return; // permission or setting says no
    const { system } = receiptDelivery(receipt, visibilitySnapshot());
    if (!system) return; // the user was looking at the app when it settled

    const wallet = walletStore.wallets.find((w) => w.id === receipt.walletId);
    const t = i18n.global.t.bind(i18n.global);
    await notifications.notifyIfEnabled({
      title: t('Payment received'),
      body: t('{amount} · {wallet}', {
        amount: formatAmount(receipt.amountSats, walletStore.useBip177Format),
        wallet: wallet?.name || t('your wallet'),
      }),
      // Settled while hidden: announce even though the app is visible again.
      force: true,
    });
  } catch (error) {
    console.warn('[receipts] delivery failed:', error?.message || error);
  }
}

function attachTriggers(lifecycle) {
  if (detachTriggers || typeof window === 'undefined') return;
  const cleanups = [];

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      markHidden();
    } else {
      markVisible();
      lifecycle.trigger('visible');
    }
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
      App.addListener('pause', () => markHidden()),
      App.addListener('resume', () => { markVisible(); lifecycle.trigger('resume'); }),
    ]))
    .then((handles) => cleanups.push(() => handles.forEach((h) => h?.remove?.())))
    .catch(() => { /* web without the plugin: visibility covers it */ });

  if (document.visibilityState === 'hidden') markHidden();
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
    const go = () => { attachTriggers(instance); start(); };
    if (storeRef) go();
    else import('../stores/wallet.js').then(({ useWalletStore }) => { storeRef = useWalletStore(); go(); });
  };
  if (typeof window !== 'undefined') window.__buhoSparkLifecycle = instance; // diagnostics from devtools
  return instance;
}

/** Wallet removed or reset: drop its lifecycle work and receipt history. */
export function forgetSparkWallet(walletId) {
  instance?.forget(walletId);
  try { receiptLedger().forget(walletId); } catch { /* storage */ }
}
