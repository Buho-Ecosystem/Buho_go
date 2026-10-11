/**
 * The contact chat's inbox coordinator: receives, sends and keeps retrying.
 *
 * This module composes the other `services/dm/` modules into the two flows the
 * chat store needs (docs/CONTACT_CHAT.md sections 3, 5 and 6):
 *
 * RECEIVE. One subscription for kind 1059 events `p`-tagged to us on our own
 * inbox relays. Every wrap goes through
 *   wrap gate -> open (identity key) -> rumor gate -> parseRumor -> store.
 * Wraps are processed one at a time, in arrival order, so the gates (which
 * remember what they saw) behave deterministically. The sync cursor moves only
 * after a relay finished its stored events and everything received so far was
 * processed, and then to the time the subscription started, never to an event
 * timestamp (wrap timestamps are randomised up to two days into the past).
 * A wrap that arrives while the identity key is wiped is not dropped: it waits
 * in a small bounded queue and is opened after the next successful key use, and
 * while anything waits the cursor stays put so a restart fetches it again.
 *
 * SEND. Resolve the partner's kind 10050 relays, seal and wrap once (one rumor
 * id), store the message locally, then publish the recipient wrap to the
 * partner's relays and the self copy to our own inbox relays. One accepting
 * relay is enough for "sent". Wraps are kept in the outbox until delivered, so
 * a retry re-sends the very same events (same rumor id: relays answer
 * `duplicate`, which counts as delivered) with exponential backoff, and gives
 * up after a fixed number of attempts.
 *
 * Pure service: no Vue, Pinia or i18n. The store, the transport, the key
 * holder, the resolver and the clock are injected. Nothing is ever logged;
 * rumors, keys and invoices are private.
 */

import { createAuthEventTemplate } from 'nostr-core';
import { DM_DISCOVERY_RELAYS, DM_INBOX_RELAYS, KIND, SINCE_SLACK_SECONDS } from './constants.js';
import { DM_ERROR, DmError, isRetryableRelayReason, isSignerWait } from './errors.js';
import { createRumorGate, createWrapGate } from './inboundPolicy.js';
import { INBOX_STATUS, buildInboxRelayListTemplate, normalizeInboxRelayUrl } from './inboxRelays.js';
import { openGiftWrap } from './openWrap.js';
import { sealAndWrap } from './giftWrap.js';
import { MESSAGE_TYPE, parseRumor } from './protocol.js';

// ---------------------------------------------------------------------------
// Public vocabulary
// ---------------------------------------------------------------------------

/** Local send state of an outgoing message; the store keeps the same four values. */
export const DELIVERY = Object.freeze({
  QUEUED: 'queued',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
});

/**
 * Tunables of the outbox. Mobile networks come and go, so the first retries
 * are quick and later ones back off to minutes; after `maxAttempts` the
 * message shows as failed and waits for a manual retry.
 */
export const OUTBOX_DEFAULTS = Object.freeze({
  /** Delivery attempts (each one a publish round) before the inbox gives up. */
  maxAttempts: 6,
  /** Wait before the second attempt, ms; doubles after each failure. */
  baseDelayMs: 5_000,
  /** Longest wait between attempts, ms. */
  maxDelayMs: 5 * 60 * 1000,
  /** Messages delivered in parallel by one `retryOutbox()` run. */
  concurrency: 3,
  /** Random spread of a wait, as a fraction of it (0.2 = plus or minus 20%). */
  jitter: 0.2,
});

/**
 * Per-sender limit for live wraps: at most this many rumors from one sender
 * per window. Generous for a conversation, tight for a flood. Not applied to
 * backfill, which legitimately delivers many messages at once.
 */
export const LIVE_RATE = Object.freeze({ max: 30, windowMs: 60_000 });

/** Wraps held while the identity key is unavailable; more than this stops the cursor for good. */
export const MAX_PENDING_WRAPS = 200;

/**
 * @typedef {import('./protocol.js').ChatMessage} ChatMessage
 * @typedef {import('nostr-core').NostrEvent} NostrEvent
 */

