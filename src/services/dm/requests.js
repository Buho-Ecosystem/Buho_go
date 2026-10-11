/**
 * Payment requests for the contact chat: the money side (docs/CONTACT_CHAT.md
 * section 8).
 *
 * Three jobs, one per wallet-facing question:
 *   1. RECEIVE  - which wallet issues the invoice, and how (`pickReceivingWallet`,
 *      `createRequestInvoice`).
 *   2. DETECT   - did the invoice get paid (`watchRequest`, `reconcileRequests`).
 *   3. PAY      - may this wallet pay a request that arrived (`checkPayable`).
 *
 * Wallet types (all four must work):
 *   - Spark (Breez):  `createInvoice`, push `onPaymentReceived`, `lookupInvoice`.
 *   - LNbits:         `createInvoice`, `lookupInvoice` polling.
 *   - NWC:            `make_invoice` when the wallet grants it, push
 *                     notifications when it offers them, `lookupInvoice` polling.
 *                     The wallet store hands out the raw @getalby/sdk WebLN
 *                     provider (`makeInvoice`, `lookupInvoice({ paymentHash })`,
 *                     `client.subscribeNotifications`) while `NWCWalletProvider`
 *                     speaks `createInvoice`/`lookupInvoice(hash)`; both shapes
 *                     are adapted here, in one place.
 *   - Arkade:         no Lightning receive and no Lightning send. A request is
 *                     issued through the profile Lightning address (LNURL-pay)
 *                     and detected through LUD-21 `verify`, or through the
 *                     wallet that owns that address.
 *
 * Pure service: no Pinia, Vue or i18n. Every collaborator is injected, time and
 * timers included, so the module is unit tested without network or wallets.
 * Failures are `DmError`s with stable codes; the UI picks the words. Invoices,
 * preimages and verify URLs are never logged (docs section 10).
 */

import { decodeBolt11, parseLightningAddress } from 'nostr-core';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canWalletPay } from '../../utils/walletCapabilities.js';
import { paymentHashOf, preimageOf } from '../../utils/breezPayments.js';
import { MAX_NOTE_LENGTH } from './constants.js';
import { DM_ERROR, DmError } from './errors.js';

// ---------------------------------------------------------------------------
// Vocabulary and tuning
// ---------------------------------------------------------------------------

/** How an invoice for a request is obtained. */
export const REQUEST_METHOD = Object.freeze({
  /** The chosen wallet mints the invoice itself. */
  DIRECT: 'direct',
  /** The profile Lightning address mints it over LNURL-pay (LUD-06/12/21). */
  LNURL: 'lnurl',
});

/** Lifetime asked of an invoice. Spark (`expirySecs`), LNbits and NWCWalletProvider take it; the WebLN provider cannot send one. */
export const REQUEST_INVOICE_EXPIRY_SECONDS = 24 * 60 * 60;

/**
 * An invoice that runs out within this many seconds counts as expired when the
 * payer taps Pay: confirming and sliding to send takes a while, and an invoice
 * that dies in between would fail the payment at the worst moment.
 */
export const INVOICE_REFRESH_MARGIN_SECONDS = 60;

/** Prefix of the LUD-12 comment that ties an LNURL invoice to a request. */
export const REQUEST_COMMENT_PREFIX = 'buho:req:';

/** Poll timing, in milliseconds. A push source (event / notification) slows the poll to a safety net. */
export const WATCH_TIMING = Object.freeze({
  POLL_INITIAL_MS: 3_000,
  POLL_MAX_MS: 30_000,
  PUSH_POLL_INITIAL_MS: 20_000,
  PUSH_POLL_MAX_MS: 60_000,
  BACKOFF: 1.5,
  /** The last check runs this long after expiry, so a payment in the final gap is not missed. */
  EXPIRY_GRACE_MS: 1_000,
});

/** How many requests `reconcileRequests` checks at the same time. */
const RECONCILE_CONCURRENCY = 4;

