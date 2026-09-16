/**
 * Orphan recovery — finding nadanada purchases that were paid for but never
 * recorded.
 *
 * The order ledger (./orders.js) makes it impossible to lose a purchase from
 * now on. It does nothing for the purchases already lost: before the ledger
 * existed the app only stored *completed* products, so a payment that never
 * completed left no trace of itself anywhere on the device.
 *
 * Except it did, in the one place nobody thought to look — the wallet's own
 * transaction history. Every nadanada invoice carries a description naming the
 * order it belongs to:
 *
 *   "eSIM Purchase - Order bdb50572-880a-45fb-85ca-b6a5b96bc3a9"
 *   "eSIM Top-up - Order 3952a0e2-c735-4458-a14a-d23cdc3905f9"
 *   "nadanada VPN API day - Order cfeb5868-60a4-43a5-b07c-f990350f737c"
 *
 * That trailing UUID is the `checkoutId`, which every complete endpoint
 * accepts, and the bolt11 itself yields the `paymentHash` even when the wallet
 * stored none (Spark reports `paymentHash: null` on a PREIMAGE_SWAP row). So a
 * settled payment is enough to rebuild the whole order and redeem it.
 *
 * Patterns verified live 2026-08-26 against nadanada API 2.0.0.
 *
 * This module is pure of stores and components: it takes transactions in and
 * gives order records out, so the matching rules can be tested on their own.
 */

import { Invoice } from '@getalby/lightning-tools';
import { ORDER_KIND, ORDER_STATE, newOrderId } from './orders.js';

/**
 * How a nadanada invoice describes itself. Anchored at the start so an
 * unrelated payment that merely mentions an eSIM cannot match, and tolerant of
 * the words between the product and the order id (the VPN description embeds
 * the plan unit, e.g. "VPN API day" / "VPN API month").
 */
const DESCRIPTION_PATTERNS = [
  { kind: ORDER_KIND.ESIM_TOPUP, re: /^eSIM Top-?up\b.*?-\s*Order\s+([0-9a-f-]{36})\s*$/i },
  { kind: ORDER_KIND.ESIM, re: /^eSIM Purchase\b.*?-\s*Order\s+([0-9a-f-]{36})\s*$/i },
  { kind: ORDER_KIND.VPN, re: /^nadanada VPN\b.*?-\s*Order\s+([0-9a-f-]{36})\s*$/i },
];

/** Transaction statuses we treat as "the sats definitely left". */
const SETTLED_STATUSES = new Set(['completed', 'complete', 'settled', 'success', 'paid']);

/**
 * The decoder hands back a Date for the expiry, but the field has been a
 * number of epoch seconds in other releases. Accept either rather than depend
 * on which one this version happens to give us.
 */
function toIsoDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

/**
 * Recognise a nadanada purchase from its BOLT11 invoice.
 *
 * @param {string} bolt11
 * @returns {{
 *   kind: string, checkoutId: string, paymentHash: string|null,
 *   description: string, amountSats: number|null, expiresAt: string|null,
 * }|null} null when this is not a nadanada invoice, or cannot be decoded
 */
export function parseNadanadaInvoice(bolt11) {
  const pr = String(bolt11 || '').trim().replace(/^lightning:/i, '');
  if (!pr) return null;

  let invoice;
  try {
    invoice = new Invoice({ pr });
  } catch {
    return null; // not a decodable invoice; nothing to recover
  }

  const description = typeof invoice.description === 'string' ? invoice.description.trim() : '';
  if (!description) return null;

  for (const { kind, re } of DESCRIPTION_PATTERNS) {
    const m = re.exec(description);
    if (!m) continue;
    return {
      kind,
      checkoutId: m[1].toLowerCase(),
      paymentHash: invoice.paymentHash || null,
      description,
      amountSats: Number.isFinite(invoice.satoshi) ? invoice.satoshi : null,
      expiresAt: toIsoDate(invoice.expiryDate),
    };
  }
  return null;
}

/** Every redemption key already accounted for, so we never import a duplicate. */
function knownKeys(orders) {
  const keys = new Set();
  for (const o of orders || []) {
    if (o?.checkoutId) keys.add(o.checkoutId.toLowerCase());
    if (o?.paymentHash) keys.add(o.paymentHash.toLowerCase());
  }
  return keys;
}

/**
 * Pick out settled outgoing payments that paid for a nadanada order the ledger
 * has never heard of.
 *
 * @param {object[]} transactions — normalised rows (services/txNormalizer.js)
 * @param {object[]} existingOrders — the current ledger
 * @returns {object[]} candidates, newest first
 */
