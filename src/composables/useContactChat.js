/**
 * View-model of the contact chat page (docs/CONTACT_CHAT.md section 2).
 *
 * `pages/ContactChatPage.vue` is presentation and navigation only. Everything
 * that turns the messages store and the chat runtime into something the
 * components can draw, and every action the user can take, lives here, so it
 * runs under plain Node in the specs.
 *
 * Three layers, bottom to top:
 *
 *   buildThreadItems(input)      pure: store messages -> `ChatThread` items
 *   describeDmError(error, ...)  pure: a DmError code -> translated words
 *   useContactChat(options)      reactive glue: items, reachability, the live
 *                                expiry tick, and the actions (with a busy flag
 *                                and errors turned into `{ ok: false, error }`)
 *
 * The chat has no way to act except `useChatRuntime()` (the `runtime` option)
 * and the messages store (read model plus read/mute/block). Paying goes through
 * the app's existing send pipeline (`pay`, from `usePayContact`) and comes back
 * as the `payment:sent` event, which `services/dm/paymentAnnouncer.js` turns
 * into the announcement; see that file for why it is not handled here.
 *
 * ── Thread items ───────────────────────────────────────────────────────────
 * The shape is documented in components/chat/ChatThread.vue. What this file
 * decides:
 *   - text, degraded and status-less messages are `message` items; a partner's
 *     `reminder` becomes a small message ("Reminder: ..."); other status
 *     messages (paid / declined / cancelled) are not rows, they change the
 *     card of their request.
 *   - requests are `request` items. The user's own request reads its state
 *     from `runtime.requestState` (own wallet certainty), the partner's from
 *     `store.requestStatus`. Expiry follows a live clock (`now`) and is the
 *     request's `valid_until`: an expired request offers "Send anyway" /
 *     "Request again" (docs section 8a).
 *   - a paid request of the user's own says where the money arrived, or that
 *     it is only reported by the payer (`settlement`).
 *   - an outgoing payment is a `payment` line. An INCOMING payment is a line
 *     only when one of the user's wallets confirms it
 *     (services/dm/paymentConfirmation.js); otherwise it is the partner's
 *     message as plain text. A payment that settles a request of the thread
 *     is not drawn twice: the card says "Paid".
 */

import { computed, ref, shallowRef, toValue, watch } from 'vue';
import { insertDaySeparators } from '../components/chat/chatFormat.js';
import { DM_ERROR, DmError } from '../services/dm/errors.js';
import { confirmIncomingPayments } from '../services/dm/paymentConfirmation.js';
import { buildChatPaymentContext } from '../services/dm/paymentContext.js';
import { MESSAGE_TYPE, REQUEST_STATUS } from '../services/dm/protocol.js';
import { PAYING_REASON, payingWalletReasonText } from '../utils/payingWallets.js';

/** Characters of a replied-to message kept in the preview. */
const REPLY_PREVIEW_CHARS = 140;

/** The clock never sleeps longer than this, so "valid until" and expiry stay honest. */
const MAX_TICK_MS = 60_000;
/** ... nor wakes sooner than this. */
const MIN_TICK_MS = 1_000;

/** Wallet history lookups for incoming payment claims: now, then twice more (histories lag a payment). */
const CONFIRM_RETRY_MS = Object.freeze([5_000, 20_000]);

// ---------------------------------------------------------------------------
// Pure: thread items
// ---------------------------------------------------------------------------

