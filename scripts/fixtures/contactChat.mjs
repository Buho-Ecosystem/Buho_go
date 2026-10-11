// Test doubles for scripts/check-contact-chat.mjs. Node only, nothing here ships in the app.
//
//   SimRelay        one in-memory Nostr relay (NIP-01 + NIP-42) that every relay URL of the
//                   app is routed to. `auth.nostr1.com` behaves like the real one: it sends an
//                   AUTH challenge on connect and requires AUTH to read or write kind 1059.
//   InvoiceLedger   mints structurally valid BOLT-11 invoices and remembers which are paid, so
//                   the receiver's stubbed wallet and the payer's stubbed wallet agree.
//   LnurlServer     the LNURL-pay endpoint behind a Lightning address: the only place an invoice
//                   for a chat request is ever created (when the payer taps Pay). It also answers
//                   LUD-21 verify calls. With no `receivingWalletId` the money lands in a wallet
//                   that is not in the requester's app (Alby, Wallet of Satoshi...).
import { createHash } from 'node:crypto';
import { bech32 } from 'bech32';
import { matchFilters, verifyAuthEvent, verifyEvent } from 'nostr-core';

const KIND_REPLACEABLE = (kind) => kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
const KIND_EPHEMERAL = (kind) => kind >= 20000 && kind < 30000;
const KIND_AUTH = 22242;
const KIND_GIFT_WRAP = 1059;
const AUTH_REQUIRED = 'auth-required: you must authenticate';

/** Hosts that require NIP-42 AUTH for kind 1059 (the app's measured behaviour of auth.nostr1.com). */
export const AUTH_HOSTS = Object.freeze(['auth.nostr1.com']);

/** One relay, many sockets. `attach` returns the handlers for one socket. */
export class SimRelay {
  constructor({ authHosts = AUTH_HOSTS } = {}) {
    this.authHosts = new Set(authHosts);
    /** Every accepted, stored event (replaceable kinds keep only the newest). */
    this.events = [];
    /** Observable facts for assertions. */
    this.log = { auths: [], authRefusals: [], connections: [] };
    this.sockets = new Set();
    this._challenge = 0;
  }

  /** Stored events matching a partial `{ kind, pubkey }`. */
  find({ kind, pubkey } = {}) {
    return this.events.filter((event) => (kind === undefined || event.kind === kind) && (!pubkey || event.pubkey === pubkey));
  }

