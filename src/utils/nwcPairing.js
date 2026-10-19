/**
 * Pairing with a wallet without copying a secret.
 *
 * BuhoGO makes the connection's key pair itself and keeps the secret. The
 * wallet only ever sees the public key, approves it, and answers with its
 * own key and relays. BuhoGO then builds the usual connection string, which
 * the connect sheet tests like any other.
 *
 * Three ways a wallet approves:
 *
 *   hub     Alby Hub's approval page (`/apps/new?pubkey=…&return_to=…`). It
 *           sends the person back with its relays and key, and also
 *           publishes an info event addressed to our key on its relays.
 *   coinos  Coinos' approval page (`/apps/new?pubkey=…`). It neither returns
 *           nor announces; it serves every connection from one wallet key
 *           on one relay, so the connection is known up front and an answer
 *           to `get_info` is the approval.
 *   code    A `nostr+walletauth://` code (NWC-08, client-initiated
 *           connection) that a wallet app scans or opens. The wallet
 *           answers with its info event, addressed to our key, carrying our
 *           `state`.
 *
 * Pure: no storage, no network. services/nwcPairing.js keeps and listens.
 */

import { bytesToHex, generateSecretKey, getPublicKey, randomBytes } from 'nostr-core';
import { parseNwcConnection } from './nwcConnection.js';

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

/**
 * Alby Hub's default relays: where a Hub publishes the info event for a new
 * connection, and where wallets that create connections on a Hub answer.
 * A code also asks to be answered here, so one listener serves both.
 */
export const HUB_RELAYS = Object.freeze(['wss://relay.getalby.com', 'wss://relay2.getalby.com']);

/** Alby Cloud: every cloud Hub is reached through this address. */
export const ALBY_CLOUD_URL = 'https://my.albyhub.com';

/** Coinos serves every connection from this key, on this relay. */
export const COINOS = Object.freeze({
  url: 'https://coinos.io',
  walletPubkey: 'ba80990666ef0b6f4ba5059347beb13242921e54669e680064ca755256a1e3a6',
  relay: 'wss://relay.coinos.io',
});

/** Where a Hub sends the person back (an https address; the app opens it). */
export const RETURN_URL = 'https://go.mybuho.de/nwc/connected';
export const RETURN_PATH = '/nwc/connected';

const APP_NAME = 'BuhoGO';
const APP_ICON = 'https://go.mybuho.de/icons/buho_go_app_icon.png';
const HEX_64_RE = /^[a-f0-9]{64}$/i;
const STATE_RE = /^[a-f0-9]{32,}$/;
const RELAY_RE = /^wss?:\/\/\S+$/i;
const HOST_RE = /^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)*)$/i;

/**
 * A new pairing request: the connection's own key pair, a `state` the
 * wallet must echo, and an id the return address carries.
 *
 * @param {'hub'|'coinos'|'code'} kind
 * @param {object} [options]
 * @param {string} [options.hubUrl] the Hub's address (kind 'hub')
 * @param {number} [options.now]
 * @returns {PairingRequest}
 *
 * @typedef {object} PairingRequest
 * @property {string} id
 * @property {'hub'|'coinos'|'code'} kind
 * @property {string} secret   hex; the connection's secret, never shown
 * @property {string} pubkey   hex; what the wallet sees
 * @property {string} state    hex; echoed by wallets that follow NWC-08
 * @property {string} hubUrl
 * @property {number} createdAt
 */
export function createPairingRequest(kind, { hubUrl = '', now = Date.now() } = {}) {
  const key = generateSecretKey();
  return {
    id: bytesToHex(randomBytes(12)),
    kind,
    secret: bytesToHex(key),
    pubkey: getPublicKey(key),
    state: bytesToHex(randomBytes(16)),
    hubUrl,
    createdAt: now,
  };
}

/** True when the request is older than PAIRING_TTL_MS. */
export function isPairingExpired(request, now = Date.now()) {
  return !request || now - Number(request.createdAt || 0) > PAIRING_TTL_MS;
}

/**
 * The address someone typed for their Hub, as an origin plus optional path;
 * '' when it is not one. A bare host gets https. Plain http stays possible
 * for a Hub at home (nothing secret travels in this link).
 */
