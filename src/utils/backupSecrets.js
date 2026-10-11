/**
 * Which secrets a Drive backup payload holds, as fingerprints, so an
 * automatic upload can prove it keeps every secret the backup on Drive
 * already has: recovery phrases, NWC connections and LNbits keys (a wallet
 * connection may exist only in that copy). Dropping one is only ever done by
 * a backup the person starts.
 *
 * A fingerprint is a truncated HMAC of the normalised secret under a fixed
 * label: stable across devices, useless for recovering the secret, never
 * persisted or logged.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const LABEL = new TextEncoder().encode('BuhoGO backup secret fingerprint v1');

function fingerprint(kind, secret) {
  const words = String(secret || '').trim().toLowerCase().split(/\s+/).join(' ');
  if (!words) return null;
  return `${kind}:${bytesToHex(hmac(sha256, LABEL, new TextEncoder().encode(words))).slice(0, 32)}`;
}

/** Fingerprints of every secret in a payload. */
export function payloadSecrets(payload) {
  const list = (value) => (Array.isArray(value) ? value : []);
  return [
    fingerprint('spark', payload?.spark?.mnemonic),
    fingerprint('arkade', payload?.arkade?.mnemonic),
    fingerprint('identity', payload?.identity?.mnemonic),
    ...list(payload?.nwc).map((c) => fingerprint('nwc', c?.nwcUrl)),
    ...list(payload?.lnbits).map((c) => fingerprint('lnbits', c?.adminKey && `${c.serverUrl} ${c.adminKey}`)),
  ].filter(Boolean);
}

/** Secrets the remote payload holds that the new one would lose. */
export function droppedSecrets(remotePayload, nextPayload) {
  const next = new Set(payloadSecrets(nextPayload));
  return payloadSecrets(remotePayload).filter(secret => !next.has(secret));
}
