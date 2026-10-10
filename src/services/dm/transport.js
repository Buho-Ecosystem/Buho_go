/**
 * Relay transport for the contact chat: connections that handle NIP-42 AUTH
 * on their own, so the user never sees it.
 *
 * Gift wraps (kind 1059) are only served to a client that authenticated, and
 * some relays refuse anonymous writes too, so a plain relay pool cannot carry
 * this feature (upstream issue #72, docs/CONTACT_CHAT.md section 11). This
 * module owns its own `nostr-core` `Relay` instances, separate from the shared
 * public pool so the identity never authenticates public queries, and keeps
 * three promises:
 *
 * 1. Two roles, never mixed. A READ connection answers a challenge with the
 *    identity (`signAuth`), because the relay must know whose inbox it serves.
 *    A WRITE connection answers with a throwaway key created per connection,
 *    so no relay learns who writes. A relay in both sets gets two sockets.
 * 2. AUTH is a state machine, not a branch in the caller. A challenge is
 *    answered at once; a refusal that mentions `auth-required` waits for (or
 *    triggers) that answer and then repeats the request exactly once per
 *    authentication. A failed AUTH marks the socket `auth-failed` and is never
 *    retried on it: relays such as damus send a challenge and then reject the
 *    answer, and a retry loop there would hammer them forever.
 * 3. Relays are third parties. Every relay-supplied value (challenge, reason,
 *    event) is treated as hostile, every wait is bounded, every timer is
 *    tracked and cancelled on `close()`, no promise this module creates can
 *    reject unhandled, and nothing is ever logged (no keys, events or content).
 *
 * Reads survive reconnects: after a drop `nostr-core` reconnects and replays
 * the REQ, which a relay may close with `auth-required` before the new socket
 * is authenticated; the logical subscription then re-authenticates and
 * re-subscribes. An initial connection failure does not reconnect in
 * `nostr-core`, so this module backs off and retries it itself, until the
 * subscription is closed.
 *
 * No Vue, Pinia or i18n; collaborators (WebSocket, timers, signer) are
 * injected so the tests run against an in-memory relay.
 *
 * Contract: docs/CONTACT_CHAT.md sections 5 and 6.
 */

import { Relay, createAuthEvent, generateSecretKey, normalizeURL } from 'nostr-core';
import { KIND } from './constants.js';
import {
  DM_ERROR,
  DmError,
  isAuthRequired,
  isDeliveredRelayReason,
  isRetryableRelayReason,
  parseRelayReason,
} from './errors.js';

// ---------------------------------------------------------------------------
// Public vocabulary
// ---------------------------------------------------------------------------

/** What a connection is used for. Fixed at creation; decides which key answers AUTH. */
export const RELAY_ROLE = Object.freeze({
  /** Own inbox subscriptions; authenticates as the identity. */
  READ: 'read',
  /** Publishing; authenticates with an ephemeral key per connection. */
  WRITE: 'write',
});

/**
 * Where a connection stands, as shown by `status()`.
 *
 * - `idle`: created, nothing attempted yet (or a write socket recycled).
 * - `connecting`: opening a socket.
 * - `authenticating`: a challenge is being answered, or a request is waiting
 *   for one.
 * - `ready`: connected; `authenticated` says whether AUTH completed (open
 *   relays never ask for it).
 * - `auth-failed`: the relay rejected or never accepted our AUTH. Terminal for
 *   this socket; a new socket (reconnect, later `subscribe`) tries again.
 * - `offline`: the socket is down; a reconnect or backoff is pending (reads),
 *   or the next publish reconnects (writes).
 */
export const RELAY_STATE = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  AUTHENTICATING: 'authenticating',
  READY: 'ready',
  AUTH_FAILED: 'auth-failed',
  OFFLINE: 'offline',
});

/**
 * Defaults of every tunable. Mobile networks are slow and relays are often
 * slower, so timeouts are generous; the first relay to accept a publish
 * already completes the send for the user, so a slow one costs nobody time.
 */
export const DM_TRANSPORT_DEFAULTS = Object.freeze({
  /** Opening a socket, ms. */
  connectTimeoutMs: 8_000,
  /** A relay's `OK` for a published event, ms. */
  publishTimeoutMs: 8_000,
  /** Waiting for a challenge, or for the relay's answer to our AUTH, ms. */
  authTimeoutMs: 8_000,
  /** A write socket with no traffic is closed after this long, ms. */
  writeIdleMs: 30_000,
  /** A read socket nobody subscribes on is closed after this long, ms. */
  readIdleMs: 120_000,
  /** After an `auth-failed` socket, how long before a new subscribe tries again, ms. */
  authRetryCooldownMs: 60_000,
  /** Re-sends of a read the relay closed with a transient reason (`rate-limited`, `error`). */
  maxResubscribes: 5,
  /** Backoff for initial connection failures and short publish retries. */
  connectRetry: Object.freeze({ initialDelay: 1_000, maxDelay: 30_000, factor: 2, jitter: 0.3 }),
});

/**
 * Challenges one socket answers before further ones are ignored. A legitimate
 * relay challenges once, rarely twice; a hostile one could otherwise make us
 * sign for ever.
 */
const MAX_AUTHS_PER_SOCKET = 8;

/** Longest relay-supplied text kept in `lastReason`. */
const MAX_REASON_LENGTH = 200;

const WS_OPEN = 1;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/**
 * Call a consumer callback without letting its failure reach the relay layer.
 * A throwing handler must not break the socket's message loop or leave a
 * connection half-updated; the error is dropped because logging it could leak
 * message content.
 */
function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return;
  try {
    fn(...args);
  } catch {
    // Consumer bug: contained on purpose.
  }
}

/** Short, secret-free description of a failure, for `lastReason` and results. */
function describeError(err) {
  const text = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
  return text.slice(0, MAX_REASON_LENGTH) || 'unknown error';
}

/**
 * Delay before attempt number `attempt` (0-based): exponential, capped, with
 * symmetric jitter so many clients do not retry in lockstep.
 *
 * @param {{ initialDelay: number, maxDelay: number, factor: number, jitter: number }} retry
 * @param {number} attempt
 * @param {() => number} [random] Uniform in [0, 1).
 * @returns {number} Milliseconds, a whole number >= 0.
 */
export function backoffDelay(retry, attempt, random = Math.random) {
  const base = Math.min(retry.maxDelay, retry.initialDelay * retry.factor ** attempt);
  const spread = 1 + (random() * 2 - 1) * retry.jitter;
  return Math.max(0, Math.round(base * spread));
}

const invalid = (message, details) => new DmError(DM_ERROR.INVALID_ARGUMENT, message, { details });

