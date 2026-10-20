/**
 * A stand-in NWC wallet behind a stand-in relay, for browser checks: the
 * page's WebSocket to `relayUrl` is answered here (Playwright routeWebSocket)
 * by a wallet service that speaks NIP-47 for real: a signed info event
 * (kind 13194), encrypted requests and answers (kinds 23194 / 23195, nip44_v2
 * or nip04, as the client chose), built on nostr-core.
 *
 * It also counts the page's connections to the relay (`sockets`), which is
 * how a check proves BuhoGO keeps one connection per wallet.
 *
 * Test fixture only: invoices are synthetic regtest strings, never payable.
 * scripts/device/nwc-stand-in.mjs serves the same wallet on a local port
 * for a device.
 */
import { createHash, randomBytes } from 'node:crypto';
import { bech32 } from 'bech32';
import { bytesToHex, finalizeEvent, generateSecretKey, getPublicKey, nip04, nip44 } from 'nostr-core';
import { profileInvoiceFixture } from './profileInvoice.mjs';

const INFO_KIND = 13194;
const REQUEST_KIND = 23194;
const RESPONSE_KIND = 23195;

const METHODS = ['pay_invoice', 'make_invoice', 'lookup_invoice', 'get_balance', 'get_info', 'list_transactions'];

/**
 * A synthetic invoice whose payment hash belongs to a preimage this file
 * knows, so a stand-in payment can prove itself the way a real one does
 * (sha256(preimage) == payment hash). Re-encoded from the regtest fixture,
 * not re-signed: never payable anywhere.
 */
function invoiceWithPreimage(amountSats) {
  const preimage = randomBytes(32);
  const hash = createHash('sha256').update(preimage).digest();
  const words = [...bech32.decode(profileInvoiceFixture(amountSats), 4096).words];
  // Tagged field "p" (payment hash) follows the 7-word timestamp: type, two length words, 52 data words.
  if (words[7] !== 1 || words[8] * 32 + words[9] !== 52) throw new Error('unexpected invoice layout');
  words.splice(10, 52, ...bech32.toWords(hash));
  const prefix = bech32.decode(profileInvoiceFixture(amountSats), 4096).prefix;
  return { invoice: bech32.encode(prefix, words, 4096), preimage: bytesToHex(preimage), paymentHash: bytesToHex(hash) };
}

