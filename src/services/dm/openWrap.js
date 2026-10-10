/**
 * Open a received NIP-59 gift wrap, with a precise reason for every failure.
 *
 * `nostr-core`'s `unwrap` throws one generic error and trusts the rumor's id
 * (upstream issue #73, docs/CONTACT_CHAT.md section 11): a peer could send a
 * rumor whose `id` does not hash to its content and have it accepted under
 * that id. This module therefore walks the same steps on the `nip44`
 * primitives, checks each one and reports which failed, so the inbox can tell
 * a message not meant for us from a forgery. Every check runs on data a
 * stranger chose, and none of it may throw: the result is always a value.
 *
 * Nothing is logged; the decrypted rumor is private.
 */

import { getEventHash, nip44, verifyEventSignature } from 'nostr-core';
import { KIND } from './constants.js';

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;

/**
 * Why a wrap could not be opened. Frozen; each value equals its key in
 * lowercase-kebab form, the string the caller sees in `reason`.
 */
export const OPEN_FAILURE = Object.freeze({
  /** Not a kind 1059 event. */
  NOT_GIFT_WRAP: 'not-gift-wrap',
  /** Not addressed to us: no matching `p` tag on the wrap, or on the rumor. */
  NOT_ADDRESSED: 'not-addressed',
  /** The wrap or the seal does not decrypt with our key (corrupt, or another recipient). */
  UNDECRYPTABLE: 'undecryptable',
  /** The seal is not a well-formed, correctly signed kind 13 event without tags. */
  INVALID_SEAL: 'invalid-seal',
  /** The rumor is not a well-formed unsigned event. */
  INVALID_RUMOR: 'invalid-rumor',
  /** The seal's signer is not the rumor's author: someone speaks in another's name. */
  IMPERSONATION: 'impersonation',
  /** The rumor's id is not the hash of its content (upstream #73). */
  ID_MISMATCH: 'id-mismatch',
});

/**
 * @typedef {'not-gift-wrap'|'not-addressed'|'undecryptable'|'invalid-seal'|'impersonation'|'invalid-rumor'|'id-mismatch'} OpenFailureReason
 */

const failure = (reason) => ({ ok: false, reason });

/** An array of arrays of strings: the only shape of Nostr tags. */
function isTagList(tags) {
  return Array.isArray(tags) && tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'));
}

/** Whether some `p` tag names `pubkey`. */
const addresses = (tags, pubkey) => tags.some((tag) => tag[0] === 'p' && tag[1] === pubkey);

/** Decrypt NIP-44 `payload` from `peerPubkey` and parse the JSON; null on any failure. */
function decryptJson(payload, secretKey, peerPubkey) {
  try {
    const plaintext = nip44.decrypt(payload, nip44.getConversationKey(secretKey, peerPubkey));
    const value = JSON.parse(plaintext);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Whether `seal` is a kind 13 event with an empty tag list and a valid id and signature. */
function isValidSeal(seal) {
  const shaped =
    seal.kind === KIND.SEAL &&
    typeof seal.id === 'string' && HEX_64.test(seal.id) &&
    typeof seal.pubkey === 'string' && HEX_64.test(seal.pubkey) &&
    typeof seal.sig === 'string' && HEX_128.test(seal.sig) &&
    typeof seal.content === 'string' &&
    Number.isSafeInteger(seal.created_at) &&
    Array.isArray(seal.tags) && seal.tags.length === 0;
  if (!shaped) return false;
  try {
    return verifyEventSignature(seal) === true;
  } catch {
    return false;
  }
}

/** Whether `rumor` has the shape of an unsigned event. */
function isRumorShape(rumor) {
  return (
    typeof rumor.id === 'string' && HEX_64.test(rumor.id) &&
    typeof rumor.pubkey === 'string' && HEX_64.test(rumor.pubkey) &&
    Number.isSafeInteger(rumor.kind) &&
    Number.isSafeInteger(rumor.created_at) &&
    typeof rumor.content === 'string' &&
    isTagList(rumor.tags)
  );
}

/**
 * Open a gift wrap addressed to us.
 *
 * Checks, in this order, stopping at the first failure:
 * 1. kind 1059 (`not-gift-wrap`);
 * 2. the wrap has a `p` tag equal to `me` (`not-addressed`);
 * 3. the wrap decrypts with our key (`undecryptable`);
 * 4. the seal is kind 13, well-formed, tagless and correctly signed
 *    (`invalid-seal`);
 * 5. the seal decrypts (`undecryptable`);
 * 6. the rumor is a well-formed event (`invalid-rumor`);
 * 7. the rumor's author is the seal's signer (`impersonation`);
 * 8. the rumor's id is the hash of its content (`id-mismatch`);
 * 9. the rumor addresses `me`, or `me` wrote it (`not-addressed`).
 *
 * @param {unknown} event The kind 1059 event as received from a relay.
 * @param {Uint8Array} recipientSecretKey Our identity key; read, never kept.
 * @param {object} context
 * @param {string} context.me Our pubkey, 64 lowercase hex.
 * @returns {{ ok: true, rumor: import('nostr-core').Rumor, sender: string }
 *   | { ok: false, reason: OpenFailureReason }} `sender` is the verified author
 *   of the rumor. Never throws.
 */
export function openGiftWrap(event, recipientSecretKey, context) {
  try {
    const me = context?.me;
    if (typeof event !== 'object' || event === null || event.kind !== KIND.GIFT_WRAP) {
      return failure(OPEN_FAILURE.NOT_GIFT_WRAP);
    }
    if (typeof me !== 'string' || !isTagList(event.tags) || !addresses(event.tags, me)) {
      return failure(OPEN_FAILURE.NOT_ADDRESSED);
    }

    const seal = typeof event.pubkey === 'string' && typeof event.content === 'string'
      ? decryptJson(event.content, recipientSecretKey, event.pubkey)
      : null;
    if (seal === null) return failure(OPEN_FAILURE.UNDECRYPTABLE);
    if (!isValidSeal(seal)) return failure(OPEN_FAILURE.INVALID_SEAL);

    const rumor = decryptJson(seal.content, recipientSecretKey, seal.pubkey);
    if (rumor === null) return failure(OPEN_FAILURE.UNDECRYPTABLE);
    if (!isRumorShape(rumor)) return failure(OPEN_FAILURE.INVALID_RUMOR);
    if (rumor.pubkey !== seal.pubkey) return failure(OPEN_FAILURE.IMPERSONATION);
    if (getEventHash(rumor) !== rumor.id) return failure(OPEN_FAILURE.ID_MISMATCH);
    if (rumor.pubkey !== me && !addresses(rumor.tags, me)) return failure(OPEN_FAILURE.NOT_ADDRESSED);

    return {
      ok: true,
      rumor: {
        id: rumor.id,
        pubkey: rumor.pubkey,
        kind: rumor.kind,
        created_at: rumor.created_at,
        tags: rumor.tags,
        content: rumor.content,
      },
      sender: rumor.pubkey,
    };
  } catch {
    // Unreachable for well-typed input, kept so a hostile event can never throw
    // out of the inbox loop. The safest reading of an unforeseen failure is
    // that the wrap cannot be opened.
    return failure(OPEN_FAILURE.UNDECRYPTABLE);
  }
}