/**
 * Canonical key of a relay: `nostr-core`'s `normalizeURL` (so `Wss://A.com`
 * and `wss://a.com/` are one relay). Only `wss://` is accepted, plus `ws://`
 * to a loopback host for development; credentials in the URL are refused.
 *
 * @param {unknown} url
 * @returns {string}
 * @throws {DmError} INVALID_ARGUMENT
 */
function toRelayKey(url) {
  if (typeof url !== 'string' || url.trim() === '') throw invalid('relay URL must be a non-empty string');
  let normalized;
  let parsed;
  try {
    normalized = normalizeURL(url.trim());
    parsed = new URL(normalized);
  } catch {
    throw invalid('relay URL is not valid');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const secure = parsed.protocol === 'wss:';
  if (!secure && !(parsed.protocol === 'ws:' && loopback)) throw invalid('relay URL must use wss://');
  if (parsed.username || parsed.password) throw invalid('relay URL must not carry credentials');
  return normalized;
}

/** @returns {string[]} Normalised, deduplicated, in first-seen order. */
function toRelayKeys(relays) {
  if (!Array.isArray(relays)) throw invalid('relays must be an array of URLs');
  return [...new Set(relays.map(toRelayKey))];
}

/** @returns {object[]} A non-empty array of filter objects (a lone object is wrapped). */
function toFilters(filters) {
  const list = Array.isArray(filters) ? filters : [filters];
  if (list.length === 0 || list.some((f) => f === null || typeof f !== 'object' || Array.isArray(f))) {
    throw invalid('filters must be a filter object or a non-empty array of them');
  }
  return list.map((f) => ({ ...f }));
}

function toHandlers(handlers) {
  if (handlers === null || typeof handlers !== 'object') throw invalid('handlers must be an object');
  const out = {};
  for (const name of ['onevent', 'oneose', 'onclosed']) {
    const fn = handlers[name];
    if (fn !== undefined && typeof fn !== 'function') throw invalid(`handlers.${name} must be a function`);
    out[name] = fn;
  }
  return Object.freeze(out);
}

function assertEvent(event) {
  if (event === null || typeof event !== 'object' || typeof event.id !== 'string' || !event.id
    || !Number.isInteger(event.kind)) {
    throw invalid('event must be a signed event with an id and a kind');
  }
}

/** A signer's answer must at least look like a kind 22242 event before it goes on the wire. */
function assertAuthEvent(event) {
  if (event === null || typeof event !== 'object' || typeof event.id !== 'string'
    || event.kind !== KIND.AUTH) {
    throw new DmError(DM_ERROR.AUTH_FAILED, 'signAuth did not return a kind 22242 event');
  }
}

function positiveNumber(name, value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) throw invalid(`${name} must be a positive number`);
  return value;
}

function resolveRetry(retry = {}) {
  const defaults = DM_TRANSPORT_DEFAULTS.connectRetry;
  const resolved = {
    initialDelay: positiveNumber('connectRetry.initialDelay', retry.initialDelay, defaults.initialDelay),
    maxDelay: positiveNumber('connectRetry.maxDelay', retry.maxDelay, defaults.maxDelay),
    factor: positiveNumber('connectRetry.factor', retry.factor, defaults.factor),
    jitter: retry.jitter === undefined ? defaults.jitter : retry.jitter,
  };
  if (typeof resolved.jitter !== 'number' || !(resolved.jitter >= 0 && resolved.jitter <= 1)) {
    throw invalid('connectRetry.jitter must be between 0 and 1');
  }
  return Object.freeze(resolved);
}

/** @returns {object} Fully resolved, validated options. */
function resolveOptions(options) {
  const d = DM_TRANSPORT_DEFAULTS;
  if (typeof options.signAuth !== 'function') throw invalid('signAuth must be a function');
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
  if (typeof WebSocketImpl !== 'function') throw invalid('a WebSocket implementation is required');
  const connectTimeoutMs = positiveNumber('connectTimeoutMs', options.connectTimeoutMs, d.connectTimeoutMs);
  const connectRetry = resolveRetry(options.connectRetry);
  return {
    signAuth: options.signAuth,
    WebSocket: WebSocketImpl,
    connectTimeoutMs,
    publishTimeoutMs: positiveNumber('publishTimeoutMs', options.publishTimeoutMs, d.publishTimeoutMs),
    authTimeoutMs: positiveNumber('authTimeoutMs', options.authTimeoutMs, d.authTimeoutMs),
    writeIdleMs: positiveNumber('writeIdleMs', options.writeIdleMs, d.writeIdleMs),
    readIdleMs: positiveNumber('readIdleMs', options.readIdleMs, d.readIdleMs),
    authRetryCooldownMs: positiveNumber('authRetryCooldownMs', options.authRetryCooldownMs, d.authRetryCooldownMs),
    maxResubscribes: options.maxResubscribes === undefined
      ? d.maxResubscribes
      : Math.max(0, Math.floor(Number(options.maxResubscribes)) || 0),
    connectRetry,
    // `false` turns nostr-core's own reconnect off for reads; the transport then recovers itself.
    reconnect: options.reconnect === false
      ? false
      : {
        ...connectRetry,
        connectionTimeout: connectTimeoutMs,
        maxAttempts: Infinity,
        ...options.reconnect,
      },
    createEphemeralKey: options.createEphemeralKey ?? generateSecretKey,
    random: options.random ?? Math.random,
    now: options.now ?? Date.now,
    setTimer: options.setTimer ?? ((fn, ms) => {
      const handle = setTimeout(fn, ms);
      // Never let a pending retry keep a Node process (tests, scripts) alive.
      handle?.unref?.();
      return handle;
    }),
    clearTimer: options.clearTimer ?? ((handle) => clearTimeout(handle)),
    onStatus: options.onStatus,
  };
}

// ---------------------------------------------------------------------------
// Tracked timers
// ---------------------------------------------------------------------------

/**
 * Every timer the transport starts goes through here, so `close()` can cancel
 * all of them and a test can prove nothing is left behind.
 */
