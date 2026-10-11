/**
 * The contact chat's runtime: everything the app needs for ONE identity,
 * composed from the `services/dm/` modules and the app's stores.
 *
 * `createChatRuntime(deps)` wires
 *
 *   key holder (sessionKey)  ->  relay transport  ->  inbox coordinator
 *                                 inbox relay resolver ----^
 *   wallets / LNURL           ->  request service
 *   messages store            ->  `InboxStore` port (`createInboxStoreAdapter`)
 *
 * and exposes the small set of actions the chat screen uses (section "UI
 * actions" of the returned object) plus the lifecycle hooks the boot file
 * drives (`start`, `stop`, `dispose`, `wipeKey*`, `retryOutbox`, `reconcile`).
 *
 * No Vue, Pinia or i18n is imported. Every app collaborator comes in through
 * `deps` as a plain function or object, so the runtime is tested with fakes
 * (see `__tests__/runtime.spec.js`) and `appRuntime.js` is the only place that
 * knows the real stores. Strings never live here: the notification body comes
 * from the injected `formatNotification(message)`, errors are `DmError` codes.
 * Message text, invoices, preimages and keys are never logged.
 *
 * One runtime belongs to one identity. When the identity changes the boot
 * disposes it (the key is zeroed, connections authenticated as the old
 * identity are closed) and builds a new one.
 *
 * Money flow of a request the user sends (docs/CONTACT_CHAT.md section 8):
 *   1. `requestMoney` checks the partner can receive messages, mints ONE
 *      invoice (`requests.createRequestInvoice`), sends the request message
 *      and records where it gets paid (`store.setRequestSource`).
 *   2. The request service watches the invoice (push where the wallet has it,
 *      polling otherwise, `reconcile()` on resume).
 *   3. When it is paid: the source record is marked paid, the incoming
 *      transaction is linked to the contact, and a `paid` status message goes
 *      to the partner. The store only derives `paid` from the PAYER's status,
 *      so the requester's own certainty lives in the source record and is
 *      read through `requestState(id)` / `requestSettlement(id)`.
 *   4. The invoice watcher ends with the 24 h invoice, the request does not
 *      (docs section 8a). A payment that comes later (the payer pulled a
 *      fresh invoice with `refreshInvoice`, or sent money anyway) is announced
 *      by the payer; `settleClaims` checks that announcement against the
 *      user's own wallet ledger and only then records the request as paid.
 */

import { nip19 } from 'nostr-core';
import { stableNotificationId } from '../paymentNotifications.js';
import { DM_DISCOVERY_RELAYS } from './constants.js';
import { DM_ERROR, DmError } from './errors.js';
import { createInbox, createSignAuth } from './inbox.js';
import { INBOX_STATUS, createInboxRelayResolver } from './inboxRelays.js';
import { matchIncomingPayments } from './paymentConfirmation.js';
import {
  MESSAGE_TYPE,
  REQUEST_STATUS,
  buildPaymentTemplate,
  buildReactionTemplate,
  buildRequestTemplate,
  buildStatusTemplate,
  buildTextTemplate,
} from './protocol.js';
import { createRequestService } from './requests.js';
import { createSessionKey } from './sessionKey.js';
import { createDmTransport } from './transport.js';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** What `partnerReachability` answers; the same three values as the resolver. */
export const REACHABILITY = INBOX_STATUS;

/** Route of a chat with a saved contact. */
export const contactChatRoute = (contactId) => `/address-book/${encodeURIComponent(contactId)}/chat`;

/**
 * Route of a chat with a sender who is not in the address book. The route does
 * not exist yet: the UI decides what it shows (the "Unknown" section of the
 * messages list, most likely). A notification tap on it must be handled there.
 */
export const unknownChatRoute = (pubkey) => `/messages/${pubkey}`;

const HEX_64 = /^[0-9a-f]{64}$/;

/** Request states in which the user's own request is over (nothing left to watch). */
const OVER_STATES = new Set(['declined', 'cancelled', 'expired']);

const noop = () => {};

/** The names of the UI-facing actions, shared with `useChatRuntime`. */
export const CHAT_ACTIONS = Object.freeze([
  'sendText',
  'requestMoney',
  'declineRequest',
  'cancelRequest',
  'remindRequest',
  'announcePayment',
  'react',
  'retry',
  'checkPayable',
  'needsFreshInvoice',
  'refreshInvoice',
  'partnerReachability',
  'requestState',
  'requestSettlement',
  'settleClaims',
]);

/**
 * When the ledger is looked at again for a payment claim that no wallet shows
 * yet (a wallet's history lags a payment by seconds). Then the claim stays
 * "reported, not verified" until the next resume.
 */
const CLAIM_RETRY_MS = Object.freeze([5_000, 20_000, 60_000]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const invalid = (message) => new DmError(DM_ERROR.INVALID_ARGUMENT, message);

function normalizePubkey(value, label = 'partner') {
  const hex = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!HEX_64.test(hex)) throw invalid(`${label} must be a 64-character hex pubkey`);
  return hex;
}

