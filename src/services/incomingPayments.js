/**
 * incomingPayments — how BuhoGO tells the user about money that arrives
 * while they are looking at the app, without them having asked for it (a
 * payment to their Lightning address, a deposit landing, a zap).
 *
 * The wallet store reports each one as `lastReceipt` (Spark per payment id
 * from the receipt ledger, other wallets from a balance that went up). The
 * host component (IncomingPaymentHost.vue) asks this module where to show it:
 *
 *   - Home, nothing open on it: the full "Bitcoin received" screen.
 *   - anywhere else (Settings, History, a sheet open on Home): a toast at
 *     the bottom; a tap opens the payment in Transaction details.
 *   - nowhere: in kiosk mode (it has its own screens), or for a payment that
 *     settled while the app was away (the system notification covered it).
 *
 * The Receive sheet confirms the invoice it created itself, with its own
 * screen. It registers each invoice it shows here, and a receipt for one of
 * them is left to the sheet, so the same payment is never announced twice.
 */

import { normalizeTx } from './txNormalizer.js';
import { paymentTimeMs } from './recipientPayments.js';
import { readCachedTransactions } from '../utils/txCache.js';

export const HOME_PATH = '/wallet';

/** How long an invoice on the Receive sheet is expected to be paid there. */
const OPEN_INVOICE_MS = 60 * 60 * 1000;
/** How long after the sheet confirmed it a late balance-based report is still the same payment. */
const CONFIRMED_INVOICE_MS = 2 * 60 * 1000;

/** How long a wallet's history may take before its cached list answers. */
const HISTORY_TIMEOUT_MS = 4000;
const HISTORY_PAGE = 20;

/**
 * Where a receipt is shown: 'screen', 'toast', or null for not at all.
 * @param {{ path: string, dialogOpen: boolean, kiosk: boolean, settledWhileAway: boolean }} context
 */
export function incomingSurface({ path, dialogOpen, kiosk, settledWhileAway }) {
  if (kiosk || settledWhileAway) return null;
  return path === HOME_PATH && !dialogOpen ? 'screen' : 'toast';
}

/** Invoices the Receive sheet shows, by payment hash: { walletId, amountSats, confirmed, until }. */
const receiveInvoices = new Map();

function prune(now) {
  for (const [hash, invoice] of receiveInvoices) if (invoice.until <= now) receiveInvoices.delete(hash);
}

/** The Receive sheet shows this invoice and will confirm its payment itself. */
export function expectReceiveInvoice({ walletId, paymentHash, amountSats = 0 }, now = Date.now()) {
  if (!walletId || !paymentHash) return;
  prune(now);
  receiveInvoices.set(String(paymentHash).toLowerCase(), { walletId, amountSats: Number(amountSats) || 0, confirmed: false, until: now + OPEN_INVOICE_MS });
}

/**
 * The Receive sheet confirmed a payment with its own screen: one of its
 * invoices (by hash), or a Bitcoin deposit it claimed (no hash).
 */
export function confirmReceivePayment({ walletId, paymentHash = null, amountSats = 0 }, now = Date.now()) {
  const key = paymentHash ? String(paymentHash).toLowerCase() : `deposit:${walletId}:${now}`;
  const known = receiveInvoices.get(key);
  receiveInvoices.set(key, {
    walletId: known?.walletId || walletId,
    amountSats: Number(amountSats) || known?.amountSats || 0,
    confirmed: true,
    until: now + CONFIRMED_INVOICE_MS,
  });
}

/** The sheet stopped showing an unpaid invoice: a later payment of it is news again. */
export function forgetReceiveInvoice(paymentHash) {
  const hash = String(paymentHash || '').toLowerCase();
  if (!receiveInvoices.get(hash)?.confirmed) receiveInvoices.delete(hash);
}

/**
 * True when the Receive sheet confirms this receipt's payment. A receipt
 * with a payment hash matches its invoice exactly; one from a balance rise
 * (no hash) matches an invoice of the same wallet and amount.
 */
export function shownByReceive({ walletId, paymentHash, amountSats }, now = Date.now()) {
  prune(now);
  if (paymentHash) return receiveInvoices.has(String(paymentHash).toLowerCase());
  return [...receiveInvoices.values()].some((invoice) =>
    invoice.walletId === walletId && invoice.amountSats > 0 && invoice.amountSats === amountSats);
}

/** The Transaction details route for one payment of one wallet. */
export function transactionRoute(walletId, txId) {
  return `/transaction/${encodeURIComponent(txId)}?wallet=${encodeURIComponent(walletId)}`;
}

/**
 * The id of the payment a balance rise came from, for wallets that report
 * no payment id: the newest settled incoming payment since `sinceMs`, one
 * of exactly `amountSats` first. Reads the first page of the wallet's
 * history, or the list History last showed when there is no provider or it
 * is slow. Null when nothing fits.
 */
export async function findReceivedTransactionId({
  wallet,
  provider,
  amountSats,
  sinceMs,
  readCache = readCachedTransactions,
  timeoutMs = HISTORY_TIMEOUT_MS,
}) {
  if (!wallet?.id) return null;
  const rows = await recentHistory(wallet, provider, readCache, timeoutMs);
  const received = rows
    .map((row) => normalizeTx(row, { walletType: wallet.type }))
    .filter((tx) => tx.id && tx.type === 'incoming' && tx.status !== 'pending' && tx.status !== 'failed')
    .map((tx) => ({ id: tx.id, timeMs: paymentTimeMs(tx), sats: tx.recipientSats || Math.abs(Number(tx.amount) || 0) }))
    // Provider clocks and ours differ a little; a minute of slack keeps the payment in.
    .filter((tx) => !sinceMs || tx.timeMs >= sinceMs - 60000)
    .sort((a, b) => b.timeMs - a.timeMs);
  return (received.find((tx) => tx.sats === amountSats) || received[0])?.id ?? null;
}

async function recentHistory(wallet, provider, readCache, timeoutMs) {
  if (typeof provider?.getTransactions === 'function') {
    let timer = null;
    try {
      const result = await Promise.race([
        provider.getTransactions({ limit: HISTORY_PAGE, offset: 0 }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
      ]);
      const page = Array.isArray(result) ? result : (result?.transactions || []);
      if (page.length) return page;
    } catch {
      // Fall through to what History last showed.
    } finally {
      clearTimeout(timer);
    }
  }
  return readCache(wallet.id) || [];
}