function createTimers({ setTimer, clearTimer }) {
  const active = new Set();

  /**
   * @param {number} ms
   * @param {() => void} fn
   * @param {() => void} [onCancel] Runs when the timer is cancelled instead of firing.
   * @returns {() => void} Cancel; safe to call any time.
   */
  function after(ms, fn, onCancel) {
    const entry = { handle: null, onCancel };
    entry.handle = setTimer(() => {
      active.delete(entry);
      safeCall(fn);
    }, ms);
    active.add(entry);
    return () => {
      if (!active.delete(entry)) return;
      clearTimer(entry.handle);
      safeCall(entry.onCancel);
    };
  }

  /** A cancellable delay: resolves `true` when it elapsed, `false` when cancelled. */
  function sleep(ms) {
    let resolveSleep;
    const promise = new Promise((resolve) => { resolveSleep = resolve; });
    const cancel = after(ms, () => resolveSleep(true), () => resolveSleep(false));
    return { promise, cancel };
  }

  function clearAll() {
    for (const entry of [...active]) {
      active.delete(entry);
      clearTimer(entry.handle);
      safeCall(entry.onCancel);
    }
  }

  return { after, sleep, clearAll };
}

/**
 * Subclass the injected WebSocket so the transport can see (and close) every
 * socket a `Relay` opens. `nostr-core` does not close a socket whose connect
 * attempt timed out, so without this a slow relay would leave a stray socket
 * per retry, and a write socket could not notice that it dropped.
 */
function trackSockets(Base, onSocket) {
  return class TrackedWebSocket extends Base {
    constructor(...args) {
      super(...args);
      onSocket(this);
    }
  };
}

function closeQuietly(socket) {
  try {
    if (socket && socket.readyState < 2) socket.close();
  } catch {
    // Already gone.
  }
}

/** A wait that is already over: same shape as `RelayLink.awaitAuth()`. */
const settled = (value) => ({ promise: Promise.resolve(value), cancel() {} });

/**
 * @typedef {{ ok: true } | { ok: false, reason: 'auth-failed' | 'disconnected' | 'closed', detail?: string }} AuthOutcome
 */

// ---------------------------------------------------------------------------
// RelayLink: one socket lifecycle plus the AUTH state machine
// ---------------------------------------------------------------------------

/**
 * Shared half of a read or write connection: owns the `Relay`, the tracked
 * socket and everything about NIP-42. Subclasses decide how a challenge is
 * signed and what happens when the socket drops.
 */
class RelayLink {
  /**
   * @param {object} ctx Transport internals (options, timers, notify, retire).
   * @param {string} url Normalised relay URL.
   * @param {'read' | 'write'} role
   */
  constructor(ctx, url, role) {
    this.ctx = ctx;
    this.url = url;
    this.role = role;
    this.state = RELAY_STATE.IDLE;
    this.authenticated = false;
    this.lastReason = null;
    /** Counts completed authentications; a request tagged with an older value was sent before the latest AUTH. */
    this.authEpoch = 0;
    this.authFailedAt = 0;
    this.disposed = false;
    /** @type {Relay | null} */
    this.relay = null;
    this._socket = null;
    /** The AUTH currently being signed and sent, or null. Identity-compared to detect staleness. */
    this._flight = null;
    this._queuedChallenge = null;
    this._authCount = 0;
    this._waiters = new Set();
    this._cancelChallengeTimer = null;
    this._cancelIdle = null;
  }

  // -- subclass hooks -------------------------------------------------------

  /** @param {string} _challenge @returns {Promise<object> | object} A signed kind 22242 event. */
  _signChallenge(_challenge) { throw new Error('not implemented'); }

  /** @returns {object | false} The `reconnect` option for the `Relay`. */
  _reconnectOption() { return false; }

  /** Extra `Relay` wiring (reads: drop and reconnect callbacks). */
  _configureRelay(_relay) {}

  /** Called when the tracked socket closed. */
  _onSocketClosed(_socket) {}

  /** @returns {boolean} True when nothing needs this connection any more. */
  _isIdle() { return true; }

  /** Subclass cleanup on dispose. */
  _onDispose() {}

  // -- state ----------------------------------------------------------------

  snapshot() {
    return {
      url: this.url,
      role: this.role,
      state: this.state,
      authenticated: this.authenticated,
      lastReason: this.lastReason,
    };
  }

  /** Apply a state change and tell the transport, but only when something visible changed. */
  _update(patch) {
    const next = {
      state: patch.state ?? this.state,
      authenticated: patch.authenticated ?? this.authenticated,
      lastReason: patch.lastReason === undefined ? this.lastReason : patch.lastReason,
    };
    const changed = next.state !== this.state
      || next.authenticated !== this.authenticated
      || next.lastReason !== this.lastReason;
    Object.assign(this, next);
    if (changed) this.ctx.notify();
  }

  // -- socket ---------------------------------------------------------------

  _createRelay() {
    const { options } = this.ctx;
    const Tracked = trackSockets(options.WebSocket, (socket) => {
      this._socket = socket;
      // A listener (not `onclose`, which Relay owns) so a write socket notices a drop.
      socket.addEventListener?.('close', () => this._onSocketClosed(socket));
    });
    const relay = new Relay(this.url, {
      websocketImplementation: Tracked,
      reconnect: this._reconnectOption(),
    });
    relay.publishTimeout = options.publishTimeoutMs;
    // `onauth` must be set before `connect()`: a relay may challenge the moment the socket opens.
    relay.onauth = (challenge) => this._onChallenge(relay, challenge);
    this._configureRelay(relay);
    return relay;
  }

  /** True when a frame can go out now. Checked first because `Relay` leaks a rejected promise if `send` throws. */
  _canSend(relay) {
    const readyState = this._socket?.readyState;
    return relay === this.relay && relay.connected && (readyState === undefined || readyState === WS_OPEN);
  }

  /** Forget the current `Relay` and close its socket, silently. */
  _discardRelay() {
    const relay = this.relay;
    const socket = this._socket;
    // Detach first so callbacks fired by `close()` see a stale relay and do nothing.
    this.relay = null;
    this._socket = null;
    this._flight = null;
    this._queuedChallenge = null;
    if (relay) {
      relay.onauth = undefined;
      relay.ondisconnect = undefined;
      relay.onreconnect = undefined;
      relay.onreconnectfailed = undefined;
      try {
        relay.close();
      } catch {
        // Closing a broken socket may throw; it is gone either way.
      }
    }
    closeQuietly(socket);
  }

  // -- AUTH -----------------------------------------------------------------

  /** A challenge arrived. Hostile input: validated, rate-limited, coalesced. */
  _onChallenge(relay, challenge) {
    if (relay !== this.relay || this.disposed) return;
    if (typeof challenge !== 'string' || challenge === '') return;
    // A rejected AUTH is final for this socket: no retry loop.
    if (this.state === RELAY_STATE.AUTH_FAILED) return;
    if (this._authCount >= MAX_AUTHS_PER_SOCKET) return;
    if (this._flight) {
      // Never sign two challenges at once; remember only the newest.
      this._queuedChallenge = challenge;
      return;
    }
    this._runAuth(relay, challenge).catch(() => {});
  }

