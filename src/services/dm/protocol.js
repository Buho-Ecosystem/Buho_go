/**
 * BuhoGO contact chat convention v1: build and parse rumors.
 *
 * Every chat message is a NIP-17 rumor. The BuhoGO-specific ones (payment
 * request, request status, payment) ride in an ordinary kind 14 message and
 * carry their data in tags, while `content` always holds an English fallback so
 * any other NIP-17 client shows something sensible (docs/CONTACT_CHAT.md,
 * section 4).
 *
 * Two rules shape this module:
 * - One set of validators. The builders and `parseRumor` normalise the payload
 *   through the same functions, so what we send is by construction what we
 *   accept, and a hostile peer cannot get past the parser what the builder
 *   would refuse to write. A builder throws a `DmError`; the parser turns the
 *   same failure into a degraded plain-text message that never gets a pay
 *   action.
 * - `parseRumor` never throws. Rumors come from strangers, so every field is
 *   checked before it is read.
 *
 * Pure module: no I/O, no state, nothing logged (invoices and message text are
 * private, docs section 10). Lengths count Unicode code points, so an emoji is
 * one character, as the user sees it.
 */

import { decodeBolt11 } from 'nostr-core';
import {
  KIND,
  MAX_NOTE_LENGTH,
  MAX_TEXT_LENGTH,
  PROTOCOL_VERSION,
  REQUEST_LIFETIME_SECONDS,
} from './constants.js';
import { DM_ERROR, DmError } from './errors.js';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** What a chat message is. Frozen so a typo fails loudly. */
export const MESSAGE_TYPE = Object.freeze({
  TEXT: 'text',
  REQUEST: 'request',
  STATUS: 'status',
  PAYMENT: 'payment',
  REACTION: 'reaction',
});

/** What a `status` message tells about a payment request. */
export const REQUEST_STATUS = Object.freeze({
  /** The payer paid it (optionally with the preimage as proof). */
  PAID: 'paid',
  /** The payer refuses to pay. */
  DECLINED: 'declined',
  /** The requester withdrew it. */
  CANCELLED: 'cancelled',
  /** The requester nudges the payer: still open. */
  REMINDER: 'reminder',
});

const REQUEST_STATUS_VALUES = new Set(Object.values(REQUEST_STATUS));

/** Reaction shorthands from NIP-25. */
const REACTION_SHORTHANDS = Object.freeze({ '+': '\u{1F44D}', '-': '\u{1F44E}' });

/** Longest reaction, in code points: room for a ZWJ emoji sequence, no more. */
const MAX_EMOJI_LENGTH = 64;

/** Longest `lud16` address (the RFC 5321 limit for an address). */
const MAX_LUD16_LENGTH = 320;

/**
 * Longest invoice string we hand to the decoder. A BOLT-11 invoice with many
 * route hints stays well below this; anything longer is not a payable invoice
 * and must not cost the decoder time.
 */
const MAX_BOLT11_LENGTH = 4_096;

/** One satoshi is 1,000 millisatoshis; a request or payment is in whole sats. */
const MSAT_PER_SAT = 1_000;

/** Largest amount whose msat value is still a safe integer. */
const MAX_SATS = Math.floor(Number.MAX_SAFE_INTEGER / MSAT_PER_SAT);

const HEX_64 = /^[0-9a-f]{64}$/;
const MSAT_TAG = /^[1-9][0-9]{0,15}$/;
const LUD16 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// bech32 data characters (no "1", "b", "i", "o"). An nsec is "nsec1" plus 58 of
// them (32 key bytes and the checksum). A NIP-49 ncryptsec is 91 bytes, 162
// characters in all; the open-ended lower bound tolerates other encodings.
const BECH32_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const SECRET_KEY = new RegExp(
  `nsec1[${BECH32_CHARS}]{58}|ncryptsec1[${BECH32_CHARS}]{100,}`,
  'i',
);

// ---------------------------------------------------------------------------
// Validators (shared by builders and parser)
// ---------------------------------------------------------------------------

/** Throw a DmError; the one place the module builds its errors. */
function fail(code, message, { cause, details } = {}) {
  throw new DmError(code, message, { cause, details });
}

/** Length in Unicode code points, without allocating an array for a huge string. */
function codePointLength(text) {
  let count = 0;
  for (const _ of text) count += 1; // eslint-disable-line no-unused-vars
  return count;
}

