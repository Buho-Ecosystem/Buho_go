/**
 * In-memory fake relay network for the transport tests.
 *
 * `createFakeNetwork()` returns a `WebSocket` class that can be handed to
 * `createDmTransport({ WebSocket })` and a set of scripted relay servers behind
 * it. Nothing touches a real socket, so a test can reproduce, on demand and
 * in milliseconds, the relay behaviour that makes NIP-42 AUTH hard:
 *
 * - a challenge on connect (auth.nostr1.com), or only after the first refusal
 *   (relay.damus.io, relay.nostr.net);
 * - reads closed with `auth-required` (also with a nested `ERROR:` prefix) and
 *   writes answered with `OK false "auth-required: ..."`;
 * - an AUTH the relay accepts, rejects, or never answers;
 * - dropped sockets, refused connections, connections that never open,
 *   relays that go silent, scripted `OK` replies and duplicate handling.
 *
 * Every frame crosses a macrotask boundary (`setImmediate`), like a real
 * socket, so ordering bugs (a REQ sent before the challenge is answered, a
 * CLOSED arriving after AUTH completed) show up here instead of in production.
 * `network.dispose()` cancels everything still scheduled.
 *
 * Test helper only: not imported by application code.
 */

import { finalizeEvent, matchFilters, normalizeURL, verifyAuthEvent } from 'nostr-core';

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/** The reasons the live relays were measured to use (2026-10-10). */
export const RELAY_TEXT = Object.freeze({
  AUTH_REQUIRED: 'auth-required: you must auth',
  AUTH_REQUIRED_NESTED: 'ERROR: auth-required: requested filter requires authentication',
  AUTH_BROKEN: 'error: relay needs serviceUrl to be configured before AUTH can work',
});

/**
 * Sign a plain event for a relay to serve. The transport's `Relay` verifies the
 * signature of every incoming EVENT, so fixtures must be real.
 *
 * @param {Uint8Array} secretKey
 * @param {{ kind?: number, content?: string, tags?: string[][], created_at?: number }} [fields]
 */
export function makeEvent(secretKey, { kind = 1059, content = 'x', tags = [], created_at } = {}) {
  return finalizeEvent(
    { kind, content, tags, created_at: created_at ?? Math.floor(Date.now() / 1000) },
    secretKey,
  );
}

/**
 * @typedef {object} RelayBehavior
 * @property {boolean} [challengeOnConnect=false] Send `["AUTH", challenge]` right after the socket opens.
 * @property {boolean} [challengeAfterRefusal=false] Send the challenge only after the first
 *   `auth-required` refusal on that socket (damus, nostr.net).
 * @property {boolean} [requireAuthToRead=false] Close every REQ of an unauthenticated socket.
 * @property {string} [readRefusal] Text of that CLOSED.
 * @property {boolean} [requireAuthToWrite=false] Answer EVENT of an unauthenticated socket with `OK false`.
 * @property {string} [writeRefusal] Text of that `OK false`.
 * @property {'ok'|'reject'|'silent'} [authResult='ok'] How the relay answers an AUTH event.
 * @property {string} [authRejection] Text of the `OK false` when `authResult` is `reject`.
 * @property {boolean} [silent=false] Accept connections but answer nothing at all.
 * @property {boolean} [refuse=false] Refuse connections (socket error).
 * @property {boolean} [hang=false] Never finish opening the socket.
 * @property {boolean} [sendEose=true] Answer a REQ with EOSE after the stored events.
 * @property {boolean} [readRefusalAlways=false] Close every REQ, authenticated or not (a relay that
 *   wants something else from us than AUTH).
 * @property {number} [refusalDelayMs=0] Hold back the CLOSED / `OK false` refusal for this long, so
 *   it can arrive after the client's AUTH completed.
 */

/**
 * One scripted relay. Mutate `behavior` (or push to `eventReplies`) between
 * steps of a test to change how the relay behaves from then on.
 */