  async _runAuth(relay, challenge) {
    const flight = { relay };
    this._flight = flight;
    this._authCount += 1;
    this._clearChallengeTimer();
    this._update({ state: RELAY_STATE.AUTHENTICATING });
    const current = () => this._flight === flight && !this.disposed;
    let failure = null;
    try {
      const event = await this._signChallenge(challenge);
      assertAuthEvent(event);
      // The socket may have dropped, or the identity been reset, while signing.
      if (!current()) return;
      await this._submitAuth(relay, event);
    } catch (err) {
      failure = err;
    }
    if (!current()) return;
    this._flight = null;
    const queued = this._queuedChallenge;
    this._queuedChallenge = null;
    if (failure && queued && queued !== challenge) {
      // The relay issued a newer challenge while we answered this one, so the
      // rejection may only mean "stale". Answer the newest once before giving up;
      // the per-socket cap bounds how often this can happen.
      this._onChallenge(relay, queued);
      return;
    }
    if (failure) this._failAuth(failure);
    else this._authSucceeded();
    if (queued && queued !== challenge) this._onChallenge(relay, queued);
  }

  /** Send the AUTH event and wait for the relay's `OK`, bounded by `authTimeoutMs`. */
  async _submitAuth(relay, event) {
    if (!this._canSend(relay)) throw new DmError(DM_ERROR.RELAY_UNAVAILABLE, 'not connected');
    const previous = relay.publishTimeout;
    // `Relay.auth` arms its timeout from this field synchronously, so AUTH gets its own budget.
    relay.publishTimeout = this.ctx.options.authTimeoutMs;
    let pending;
    try {
      pending = relay.auth(event);
    } finally {
      relay.publishTimeout = previous;
    }
    await pending;
  }

  _authSucceeded() {
    this._clearChallengeTimer();
    this.authEpoch += 1;
    this._update({ state: RELAY_STATE.READY, authenticated: true, lastReason: null });
    this._resolveWaiters({ ok: true });
  }

  _failAuth(err) {
    this._clearChallengeTimer();
    this.authFailedAt = this.ctx.options.now();
    const reason = `auth-failed: ${describeError(err)}`;
    this._update({ state: RELAY_STATE.AUTH_FAILED, authenticated: false, lastReason: reason });
    this._resolveWaiters({ ok: false, reason: 'auth-failed', detail: reason });
  }

  /**
   * Wait for AUTH to complete on this socket. Call it only when the socket is
   * not authenticated (callers compare `authEpoch` first). If no challenge has
   * arrived the wait is bounded by `authTimeoutMs` and then fails the socket's
   * AUTH: a relay that demands auth and never challenges is broken.
   *
   * @returns {{ promise: Promise<AuthOutcome>, cancel: () => void }}
   */
  awaitAuth() {
    if (this.disposed) return settled({ ok: false, reason: 'closed' });
    if (this.state === RELAY_STATE.AUTH_FAILED) {
      return settled({ ok: false, reason: 'auth-failed', detail: this.lastReason });
    }
    if (!this.relay?.connected) return settled({ ok: false, reason: 'disconnected' });
    const waiter = { resolve: null };
    const promise = new Promise((resolve) => { waiter.resolve = resolve; });
    this._waiters.add(waiter);
    if (!this._flight) {
      this._startChallengeTimer();
      this._update({ state: RELAY_STATE.AUTHENTICATING });
    }
    return { promise, cancel: () => this._cancelWaiter(waiter) };
  }

  _cancelWaiter(waiter) {
    if (!this._waiters.delete(waiter)) return;
    if (this._waiters.size > 0) return;
    this._clearChallengeTimer();
    if (this.state === RELAY_STATE.AUTHENTICATING && !this._flight && this.relay?.connected) {
      this._update({ state: RELAY_STATE.READY });
    }
  }

  _resolveWaiters(outcome) {
    const waiters = [...this._waiters];
    this._waiters.clear();
    for (const waiter of waiters) waiter.resolve(outcome);
  }

  _startChallengeTimer() {
    if (this._cancelChallengeTimer) return;
    this._cancelChallengeTimer = this.ctx.timers.after(this.ctx.options.authTimeoutMs, () => {
      this._cancelChallengeTimer = null;
      if (this._waiters.size > 0 && !this._flight) {
        this._failAuth(new DmError(DM_ERROR.TIMEOUT, 'relay sent no auth challenge'));
      }
    });
  }

  _clearChallengeTimer() {
    this._cancelChallengeTimer?.();
    this._cancelChallengeTimer = null;
  }

  /** The socket is gone: whatever AUTH was in progress can never finish. */
  _invalidateAuth() {
    this._flight = null;
    this._queuedChallenge = null;
    this._clearChallengeTimer();
    this._resolveWaiters({ ok: false, reason: 'disconnected' });
  }

  // -- idle and teardown ----------------------------------------------------

  _armIdle(ms) {
    this._disarmIdle();
    if (this.disposed || !Number.isFinite(ms)) return;
    this._cancelIdle = this.ctx.timers.after(ms, () => {
      this._cancelIdle = null;
      if (this._isIdle()) this.ctx.retire(this);
    });
  }

  _disarmIdle() {
    this._cancelIdle?.();
    this._cancelIdle = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._disarmIdle();
    this._invalidateAuth();
    this._discardRelay();
    this._onDispose();
    this.state = RELAY_STATE.OFFLINE;
    this.authenticated = false;
    this.ctx.notify();
  }
}

// ---------------------------------------------------------------------------
// ReadLink: identity-authenticated, subscription-bearing, self-healing
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Binding One logical subscription's presence on one relay.
 * @property {string} id
 * @property {object[]} filters
 * @property {{ onevent?: Function, oneose?: Function, onclosed?: Function }} handlers
 * @property {object | null} sub The live `nostr-core` Subscription, or null while parked, waiting or offline.
 * @property {boolean} finished
 * @property {number} fireEpoch `authEpoch` when the REQ was sent: a CLOSED `auth-required` is only worth a re-send if AUTH completed after.
 * @property {number} fires REQs sent so far (makes REQ ids unique per socket).
 * @property {number} retries Transient re-sends since the relay last answered healthily.
 * @property {(() => void) | null} cancelRetry
 * @property {{ promise: Promise<AuthOutcome>, cancel: () => void } | null} waiter
 */

class ReadLink extends RelayLink {
  constructor(ctx, url) {
    super(ctx, url, RELAY_ROLE.READ);
    /** @type {Set<Binding>} */
    this.bindings = new Set();
    this._looping = false;
    this._cancelSleep = null;
    this._settleFirstAttempt = () => {};
    this.firstAttempt = new Promise((resolve) => { this._settleFirstAttempt = resolve; });
  }