/** A 64-character lowercase hex string (pubkey, event id, preimage). */
function requireHex(value, what) {
  if (typeof value !== 'string' || !HEX_64.test(value)) {
    fail(DM_ERROR.INVALID_ARGUMENT, `${what} must be 64 lowercase hex characters`);
  }
  return value;
}

/** A positive whole number of satoshis whose msat value is a safe integer. */
function requireSats(value, what = 'amountSats') {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_SATS) {
    fail(DM_ERROR.INVALID_ARGUMENT, `${what} must be a positive safe integer`);
  }
  return value;
}

/** The `amount` tag value, a positive whole-sat number of msat as a decimal string. */
function satsToMsatTag(sats) {
  return String(sats * MSAT_PER_SAT);
}

/** Inverse of `satsToMsatTag`; refuses anything that is not a whole number of sats. */
function msatTagToSats(tagValue) {
  if (typeof tagValue !== 'string' || !MSAT_TAG.test(tagValue)) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'amount tag must be a positive integer of millisatoshis');
  }
  const msat = Number(tagValue);
  if (!Number.isSafeInteger(msat) || msat % MSAT_PER_SAT !== 0) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'amount tag must be a whole number of sats');
  }
  return requireSats(msat / MSAT_PER_SAT, 'amount tag');
}

/** A note: absent or blank becomes null, otherwise the trimmed text within its limit. */
function normalizeNote(note) {
  if (note === undefined || note === null) return null;
  if (typeof note !== 'string') fail(DM_ERROR.INVALID_ARGUMENT, 'note must be a string');
  const trimmed = note.trim();
  if (trimmed === '') return null;
  if (codePointLength(trimmed) > MAX_NOTE_LENGTH) {
    fail(DM_ERROR.MESSAGE_TOO_LARGE, `note exceeds ${MAX_NOTE_LENGTH} characters`);
  }
  return trimmed;
}

/** A Lightning address (`user@host`): absent becomes null. */
function normalizeLud16(address) {
  if (address === undefined || address === null) return null;
  if (typeof address !== 'string' || address.length > MAX_LUD16_LENGTH || !LUD16.test(address)) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'lud16 must be a Lightning address');
  }
  return address;
}

/** A `valid_until` in unix seconds: absent becomes null (a request from a client that does not send it). */
function normalizeValidUntil(seconds) {
  if (seconds === undefined || seconds === null) return null;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'valid_until must be a unix timestamp in seconds');
  }
  return seconds;
}

/** Inverse for the tag: a plain decimal string of seconds, or an error. */
function validUntilFromTag(tagValue) {
  if (tagValue === undefined) return undefined;
  if (!/^[1-9][0-9]{0,15}$/.test(tagValue)) fail(DM_ERROR.INVALID_ARGUMENT, 'valid_until tag must be unix seconds');
  return Number(tagValue);
}

/**
 * The invoice checks of docs section 4: it decodes, it is a mainnet invoice and
 * its amount equals the requested amount to the msat (a zero-amount invoice has
 * no amount and fails too, so the payer can never be made to pick a number).
 * Expiry is judged at render time, not here.
 */
function checkInvoice(bolt11, amountSats) {
  if (typeof bolt11 !== 'string' || bolt11.trim() === '' || bolt11.length > MAX_BOLT11_LENGTH) {
    fail(DM_ERROR.INVALID_INVOICE, 'invoice is missing or too long');
  }
  let invoice;
  try {
    invoice = decodeBolt11(bolt11.trim());
  } catch (cause) {
    return fail(DM_ERROR.INVALID_INVOICE, 'invoice does not decode', { cause });
  }
  if (invoice.network !== 'mainnet') {
    fail(DM_ERROR.INVALID_INVOICE, 'invoice is not a mainnet invoice');
  }
  if (invoice.amountMsat !== amountSats * MSAT_PER_SAT) {
    fail(DM_ERROR.INVALID_INVOICE, 'invoice amount does not match the requested amount');
  }
  return {
    bolt11: invoice.paymentRequest,
    paymentHash: invoice.paymentHash,
    expiresAt: invoice.expiresAt,
  };
}

/** The payload of a payment request, validated and normalised. */
function normalizeRequest({ amountSats, bolt11, note, lud16, validUntil }) {
  const sats = requireSats(amountSats);
  const invoice = checkInvoice(bolt11, sats);
  return {
    amountSats: sats,
    note: normalizeNote(note),
    bolt11: invoice.bolt11,
    paymentHash: invoice.paymentHash,
    lud16: normalizeLud16(lud16),
    expiresAt: invoice.expiresAt,
    validUntil: normalizeValidUntil(validUntil),
  };
}