/**
 * One message waiting to be delivered. Plain JSON: the store persists it as is.
 *
 * @typedef {object} OutboxItem
 * @property {string} id Rumor id (the message id); the store's key.
 * @property {string} partner Contact pubkey (64 lowercase hex).
 * @property {string[] | null} relays The partner's inbox relays, or null while they are still unknown.
 * @property {{ recipient: NostrEvent, self: NostrEvent }} wraps The sealed events, reused on every retry.
 * @property {{ recipient: boolean, self: boolean }} delivered Which copy a relay already holds.
 * @property {number} attempts Failed delivery rounds so far.
 * @property {number} nextAttemptAt Clock time (ms) before which the timer does not retry.
 * @property {boolean} exhausted True once retries ran out; only `retry(id)` sends it again.
 * @property {boolean} stale True when the partner's relay list should be looked up again before the next attempt.
 * @property {string | null} lastCode A `DM_ERROR` code describing the last failure.
 */

/**
 * The narrow port to the chat store. The Pinia adapter is written separately;
 * everything here is synchronous and must not throw for ordinary input.
 *
 * @typedef {object} InboxStore
 * @property {() => number | null} getSyncCursor Unix seconds of the last completed sync, or null before the first.
 * @property {(seconds: number) => void} setSyncCursor Persist the cursor (the inbox only ever moves it forward).
 * @property {(id: string) => boolean} hasMessage Whether a message with this rumor id is stored.
 * @property {(message: ChatMessage, options: { live: boolean }) => boolean} ingest Store a received
 *   message (or our own self copy); true when it was new.
 * @property {(message: ChatMessage, options: { delivery: 'queued' | 'sending' | 'sent' | 'failed' }) => unknown} addOutgoing
 *   Store a message we just wrote, with its delivery state.
 * @property {(id: string, delivery: 'queued' | 'sending' | 'sent' | 'failed') => unknown} setDelivery
 *   Move an outgoing message to a new delivery state (a `sent` one stays sent).
 * @property {(pubkey: string) => boolean} isBlocked Whether a sender is blocked.
 * @property {{ list: () => OutboxItem[], put: (item: OutboxItem) => unknown, remove: (id: string) => unknown }} outbox
 *   The persistent outbox: `put` inserts or replaces by `item.id`.
 * @property {() => unknown} getInboxRelaySnapshot The resolver snapshot saved earlier, or null.
 * @property {(snapshot: unknown) => unknown} setInboxRelaySnapshot Persist the resolver's `snapshot()`.
 */

/**
 * @typedef {object} InboxStatus
 * @property {boolean} running `start()` ran and `stop()` did not.
 * @property {boolean} synced At least one relay finished its stored events in this run.
 * @property {number} syncedRelays How many relays did.
 * @property {number | null} cursor The persisted sync cursor.
 * @property {number} pendingWraps Wraps waiting for the signer (locked app, signer app offline or refusing).
 * @property {string | null} signerHold Why they wait: the signer's DmError code, null when nothing waits.
 * @property {number} outbox Messages in the outbox.
 * @property {number} exhausted Of those, how many ran out of retries.
 * @property {number} sending Deliveries in progress.
 */

/**
 * @typedef {'published' | 'unchanged' | 'unknown' | 'failed'} OwnRelayListStatus
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEX_64 = /^[0-9a-f]{64}$/;

const noop = () => {};

/** Run a consumer callback; its failure must never break the receive loop. */
function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return;
  try {
    fn(...args);
  } catch {
    // Consumer bug: contained on purpose. Logging could leak message content.
  }
}


const sameSet = (a, b) => a.length === b.length && a.every((value) => b.includes(value));

/**
 * The AUTH signer for the transport: answers a relay's NIP-42 challenge
 * through the chat signer (the key on this phone or the signer app).
 *
 * @param {Pick<import('./dmSigner.js').DmSigner, 'signEvent'>} signer
 * @returns {(request: { relay: string, challenge: string }) => Promise<NostrEvent>}
 */
export function createSignAuth(signer) {
  return ({ relay, challenge }) => signer.signEvent(createAuthEventTemplate({ relay, challenge }));
}