  start() {
    this._armIdle(this.ctx.options.readIdleMs);
    this._startLoop();
  }

  _signChallenge(challenge) {
    // The one place the identity answers a relay. Reads only.
    const { signAuth } = this.ctx.options;
    return signAuth({ relay: this.url, challenge });
  }

  _reconnectOption() { return this.ctx.options.reconnect; }

  _configureRelay(relay) {
    relay.ondisconnect = () => this._onDropped(relay);
    relay.onreconnect = () => this._onReconnected(relay);
    relay.onreconnectfailed = () => this._restart(relay);
  }

  _isIdle() { return this.bindings.size === 0; }

  _onSocketClosed(socket) {
    // With nostr-core's reconnect on, `ondisconnect` already covers a drop.
    if (this.ctx.options.reconnect !== false) return;
    if (socket === this._socket) this._restart(this.relay);
  }

  _onDispose() {
    this._cancelSleep?.();
    this._settleFirstAttempt();
    for (const binding of this.bindings) this._release(binding);
    this.bindings.clear();
  }

  // -- connecting -----------------------------------------------------------

  _startLoop() {
    if (this._looping || this.disposed) return;
    this._looping = true;
    this._loop()
      .catch(() => {})
      .finally(() => { this._looping = false; });
  }

  /**
   * Connect, retrying with backoff. `nostr-core` only reconnects a socket that
   * has been up once, so this is what keeps a relay that is down at app start
   * (or flaps) from silencing the inbox until the next restart.
   */
  async _loop() {
    const { options } = this.ctx;
    for (let attempt = 0; !this.disposed; attempt += 1) {
      this._update({ state: RELAY_STATE.CONNECTING });
      const relay = this._createRelay();
      this.relay = relay;
      try {
        await relay.connect({ timeout: options.connectTimeoutMs });
      } catch (err) {
        if (this.relay !== relay || this.disposed) return;
        this._discardRelay();
        this._update({
          state: RELAY_STATE.OFFLINE,
          authenticated: false,
          lastReason: `connect failed: ${describeError(err)}`,
        });
        this._settleFirstAttempt();
        const sleeping = this.ctx.timers.sleep(backoffDelay(options.connectRetry, attempt, options.random));
        this._cancelSleep = sleeping.cancel;
        const elapsed = await sleeping.promise;
        this._cancelSleep = null;
        if (!elapsed) return;
        continue;
      }
      if (this.relay !== relay || this.disposed) return;
      this._onConnected();
      return;
    }
  }

  _onConnected() {
    this._authCount = 0;
    this._update({ state: RELAY_STATE.READY, authenticated: false, lastReason: null });
    this._settleFirstAttempt();
    for (const binding of [...this.bindings]) this._fire(binding);
  }

  /** nostr-core noticed the socket dropped and will reconnect and replay the REQs. */
  _onDropped(relay) {
    if (relay !== this.relay) return;
    this._invalidateAuth();
    this._update({ state: RELAY_STATE.OFFLINE, authenticated: false, lastReason: 'connection lost' });
  }

  /** The new socket is up and the old REQs were replayed (possibly into a CLOSED auth-required). */
  _onReconnected(relay) {
    if (relay !== this.relay) return;
    this._authCount = 0;
    this._update({ state: RELAY_STATE.READY, authenticated: false, lastReason: null });
    for (const binding of [...this.bindings]) {
      // A replayed REQ was sent at the current epoch; only a new AUTH justifies another re-send.
      if (binding.sub) binding.fireEpoch = this.authEpoch;
      else this._fire(binding);
    }
  }

  /** Throw the socket away and reconnect ourselves; subscriptions are kept and re-sent. */
  _reset(reason) {
    if (this.disposed) return;
    this._invalidateAuth();
    this._discardRelay();
    for (const binding of this.bindings) binding.sub = null;
    this._update({ state: RELAY_STATE.OFFLINE, authenticated: false, lastReason: reason });
    this._startLoop();
  }

  /** nostr-core gave up, or reconnect is off: recover with our own loop. */
  _restart(relay) {
    if (relay !== this.relay || this._looping) return;
    this._reset('connection lost');
  }

  // -- bindings -------------------------------------------------------------

  /** @param {Binding} binding */
  attach(binding) {
    this.bindings.add(binding);
    this._disarmIdle();
    const { options } = this.ctx;
    if (this.state === RELAY_STATE.AUTH_FAILED
      && options.now() - this.authFailedAt >= options.authRetryCooldownMs) {
      // "Next connection may try again": a fresh subscribe after the cooldown is that next connection.
      this._reset(null);
      return;
    }
    this._fire(binding);
  }

  /** Remove a binding without telling its owner (the owner asked, or the transport is shutting down). */
  detach(binding) {
    if (binding.finished) return;
    this._release(binding);
    this.bindings.delete(binding);
    if (this.bindings.size === 0) this._armIdle(this.ctx.options.readIdleMs);
  }

  _release(binding) {
    binding.finished = true;
    binding.cancelRetry?.();
    binding.cancelRetry = null;
    const { waiter, sub } = binding;
    binding.waiter = null;
    binding.sub = null;
    waiter?.cancel();
    try {
      sub?.close();
    } catch {
      // Socket already closing.
    }
  }

  /** The relay ended this binding for good: tell the owner once. */
  _finish(binding, reason) {
    if (binding.finished) return;
    this.detach(binding);
    safeCall(binding.handlers.onclosed, this.url, reason);
  }

  /** Send the REQ for a binding if the socket is up and nothing is in flight for it. */
  _fire(binding) {
    if (binding.finished || binding.sub || this.disposed) return;
    const relay = this.relay;
    if (!relay || !this._canSend(relay)) return;
    binding.cancelRetry?.();
    binding.cancelRetry = null;
    binding.fireEpoch = this.authEpoch;
    binding.fires += 1;
    const id = `${binding.id}.${binding.fires}`;
    let sub = null;
    try {
      sub = relay.subscribe(binding.filters, {
        id,
        onevent: (event) => {
          if (binding.sub === sub) safeCall(binding.handlers.onevent, event, this.url);
        },
        oneose: () => {
          if (binding.sub !== sub) return;
          binding.retries = 0;
          safeCall(binding.handlers.oneose, this.url);
        },
        onclose: (reason) => this._onSubClosed(relay, binding, sub, reason),
      });
    } catch {
      // The socket died between the check and the send; the reconnect path re-sends.
      relay.openSubs.delete(id);
      return;
    }
    binding.sub = sub;
  }