/** The payload of a request status, validated and normalised. */
function normalizeStatus({ requestId, value, preimage }) {
  if (!REQUEST_STATUS_VALUES.has(value)) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'status must be paid, declined, cancelled or reminder');
  }
  const proof = preimage === undefined || preimage === null ? null : requireHex(preimage, 'preimage');
  if (proof !== null && value !== REQUEST_STATUS.PAID) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'only a paid status carries a preimage');
  }
  return { requestId: requireHex(requestId, 'requestId'), value, preimage: proof };
}

/** The payload of a payment, validated and normalised. */
function normalizePayment({ amountSats, note, preimage, requestId }) {
  return {
    amountSats: requireSats(amountSats),
    note: normalizeNote(note),
    preimage: preimage === undefined || preimage === null ? null : requireHex(preimage, 'preimage'),
    requestId: requestId === undefined || requestId === null ? null : requireHex(requestId, 'requestId'),
  };
}

/** A reaction's emoji: `+` and `-` expand to thumbs, anything else must be short and non-blank. */
function normalizeEmoji(emoji) {
  if (typeof emoji !== 'string') fail(DM_ERROR.INVALID_ARGUMENT, 'emoji must be a string');
  const trimmed = emoji.trim();
  if (trimmed === '') fail(DM_ERROR.INVALID_ARGUMENT, 'emoji must not be empty');
  if (codePointLength(trimmed) > MAX_EMOJI_LENGTH) {
    fail(DM_ERROR.INVALID_ARGUMENT, `emoji exceeds ${MAX_EMOJI_LENGTH} characters`);
  }
  return REACTION_SHORTHANDS[trimmed] ?? trimmed;
}

// ---------------------------------------------------------------------------
// Secret keys
// ---------------------------------------------------------------------------

/**
 * Whether `text` contains a Nostr secret key: a bech32 `nsec1...` (58 data
 * characters) or an encrypted `ncryptsec1...`, in any letter case and anywhere
 * in the text. The composer blocks sending when this is true, so a key pasted
 * by mistake never leaves the device. No checksum is verified: a lookalike is
 * refused too, which costs nothing.
 *
 * @param {unknown} text
 * @returns {boolean} False for anything that is not a string.
 */
export function containsSecretKey(text) {
  return typeof text === 'string' && SECRET_KEY.test(text);
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** The default clock: unix seconds. */
const unixNow = () => Math.floor(Date.now() / 1000);

/** `12000` becomes `12,000`, whatever the device locale. */
const formatSats = (sats) => sats.toLocaleString('en-US');

/** ` – <note>` only when there is a note. */
const noteSuffix = (note) => (note ? ` – ${note}` : '');

/** Shared start of every template: a valid recipient and a created_at. */
function begin(recipient, now) {
  const to = requireHex(recipient, 'recipient');
  const createdAt = typeof now === 'function' ? now() : NaN;
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'now must return unix seconds as an integer');
  }
  return { to, createdAt };
}

/** The `["e", id, "", "reply"]` tag. */
const replyTag = (id) => ['e', id, '', 'reply'];

/**
 * @typedef {object} EventTemplate
 * @property {number} kind
 * @property {string[][]} tags
 * @property {string} content
 * @property {number} created_at Unix seconds.
 */

/**
 * Build a plain text message (kind 14).
 *
 * @param {object} options
 * @param {string} options.recipient Contact pubkey, 64 lowercase hex.
 * @param {string} options.text Non-empty after trim, at most `MAX_TEXT_LENGTH`
 *   code points, and no secret key. Sent trimmed.
 * @param {string} [options.replyTo] Id of the message this answers.
 * @param {() => number} [options.now] Clock in unix seconds.
 * @returns {EventTemplate}
 * @throws {DmError} `INVALID_ARGUMENT`, `MESSAGE_TOO_LARGE` or `SECRET_KEY_IN_TEXT`.
 */
