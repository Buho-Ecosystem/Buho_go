/**
 * The contact chat's runtime: everything the app needs for ONE identity,
 * composed from the `services/dm/` modules and the app's stores.
 *
 * `createChatRuntime(deps)` wires
 *
 *   chat signer (dmSigner)   ->  relay transport  ->  inbox coordinator
 *                                 inbox relay resolver ----^
 *   profile / LNURL           ->  request service
 *   messages store            ->  `InboxStore` port (`createInboxStoreAdapter`)
 *
 * and exposes the small set of actions the chat screen uses (section "UI
 * actions" of the returned object) plus the lifecycle hooks the boot file
 * drives (`start`, `stop`, `dispose`, `wipeKey*`, `retryOutbox`, `settleClaims`).
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
 * Money flow of a request (docs/CONTACT_CHAT.md sections 8 and 8a):
 *   1. `requestMoney` checks the partner can receive messages and that the
 *      profile Lightning address answers (`requests.checkOwnAddress`), then
 *      sends the request: a notice naming the amount and that address.
 *   2. The payer's app fetches the invoice when they tap Pay
 *      (`fetchRequestInvoice`), from the requester's current profile address.
 *   3. The payer announces the payment (`payment` message, `paid` status).
 *      `settleClaims` checks that announcement against the user's own wallet
 *      ledger and only then records the request as paid, verified. The store
 *      derives `paid` from the PAYER's status alone, so the requester's own
 *      certainty lives in a settlement record, read through `requestState(id)`
 *      / `requestSettlement(id)`.
 */

import { nip19 } from 'nostr-core';
import { stableNotificationId } from '../paymentNotifications.js';
import { DM_DISCOVERY_RELAYS, KEY_IDLE_WIPE_MS } from './constants.js';
import { DM_ERROR, DmError } from './errors.js';
import { createInbox, createSignAuth } from './inbox.js';
import { INBOX_STATUS, createInboxRelayResolver } from './inboxRelays.js';
import { matchIncomingPayments, transactionKey } from './paymentConfirmation.js';
import { verifyPaymentViaAddress } from './paymentVerification.js';
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
import { createExternalDmSigner, createLocalDmSigner } from './dmSigner.js';
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
  'requestAddress',
  'fetchRequestInvoice',
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
    hasHandledWrap: (wrapId) => active() && store.hasHandledWrap(wrapId),
    rememberHandledWrap: (wrapId, createdAt) => active() && store.rememberHandledWrap(wrapId, createdAt),
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
 * @property {string[]} [relayHints] Relays the contact's profile named, searched first for their inbox list.
 */