/** Default answers; a check can replace any of them. */
function defaultHandlers(paid) {
  const now = () => Math.floor(Date.now() / 1000);
  return {
    get_info: () => ({ alias: 'Stand-in Hub', pubkey: '02'.padEnd(66, 'a'), network: 'mainnet', methods: METHODS, notifications: [] }),
    get_balance: () => ({ balance: 48_210_000 }),
    make_invoice: (params) => ({
      type: 'incoming', state: 'pending', invoice: profileInvoiceFixture(Math.round((params.amount || 1000) / 1000)),
      payment_hash: 'ab'.repeat(32), amount: params.amount, created_at: now(), expires_at: now() + 3600,
    }),
    lookup_invoice: (params) => ({ type: 'incoming', state: 'pending', payment_hash: params.payment_hash, amount: 1000, created_at: now() }),
    list_transactions: (params) => ({
      transactions: Array.from({ length: Math.min(params.limit || 10, 10) }, (_, i) => ({
        type: i % 2 ? 'outgoing' : 'incoming', state: 'settled', invoice: '', description: `Stand-in ${(params.offset || 0) + i + 1}`,
        payment_hash: String((params.offset || 0) + i + 1).padStart(64, '0'), amount: 21_000 * (i + 1), fees_paid: 0,
        created_at: now() - 3600 * ((params.offset || 0) + i + 1), settled_at: now() - 3600 * ((params.offset || 0) + i + 1),
      })),
    }),
    // Pays the stand-in's own invoices with their real preimage; anything else gets one that proves nothing.
    pay_invoice: (params) => ({ preimage: paid.get(params.invoice) || '00'.repeat(32) }),
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.relayUrl]
 * @param {Record<string, (params: object) => object>} [options.handlers]
 */
export function createNwcStandIn({ relayUrl = 'wss://relay.standin.test', handlers = {} } = {}) {
  const walletSecret = generateSecretKey();
  const walletPubkey = getPublicKey(walletSecret);
  const clientSecret = generateSecretKey();
  // invoice -> preimage, for the invoices this stand-in hands out (payableInvoice).
  const paid = new Map();
  const answer = { ...defaultHandlers(paid), ...handlers };
  const info = finalizeEvent({
    kind: INFO_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['encryption', 'nip44_v2 nip04'], ['notifications', '']],
    content: METHODS.join(' '),
  }, walletSecret);

  const sockets = { opened: 0, open: 0, list: [] };
  const requests = [];

  const matches = (filter, event) =>
    (!filter.kinds || filter.kinds.includes(event.kind))
    && (!filter.authors || filter.authors.includes(event.pubkey))
    && (!filter.ids || filter.ids.includes(event.id))
    && ['e', 'p'].every((name) => !filter[`#${name}`] || event.tags.some((t) => t[0] === name && filter[`#${name}`].includes(t[1])));

  function encryptFor(clientPubkey, encryption, text) {
    return encryption === 'nip44_v2'
      ? nip44.encrypt(text, nip44.getConversationKey(walletSecret, clientPubkey))
      : nip04.encrypt(walletSecret, clientPubkey, text);
  }

  function decryptFrom(clientPubkey, encryption, data) {
    return encryption === 'nip44_v2'
      ? nip44.decrypt(data, nip44.getConversationKey(walletSecret, clientPubkey))
      : nip04.decrypt(walletSecret, clientPubkey, data);
  }

  function respond(request) {
    const encryption = request.tags.find((t) => t[0] === 'encryption')?.[1] || 'nip04';
    const { method, params = {} } = JSON.parse(decryptFrom(request.pubkey, encryption, request.content));
    requests.push(method);
    const handler = answer[method];
    const body = handler
      ? { result_type: method, result: handler(params) }
      : { result_type: method, error: { code: 'NOT_IMPLEMENTED', message: `${method} is not supported` } };
    return finalizeEvent({
      kind: RESPONSE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', request.pubkey], ['e', request.id]],
      content: encryptFor(request.pubkey, encryption, JSON.stringify(body)),
    }, walletSecret);
  }

  /** Answer one page connection to the relay. */
  function serve(ws) {
    sockets.opened += 1;
    sockets.open += 1;
    const socket = { ws, closed: false };
    sockets.list.push(socket);
    const subs = new Map();
    // Answers whose subscription has not arrived yet (the client may publish first).
    const waiting = [];

    const deliver = (event) => {
      let delivered = false;
      for (const [id, filters] of subs) {
        if (filters.some((f) => matches(f, event))) {
          ws.send(JSON.stringify(['EVENT', id, event]));
          delivered = true;
        }
      }
      return delivered;
    };

    ws.onMessage((raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const [type, ...rest] = message;
      if (type === 'REQ') {
        const [id, ...filters] = rest;
        subs.set(id, filters);
        if (filters.some((f) => matches(f, info))) ws.send(JSON.stringify(['EVENT', id, info]));
        for (let i = waiting.length - 1; i >= 0; i--) {
          if (filters.some((f) => matches(f, waiting[i]))) {
            ws.send(JSON.stringify(['EVENT', id, waiting[i]]));
            waiting.splice(i, 1);
          }
        }
        ws.send(JSON.stringify(['EOSE', id]));
      } else if (type === 'CLOSE') {
        subs.delete(rest[0]);
      } else if (type === 'EVENT') {
        const event = rest[0];
        ws.send(JSON.stringify(['OK', event.id, true, '']));
        if (event.kind === REQUEST_KIND && event.tags.some((t) => t[0] === 'p' && t[1] === walletPubkey)) {
          const reply = respond(event);
          if (!deliver(reply)) waiting.push(reply);
        }
      }
    });
    ws.onClose(() => {
      if (socket.closed) return;
      socket.closed = true;
      sockets.open -= 1;
    });
  }

  return {
    relayUrl,
    walletPubkey,
    sockets,
    requests,
    /** An invoice the stand-in wallet can pay with a valid proof. */
    payableInvoice(amountSats) {
      const made = invoiceWithPreimage(amountSats);
      paid.set(made.invoice, made.preimage);
      return made.invoice;
    },
    /** The connection string a person would paste. */
    connection: `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent(relayUrl)}&secret=${bytesToHex(clientSecret)}`,
    /** Route the page's connections to the relay here. */
    attach: (page) => page.routeWebSocket((url) => url.href.startsWith(relayUrl), serve),
    /** Answer one connection given as { onMessage, send, onClose, close } (e.g. a real WebSocket server's). */
    serve,
    /** The wallet's info event, to publish on a real relay. */
    info,
    /** The wallet's signed answer to a request event addressed to it, or null for anything else. */
    answerTo: (event) => (event?.kind === REQUEST_KIND && event.tags.some((t) => t[0] === 'p' && t[1] === walletPubkey) ? respond(event) : null),
    /** Drop every open connection from the relay's side, as a phone losing the network would. */
    dropAll() {
      for (const socket of sockets.list) {
        if (socket.closed) continue;
        socket.ws.close({ code: 1001, reason: 'going away' });
        socket.closed = true;
        sockets.open -= 1;
      }
    },
  };
}