export function findOrphanPayments(transactions, existingOrders = []) {
  const seen = knownKeys(existingOrders);
  const out = [];

  for (const tx of transactions || []) {
    if (tx?.type !== 'outgoing') continue;
    // Only a payment that actually settled can be redeemed. Importing a failed
    // one would park a claim on the user's list that can never resolve.
    const status = String(tx.status || '').toLowerCase();
    if (status && !SETTLED_STATUSES.has(status)) continue;

    const parsed = parseNadanadaInvoice(tx.bolt11 || tx.payment_request);
    if (!parsed) continue;

    const key = parsed.checkoutId;
    const hashKey = parsed.paymentHash?.toLowerCase();
    if (seen.has(key) || (hashKey && seen.has(hashKey))) continue;
    // Guard against the same invoice appearing twice across wallets.
    seen.add(key);
    if (hashKey) seen.add(hashKey);

    out.push({
      ...parsed,
      txId: tx.id || null,
      walletId: tx.walletId || null,
      walletName: tx.walletName || '',
      paidAt: Number.isFinite(tx.timestamp) ? tx.timestamp * 1000 : null,
      priceSats: Number.isFinite(tx.amount) ? tx.amount : parsed.amountSats,
    });
  }

  return out.sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0));
}

/**
 * What a candidate still needs from the user before it can be redeemed.
 *
 * These are not lost choices we are asking them to remember. A VPN's server
 * location is only chosen when the config is generated, so an order that never
 * got that far genuinely has no location yet. A top-up's target ICCID is a
 * choice they did make, but the invoice does not record it, so it has to be
 * named again when more than one eSIM could be meant.
 *
 * @param {object} candidate
 * @param {{ esims?: object[] }} context — what the ledger already holds
 * @returns {'vpn_location'|'esim_target'|null}
 */
export function missingDetailFor(candidate, { esims = [] } = {}) {
  if (candidate?.kind === ORDER_KIND.VPN) return 'vpn_location';
  if (candidate?.kind === ORDER_KIND.ESIM_TOPUP && esims.length !== 1) return 'esim_target';
  return null;
}

/**
 * Turn a candidate into the order record to write to the ledger. The order goes
 * in already `paid`, because the wallet history is the proof — that is the
 * whole basis for recovering it.
 *
 * @param {object} candidate — from findOrphanPayments
 * @param {object} [extras] — the answer to missingDetailFor, plus any labels
 * @returns {object} fields for nadanadaOrders.createOrder()
 */
export function candidateOrderFields(candidate, extras = {}) {
  const now = Date.now();
  return {
    id: newOrderId(),
    kind: candidate.kind,
    state: ORDER_STATE.PAID,
    createdAt: candidate.paidAt || now,
    paidAt: candidate.paidAt || now,
    paymentAttempted: true,
    // Both keys, so redemption works whichever one the provider prefers.
    checkoutId: candidate.checkoutId,
    paymentHash: candidate.paymentHash || null,
    expiresAt: candidate.expiresAt || null,
    priceSats: candidate.priceSats ?? null,
    walletId: candidate.walletId || null,
    walletName: candidate.walletName || '',
    // Marks where this record came from, so the UI can say so plainly and a
    // future reader knows these fields were reconstructed, not captured.
    recovered: true,
    recoveredAt: now,
    ...extras,
  };
}

/**
 * Read recent outgoing payments from every connected wallet.
 *
 * Deliberately bounded and forgiving: one wallet failing (offline, a provider
 * without history, a rate limit) must not stop the others from being searched,
 * because the user is looking for one specific payment and any wallet might
 * hold it.
 *
 * @param {{
 *   wallets: object[],
 *   providers: Record<string, object>,
 *   normalize: (raw: object, ctx: object) => object,
 *   limit?: number,
 *   signal?: AbortSignal,
 * }} input
 * @returns {Promise<{ transactions: object[], scannedWallets: number, failedWallets: number }>}
 */
export async function collectOutgoingPayments({
  wallets = [],
  providers = {},
  normalize,
  limit = 100,
  signal,
} = {}) {
  const transactions = [];
  let scannedWallets = 0;
  let failedWallets = 0;

  for (const wallet of wallets) {
    if (signal?.aborted) break;
    const provider = providers[wallet?.id];
    if (!provider || typeof provider.getTransactions !== 'function') continue;

    try {
      const result = await provider.getTransactions({ limit, offset: 0 });
      const raw = Array.isArray(result) ? result : (result?.transactions || []);
      for (const row of raw) {
        const tx = normalize ? normalize(row, { walletType: wallet.type }) : row;
        transactions.push({ ...tx, walletId: wallet.id, walletName: wallet.name || '' });
      }
      scannedWallets += 1;
    } catch {
      failedWallets += 1;
    }
  }

  return { transactions, scannedWallets, failedWallets };
}
