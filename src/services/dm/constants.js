/**
 * Contact chat constants.
 *
 * Every number and relay list shared by the `services/dm/` modules lives here,
 * so a protocol or product decision changes in exactly one place and each
 * value keeps the reason it exists right next to it. Pure data: no state, no
 * side effects, and the only import is the app's shared relay set.
 *
 * Contract: docs/CONTACT_CHAT.md sections 4 to 6.
 */

import { DEFAULT_RELAYS } from '../../utils/nostrRelays.js';

// ---------------------------------------------------------------------------
// Event kinds
// ---------------------------------------------------------------------------

/**
 * Nostr event kinds the contact chat reads or writes. Frozen so a typo like
 * `KIND.DM = 15` fails loudly instead of silently changing the wire format.
 */
export const KIND = Object.freeze({
  /** NIP-17 chat message. Only ever a rumor: never signed, never published as is. */
  DM: 14,
  /**
   * NIP-17 file message (other apps send photos this way). Read only: shown as
   * "sent a file" instead of vanishing; its content is a link to a file
   * encrypted with keys this app does not handle.
   */
  FILE: 15,
  /** NIP-25 reaction, also carried as a rumor so reactions are as private as messages. */
  REACTION: 7,
  /** NIP-59 seal: the rumor encrypted to the recipient and signed by the real author. */
  SEAL: 13,
  /** NIP-59 gift wrap: what relays see, signed by a throwaway key so the author stays hidden. */
  GIFT_WRAP: 1059,
  /** NIP-17 list of the relays where a person wants to receive messages. */
  DM_RELAYS: 10050,
  /** NIP-65 relay list: where a person publishes (read only, to find a 10050 kept there). */
  RELAY_LIST: 10002,
  /** NIP-51 mute list: blocked pubkeys shared with the person's other apps (muteList.js). */
  MUTE_LIST: 10000,
  /** NIP-42 client authentication event, our answer to a relay's AUTH challenge. */
  AUTH: 22242,
});

// ---------------------------------------------------------------------------
// Relays
// ---------------------------------------------------------------------------

/**
 * Relays that hold our own NIP-17 inbox, published as our kind 10050 list.
 *
 * Inbox relay choice (measured 2026-10-10 with a test wrap on 29 relays):
 * - `auth.nostr1.com` was the only free relay that hides kind 1059 from
 *   strangers and serves it after NIP-42 AUTH; it accepts writes after AUTH
 *   with any key.
 * - `nos.lol` and `relay.primal.net` accept and serve wraps without AUTH. The
 *   content stays encrypted; only "this pubkey receives wraps" is public.
 * - `relay.damus.io` and `relay.nostr.net` refuse 1059 reads but their AUTH is
 *   broken server-side ("relay needs serviceUrl to be configured"), so nothing
 *   can be read there. They also nest the prefix (`ERROR: auth-required: ...`).
 *   Revisit when they fix AUTH.
 *
 * Three different operators keep a single outage or policy change from cutting
 * off incoming money requests. These relays are separate from `DEFAULT_RELAYS`:
 * the two lists serve different purposes.
 */
export const DM_INBOX_RELAYS = Object.freeze([
  'wss://auth.nostr1.com',
  'wss://nos.lol',
  'wss://relay.primal.net',
]);

/**
 * Relays used to publish our kind 10050 list and to look up other people's.
 *
 * The shared `DEFAULT_RELAYS` already carry our profile and relay metadata, so
 * contacts' lists are often found there too. `purplepag.es` is added because
 * it is a dedicated profile and relay-list index: a stranger's list is likely
 * to be there even when it is on none of our default relays. Deduplicated, so
 * a relay named by both sources is queried once.
 */
export const DM_DISCOVERY_RELAYS = Object.freeze([
  ...new Set([...DEFAULT_RELAYS, 'wss://purplepag.es']),
]);

// ---------------------------------------------------------------------------
// Protocol and size limits
// ---------------------------------------------------------------------------

/**
 * Version of the BuhoGO convention, the last element of the `["buho", ...]`
 * tags. A string because tag values are always strings. Bumped only for a
 * change old clients cannot read; they then show the plain-text fallback.
 */