const MSAT_PER_SAT = 1_000;
const WALLET_TYPE = Object.freeze({ SPARK: 'spark', LNBITS: 'lnbits', NWC: 'nwc', ARKADE: 'arkade' });
const HEX_64 = /^[0-9a-f]{64}$/i;
const HEX = /^[0-9a-f]+$/i;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fail(code, message, options) {
  throw new DmError(code, message, options);
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function normalizeAddress(address) {
  if (typeof address !== 'string') return null;
  const trimmed = address.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : null;
}

function hexOrNull(value) {
  return typeof value === 'string' && HEX_64.test(value) ? value.toLowerCase() : null;
}

/** True when `preimage` hashes to `paymentHash`. */
function preimageMatches(preimage, paymentHash) {
  if (!HEX_64.test(preimage) || !HEX_64.test(paymentHash)) return false;
  const bytes = Uint8Array.from(preimage.match(/../g), (pair) => parseInt(pair, 16));
  return bytesToHex(sha256(bytes)) === paymentHash.toLowerCase();
}

async function safely(fn) {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

function callQuietly(fn) {
  if (typeof fn !== 'function') return;
  try {
    const result = fn();
    // An unsubscribe may be async; its failure must not escape either.
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    /* tearing down must never throw */
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Wallet descriptors (what `getWallets()` returns)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} WalletDescriptor  A wallet as the store lists it. Only these
 *   fields are read; the raw store entries (`connectionData`, `metadata`) work too.
 * @property {string} id
 * @property {'spark'|'lnbits'|'nwc'|'arkade'} type
 * @property {string} [lightningAddress]  Its Lightning address (`metadata.lud16` also read).
 * @property {number} [accountNumber]     Spark account: 1 = Business, 2 = Personal.
 * @property {string[]} [methods]         NWC: NIP-47 methods granted (`metadata.methods` also read).
 */

function walletAddress(wallet) {
  return normalizeAddress(wallet.lightningAddress ?? wallet.metadata?.lud16);
}

function walletAccount(wallet) {
  return wallet.accountNumber ?? wallet.connectionData?.accountNumber;
}

/**
 * Whether the wallet can mint an invoice itself. NWC with an unknown method
 * list counts as able: `createRequestInvoice` asks the wallet before relying on it.
 */
function canInvoiceDirectly(wallet) {
  switch (wallet.type) {
    case WALLET_TYPE.SPARK:
    case WALLET_TYPE.LNBITS:
      return true;
    case WALLET_TYPE.NWC: {
      const methods = wallet.methods ?? wallet.metadata?.methods;
      if (!Array.isArray(methods)) return true;
      return methods.includes('make_invoice') || methods.includes('makeInvoice');
    }
    default:
      return false; // Arkade: Lightning receive is retired
  }
}

function findAddressOwner(wallets, address) {
  if (!address) return null;
  return wallets.find((w) => walletAddress(w) === address && w.type !== WALLET_TYPE.ARKADE) || null;
}

/**
 * Choose the wallet that receives a request.
 *
 * With `preferredWalletId` (the user's choice in the sheet) that wallet is used
 * and never silently replaced: if it cannot receive, the answer is `null`.
 * Otherwise: the wallet behind the profile address, then Spark Business, then
 * Spark Personal, then the first wallet that can mint invoices, and last any
 * wallet at all through the profile address (Arkade, NWC without `make_invoice`).
 *
 * @param {WalletDescriptor[]} wallets
 * @param {{ preferredWalletId?: string|null, profileAddress?: string|null }} [options]
 * @returns {{ wallet: WalletDescriptor, method: 'direct'|'lnurl' } | null}
 */
export function pickReceivingWallet(wallets, { preferredWalletId = null, profileAddress = null } = {}) {
  const list = Array.isArray(wallets) ? wallets.filter((w) => isObject(w) && w.id) : [];
  const address = normalizeAddress(profileAddress);
  const direct = (wallet) => ({ wallet, method: REQUEST_METHOD.DIRECT });
  const viaAddress = (wallet) => (address ? { wallet, method: REQUEST_METHOD.LNURL } : null);

  const preferred = preferredWalletId ? list.find((w) => w.id === preferredWalletId) : null;
  if (preferred) return canInvoiceDirectly(preferred) ? direct(preferred) : viaAddress(preferred);

  const sparkWallets = list.filter((w) => w.type === WALLET_TYPE.SPARK);
  const owner = findAddressOwner(sparkWallets, address);
  if (owner) return direct(owner);
  for (const account of [1, 2]) {
    const wallet = sparkWallets.find((w) => walletAccount(w) === account);
    if (wallet) return direct(wallet);
  }
  const capable = list.find(canInvoiceDirectly);
  if (capable) return direct(capable);
  return list.length > 0 ? viaAddress(list[0]) : null;
}

// ---------------------------------------------------------------------------
// Invoice checks
// ---------------------------------------------------------------------------

/**
 * Decode and check an invoice a wallet or LNURL server returned: mainnet,
 * amount equal to the request to the msat, not expired yet.
 * @returns {{ bolt11: string, paymentHash: string, expiresAt: number }}
 */
function validateIssuedInvoice(bolt11, amountSats, nowSec) {
  if (typeof bolt11 !== 'string' || bolt11.trim() === '') {
    fail(DM_ERROR.INVALID_INVOICE, 'no invoice was returned');
  }
  let invoice;
  try {
    invoice = decodeBolt11(bolt11.trim());
  } catch (cause) {
    return fail(DM_ERROR.INVALID_INVOICE, 'invoice does not decode', { cause });
  }
  if (invoice.network !== 'mainnet') fail(DM_ERROR.INVALID_INVOICE, 'invoice is not a mainnet invoice');
  if (invoice.amountMsat !== amountSats * MSAT_PER_SAT) {
    fail(DM_ERROR.INVALID_INVOICE, 'invoice amount does not match the request');
  }
  if (!HEX_64.test(invoice.paymentHash || '')) fail(DM_ERROR.INVALID_INVOICE, 'invoice has no payment hash');
  if (invoice.expiresAt <= nowSec) fail(DM_ERROR.INVALID_INVOICE, 'invoice is already expired');
  return {
    bolt11: invoice.paymentRequest,
    paymentHash: invoice.paymentHash.toLowerCase(),
    expiresAt: invoice.expiresAt,
  };
}

/**
 * Whether the payer needs a fresh invoice to pay this request: the invoice in
 * it has expired or is about to (`INVOICE_REFRESH_MARGIN_SECONDS`).
 *
 * @param {{ expiresAt?: number, bolt11?: string }} request
 * @param {number} nowSec Unix seconds.
 */
export function invoiceNeedsRefresh(request, nowSec) {
  let expiresAt = request?.expiresAt;
  if (!Number.isFinite(expiresAt)) {
    try {
      expiresAt = decodeBolt11(String(request?.bolt11 ?? '').trim()).expiresAt;
    } catch {
      return false; // an undecodable invoice is a different problem (INVALID_INVOICE)
    }
  }
  return expiresAt <= nowSec + INVOICE_REFRESH_MARGIN_SECONDS;
}

/**
 * Payer side: may this wallet pay this request? Runs silently; the result only
 * ever shows as an error state on the card (docs section 2, rule 5).
 *
 * An expired invoice only blocks a request that names no `lud16`: with one,
 * Pay pulls a fresh invoice from it (`pullInvoice`), so the old one expiring is
 * not an obstacle (docs section 8a).
 *
 * @param {{ bolt11: string, amountSats: number, expiresAt?: number, lud16?: string | null }} request
 * @param {{ type: string } | null | undefined} wallet  The wallet that would pay.
 * @param {{ now?: number }} [options]  `now` in unix seconds (default: the clock).
 * @returns {{ ok: true } | { ok: false, reason: string }}  `reason` is `INVALID_INVOICE`,
 *   `INVOICE_EXPIRED` or `WALLET_CANNOT_PAY` from `DM_ERROR`.
 */
export function checkPayable(request, wallet, { now = Math.floor(Date.now() / 1000) } = {}) {
  let invoice;
  try {
    invoice = decodeBolt11(String(request?.bolt11 ?? '').trim());
  } catch {
    return { ok: false, reason: DM_ERROR.INVALID_INVOICE };
  }
  if (
    invoice.network !== 'mainnet'
    || !Number.isSafeInteger(request?.amountSats)
    || invoice.amountMsat !== request.amountSats * MSAT_PER_SAT
  ) {
    return { ok: false, reason: DM_ERROR.INVALID_INVOICE };
  }
  const expiresAt = Number.isFinite(request.expiresAt)
    ? Math.min(request.expiresAt, invoice.expiresAt)
    : invoice.expiresAt;
  if (expiresAt <= now && !request.lud16) return { ok: false, reason: DM_ERROR.INVOICE_EXPIRED };
  if (!wallet || !canWalletPay(wallet.type, 'lightning')) {
    return { ok: false, reason: DM_ERROR.WALLET_CANNOT_PAY };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Provider adapters (the shapes of the four wallet types, in one place)
// ---------------------------------------------------------------------------

/** The raw @getalby/sdk WebLN provider the store keeps for NWC wallets. */
function isWeblnProvider(provider) {
  return typeof provider?.makeInvoice === 'function' && typeof provider?.createInvoice !== 'function';
}

/** Ask the wallet to mint an invoice; returns the BOLT-11 string and the wallet's own hash claim. */
async function mintInvoice(provider, { amountSats, description }) {
  if (isWeblnProvider(provider)) {
    // WebLN reads only `defaultMemo`; it cannot send an expiry.
    const result = await provider.makeInvoice({ amount: amountSats, defaultMemo: description });
    return { bolt11: result?.paymentRequest || result?.invoice || null, paymentHash: null };
  }
  // No Spark-specific flag: a Breez bolt11 invoice already carries the Spark
  // route, and BuhoGO pays with `preferSpark`, so Spark-to-Spark is fee-free.
  const params = { amount: amountSats, description, expiry: REQUEST_INVOICE_EXPIRY_SECONDS };
  const result = await provider.createInvoice(params);
  return {
    bolt11: result?.paymentRequest || result?.payment_request || result?.bolt11 || null,
    paymentHash: result?.paymentHash || result?.payment_hash || null,
  };
}

/** `make_invoice` granted? Unknown (the wallet does not say) counts as granted. */
async function nwcCanMakeInvoice(provider) {
  if (typeof provider?.supportsMethod === 'function') {
    return (await safely(() => provider.supportsMethod('make_invoice'))) !== false;
  }
  const info = await safely(() => provider?.getInfo?.());
  const methods = info?.methods;
  if (!Array.isArray(methods)) return true;
  return methods.includes('make_invoice') || methods.includes('makeInvoice');
}

/** One lookup on the wallet's ledger. @returns {Promise<{ paid: boolean, preimage: string|null }>} */
async function lookupPaid(provider, paymentHash) {
  const result = isWeblnProvider(provider)
    ? await provider.lookupInvoice({ paymentHash })
    : await provider.lookupInvoice(paymentHash);
  return { paid: result?.paid === true, preimage: hexOrNull(result?.preimage) };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/**
 * @typedef {object} OpenRequest  What the watchers need to know about a request.
 * @property {string} [id]                  Echoed back by `reconcileRequests`.
 * @property {string} walletId              Wallet the user chose to receive in.
 * @property {'direct'|'lnurl'} method
 * @property {string} paymentHash           64 hex.
 * @property {number} expiresAt             Unix seconds.
 * @property {string} [settlementWalletId]  lnurl: the wallet behind the profile address, if known.
 * @property {string} [verifyUrl]           lnurl: LUD-21 verify URL.
 *
 * @typedef {{ paymentHash: string, preimage: string|null, settledAt: number }} PaidResult
 */

/**
 * @param {object} deps
 * @param {() => WalletDescriptor[]} deps.getWallets
 * @param {(walletId: string) => object|null} deps.getProvider  Connected provider or null; never connects.
 * @param {(walletId: string) => Promise<object>} deps.ensureConnected  Connects (silently) and returns the provider.
 * @param {() => string|null|undefined} deps.getProfileAddress  Profile `lud16`.
 * @param {{ fetchPayRequest: Function, requestInvoice: Function, verifyPayment: Function }} deps.lnurl
 *   nostr-core's `fetchPayRequest`, `requestLnurlInvoice` and `verifyPayment`.
 * @param {() => number} [deps.now]  Milliseconds.
 * @param {(fn: Function, ms: number) => any} [deps.setTimer]
 * @param {(handle: any) => void} [deps.clearTimer]
 * @param {() => string} [deps.randomReference]  12 hex chars for the LUD-12 comment.
 */
export function createRequestService({
  getWallets,
  getProvider,
  ensureConnected,
  getProfileAddress,
  lnurl,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
  randomReference = () => bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(6))),
} = {}) {
  for (const [name, dep] of Object.entries({ getWallets, getProvider, ensureConnected, getProfileAddress })) {
    if (typeof dep !== 'function') throw new DmError(DM_ERROR.INVALID_ARGUMENT, `${name} is required`);
  }
  if (!lnurl || ['fetchPayRequest', 'requestInvoice', 'verifyPayment'].some((k) => typeof lnurl[k] !== 'function')) {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'lnurl needs fetchPayRequest, requestInvoice and verifyPayment');
  }

  const nowSec = () => Math.floor(now() / 1000);
  const wallets = () => {
    const list = getWallets();
    return Array.isArray(list) ? list : [];
  };

  async function connectedProvider(walletId) {
    const existing = getProvider(walletId);
    if (existing && existing.isConnected !== false) return existing;
    return ensureConnected(walletId);
  }

  // ----- receiving ---------------------------------------------------------

  async function issueDirect(wallet, { amountSats, description }) {
    let provider;
    try {
      provider = await connectedProvider(wallet.id);
    } catch (cause) {
      return fail(DM_ERROR.WALLET_CANNOT_INVOICE, 'wallet is not reachable', { cause });
    }
    if (!provider) fail(DM_ERROR.WALLET_CANNOT_INVOICE, 'wallet is not connected');
    if (wallet.type === WALLET_TYPE.NWC && !(await nwcCanMakeInvoice(provider))) {
      return null; // caller falls back to the profile address
    }
    let minted;
    try {
      minted = await mintInvoice(provider, { amountSats, description });
    } catch (cause) {
      return fail(DM_ERROR.WALLET_CANNOT_INVOICE, 'wallet failed to create the invoice', { cause });
    }
    const invoice = validateIssuedInvoice(minted.bolt11, amountSats, nowSec());
    if (minted.paymentHash && String(minted.paymentHash).toLowerCase() !== invoice.paymentHash) {
      fail(DM_ERROR.INVALID_INVOICE, 'wallet reported a different payment hash than the invoice carries');
    }
    return invoice;
  }

  async function issueViaAddress(address, { amountSats, reference }) {
    let parsed;
    try {
      parsed = parseLightningAddress(address);
    } catch (cause) {
      return fail(DM_ERROR.WALLET_CANNOT_INVOICE, 'profile address is not a Lightning address', { cause });
    }
    const url = `https://${parsed.domain}/.well-known/lnurlp/${encodeURIComponent(parsed.name)}`;
    let callbackResponse;
    let payRequest;
    try {
      payRequest = await lnurl.fetchPayRequest(url);
      const comment = `${REQUEST_COMMENT_PREFIX}${reference}`;
      const options = payRequest.commentAllowed >= comment.length ? { comment } : undefined;
      callbackResponse = await lnurl.requestInvoice(payRequest, amountSats * MSAT_PER_SAT, options);
    } catch (cause) {
      return fail(DM_ERROR.WALLET_CANNOT_INVOICE, 'profile address did not issue an invoice', { cause });
    }
    const invoice = validateIssuedInvoice(callbackResponse?.pr, amountSats, nowSec());
    return { ...invoice, verifyUrl: sameHostVerifyUrl(callbackResponse?.verify, payRequest.callback) };
  }

  /**
   * Create the invoice for one request.
   *
   * @param {object} options
   * @param {string} [options.walletId]  The wallet the user chose to receive in (default: `pickReceivingWallet`).
   * @param {number} options.amountSats  Positive integer.
   * @param {string} [options.note]      Invoice description on a direct invoice.
   * @param {string} [options.requestId] Unused for the wire; accepted so callers can pass one id around.
   * @returns {Promise<{ bolt11: string, paymentHash: string, expiresAt: number, walletId: string,
   *   method: 'direct'|'lnurl', reference: string, verifyUrl?: string, settlementWalletId?: string }>}
   * @throws {DmError} INVALID_ARGUMENT, WALLET_CANNOT_INVOICE, INVALID_INVOICE
   */
  async function createRequestInvoice({ walletId, amountSats, note } = {}) {
    if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
      fail(DM_ERROR.INVALID_ARGUMENT, 'amountSats must be a positive integer');
    }
    if (note !== undefined && note !== null && typeof note !== 'string') {
      fail(DM_ERROR.INVALID_ARGUMENT, 'note must be a string');
    }
    const description = (note || '').trim();
    if (Array.from(description).length > MAX_NOTE_LENGTH) {
      fail(DM_ERROR.MESSAGE_TOO_LARGE, 'note is too long');
    }

    const list = wallets();
    const address = normalizeAddress(getProfileAddress());
    const picked = pickReceivingWallet(list, { preferredWalletId: walletId, profileAddress: address });
    if (!picked) fail(DM_ERROR.WALLET_CANNOT_INVOICE, 'no wallet can receive this request');

    let { method } = picked;
    let issued = null;
    if (method === REQUEST_METHOD.DIRECT) {
      issued = await issueDirect(picked.wallet, { amountSats, description });
      if (!issued) {
        // NWC without make_invoice: the wallet list could not know.
        if (!address) fail(DM_ERROR.WALLET_CANNOT_INVOICE, 'wallet has no make_invoice permission');
        method = REQUEST_METHOD.LNURL;
      }
    }
    const reference = randomReference();
    let settlementWalletId;
    if (method === REQUEST_METHOD.LNURL) {
      issued = await issueViaAddress(address, { amountSats, reference });
      settlementWalletId = findAddressOwner(list, address)?.id;
    }

    const result = {
      bolt11: issued.bolt11,
      paymentHash: issued.paymentHash,
      expiresAt: issued.expiresAt,
      walletId: picked.wallet.id,
      method,
      reference,
    };
    if (issued.verifyUrl) result.verifyUrl = issued.verifyUrl;
    if (settlementWalletId) result.settlementWalletId = settlementWalletId;
    return result;
  }

  /**
   * Payer side: a fresh invoice for a request whose own invoice has expired,
   * pulled from the requester's Lightning address (LNURL-pay) for exactly the
   * requested amount. The address is the `lud16` INSIDE the request (it came
   * through the authenticated seal), never one taken from contact data: a
   * contact's saved address could have been edited or point elsewhere.
   *
   * Validated before it is handed on: the amount lies within the address's
   * min/maxSendable, the invoice decodes, is mainnet, is for exactly
   * `amountSats` and is not yet expired. When the server allows a comment
   * (LUD-12) it carries `buho:req:<reference>`, the same tag as a requester's own
   * LNURL invoices.
   *
   * @param {object} options
   * @param {string} options.lud16 The request's Lightning address.
   * @param {number} options.amountSats The requested amount, whole sats.
   * @param {string} [options.reference] LUD-12 reference (default: random).
   * @returns {Promise<{ bolt11: string, paymentHash: string, expiresAt: number }>}
   * @throws {DmError} INVALID_ARGUMENT, AMOUNT_OUT_OF_RANGE, INVOICE_REFRESH_FAILED
   */
  async function pullInvoice({ lud16, amountSats, reference = randomReference() } = {}) {
    if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
      fail(DM_ERROR.INVALID_ARGUMENT, 'amountSats must be a positive integer');
    }
    let parsed;
    try {
      parsed = parseLightningAddress(lud16);
    } catch (cause) {
      return fail(DM_ERROR.INVOICE_REFRESH_FAILED, 'the request has no usable Lightning address', { cause });
    }
    const url = `https://${parsed.domain}/.well-known/lnurlp/${encodeURIComponent(parsed.name)}`;
    let payRequest;
    try {
      payRequest = await lnurl.fetchPayRequest(url);
    } catch (cause) {
      return fail(DM_ERROR.INVOICE_REFRESH_FAILED, 'the Lightning address did not answer', { cause });
    }
    const amountMsat = amountSats * MSAT_PER_SAT;
    if (!(amountMsat >= payRequest?.minSendable && amountMsat <= payRequest?.maxSendable)) {
      fail(DM_ERROR.AMOUNT_OUT_OF_RANGE, 'the amount is outside what the Lightning address accepts');
    }
    let response;
    try {
      const comment = `${REQUEST_COMMENT_PREFIX}${reference}`;
      const options = payRequest.commentAllowed >= comment.length ? { comment } : undefined;
      response = await lnurl.requestInvoice(payRequest, amountMsat, options);
    } catch (cause) {
      return fail(DM_ERROR.INVOICE_REFRESH_FAILED, 'the Lightning address did not issue an invoice', { cause });
    }
    try {
      const { bolt11, paymentHash, expiresAt } = validateIssuedInvoice(response?.pr, amountSats, nowSec());
      return { bolt11, paymentHash, expiresAt };
    } catch (cause) {
      return fail(DM_ERROR.INVOICE_REFRESH_FAILED, 'the Lightning address issued an invalid invoice', { cause });
    }
  }

  // ----- detecting ---------------------------------------------------------

  /** The wallet whose ledger shows the payment. */
  function ledgerWalletId(request) {
    return request.method === REQUEST_METHOD.DIRECT ? request.walletId : request.settlementWalletId || null;
  }

  function walletTypeOf(walletId) {
    return wallets().find((w) => w.id === walletId)?.type || null;
  }

  async function checkVerify(request) {
    let response;
    try {
      // The URL was pinned to the callback host when it was issued; passing it
      // as its own "callback" keeps nostr-core's https + same-host guard on.
      response = await lnurl.verifyPayment(request.verifyUrl, request.verifyUrl);
    } catch (cause) {
      throw new DmError(DM_ERROR.RELAY_UNAVAILABLE, 'verify poll failed', { cause });
    }
    if (response?.settled !== true) return null;
    const preimage = hexOrNull(response.preimage);
    // A server that names a preimage must name the right one.
    if (response.preimage && !(preimage && preimageMatches(preimage, request.paymentHash))) return null;
    return { preimage };
  }

  async function checkLedger(request, walletId) {
    const provider = await connectedProvider(walletId);
    if (!provider || typeof provider.lookupInvoice !== 'function') {
      throw new DmError(DM_ERROR.WALLET_CANNOT_INVOICE, 'wallet cannot look up invoices');
    }
    const { paid, preimage } = await lookupPaid(provider, request.paymentHash);
    return paid ? { preimage } : null;
  }

  /**
   * One look at every source of truth for this request.
   * @returns {Promise<PaidResult|null>} the payment, or null when still open
   * @throws when every source failed (so a poller can report it)
   */
  async function checkOnce(request) {
    const sources = [];
    if (request.method === REQUEST_METHOD.LNURL && request.verifyUrl) sources.push(() => checkVerify(request));
    const ledger = ledgerWalletId(request);
    if (ledger) sources.push(() => checkLedger(request, ledger));

    const errors = [];
    for (const source of sources) {
      try {
        const paid = await source();
        if (paid) return { paymentHash: request.paymentHash, preimage: paid.preimage, settledAt: nowSec() };
      } catch (error) {
        errors.push(error);
      }
    }
    if (sources.length > 0 && errors.length === sources.length) throw errors[0];
    return null;
  }

  /** Push subscription on the ledger wallet, if its type has one. Resolves to an unsubscribe or null. */
  async function subscribePush(request, onPaid) {
    const walletId = ledgerWalletId(request);
    if (!walletId) return null;
    const type = walletTypeOf(walletId);
    if (type !== WALLET_TYPE.SPARK && type !== WALLET_TYPE.NWC) return null;
    const provider = await connectedProvider(walletId);
    const wanted = request.paymentHash;

    if (type === WALLET_TYPE.SPARK && typeof provider?.onPaymentReceived === 'function') {
      return provider.onPaymentReceived((_id, _balance, payment) => {
        if (String(paymentHashOf(payment) || '').toLowerCase() !== wanted) return;
        onPaid({
          preimage: hexOrNull(preimageOf(payment)),
          settledAt: Number.isFinite(payment?.timestamp) ? payment.timestamp : null,
        });
      });
    }

    if (type === WALLET_TYPE.NWC) {
      const handle = (hash, preimage, settledAt) => {
        if (String(hash || '').toLowerCase() !== wanted) return;
        onPaid({ preimage: hexOrNull(preimage), settledAt: Number.isFinite(settledAt) ? settledAt : null });
      };
      if (typeof provider?.subscribeToPaymentNotifications === 'function') {
        // NWCWalletProvider: callback gets { paymentHash, preimage, settledAt }.
        if ((await provider.supportsNotifications?.()) === false) return null;
        return provider.subscribeToPaymentNotifications((n) => handle(n?.paymentHash, n?.preimage, n?.settledAt));
      }
      const client = provider?.client; // the WebLN provider's NWCClient
      if (typeof client?.subscribeNotifications === 'function') {
        const info = await safely(() => client.getInfo());
        if (!info?.notifications?.includes('payment_received')) return null;
        return client.subscribeNotifications((n) => {
          if (n?.notification_type !== 'payment_received') return;
          handle(n.notification?.payment_hash, n.notification?.preimage, n.notification?.settled_at);
        }, ['payment_received']);
      }
    }
    return null;
  }

  function requireWatchable(request) {
    const valid = isObject(request)
      && typeof request.walletId === 'string'
      && Object.values(REQUEST_METHOD).includes(request.method)
      && HEX_64.test(request.paymentHash || '')
      && Number.isFinite(request.expiresAt);
    if (!valid) fail(DM_ERROR.INVALID_ARGUMENT, 'request needs walletId, method, paymentHash and expiresAt');
    return { ...request, paymentHash: request.paymentHash.toLowerCase() };
  }

  /**
   * Watch one open request until it is paid, `stop()` is called or its invoice
   * expires. `onPaid` runs at most once; after it, a stop or the expiry nothing
   * is left running (no timer, no subscription).
   *
   * @param {OpenRequest} request
   * @param {{ onPaid: (result: PaidResult) => void, onError?: (error: unknown) => void }} handlers
   *   `onError` is optional diagnostics for failed polls; polling carries on.
   * @returns {() => void} stop
   */
  function watchRequest(request, { onPaid, onError } = {}) {
    const open = requireWatchable(request);
    if (typeof onPaid !== 'function') fail(DM_ERROR.INVALID_ARGUMENT, 'onPaid is required');

    let finished = false;
    let timer = null;
    let unsubscribe = null;
    let timing = { initial: WATCH_TIMING.POLL_INITIAL_MS, max: WATCH_TIMING.POLL_MAX_MS };
    let delay = timing.initial;

    const stop = () => {
      if (finished) return;
      finished = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      const off = unsubscribe;
      unsubscribe = null;
      callQuietly(off);
    };

    const paid = ({ preimage = null, settledAt = null } = {}) => {
      if (finished) return;
      stop();
      try {
        onPaid({ paymentHash: open.paymentHash, preimage, settledAt: settledAt ?? nowSec() });
      } catch (error) {
        callQuietly(() => onError?.(error));
      }
    };

    const tick = async () => {
      timer = null;
      if (finished) return;
      const expiresMs = open.expiresAt * 1000;
      const checkedAt = now();
      let result = null;
      try {
        result = await checkOnce(open);
      } catch (error) {
        callQuietly(() => onError?.(error));
      }
      if (finished) return;
      if (result) return paid(result);
      // A check that began at or after expiry is the final one: an expired
      // invoice cannot be paid any more.
      if (checkedAt >= expiresMs) return stop();
      // Never sleep past expiry: the last check lands just after it.
      const wait = Math.max(0, Math.min(delay, expiresMs - now() + WATCH_TIMING.EXPIRY_GRACE_MS));
      delay = Math.min(Math.ceil(delay * WATCH_TIMING.BACKOFF), timing.max);
      timer = setTimer(tick, wait);
    };

    const start = async () => {
      try {
        const off = await subscribePush(open, paid);
        if (typeof off === 'function') {
          if (finished) callQuietly(off);
          else {
            unsubscribe = off;
            timing = { initial: WATCH_TIMING.PUSH_POLL_INITIAL_MS, max: WATCH_TIMING.PUSH_POLL_MAX_MS };
          }
        }
      } catch (error) {
        callQuietly(() => onError?.(error)); // polling still covers the request
      }
      if (finished) return;
      // First look at once (catches a payment made while the app was closed),
      // then the poll. A push source only slows the poll down.
      delay = timing.initial;
      await tick();
    };

    void start();
    return stop;
  }

  /**
   * Check open requests once (app resume) and return the ones that are paid.
   * A request whose sources all fail is skipped; the next resume tries again.
   * Invalid entries are ignored.
   *
   * @param {OpenRequest[]} openRequests
   * @returns {Promise<Array<PaidResult & { id?: string }>>}
   */
  async function reconcileRequests(openRequests) {
    const requests = [];
    for (const request of Array.isArray(openRequests) ? openRequests : []) {
      try {
        requests.push(requireWatchable(request));
      } catch {
        /* not a watchable request */
      }
    }
    const results = await mapLimit(requests, RECONCILE_CONCURRENCY, async (request) => {
      const result = await safely(() => checkOnce(request));
      return result ? { ...(request.id === undefined ? {} : { id: request.id }), ...result } : null;
    });
    return results.filter(Boolean);
  }

  return {
    createRequestInvoice,
    pullInvoice,
    invoiceNeedsRefresh: (request) => invoiceNeedsRefresh(request, nowSec()),
    watchRequest,
    reconcileRequests,
    pickReceivingWallet: (options) => pickReceivingWallet(wallets(), options),
    checkPayable: (request, wallet) => checkPayable(request, wallet, { now: nowSec() }),
  };
}

/**
 * A LUD-21 verify URL is polled by the app on its own, so it must be https and
 * on the callback's host (nostr-core `validateVerifyUrl` rule); anything else is
 * dropped and the request falls back to ledger detection.
 */
function sameHostVerifyUrl(verifyUrl, callbackUrl) {
  if (typeof verifyUrl !== 'string' || typeof callbackUrl !== 'string') return undefined;
  try {
    const verify = new URL(verifyUrl);
    const callback = new URL(callbackUrl);
    if (verify.protocol !== 'https:' || verify.hostname.toLowerCase() !== callback.hostname.toLowerCase()) {
      return undefined;
    }
    return verify.toString();
  } catch {
    return undefined;
  }
}
