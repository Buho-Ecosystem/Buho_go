/**
 * Spam and abuse gates around opening gift wraps.
 *
 * Anyone can publish a kind 1059 event `p`-tagged to us, so what reaches the
 * inbox is untrusted. Two gates keep the cost of a hostile event low
 * (docs/CONTACT_CHAT.md sections 6 and 10):
 * - the wrap gate runs on the raw wrap, before any decryption, and only looks
 *   at things that are free to check;
 * - the rumor gate runs on the opened rumor (it needs the real sender).
 *
 * Both are `nostr-core` policy pipes, so each returns a `PolicyResult`
 * (`{ accepted, policy?, reason? }`), cheap checks first. Both are stateful
 * (duplicate memory, rate windows): create one per identity and reuse it, never
 * one per event. Nothing is logged.
 */

import { policy } from 'nostr-core';
import { KIND } from './constants.js';

/**
 * Largest `content` of a gift wrap, in characters: 87,472.
 *
 * The wrap's content is the NIP-44 payload of the seal JSON, which NIP-44 caps
 * at 65,535 bytes of plaintext. NIP-44 pads that to 65,536 bytes, then the
 * payload is version (1) + nonce (32) + length prefix (2) + padded plaintext
 * (65,536) + MAC (32) = 65,603 bytes, written in base64: ceil(65,603 / 3) * 4.
 */
const MAX_WRAP_CONTENT_CHARS = Math.ceil((1 + 32 + 2 + 65_536 + 32) / 3) * 4; // 87,472

/** NIP-59 randomises a wrap's timestamp into the past only; the future allowance is clock skew. */
const MAX_WRAP_FUTURE_SECONDS = 60 * 60;

/** Whether `value` is an array of arrays of strings. */
const isTagList = (value) =>
  Array.isArray(value) && value.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'));

/**
 * First gate of both pipes: the event has the fields the later policies read.
 * A relay (or a test) can hand over anything, and a policy that dereferences a
 * missing `tags` would throw instead of rejecting.
 */
const wellFormed = policy.customPolicy(
  'wellFormed',
  (event) =>
    typeof event === 'object' &&
    event !== null &&
    typeof event.id === 'string' &&
    typeof event.pubkey === 'string' &&
    typeof event.content === 'string' &&
    Number.isSafeInteger(event.kind) &&
    Number.isSafeInteger(event.created_at) &&
    isTagList(event.tags),
  'invalid: malformed event',
);

/**
 * The gate for a raw gift wrap, before it is decrypted: kind 1059, content no
 * larger than the largest NIP-44 payload (87,472 characters), not more than one
 * hour in the future, not past a NIP-40 expiration, and not seen before (by
 * wrap id). Past timestamps are never rejected: NIP-59 backdates wraps by up to
 * two days.
 *
 * @returns {import('nostr-core').Policy} A fresh gate with its own duplicate memory.
 */
export function createWrapGate() {
  return policy.pipe(
    [
      wellFormed,
      policy.kindAllowList([KIND.GIFT_WRAP]),
      policy.sizeLimit({ maxContentLength: MAX_WRAP_CONTENT_CHARS }),
      policy.createdAtPolicy({ maxFutureSeconds: MAX_WRAP_FUTURE_SECONDS }),
      policy.notExpired(),
      policy.noDuplicates(),
    ],
    'wrapGate',
  );
}

/** How many accepted rumor ids the rate limit remembers (same bound as `noDuplicates`). */
const RATE_MEMORY = 10_000;

/**
 * A per-sender rate limit that
 * - never applies to `me` (our own sends and self copies from other devices),
 * - charges a rumor once however many relays deliver it: the same message
 *   arrives from every relay of the inbox, and charging each delivery would
 *   throttle a sender at a third of the limit. Only a rumor the limit accepted
 *   is remembered, so a rejected one cannot slip through on its second delivery.
 */
function createSenderRate({ me, max, windowMs }) {
  const limit = policy.rateLimit({ max, windowMs });
  const charged = new Set();
  return {
    name: 'senderRate',
    async check(event) {
      if (event.pubkey === me || charged.has(event.id)) return { accepted: true };
      const result = await limit.check(event);
      if (result.accepted) {
        charged.add(event.id);
        if (charged.size > RATE_MEMORY) charged.delete(charged.values().next().value);
      }
      return result;
    },
  };
}

/**
 * The gate for an opened rumor: kind 14 or 7, sender not blocked, not past an
 * expiration, not more than an hour in the future, within the sender's rate
 * limit (if one is given), and not seen
 * before (by rumor id). `noDuplicates` is last so an event refused earlier is
 * not remembered and can still be accepted if it arrives again later.
 *
 * The inbox passes `rate` for live events only: a backfill after a long
 * absence legitimately delivers many messages from one sender at once.
 *
 * @param {object} params
 * @param {string} params.me Own pubkey; never blocked and never rate limited.
 * @param {(pubkey: string) => boolean} [params.isBlocked] Whether a sender is blocked.
 * @param {{ max: number, windowMs: number }} [params.rate] At most `max` rumors
 *   per sender per `windowMs`.
 * @returns {import('nostr-core').Policy} A fresh gate with its own memory.
 */
export function createRumorGate({ me, isBlocked = () => false, rate } = {}) {
  const policies = [
    wellFormed,
    policy.kindAllowList([KIND.DM, KIND.REACTION]),
    policy.customPolicy('notBlocked', (event) => event.pubkey === me || !isBlocked(event.pubkey), 'blocked: sender is blocked'),
    policy.notExpired(),
    // A message dated in the future would pin its thread to the top and hide
    // later messages from the unread count; clock skew gets an hour.
    policy.createdAtPolicy({ maxFutureSeconds: MAX_WRAP_FUTURE_SECONDS }),
  ];
  if (rate) policies.push(createSenderRate({ me, max: rate.max, windowMs: rate.windowMs }));
  policies.push(policy.noDuplicates());
  return policy.pipe(policies, 'rumorGate');
}