export const PROTOCOL_VERSION = '1';

/**
 * Longest text message, in characters. A chat note is a few sentences, not a
 * document (the wallet must not turn into a messenger, docs section 1), and
 * even at four bytes per character it stays far below `MAX_RUMOR_BYTES`.
 */
export const MAX_TEXT_LENGTH = 2_000;

/**
 * Longest note on a payment request or payment, in characters. A note is a
 * label ("Pizza"), not a message: it rides in the fallback line other NIP-17
 * clients show.
 */
export const MAX_NOTE_LENGTH = 200;

/** Longest LUD-21 verify URL a payment message may carry, in characters. Longer ones are dropped. */
export const MAX_VERIFY_URL_LENGTH = 1_000;

/**
 * How long a payment request stays open (30 days), counted from its
 * `created_at`; sent as the request's `valid_until` tag.
 *
 * A request is only a notice ("pay me for the pizza"): the payer's app fetches
 * the invoice when they tap Pay, so nothing in it runs out sooner. Thirty days
 * outlasts a normal payday or weekend away yet stops an old, forgotten request
 * from looking payable for ever (docs section 8a).
 */
export const REQUEST_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** A request can be reminded about once per day: a reminder is a nudge, not a stream of them. */
export const REMIND_INTERVAL_SECONDS = 24 * 60 * 60;

/**
 * Largest rumor, as UTF-8 bytes of its JSON, that may be sealed and wrapped.
 *
 * NIP-44 encrypts at most 65,535 bytes of plaintext, but the limit that binds
 * is the gift wrap's: it encrypts the seal JSON, and the seal carries the
 * NIP-44 ciphertext of the rumor in base64 (a third larger, after NIP-44 pads
 * the rumor in coarse steps). Measured with nostr-core 1.0.4, the largest
 * rumor that still fits is 40,960 bytes; the next padding step (49,152) pushes
 * the seal past 65,535 bytes, and a 60,000-byte rumor cannot be wrapped at
 * all. 40,000 keeps about 1 kB of headroom for the id and pubkey a template
 * gains when it becomes a rumor. Relays may enforce smaller event sizes; they
 * answer with a per-relay rejection, not through this cap.
 */
export const MAX_RUMOR_BYTES = 40_000;

// ---------------------------------------------------------------------------
// Timing and caching
// ---------------------------------------------------------------------------

/**
 * How far before the last sync an inbox subscription starts. NIP-59
 * randomises a wrap's `created_at` up to two days into the past so relays
 * cannot match it to the real send time; a plain `since: lastSync` would miss
 * every wrap whose random timestamp predates it. The overlap re-delivers
 * events we already hold, which are dropped by rumor id.
 */
export const SINCE_SLACK_SECONDS = 2 * 24 * 60 * 60;

/**
 * How long a contact's resolved inbox relay list is trusted. Lists change
 * rarely, so a day-old answer is almost always still right, and reusing it
 * keeps the lookup off the send path: a message goes out without waiting for
 * a relay round trip.
 */
export const INBOX_RELAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Most inbox relays used for one contact. Inbox lists are expected to name one
 * to three relays (NIP-17 guidance); a contact, or a hostile list, naming
 * dozens would make every send open that many connections, so any beyond this
 * cap are ignored.
 */
export const MAX_INBOX_RELAYS_PER_CONTACT = 5;

/**
 * How long the app may sit in the background before the in-memory identity key
 * is wiped. Long enough that a quick trip to another app does not force an
 * unlock, short enough that key bytes do not linger in memory for hours while
 * the app is out of sight.
 */
export const KEY_IDLE_WIPE_MS = 10 * 60 * 1000;

/** Local send state of an outgoing message. */
export const DELIVERY = Object.freeze({
  QUEUED: 'queued',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
});

/** Derived state of a payment request (stores/messages.js derives it, RequestCard draws it). */
export const REQUEST_STATE = Object.freeze({
  PENDING: 'pending',
  /** The user paid it and the payment is still on its way (payer side only). */
  PAYING: 'paying',
  PAID: 'paid',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});