// ---------------------------------------------------------------------------
// The coordinator
// ---------------------------------------------------------------------------

/**
 * Create the inbox for ONE identity.
 *
 * @param {object} options
 * @param {string} options.me Own pubkey (64 lowercase hex).
 * @param {import('./dmSigner.js').DmSigner} options.signer The chat signer (`dmSigner.js`).
 * @param {{
 *   subscribe: Function, publish: Function, warmUp: Function,
 * }} options.transport The relay transport (`transport.js`).
 * @param {{ resolve: Function, invalidate: Function, snapshot: Function, hydrate: Function }} options.resolver
 *   The inbox relay resolver (`inboxRelays.js`).
 * @param {InboxStore} options.store
 * @param {() => number} [options.now] Clock in MILLISECONDS (like `Date.now`).
 * @param {typeof setTimeout} [options.setTimer]
 * @param {typeof clearTimeout} [options.clearTimer]
 * @param {readonly string[]} [options.inboxRelays] Where we receive; also where self copies go.
 * @param {readonly string[]} [options.discoveryRelays] Where our kind 10050 list is published.
 * @param {(message: ChatMessage, info: { live: boolean }) => void} [options.onIncoming] Called for a new,
 *   incoming, live message that is not a reaction (the hook for notifications).
 * @param {(code: string | null) => void} [options.onSignerHold] Called when received
 *   wraps start or stop waiting for the signer (the code says why).
 * @param {Partial<typeof OUTBOX_DEFAULTS>} [options.outbox] Overrides of `OUTBOX_DEFAULTS`.
 * @param {{ max: number, windowMs: number }} [options.liveRate] Overrides `LIVE_RATE`.
 * @param {() => number} [options.random] Uniform in [0, 1), for backoff jitter.
 * @returns {{
 *   start: () => Promise<void>,
 *   stop: () => void,
 *   send: (request: { partner: string, template: import('nostr-core').EventTemplate, hints?: string[] }) => Promise<ChatMessage>,
 *   retryOutbox: (options?: { ignoreBackoff?: boolean }) => Promise<{ attempted: number }>,
 *   retryWaiting: () => void,
 *   retry: (id: string) => Promise<boolean>,
 *   ensureOwnRelayList: () => Promise<{ status: OwnRelayListStatus }>,
 *   status: () => InboxStatus,
 *   whenIdle: () => Promise<void>,
 * }}
 * @throws {DmError} INVALID_ARGUMENT for a missing collaborator or a bad relay list.
 */
