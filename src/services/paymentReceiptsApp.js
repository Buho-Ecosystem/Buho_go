/**
 * The receipt ledger and its delivery, wired to the real world: one ledger
 * for every wallet on this device, the app's visibility history, and the
 * one way a detected receipt reaches the person (the wallet store's
 * `lastReceipt` for in-app surfaces, a system notification when it settled
 * out of sight). Shared by the Spark lifecycle (sparkLifecycleApp) and the
 * watch over every other wallet (walletWatch).
 *
 * The rules live in paymentReceipts.js and are tested there; this module
 * only connects them.
 */

import { createReceiptLedger, receiptDelivery } from './paymentReceipts.js';
import { onAppVisibility } from '../utils/appVisibility.js';

let ledger = null;
let stopTracking = null;

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

/**
 * Start recording when the app is out of sight. Once per app; every
 * detector calls it before it starts, so delivery can tell a payment that
 * settled while the person was away.
 */
export function trackAppVisibility() {
  if (stopTracking || typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') markHidden();
  stopTracking = onAppVisibility((visible) => (visible ? markVisible() : markHidden()));
}

/** Recent visibility history, for the receipt delivery policy and tests. */
export function visibilitySnapshot() {
  return { hiddenNow: isHiddenNow(), hiddenIntervals: hiddenIntervals.map((i) => [...i]) };
}

/** The device's one receipt ledger. */
export function receiptLedger() {
  return (ledger ||= createReceiptLedger());
}

/**
 * The Receive sheet confirmed this payment with its own screen: the ledger
 * takes it as decided, so the app never announces it a second time, also
 * not after a restart. Wallets that name payments by hash (LNbits, NWC)
 * use the hash as the payment's id.
 */
export function noteReceiptShown(walletId, paymentHash) {
  if (!walletId || !paymentHash) return;
  try { receiptLedger().markSeen(walletId, String(paymentHash).toLowerCase()); } catch { /* storage */ }
}

/** A wallet left this phone: its receipt history goes with it. */
export function forgetWalletReceipts(walletId) {
  try { receiptLedger().forget(walletId); } catch { /* storage */ }
}

/** Tell the person about one detected receipt. Never throws. */
export async function deliverReceipt(receipt) {
  try {
    const [{ useWalletStore }, { useNotificationsStore }, { i18n }, { formatAmount }] = await Promise.all([
      import('../stores/wallet.js'),
      import('../stores/notifications.js'),
      import('../boot/i18n.js'),
      import('../utils/amountFormatting.js'),
    ]);
    const walletStore = useWalletStore();
    const { system } = receiptDelivery(receipt, visibilitySnapshot());
    walletStore.lastReceipt = {
      walletId: receipt.walletId,
      amountSats: receipt.amountSats,
      at: Date.now(),
      paymentId: receipt.id,
      paymentHash: receipt.paymentHash,
      settledWhileAway: system,
    };

    const notifications = useNotificationsStore();
    if (!notifications.canNotifyPayments) return; // permission or setting says no
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
