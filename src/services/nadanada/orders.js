/**
 * nadanada order lifecycle.
 *
 * nadanada sells with NO accounts: there is no login, no order history, no
 * "resend my eSIM to my email". The ONLY thing that can redeem a paid order is
 * its `paymentHash` (Lightning) or `checkoutId` (any payment method), and the
 * only place either exists is this device. Lose them and the money is gone
 * with nothing to show for it.
 *
 * So the app records ORDERS, not products, and it records them *before* the
 * money moves:
 *
 *   created  ──pay──▶  paid  ──redeem──▶  fulfilled
 *                       │
 *                       └──▶ failed   (terminal: 404 / 409 from the API)
 *
 * Both complete endpoints are documented as safe to call repeatedly for the
 * same order, so redemption can be retried freely — on reopening the sheet, on
 * opening the shop, on a button the user presses a week later. This module is
 * the single place that knows how to turn a stored order back into a product,
 * and it is pure so it can be unit-tested without a store or a component.
 */

import { waitForEsim, waitForEsimTopup } from './esim.js';
import { waitForVpnConfig } from './vpn.js';

/** Order lifecycle states. */
export const ORDER_STATE = {
  AWAITING_PAYMENT: 'awaiting_payment',
  PAID: 'paid',
  FULFILLED: 'fulfilled',
  FAILED: 'failed',
};

/** Product kinds. `esim_topup` and `vpn_extend` top up something we already own. */
export const ORDER_KIND = {
  ESIM: 'esim',
  ESIM_TOPUP: 'esim_topup',
  VPN: 'vpn',
  VPN_EXTEND: 'vpn_extend',
};

/** How long a single redemption attempt polls before handing control back.
 *  Short, because the caller can always try again and the order is safe on
 *  disk either way. */
export const REDEEM_ATTEMPT_MS = 90000;

/** A quick one-shot check ("did this actually settle?"), used after a wallet
 *  reports a payment error, so we never re-pay an invoice that already landed. */
export const PROBE_ATTEMPT_MS = 6000;

/**
 * Locally unique order id. Not a server identifier — purely a stable key for
 * the local ledger and for Vue list rendering.
 */
export function newOrderId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Orders that have been paid for but have not produced a product yet. */
export function isPending(order) {
  return order?.state === ORDER_STATE.PAID;
}

/**
 * An order where a payment was sent to the wallet but the wallet reported an
 * error — so we genuinely do not know whether the sats left.
 *
 * These must be treated as claims, not as junk to clean up: a wallet that
 * throws on a payment which actually settled is rare but real, and discarding
 * the order would destroy the only key that could redeem it. Redemption is
 * harmless when nothing was paid (the provider answers 402), so the safe move
 * is always to keep it and keep asking.
 */
export function isUnconfirmed(order) {
  return order?.state === ORDER_STATE.AWAITING_PAYMENT && order?.paymentAttempted === true;
}

/** Orders worth asking the provider about again. */
export function isRedeemable(order) {
  return isPending(order) || isUnconfirmed(order);
}

/** Orders the user still has an outstanding claim on — pending, unconfirmed,
 *  or terminally failed. All three need to stay visible; a failed one is a
 *  support conversation, not something to quietly delete. */
export function needsAttention(order) {
  return isRedeemable(order) || order?.state === ORDER_STATE.FAILED;
}

/**
 * True once an unconfirmed order can be written off with certainty.
 *
 * A Lightning invoice cannot settle after it expires, so an order that was
 * never confirmed and whose invoice has lapsed definitively took no money.
 * Only then is it safe to stop showing it — anything less would be guessing
 * with the user's sats.
 */
export function isDefinitivelyUnpaid(order, now = Date.now()) {
  if (order?.state !== ORDER_STATE.AWAITING_PAYMENT) return false;
  const expiry = invoiceDeadline(order);
  return Number.isFinite(expiry) && expiry < now;
}

/** Epoch ms of the invoice expiry, or undefined when it carries none.
 *  Only used to stop polling an invoice that can no longer be paid — it does
 *  NOT limit redemption of one that already was. */
export function invoiceDeadline(order) {
  const t = order?.expiresAt ? Date.parse(order.expiresAt) : NaN;
  return Number.isFinite(t) ? t : undefined;
}

/**
 * The short human reference for an order. This is the receipt: it is what the
 * user copies into a support message, and the only handle nadanada can look an
 * order up by. Prefer their own order reference once we have one.
 */
export function orderReference(order) {
  if (!order) return '';
  if (order.orderReference) return order.orderReference;
  const key = order.paymentHash || order.checkoutId || '';
  return key ? key.slice(0, 12) : '';
}

