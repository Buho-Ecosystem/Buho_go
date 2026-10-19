/**
 * Pairing with a wallet without copying a secret.
 *
 * BuhoGO makes the connection's key pair itself and keeps the secret. The
 * wallet only ever sees the public key, approves it, and answers with its
 * own key and relays. BuhoGO then builds the usual connection string, which
 * the connect sheet tests like any other.
 *
 * The wallet approves in one of two ways, both described per wallet in
 * utils/connectWallets.js (nothing here names a wallet):
 *
 *   approval page  The wallet's own page takes BuhoGO's public key. It either
 *                  sends the person back and announces the connection on its
 *                  relays (approve-and-return), or serves every connection
 *                  from one known key, so the connection is known up front
 *                  (approve-known).
 *   code           A `nostr+walletauth://` request (NWC-08, client-initiated
 *                  connection) that a wallet app scans or opens. The wallet
 *                  answers with its info event, addressed to our key,
 *                  carrying our `state`.
 *
 * Pure: no storage, no network. services/nwcPairing.js keeps and listens.
 */

import { bytesToHex, generateSecretKey, getPublicKey, randomBytes } from 'nostr-core';
import { parseNwcConnection } from './nwcConnection.js';
import { CODE_RELAYS, PAIRING } from './connectWallets.js';

/** How long an approval may take before the request is dropped. */
export const PAIRING_TTL_MS = 15 * 60 * 1000;

/** The info event a wallet service publishes (NIP-47). */
export const WALLET_INFO_KIND = 13194;

/** What BuhoGO uses; a wallet must grant these or decline. */
export const REQUEST_METHODS = Object.freeze([
  'pay_invoice', 'make_invoice', 'lookup_invoice', 'get_balance', 'get_info', 'list_transactions',
]);
/** Used when granted (the spending limit), never a reason to decline. */
export const OPTIONAL_METHODS = Object.freeze(['get_budget']);
export const NOTIFICATION_TYPES = Object.freeze(['payment_received', 'payment_sent']);

/** The request id of a code (no wallet chosen; any wallet app answers). */
export const CODE_REQUEST = 'code';

/** Where a wallet sends the person back (an https address; the app opens it). */
export const RETURN_URL = 'https://go.mybuho.de/nwc/connected';
export const RETURN_PATH = '/nwc/connected';
/**
 * Where a wallet app on the same phone sends the person back. A custom
 * scheme, not the https address: it needs no App Link verification, which
 * Play-signed builds do not have yet. It carries only the request id.
 */
export const APP_RETURN_URL = 'buhogo://nwc/connected';

const APP_NAME = 'BuhoGO';
const APP_ICON = 'https://go.mybuho.de/icons/buho_go_app_icon.png';
const HEX_64_RE = /^[a-f0-9]{64}$/i;
const STATE_RE = /^[a-f0-9]{32,}$/;
const RELAY_RE = /^wss?:\/\/\S+$/i;
const APP_RETURN_RE = /^buhogo:\/\/nwc\/connected\/?(\?.*)?$/i;
const HOST_RE = /^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)*)$/i;

/**
 * A new pairing request: the connection's own key pair, a `state` the
 * wallet must echo, and an id the return address carries.
 *
 * @param {string} walletId utils/connectWallets id, or CODE_REQUEST
 * @param {object} [options]
 * @param {string} [options.baseUrl] where the approval page lives, when the wallet has several (a self-hosted Hub)
 * @param {number} [options.now]
 * @returns {PairingRequest}
 *
 * @typedef {object} PairingRequest
 * @property {string} id
 * @property {string} walletId
 * @property {string} secret   hex; the connection's secret, never shown
 * @property {string} pubkey   hex; what the wallet sees
 * @property {string} state    hex; echoed by wallets that follow NWC-08
 * @property {string} baseUrl
 * @property {number} createdAt
 */
export function createPairingRequest(walletId, { baseUrl = '', now = Date.now() } = {}) {
  const key = generateSecretKey();
  return {
    id: bytesToHex(randomBytes(12)),
    walletId,
    secret: bytesToHex(key),
    pubkey: getPublicKey(key),
    state: bytesToHex(randomBytes(16)),
    baseUrl,
    createdAt: now,
  };
}

/** True when the request is older than PAIRING_TTL_MS. */
export function isPairingExpired(request, now = Date.now()) {
  return !request || now - Number(request.createdAt || 0) > PAIRING_TTL_MS;
}