  /** nostr-core closed a subscription: the relay sent CLOSED, or the link is lost. */
  _onSubClosed(relay, binding, sub, reason) {
    if (relay !== this.relay || binding.finished || binding.sub !== sub) return;
    binding.sub = null;
    // CLOSED with no socket means nostr-core gave up on this link, not that the relay refused.
    if (!relay.connected) {
      this._restart(relay);
      return;
    }
    const text = typeof reason === 'string' ? reason : '';
    if (isAuthRequired(text)) {
      this._onAuthRequired(binding, text);
      return;
    }
    if (isRetryableRelayReason(parseRelayReason(text).prefix)) {
      this._scheduleResubscribe(binding, text);
      return;
    }
    this._finish(binding, text);
  }

  /** CLOSED `auth-required`: authenticate if we have not, then send the REQ again, once per AUTH. */
  _onAuthRequired(binding, text) {
    if (this.state === RELAY_STATE.AUTH_FAILED) {
      this._finish(binding, this.lastReason);
      return;
    }
    if (this.authenticated) {
      if (this.authEpoch > binding.fireEpoch) {
        // The REQ predates our AUTH (its CLOSED was already on the wire): send it again.
        this._fire(binding);
        return;
      }
      // Refused although authenticated: the relay does not want this read from us. Do not loop.
      this._finish(binding, text);
      return;
    }
    this._park(binding);
  }

  /** Wait for AUTH, then re-send. A dropped socket keeps the binding for the reconnect. */
  _park(binding) {
    if (binding.waiter) return;
    const waiter = this.awaitAuth();
    binding.waiter = waiter;
    waiter.promise.then((outcome) => {
      if (binding.waiter !== waiter) return;
      binding.waiter = null;
      if (binding.finished) return;
      if (outcome.ok) this._fire(binding);
      else if (outcome.reason === 'auth-failed') this._finish(binding, outcome.detail);
      // 'disconnected': re-sent by _onConnected / _onReconnected. 'closed': the link is disposed.
    });
  }

  /** Transient refusal (`rate-limited`, `error`): back off, then ask again, a bounded number of times. */
  _scheduleResubscribe(binding, text) {
    const { options } = this.ctx;
    if (binding.retries >= options.maxResubscribes) {
      this._finish(binding, text);
      return;
    }
    const delay = backoffDelay(options.connectRetry, binding.retries, options.random);
    binding.retries += 1;
    binding.cancelRetry = this.ctx.timers.after(delay, () => {
      binding.cancelRetry = null;
      this._fire(binding);
    });
  }
}

// ---------------------------------------------------------------------------
// WriteLink: ephemeral-key, publish-only, lazily connected
// ---------------------------------------------------------------------------

/**
 * What one publish attempt on a socket came to.
 * @typedef {{ kind: 'ok', reason: string, epoch: number }
 *   | { kind: 'rejected', reason: string, epoch: number }
 *   | { kind: 'timeout', epoch: number }
 *   | { kind: 'disconnected', epoch?: number }
 *   | { kind: 'unavailable', detail: string }} PublishAttempt
 */

const DISCONNECT_MESSAGES = new Set(['relay connection closed', 'relay connection closed by us']);

/** Map the error `Relay.publish` rejects with onto what happened (nostr-core 1.0.4 wording). */
function classifyPublishFailure(err, epoch) {
  const message = typeof err?.message === 'string' ? err.message : '';
  if (message === 'publish timed out') return { kind: 'timeout', epoch };
  if (DISCONNECT_MESSAGES.has(message) || message.startsWith('not connected')) {
    return { kind: 'disconnected', epoch };
  }
  return { kind: 'rejected', reason: message, epoch };
}

class WriteLink extends RelayLink {
  constructor(ctx, url) {
    super(ctx, url, RELAY_ROLE.WRITE);
    /** Ephemeral AUTH key of the current socket. Never the identity. */
    this._key = null;
    this._connecting = null;
    this._ops = 0;
    /** @type {Map<string, Promise<PublishAttempt>>} */
    this._inflight = new Map();
  }

  start() {
    this._armIdle(this.ctx.options.writeIdleMs);
  }

  _signChallenge(challenge) {
    // Only ever the throwaway key: a relay must not learn who writes.
    return createAuthEvent({ relay: this.url, challenge }, this._key);
  }

  _isIdle() { return this._ops === 0; }

  _onSocketClosed(socket) {
    if (socket !== this._socket || this.disposed) return;
    this._invalidateAuth();
    this._update({ state: RELAY_STATE.OFFLINE, authenticated: false, lastReason: 'connection lost' });
  }

  _onDispose() {
    this._wipeKey();
  }

  _wipeKey() {
    this._key?.fill?.(0);
    this._key = null;
  }

  /** Drop the socket (and with it the old ephemeral identity); the next publish reconnects. */
  recycle() {
    this._invalidateAuth();
    this._discardRelay();
    this._wipeKey();
    this._update({ state: RELAY_STATE.IDLE, authenticated: false, lastReason: null });
  }

  /** @returns {Promise<void>} Rejects with RELAY_UNAVAILABLE; concurrent callers share one attempt. */
  ensureConnected() {
    if (this.disposed) {
      return Promise.reject(new DmError(DM_ERROR.RELAY_UNAVAILABLE, 'connection closed', {
        details: { relay: this.url },
      }));
    }
    if (this.relay?.connected) return Promise.resolve();
    if (!this._connecting) {
      this._connecting = this._connect().finally(() => { this._connecting = null; });
    }
    return this._connecting;
  }

  async _connect() {
    this._discardRelay(); // a socket that dropped is replaced, never reused
    this._wipeKey();
    this._key = this.ctx.options.createEphemeralKey();
    this._authCount = 0;
    const relay = this._createRelay();
    this.relay = relay;
    this._update({ state: RELAY_STATE.CONNECTING, authenticated: false });
    try {
      await relay.connect({ timeout: this.ctx.options.connectTimeoutMs });
    } catch (err) {
      if (this.relay === relay) {
        this._discardRelay();
        this._update({ state: RELAY_STATE.OFFLINE, lastReason: `connect failed: ${describeError(err)}` });
      }
      throw new DmError(DM_ERROR.RELAY_UNAVAILABLE, 'could not connect to relay', {
        cause: err,
        details: { relay: this.url },
      });
    }
    if (this.relay !== relay || this.disposed) {
      throw new DmError(DM_ERROR.RELAY_UNAVAILABLE, 'connection closed', { details: { relay: this.url } });
    }
    this._update({ state: RELAY_STATE.READY, authenticated: false, lastReason: null });
  }