function clip(text, max = REPLY_PREVIEW_CHARS) {
  const chars = [...String(text || '').replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

/**
 * @typedef {object} ThreadInput
 * @property {Array<object>} messages Thread messages of the store (ascending).
 * @property {string} partnerName Name shown for the other side.
 * @property {boolean} [unknown] The partner is not in the address book.
 * @property {number} now Unix seconds.
 * @property {(id: string) => Array<{ emoji: string, count: number, mine: boolean }>} reactionsFor
 * @property {(message: object) => string | null} requestStateOf State of a request message.
 * @property {(message: object) => string} disabledReasonOf Why a pending incoming request cannot be paid ('' = can).
 * @property {(message: object) => ({ verified: boolean, walletId: string | null, address?: string | null } | null)} [settlementOf]
 *   How sure the user is that their own request is paid, and where it arrived.
 * @property {(walletId: string | null) => string} [walletNameOf] Display name of a wallet ('' when unknown).
 * @property {Set<string>} [confirmedPayments] Ids of incoming payment messages a wallet confirmed.
 * @property {Set<string> | string[]} [busyIds] Ids with an action in flight.
 * @property {(sats: number) => string} [formatFiat]
 * @property {(key: string, params?: object) => string} t
 */

/**
 * Turn a thread into the items `ChatThread` draws. Pure.
 *
 * @param {ThreadInput} input
 * @returns {Array<object>} Items, day separators included.
 */
export function buildThreadItems(input) {
  const {
    messages, partnerName, unknown = false, now, reactionsFor, requestStateOf,
    disabledReasonOf, settlementOf = () => null, walletNameOf = () => '',
    confirmedPayments = new Set(), busyIds = new Set(), formatFiat = () => '', t,
  } = input;
  const busy = busyIds instanceof Set ? busyIds : new Set(busyIds);
  const byId = new Map(messages.map((message) => [message.id, message]));
  const authorOf = (message) => (message.outgoing ? t('You') : (partnerName || t('Them')));

  const replyOf = (message) => {
    if (!message.replyTo) return null;
    const original = byId.get(message.replyTo);
    if (!original) return null;
    const text = original.type === MESSAGE_TYPE.REQUEST ? t('Payment request') : original.text;
    return { author: authorOf(original), text: clip(text) };
  };

  const messageItem = (message, overrides = {}) => ({
    key: message.id,
    type: 'message',
    ts: message.createdAt,
    message: {
      id: message.id,
      text: message.text,
      outgoing: message.outgoing,
      delivery: message.outgoing ? (message.delivery || 'sent') : 'sent',
      degraded: message.degraded === true,
      reactions: reactionsFor(message.id).map(({ emoji, count, mine }) => ({ emoji, count, mine })),
      reply: replyOf(message),
      canReact: !unknown,
      ...overrides,
    },
  });

  const items = [];
  for (const message of messages) {
    switch (message.type) {
      case MESSAGE_TYPE.TEXT:
        items.push(messageItem(message));
        break;

      case MESSAGE_TYPE.REQUEST: {
        const request = message.request;
        const state = requestStateOf(message) || 'pending';
        const pendingToPay = state === 'pending' && !message.outgoing;
        const found = state === 'paid' && message.outgoing ? settlementOf(message) : null;
        const settlement = state === 'paid' && message.outgoing
          ? {
            verified: found?.verified === true,
            walletName: found?.verified && found.walletId ? walletNameOf(found.walletId) : '',
            address: found?.verified ? found.address || '' : '',
          }
          : null;
        items.push({
          key: message.id,
          type: 'request',
          ts: message.createdAt,
          request: {
            id: message.id,
            amountSats: request.amountSats,
            fiatText: formatFiat(request.amountSats) || '',
            note: request.note || '',
            outgoing: message.outgoing,
            state,
            validUntil: request.validUntil,
            settlement,
            disabledReason: pendingToPay ? disabledReasonOf(message) : '',
            untrusted: unknown && !message.outgoing,
            busy: busy.has(message.id),
          },
        });
        break;
      }

      case MESSAGE_TYPE.STATUS:
        // Only a nudge from the partner is a row; the rest changed a card.
        if (!message.outgoing && message.status?.value === REQUEST_STATUS.REMINDER) {
          items.push(messageItem(message, {
            text: t('Reminder: a request is still open'),
            degraded: false,
            reactions: [],
            reply: null,
            canReact: false,
          }));
        }
        break;

      case MESSAGE_TYPE.PAYMENT: {
        const payment = message.payment;
        // A payment that settles a request of this thread: the card says it.
        if (payment?.requestId && byId.get(payment.requestId)?.type === MESSAGE_TYPE.REQUEST) break;
        if (message.outgoing || confirmedPayments.has(message.id)) {
          items.push({
            key: message.id,
            type: 'payment',
            ts: message.createdAt,
            payment: {
              id: message.id,
              outgoing: message.outgoing,
              amountSats: payment.amountSats,
              note: payment.note || '',
            },
          });
        } else {
          items.push(messageItem(message));
        }
        break;
      }

      default:
        break;
    }
  }
  return insertDaySeparators(items);
}

// ---------------------------------------------------------------------------
// Pure: errors in words
// ---------------------------------------------------------------------------

/**
 * Words for a failed action. `kind: 'no-inbox'` is the one case the page does
 * more than show text for (it offers a payment link instead).
 *
 * @param {unknown} error
 * @param {{ t: (key: string, params?: object) => string, name?: string }} context
 * @returns {{ code: string, kind: 'no-inbox' | 'general', message: string }}
 */
export function describeDmError(error, { t, name = '' }) {
  const code = DmError.is(error) ? error.code : 'UNKNOWN';
  let message;
  switch (code) {
    case DM_ERROR.NO_INBOX_RELAYS:
      return {
        code,
        kind: 'no-inbox',
        message: name
          ? t("{name} can't receive requests in the chat yet.", { name })
          : t("This contact can't receive requests in the chat yet."),
      };
    case DM_ERROR.NO_PAYMENT_ADDRESS:
      message = t('To request money you need a Lightning address in your profile.');
      break;
    case DM_ERROR.PAYMENT_ADDRESS_UNREACHABLE:
      message = t("Your Lightning address doesn't answer right now. Check it in your profile.");
      break;
    case DM_ERROR.AMOUNT_OUT_OF_RANGE:
      message = t('The amount is outside what the Lightning address accepts.');
      break;
    case DM_ERROR.INVOICE_FETCH_FAILED:
      message = t("Couldn't get an invoice from their Lightning address. Please try again.");
      break;
    case DM_ERROR.SECRET_KEY_IN_TEXT:
      message = t('Never share it. Sending is blocked.');
      break;
    case DM_ERROR.MESSAGE_TOO_LARGE:
      message = t('That message is too long.');
      break;
    case DM_ERROR.KEY_WIPED:
      message = t('Unlock the app, then try again.');
      break;
    case DM_ERROR.NO_IDENTITY:
      message = t('Set up your identity to use the chat.');
      break;
    case DM_ERROR.NO_RELAY_ACCEPTED:
    case DM_ERROR.RELAY_UNAVAILABLE:
    case DM_ERROR.AUTH_FAILED:
    case DM_ERROR.TIMEOUT:
      message = t("Couldn't send right now. Please try again in a moment.");
      break;
    default:
      message = t('Something went wrong. Try again.');
  }
  return { code, kind: 'general', message };
}

// ---------------------------------------------------------------------------
// Reactive glue
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ContactChatOptions
 * @property {unknown} partner Ref, getter or value: the partner's hex pubkey (null while unknown).
 * @property {unknown} partnerName Ref, getter or value: the name shown for them.
 * @property {unknown} [unknown] Ref, getter or value: the partner is not in the address book.
 * @property {unknown} [contact] Ref, getter or value: the address book entry, if any.
 * @property {object} store The messages store.
 * @property {ReturnType<import('./useChatRuntime.js').useChatRuntime>} runtime
 * @property {{ payContact: Function, payInvoice: Function, payAddress: Function }} pay `usePayContact(ctx)`.
 * @property {(sats: number, destinationType?: string) => ({ id: string, usable: boolean, reason: string | null } | null)} payingWalletFor
 *   The wallet that would pay `sats` (the default pick of the "Pay with" field).
 * @property {(walletId: string | null) => string} [walletNameOf] Display name of one of the user's wallets.
 * @property {() => Promise<import('../services/dm/paymentConfirmation.js').IncomingTransaction[]>} [loadIncomingTransactions]
 * @property {(key: string, params?: object) => string} t
 * @property {(sats: number) => string} [formatFiat] "≈ $4.20" or ''.
 * @property {() => number} [now] Milliseconds.
 * @property {typeof setTimeout} [setTimer]
 * @property {typeof clearTimeout} [clearTimer]
 */

/**
 * @param {ContactChatOptions} options
 */
export function useContactChat(options) {
  const {
    store, runtime, pay, payingWalletFor, t, formatFiat,
    walletNameOf = () => '',
    loadIncomingTransactions = async () => [],
    now: clock = Date.now,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(handle),
  } = options;
  const partner = () => toValue(options.partner) || null;
  const partnerName = () => toValue(options.partnerName) || '';
  const isUnknown = () => Boolean(toValue(options.unknown));
  const contact = () => toValue(options.contact) || null;

  const nowSeconds = () => Math.floor(clock() / 1000);
  /** Live clock for expiry; moved by the tick below. */
  const now = ref(nowSeconds());
  /** Ids of messages with an action in flight. */
  const busyIds = ref(new Set());
  /** 'found' | 'missing' | 'unknown': can the partner receive messages? */
  const reachability = ref('unknown');
  /** Incoming payment claims the user's wallets confirmed. */
  const confirmedPayments = shallowRef(new Set());

  // ----- the thread -------------------------------------------------------

  const messages = computed(() => {
    const key = partner();
    return key ? store.thread(key).messages : [];
  });

  const requestStateOf = (message) => {
    const own = message.outgoing ? runtime.requestState(message.id) : null;
    return own || store.requestStatus(message.id, now.value);
  };

  const disabledReasonOf = (message) => {
    const payer = payingWalletFor(message.request.amountSats, 'lightning');
    if (!payer) return DM_ERROR.WALLET_CANNOT_PAY;
    if (payer.usable) return '';
    return payer.reason === PAYING_REASON.UNSUPPORTED_DESTINATION
      ? DM_ERROR.WALLET_CANNOT_PAY
      : payingWalletReasonText(payer.reason, 'lightning', t);
  };

  const settlementOf = (message) => runtime.requestSettlement(message.id);

  const items = computed(() => buildThreadItems({
    messages: messages.value,
    partnerName: partnerName(),
    unknown: isUnknown(),
    now: now.value,
    reactionsFor: (id) => store.reactionsFor(partner(), id),
    requestStateOf,
    disabledReasonOf,
    settlementOf,
    walletNameOf,
    confirmedPayments: confirmedPayments.value,
    busyIds: busyIds.value,
    formatFiat,
    t,
  }));

  /** The thread has nothing to draw (the page shows its empty state). */
  const isEmpty = computed(() => items.value.length === 0);

  /** Messages cannot be sent to this partner: header "Payments only", no composer. */
  const paymentsOnly = computed(() => reachability.value === 'missing');

  // ----- the live clock ---------------------------------------------------

  let tickHandle = null;

  function nextWakeMs() {
    let wake = MAX_TICK_MS;
    for (const item of items.value) {
      if (item.type !== 'request' || item.request.state !== 'pending') continue;
      const until = item.request.validUntil * 1000 - clock() + 500;
      if (until > 0) wake = Math.min(wake, until);
    }
    return Math.max(MIN_TICK_MS, wake);
  }

  function scheduleTick() {
    if (tickHandle !== null) clearTimer(tickHandle);
    tickHandle = setTimer(() => {
      tickHandle = null;
      now.value = nowSeconds();
      scheduleTick();
    }, nextWakeMs());
  }

  // ----- confirming incoming payment claims -------------------------------

  let confirmRun = 0;
  const retryHandles = [];

  const claimed = computed(() => messages.value.filter(
    (message) => message.type === MESSAGE_TYPE.PAYMENT && !message.outgoing,
  ));

  async function confirmPayments(attempt = 0) {
    const run = ++confirmRun;
    const open = claimed.value.filter((message) => !confirmedPayments.value.has(message.id));
    if (open.length === 0) return;
    let transactions = [];
    try {
      transactions = await loadIncomingTransactions();
    } catch {
      transactions = [];
    }
    if (run !== confirmRun) return;
    const confirmed = confirmIncomingPayments(claimed.value, transactions);
    if (confirmed.size !== confirmedPayments.value.size || [...confirmed].some((id) => !confirmedPayments.value.has(id))) {
      confirmedPayments.value = confirmed;
    }
    const stillOpen = claimed.value.some((message) => !confirmed.has(message.id));
    if (stillOpen && attempt < CONFIRM_RETRY_MS.length) {
      retryHandles.push(setTimer(() => { void confirmPayments(attempt + 1); }, CONFIRM_RETRY_MS[attempt]));
    }
  }

  // ----- opening and leaving ----------------------------------------------

  /** The partner whose chat this view-model currently holds open (null: none). */
  let openedFor = null;

  /**
   * The chat is on screen: reads the thread, and finds out whether the partner
   * can receive messages. Calling it again after the partner changed (the same
   * page reused for another chat) starts over for the new one.
   */
  async function open() {
    const key = partner();
    if (!key) return;
    if (openedFor && openedFor !== key) close();
    openedFor = key;
    reachability.value = 'unknown';
    confirmedPayments.value = new Set();
    store.setOpenThread(key);
    now.value = nowSeconds();
    scheduleTick();
    void confirmPayments();
    void settleClaims();
    await refreshReachability();
  }

  /** The chat left the screen (or the app went to the background). */
  function close() {
    if (openedFor && store.openThread === openedFor) store.setOpenThread(null);
    openedFor = null;
  }

  /** The app came back to the foreground: read what arrived meanwhile. */
  function resume() {
    const key = partner();
    if (!key) return;
    openedFor = key;
    store.setOpenThread(key);
    now.value = nowSeconds();
    scheduleTick();
    void confirmPayments();
    void settleClaims();
  }

  /** Check the partner's payment claims for the user's own requests against their wallets (runtime). */
  async function settleClaims() {
    try {
      await runtime.settleClaims();
    } catch {
      // No runtime yet or a wallet that cannot answer: the claim stays unverified until the next look.
    }
  }

  async function refreshReachability() {
    const key = partner();
    if (!key) return;
    try {
      const answer = await runtime.partnerReachability(key);
      if (key === partner()) reachability.value = answer;
    } catch {
      // No runtime or no network: nothing is known, and the outbox delivers later.
      if (key === partner()) reachability.value = 'unknown';
    }
  }

  /** Stop all timers; the page calls it when it unmounts. */
  function dispose() {
    close();
    confirmRun += 1;
    if (tickHandle !== null) clearTimer(tickHandle);
    tickHandle = null;
    for (const handle of retryHandles.splice(0)) clearTimer(handle);
  }

  // New messages while the chat is open are read at once, and the clock may need to move.
  watch(
    () => messages.value.length,
    () => {
      if (!openedFor) return;
      store.markRead(partner());
      scheduleTick();
      void confirmPayments();
    },
  );

  // A request answered or a new one arriving moves the next expiry.
  watch(() => items.value.map((item) => `${item.key}:${item.request?.state ?? ''}`).join('|'), () => {
    if (openedFor) scheduleTick();
  });

  // ----- actions ----------------------------------------------------------

  const failure = (error) => ({ ok: false, error: describeDmError(error, { t, name: partnerName() }) });

  /** Run `task` with `id` marked busy; errors become `{ ok: false, error }`. */
  async function guarded(id, task) {
    if (id) {
      if (busyIds.value.has(id)) return { ok: false, error: { code: 'BUSY', kind: 'general', message: '' } };
      busyIds.value = new Set(busyIds.value).add(id);
    }
    try {
      const value = await task();
      return { ok: true, value };
    } catch (error) {
      return failure(error);
    } finally {
      if (id) {
        const next = new Set(busyIds.value);
        next.delete(id);
        busyIds.value = next;
      }
    }
  }

  const messageById = (id) => messages.value.find((message) => message.id === id) || null;

  /** Send a text message (optionally as a reply). */
  const sendText = (text, { replyTo } = {}) => guarded(null, () => runtime.sendText(partner(), text, replyTo ? { replyTo } : {}));

  /** React with an emoji; choosing the emoji you already used changes nothing. */
  async function react(id, emoji) {
    if (isUnknown()) return { ok: false, error: { code: 'UNKNOWN_SENDER', kind: 'general', message: '' } };
    const mine = store.reactionsFor(partner(), id).find((group) => group.mine);
    if (mine?.emoji === emoji) return { ok: true, value: null };
    return guarded(null, () => runtime.react(partner(), id, emoji));
  }

  /** Send a failed or waiting message again. */
  const retry = (id) => guarded(null, () => runtime.retry(id));

  const decline = (id) => guarded(id, () => runtime.declineRequest(partner(), id));
  const withdraw = (id) => guarded(id, () => runtime.cancelRequest(partner(), id));
  const remind = (id) => guarded(id, () => runtime.remindRequest(partner(), id));

  /** Ask the partner for money. */
  const requestMoney = ({ amountSats, note }) => guarded(null, () => runtime.requestMoney(partner(), { amountSats, note }));

  /**
   * Pay a request of the partner through the existing send pipeline. The
   * announcement after a successful payment is not made here (the page is
   * gone by then): the context string below makes the always-on announcer do it.
   *
   * The invoice is created now, from the requester's current Lightning address,
   * for exactly the requested amount, and handed to the same pipeline (docs
   * section 8a). A failed fetch is an error and nothing is paid.
   */
  async function payRequest(id) {
    const message = messageById(id);
    if (!message || message.type !== MESSAGE_TYPE.REQUEST || message.outgoing) return { ok: false, error: null };
    const fetched = await guarded(id, () => runtime.fetchRequestInvoice(partner(), id));
    if (!fetched.ok) return fetched;
    const payer = payingWalletFor(message.request.amountSats, 'lightning');
    pay.payInvoice(
      { bolt11: fetched.value.bolt11, name: partnerName() },
      {
        // An unusable pick is not forced on the wallet page: its own sheet explains and offers the others.
        walletId: payer?.usable ? payer.id : undefined,
        // The verify URL (LUD-21) rides along so the announcement can carry it.
        context: buildChatPaymentContext(partner(), message.id, fetched.value.verifyUrl),
        // The invoice has no address, so the contact is named for the history link.
        contactId: contact()?.id,
      },
    );
    return { ok: true };
  }

  /**
   * The request is over (its lifetime ended) but the payer wants to pay anyway:
   * the ordinary send flow to the requester's current Lightning address, with
   * the amount and the note of the request filled in and the request named in
   * the context, so the payment is announced as the payment of that request and
   * marks it paid (paid wins over expired).
   */
  async function sendAnyway(id) {
    const message = messageById(id);
    if (!message || message.type !== MESSAGE_TYPE.REQUEST || message.outgoing) return { ok: false, error: null };
    const resolved = await guarded(id, () => runtime.requestAddress(partner(), id));
    if (!resolved.ok) return resolved;
    const { amountSats, note } = message.request;
    const payer = payingWalletFor(amountSats, 'lightning');
    pay.payAddress({ address: resolved.value, addressType: 'lightning', name: partnerName() }, {
      walletId: payer?.usable ? payer.id : undefined,
      context: buildChatPaymentContext(partner(), message.id),
      amountSats,
      note: note || undefined,
    });
    return { ok: true };
  }

  /** The user's own request is over: the same amount and note, one new request. */
  function requestAgain(id) {
    const message = messageById(id);
    if (!message || message.type !== MESSAGE_TYPE.REQUEST || !message.outgoing) return Promise.resolve({ ok: false, error: null });
    const { amountSats, note } = message.request;
    return guarded(id, () => runtime.requestMoney(partner(), { amountSats, note: note || undefined }));
  }

  /** Send money to the contact (their address, not an invoice). */
  function sendMoney() {
    const entry = contact();
    if (!entry) return { ok: false, error: null };
    const payer = payingWalletFor(0, entry.addressType || 'lightning');
    pay.payContact(entry, {
      walletId: payer?.usable ? payer.id : undefined,
      context: buildChatPaymentContext(partner()),
    });
    return { ok: true };
  }

  return {
    // state
    items,
    isEmpty,
    reachability,
    paymentsOnly,
    busyIds,
    // lifecycle
    open,
    close,
    resume,
    dispose,
    refreshReachability,
    // actions
    sendText,
    react,
    retry,
    decline,
    withdraw,
    remind,
    requestMoney,
    payRequest,
    sendAnyway,
    requestAgain,
    sendMoney,
    // for tests and the page
    messageById,
    now,
  };
}