class FakeRelayServer {
  /**
   * @param {FakeNetwork} network
   * @param {string} url
   * @param {RelayBehavior} behavior
   */
  constructor(network, url, behavior = {}) {
    this.network = network;
    this.url = normalizeURL(url);
    /** @type {RelayBehavior} */
    this.behavior = {
      challengeOnConnect: false,
      challengeAfterRefusal: false,
      requireAuthToRead: false,
      readRefusal: RELAY_TEXT.AUTH_REQUIRED,
      requireAuthToWrite: false,
      writeRefusal: RELAY_TEXT.AUTH_REQUIRED,
      authResult: 'ok',
      authRejection: RELAY_TEXT.AUTH_BROKEN,
      silent: false,
      refuse: false,
      hang: false,
      sendEose: true,
      readRefusalAlways: false,
      refusalDelayMs: 0,
      ...behavior,
    };
    /** Accepted events, oldest first. */
    this.events = [];
    /**
     * Scripted replies for the next EVENTs, consumed in order before the
     * default logic. Each entry is `{ ok, reason }`, or `null` to stay silent.
     * @type {Array<{ ok: boolean, reason?: string } | null>}
     */
    this.eventReplies = [];
    /** @type {FakeConnection[]} */
    this.connections = [];
    /** Every AUTH event the relay received: `{ connection, pubkey, accepted }`. */
    this.authLog = [];
    this._challengeSeq = 0;
  }

  /** Connections currently open. */
  get open() {
    return this.connections.filter((c) => c.socket.readyState === OPEN);
  }

  /** Frames received from clients, parsed, in arrival order. */
  get received() {
    return this.connections.flatMap((c) => c.received.map((frame) => ({ connection: c.id, frame })));
  }

  /** Close every open socket from the relay's side, as a network drop would. */
  dropAll() {
    for (const connection of this.open) connection.drop();
  }

  /**
   * Store an event and push it to every matching live subscription of an
   * allowed (authenticated, if the relay demands it) connection.
   * @param {object} event A signed event.
   */
  inject(event) {
    this.events.push(event);
    for (const connection of this.open) connection.pushLive(event);
  }

  /** Send a fresh challenge to every open connection (relays may re-challenge). */
  challengeAll() {
    for (const connection of this.open) connection.sendChallenge();
  }

  nextChallenge() {
    this._challengeSeq += 1;
    return `challenge-${this.url}-${this._challengeSeq}`;
  }
}

/** The relay's view of one client socket. */
class FakeConnection {
  /**
   * @param {FakeRelayServer} server
   * @param {FakeWebSocket} socket
   * @param {number} id
   */
  constructor(server, socket, id) {
    this.server = server;
    this.socket = socket;
    this.id = id;
    /** Frames received from the client, parsed. */
    this.received = [];
    /** Open subscriptions: id -> filters. */
    this.subs = new Map();
    this.challenge = null;
    /** Pubkey that completed AUTH on this socket, or null. */
    this.authedPubkey = null;
    this._refused = false;
  }

  get behavior() {
    return this.server.behavior;
  }

  send(frame) {
    this.socket._deliver(frame);
  }

  sendChallenge() {
    this.challenge = this.server.nextChallenge();
    this.send(['AUTH', this.challenge]);
  }

  drop() {
    this.socket._closeFromServer();
  }

  /** @param {object} event */
  pushLive(event) {
    if (this.behavior.silent) return;
    if (this.behavior.requireAuthToRead && !this.authedPubkey) return;
    for (const [id, filters] of this.subs) {
      if (matchFilters(filters, event)) this.send(['EVENT', id, event]);
    }
  }

  /** @param {string} raw */
  onFrame(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    this.received.push(frame);
    if (this.behavior.silent) return;
    switch (frame[0]) {
      case 'REQ': return this._onReq(frame);
      case 'CLOSE': this.subs.delete(frame[1]); return undefined;
      case 'EVENT': return this._onEvent(frame[1]);
      case 'AUTH': return this._onAuth(frame[1]);
      default: return undefined;
    }
  }