export function buildTextTemplate({ recipient, text, replyTo, now = unixNow } = {}) {
  const { to, createdAt } = begin(recipient, now);
  if (typeof text !== 'string' || text.trim() === '') {
    fail(DM_ERROR.INVALID_ARGUMENT, 'text must not be empty');
  }
  const content = text.trim();
  if (codePointLength(content) > MAX_TEXT_LENGTH) {
    fail(DM_ERROR.MESSAGE_TOO_LARGE, `text exceeds ${MAX_TEXT_LENGTH} characters`);
  }
  if (containsSecretKey(content)) {
    fail(DM_ERROR.SECRET_KEY_IN_TEXT, 'text contains a secret key');
  }
  const tags = [['p', to]];
  if (replyTo !== undefined && replyTo !== null) tags.push(replyTag(requireHex(replyTo, 'replyTo')));
  return { kind: KIND.DM, tags, content, created_at: createdAt };
}

/**
 * Build a payment request. The invoice must decode, be a mainnet invoice and
 * carry exactly the requested amount.
 *
 * @param {object} options
 * @param {string} options.recipient Contact pubkey, 64 lowercase hex.
 * @param {number} options.amountSats Positive safe integer; sent as msat.
 * @param {string} options.bolt11 The invoice the contact pays.
 * @param {string} [options.note] At most `MAX_NOTE_LENGTH` code points.
 * @param {string} [options.lud16] Lightning address of the requester. It is how
 *   the payer gets a fresh invoice once this one has expired (docs section 8a).
 * @param {number} [options.validUntil] Unix seconds the request itself stays
 *   open; defaults to `created_at` + `REQUEST_LIFETIME_SECONDS`.
 * @param {() => number} [options.now] Clock in unix seconds.
 * @returns {EventTemplate}
 * @throws {DmError} `INVALID_ARGUMENT`, `MESSAGE_TOO_LARGE` or `INVALID_INVOICE`.
 */
export function buildRequestTemplate({ recipient, amountSats, bolt11, note, lud16, validUntil, now = unixNow } = {}) {
  const { to, createdAt } = begin(recipient, now);
  const request = normalizeRequest({
    amountSats, bolt11, note, lud16, validUntil: validUntil ?? createdAt + REQUEST_LIFETIME_SECONDS,
  });
  if (request.validUntil <= createdAt) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'valid_until must lie after the request was created');
  }
  const tags = [
    ['p', to],
    ['buho', MESSAGE_TYPE.REQUEST, PROTOCOL_VERSION],
    ['amount', satsToMsatTag(request.amountSats)],
    ['bolt11', request.bolt11],
  ];
  if (request.note) tags.push(['note', request.note]);
  if (request.lud16) tags.push(['lud16', request.lud16]);
  tags.push(['valid_until', String(request.validUntil)]);
  const content =
    `\u{1F4B8} Payment request: ${formatSats(request.amountSats)} sats${noteSuffix(request.note)}` +
    `\nlightning:${request.bolt11}`;
  return { kind: KIND.DM, tags, content, created_at: createdAt };
}

/** English fallback line per status value. */
const STATUS_FALLBACK = Object.freeze({
  [REQUEST_STATUS.DECLINED]: '✖️ Declined the payment request',
  [REQUEST_STATUS.CANCELLED]: '↩️ Withdrew the payment request',
  [REQUEST_STATUS.REMINDER]: '\u{1F514} Reminder: payment request still open',
});

/**
 * Build a status message about a payment request.
 *
 * @param {object} options
 * @param {string} options.recipient Contact pubkey, 64 lowercase hex.
 * @param {string} options.requestId Rumor id of the request.
 * @param {string} options.value One of `REQUEST_STATUS`.
 * @param {string} [options.preimage] Proof of payment, only with `paid`.
 * @param {number} [options.amountSats] Only for the fallback text of `paid`
 *   ("Paid: 12,000 sats"); it is not part of the tags.
 * @param {() => number} [options.now] Clock in unix seconds.
 * @returns {EventTemplate}
 * @throws {DmError} `INVALID_ARGUMENT`.
 */
export function buildStatusTemplate({ recipient, requestId, value, preimage, amountSats, now = unixNow } = {}) {
  const { to, createdAt } = begin(recipient, now);
  const status = normalizeStatus({ requestId, value, preimage });
  const tags = [['p', to], replyTag(status.requestId), ['buho', MESSAGE_TYPE.STATUS, status.value, PROTOCOL_VERSION]];
  if (status.preimage) tags.push(['preimage', status.preimage]);
  let content = STATUS_FALLBACK[status.value];
  if (status.value === REQUEST_STATUS.PAID) {
    content =
      amountSats === undefined || amountSats === null
        ? '✅ Paid'
        : `✅ Paid: ${formatSats(requireSats(amountSats))} sats`;
  }
  return { kind: KIND.DM, tags, content, created_at: createdAt };
}