  /**
   * Publish once on the current socket, connecting first if needed. Never
   * rejects; the outcome says what happened so the caller can decide to retry.
   *
   * @param {object} event
   * @returns {Promise<PublishAttempt>}
   */
  async attempt(event) {
    this._disarmIdle();
    this._ops += 1;
    try {
      try {
        await this.ensureConnected();
      } catch (err) {
        return { kind: 'unavailable', detail: describeError(err.cause ?? err) };
      }
      // A challenge on connect is usually already being answered: let it finish rather than be refused first.
      if (this._flight) await this.awaitAuth().promise;
      const relay = this.relay;
      if (!relay || !this._canSend(relay)) return { kind: 'disconnected' };
      return await this._send(relay, event, this.authEpoch);
    } finally {
      this._ops -= 1;
      if (this._ops === 0) this._armIdle(this.ctx.options.writeIdleMs);
    }
  }

  _send(relay, event, epoch) {
    // `Relay` keys pending publishes by event id: a second publish of the same
    // id would overwrite the first's entry and strand it, so it shares it.
    let pending = this._inflight.get(event.id);
    if (!pending) {
      pending = relay.publish(event).then(
        (reason) => ({ kind: 'ok', reason: typeof reason === 'string' ? reason : '', epoch }),
        (err) => classifyPublishFailure(err, epoch),
      );
      this._inflight.set(event.id, pending);
      pending.then(() => { this._inflight.delete(event.id); });
    }
    return pending;
  }
}

// ---------------------------------------------------------------------------
// Publish results
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PublishResult
 * @property {string} relay Normalised relay URL.
 * @property {boolean} ok The relay holds the event (accepted, or `duplicate`).
 * @property {string | null} prefix NIP-01 prefix of the relay's reply (`duplicate`, `blocked`, ...), if any.
 * @property {string} message The relay's reply without its prefix, or developer text for local failures.
 * @property {import('./errors.js').DmErrorCode | null} code Null when `ok`.
 * @property {number} attempts How many times the event was sent or a connection tried.
 */

function result(relay, attempts, ok, { prefix = null, message = '', code = null } = {}) {
  return { relay, ok, prefix, message, code: ok ? null : code, attempts };
}

