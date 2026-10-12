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
 *
 * The seal is the identity's part (NIP-44 to the recipient, then signed), so
 * it goes through the chat signer (`dmSigner.js`): the key on this phone or
 * the person's signer app. The wrap around it uses a fresh throwaway key and
 * never needs the identity.
 */

import { createRumor, createWrap } from 'nostr-core';
import { KIND, MAX_RUMOR_BYTES } from './constants.js';
import { DM_ERROR, DmError } from './errors.js';

const HEX_64 = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
/** NIP-59: seal timestamps are randomised up to two days into the past. */
const SEAL_TIME_SPREAD_SECONDS = 2 * 24 * 60 * 60;

/**
 * @typedef {object} WrapResult
 * @property {string} recipient Pubkey the wrap is encrypted for (our own for the self copy).
 * @property {boolean} self True for the copy addressed to ourselves.
 * @property {import('nostr-core').NostrEvent} event The signed kind 1059 event to publish.
 * @property {import('nostr-core').NostrEvent} seal The signed kind 13 seal inside it; `rewrap` turns it
 *   into a fresh wrap later without the identity.
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
 * @param {Pick<import('./dmSigner.js').DmSigner, 'pubkey' | 'nip44Encrypt' | 'signEvent'>} params.signer
 *   The sender's chat signer.
 * @param {string[]} params.recipients Pubkeys, 64 lowercase hex; not empty.
 * @param {boolean} [params.selfCopy=true] Also wrap for the sender.
 * @returns {Promise<{ rumor: import('nostr-core').Rumor, wraps: WrapResult[] }>}
 * @throws {DmError} `INVALID_ARGUMENT` for a bad template, signer or pubkey, or a
 *   pubkey nothing can be encrypted for; `MESSAGE_TOO_LARGE` when the rumor
 *   exceeds `MAX_RUMOR_BYTES`; the signer's own codes (`KEY_WIPED`,
 *   `SIGNER_UNAVAILABLE`, ...) unchanged.
 */
export async function sealAndWrap({ template, signer, recipients, selfCopy = true } = {}) {
  const fields = readTemplate(template);
  const sender = readSigner(signer);
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

  const copies = targets.map((recipient) => ({ recipient, self: false }));
  if (selfCopy) copies.push({ recipient: sender, self: true });
  // In parallel: a signer app answers several requests faster than one by one.
  const sealed = await Promise.all(copies.map(({ recipient }) => wrapFor(rumor, signer, recipient)));
  return { rumor, wraps: copies.map((copy, i) => ({ ...copy, ...sealed[i] })) };
}

/**
 * A fresh gift wrap around a seal made earlier: new throwaway key, new
 * randomised timestamp, same message. Needs no signer. A wrap published long
 * after it was made can carry a timestamp older than what the recipient reads
 * (their last sync minus the two-day spread), and relays would never serve it;
 * a late delivery therefore goes out in a fresh wrap (inbox.js, outbox).
 *
 * @param {import('nostr-core').NostrEvent} seal
 * @param {string} recipient Pubkey the seal is encrypted for.
 */
export function rewrap(seal, recipient) {
  return createWrap(seal, recipient);
}

/** One seal (by the signer) and one wrap (throwaway key) of `rumor` for `recipient`. */
async function wrapFor(rumor, signer, recipient) {
  let content;
  try {
    content = await signer.nip44Encrypt(recipient, JSON.stringify(rumor));
  } catch (cause) {
    if (cause instanceof DmError) throw cause;
    // A 64-hex string that is not a point on the curve passes the shape check
    // but cannot be encrypted for.
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'cannot encrypt for this recipient', {
      cause,
      details: { recipient },
    });
  }
  const seal = await signer.signEvent({ kind: KIND.SEAL, tags: [], content, created_at: sealTimestamp() });
  if (seal?.pubkey !== signer.pubkey) throw new DmError(DM_ERROR.NO_IDENTITY, 'the seal is not signed by the sender');
  return { seal, event: createWrap(seal, recipient) };
}

function sealTimestamp() {
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * SEAL_TIME_SPREAD_SECONDS);
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

/** The sender's pubkey, from a signer that can seal. */
function readSigner(signer) {
  const usable =
    typeof signer?.pubkey === 'string' && HEX_64.test(signer.pubkey) &&
    typeof signer.nip44Encrypt === 'function' &&
    typeof signer.signEvent === 'function';
  if (!usable) throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'signer must have a pubkey, nip44Encrypt and signEvent');
  return signer.pubkey;
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
