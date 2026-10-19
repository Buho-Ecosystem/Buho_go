/**
 * Keeping and watching a pairing request (utils/nwcPairing).
 *
 * One request at a time, kept encrypted with the device key: the person
 * leaves BuhoGO to approve, and on a phone the app may be closed meanwhile.
 * The request is taken exactly once, by whichever answer arrives first (the
 * return address, the wallet's info event, or the wallet knowing the
 * connection), so one approval never adds a wallet twice.
 */
import { Relay, verifyEvent } from 'nostr-core';
import { decryptString, encryptString } from '../utils/deviceCrypto.js';
import { WALLET_INFO_KIND, isPairingExpired, readWalletAnswer } from '../utils/nwcPairing.js';

const STORAGE_KEY = 'buhoGO_nwc_pairing';

/** Keep a request, replacing any earlier one. */
export async function savePairing(request, { storage = globalThis.localStorage, encrypt = encryptString } = {}) {
  storage.setItem(STORAGE_KEY, await encrypt(JSON.stringify(request)));
}

/** The kept request, or null when there is none or it has expired. */
export async function loadPairing({ storage = globalThis.localStorage, decrypt = decryptString, now = Date.now() } = {}) {
  const envelope = storage.getItem(STORAGE_KEY);
  if (!envelope) return null;
  let request = null;
  try {
    request = JSON.parse(await decrypt(envelope));
  } catch {
    request = null;
  }
  if (!request || isPairingExpired(request, now)) {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
  return request;
}

/**
 * Take the kept request with this id, once: later calls get null.
 * @returns {Promise<object|null>}
 */
export async function takePairing(id, options = {}) {
  const storage = options.storage || globalThis.localStorage;
  const request = await loadPairing(options);
  if (!request || request.id !== id) return null;
  if (storage.getItem(STORAGE_KEY) === null) return null;
  storage.removeItem(STORAGE_KEY);
  return request;
}

/** Drop the kept request (cancelled, or done). */
export function clearPairing({ storage = globalThis.localStorage } = {}) {
  storage.removeItem(STORAGE_KEY);
}

/**
 * Listen on these relays for a wallet's answer to the request: its info
 * event, addressed to our key. Calls `onAnswer` once with the wallet's key
 * and relays; a relay that cannot be reached is skipped.
 *
 * @param {object} request utils/nwcPairing PairingRequest
 * @param {string[]} relays
 * @param {(answer: { walletPubkey: string, relays: string[] }) => void} onAnswer
 * An answer without `state` counts only from these same relays, the ones
 * the wallet announces on (utils/nwcPairing readWalletAnswer).
 * @param {{ createRelay?: (url: string) => object, verify?: (event: object) => boolean }} [options]
 * @returns {() => void} stops listening
 */
export function listenForWalletAnswer(request, relays, onAnswer, { createRelay = (url) => new Relay(url, { reconnect: { enabled: true, maxAttempts: 20 } }), verify = verifyEvent } = {}) {
  let done = false;
  const open = [];
  const stop = () => {
    done = true;
    for (const relay of open.splice(0)) {
      try { relay.close(); } catch { /* already closed */ }
    }
  };
  // A Hub may have answered before we listened (the app was closed); its
  // info event is replaceable and stays on the relay, so look back a little.
  const since = Math.floor(Number(request.createdAt || Date.now()) / 1000) - 60;

  for (const url of relays) {
    const relay = createRelay(url);
    open.push(relay);
    Promise.resolve()
      .then(() => relay.connect({ timeout: 6000 }))
      .then(() => {
        if (done) return;
        relay.subscribe([{ kinds: [WALLET_INFO_KIND], '#p': [request.pubkey], since }], {
          onevent: (event) => {
            if (done || !verify(event)) return;
            const answer = readWalletAnswer(event, request, url, { statelessRelays: relays });
            if (!answer) return;
            stop();
            onAnswer(answer);
          },
        });
      })
      .catch((error) => console.warn('[nwc-pairing] relay not reachable:', url, error?.message || error));
  }
  return stop;
}

/**
 * Does the wallet behind this connection know our key (approve-known)?
 * It does once it answers `get_info`, or refuses it as not allowed or not
 * implemented (a reply only a wallet that knows the connection gives). No
 * reply, or "unauthorized" (Coinos: "unknown connection"), means not
 * approved yet.
 *
 * @param {string} connection
 * @param {{ createClient: (connection: string) => object }} options
 */
export async function walletKnowsConnection(connection, { createClient }) {
  const client = createClient(connection);
  try {
    await client.getInfo();
    return true;
  } catch (error) {
    return error?.code === 'RESTRICTED' || error?.code === 'NOT_IMPLEMENTED';
  } finally {
    try { client.close?.(); } catch { /* already closed */ }
  }
}

/**
 * Ask a connection that is known before approval (approve-known) until
 * the wallet answers, which means the person approved it. Stops on
 * `signal`.
 *
 * @param {string} connection
 * @param {{ signal: AbortSignal, ask: (connection: string) => Promise<boolean>, pauseMs?: number }} options
 * @returns {Promise<boolean>} true once the wallet answered; false when stopped
 */
export async function waitForApproval(connection, { signal, ask, pauseMs = 3000 }) {
  while (!signal.aborted) {
    if (await ask(connection).catch(() => false)) return !signal.aborted;
    if (signal.aborted) break;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, pauseMs);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
  return false;
}