/**
 * An address someone typed for their own wallet server (a self-hosted
 * Hub), as an origin plus optional path; '' when it is not one. A bare host
 * gets https. Plain http stays possible for a server at home (nothing
 * secret travels in the approval link). A pasted approval-page address
 * (`approvalPath`) is trimmed back to the server.
 */
export function normalizeWalletUrl(input, { approvalPath = '' } = {}) {
  let text = String(input || '').trim();
  if (!text) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  // Browsers differ on what they accept as a host (some escape spaces), so
  // the host is checked here: a name, an IPv4 address or a bracketed IPv6.
  if (!HOST_RE.test(url.hostname)) return '';
  let path = url.pathname.replace(/\/+$/, '');
  if (approvalPath && path.toLowerCase().endsWith(approvalPath.toLowerCase())) {
    path = path.slice(0, -approvalPath.length).replace(/\/+$/, '');
  }
  return `${url.protocol}//${url.host}${path}`;
}

/**
 * The link that opens a wallet's approval page for this request. Every
 * approval page gets BuhoGO's name and public key; one that sends the
 * person back (approve-and-return) also gets the methods BuhoGO uses and
 * the return address with the request id.
 *
 * @param {PairingRequest} request
 * @param {object} wallet utils/connectWallets entry
 */
export function approvalUrl(request, wallet, { returnUrl = RETURN_URL } = {}) {
  const { approval } = wallet;
  const params = new URLSearchParams();
  if (approval.appId) params.set('app', approval.appId);
  params.set('name', APP_NAME);
  params.set('pubkey', request.pubkey);
  if (wallet.pairing === PAIRING.APPROVE_AND_RETURN) {
    params.set('request_methods', REQUEST_METHODS.join(' '));
    params.set('notification_types', NOTIFICATION_TYPES.join(' '));
    params.set('return_to', `${returnUrl}?request=${request.id}`);
  }
  const base = request.baseUrl || approval.url || approval.locations?.[0]?.url || '';
  return `${base}${approval.path}?${params.toString().replace(/\+/g, '%20')}`;
}

/**
 * The `nostr+walletauth://` code a wallet scans (NWC-08). Wallets that
 * follow the older draft read the same parameters and ignore `state`.
 * `returnTo` is only for a link opened on this phone: a wallet app that
 * reads it (Alby Go) sends the person back to BuhoGO after approving. A
 * code shown to another device leaves it out.
 */
export function walletAuthUri(request, { relays = CODE_RELAYS, returnTo = '' } = {}) {
  const params = new URLSearchParams();
  for (const relay of relays) params.append('relay', relay);
  params.set('state', request.state);
  params.set('name', APP_NAME);
  params.set('icon', APP_ICON);
  params.set('request_methods', REQUEST_METHODS.join(' '));
  params.set('optional_request_methods', OPTIONAL_METHODS.join(' '));
  params.set('notification_types', NOTIFICATION_TYPES.join(' '));
  if (returnTo) params.set('return_to', `${returnTo}?request=${request.id}`);
  return `nostr+walletauth://${request.pubkey}?${params.toString().replace(/\+/g, '%20')}`;
}

/**
 * The connection string for an approved request; '' when the parts do not
 * make a valid one.
 */
export function connectionFor(request, { walletPubkey, relays, lud16 = '' }) {
  if (!HEX_64_RE.test(String(walletPubkey || ''))) return '';
  const usable = (relays || []).filter((relay) => RELAY_RE.test(relay));
  if (!usable.length) return '';
  const params = new URLSearchParams();
  for (const relay of usable) params.append('relay', relay);
  params.set('secret', request.secret);
  if (lud16) params.set('lud16', lud16);
  const parsed = parseNwcConnection(`nostr+walletconnect://${walletPubkey.toLowerCase()}?${params.toString()}`);
  return parsed.ok ? parsed.normalized : '';
}

/** The connection of an approve-known wallet, known before it is approved. */
export function knownConnection(request, wallet) {
  return connectionFor(request, { walletPubkey: wallet.approval.walletPubkey, relays: [wallet.approval.relay] });
}

/**
 * Where to listen for a wallet's answer to a request: the wallet's own
 * announcing relays, or for a code the relays the code names.
 */