function normalizeAddress(address) {
  if (typeof address !== 'string') return undefined;
  const trimmed = address.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : undefined;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

/** `npub1abcdefg…`: how an unnamed sender is shown. */
function shortNpub(pubkey) {
  try {
    return `${nip19.npubEncode(pubkey).slice(0, 12)}…`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

// ---------------------------------------------------------------------------
// Store adapter: the `InboxStore` port of inbox.js on top of the messages store
// ---------------------------------------------------------------------------

/**
 * Map the inbox's store port onto the Pinia messages store.
 *
 * Every call is guarded by the store's scope: while the store holds another
 * identity (or none) the adapter reads empty and writes nothing, so a late
 * callback of a disposed runtime can never touch the wrong identity's data.
 *
 * Mapping:
 *   getSyncCursor / setSyncCursor     -> `syncCursor` / `setSyncCursor`
 *   hasMessage                        -> scan of the threads (ids are unique)
 *   ingest                            -> `ingest`, true only for a NEW message
 *   addOutgoing / setDelivery         -> same-named actions
 *   isBlocked                         -> `isBlocked`
 *   outbox.list / put / remove        -> `outbox` (as detached copies) /
 *                                        `enqueueOutbox` / `dequeueOutbox`
 *   get/setInboxRelaySnapshot         -> `inboxRelays` / `setInboxRelaySnapshot`
 *
 * @param {object} store The messages store.
 * @param {string} me Pubkey of the identity this adapter serves.
 * @returns {import('./inbox.js').InboxStore}
 */
export function createInboxStoreAdapter(store, me) {
  const active = () => store.scope === me;
  return {
    getSyncCursor: () => (active() ? store.syncCursor : null),
    setSyncCursor(seconds) {
      if (active()) store.setSyncCursor(seconds);
    },
    hasMessage(id) {
      if (!active()) return false;
      for (const thread of Object.values(store.threads)) {
        if (thread.messages.some((message) => message.id === id)) return true;
      }
      return false;
    },
    ingest: (message, options) => active() && store.ingest(message, options) === true,
    addOutgoing: (message, options) => active() && store.addOutgoing(message, options),
    setDelivery: (id, delivery) => active() && store.setDelivery(id, delivery),
    isBlocked: (pubkey) => active() && store.isBlocked(pubkey),
    outbox: {
      // Detached copies: the inbox edits an item and then `put`s it back, and
      // must not mutate reactive store state behind the store's back.
      list: () => (active() ? plain(store.outbox) : []),
      put(item) {
        if (active()) store.enqueueOutbox(item);
      },
      remove(id) {
        if (active()) store.dequeueOutbox(id);
      },
    },
    getInboxRelaySnapshot: () => (active() && store.inboxRelays ? plain(store.inboxRelays) : null),
    setInboxRelaySnapshot(snapshot) {
      if (active()) store.setInboxRelaySnapshot(snapshot ?? null);
    },
  };
}

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ChatContact
 * @property {string} id Address book entry id (used in the chat route).
 * @property {string} name Display name.
 */

/**
 * @typedef {object} ChatRuntimeDeps
 * @property {string} me Own pubkey (64 lowercase hex).
 * @property {() => Promise<Uint8Array>} loadSecretKey Fresh key bytes (`identity.getNostrSecretKeyBytes`).
 * @property {() => boolean} [isLocked] True while the app lock is on: the key is then never loaded.
 * @property {object} store The messages store, already scoped to `me`.
 * @property {{
 *   list: () => import('./requests.js').WalletDescriptor[],
 *   getProvider: (walletId: string) => object | null,
 *   ensureConnected: (walletId: string) => Promise<object>,
 * }} wallets Wallet access for the request service. `ensureConnected` must connect silently.
 * @property {() => string | null | undefined} getProfileAddress The profile's `lud16`.
 * @property {{ fetchPayRequest: Function, requestInvoice: Function, verifyPayment: Function }} lnurl
 * @property {{ find: (pubkey: string) => ChatContact | null }} contacts
 * @property {{ message: (notification: object) => Promise<boolean> | boolean }} notifications
 *   Posts a chat notification (`notifyMessageIfEnabled`); decides on settings and permission.
 * @property {(message: import('./protocol.js').ChatMessage) => string} formatNotification
 *   Translated notification body for an incoming message.
 * @property {string | (() => string)} [channelName] Translated name of the Android `messages` channel
 *   (a function is called per notification, so a language change applies at once).
 * @property {() => boolean} [isHidden] True while the app is out of sight (default: never).
 * @property {(link: { contactId: string | null, walletId: string, amountSats: number, note: string | null }) => unknown} [linkPayment]
 *   Links the incoming transaction of a paid request to the contact (best effort).
 * @property {() => Promise<import('./paymentConfirmation.js').IncomingTransaction[]>} [loadIncomingTransactions]
 *   The settled incoming transactions of the user's wallets, each with its `walletId`. Without it a
 *   payment the partner reports after the invoice expired can never be verified.
 * @property {(url: string, options: { connectionTimeout: number }) => Promise<object>} ensureRelay
 *   The shared relay pool's `ensureRelay` (used by the relay list resolver).
 * @property {typeof WebSocket} [WebSocket]
 * @property {() => number} [now] Milliseconds.
 * @property {typeof setTimeout} [setTimer]
 * @property {typeof clearTimeout} [clearTimer]
 * @property {object} [inboxOptions] Extra `createInbox` options (tests tune retries with it).
 * @property {{
 *   createTransport?: Function, createResolver?: Function, createRequests?: Function,
 * }} [factories] Replacement constructors, for tests.
 */

/**
 * Create the chat runtime for one identity.
 *
 * @param {ChatRuntimeDeps} deps
 * @throws {DmError} INVALID_ARGUMENT for a missing or malformed dependency.
 */
export function createChatRuntime(deps = {}) {
  const {
    loadSecretKey,
    isLocked = () => false,
    store,
    wallets,
    getProfileAddress,
    lnurl,
    contacts,
    notifications,
    formatNotification,
    channelName,
    isHidden = () => false,
    linkPayment,
    loadIncomingTransactions,
    ensureRelay,
    WebSocket,
    now = Date.now,
    setTimer,
    clearTimer,
    inboxOptions,
    factories = {},
  } = deps;
  const me = normalizePubkey(deps.me, 'me');
  const required = { loadSecretKey, getProfileAddress, formatNotification, ensureRelay };
  for (const [name, value] of Object.entries(required)) {
    if (typeof value !== 'function') throw invalid(`${name} is required`);
  }
  if (!store || typeof store.ingest !== 'function') throw invalid('store is required');
  if (typeof wallets?.list !== 'function') throw invalid('wallets is required');
  if (typeof contacts?.find !== 'function') throw invalid('contacts is required');
  if (typeof notifications?.message !== 'function') throw invalid('notifications is required');

  const nowSeconds = () => Math.floor(now() / 1000);

  // ----- composition -----------------------------------------------------

  const sessionKey = createSessionKey({
    pubkey: me,
    load: async () => {
      // While the app is locked the key must stay out of memory, whatever asks
      // for it (a live wrap, an AUTH challenge, a retry timer). KEY_WIPED makes
      // the inbox keep the work until the key is available again.
      if (isLocked()) throw new DmError(DM_ERROR.KEY_WIPED, 'the app is locked');
      return loadSecretKey();
    },
    setTimer,
    clearTimer,
  });

  const transport = (factories.createTransport ?? createDmTransport)({
    signAuth: createSignAuth(sessionKey),
    WebSocket,
  });

  const resolver = (factories.createResolver ?? createInboxRelayResolver)({
    ensureRelay,
    discoveryRelays: DM_DISCOVERY_RELAYS,
    now,
    setTimer,
    clearTimer,
  });

  const requests = (factories.createRequests ?? createRequestService)({
    getWallets: () => wallets.list(),
    getProvider: (walletId) => wallets.getProvider(walletId),
    ensureConnected: (walletId) => wallets.ensureConnected(walletId),
    getProfileAddress,
    lnurl,
    now,
    setTimer,
    clearTimer,
  });

  const storePort = createInboxStoreAdapter(store, me);

  const inbox = createInbox({
    me,
    sessionKey,
    transport,
    resolver,
    store: storePort,
    now,
    setTimer,
    clearTimer,
    onIncoming: (message) => onIncoming(message),
    ...inboxOptions,
  });

  // ----- state -----------------------------------------------------------

  let started = false;
  let disposed = false;
  /** @type {Map<string, () => void>} request id -> stop of its payment watcher */
  const watchers = new Map();
  let reconcileRun = null;

  function assertUsable() {
    if (disposed) throw new DmError(DM_ERROR.NO_IDENTITY, 'the chat runtime was disposed');
    if (store.scope !== me) throw new DmError(DM_ERROR.NO_IDENTITY, 'the chat store belongs to another identity');
  }

  // ----- helpers over the store -----------------------------------------

  function findMessage(partner, id) {
    return store.thread(partner).messages.find((message) => message.id === id) ?? null;
  }

  /** Find a request in `partner`'s thread, from the expected side. */
  function requireRequest(partner, requestId, { outgoing }) {
    const id = normalizePubkey(requestId, 'requestId');
    const message = findMessage(partner, id);
    if (!message || message.type !== MESSAGE_TYPE.REQUEST || message.outgoing !== outgoing) {
      throw invalid('no such request in this conversation');
    }
    if (store.requestStatus(id, nowSeconds()) !== 'pending') {
      throw invalid('the request is no longer open');
    }
    return message;
  }

  async function sendTemplate(partner, template) {
    assertUsable();
    return inbox.send({ partner, template });
  }

  // ----- UI actions ------------------------------------------------------

  /**
   * Send a text message.
   * @param {string} partner Contact pubkey (hex).
   * @param {string} text
   * @param {{ replyTo?: string }} [options]
   * @returns {Promise<import('./protocol.js').ChatMessage>} The stored message; delivery continues in the background.
   * @throws {DmError} INVALID_ARGUMENT, MESSAGE_TOO_LARGE, SECRET_KEY_IN_TEXT, NO_INBOX_RELAYS, KEY_WIPED, NO_IDENTITY
   */
  async function sendText(partner, text, { replyTo } = {}) {
    const recipient = normalizePubkey(partner);
    const template = buildTextTemplate({ recipient, text, replyTo, now: nowSeconds });
    return sendTemplate(recipient, template);
  }

  /**
   * Ask the partner for money: mint an invoice, send the request and watch it.
   *
   * @param {string} partner
   * @param {{ amountSats: number, note?: string, walletId?: string }} options
   *   `walletId` is the wallet the user chose to receive in (default: the wallet behind the profile address).
   * @returns {Promise<import('./protocol.js').ChatMessage>} The request message.
   * @throws {DmError} NO_INBOX_RELAYS (nothing is minted then), WALLET_CANNOT_INVOICE, INVALID_INVOICE,
   *   INVALID_ARGUMENT, MESSAGE_TOO_LARGE, KEY_WIPED, NO_IDENTITY
   */
  async function requestMoney(partner, { amountSats, note, walletId } = {}) {
    const recipient = normalizePubkey(partner);
    assertUsable();
    // A partner without an inbox list cannot receive a message (NIP-17): fail
    // before an invoice exists that nobody could ever pay.
    if ((await partnerReachability(recipient)) === REACHABILITY.MISSING) {
      throw new DmError(DM_ERROR.NO_INBOX_RELAYS, 'the contact has no inbox relay list');
    }
    const cleanNote = typeof note === 'string' && note.trim() ? note.trim() : undefined;
    const invoice = await requests.createRequestInvoice({ walletId, amountSats, note: cleanNote });
    const template = buildRequestTemplate({
      recipient,
      amountSats,
      bolt11: invoice.bolt11,
      note: cleanNote,
      lud16: normalizeAddress(getProfileAddress()),
      now: nowSeconds,
    });
    const message = await sendTemplate(recipient, template);

    const source = {
      walletId: invoice.walletId,
      method: invoice.method,
      paymentHash: invoice.paymentHash,
      expiresAt: invoice.expiresAt,
      amountSats,
      note: cleanNote ?? null,
      paidAt: null,
      preimage: null,
      announced: false,
    };
    if (invoice.verifyUrl) source.verifyUrl = invoice.verifyUrl;
    if (invoice.settlementWalletId) source.settlementWalletId = invoice.settlementWalletId;
    store.setRequestSource(message.id, source);
    watch(message.id);
    return message;
  }

  /** Decline a request the partner sent. */
  async function declineRequest(partner, requestId) {
    const recipient = normalizePubkey(partner);
    assertUsable();
    const request = requireRequest(recipient, requestId, { outgoing: false });
    return sendTemplate(recipient, buildStatusTemplate({
      recipient, requestId: request.id, value: REQUEST_STATUS.DECLINED, now: nowSeconds,
    }));
  }

  /** Withdraw a request the user sent; its invoice is no longer watched. */
  async function cancelRequest(partner, requestId) {
    const recipient = normalizePubkey(partner);
    assertUsable();
    const request = requireRequest(recipient, requestId, { outgoing: true });
    const sent = await sendTemplate(recipient, buildStatusTemplate({
      recipient, requestId: request.id, value: REQUEST_STATUS.CANCELLED, now: nowSeconds,
    }));
    stopWatching(request.id);
    store.clearRequestSource(request.id);
    return sent;
  }

  /** Nudge the partner about a request the user sent and that is still open. */
  async function remindRequest(partner, requestId) {
    const recipient = normalizePubkey(partner);
    assertUsable();
    const request = requireRequest(recipient, requestId, { outgoing: true });
    return sendTemplate(recipient, buildStatusTemplate({
      recipient, requestId: request.id, value: REQUEST_STATUS.REMINDER, now: nowSeconds,
    }));
  }

  /**
   * Tell the partner about a payment the existing send pipeline just made.
   * Best effort by nature: the money is already gone, so a failure of the
   * follow-up `paid` status is returned, not thrown.
   *
   * @param {string} partner
   * @param {{ amountSats: number, note?: string, preimage?: string, requestId?: string }} payment
   * @returns {Promise<{ payment: import('./protocol.js').ChatMessage,
   *   status: import('./protocol.js').ChatMessage | null, statusError: string | null }>}
   * @throws {DmError} when the payment message itself cannot be written or sent
   *   (NO_INBOX_RELAYS, INVALID_ARGUMENT, KEY_WIPED, ...).
   */
  async function announcePayment(partner, { amountSats, note, preimage, requestId } = {}) {
    const recipient = normalizePubkey(partner);
    assertUsable();
    const reference = requestId === undefined || requestId === null ? undefined : normalizePubkey(requestId, 'requestId');
    const cleanNote = typeof note === 'string' && note.trim() ? note.trim() : undefined;
    const cleanPreimage = typeof preimage === 'string' && preimage ? preimage.toLowerCase() : undefined;

    const sent = await sendTemplate(recipient, buildPaymentTemplate({
      recipient, amountSats, preimage: cleanPreimage, note: cleanNote, requestId: reference, now: nowSeconds,
    }));
    if (!reference) return { payment: sent, status: null, statusError: null };

    try {
      const status = await sendTemplate(recipient, buildStatusTemplate({
        recipient,
        requestId: reference,
        value: REQUEST_STATUS.PAID,
        preimage: cleanPreimage,
        amountSats,
        now: nowSeconds,
      }));
      return { payment: sent, status, statusError: null };
    } catch (error) {
      return { payment: sent, status: null, statusError: DmError.is(error) ? error.code : DM_ERROR.RELAY_UNAVAILABLE };
    }
  }

  /** React to a message with an emoji (`+`, `-` or an emoji). */
  async function react(partner, targetId, emoji) {
    const recipient = normalizePubkey(partner);
    const template = buildReactionTemplate({
      recipient, targetId: normalizePubkey(targetId, 'targetId'), emoji, now: nowSeconds,
    });
    return sendTemplate(recipient, template);
  }

  /**
   * Send a failed or waiting message again, with a fresh retry budget.
   * @returns {Promise<boolean>} False when the message is not in the outbox.
   */
  async function retry(messageId) {
    assertUsable();
    return inbox.retry(normalizePubkey(messageId, 'messageId'));
  }

  /**
   * May this wallet pay this request? Silent: the UI shows the answer as the
   * state of the card.
   *
   * @param {{ bolt11: string, amountSats: number, expiresAt?: number }} request
   * @param {string} walletId
   * @returns {{ ok: true } | { ok: false, reason: string }} `reason` is `INVALID_INVOICE`,
   *   `INVOICE_EXPIRED` or `WALLET_CANNOT_PAY`.
   */
  function checkPayable(request, walletId) {
    const wallet = wallets.list().find((entry) => entry.id === walletId) ?? null;
    return requests.checkPayable(request, wallet);
  }

  /**
   * Has the invoice of this request expired (or does it within a minute), so
   * that paying it needs a fresh one (`refreshInvoice`)?
   *
   * @param {{ bolt11: string, expiresAt?: number }} request
   * @returns {boolean}
   */
  function needsFreshInvoice(request) {
    return requests.invoiceNeedsRefresh(request);
  }

  /**
   * Pull a fresh invoice for a request of the partner that is still open, from
   * the Lightning address (`lud16`) inside that request, for exactly the
   * requested amount (docs section 8a). The address comes from the request
   * the partner signed, never from the address book.
   *
   * @param {string} partner
   * @param {string} requestId Rumor id of the partner's request.
   * @returns {Promise<{ bolt11: string, expiresAt: number }>}
   * @throws {DmError} INVALID_ARGUMENT (no such open request), INVOICE_EXPIRED (the
   *   request names no address to ask), AMOUNT_OUT_OF_RANGE, INVOICE_REFRESH_FAILED
   */
  async function refreshInvoice(partner, requestId) {
    const recipient = normalizePubkey(partner);
    assertUsable();
    const message = requireRequest(recipient, requestId, { outgoing: false });
    const { lud16, amountSats } = message.request;
    if (!lud16) throw new DmError(DM_ERROR.INVOICE_EXPIRED, 'the request names no Lightning address to ask');
    const { bolt11, expiresAt } = await requests.pullInvoice({
      lud16,
      amountSats,
      // Ties the invoice to the request in the requester's LNURL log (LUD-12).
      reference: message.id.slice(0, 12),
    });
    return { bolt11, expiresAt };
  }

  /**
   * Can the partner receive messages? `found`: they publish an inbox relay
   * list. `missing`: they do not (no message possible; share a payment link).
   * `unknown`: no relay answered (offline), so nothing is known.
   *
   * @returns {Promise<'found' | 'missing' | 'unknown'>}
   */
  async function partnerReachability(partner) {
    const pubkey = normalizePubkey(partner);
    try {
      const result = await resolver.resolve(pubkey);
      storePort.setInboxRelaySnapshot(resolver.snapshot?.() ?? null);
      return result.status;
    } catch {
      return REACHABILITY.UNKNOWN;
    }
  }

  /**
   * The state of a request, for the card. The same as the store's
   * `requestStatus`, except that the user's own request counts as `paid` as
   * soon as their own wallet confirmed the payment (the store derives `paid`
   * from the payer's message only).
   *
   * @returns {'pending' | 'paid' | 'declined' | 'cancelled' | 'expired' | null}
   */
  function requestState(requestId) {
    const id = normalizePubkey(requestId, 'requestId');
    if (store.requestSource(id)?.paidAt) return 'paid';
    return store.requestStatus(id, nowSeconds());
  }

  /**
   * How sure the user is that a request of theirs is paid, and where the money
   * arrived. `verified`: their own wallet showed it (the invoice watcher, or
   * `settleClaims` for a late payment). Unverified: only the payer says so.
   *
   * @returns {{ verified: boolean, walletId: string | null } | null} Null while the request is not paid.
   */
  function requestSettlement(requestId) {
    const id = normalizePubkey(requestId, 'requestId');
    const source = store.requestSource(id);
    if (source?.paidAt) return { verified: true, walletId: ledgerWalletOf(source) };
    return store.requestStatus(id, nowSeconds()) === 'paid' ? { verified: false, walletId: null } : null;
  }

  // ----- watching the user's own requests -------------------------------

  function stopWatching(requestId) {
    const stop = watchers.get(requestId);
    watchers.delete(requestId);
    if (stop) stop();
  }

  function stopAllWatchers() {
    for (const id of [...watchers.keys()]) stopWatching(id);
  }

  /** The record in the shape the request service watches. */
  function openRequestOf(requestId, source) {
    return {
      id: requestId,
      walletId: source.walletId,
      method: source.method,
      paymentHash: source.paymentHash,
      expiresAt: source.expiresAt,
      ...(source.settlementWalletId ? { settlementWalletId: source.settlementWalletId } : {}),
      ...(source.verifyUrl ? { verifyUrl: source.verifyUrl } : {}),
    };
  }

  function watch(requestId) {
    if (disposed || watchers.has(requestId)) return;
    const source = store.requestSource(requestId);
    if (!source || source.paidAt) return;
    try {
      const stop = requests.watchRequest(openRequestOf(requestId, plain(source)), {
        onPaid: (result) => {
          watchers.delete(requestId);
          void handlePaid(requestId, result);
        },
        onError: noop,
      });
      watchers.set(requestId, stop);
    } catch {
      // A source record that cannot be watched is dropped on the next reconcile.
    }
  }

  /** The wallet whose ledger shows the payment (where the incoming transaction appears). */
  const ledgerWalletOf = (source) => (source.method === 'direct' ? source.walletId : source.settlementWalletId ?? null);

  /** A request of the user is paid, as their own wallet (or the LNURL server) confirmed it. */
  async function handlePaid(requestId, result) {
    const found = store.requestSource(requestId);
    if (disposed || !found || found.paidAt) return;
    const source = { ...plain(found), paidAt: result.settledAt ?? nowSeconds(), preimage: result.preimage ?? null };
    store.setRequestSource(requestId, source);

    const ledgerWalletId = ledgerWalletOf(source);
    const request = findRequestEverywhere(requestId);
    if (linkPayment && ledgerWalletId && request) {
      try {
        await linkPayment({
          contactId: contacts.find(request.partner)?.id ?? null,
          walletId: ledgerWalletId,
          amountSats: source.amountSats,
          note: source.note,
        });
      } catch {
        // The link is a convenience; the payment itself is settled.
      }
    }
    await announcePaid(requestId);
  }

  function findRequestEverywhere(requestId) {
    for (const [partner, thread] of Object.entries(store.threads)) {
      const message = thread.messages.find((entry) => entry.id === requestId && entry.type === MESSAGE_TYPE.REQUEST);
      if (message) return { partner, message };
    }
    return null;
  }

  /** Send the `paid` status of a settled request, once. Failures are retried by the next `reconcile`. */
  async function announcePaid(requestId) {
    const source = store.requestSource(requestId);
    const request = findRequestEverywhere(requestId);
    if (!source?.paidAt || source.announced || !request || disposed) return;
    const mark = () => store.setRequestSource(requestId, { ...plain(source), announced: true });
    // The payer already said so (they paid with BuhoGO): nothing to add.
    if (store.requestStatus(requestId, nowSeconds()) === 'paid') {
      mark();
      return;
    }
    try {
      await sendTemplate(request.partner, buildStatusTemplate({
        recipient: request.partner,
        requestId,
        value: REQUEST_STATUS.PAID,
        preimage: source.preimage ?? undefined,
        amountSats: source.amountSats,
        now: nowSeconds,
      }));
      mark();
    } catch {
      // No relay list, key unavailable, offline: the record keeps `announced: false`.
    }
  }

  // ----- late payments: the payer's claim against the user's own ledger ---

  let claimRun = null;
  const claimTimers = new Set();

  /**
   * The payment claims of one thread: every incoming `payment` message, plus a
   * synthetic claim for each request the partner marked `paid` without a
   * payment message (a payer on another client). Oldest first, as
   * `matchIncomingPayments` wants them.
   */
  function claimsOf(thread, requestsById) {
    const claims = [];
    const withPayment = new Set();
    for (const message of thread.messages) {
      if (message.type !== MESSAGE_TYPE.PAYMENT || message.outgoing) continue;
      claims.push({
        id: message.id,
        requestId: message.payment.requestId,
        createdAt: message.createdAt,
        payment: { amountSats: message.payment.amountSats, preimage: message.payment.preimage },
      });
      if (message.payment.requestId) withPayment.add(message.payment.requestId);
    }
    for (const message of thread.messages) {
      if (message.type !== MESSAGE_TYPE.STATUS || message.outgoing) continue;
      const { requestId, value, preimage } = message.status;
      const request = requestsById.get(requestId);
      if (value !== REQUEST_STATUS.PAID || !request || withPayment.has(requestId)) continue;
      claims.push({
        id: message.id,
        requestId,
        createdAt: message.createdAt,
        payment: { amountSats: request.request.amountSats, preimage },
      });
    }
    return claims.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  }

  /**
   * Check the partners' payment claims for the user's OWN requests against the
   * user's own wallets (docs section 8a). A claim that a wallet confirms (the
   * preimage hashes to an incoming payment, else amount and time window; one
   * transaction per claim) makes the request `paid`, verified, links the
   * transaction to the contact and records where it landed. A claim no wallet
   * shows stays what the payer said: "Reported paid, not verified".
   *
   * Requests the invoice watcher already settled are skipped, so a payment is
   * never linked twice. Never rejects.
   *
   * @returns {Promise<{ settled: number, pending: number }>} `pending`: claims still without a ledger match.
   */
  function settleClaims() {
    if (disposed || store.scope !== me || typeof loadIncomingTransactions !== 'function') {
      return Promise.resolve({ settled: 0, pending: 0 });
    }
    claimRun ??= (async () => {
      let settled = 0;
      let pending = 0;
      try {
        const work = [];
        for (const [partner, thread] of Object.entries(store.threads)) {
          const own = new Map(thread.messages
            .filter((m) => m.type === MESSAGE_TYPE.REQUEST && m.outgoing)
            .map((m) => [m.id, m]));
          if (own.size === 0) continue;
          const isSettled = (claim) => Boolean(store.requestSource(claim.requestId)?.paidAt);
          // Claims of requests that are settled already go first: their transaction is spent,
          // so it cannot vouch for a second request in a later run.
          const claims = claimsOf(thread, own);
          claims.sort((a, b) => Number(isSettled(b)) - Number(isSettled(a)));
          if (claims.some((claim) => own.has(claim.requestId) && !isSettled(claim))) work.push({ partner, own, claims });
        }
        if (work.length === 0) return { settled, pending };

        const transactions = await loadIncomingTransactions();
        for (const { partner, own, claims } of work) {
          const matches = matchIncomingPayments(claims, transactions);
          const done = new Set();
          for (const claim of claims) {
            const request = own.get(claim.requestId);
            if (!request || done.has(request.id) || store.requestSource(request.id)?.paidAt) continue;
            const tx = matches.get(claim.id);
            // Money that came in but less than was asked is not the request paid.
            if (!tx || tx.amountSats < request.request.amountSats) { pending += 1; continue; }
            if (disposed) break;
            done.add(request.id);
            await recordVerifiedPayment(partner, request, claim, tx);
            settled += 1;
          }
        }
      } catch {
        // The ledger could not be read: the claims stay unverified until the next trigger.
      }
      return { settled, pending };
    })().finally(() => {
      claimRun = null;
    });
    return claimRun;
  }

  /** The user's wallet showed the payment of one of their requests: record it and link the transaction. */
  async function recordVerifiedPayment(partner, request, claim, tx) {
    stopWatching(request.id);
    store.setRequestSource(request.id, {
      walletId: tx.walletId ?? null,
      method: 'direct',
      paymentHash: tx.paymentHash ?? null,
      expiresAt: request.request.expiresAt,
      amountSats: request.request.amountSats,
      note: request.request.note ?? null,
      paidAt: tx.settledAt ?? nowSeconds(),
      preimage: claim.payment.preimage ?? null,
      // The payer announced it themselves: there is nothing to tell them.
      announced: true,
      late: true,
    });
    if (linkPayment && tx.walletId) {
      try {
        await linkPayment({
          contactId: contacts.find(partner)?.id ?? null,
          walletId: tx.walletId,
          amountSats: tx.amountSats,
          note: request.request.note ?? null,
        });
      } catch {
        // The link is a convenience; the payment itself is settled.
      }
    }
  }

  /** `settleClaims` now and again while a claim still waits for the wallet's history to show it. */
  function checkClaimsSoon(attempt = 0) {
    if (disposed) return;
    void settleClaims().then(({ pending }) => {
      if (pending === 0 || disposed || attempt >= CLAIM_RETRY_MS.length) return;
      const handle = (setTimer ?? setTimeout)(() => {
        claimTimers.delete(handle);
        checkClaimsSoon(attempt + 1);
      }, CLAIM_RETRY_MS[attempt]);
      claimTimers.add(handle);
    });
  }

  function clearClaimTimers() {
    for (const handle of claimTimers) (clearTimer ?? clearTimeout)(handle);
    claimTimers.clear();
  }

  /**
   * Drop what no longer needs watching (declined, cancelled, expired or
   * vanished requests) and return the still-open ones.
   */
  function settleDeadSources() {
    const open = [];
    for (const [requestId, stored] of Object.entries(store.receiving)) {
      const source = plain(stored);
      if (!findRequestEverywhere(requestId)) {
        stopWatching(requestId);
        store.clearRequestSource(requestId);
        continue;
      }
      if (source.paidAt) {
        // The record stays: it is the requester's proof that the request is paid (`requestState`).
        if (!source.announced) open.push({ requestId, source, paid: true });
        continue;
      }
      const state = store.requestStatus(requestId, nowSeconds());
      if (OVER_STATES.has(state) || source.expiresAt * 1000 < now()) {
        stopWatching(requestId);
        store.clearRequestSource(requestId);
        continue;
      }
      open.push({ requestId, source, paid: false });
    }
    return open;
  }

  /**
   * Check the user's open requests once (app resume, unlock, start): settle
   * the paid ones, send the `paid` statuses that are still owed and make sure
   * every open request is watched. Concurrent calls share one run. Never rejects.
   *
   * @returns {Promise<{ paid: number }>} How many requests turned out paid.
   */
  function reconcile() {
    if (disposed || store.scope !== me) return Promise.resolve({ paid: 0 });
    reconcileRun ??= (async () => {
      let paid = 0;
      try {
        const open = settleDeadSources();
        for (const entry of open.filter((item) => item.paid)) await announcePaid(entry.requestId);
        const waiting = open.filter((item) => !item.paid);
        const results = await requests.reconcileRequests(
          waiting.map((item) => openRequestOf(item.requestId, item.source)),
        );
        for (const result of results) {
          stopWatching(result.id);
          await handlePaid(result.id, result);
          paid += 1;
        }
        for (const entry of waiting) watch(entry.requestId);
        // Payments that came after an invoice ran out are checked on every resume too.
        await settleClaims();
      } catch {
        // The next trigger tries again.
      }
      return { paid };
    })().finally(() => {
      reconcileRun = null;
    });
    return reconcileRun;
  }

  // ----- incoming messages -> notification -------------------------------

  /**
   * Called by the inbox for a new, live, incoming message (never a reaction,
   * never our own self copy). Posts a notification unless the chat is muted,
   * the sender blocked, or the chat is on screen.
   */
  function onIncoming(message) {
    if (disposed) return;
    if (message.type === MESSAGE_TYPE.STATUS) settleDeadSources();
    const claimsPayment = message.type === MESSAGE_TYPE.PAYMENT
      || (message.type === MESSAGE_TYPE.STATUS && message.status?.value === REQUEST_STATUS.PAID);
    if (claimsPayment) checkClaimsSoon();
    try {
      void notifyIncoming(message).catch(noop);
    } catch {
      // A notification is never worth interrupting the receive loop.
    }
  }

  async function notifyIncoming(message) {
    const { partner } = message;
    if (message.outgoing || message.sender === me || store.scope !== me) return;
    if (store.isBlocked(message.sender) || store.thread(partner).muted) return;
    const hidden = isHidden();
    // On screen, the chat itself shows it. Hidden, the user is not looking at it.
    if (store.openThread === partner && !hidden) return;

    const contact = contacts.find(partner);
    const key = `chat:${partner}`;
    const channel = typeof channelName === 'function' ? channelName() : channelName;
    await notifications.message({
      title: contact?.name || shortNpub(partner),
      body: formatNotification(message),
      id: stableNotificationId(key),
      group: key,
      route: contact ? contactChatRoute(contact.id) : unknownChatRoute(partner),
      // It happened while the app was out of sight: announce it even if the
      // user is back by the time the notification is posted.
      force: hidden,
      ...(channel ? { channelName: channel } : {}),
    });
  }

  // ----- lifecycle -------------------------------------------------------

  /**
   * Connect, subscribe, flush the outbox and check the open requests.
   * @throws {DmError} NO_IDENTITY when the store is not scoped to this identity or the runtime was disposed.
   */
  async function start() {
    assertUsable();
    if (started) return;
    started = true;
    try {
      await inbox.start();
    } catch (error) {
      started = false;
      throw error;
    }
    void reconcile();
  }

  /** Close the subscription and the watchers; the key is left as it is. `start()` may run again. */
  function stop() {
    started = false;
    stopAllWatchers();
    clearClaimTimers();
    inbox.stop();
  }

  /** End of this identity: stop, zero the key, close every connection. The runtime cannot be used again. */
  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
    sessionKey.dispose();
    try {
      transport.resetIdentity?.();
      transport.close?.();
    } catch {
      // Closing is best effort; the sockets are garbage anyway.
    }
  }

  return Object.freeze({
    me,
    // --- UI actions
    sendText,
    requestMoney,
    declineRequest,
    cancelRequest,
    remindRequest,
    announcePayment,
    react,
    retry,
    checkPayable,
    needsFreshInvoice,
    refreshInvoice,
    partnerReachability,
    requestState,
    requestSettlement,
    settleClaims,
    // --- lifecycle (boot)
    start,
    stop,
    dispose,
    isStarted: () => started && !disposed,
    isDisposed: () => disposed,
    /** Zero the key now (`WIPE_REASON` value); it loads again on the next use. */
    wipeKey: (reason) => sessionKey.wipe(reason),
    /** Zero the key `ms` from now (app hidden). */
    wipeKeyAfter: (ms) => sessionKey.wipeAfter(ms),
    /** Cancel a scheduled wipe (app visible again). */
    cancelKeyWipe: () => sessionKey.cancelWipe(),
    isKeyLoaded: () => sessionKey.isLoaded(),
    retryOutbox: (options) => (disposed ? Promise.resolve({ attempted: 0 }) : inbox.retryOutbox(options)),
    reconcile,
    status: () => inbox.status(),
    whenIdle: () => inbox.whenIdle(),
  });
}