  _sendRefusal(frame) {
    const { refusalDelayMs } = this.behavior;
    if (refusalDelayMs > 0) this.server.network._later(() => this.send(frame), refusalDelayMs);
    else this.send(frame);
  }

  _refuse() {
    if (this.behavior.challengeAfterRefusal && !this.challenge) this.sendChallenge();
  }

  _onReq([, id, ...filters]) {
    const refuse = this.behavior.readRefusalAlways
      || (this.behavior.requireAuthToRead && !this.authedPubkey);
    if (refuse) {
      this._sendRefusal(['CLOSED', id, this.behavior.readRefusal]);
      this._refuse();
      return;
    }
    this.subs.set(id, filters);
    for (const event of this.server.events) {
      if (matchFilters(filters, event)) this.send(['EVENT', id, event]);
    }
    if (this.behavior.sendEose) this.send(['EOSE', id]);
  }

  _onEvent(event) {
    const scripted = this.server.eventReplies.length > 0 ? this.server.eventReplies.shift() : undefined;
    if (scripted === null) return;
    if (scripted) {
      this.send(['OK', event.id, scripted.ok, scripted.reason ?? '']);
      return;
    }
    if (this.behavior.requireAuthToWrite && !this.authedPubkey) {
      this._sendRefusal(['OK', event.id, false, this.behavior.writeRefusal]);
      this._refuse();
      return;
    }
    if (this.server.events.some((e) => e.id === event.id)) {
      this.send(['OK', event.id, true, 'duplicate: already have this event']);
      return;
    }
    this.server.inject(event);
    this.send(['OK', event.id, true, '']);
  }

  _onAuth(event) {
    const accepted = Boolean(this.challenge)
      && verifyAuthEvent(event, this.challenge, this.server.url);
    const { authResult } = this.behavior;
    if (authResult === 'silent') {
      this.server.authLog.push({ connection: this.id, pubkey: event.pubkey, accepted: false });
      return;
    }
    if (authResult === 'reject' || !accepted) {
      this.server.authLog.push({ connection: this.id, pubkey: event.pubkey, accepted: false });
      this.send(['OK', event.id, false, this.behavior.authRejection]);
      return;
    }
    this.authedPubkey = event.pubkey;
    this.server.authLog.push({ connection: this.id, pubkey: event.pubkey, accepted: true });
    this.send(['OK', event.id, true, '']);
  }
}

/**
 * The fake network: relay registry plus the `WebSocket` class bound to it.
 */