/** Everything a support message needs, in one copyable block. */
export function orderReceiptText(order) {
  if (!order) return '';
  const lines = [
    `nadanada order (${order.kind || 'unknown'})`,
    order.title ? `Item: ${order.title}` : null,
    order.paymentHash ? `Payment hash: ${order.paymentHash}` : null,
    order.checkoutId ? `Checkout ID: ${order.checkoutId}` : null,
    order.orderReference ? `Order reference: ${order.orderReference}` : null,
    order.iccid ? `ICCID: ${order.iccid}` : null,
    order.publicKey ? `Public key: ${order.publicKey}` : null,
    order.paidAt ? `Paid: ${new Date(order.paidAt).toISOString()}` : null,
    Number.isFinite(order.priceSats) ? `Amount: ${order.priceSats} sats` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Try to turn a paid order into its product.
 *
 * Never throws for an API failure — every outcome is a value the caller can
 * render, because the whole point of this module is that there is no state the
 * user can be dumped into without an explanation and a next step.
 *
 * @param {object} order — a stored order record
 * @param {{ signal?: AbortSignal, maxMs?: number }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   patch?: object,        // merge into the order on success
 *   fatal?: boolean,       // terminal: retrying will never help
 *   error?: string,        // human-readable reason
 *   code?: string|null,    // nadanada's machine code, for support
 * }>}
 * @throws {DOMException} AbortError only, when the caller aborts
 */
export async function redeemOrder(order, { signal, maxMs = REDEEM_ATTEMPT_MS } = {}) {
  if (!order) return { ok: false, fatal: true, error: 'Missing order' };
  const keys = { paymentHash: order.paymentHash, checkoutId: order.checkoutId };
  if (!keys.paymentHash && !keys.checkoutId) {
    return { ok: false, fatal: true, error: 'This order has no payment reference' };
  }
  const common = { ...keys, signal, maxMs, deadline: undefined };
  const now = Date.now();

  try {
    switch (order.kind) {
      case ORDER_KIND.ESIM: {
        const res = await waitForEsim(common);
        if (res.ok) {
          return {
            ok: true,
            patch: {
              state: ORDER_STATE.FULFILLED,
              fulfilledAt: now,
              iccid: res.esim.iccid,
              orderReference: res.esim.orderReference || order.orderReference || '',
              installation: res.esim.installation,
              providerBundleName: res.esim.bundleName || order.providerBundleName || '',
              lastError: null,
              lastErrorCode: null,
            },
          };
        }
        return passthrough(res);
      }

      case ORDER_KIND.ESIM_TOPUP: {
        const res = await waitForEsimTopup({ ...common, iccid: order.targetIccid || order.iccid });
        if (res.ok) {
          return {
            ok: true,
            patch: {
              state: ORDER_STATE.FULFILLED,
              fulfilledAt: now,
              iccid: res.topup.iccid || order.targetIccid || order.iccid,
              lastError: null,
              lastErrorCode: null,
            },
          };
        }
        return passthrough(res);
      }

      case ORDER_KIND.VPN:
      case ORDER_KIND.VPN_EXTEND: {
        const res = await waitForVpnConfig({
          ...common,
          country: order.country,
          keypair: order.publicKey && order.privateKey
            ? { publicKey: order.publicKey, privateKey: order.privateKey }
            : undefined,
          presharedKey: order.presharedKey || undefined,
        });
        if (res.ok) {
          return {
            ok: true,
            patch: {
              state: ORDER_STATE.FULFILLED,
              fulfilledAt: now,
              config: res.config,
              configIsRaw: res.raw === true,
              publicKey: res.publicKey,
              privateKey: res.privateKey,
              presharedKey: res.presharedKey,
              lastError: null,
              lastErrorCode: null,
            },
          };
        }
        // A 409 means the config for this payment was issued and we do not
        // have it. Keep the keys on the order so the subscription is at least
        // identifiable, and mark it terminal so nobody polls into a wall.
        if (res.fatal) {
          return {
            ok: false,
            fatal: true,
            error: res.error,
            code: res.code || null,
            patch: {
              publicKey: res.publicKey || order.publicKey,
              privateKey: res.privateKey || order.privateKey,
              presharedKey: res.presharedKey || order.presharedKey,
            },
          };
        }
        return passthrough(res);
      }

      default:
        return { ok: false, fatal: true, error: `Unknown order type: ${order.kind}` };
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // A network problem is not terminal — the order stays redeemable.
    return { ok: false, error: err?.message || 'Network error', code: err?.code || null };
  }
}

/** Map a service-level "not yet / terminal" result onto the redeem contract. */
function passthrough(res) {
  return res.fatal
    ? { ok: false, fatal: true, error: res.error, code: res.code || null }
    : { ok: false };
}

/**
 * Walk a list of orders and try to redeem each one, applying every result via
 * `apply(orderId, patch, outcome)`. Sequential on purpose: these are money
 * operations against a rate-limited API (heavy parallel probing trips their
 * Cloudflare limit), and there are never many pending at once.
 *
 * @param {object[]} orders
 * @param {(id: string, patch: object|null, outcome: object) => void} apply
 * @param {{ signal?: AbortSignal, maxMs?: number }} [opts]
 * @returns {Promise<{ fulfilled: number, failed: number, stillPending: number }>}
 */
export async function redeemAll(orders, apply, { signal, maxMs = 20000 } = {}) {
  const out = { fulfilled: 0, failed: 0, stillPending: 0 };
  for (const order of orders || []) {
    if (signal?.aborted) break;
    let res;
    try {
      res = await redeemOrder(order, { signal, maxMs });
    } catch (err) {
      if (err?.name === 'AbortError') break;
      throw err;
    }
    if (res.ok) {
      out.fulfilled += 1;
      apply(order.id, res.patch, res);
    } else if (res.fatal) {
      out.failed += 1;
      apply(order.id, {
        ...(res.patch || {}),
        state: ORDER_STATE.FAILED,
        lastError: res.error || '',
        lastErrorCode: res.code || null,
      }, res);
    } else {
      out.stillPending += 1;
      apply(order.id, {
        attempts: (order.attempts || 0) + 1,
        lastTriedAt: Date.now(),
        lastError: res.error || null,
      }, res);
    }
  }
  return out;
}