/**
 * Build a message announcing a payment the sender made. The preimage is
 * optional: when present it lets the receiver match the message to a payment
 * of its own wallet (an incoming payment message never proves anything, docs
 * section 4). Spark-to-Spark transfers, some NWC wallets and Arkade produce
 * none, and such payments must still be announced.
 *
 * @param {object} options
 * @param {string} options.recipient Contact pubkey, 64 lowercase hex.
 * @param {number} options.amountSats Positive safe integer; sent as msat.
 * @param {string} [options.preimage] 64 hex, when the wallet returned one.
 * @param {string} [options.note] At most `MAX_NOTE_LENGTH` code points.
 * @param {string} [options.requestId] Rumor id of the request this pays.
 * @param {() => number} [options.now] Clock in unix seconds.
 * @returns {EventTemplate}
 * @throws {DmError} `INVALID_ARGUMENT` or `MESSAGE_TOO_LARGE`.
 */
export function buildPaymentTemplate({ recipient, amountSats, preimage, note, requestId, now = unixNow } = {}) {
  const { to, createdAt } = begin(recipient, now);
  const payment = normalizePayment({ amountSats, note, preimage, requestId });
  const tags = [
    ['p', to],
    ['buho', MESSAGE_TYPE.PAYMENT, PROTOCOL_VERSION],
    ['amount', satsToMsatTag(payment.amountSats)],
  ];
  if (payment.note) tags.push(['note', payment.note]);
  if (payment.preimage) tags.push(['preimage', payment.preimage]);
  if (payment.requestId) tags.push(replyTag(payment.requestId));
  const content = `↗ Sent ${formatSats(payment.amountSats)} sats${noteSuffix(payment.note)}`;
  return { kind: KIND.DM, tags, content, created_at: createdAt };
}

/**
 * Build a reaction (kind 7) to a message of the conversation.
 *
 * @param {object} options
 * @param {string} options.recipient The conversation partner (NIP-17 room
 *   membership), also when reacting to one's own message.
 * @param {string} options.targetId Rumor id reacted to.
 * @param {string} options.emoji `+`, `-` or an emoji of at most 64 code points.
 * @param {() => number} [options.now] Clock in unix seconds.
 * @returns {EventTemplate}
 * @throws {DmError} `INVALID_ARGUMENT`.
 */
export function buildReactionTemplate({ recipient, targetId, emoji, now = unixNow } = {}) {
  const { to, createdAt } = begin(recipient, now);
  const target = requireHex(targetId, 'targetId');
  if (typeof emoji !== 'string') fail(DM_ERROR.INVALID_ARGUMENT, 'emoji must be a string');
  normalizeEmoji(emoji); // validation only: the wire keeps the NIP-25 shorthand as written
  return {
    kind: KIND.REACTION,
    tags: [['e', target], ['p', to], ['k', String(KIND.DM)]],
    content: emoji.trim(),
    created_at: createdAt,
  };
}

// ---------------------------------------------------------------------------
// Request lifetime
// ---------------------------------------------------------------------------

/**
 * When a payment request stops being open, in unix seconds (docs section 8a).
 * The request's lifetime, not its invoice's: an expired invoice does not end
 * the request, because the payer can pull a fresh one from the request's `lud16`.
 *
 * - `valid_until` when the sender gave one (BuhoGO: created_at + 30 days).
 * - Otherwise (other clients, messages stored before the tag existed) the
 *   same 30 days from `created_at` if the request names a `lud16`, because
 *   then a fresh invoice can be had; without one, the invoice expiry is all
 *   there is.
 *
 * @param {{ createdAt: number, request: { validUntil?: number | null, lud16?: string | null,
 *   expiresAt?: number } | null }} message A parsed (or stored) request message.
 * @returns {number | null} Null when it cannot be told (not a request).
 */