class FakeNetwork {
  constructor() {
    /** @type {Map<string, FakeRelayServer>} */
    this.servers = new Map();
    /** Every socket ever created, in creation order. @type {FakeWebSocket[]} */
    this.sockets = [];
    this._pending = new Set();
    this._connectionSeq = 0;
    const network = this;

    /** The WebSocket implementation to hand to the transport. */
    this.WebSocket = class FakeWebSocket {
      static CONNECTING = CONNECTING;
      static OPEN = OPEN;
      static CLOSING = CLOSING;
      static CLOSED = CLOSED;

      constructor(url) {
        this.url = url;
        this.readyState = CONNECTING;
        this.onopen = null;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
        this._listeners = new Map();
        /** @type {FakeConnection | null} */
        this.connection = null;
        network.sockets.push(this);
        network._later(() => this._open());
      }

      addEventListener(type, listener) {
        const set = this._listeners.get(type) ?? new Set();
        set.add(listener);
        this._listeners.set(type, set);
      }

      removeEventListener(type, listener) {
        this._listeners.get(type)?.delete(listener);
      }

      _emit(type, event) {
        const handler = this[`on${type}`];
        if (typeof handler === 'function') handler.call(this, event);
        for (const listener of [...(this._listeners.get(type) ?? [])]) listener.call(this, event);
      }

      _open() {
        if (this.readyState !== CONNECTING) return;
        const server = network.servers.get(normalizeURL(this.url));
        if (!server || server.behavior.refuse) {
          this.readyState = CLOSED;
          this._emit('error', { type: 'error' });
          this._emit('close', { type: 'close', code: 1006 });
          return;
        }
        if (server.behavior.hang) return;
        this.readyState = OPEN;
        this.connection = new FakeConnection(server, this, ++network._connectionSeq);
        server.connections.push(this.connection);
        this._emit('open', { type: 'open' });
        if (server.behavior.challengeOnConnect && !server.behavior.silent) {
          this.connection.sendChallenge();
        }
      }

      send(data) {
        if (this.readyState !== OPEN) throw new Error('fake socket is not open');
        const { connection } = this;
        network._later(() => {
          if (this.readyState === OPEN) connection.onFrame(String(data));
        });
      }

      close() {
        if (this.readyState === CLOSED || this.readyState === CLOSING) return;
        const wasConnecting = this.readyState === CONNECTING;
        this.readyState = CLOSING;
        network._later(() => {
          this.readyState = CLOSED;
          if (wasConnecting) this._emit('error', { type: 'error' });
          this._emit('close', { type: 'close', code: 1000 });
        });
      }

      _deliver(frame) {
        network._later(() => {
          if (this.readyState === OPEN) this._emit('message', { data: JSON.stringify(frame) });
        });
      }

      _closeFromServer() {
        if (this.readyState !== OPEN) return;
        this.readyState = CLOSED;
        network._later(() => this._emit('close', { type: 'close', code: 1006 }));
      }
    };
  }

  /** Schedule work one macrotask (or `ms`) later, cancellable through `dispose`. */
  _later(fn, ms = 0) {
    const entry = { handle: null, timeout: ms > 0 };
    const run = () => {
      this._pending.delete(entry);
      fn();
    };
    entry.handle = entry.timeout ? setTimeout(run, ms) : setImmediate(run);
    this._pending.add(entry);
  }

  /**
   * Register a relay.
   * @param {string} url
   * @param {RelayBehavior} [behavior]
   * @returns {FakeRelayServer}
   */
  addRelay(url, behavior) {
    const server = new FakeRelayServer(this, url, behavior);
    this.servers.set(server.url, server);
    return server;
  }

  /** @param {string} url */
  relay(url) {
    return this.servers.get(normalizeURL(url));
  }

  /** Sockets that are open or still connecting. */
  get liveSockets() {
    return this.sockets.filter((s) => s.readyState === OPEN || s.readyState === CONNECTING);
  }

  /** Cancel every scheduled delivery and close every socket. */
  dispose() {
    for (const { handle, timeout } of this._pending) {
      if (timeout) clearTimeout(handle);
      else clearImmediate(handle);
    }
    this._pending.clear();
    for (const socket of this.sockets) socket.readyState = CLOSED;
  }
}

/** @returns {FakeNetwork} */
export function createFakeNetwork() {
  return new FakeNetwork();
}

/**
 * The three relay personalities measured on 2026-10-10, ready to register.
 * @returns {{ nostr1: RelayBehavior, damus: RelayBehavior, open: RelayBehavior }}
 */
export function liveRelayProfiles() {
  return {
    /** auth.nostr1.com: challenge on connect, reads and writes need AUTH, any key works. */
    nostr1: {
      challengeOnConnect: true,
      requireAuthToRead: true,
      requireAuthToWrite: true,
    },
    /** relay.damus.io / relay.nostr.net: nested prefix, late challenge, AUTH broken server-side. */
    damus: {
      challengeAfterRefusal: true,
      requireAuthToRead: true,
      readRefusal: RELAY_TEXT.AUTH_REQUIRED_NESTED,
      authResult: 'reject',
    },
    /** nos.lol, relay.primal.net: never challenge. */
    open: {},
  };
}