  /** Resolves once a stored event matches; rejects with `label` after `timeoutMs`. */
  async waitFor(match, label, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.find(match)[0];
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`relay never received: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * @param {string} url The URL the app connected to.
   * @param {(frame: unknown[]) => void} send Sends one frame to the app.
   * @returns {{ onMessage: (raw: string) => void, onClose: () => void }}
   */
  attach(url, send) {
    const host = new URL(url).host;
    const socket = {
      url, host, send, subs: new Map(), pubkey: null,
      requiresAuth: this.authHosts.has(host),
      challenge: this.authHosts.has(host) ? `challenge-${++this._challenge}` : null,
    };
    this.sockets.add(socket);
    this.log.connections.push(host);
    if (socket.challenge) send(['AUTH', socket.challenge]);
    return {
      onMessage: (raw) => this._handle(socket, raw),
      onClose: () => this.sockets.delete(socket),
    };
  }

  _handle(socket, raw) {
    let frame;
    try { frame = JSON.parse(String(raw)); } catch { return socket.send(['NOTICE', 'invalid: not JSON']); }
    const [type, ...rest] = frame;
    if (type === 'REQ') return this._req(socket, rest[0], rest.slice(1));
    if (type === 'CLOSE') return void socket.subs.delete(rest[0]);
    if (type === 'EVENT') return this._event(socket, rest[0]);
    if (type === 'AUTH') return this._auth(socket, rest[0]);
    return socket.send(['NOTICE', `unsupported: ${type}`]);
  }

  /** Reading wraps is allowed for an unauthenticated socket on open relays only. */
  _mayRead(socket, filters) {
    if (!socket.requiresAuth || socket.pubkey) return true;
    return !filters.some((filter) => !filter.kinds || filter.kinds.includes(KIND_GIFT_WRAP));
  }

  /** On an AUTH relay a wrap is only served to the pubkey it is addressed to. */
  _visibleTo(socket, event) {
    if (!socket.requiresAuth || event.kind !== KIND_GIFT_WRAP) return true;
    return event.tags.some((tag) => tag[0] === 'p' && tag[1] === socket.pubkey);
  }

  _req(socket, id, filters) {
    if (!this._mayRead(socket, filters)) {
      this.log.authRefusals.push({ host: socket.host, op: 'read' });
      return socket.send(['CLOSED', id, AUTH_REQUIRED]);
    }
    socket.subs.set(id, filters);
    const limit = Math.min(...filters.map((filter) => filter.limit ?? Infinity));
    const stored = this.events
      .filter((event) => matchFilters(filters, event) && this._visibleTo(socket, event))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limit);
    for (const event of stored) socket.send(['EVENT', id, event]);
    socket.send(['EOSE', id]);
  }

  _event(socket, event) {
    if (!event || typeof event.id !== 'string') return;
    if (!verifyEvent(event)) return socket.send(['OK', event.id, false, 'invalid: bad signature']);
    if (socket.requiresAuth && event.kind === KIND_GIFT_WRAP && !socket.pubkey) {
      this.log.authRefusals.push({ host: socket.host, op: 'write' });
      return socket.send(['OK', event.id, false, AUTH_REQUIRED]);
    }
    if (!KIND_EPHEMERAL(event.kind)) {
      if (this.events.some((stored) => stored.id === event.id)) return socket.send(['OK', event.id, true, 'duplicate: have it']);
      if (KIND_REPLACEABLE(event.kind)) {
        const index = this.events.findIndex((stored) => stored.kind === event.kind && stored.pubkey === event.pubkey);
        if (index >= 0) {
          if (this.events[index].created_at > event.created_at) return socket.send(['OK', event.id, true, 'duplicate: newer exists']);
          this.events.splice(index, 1);
        }
      }
      this.events.push(event);
    }
    socket.send(['OK', event.id, true, '']);
    this._broadcast(event);
  }

  /** Store an event as if some other client had published it (a sender with no browser). */
  inject(event) {
    if (!verifyEvent(event)) throw new Error('inject: bad signature');
    this.events.push(event);
    this._broadcast(event);
  }

  _broadcast(event) {
    for (const other of this.sockets) {
      for (const [subId, filters] of other.subs) {
        if (matchFilters(filters, event) && this._visibleTo(other, event)) other.send(['EVENT', subId, event]);
      }
    }
  }

  _auth(socket, event) {
    const valid = event?.kind === KIND_AUTH && socket.challenge && verifyAuthEvent(event, socket.challenge, socket.url);
    if (!valid) return socket.send(['OK', event?.id ?? '', false, 'invalid: bad AUTH event']);
    socket.pubkey = event.pubkey;
    this.log.auths.push({ host: socket.host, pubkey: event.pubkey });
    socket.send(['OK', event.id, true, '']);
  }
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const toWords = (value, count) => Array.from({ length: count }, (_, i) => Math.floor(value / 32 ** (count - 1 - i)) % 32);
const tagged = (type, words) => [type, ...toWords(words.length, 2), ...words];

/**
 * Mainnet BOLT-11 invoices with real payment hashes. They are unsigned (the app's decoder
 * does not check the signature) and can never be paid on a real network.
 */
export class InvoiceLedger {
  constructor() {
    this._byHash = new Map();
    this._counter = 0;
  }

  mint({ amountSats }) {
    const now = Math.floor(Date.now() / 1000);
    const preimage = Buffer.alloc(32);
    preimage.writeUInt32BE(++this._counter, 28);
    const paymentHash = sha256Hex(preimage);
    const hashWords = bech32.toWords(Buffer.from(paymentHash, 'hex'));
    const words = [
      ...toWords(now, 7),
      ...tagged(1, hashWords),
      ...tagged(6, toWords(3600, 3)),
      ...bech32.toWords(Uint8Array.from({ length: 65 }, (_, i) => (i + 1) % 251)),
    ];
    const bolt11 = bech32.encode(`lnbc${amountSats * 10}n`, words, 4096);
    this._byHash.set(paymentHash, { bolt11, preimage: preimage.toString('hex'), paid: false, amountSats });
    return { bolt11, paymentHash };
  }

  /** The invoice a BOLT-11 string was minted as, or null. */
  byInvoice(bolt11) {
    return [...this._byHash.entries()].map(([hash, entry]) => ({ hash, ...entry })).find((entry) => entry.bolt11 === bolt11) ?? null;
  }

  /** Mark an invoice paid; returns the preimage, or null if this ledger never minted it. */
  pay(bolt11) {
    const entry = this.byInvoice(bolt11);
    if (!entry) return null;
    const stored = this._byHash.get(entry.hash);
    stored.paid = true;
    stored.paidAt = Math.floor(Date.now() / 1000);
    return entry.preimage;
  }
}

// ---------------------------------------------------------------------------
// LNURL-pay server behind a Lightning address
// ---------------------------------------------------------------------------

/**
 * The LNURL-pay endpoint of one domain (Alice's `alice@btc.mybuho.de`): the pay request, and
 * the callback that mints an invoice from the shared ledger for exactly the asked amount.
 * Every invoice it issues is remembered with the comment it was asked with, and the receiving
 * wallet's history (`incomingFor`) lists those that have been paid, which is what the requester's
 * app checks the payer's claim against.
 */
export class LnurlServer {
  constructor({ ledger, domain, receivingWalletId = null, minSendable = 1_000, maxSendable = 100_000_000_000 }) {
    this.ledger = ledger;
    this.domain = domain;
    this.receivingWalletId = receivingWalletId;
    this.minSendable = minSendable;
    this.maxSendable = maxSendable;
    /** Invoices handed out: { name, amountSats, comment, bolt11, paymentHash }. */
    this.issued = [];
    /** Pay requests served (the well-known lookups), for assertions. */
    this.lookups = [];
    /** Payment hashes asked through the LUD-21 verify URL, for assertions. */
    this.verifications = [];
    /** Set to an LNURL error reason to make the next callback fail once. */
    this.failNext = null;
  }

  owns(hostname) {
    return hostname === this.domain;
  }

  /** @returns {{ status: number, body: object }} */
  handle(url) {
    const known = url.pathname.match(/^\/\.well-known\/lnurlp\/([^/]+)$/);
    if (known) {
      this.lookups.push(known[1]);
      return {
        status: 200,
        body: {
          tag: 'payRequest',
          callback: `https://${this.domain}/lnurlp/callback/${known[1]}`,
          minSendable: this.minSendable,
          maxSendable: this.maxSendable,
          metadata: JSON.stringify([['text/plain', `Pay ${known[1]}`]]),
          commentAllowed: 255,
        },
      };
    }
    const callback = url.pathname.match(/^\/lnurlp\/callback\/([^/]+)$/);
    if (callback) {
      if (this.failNext) {
        const reason = this.failNext;
        this.failNext = null;
        return { status: 200, body: { status: 'ERROR', reason } };
      }
      const amountMsat = Number(url.searchParams.get('amount'));
      if (!Number.isSafeInteger(amountMsat) || amountMsat < this.minSendable || amountMsat > this.maxSendable) {
        return { status: 200, body: { status: 'ERROR', reason: 'Amount out of range' } };
      }
      const { bolt11, paymentHash } = this.issue({ name: callback[1], amountSats: Math.floor(amountMsat / 1000), comment: url.searchParams.get('comment') });
      return { status: 200, body: { pr: bolt11, routes: [], verify: `https://${this.domain}/lnurlp/verify/${paymentHash}` } };
    }
    // LUD-21: is this invoice settled? Answers with the preimage once the ledger shows it paid.
    const verify = url.pathname.match(/^\/lnurlp\/verify\/([0-9a-f]{64})$/);
    if (verify) {
      this.verifications.push(verify[1]);
      const entry = this.issued.find((issued) => issued.paymentHash === verify[1]);
      const found = entry && this.ledger.byInvoice(entry.bolt11);
      if (!found) return { status: 404, body: { status: 'ERROR', reason: 'Not found' } };
      return { status: 200, body: { status: 'OK', settled: Boolean(found.paid), preimage: found.paid ? found.preimage : null, pr: found.bolt11 } };
    }
    return { status: 404, body: { status: 'ERROR', reason: 'not found' } };
  }

  /** Mint and remember one invoice (the callback, or a wallet that pays an address directly). */
  issue({ name, amountSats, comment = null }) {
    const { bolt11, paymentHash } = this.ledger.mint({ amountSats });
    this.issued.push({ name, amountSats, comment, bolt11, paymentHash });
    return { bolt11, paymentHash };
  }

  /** The paid invoices as the receiving wallet's history rows (what Alice's Spark SDK would list). */
  incomingFor(walletId) {
    if (walletId !== this.receivingWalletId) return [];
    return this.issued.flatMap((entry) => {
      const found = this.ledger.byInvoice(entry.bolt11);
      if (!found?.paid) return [];
      return [{
        id: `lnurl-${entry.paymentHash.slice(0, 8)}`,
        type: 'incoming',
        amount: entry.amountSats,
        fee: 0,
        status: 'completed',
        settled_at: found.paidAt,
        paymentHash: entry.paymentHash,
        description: entry.comment || '',
      }];
    });
  }
}