/**
 * @typedef {object} ChatRuntimeDeps
 * @property {string} me Own pubkey (64 lowercase hex).
 * @property {() => Promise<Uint8Array>} [loadSecretKey] Fresh key bytes (`identity.getNostrSecretKeyBytes`),
 *   for an identity whose key is on this phone.
 * @property {{ acquire: () => Promise<{ signer: import('nostr-core').Signer, release?: () => void }>, maxParallel: number }} [signerApp]
 *   For an identity that signs in another app (extension, remote signer):
 *   its signer, pinned to `me`. Exactly one of `loadSecretKey` and `signerApp`.
 * @property {() => boolean} [isLocked] True while the app lock is on: nothing is signed or decrypted.
 * @property {object} store The messages store, already scoped to `me`.
 * @property {() => string | null | undefined} getProfileAddress The profile's `lud16`.
 * @property {(pubkey: string, options: { timeoutMs: number }) => Promise<object | null>} fetchProfile
 *   The signed kind 0 of a person (`nostrFetch.fetchProfile`).
 * @property {{ fetchPayRequest: Function, requestInvoice: Function, verifyPayment?: Function }} lnurl
 *   nostr-core's LNURL functions. `verifyPayment` (LUD-21) lets a payment to an address outside the app be verified.
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
 * @property {() => Promise<Array<{ amountSats: number, settledAt: number | null, paymentHash: string | null,
 *   status: 'completed' | 'pending' | 'failed' }>>} [loadOutgoingTransactions] The user's own sends: what became
 *   of a payment for a request that was still routing.
 * @property {() => Promise<import('./paymentConfirmation.js').IncomingTransaction[]>} [loadIncomingTransactions]
 *   The settled incoming transactions of the user's wallets, each with its `walletId`. Without it a
 *   payment the partner reports can never be verified.
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
    signerApp,
    isLocked = () => false,
     store,
    getProfileAddress,
    fetchProfile,
    lnurl,
    contacts,
    notifications,
    formatNotification,
    channelName,
    isHidden = () => false,
    linkPayment,
    loadIncomingTransactions,
    loadOutgoingTransactions,
    ensureRelay,
    WebSocket,
    now = Date.now,
    setTimer,
    clearTimer,
    inboxOptions,
    factories = {},
  } = deps;
  const me = normalizePubkey(deps.me, 'me');
  if ((typeof loadSecretKey === 'function') === (typeof signerApp?.acquire === 'function')) {
    throw invalid('exactly one of loadSecretKey and signerApp is required');
  }
  const required = { getProfileAddress, fetchProfile, formatNotification, ensureRelay };
  for (const [name, value] of Object.entries(required)) {
    if (typeof value !== 'function') throw invalid(`${name} is required`);
  }
  if (!store || typeof store.ingest !== 'function') throw invalid('store is required');
  if (typeof contacts?.find !== 'function') throw invalid('contacts is required');
  if (typeof notifications?.message !== 'function') throw invalid('notifications is required');

  const nowSeconds = () => Math.floor(now() / 1000);

  // ----- composition -----------------------------------------------------

  let sessionKey = null;
  // While the app is locked nothing is signed or decrypted, whatever asks (a
  // live wrap, an AUTH challenge, a retry timer). KEY_WIPED makes the inbox
  // keep the work until the app is unlocked again.
  const signer = signerApp
    ? createExternalDmSigner({ pubkey: me, acquire: signerApp.acquire, maxParallel: signerApp.maxParallel, isLocked, isHidden })
    : createLocalDmSigner({
      pubkey: me,
      sessionKey: (sessionKey = createSessionKey({
        pubkey: me,
        load: async () => {
          if (isLocked()) throw new DmError(DM_ERROR.KEY_WIPED, 'the app is locked');
          const key = await loadSecretKey();
          // Loaded in the background (a message woke us): it goes again after
          // the idle time, as if the app had just been hidden.
          if (isHidden()) Promise.resolve().then(() => sessionKey.wipeAfter(KEY_IDLE_WIPE_MS));
          return key;
        },
        setTimer,
        clearTimer,
      })),
    });

  const transport = (factories.createTransport ?? createDmTransport)({
    signAuth: createSignAuth(signer),
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
    getProfileAddress,
    fetchProfile,
    lnurl,
    now,
  });

  const storePort = createInboxStoreAdapter(store, me);

  const inbox = createInbox({
    me,
    signer,
    transport,
    resolver,
    store: storePort,
    now,
    setTimer,
    clearTimer,
    onIncoming: (message) => onIncoming(message),
    // Only a signer app makes the person act; a locked app is handled by the lock screen.
    onSignerHold: (code) => {
      if (signer.external && store.scope === me) store.setSignerHold(code);
    },
    ...inboxOptions,
  });

  // ----- state -----------------------------------------------------------

  let started = false;
  let disposed = false;

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
    // Every send is the person's own action (or the payment they just made):
    // their signer app may ask them, even after it declined background work.
    signer.allowAgain();
    const message = await inbox.send({ partner, template, hints: contacts.find(partner)?.relayHints });
    // On disk before anything else: the app may be closed right after Send.
    store.flush?.().catch(() => {});
    return message;
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
   * Ask the partner for money: check the profile address, then send the request.
   *
   * @param {string} partner
   * @param {{ amountSats: number, note?: string }} options
   * @returns {Promise<import('./protocol.js').ChatMessage>} The request message.
   * @throws {DmError} NO_INBOX_RELAYS, NO_PAYMENT_ADDRESS, PAYMENT_ADDRESS_UNREACHABLE,
   *   AMOUNT_OUT_OF_RANGE, INVALID_ARGUMENT, MESSAGE_TOO_LARGE, KEY_WIPED, NO_IDENTITY
   */
  async function requestMoney(partner, { amountSats, note } = {}) {
    const recipient = normalizePubkey(partner);
    assertUsable();
    // A partner without an inbox list cannot receive a message (NIP-17): fail
    // before anything else is checked for a request nobody could ever see.
    if ((await partnerReachability(recipient)) === REACHABILITY.MISSING) {
      throw new DmError(DM_ERROR.NO_INBOX_RELAYS, 'the contact has no inbox relay list');
    }
    const lud16 = await requests.checkOwnAddress(amountSats);
    const cleanNote = typeof note === 'string' && note.trim() ? note.trim() : undefined;
    return sendTemplate(recipient, buildRequestTemplate({
      recipient, amountSats, lud16, note: cleanNote, now: nowSeconds,
    }));
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

  /** Withdraw a request the user sent. */
  async function cancelRequest(partner, requestId) {
    const recipient = normalizePubkey(partner);
    assertUsable();
    const request = requireRequest(recipient, requestId, { outgoing: true });
    return sendTemplate(recipient, buildStatusTemplate({
      recipient, requestId: request.id, value: REQUEST_STATUS.CANCELLED, now: nowSeconds,
    }));
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
   * @param {{ amountSats: number, note?: string, preimage?: string, requestId?: string, verifyUrl?: string }} payment
   * @returns {Promise<{ payment: import('./protocol.js').ChatMessage,
   *   status: import('./protocol.js').ChatMessage | null, statusError: string | null }>}
   * @throws {DmError} when the payment message itself cannot be written or sent
   *   (NO_INBOX_RELAYS, INVALID_ARGUMENT, KEY_WIPED, ...).
   */
  async function announcePayment(partner, { amountSats, note, preimage, requestId, verifyUrl } = {}) {
    const recipient = normalizePubkey(partner);
    assertUsable();
    const reference = requestId === undefined || requestId === null ? undefined : normalizePubkey(requestId, 'requestId');
    const cleanNote = typeof note === 'string' && note.trim() ? note.trim() : undefined;
    const cleanPreimage = typeof preimage === 'string' && preimage ? preimage.toLowerCase() : undefined;

    const sent = await sendTemplate(recipient, buildPaymentTemplate({
      recipient, amountSats, preimage: cleanPreimage, note: cleanNote, requestId: reference, verifyUrl, now: nowSeconds,
    }));
    // Less than was asked ("Send anyway" with a smaller amount) is a payment, not the request paid.
    if (!reference || !coversRequest(recipient, reference, amountSats)) return { payment: sent, status: null, statusError: null };

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

  /** Whether `amountSats` is at least what the partner's request `requestId` asked. */
  function coversRequest(partner, requestId, amountSats) {
    const request = findMessage(partner, requestId);
    return request?.type === MESSAGE_TYPE.REQUEST && amountSats >= request.request.amountSats;
  }

  /**
   * The wallet sent a payment the chat handed over (`payment:sent`). Paying a
   * partner's request is recorded at once, before any message goes out, so
   * the request is never offered for paying again even when the announcement
   * cannot go out now (signer app away, partner unreachable) or the payment
   * is still routing. A completed payment is then announced; a pending one
   * waits for `reconcileOwnPayments`.
   *
   * @param {string} partner
   * @param {{ status?: 'completed' | 'pending', amountSats: number, note?: string, preimage?: string,
   *   requestId?: string, verifyUrl?: string, paymentHash?: string, walletId?: string }} payment
   * @returns {Promise<boolean>} True when the partner was told now.
   */
  async function reportPayment(partner, payment) {
    const recipient = normalizePubkey(partner);
    assertUsable();
    const pending = payment.status === 'pending';
    const { requestId } = payment;
    const settlesRequest = Boolean(requestId) && coversRequest(recipient, requestId, payment.amountSats);
    if (settlesRequest && store.scope === me) {
      store.setOwnPayment(requestId, {
        status: pending ? 'pending' : 'sent',
        announced: false,
        partner: recipient,
        amountSats: payment.amountSats,
        note: payment.note ?? null,
        preimage: payment.preimage ?? null,
        verifyUrl: payment.verifyUrl ?? null,
        paymentHash: payment.paymentHash?.toLowerCase() ?? null,
        walletId: payment.walletId ?? null,
        at: nowSeconds(),
      });
    }
    if (pending) return false;
    await announceOwnPayment(recipient, payment);
    return true;
  }

  /** Tell the partner, and remember that they were told. */
  async function announceOwnPayment(partner, { amountSats, note, preimage, requestId, verifyUrl }) {
    await announcePayment(partner, {
      amountSats, note: note ?? undefined, preimage: preimage ?? undefined, requestId: requestId ?? undefined, verifyUrl: verifyUrl ?? undefined,
    });
    if (requestId && store.ownPayment(requestId)) store.setOwnPayment(requestId, { status: 'sent', announced: true });
  }

  /**
   * Finish what `reportPayment` could not: announce payments the partner was
   * not told about yet, and settle the ones that were still routing (the
   * wallet's history says completed: announce; failed: forget the record, so
   * the request can be paid again). Runs on start and resume. Never throws.
   *
   * @returns {Promise<{ announced: number, settled: number, failed: number }>}
   */
  async function reconcileOwnPayments() {
    const result = { announced: 0, settled: 0, failed: 0 };
    if (disposed || store.scope !== me) return result;
    const records = Object.entries(store.ownPayments ?? {});
    if (records.length === 0) return result;
    let outgoing = null;
    for (const [requestId, record] of records) {
      if (disposed) break;
      try {
        if (record.status === 'pending') {
          outgoing ??= await (loadOutgoingTransactions?.() ?? []);
          const tx = outgoing.find((candidate) => (record.paymentHash
            ? candidate.paymentHash?.toLowerCase() === record.paymentHash
            : candidate.amountSats === record.amountSats && candidate.walletId === record.walletId
              && Number.isFinite(candidate.settledAt) && candidate.settledAt >= record.at - 60));
          if (!tx || tx.status === 'pending') continue;
          if (tx.status === 'failed') {
            store.clearOwnPayment(requestId);
            result.failed += 1;
            continue;
          }
          store.setOwnPayment(requestId, { status: 'sent' });
          result.settled += 1;
        }
        if (!store.ownPayment(requestId)?.announced) {
          await announceOwnPayment(record.partner, { ...record, requestId });
          result.announced += 1;
        }
      } catch {
        // The partner cannot be told right now: the next start or resume tries again.
      }
    }
    return result;
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
   * Where the partner of a request gets paid today: the Lightning address in
   * their current signed profile, else the one signed inside the request
   * (docs section 8a). Works for an expired request too ("Send anyway").
   *
   * @param {string} partner
   * @param {string} requestId Rumor id of the partner's request.
   * @returns {Promise<string>}
   * @throws {DmError} INVALID_ARGUMENT (no such request from the partner)
   */
  async function requestAddress(partner, requestId) {
    const sender = normalizePubkey(partner);
    assertUsable();
    const message = findMessage(sender, normalizePubkey(requestId, 'requestId'));
    if (!message || message.type !== MESSAGE_TYPE.REQUEST || message.outgoing) {
      throw invalid('no such request in this conversation');
    }
    return requests.resolveRequesterAddress(sender, message.request.lud16);
  }

  /**
   * The invoice for a request of the partner that is still open, pulled from
   * their Lightning address for exactly the requested amount. Created now, at
   * the moment of paying, so it cannot have expired.
   *
   * @param {string} partner
   * @param {string} requestId Rumor id of the partner's request.
   * @returns {Promise<{ bolt11: string, verifyUrl: string | null }>} The BOLT-11 invoice and its LUD-21 verify URL.
   * @throws {DmError} INVALID_ARGUMENT (no such open request), AMOUNT_OUT_OF_RANGE, INVOICE_FETCH_FAILED
   */
  async function fetchRequestInvoice(partner, requestId) {
    const sender = normalizePubkey(partner);
    assertUsable();
    const message = requireRequest(sender, requestId, { outgoing: false });
    return requests.pullInvoice({
      lud16: await requestAddress(sender, message.id),
      amountSats: message.request.amountSats,
      // Ties the invoice to the request in the requester's LNURL log (LUD-12).
      reference: message.id.slice(0, 12),
    });
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
    if (store.settlement(id)) return 'paid';
    return store.requestStatus(id, nowSeconds());
  }

  /**
   * How sure the user is that a request of theirs is paid, and where the money
   * arrived. `verified`: their own wallet showed it, or their address confirmed
   * it by LUD-21 (`settleClaims`). Unverified: only the payer says so.
   *
   * @returns {{ verified: boolean, walletId: string | null, address: string | null } | null}
   *   Null while the request is not paid. `address`: set when the address, not a wallet, confirmed it.
   */
  function requestSettlement(requestId) {
    const id = normalizePubkey(requestId, 'requestId');
    const settled = store.settlement(id);
    if (settled) return { verified: true, walletId: settled.walletId ?? null, address: settled.address ?? null };
    return store.requestStatus(id, nowSeconds()) === 'paid' ? { verified: false, walletId: null, address: null } : null;
  }

  // ----- the payer's claim against the user's own ledger ------------------

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
        verifyUrl: message.payment.verifyUrl,
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
   * user's own wallets (docs sections 8 and 8a). A claim that a wallet confirms
   * (the preimage hashes to an incoming payment, else amount and time window;
   * one transaction per claim) makes the request `paid`, verified, links the
   * transaction to the contact and records where it landed. A claim no wallet
   * shows can still be confirmed by the requester's own Lightning address (LUD-21,
   * `paymentVerification.js`) when the payment message carries a verify URL; else it stays
   * what the payer said: "Reported paid, not verified".
   *
   * Requests already settled are skipped, so a payment is never linked twice.
   * Never rejects.
   *
   * @returns {Promise<{ settled: number, pending: number }>} `pending`: claims still unverified.
   */
  function settleClaims() {
    if (disposed || store.scope !== me || (typeof loadIncomingTransactions !== 'function' && typeof lnurl?.verifyPayment !== 'function')) {
      return Promise.resolve({ settled: 0, pending: 0 });
    }
    claimRun ??= (async () => {
      let settled = 0;
      let pending = 0;
      try {
        // Every open claim of every chat, matched in one pass: one transaction
        // settles at most one request, across chats and across runs.
        const open = [];
        for (const [partner, thread] of Object.entries(store.threads)) {
          const own = new Map(thread.messages
            .filter((m) => m.type === MESSAGE_TYPE.REQUEST && m.outgoing)
            .map((m) => [m.id, m]));
          if (own.size === 0) continue;
          for (const claim of claimsOf(thread, own)) {
            const request = own.get(claim.requestId);
            if (!request || store.settlement(request.id)) continue;
            // The amount and the time come from the request, never from the claim.
            const payment = { ...claim.payment, amountSats: request.request.amountSats };
            open.push({ partner, request, claim: { ...claim, payment, notBefore: request.createdAt } });
          }
        }
        if (open.length === 0) return { settled, pending };

        const transactions = await (loadIncomingTransactions?.() ?? []);
        const consumed = settledTransactionKeys();
        const matches = matchIncomingPayments(open.map((entry) => entry.claim), transactions, { consumed, nowSeconds: nowSeconds() });
        for (const { partner, request, claim } of open) {
          // A request with several claims (payment and status): the first that holds settles it.
          if (store.settlement(request.id)) continue;
          if (disposed) break;
          const tx = matches.get(claim.id);
          // Money that came in but less than was asked is not the request paid.
          if (tx && tx.amountSats >= request.request.amountSats) {
            await recordVerifiedPayment(partner, request, tx);
            settled += 1;
            continue;
          }
          const proof = claim.verifyUrl && await verifyViaAddress(claim.verifyUrl, request, settledTransactionKeys());
          if (!proof) { pending += 1; continue; }
          if (disposed) break;
          store.setSettlement(request.id, { ...proof, paidAt: nowSeconds() });
          settled += 1;
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

  /** Keys of every transaction that settled a request already (`transactionKey`): spent for good. */
  function settledTransactionKeys() {
    const keys = new Set();
    for (const entry of Object.values(store.settlements ?? {})) {
      if (entry.paymentHash) keys.add(entry.paymentHash);
      if (entry.transactionKey) keys.add(entry.transactionKey);
    }
    return keys;
  }

  /** The payer's LUD-21 claim for one request, checked against the addresses the user named (see `paymentVerification.js`). */
  function verifyViaAddress(verifyUrl, request, usedHashes) {
    if (typeof lnurl?.verifyPayment !== 'function') return null;
    return verifyPaymentViaAddress({
      verifyUrl,
      addresses: [request.request.lud16, getProfileAddress()],
      amountSats: request.request.amountSats,
      notBefore: request.createdAt,
      usedHashes,
      verifyPayment: lnurl.verifyPayment,
      fetchPayRequest: lnurl.fetchPayRequest,
      setTimer,
      clearTimer,
    });
  }

  /** The user's wallet showed the payment of one of their requests: record it and link the transaction. */
  async function recordVerifiedPayment(partner, request, tx) {
    const key = transactionKey(tx);
    store.setSettlement(request.id, {
      walletId: tx.walletId ?? null,
      paidAt: tx.settledAt ?? nowSeconds(),
      ...(tx.paymentHash ? { paymentHash: tx.paymentHash.toLowerCase() } : {}),
      ...(key && !tx.paymentHash ? { transactionKey: key } : {}),
      // Arrived at an address outside the wallets (the npub.cash bucket): named like a LUD-21 proof.
      ...(tx.address ? { address: tx.address } : {}),
    });
    if (linkPayment && tx.walletId) {
      try {
        await linkPayment({
          contactId: contacts.find(partner)?.id ?? null,
          walletId: tx.walletId,
          transactionId: tx.id ?? null,
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

  // ----- incoming messages -> notification -------------------------------

  /**
   * Called by the inbox for a new, live, incoming message (never a reaction,
   * never our own self copy). Posts a notification unless the chat is muted,
   * the sender blocked, or the chat is on screen.
   */
  function onIncoming(message) {
    if (disposed) return;
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
    // Per identity: after a switch, an old notification must not open this chat under the other one.
    const key = `chat:${me}:${partner}`;
    const channel = typeof channelName === 'function' ? channelName() : channelName;
    await notifications.message({
      title: contact?.name || shortNpub(partner),
      body: formatNotification(message, { known: Boolean(contact) }),
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
   * Connect, subscribe, flush the outbox and check the payment claims.
   * @throws {DmError} NO_IDENTITY when the store is not scoped to this identity or the runtime was disposed.
   */
  /**
   * Whether messages are received. With a signer app every message asks that
   * app, so receiving waits until the person turned it on (`turnOnMessages`).
   */
  const receives = () => !signer.external || (store.scope === me && store.signerAppMessages === true);

  async function start() {
    assertUsable();
    if (started) return;
    started = true;
    try {
      if (receives()) await inbox.start();
    } catch (error) {
      started = false;
      throw error;
    }
    void checkClaimsSoon();
    void reconcileOwnPayments();
  }

  /** The person turned messages on for their signer app: receiving starts now. */
  async function turnOnMessages() {
    assertUsable();
    if (store.scope !== me) return;
    store.turnOnSignerAppMessages();
    signer.allowAgain();
    if (started) await inbox.start();
  }

  /** Close the subscription and the claim timers; the key is left as it is. `start()` may run again. */
  function stop() {
    started = false;
    clearClaimTimers();
    inbox.stop();
  }

  /** End of this identity: stop, zero the key, close every connection. The runtime cannot be used again. */
  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
    signer.dispose();
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
    reportPayment,
    react,
    retry,
    requestAddress,
    fetchRequestInvoice,
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
    /** Zero the key now (`WIPE_REASON` value); it loads again on the next use. A signer app only drops waiting requests. */
    wipeKey: (reason) => signer.wipe(reason),
    /** Zero the key `ms` from now (app hidden). */
    wipeKeyAfter: (ms) => signer.wipeAfter(ms),
    /** Cancel a scheduled wipe (app visible again); messages that waited meanwhile are opened. */
    cancelKeyWipe: () => {
      signer.cancelWipe();
      if (!disposed) inbox.retryWaiting();
    },
    isKeyLoaded: () => signer.isLoaded(),
    /** True when the identity signs in another app (extension, remote signer). */
    usesSignerApp: () => signer.external,
    turnOnMessages,
    /**
     * The person asked to try again after their signer app refused: requests
     * may go out again and the waiting messages are opened.
     */
    retrySigner: () => {
      if (disposed) return;
      signer.allowAgain();
      inbox.retryWaiting();
    },
    retryOutbox: (options) => (disposed ? Promise.resolve({ attempted: 0 }) : inbox.retryOutbox(options)),
    reconcileOwnPayments,
    /** Read again from relays the transport gave up on (resume, unlock). */
    resubscribe: () => {
      if (!disposed) inbox.resubscribe();
    },
    status: () => inbox.status(),
    whenIdle: () => inbox.whenIdle(),
  });
}