export function createInbox({
  me,
  signer,
  transport,
  resolver,
  store,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  inboxRelays = DM_INBOX_RELAYS,
  discoveryRelays = DM_DISCOVERY_RELAYS,
  onIncoming,
  onSignerHold,
  outbox: outboxOptions,
  liveRate = LIVE_RATE,
  random = Math.random,
} = {}) {
  const invalid = (message) => new DmError(DM_ERROR.INVALID_ARGUMENT, message);
  if (typeof me !== 'string' || !HEX_64.test(me)) throw invalid('me must be 64 lowercase hex characters');
  if (typeof signer?.signEvent !== 'function' || typeof signer.nip44Decrypt !== 'function') {
    throw invalid('signer is required');
  }
  if (typeof transport?.subscribe !== 'function' || typeof transport.publish !== 'function') {
    throw invalid('transport is required');
  }
  if (typeof resolver?.resolve !== 'function') throw invalid('resolver is required');
  if (!store || typeof store.ingest !== 'function' || typeof store.outbox?.list !== 'function') {
    throw invalid('store is required');
  }
  const ownInbox = [...new Set((inboxRelays ?? []).map(normalizeInboxRelayUrl))];
  if (ownInbox.length === 0 || ownInbox.includes(null)) throw invalid('inboxRelays must be valid wss:// URLs');
  const discovery = [...discoveryRelays];
  const policy = { ...OUTBOX_DEFAULTS, ...outboxOptions };

  // ----- state -----------------------------------------------------------

  /** Bumped by `stop()`: work that began under an older value must not touch the store. */
  let epoch = 0;
  let running = false;
  let subscription = null;
  let startedAtSeconds = 0;
  /** Relays that finished their stored events: what they send from now on is live. */
  let eosed = new Set();
  let wrapGate = null;
  let backfillGate = null;
  let liveGate = null;
  /** Wraps that waited for the key: `{ event, live }`. */
  let pending = [];
  /** Why received wraps wait (the signer's DmError code), or null: the chat says so. */
  let signerHold = null;
  /** Set when the pending queue overflowed: the cursor must then never advance this run. */
  let cursorBlocked = false;
  let draining = false;
  let drainQueued = false;
  /** Serialises receive work; every step is wrapped so the chain never rejects. */
  let chain = Promise.resolve();
  /** @type {Map<string, Promise<void>>} */
  const active = new Map();
  let retryTimer = null;
  let ownListRun = null;

  const nowSeconds = () => Math.floor(now() / 1000);

  // ----- serial queue ----------------------------------------------------

  /** Append a step to the receive chain; it is skipped if `stop()` ran meanwhile. */
  function enqueue(step) {
    const mine = epoch;
    chain = chain.then(async () => {
      if (mine !== epoch) return;
      try {
        await step(mine);
      } catch {
        // A hostile or broken wrap must not stall the inbox.
      }
    });
  }

  // ----- identity --------------------------------------------------------

  /** Run signer work; after a success, wraps that waited for the signer are processed. */
  function setSignerHold(code) {
    if (signerHold === code) return;
    signerHold = code;
    safeCall(onSignerHold, code);
  }

  async function withSigner(work) {
    const result = await work();
    setSignerHold(null);
    if (pending.length > 0 && !draining && !drainQueued) {
      drainQueued = true;
      enqueue(async () => {
        drainQueued = false;
        await drainPending();
      });
    }
    return result;
  }

  // ----- receiving -------------------------------------------------------

  /**
   * Open and store one wrap that passed the wrap gate.
   *
   * @returns {Promise<'done' | 'deferred'>} `deferred`: the signer cannot answer now, keep the wrap.
   */
  async function openAndIngest(event, live, mine) {
    let opened;
    try {
      opened = await withSigner(() => openGiftWrap(event, signer, { me }));
    } catch (err) {
      if (!isSignerWait(err)) return 'done';
      setSignerHold(err.code);
      return 'deferred';
    }
    if (mine !== epoch) return 'done';
    if (!opened.ok) {
      remember(event);
      return 'done';
    }

    const { rumor, sender } = opened;
    // Cheap and before the rate limit: a re-delivered message must not cost the sender's budget.
    // Our own messages still pass, because their self copy confirms delivery.
    if (sender !== me && store.hasMessage(rumor.id)) {
      remember(event);
      return 'done';
    }

    const verdict = await (live ? liveGate : backfillGate).check(rumor);
    if (mine !== epoch) return 'done';
    // A live message over the sender's rate limit stays unhandled: a later
    // backfill (no rate limit) may still take it. Every other verdict is final.
    if (!verdict.accepted) {
      if (!String(verdict.reason ?? '').startsWith('rate-limited')) remember(event);
      return 'done';
    }

    const message = parseRumor(rumor, { me });
    const isNew = message ? store.ingest(message, { live }) === true : false;
    remember(event);
    if (!message) return 'done';
    if (isNew && live && !message.outgoing && message.type !== MESSAGE_TYPE.REACTION) {
      safeCall(onIncoming, message, { live });
    }
    return 'done';
  }

  /** A wrap that was opened and dealt with: the next start does not open it again. */
  function remember(event) {
    store.rememberHandledWrap?.(event.id, event.created_at);
  }

  /** The live path for one wrap from the subscription. */
  async function processWrap(event, live, mine) {
    const verdict = await wrapGate.check(event);
    if (mine !== epoch || !verdict.accepted) return;
    // Handled before (an earlier start): nothing to decrypt, nothing new to store.
    if (store.hasHandledWrap?.(event.id)) return;
    if ((await openAndIngest(event, live, mine)) === 'deferred') queuePending(event, live);
  }

  function queuePending(event, live) {
    if (pending.length >= MAX_PENDING_WRAPS) {
      // The oldest wrap is lost for this run; a restart fetches it again only
      // if the cursor never moved past it.
      pending.shift();
      cursorBlocked = true;
    }
    pending.push({ event, live });
  }

  /** Process the waiting wraps in order until one finds the key unavailable again. */
  async function drainPending() {
    if (draining) return;
    draining = true;
    const mine = epoch;
    try {
      while (pending.length > 0 && mine === epoch) {
        const { event, live } = pending[0];
        if ((await openAndIngest(event, live, mine)) === 'deferred') break;
        if (mine === epoch) pending.shift();
      }
    } finally {
      draining = false;
    }
    if (mine === epoch) advanceCursor();
  }

  /** Move the cursor to the start of this run's subscription, if that is safe. */
  function advanceCursor() {
    if (!running || eosed.size === 0 || pending.length > 0 || cursorBlocked) return;
    const current = store.getSyncCursor();
    if (Number.isFinite(current) && current >= startedAtSeconds) return;
    store.setSyncCursor(startedAtSeconds);
  }

  const handlers = {
    onevent(event, relay) {
      const live = eosed.has(relay);
      enqueue((mine) => processWrap(event, live, mine));
    },
    oneose(relay) {
      eosed.add(relay);
      // After everything received so far was processed, never before.
      enqueue(() => advanceCursor());
    },
    onclosed: noop,
  };

  // ----- start and stop --------------------------------------------------

  async function start() {
    if (running) return;
    running = true;
    eosed = new Set();
    pending = [];
    cursorBlocked = false;
    wrapGate = createWrapGate();
    backfillGate = createRumorGate({ me, isBlocked: (pubkey) => store.isBlocked(pubkey) });
    liveGate = createRumorGate({ me, isBlocked: (pubkey) => store.isBlocked(pubkey), rate: liveRate });

    try {
      resolver.hydrate?.(store.getInboxRelaySnapshot());
      Promise.resolve(transport.warmUp?.(ownInbox)).catch(noop);

      startedAtSeconds = nowSeconds();
      const cursor = store.getSyncCursor();
      const filter = { kinds: [KIND.GIFT_WRAP], '#p': [me] };
      // The first sync has no lower bound; later ones overlap by the wrap timestamp randomisation.
      if (Number.isFinite(cursor)) filter.since = Math.max(0, cursor - SINCE_SLACK_SECONDS);
      subscription = transport.subscribe(ownInbox, filter, handlers);
    } catch (err) {
      running = false;
      throw err;
    }

    // Neither blocks the start: they talk to the network and report nothing to the caller.
    ensureOwnRelayList().catch(noop);
    retryOutbox({ ignoreBackoff: true }).catch(noop);
  }

  function stop() {
    if (!running && subscription === null && retryTimer === null) return;
    running = false;
    epoch += 1;
    try {
      subscription?.close();
    } catch {
      // Closing a dead subscription has nothing left to tell us.
    }
    subscription = null;
    disarmTimer();
    pending = [];
    draining = false;
    drainQueued = false;
    eosed = new Set();
    // The store is left untouched: messages, outbox and cursor stay as they are.
  }

  // ----- sending ---------------------------------------------------------

  const persistSnapshot = () => {
    try {
      store.setInboxRelaySnapshot?.(resolver.snapshot?.() ?? null);
    } catch {
      // A cache that cannot be saved only costs a lookup next time.
    }
  };

  /**
   * Send a message built by `protocol.js` to `partner`.
   *
   * Returns once the message is stored locally; delivery continues in the
   * background and is reported through `store.setDelivery`. Use `whenIdle()`
   * to wait for it.
   *
   * @throws {DmError} NO_INBOX_RELAYS when the partner publishes no inbox list
   *   (nothing is stored); INVALID_ARGUMENT for a bad partner or a template
   *   that does not address the partner; the signer's codes (`isSignerWait`)
   *   when it cannot seal now; MESSAGE_TOO_LARGE from sealing.
   */
  async function send({ partner, template, hints } = {}) {
    if (typeof partner !== 'string' || !HEX_64.test(partner) || partner === me) {
      throw invalid('partner must be another pubkey in 64 lowercase hex characters');
    }
    const mine = epoch;
    const lookup = await resolver.resolve(partner, { hints });
    persistSnapshot();
    if (lookup.status === INBOX_STATUS.MISSING) {
      throw new DmError(DM_ERROR.NO_INBOX_RELAYS, 'the contact has no inbox relay list');
    }

    const sealed = await withSigner(() => sealAndWrap({ template, signer, recipients: [partner] }));
    const message = parseRumor(sealed.rumor, { me });
    if (!message || !message.outgoing || message.partner !== partner) {
      throw invalid('the template does not address this partner');
    }
    const found = lookup.status === INBOX_STATUS.FOUND;
    const recipientWrap = sealed.wraps.find((wrap) => !wrap.self).event;
    const selfWrap = sealed.wraps.find((wrap) => wrap.self).event;

    /** @type {OutboxItem} */
    const item = {
      id: message.id,
      partner,
      relays: found ? lookup.relays : null,
      wraps: { recipient: recipientWrap, self: selfWrap },
      delivered: { recipient: false, self: false },
      attempts: 0,
      nextAttemptAt: found ? 0 : now() + policy.baseDelayMs,
      exhausted: false,
      stale: false,
      lastCode: found ? null : DM_ERROR.RELAY_UNAVAILABLE,
    };

    // Persist before the first byte leaves the device: a crash must not lose or double a message.
    store.addOutgoing(message, { delivery: found ? DELIVERY.SENDING : DELIVERY.QUEUED });
    store.outbox.put(item);
    if (found) {
      track(item.id, deliver(item, mine));
    } else {
      armTimer();
    }
    return message;
  }

  /** Remember a running delivery so it is not started twice and `whenIdle()` can wait for it. */
  function track(id, promise) {
    const mine = epoch;
    const run = promise.catch(noop).finally(() => {
      if (active.get(id) === run) active.delete(id);
      // Only now is the item no longer "being delivered", so only now can it be scheduled again.
      if (mine === epoch) armTimer();
    });
    active.set(id, run);
    return run;
  }

  /** Classify the failed publishes of one copy: can trying again help? */
  function isRetryable(results) {
    if (results.length === 0) return true;
    return results.some((r) => r.code !== DM_ERROR.NO_RELAY_ACCEPTED || isRetryableRelayReason(r.prefix));
  }

  /** The most telling code among failed publishes (an AUTH or network problem over a refusal). */
  function failureCode(results) {
    return (results.find((r) => r.code !== DM_ERROR.NO_RELAY_ACCEPTED) ?? results[0])?.code ?? DM_ERROR.NO_RELAY_ACCEPTED;
  }

  /** Publish one copy and report `{ accepted, retryable, code }`. Never rejects. */
  async function publishCopy(relays, event) {
    try {
      const { firstAccept, allSettled } = transport.publish(relays, event);
      if (await firstAccept) return { accepted: true };
      const results = await allSettled;
      return { accepted: false, retryable: isRetryable(results), code: failureCode(results) };
    } catch (cause) {
      return { accepted: false, retryable: true, code: DmError.is(cause) ? cause.code : DM_ERROR.RELAY_UNAVAILABLE };
    }
  }

  /** Wait time before the next attempt after `attempts` failures, ms. */
  function backoff(attempts) {
    const base = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempts - 1));
    return Math.round(base * (1 + policy.jitter * (2 * random() - 1)));
  }

  /** Give up on an item for good (the relays refuse it) and tell the store. */
  function fail(item, code, { keep }) {
    item.lastCode = code;
    store.setDelivery(item.id, DELIVERY.FAILED);
    if (keep) {
      item.exhausted = true;
      store.outbox.put(item);
    } else {
      store.outbox.remove(item.id);
    }
  }

  /** Record one failed round: wait for the next attempt, or give up when attempts ran out. */
  function failRound(item, code, { recipientDone }) {
    item.attempts += 1;
    item.lastCode = code;
    if (item.attempts >= policy.maxAttempts) {
      if (recipientDone) {
        // Only the self copy is missing: the message is out, so there is nothing to show or keep.
        store.outbox.remove(item.id);
      } else {
        fail(item, code, { keep: true });
      }
      return;
    }
    item.nextAttemptAt = now() + backoff(item.attempts);
    if (!recipientDone) store.setDelivery(item.id, DELIVERY.QUEUED);
    store.outbox.put(item);
  }

  /**
   * One delivery round for an outbox item: whichever copy is not yet
   * delivered is published, the recipient copy to the partner's relays and the
   * self copy to ours, in parallel.
   */
  async function deliver(item, mine) {
    const alive = () => mine === epoch;

    if (item.relays === null || item.stale) {
      let lookup = null;
      try {
        lookup = await resolver.resolve(item.partner, { force: item.stale });
      } catch {
        lookup = null;
      }
      if (!alive()) return;
      persistSnapshot();
      if (lookup?.status === INBOX_STATUS.FOUND) {
        item.relays = lookup.relays;
        item.stale = false;
      } else if (lookup?.status === INBOX_STATUS.MISSING) {
        fail(item, DM_ERROR.NO_INBOX_RELAYS, { keep: false });
        return;
      } else if (item.relays === null) {
        failRound(item, DM_ERROR.RELAY_UNAVAILABLE, { recipientDone: false });
        return;
      }
    }

    if (!item.delivered.recipient) store.setDelivery(item.id, DELIVERY.SENDING);

    const sendRecipient = async () => {
      if (item.delivered.recipient) return null;
      const outcome = await publishCopy(item.relays, item.wraps.recipient);
      if (alive() && outcome.accepted) {
        item.delivered.recipient = true;
        // Sent as soon as the first relay has it; the self copy is background work.
        store.setDelivery(item.id, DELIVERY.SENT);
      }
      return outcome;
    };
    const sendSelf = async () => {
      if (item.delivered.self) return null;
      const outcome = await publishCopy(ownInbox, item.wraps.self);
      if (alive() && outcome.accepted) item.delivered.self = true;
      return outcome;
    };
    const [recipient, self] = await Promise.all([sendRecipient(), sendSelf()]);
    if (!alive()) return;

    if (item.delivered.recipient && item.delivered.self) {
      store.outbox.remove(item.id);
      return;
    }

    if (!item.delivered.recipient) {
      if (!recipient.retryable) {
        fail(item, recipient.code, { keep: false });
        return;
      }
      // A relay list we trusted may be out of date: look it up again before the next try.
      if (recipient.code === DM_ERROR.RELAY_UNAVAILABLE || recipient.code === DM_ERROR.NO_RELAY_ACCEPTED) {
        item.stale = true;
        resolver.invalidate?.(item.partner);
      }
      failRound(item, recipient.code, { recipientDone: false });
    } else {
      failRound(item, self?.code ?? DM_ERROR.RELAY_UNAVAILABLE, { recipientDone: true });
    }
  }

  // ----- outbox ----------------------------------------------------------

  function disarmTimer() {
    if (retryTimer === null) return;
    const handle = retryTimer;
    retryTimer = null;
    try {
      clearTimer(handle);
    } catch {
      // A stale timer would only run `retryOutbox` once more.
    }
  }

  /** Wake up when the earliest waiting item is due. Items being delivered re-arm it when they finish. */
  function armTimer() {
    disarmTimer();
    let due = null;
    for (const item of store.outbox.list()) {
      if (item.exhausted || active.has(item.id)) continue;
      const at = Number.isFinite(item.nextAttemptAt) ? item.nextAttemptAt : 0;
      if (due === null || at < due) due = at;
    }
    if (due === null) return;
    const mine = epoch;
    retryTimer = setTimer(() => {
      retryTimer = null;
      if (mine !== epoch) return;
      retryOutbox().catch(noop);
    }, Math.max(0, due - now()));
  }

  /**
   * Send what is waiting in the outbox. Call it when the network returns or
   * the app resumes. At most `concurrency` messages are delivered at once.
   *
   * @param {object} [options]
   * @param {boolean} [options.ignoreBackoff=false] Also try items whose wait is not over (the network
   *   just came back, so waiting longer has no point). Exhausted items are never sent here.
   * @returns {Promise<{ attempted: number }>}
   */
  async function retryOutbox({ ignoreBackoff = false } = {}) {
    const mine = epoch;
    // Maybe the key is back: wraps that waited for it get their chance.
    if (pending.length > 0) {
      enqueue(async () => {
        await drainPending();
      });
    }
    const clock = now();
    const due = store.outbox
      .list()
      .filter((item) => !item.exhausted && !active.has(item.id) && (ignoreBackoff || !(item.nextAttemptAt > clock)));
    let next = 0;
    const worker = async () => {
      while (next < due.length && mine === epoch) {
        const item = due[next];
        next += 1;
        await track(item.id, deliver(item, mine));
      }
    };
    const workers = Array.from({ length: Math.min(policy.concurrency, due.length) }, worker);
    await Promise.all(workers);
    if (mine === epoch) armTimer();
    return { attempted: due.length };
  }

  /**
   * Send one failed message again, from the start of its retry budget.
   *
   * @param {string} id Message (rumor) id.
   * @returns {Promise<boolean>} False when no such message is in the outbox.
   */
  async function retry(id) {
    const item = store.outbox.list().find((entry) => entry.id === id);
    if (!item) return false;
    item.exhausted = false;
    item.attempts = 0;
    item.nextAttemptAt = 0;
    store.outbox.put(item);
    if (!active.has(id)) await track(id, deliver(item, epoch));
    return true;
  }

  // ----- own relay list --------------------------------------------------

  /**
   * Make sure our kind 10050 list on the discovery relays names our inbox
   * relays; publish it if it is missing or different. Never throws and never
   * publishes when no relay answered (offline). Concurrent calls share one run.
   *
   * @returns {Promise<{ status: OwnRelayListStatus }>} `published`, `unchanged`,
   *   `unknown` (no relay answered, nothing done) or `failed`.
   */
  function ensureOwnRelayList() {
    ownListRun ??= (async () => {
      try {
        const lookup = await resolver.resolve(me, { force: true });
        if (lookup.status === INBOX_STATUS.UNKNOWN) return { status: 'unknown' };
        if (lookup.status === INBOX_STATUS.FOUND && sameSet(lookup.relays, ownInbox)) return { status: 'unchanged' };

        const template = buildInboxRelayListTemplate(ownInbox, { now: nowSeconds() });
        const event = await withSigner(() => signer.signEvent(template));
        const { firstAccept } = transport.publish(discovery, event);
        const accepted = await firstAccept;
        resolver.invalidate?.(me);
        return { status: accepted ? 'published' : 'failed' };
      } catch {
        return { status: 'failed' };
      }
    })().finally(() => {
      ownListRun = null;
    });
    return ownListRun;
  }

  // ----- status ----------------------------------------------------------

  /** @returns {InboxStatus} */
  function status() {
    const items = store.outbox.list();
    return {
      running,
      synced: eosed.size > 0,
      syncedRelays: eosed.size,
      cursor: store.getSyncCursor() ?? null,
      pendingWraps: pending.length,
      signerHold: pending.length > 0 ? signerHold : null,
      outbox: items.length,
      exhausted: items.filter((item) => item.exhausted).length,
      sending: active.size,
    };
  }

  /** Resolves when received wraps are processed and no delivery is running. For tests and shutdown. */
  async function whenIdle() {
    for (;;) {
      const seen = chain;
      await seen;
      await Promise.all([...active.values()]);
      if (seen === chain && active.size === 0) return;
    }
  }

  /** Open the wraps that waited for the signer again (the person asked to retry). */
  function retryWaiting() {
    if (running && pending.length > 0) enqueue(() => drainPending());
  }

  return Object.freeze({ start, stop, send, retryOutbox, retry, retryWaiting, ensureOwnRelayList, status, whenIdle });
}
