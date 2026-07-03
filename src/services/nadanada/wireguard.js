/**
 * WireGuard key generation + config assembly for the nadanada VPN flow.
 *
 * nadanada's privacy model is client-side key generation: the private key
 * is generated here, on device, and NEVER sent to the server. We send only
 * the public key (and an optional preshared key) with the `/vpn/config`
 * request; the server returns a config carrying the peer (server) details,
 * and we splice our private key in locally to produce the final `.conf`.
 *
 * WireGuard keys are Curve25519 (X25519): a 32-byte private scalar and the
 * 32-byte public point, each standard-base64 encoded (44 chars). We reuse
 * the app's existing `@noble/curves` dependency rather than pulling a
 * WireGuard-specific library.
 *
 * Pure module — no network, no store — so it is fully unit-testable.
 */

import { x25519 } from '@noble/curves/ed25519.js';

/** Standard base64 of raw bytes, working in both browser (btoa) and the
 *  Node test runner (Buffer). WireGuard expects padded base64. */
function bytesToBase64(bytes) {
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  // Node fallback (used by the spec runner).
  return Buffer.from(bytes).toString('base64');
}

/** 32 cryptographically-random bytes via Web Crypto (browser + Capacitor
 *  webview) with a Node fallback for tests. */
function randomBytes32() {
  const out = new Uint8Array(32);
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(out);
    return out;
  }
  // Node test environment.
  // eslint-disable-next-line global-require
  const { webcrypto } = require('crypto');
  webcrypto.getRandomValues(out);
  return out;
}

/**
 * Generate a fresh WireGuard keypair. The public key is derived from the
 * private scalar via X25519; `getPublicKey` clamps the scalar per RFC 7748,
 * matching the reference `wg` tooling.
 *
 * @returns {{ privateKey: string, publicKey: string }} base64-encoded keys
 */
export function generateWireGuardKeypair() {
  const priv = randomBytes32();
  const pub = x25519.getPublicKey(priv);
  return {
    privateKey: bytesToBase64(priv),
    publicKey: bytesToBase64(pub),
  };
}

/**
 * Generate a WireGuard preshared key (an extra symmetric secret layered on
 * top of the handshake). nadanada's `/vpn/config` requires one whenever a
 * public key is supplied, so we always generate it alongside the keypair.
 *
 * @returns {string} base64-encoded 32-byte key
 */
export function generatePresharedKey() {
  return bytesToBase64(randomBytes32());
}

/**
 * Splice the locally-held secrets into the server-returned config so the
 * result is a complete, importable `.conf`. The server never sees the
 * private key, so its config is missing (or placeholders) the
 * `[Interface] PrivateKey`; we inject it here. The preshared key is added
 * under `[Peer]` if the server omitted it.
 *
 * Robust to three server shapes:
 *   - a `PrivateKey = ...` line already present (placeholder) -> value replaced
 *   - no PrivateKey line at all -> inserted right after `[Interface]`
 *   - PresharedKey present or absent -> ours added only when missing
 *
 * @param {string} serverConfig — raw text from `/vpn/config`
 * @param {{ privateKey: string, presharedKey?: string }} secrets
 * @returns {string} the finished WireGuard config
 */
export function assembleWireGuardConfig(serverConfig, { privateKey, presharedKey } = {}) {
  if (!privateKey) throw new Error('wireguard: privateKey required to assemble config');
  let text = String(serverConfig || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new Error('wireguard: empty server config');

  // Private key: replace an existing line (placeholder), else insert it as
  // the first line under [Interface]. `[ \t]*` (not `\s*`) so the anchors
  // never swallow newlines into the match.
  if (/^[ \t]*PrivateKey[ \t]*=.*$/im.test(text)) {
    text = text.replace(/^[ \t]*PrivateKey[ \t]*=.*$/im, `PrivateKey = ${privateKey}`);
  } else {
    text = text.replace(/(\[Interface\][ \t]*\n)/i, `$1PrivateKey = ${privateKey}\n`);
  }

  // Preshared key: append under [Peer] only when the server omitted it.
  if (presharedKey && !/^[ \t]*PresharedKey[ \t]*=.*$/im.test(text)) {
    text = text.replace(/(\[Peer\][\s\S]*?)(\n\[|$)/i, (m, peerBlock, tail) => {
      return `${peerBlock.replace(/\s*$/, '')}\nPresharedKey = ${presharedKey}${tail}`;
    });
  }

  return `${text.trim()}\n`;
}