export function requestLifetimeEnd(message) {
  const request = message?.request;
  if (!request) return null;
  if (Number.isSafeInteger(request.validUntil)) return request.validUntil;
  if (request.lud16 && Number.isSafeInteger(message.createdAt)) return message.createdAt + REQUEST_LIFETIME_SECONDS;
  return Number.isFinite(request.expiresAt) ? request.expiresAt : null;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Whether `tags` is an array of arrays of strings, the only shape we read. */
function isTagList(tags) {
  return Array.isArray(tags) && tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'));
}

/** Whether `rumor` has the shape of an event we can read at all. */
function isReadableRumor(rumor) {
  return (
    typeof rumor === 'object' &&
    rumor !== null &&
    typeof rumor.id === 'string' && HEX_64.test(rumor.id) &&
    typeof rumor.pubkey === 'string' && HEX_64.test(rumor.pubkey) &&
    Number.isSafeInteger(rumor.kind) &&
    Number.isSafeInteger(rumor.created_at) &&
    typeof rumor.content === 'string' &&
    isTagList(rumor.tags)
  );
}

/** The value of the only tag called `name`; undefined when absent, an error when repeated. */
function singleTagValue(tags, name) {
  const matches = tags.filter((tag) => tag[0] === name);
  if (matches.length > 1) fail(DM_ERROR.INVALID_ARGUMENT, `tag ${name} must appear once`);
  if (matches.length === 0) return undefined;
  if (matches[0].length < 2) fail(DM_ERROR.INVALID_ARGUMENT, `tag ${name} has no value`);
  return matches[0][1];
}

/** Id of the message a rumor answers: its `e` tag marked `reply`. */
function replyTarget(tags) {
  const tag = tags.find((t) => t[0] === 'e' && t[3] === 'reply' && HEX_64.test(t[1] ?? ''));
  return tag ? tag[1] : null;
}

/**
 * The contact a rumor belongs to: the sender when it is incoming, the single
 * other `p` tag when it is outgoing. Null when the rumor is not a plain
 * one-to-one conversation of `me`: a group (another participant besides the
 * pair), a note to self, or an incoming rumor that does not address `me`.
 */
function resolvePartner(rumor, me) {
  const members = new Set(
    rumor.tags.filter((t) => t[0] === 'p' && HEX_64.test(t[1] ?? '')).map((t) => t[1]),
  );
  if (rumor.pubkey === me) {
    members.delete(me);
    return members.size === 1 ? [...members][0] : null;
  }
  if (!members.has(me)) return null;
  members.delete(me);
  members.delete(rumor.pubkey);
  return members.size === 0 ? rumor.pubkey : null;
}

/** A request whose `valid_until` is not after its own creation was never open: invalid. */
function requireLiveWindow(request, createdAt) {
  if (request.validUntil !== null && request.validUntil <= createdAt) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'valid_until must lie after the request was created');
  }
  return request;
}

/**
 * Read the `buho` payload of a kind 14 rumor with the builders' validators.
 * Returns null when the rumor has no `buho` tag (a plain message) and throws a
 * DmError for anything unknown or invalid.
 */
function readBuhoPayload(tags, createdAt) {
  const buhoTags = tags.filter((tag) => tag[0] === 'buho');
  if (buhoTags.length === 0) return null;
  if (buhoTags.length > 1) fail(DM_ERROR.INVALID_ARGUMENT, 'more than one buho tag');
  const tag = buhoTags[0];
  // The version is the last element so a type may take extra arguments later.
  if (tag.length < 3 || tag[tag.length - 1] !== PROTOCOL_VERSION) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'unknown buho version');
  }
  switch (tag[1]) {
    case MESSAGE_TYPE.REQUEST:
      if (tag.length !== 3) fail(DM_ERROR.INVALID_ARGUMENT, 'malformed buho tag');
      return {
        type: MESSAGE_TYPE.REQUEST,
        request: requireLiveWindow(normalizeRequest({
          amountSats: msatTagToSats(singleTagValue(tags, 'amount')),
          bolt11: singleTagValue(tags, 'bolt11'),
          note: singleTagValue(tags, 'note'),
          lud16: singleTagValue(tags, 'lud16'),
          validUntil: validUntilFromTag(singleTagValue(tags, 'valid_until')),
        }), createdAt),
      };
    case MESSAGE_TYPE.STATUS:
      if (tag.length !== 4) fail(DM_ERROR.INVALID_ARGUMENT, 'malformed buho tag');
      return {
        type: MESSAGE_TYPE.STATUS,
        status: normalizeStatus({
          requestId: replyTarget(tags),
          value: tag[2],
          preimage: singleTagValue(tags, 'preimage'),
        }),
      };
    case MESSAGE_TYPE.PAYMENT:
      if (tag.length !== 3) fail(DM_ERROR.INVALID_ARGUMENT, 'malformed buho tag');
      return {
        type: MESSAGE_TYPE.PAYMENT,
        payment: normalizePayment({
          amountSats: msatTagToSats(singleTagValue(tags, 'amount')),
          note: singleTagValue(tags, 'note'),
          preimage: singleTagValue(tags, 'preimage'),
          requestId: replyTarget(tags),
        }),
      };
    default:
      return fail(DM_ERROR.INVALID_ARGUMENT, 'unknown buho type');
  }
}