export function normalizeHubUrl(input) {
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
  const path = url.pathname.replace(/\/+$/, '').replace(/\/apps\/new$/i, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** The link that opens the Hub's approval page for this request. */
export function hubApprovalUrl(request, { returnUrl = RETURN_URL } = {}) {
  const params = new URLSearchParams();
  params.set('app', 'buhogo');
  params.set('name', APP_NAME);
  params.set('pubkey', request.pubkey);
  params.set('request_methods', REQUEST_METHODS.join(' '));
  params.set('notification_types', NOTIFICATION_TYPES.join(' '));
  params.set('return_to', `${returnUrl}?request=${request.id}`);
  return `${request.hubUrl || ALBY_CLOUD_URL}/apps/new?${params.toString().replace(/\+/g, '%20')}`;
}

/** The link that opens Coinos' approval page for this request. */
export function coinosApprovalUrl(request) {
  const params = new URLSearchParams({ name: APP_NAME, pubkey: request.pubkey });
  return `${COINOS.url}/apps/new?${params.toString()}`;
}

/**
 * The `nostr+walletauth://` code a wallet scans (NWC-08). Wallets that
 * follow the older draft read the same parameters and ignore `state`.
 */
export function walletAuthUri(request, { relays = HUB_RELAYS } = {}) {
  const params = new URLSearchParams();
  for (const relay of relays) params.append('relay', relay);
  params.set('state', request.state);
  params.set('name', APP_NAME);
  params.set('icon', APP_ICON);
  params.set('request_methods', REQUEST_METHODS.join(' '));
  params.set('optional_request_methods', OPTIONAL_METHODS.join(' '));
  params.set('notification_types', NOTIFICATION_TYPES.join(' '));
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

/** Coinos' connection for this request, known before it is approved. */
export function coinosConnection(request) {
  return connectionFor(request, { walletPubkey: COINOS.walletPubkey, relays: [COINOS.relay] });
}

/**
 * Read a wallet's info event as the answer to a request, or null when it
 * is not one.
 *
 * The event must name our key (`p`). A wallet that sends `state` must send
 * ours. Alby Hub sends none, so an answer without it counts only when it
 * came over one of the Hub relays; anywhere else it could be anyone's.
 * The caller has checked the signature.
 *
 * @param {object} event
 * @param {PairingRequest} request
 * @param {string} receivedOn the relay the event came from
 * @returns {{ walletPubkey: string, relays: string[] } | null}
 */
export function readWalletAnswer(event, request, receivedOn) {
  if (!event || event.kind !== WALLET_INFO_KIND) return null;
  if (!HEX_64_RE.test(String(event.pubkey || ''))) return null;
  const tags = Array.isArray(event.tags) ? event.tags : [];
  const tag = (name) => tags.filter((t) => Array.isArray(t) && t[0] === name).map((t) => String(t[1] || ''));
  if (!tag('p').includes(request.pubkey)) return null;

  const states = tag('state');
  if (states.length) {
    if (!states.includes(request.state)) return null;
  } else if (!HUB_RELAYS.includes(stripSlash(receivedOn))) {
    return null;
  }

  const announced = tag('relay').filter((relay) => RELAY_RE.test(relay));
  return {
    walletPubkey: event.pubkey.toLowerCase(),
    relays: announced.length ? announced : [stripSlash(receivedOn)],
  };
}

/**
 * What a Hub put on the return address: its relays, its wallet key, a
 * Lightning address, and our request id. Reads Alby Hub's names (`relay`,
 * `pubkey`) and NWC-08's (`relay_url`, `wallet_pubkey`).
 *
 * @param {Record<string, string|string[]>} query the route's query
 * @returns {{ requestId: string, walletPubkey: string, relays: string[], lud16: string, state: string } | null}
 */
export function readHubReturn(query) {
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
 * The in-app route for a return address a Hub opened
 * (https://go.mybuho.de/nwc/connected?…), or null for any other link.
 * Repeated parameters (several relays) stay lists.
 *
 * @param {string} url
 * @returns {{ path: string, query: Record<string, string|string[]> } | null}
 */
export function pairingReturnRoute(url) {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch {
    return null;
  }
  const home = new URL(RETURN_URL);
  if (parsed.protocol !== 'https:' || parsed.host !== home.host) return null;
  if (parsed.pathname.replace(/\/+$/, '') !== RETURN_PATH) return null;
  const query = {};
  for (const key of new Set(parsed.searchParams.keys())) {
    const values = parsed.searchParams.getAll(key);
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
