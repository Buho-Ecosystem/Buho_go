/**
 * Signers for identities whose key lives outside BuhoGO: a browser extension
 * (NIP-07) or a remote signer (NIP-46). Connections are opened on first use
 * and kept per identity, so a run of signatures does not reconnect each time.
 *
 * The caller (the identity store) owns pairing records and secrets; this
 * module only holds live connections. A connection signs every request with
 * this app's pairing key, so it gets a copy of its own, wiped when it closes;
 * the caller wipes its copy whenever it likes.
 */

import { Nip07Signer, NostrConnect, parseConnectionURI, generateSecretKey } from 'nostr-core';

/** How long a remote signer may take to approve the pairing. */
const BUNKER_CONNECT_TIMEOUT_MS = 60_000;
/** How long one request (sign, encrypt) may wait for approval. */
export const BUNKER_REQUEST_TIMEOUT_MS = 60_000;

/**
 * What a remote signer is asked to allow when it pairs, so it can approve
 * these once instead of on every request (NIP-46 `connect` permissions).
 * One entry per thing BuhoGO asks the signer to do.
 */
export const BUNKER_PERMISSIONS = [
  'nip44_encrypt', // chat seals, contacts doc, mute list
  'nip44_decrypt', // received messages, contacts doc, mute list
  'sign_event:0', // profile
  'sign_event:10002', // relay list
  'sign_event:24242', // avatar upload (Blossom)
  'sign_event:30078', // contacts doc
  'sign_event:13', // chat seal
  'sign_event:22242', // relay sign-in (NIP-42 AUTH)
  'sign_event:10050', // chat relay list
  'sign_event:10000', // mute list
].join(',');

/** @type {Map<string, NostrConnect>} identity id -> live remote signer */
const bunkers = new Map();
/** @type {Map<string, Promise<NostrConnect>>} identity id -> reconnect under way */
const reconnecting = new Map();
/** @type {WeakMap<NostrConnect, Uint8Array>} connection -> its copy of the pairing key */
const pairingKeys = new WeakMap();

/** @type {Set<(url: string) => void>} */
const approvalListeners = new Set();

/**
 * Listen for a remote signer that wants the person to approve a request on
 * its own page (NIP-46 `auth_url`). The request keeps waiting meanwhile.
 *
 * @param {(url: string) => void} listener  gets the page's https URL
 * @returns {() => void} stops listening
 */
export function onSignerApproval(listener) {
  approvalListeners.add(listener);
  return () => approvalListeners.delete(listener);
}

/**
 * The approval page a signer named, when it is safe to open: https only and
 * no credentials in it. Any other link (intent:, javascript:, a typo) is null.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function approvalUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url.href;
}

function announceApproval(raw) {
  const url = approvalUrl(raw);
  if (!url) return;
  for (const listener of approvalListeners) {
    try {
      listener(url);
    } catch { /* a listener must not break the signer's relay subscription */ }
  }
}

/** A browser extension that can sign is present (web only). */
export function hasExtensionSigner() {
  return typeof window !== 'undefined' && !!window.nostr && typeof window.nostr.signEvent === 'function';
}

/** The extension as a NostrCore Signer. Throws when none is present. */
export function extensionSigner() {
  return new Nip07Signer();
}

function openBunker({ remotePubkey, relays, clientKey, secret }) {
  const ownKey = clientKey.slice();
  const connection = new NostrConnect({
    remotePubkey, relayUrls: relays, secretKey: ownKey, secret, perms: BUNKER_PERMISSIONS,
  });
  pairingKeys.set(connection, ownKey);
  connection.timeout = BUNKER_REQUEST_TIMEOUT_MS;
  connection.handshakeTimeout = BUNKER_CONNECT_TIMEOUT_MS;
  connection.onauthurl = announceApproval;
  return connection;
}

/** Close a remote signer connection and wipe its pairing key. */
export function closeBunker(connection) {
  if (!connection) return;
  connection.close();
  pairingKeys.get(connection)?.fill(0);
}

async function connectOrClose(connection) {
  try {
    await connection.connect();
  } catch (err) {
    closeBunker(connection);
    throw err;
  }
}

/**
 * Pair with a remote signer from its `bunker://` link. Resolves once the
 * signer approved the connection and named its public key.
 *
 * @param {string} uri
 * @returns {Promise<{ connection: NostrConnect, pubkeyHex: string,
 *   bunker: { remotePubkey: string, relays: string[] }, clientKey: Uint8Array }>}
 */
export async function pairBunker(uri) {
  const link = String(uri || '').trim();
  let parsed = null;
  try {
    if (link.startsWith('bunker://')) parsed = parseConnectionURI(link);
  } catch { /* reported below */ }
  if (!parsed?.remotePubkey || !/^[0-9a-f]{64}$/i.test(parsed.remotePubkey)) {
    const err = new Error('Not a remote signer link');
    err.code = 'BUNKER_INVALID_LINK';
    throw err;
  }
  const relays = (parsed.relayUrls || []).filter((url) => /^wss:\/\//.test(url));
  if (!relays.length) {
    const err = new Error('The link names no secure relay');
    err.code = 'BUNKER_INVALID_LINK';
    throw err;
  }
  const clientKey = generateSecretKey();
  const connection = openBunker({ remotePubkey: parsed.remotePubkey, relays, clientKey, secret: parsed.secret });
  await connectOrClose(connection);
  const pubkeyHex = String(await connection.getPublicKey()).toLowerCase();
  return { connection, pubkeyHex, bunker: { remotePubkey: parsed.remotePubkey.toLowerCase(), relays }, clientKey };
}

/** Keep a freshly paired connection for the identity it now belongs to. */
export function adoptBunker(id, connection) {
  const live = bunkers.get(id);
  if (live !== connection) closeBunker(live);
  bunkers.set(id, connection);
}

/**
 * The live remote signer for a paired identity, reconnecting when needed.
 * Callers that ask at the same time share one reconnect, so the signer sees
 * one connection (and one approval prompt), not one per caller.
 *
 * @param {string} id
 * @param {{ remotePubkey: string, relays: string[] }} bunker
 * @param {() => Promise<Uint8Array>} loadClientKey  this app's side of the pairing
 */
export function bunkerSigner(id, bunker, loadClientKey) {
  const live = bunkers.get(id);
  if (live?.connected) return Promise.resolve(live);
  if (!reconnecting.has(id)) {
    reconnecting.set(id, reconnect(id, bunker, loadClientKey).finally(() => reconnecting.delete(id)));
  }
  return reconnecting.get(id);
}

async function reconnect(id, bunker, loadClientKey) {
  closeBunker(bunkers.get(id));
  bunkers.delete(id);
  const clientKey = await loadClientKey();
  let connection;
  try {
    connection = openBunker({ ...bunker, clientKey });
  } finally {
    clientKey.fill(0);
  }
  await connectOrClose(connection);
  bunkers.set(id, connection);
  return connection;
}

/**
 * Close and forget a remote signer connection (disconnect, erase).
 * @returns {Promise<void>} settles once it is closed; nobody has to wait
 */
export function closeSigner(id) {
  const live = bunkers.get(id);
  if (!live) return Promise.resolve();
  bunkers.delete(id);
  return Promise.resolve(live.disconnect?.()).catch(() => {}).finally(() => closeBunker(live));
}