export function answerRelays(wallet) {
  return wallet?.approval?.relays || CODE_RELAYS;
}

/**
 * Read a wallet's info event as the answer to a request, or null when it
 * is not one.
 *
 * The event must name our key (`p`). A wallet that sends `state` must send
 * ours. Alby Hub sends none, so an answer without it counts only when it
 * came over one of `statelessRelays` (where such a Hub announces); anywhere
 * else it could be anyone's. The caller has checked the signature.
 *
 * @param {object} event
 * @param {PairingRequest} request
 * @param {string} receivedOn the relay the event came from
 * @param {{ statelessRelays?: string[] }} [options]
 * @returns {{ walletPubkey: string, relays: string[] } | null}
 */
export function readWalletAnswer(event, request, receivedOn, { statelessRelays = CODE_RELAYS } = {}) {
  if (!event || event.kind !== WALLET_INFO_KIND) return null;
  if (!HEX_64_RE.test(String(event.pubkey || ''))) return null;
  const tags = Array.isArray(event.tags) ? event.tags : [];
  const tag = (name) => tags.filter((t) => Array.isArray(t) && t[0] === name).map((t) => String(t[1] || ''));
  if (!tag('p').includes(request.pubkey)) return null;

  const states = tag('state');
  if (states.length) {
    if (!states.includes(request.state)) return null;
  } else if (!statelessRelays.map(stripSlash).includes(stripSlash(receivedOn))) {
    return null;
  }

  const announced = tag('relay').filter((relay) => RELAY_RE.test(relay));
  return {
    walletPubkey: event.pubkey.toLowerCase(),
    relays: announced.length ? announced : [stripSlash(receivedOn)],
  };
}

/** The request id a return address names, '' when none. */
export function returnRequestId(query) {
  return String([].concat(query?.request ?? [])[0] || '');
}

/**
 * What a wallet put on the return address: its relays, its wallet key, a
 * Lightning address, and our request id. Reads Alby Hub's names (`relay`,
 * `pubkey`) and NWC-08's (`relay_url`, `wallet_pubkey`).
 *
 * @param {Record<string, string|string[]>} query the route's query
 * @returns {{ requestId: string, walletPubkey: string, relays: string[], lud16: string, state: string } | null}
 */
export function readReturn(query) {
  const all = (name) => [].concat(query?.[name] ?? []).map(String).filter(Boolean);
  const requestId = all('request')[0] || '';
  const walletPubkey = (all('wallet_pubkey')[0] || all('pubkey')[0] || '').toLowerCase();
  const relays = [...all('relay'), ...all('relay_url')].filter((relay) => RELAY_RE.test(relay));
  if (!requestId || !HEX_64_RE.test(walletPubkey) || !relays.length) return null;
  const state = all('state')[0] || '';
  return {
    requestId,
    walletPubkey,
    relays: [...new Set(relays)],
    lud16: all('lud16')[0] || '',
    state: STATE_RE.test(state) ? state : '',
  };
}

function stripSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * The in-app route for a return address a wallet opened
 * (https://go.mybuho.de/nwc/connected?… from a Hub, buhogo://nwc/connected?…
 * from a wallet app on this phone), or null for any other link. Repeated
 * parameters (several relays) stay lists.
 *
 * @param {string} url
 * @returns {{ path: string, query: Record<string, string|string[]> } | null}
 */
export function pairingReturnRoute(url) {
  const text = String(url || '').trim();
  // Older Android WebViews read a custom scheme's host as part of the path,
  // so the app's return address is matched as text, not through URL.
  const appMatch = text.match(APP_RETURN_RE);
  let search;
  if (appMatch) {
    search = appMatch[1] || '';
  } else {
    let parsed;
    try {
      parsed = new URL(text);
    } catch {
      return null;
    }
    const home = new URL(RETURN_URL);
    if (parsed.protocol !== 'https:' || parsed.host !== home.host) return null;
    if (parsed.pathname.replace(/\/+$/, '') !== RETURN_PATH) return null;
    search = parsed.search;
  }
  const params = new URLSearchParams(search);
  const query = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  return { path: RETURN_PATH, query };
}

/** The return address as the app opens it, for handing over from a browser. */
export function returnUrlFor(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    for (const item of [].concat(value ?? [])) params.append(key, String(item));
  }
  const search = params.toString();
  return search ? `${RETURN_URL}?${search}` : RETURN_URL;
}