/**
 * @typedef {object} ChatMessage
 * @property {string} id Rumor id.
 * @property {number} kind 14 or 7.
 * @property {'text'|'request'|'status'|'payment'|'reaction'} type
 * @property {string} sender Hex pubkey.
 * @property {string} recipient Hex pubkey.
 * @property {string} partner The contact's pubkey.
 * @property {boolean} outgoing True when the sender is `me`.
 * @property {number} createdAt Unix seconds (rumor `created_at`).
 * @property {string} text Display text; the fallback content for typed and degraded messages.
 * @property {string | null} replyTo Rumor id answered, or null.
 * @property {{ amountSats: number, note: string | null, bolt11: string, paymentHash: string,
 *   lud16: string | null, expiresAt: number, validUntil: number | null } | null} request
 * @property {{ requestId: string, value: string, preimage: string | null } | null} status
 * @property {{ amountSats: number, note: string | null, preimage: string | null, requestId: string | null } | null} payment
 * @property {{ targetId: string, emoji: string } | null} reaction
 * @property {boolean} degraded True when a `buho` payload was unknown or invalid.
 */

/**
 * Turn an opened rumor into a normalised chat message. Never throws.
 *
 * - Returns null for anything that is not part of a one-to-one conversation of
 *   `me`: kinds other than 14 and 7, malformed rumors, group messages (more
 *   than one other participant), notes to self, rumors that do not address
 *   `me`, and reactions without a target.
 * - A `buho` tag with an unknown type or version, or an invalid payload (bad
 *   amount, invoice that does not match, ...), degrades to a plain `text`
 *   message with `degraded: true` and no request, status or payment data, so
 *   it never offers a pay action.
 *
 * @param {unknown} rumor A rumor from `openGiftWrap`; its authenticity is
 *   checked there, not here.
 * @param {object} context
 * @param {string} context.me Own pubkey, 64 lowercase hex.
 * @returns {ChatMessage | null}
 */
export function parseRumor(rumor, context) {
  const me = context?.me;
  if (typeof me !== 'string' || !HEX_64.test(me) || !isReadableRumor(rumor)) return null;
  if (rumor.kind !== KIND.DM && rumor.kind !== KIND.REACTION) return null;
  const partner = resolvePartner(rumor, me);
  if (partner === null) return null;

  const outgoing = rumor.pubkey === me;
  const message = {
    id: rumor.id,
    kind: rumor.kind,
    type: MESSAGE_TYPE.TEXT,
    sender: rumor.pubkey,
    recipient: outgoing ? partner : me,
    partner,
    outgoing,
    createdAt: rumor.created_at,
    text: rumor.content,
    replyTo: null,
    request: null,
    status: null,
    payment: null,
    reaction: null,
    degraded: false,
  };

  if (rumor.kind === KIND.REACTION) return parseReaction(rumor, message);

  message.replyTo = replyTarget(rumor.tags);
  try {
    const payload = readBuhoPayload(rumor.tags, rumor.created_at);
    if (payload) Object.assign(message, payload);
  } catch {
    message.degraded = true;
  }
  return message;
}

/** The reaction part of `parseRumor`; null when there is no target or no usable emoji. */
function parseReaction(rumor, message) {
  // NIP-25: the last `e` tag is the one reacted to.
  const targets = rumor.tags.filter((t) => t[0] === 'e' && HEX_64.test(t[1] ?? ''));
  if (targets.length === 0) return null;
  let emoji;
  try {
    emoji = normalizeEmoji(rumor.content);
  } catch {
    return null;
  }
  return {
    ...message,
    type: MESSAGE_TYPE.REACTION,
    text: emoji,
    reaction: { targetId: targets[targets.length - 1][1], emoji },
  };
}
