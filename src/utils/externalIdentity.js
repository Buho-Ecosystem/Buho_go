/**
 * Identities brought from another app, next to the ones BuhoGO derives from
 * its 12 words. Pure helpers: parsing what the person pastes, keeping stored
 * records well-formed, and checking that a signer really answers for the
 * identity it was paired with.
 *
 * Kinds:
 *   - 'secretKey': the key itself, kept encrypted on this phone.
 *   - 'nip07':     a browser extension holds the key (web only).
 *   - 'nip46':     a remote signer holds the key (NIP-46, a `bunker://` link).
 */

import { nip19, getPublicKey, verifyEvent } from 'nostr-core';
import { npubFromHex, hexToBytes } from './identityCrypto.js';

export const EXTERNAL_KINDS = Object.freeze(['secretKey', 'nip07', 'nip46']);

const HEX_KEY_RE = /^[0-9a-f]{64}$/i;
const MAX_LABEL_LENGTH = 40;

/**
 * Read a pasted secret key: `nsec1…` or 64 hex characters.
 *
 * @param {string} input
 * @returns {{ ok: true, secretKey: Uint8Array, pubkeyHex: string, npub: string }
 *         | { ok: false, problem: 'empty' | 'public_code' | 'invalid' }}
 *   The caller owns `secretKey` and wipes it after use.
 */
export function parseSecretKeyInput(input) {
  const value = String(input || '').trim();
  if (!value) return { ok: false, problem: 'empty' };
  if (/^(npub1|nprofile1)/i.test(value)) return { ok: false, problem: 'public_code' };

  let secretKey = null;
  try {
    if (/^nsec1/i.test(value)) {
      const decoded = nip19.decode(value.toLowerCase());
      if (decoded.type === 'nsec') secretKey = decoded.data;
    } else if (HEX_KEY_RE.test(value)) {
      secretKey = hexToBytes(value.toLowerCase());
    }
  } catch {
    secretKey = null;
  }
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
    return { ok: false, problem: 'invalid' };
  }
  try {
    const pubkeyHex = getPublicKey(secretKey);
    return { ok: true, secretKey, pubkeyHex, npub: npubFromHex(pubkeyHex) };
  } catch {
    secretKey.fill(0);
    return { ok: false, problem: 'invalid' };
  }
}

/**
 * Stored records, made safe to use: known kind, a valid public key, the
 * bunker details a remote signer needs. Anything else is dropped, so a
 * damaged record can never stand in for an identity.
 *
 * @param {unknown} raw
 * @returns {Array<{ id: string, kind: string, pubkeyHex: string, npub: string,
 *   label: string, createdAt: number, nip05Handles: object[],
 *   bunker?: { remotePubkey: string, relays: string[] } }>}
 */
export function sanitizeExternalIdentities(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id)) continue;
    if (!EXTERNAL_KINDS.includes(entry.kind)) continue;
    if (typeof entry.pubkeyHex !== 'string' || !HEX_KEY_RE.test(entry.pubkeyHex)) continue;
    const record = {
      id: entry.id,
      kind: entry.kind,
      pubkeyHex: entry.pubkeyHex.toLowerCase(),
      npub: npubFromHex(entry.pubkeyHex.toLowerCase()),
      label: typeof entry.label === 'string' ? entry.label.trim().slice(0, MAX_LABEL_LENGTH) : '',
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
      nip05Handles: Array.isArray(entry.nip05Handles) ? entry.nip05Handles.map((h) => ({ ...h })) : [],
    };
    if (entry.kind === 'nip46') {
      const bunker = entry.bunker;
      const relays = Array.isArray(bunker?.relays) ? bunker.relays.filter((url) => typeof url === 'string' && /^wss:\/\//.test(url)) : [];
      if (typeof bunker?.remotePubkey !== 'string' || !HEX_KEY_RE.test(bunker.remotePubkey) || !relays.length) continue;
      record.bunker = { remotePubkey: bunker.remotePubkey.toLowerCase(), relays };
    }
    seen.add(entry.id);
    out.push(record);
  }
  return out;
}

/** Thrown when a signer answers for another key or with a bad signature. */
export class SignerMismatchError extends Error {
  constructor() {
    super('The signer answered for a different identity');
    this.code = 'SIGNER_MISMATCH';
  }
}

/**
 * Wrap a NostrCore Signer so every signed event is checked: the right
 * public key and a valid signature. A signer that switches accounts behind
 * our back is stopped here, never trusted.
 *
 * @param {import('nostr-core').Signer} signer
 * @param {string} pubkeyHex  the identity this signer was paired with
 * @returns {import('nostr-core').Signer}
 */
export function verifiedSigner(signer, pubkeyHex) {
  const expected = pubkeyHex.toLowerCase();
  return {
    async getPublicKey() {
      const key = String(await signer.getPublicKey()).toLowerCase();
      if (key !== expected) throw new SignerMismatchError();
      return key;
    },
    async signEvent(template) {
      const answer = await signer.signEvent(template);
      // A plain copy: nostr-core caches a verified mark on event objects,
      // and an answer must be checked on its content, never on a mark.
      let event;
      try {
        event = JSON.parse(JSON.stringify(answer));
      } catch {
        throw new SignerMismatchError();
      }
      if (!event || String(event.pubkey).toLowerCase() !== expected || !verifyEvent(event)) {
        throw new SignerMismatchError();
      }
      return event;
    },
    nip44: signer.nip44,
    nip04: signer.nip04,
  };
}