/** Settle to the first successful result, or null once all failed. Never rejects. */
function firstSuccess(promises) {
  return new Promise((resolve) => {
    let pending = promises.length;
    for (const promise of promises) {
      promise.then((r) => {
        if (r.ok) resolve(r);
        pending -= 1;
        if (pending === 0) resolve(null);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

/**
 * @typedef {object} RelayStatus
 * @property {string} url Normalised relay URL.
 * @property {'read' | 'write'} role
 * @property {'idle' | 'connecting' | 'authenticating' | 'ready' | 'auth-failed' | 'offline'} state
 * @property {boolean} authenticated True once NIP-42 AUTH completed on the current socket.
 * @property {string | null} lastReason Why the relay is offline or `auth-failed`; developer text.
 */

/**
 * @typedef {object} SubscribeHandlers
 * @property {(event: object, relay: string) => void} [onevent] Every event, from every relay,
 *   duplicates included: the inbox deduplicates by rumor id.
 * @property {(relay: string) => void} [oneose] A relay finished its stored events. Fires again after
 *   a reconnect re-sends the subscription.
 * @property {(relay: string, reason: string) => void} [onclosed] The subscription ended on that relay
 *   and will not come back by itself: the relay's own CLOSED text, or `auth-failed: <detail>` when AUTH failed.
 *   Never called after `close()` / `resetIdentity()`.
 */

/**
 * Create the transport.
 *
 * @param {object} options
 * @param {(request: { relay: string, challenge: string }) => Promise<object> | object} options.signAuth
 *   Signs the identity's kind 22242 event; used on read connections only.
 * @param {typeof WebSocket} [options.WebSocket] Defaults to the global.
 * @param {number} [options.connectTimeoutMs]
 * @param {number} [options.publishTimeoutMs]
 * @param {number} [options.authTimeoutMs]
 * @param {false | object} [options.reconnect] nostr-core reconnect options for read connections;
 *   `false` switches them off and the transport reconnects itself.
 * @param {{ initialDelay?: number, maxDelay?: number, factor?: number, jitter?: number }} [options.connectRetry]
 * @param {number} [options.writeIdleMs]
 * @param {number} [options.readIdleMs]
 * @param {number} [options.authRetryCooldownMs]
 * @param {number} [options.maxResubscribes]
 * @param {() => Uint8Array} [options.createEphemeralKey]
 * @param {() => number} [options.random]
 * @param {() => number} [options.now]
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimer]
 * @param {(handle: unknown) => void} [options.clearTimer]
 * @param {(snapshot: RelayStatus[]) => void} [options.onStatus] Called with the full snapshot on every change.
 * @returns {{
 *   subscribe: (relays: string[], filters: object | object[], handlers?: SubscribeHandlers) => { close: () => void },
 *   publish: (relays: string[], event: object) => { firstAccept: Promise<PublishResult | null>, allSettled: Promise<PublishResult[]> },
 *   warmUp: (relays: string[]) => Promise<void>,
 *   status: () => RelayStatus[],
 *   resetIdentity: () => void,
 *   close: () => void,
 * }}
 * @throws {DmError} INVALID_ARGUMENT for a missing `signAuth` / WebSocket or a bad number.
 */
export function createDmTransport(options = {}) {
  const config = resolveOptions(options);
  const timers = createTimers(config);
  /** @type {Map<string, ReadLink>} */
  const reads = new Map();
  /** @type {Map<string, WriteLink>} */
  const writes = new Map();
  let closed = false;
  let quiet = false;
  let bindingSeq = 0;

  const status = () => [...reads.values(), ...writes.values()].map((link) => link.snapshot());

  const ctx = {
    options: config,
    timers,
    notify() {
      if (quiet || !config.onStatus) return;
      safeCall(config.onStatus, status());
    },
    retire(link) {
      const map = link.role === RELAY_ROLE.READ ? reads : writes;
      if (map.get(link.url) === link) map.delete(link.url);
      link.dispose();
    },
  };

  function readLink(url) {
    let link = reads.get(url);
    if (!link) {
      link = new ReadLink(ctx, url);
      reads.set(url, link);
      link.start();
    }
    return link;
  }

  function writeLink(url) {
    let link = writes.get(url);
    if (link && link.state === RELAY_STATE.AUTH_FAILED
      && config.now() - link.authFailedAt >= config.authRetryCooldownMs) {
      link.recycle(); // a new publish after the cooldown is the "next connection"
    }
    if (!link) {
      link = new WriteLink(ctx, url);
      writes.set(url, link);
      link.start();
    }
    return link;
  }

  function assertOpen(what) {
    if (closed) throw new DmError(DM_ERROR.RELAY_UNAVAILABLE, `cannot ${what}: transport is closed`);
  }

  /** Jittered pause before the one retry of a transient failure. */
  const retryPause = () => timers.sleep(backoffDelay(config.connectRetry, 0, config.random)).promise;

  /**
   * Deliver `event` to one relay. Never rejects. Budgets: one re-send after
   * AUTH, one retry of a transient failure (rate limit, relay error, dropped
   * socket); a timeout or a final refusal ends it.
   */
  async function publishOne(url, event) {
    let attempts = 0;
    let authRetried = false;
    let transientRetried = false;
    const failed = (code, message, prefix = null) => result(url, attempts, false, { prefix, message, code });
    for (;;) {
      if (closed) return failed(DM_ERROR.RELAY_UNAVAILABLE, 'transport closed');
      attempts += 1;
      const link = writeLink(url);
      const outcome = await link.attempt(event);
      if (closed) return failed(DM_ERROR.RELAY_UNAVAILABLE, 'transport closed');

      switch (outcome.kind) {
        case 'ok': {
          const { prefix, message } = parseRelayReason(outcome.reason);
          return result(url, attempts, true, { prefix, message });
        }
        case 'unavailable':
          return failed(DM_ERROR.RELAY_UNAVAILABLE, outcome.detail);
        case 'timeout':
          return failed(DM_ERROR.TIMEOUT, 'relay did not answer in time');
        case 'disconnected':
          if (transientRetried) return failed(DM_ERROR.RELAY_UNAVAILABLE, 'connection lost');
          transientRetried = true;
          if (!(await retryPause())) return failed(DM_ERROR.RELAY_UNAVAILABLE, 'transport closed');
          continue;
        default: {
          // 'rejected': the relay answered OK false.
          const parsed = parseRelayReason(outcome.reason);
          if (isDeliveredRelayReason({ ok: false, reason: outcome.reason })) {
            return result(url, attempts, true, parsed);
          }
          if (isAuthRequired(parsed)) {
            if (authRetried) return failed(DM_ERROR.AUTH_FAILED, parsed.message, parsed.prefix);
            authRetried = true;
            if (link.authenticated && link.authEpoch > outcome.epoch) continue; // AUTH finished while the EVENT was in flight
            if (link.authenticated) return failed(DM_ERROR.AUTH_FAILED, parsed.message, parsed.prefix);
            const auth = await link.awaitAuth().promise;
            if (auth.ok) continue;
            return failed(DM_ERROR.AUTH_FAILED, auth.detail ?? parsed.message, parsed.prefix);
          }
          if (isRetryableRelayReason(parsed.prefix) && !transientRetried) {
            transientRetried = true;
            if (!(await retryPause())) return failed(DM_ERROR.RELAY_UNAVAILABLE, 'transport closed');
            continue;
          }
          return failed(DM_ERROR.NO_RELAY_ACCEPTED, parsed.message, parsed.prefix);
        }
      }
    }
  }

  /**
   * Logical subscription over read connections (docs section 6).
   *
   * @param {string[]} relays
   * @param {object | object[]} filters
   * @param {SubscribeHandlers} [handlers]
   * @returns {{ close: () => void }}
   * @throws {DmError} INVALID_ARGUMENT for bad input; RELAY_UNAVAILABLE after `close()`.
   */
  function subscribe(relays, filters, handlers = {}) {
    assertOpen('subscribe');
    const urls = toRelayKeys(relays);
    const filterList = toFilters(filters);
    const owner = toHandlers(handlers);
    bindingSeq += 1;
    const parts = urls.map((url) => {
      /** @type {Binding} */
      const binding = {
        id: `dm${bindingSeq.toString(36)}`,
        filters: filterList,
        handlers: owner,
        sub: null,
        finished: false,
        fireEpoch: 0,
        fires: 0,
        retries: 0,
        cancelRetry: null,
        waiter: null,
      };
      return { link: readLink(url), binding };
    });
    for (const { link, binding } of parts) link.attach(binding);
    let open = true;
    return Object.freeze({
      close() {
        if (!open) return;
        open = false;
        for (const { link, binding } of parts) link.detach(binding);
      },
    });
  }

  /**
   * Publish `event` to every relay in parallel over write connections. Never rejects.
   *
   * @param {string[]} relays
   * @param {object} event A signed event.
   * @returns {{ firstAccept: Promise<PublishResult | null>, allSettled: Promise<PublishResult[]> }}
   * @throws {DmError} INVALID_ARGUMENT for bad input.
   */
  function publish(relays, event) {
    const urls = toRelayKeys(relays);
    assertEvent(event);
    if (urls.length === 0) {
      return { firstAccept: Promise.resolve(null), allSettled: Promise.resolve([]) };
    }
    const perRelay = urls.map((url) => publishOne(url, event).catch(
      () => result(url, 0, false, { code: DM_ERROR.RELAY_UNAVAILABLE, message: 'publish failed' }),
    ));
    return { firstAccept: firstSuccess(perRelay), allSettled: Promise.all(perRelay) };
  }

  /**
   * Open and authenticate read connections ahead of the first subscribe, so
   * the inbox does not pay connect + AUTH latency. Resolves when every relay
   * finished its first connection attempt (connected or failed); AUTH
   * completes in the background as soon as the relay challenges. Never rejects
   * for network reasons.
   *
   * @param {string[]} relays
   * @returns {Promise<void>}
   * @throws {DmError} INVALID_ARGUMENT for bad input.
   */
  function warmUp(relays) {
    const urls = toRelayKeys(relays);
    if (closed) return Promise.resolve();
    return Promise.all(urls.map((url) => readLink(url).firstAttempt)).then(() => undefined);
  }

  /**
   * The identity changed: read connections (authenticated as the old one) and
   * their subscriptions are closed without callbacks. Write connections use
   * throwaway keys and stay.
   */
  function resetIdentity() {
    for (const link of [...reads.values()]) ctx.retire(link);
    ctx.notify();
  }

  /** Close everything. Later calls are no-ops; `subscribe` throws. */
  function close() {
    if (closed) return;
    closed = true;
    quiet = true;
    for (const link of [...reads.values(), ...writes.values()]) link.dispose();
    reads.clear();
    writes.clear();
    timers.clearAll();
    quiet = false;
    ctx.notify();
  }

  return Object.freeze({ subscribe, publish, warmUp, status, resetIdentity, close });
}
