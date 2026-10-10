/**
 * Which recovery phrases a Drive backup payload holds, as fingerprints, so
 * an automatic upload can prove it keeps every phrase the backup on Drive
 * already has. Dropping one is only ever done by a backup the person starts.
 *
 * A fingerprint is a truncated HMAC of the normalised phrase under a fixed
 * label: stable across devices, useless for recovering the phrase, never
 * persisted or logged.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const LABEL = new TextEncoder().encode('BuhoGO backup secret fingerprint v1');

function fingerprint(kind, phrase) {
  const words = String(phrase || '').trim().toLowerCase().split(/\s+/).join(' ');
  if (!words) return null;
  return `${kind}:${bytesToHex(hmac(sha256, LABEL, new TextEncoder().encode(words))).slice(0, 32)}`;
}

/** Fingerprints of every recovery phrase in a payload (Spark, Arkade, identity). */
export function payloadSecrets(payload) {
  return [
    fingerprint('spark', payload?.spark?.mnemonic),
    fingerprint('arkade', payload?.arkade?.mnemonic),
    fingerprint('identity', payload?.identity?.mnemonic),
  ].filter(Boolean);
}

/** Phrases the remote payload holds that the new one would lose. */
export function droppedSecrets(remotePayload, nextPayload) {
  const next = new Set(payloadSecrets(nextPayload));
  return payloadSecrets(remotePayload).filter(secret => !next.has(secret));
}
