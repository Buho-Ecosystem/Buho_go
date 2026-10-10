/**
 * Seal and gift wrap one rumor for several recipients and for ourselves.
 *
 * `nostr-core`'s NIP-17 helpers wrap one message for one recipient and offer no
 * self copy (upstream issue #74, docs/CONTACT_CHAT.md section 11), so this
 * module builds on the NIP-59 primitives. A sent message must also appear in
 * our own history on every device, hence the self copy: the same rumor
 * (one id) wrapped to our own pubkey.
 *
 * Every wrap is independent: its own seal, its own ephemeral wrap key, its own
 * randomised timestamps, so relays cannot link the copies. Nothing is logged;
 * the rumor is private.
 */

import { createRumor, createSeal, createWrap, getPublicKey } from 'nostr-core';
import { MAX_RUMOR_BYTES } from './constants.js';
import { DM_ERROR, DmError } from './errors.js';

const HEX_64 = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

/**
 * @typedef {object} WrapResult
 * @property {string} recipient Pubkey the wrap is encrypted for (our own for the self copy).
 * @property {boolean} self True for the copy addressed to ourselves.
 * @property {import('nostr-core').NostrEvent} event The signed kind 1059 event to publish.
 */

/**
 * Seal and wrap one rumor for every recipient, then for ourselves.
 *
 * - The template becomes a single rumor, so all copies share one id.
 * - `recipients` is deduplicated and our own pubkey is dropped from it: the
 *   self copy is controlled by `selfCopy` alone, so we never wrap twice for
 *   ourselves.
 * - The size of the rumor's exact JSON (UTF-8 bytes) is checked against
 *   `MAX_RUMOR_BYTES` before any encryption.
 * - The result lists the recipients' wraps in input order, the self copy last.
 *
 * @param {object} params
 * @param {import('nostr-core').EventTemplate} params.template What to send
 *   (from `protocol.js`): kind, tags, content and created_at.
 * @param {Uint8Array} params.senderSecretKey Identity key; read, never kept.
 * @param {string[]} params.recipients Pubkeys, 64 lowercase hex; not empty.
 * @param {boolean} [params.selfCopy=true] Also wrap for the sender.
 * @returns {{ rumor: import('nostr-core').Rumor, wraps: WrapResult[] }}
 * @throws {DmError} `INVALID_ARGUMENT` for a bad template, key or pubkey, or a
 *   pubkey nothing can be encrypted for; `MESSAGE_TOO_LARGE` when the rumor
 *   exceeds `MAX_RUMOR_BYTES`.
 */
export function sealAndWrap({ template, senderSecretKey, recipients, selfCopy = true } = {}) {
  const fields = readTemplate(template);
  const sender = readSenderKey(senderSecretKey);
  const targets = readRecipients(recipients, sender);
  if (targets.length === 0 && !selfCopy) {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'nothing to wrap: only the sender is addressed and selfCopy is off');
  }

  const rumor = createRumor(fields, sender);
  const bytes = encoder.encode(JSON.stringify(rumor)).length;
  if (bytes > MAX_RUMOR_BYTES) {
    throw new DmError(DM_ERROR.MESSAGE_TOO_LARGE, `rumor exceeds ${MAX_RUMOR_BYTES} bytes`, {
      details: { bytes, max: MAX_RUMOR_BYTES },
    });
  }

  const wraps = targets.map((recipient) => ({
    recipient,
    self: false,
    event: wrapFor(rumor, senderSecretKey, recipient),
  }));
  if (selfCopy) {
    wraps.push({ recipient: sender, self: true, event: wrapFor(rumor, senderSecretKey, sender) });
  }
  return { rumor, wraps };
}

/** One seal and one wrap of `rumor` for `recipient`. */
function wrapFor(rumor, senderSecretKey, recipient) {
  try {
    return createWrap(createSeal(rumor, senderSecretKey, recipient), recipient);
  } catch (cause) {
    // A 64-hex string that is not a point on the curve passes the shape check
    // but cannot be encrypted for.
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'cannot encrypt for this recipient', {
      cause,
      details: { recipient },
    });
  }
}

/** The template's four fields, copied so extra properties never reach the rumor. */
function readTemplate(template) {
  const valid =
    typeof template === 'object' &&
    template !== null &&
    Number.isSafeInteger(template.kind) &&
    Number.isSafeInteger(template.created_at) &&
    typeof template.content === 'string' &&
    Array.isArray(template.tags) &&
    template.tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'));
  if (!valid) throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'template is not a valid event template');
  return {
    kind: template.kind,
    tags: template.tags.map((tag) => [...tag]),
    content: template.content,
    created_at: template.created_at,
  };
}

/** The sender's pubkey, derived from the key (which must be 32 bytes). */
function readSenderKey(secretKey) {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'senderSecretKey must be 32 bytes');
  }
  try {
    return getPublicKey(secretKey);
  } catch (cause) {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'senderSecretKey is not a valid key', { cause });
  }
}

/** Validated, deduplicated recipients without the sender. */
function readRecipients(recipients, sender) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'recipients must be a non-empty array');
  }
  for (const pubkey of recipients) {
    if (typeof pubkey !== 'string' || !HEX_64.test(pubkey)) {
      throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'every recipient must be 64 lowercase hex characters');
    }
  }
  return [...new Set(recipients)].filter((pubkey) => pubkey !== sender);
}
