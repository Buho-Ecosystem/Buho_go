/**
 * Errors and relay replies for the contact chat services.
 *
 * Services never import i18n (docs/CONTACT_CHAT.md section 3), so a failure is
 * a `DmError` with a stable machine code and the UI chooses the words. The
 * second half reads NIP-01 relay replies (`OK false "blocked: ..."`,
 * `CLOSED "auth-required: ..."`) into data the transport can branch on.
 * nostr-core's `parseRelayReason` (1.0.5) is stricter: case-sensitive, no bare
 * keyword, no nested `ERROR: auth-required:`, and it throws on a missing
 * reason, so this parser stays (section 11).
 *
 * Pure module: no I/O, no state, nothing logged.
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * Machine-readable failure codes. Each value equals its key, so a code
 * survives logging and serialisation unchanged and the UI can map it straight
 * to translated copy.
 */
export const DM_ERROR = Object.freeze({
  /** A caller passed a value the function cannot work with (malformed pubkey, empty text). */
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  /** Private request records could not be durably saved; nothing new is sent. */
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  /** Text, note or rumor exceeds `MAX_TEXT_LENGTH`, `MAX_NOTE_LENGTH` or `MAX_RUMOR_BYTES`. */
  MESSAGE_TOO_LARGE: 'MESSAGE_TOO_LARGE',
  /** No BuhoGO identity exists yet, so there is nothing to sign or decrypt with. */
  NO_IDENTITY: 'NO_IDENTITY',
  /** The in-memory session key was wiped (app lock, idle timeout, identity change) and is gone. */
  KEY_WIPED: 'KEY_WIPED',
  /** The contact has not published a kind 10050 inbox relay list, so NIP-17 says not to send. */
  NO_INBOX_RELAYS: 'NO_INBOX_RELAYS',
  /** Every relay we tried refused or dropped the event, so it was delivered nowhere. */
  NO_RELAY_ACCEPTED: 'NO_RELAY_ACCEPTED',
  /** A relay could not be reached, or the connection broke before it answered. */
  RELAY_UNAVAILABLE: 'RELAY_UNAVAILABLE',
  /** NIP-42 authentication did not succeed (no usable challenge, or our answer was rejected). */
  AUTH_FAILED: 'AUTH_FAILED',
  /** A relay or lookup did not answer within its time budget. */
  TIMEOUT: 'TIMEOUT',
  /** The invoice a payer pulled for a request failed the checks (undecodable, amount mismatch, wrong network, expired). */
  INVALID_INVOICE: 'INVALID_INVOICE',
  /** The text contains an `nsec1...` or `ncryptsec1...` key, so it is never sent. */
  SECRET_KEY_IN_TEXT: 'SECRET_KEY_IN_TEXT',
  /** The profile has no Lightning address, so there is nowhere to ask money to be sent. */
  NO_PAYMENT_ADDRESS: 'NO_PAYMENT_ADDRESS',
  /** The profile's Lightning address did not answer the LNURL-pay lookup, or answered nonsense. */
  PAYMENT_ADDRESS_UNREACHABLE: 'PAYMENT_ADDRESS_UNREACHABLE',
  /**
   * The payer could not get an invoice from the requester's Lightning address:
   * unreachable, an LNURL error, or an invoice that is not for exactly the
   * requested amount. Nothing was paid.
   */
  INVOICE_FETCH_FAILED: 'INVOICE_FETCH_FAILED',
  /** The amount lies outside what the Lightning address accepts (LUD-06 min/max). */
  AMOUNT_OUT_OF_RANGE: 'AMOUNT_OUT_OF_RANGE',
  /** The identity's signer app (browser extension or remote signer) did not answer: missing, offline or too slow. */
  SIGNER_UNAVAILABLE: 'SIGNER_UNAVAILABLE',
  /** The signer app refused: the person declined, or its permissions do not allow the request. */
  SIGNER_DENIED: 'SIGNER_DENIED',
  /** The signer app cannot encrypt with NIP-44, which every chat message needs. */
  SIGNER_UNSUPPORTED: 'SIGNER_UNSUPPORTED',
});

/**
 * The identity cannot sign or decrypt right now, though the work itself is
 * fine (locked app, signer app offline, approval missing, an extension that
 * needs an update): work that hits one of these is kept, never dropped.
 */
const SIGNER_WAIT_CODES = new Set([
  DM_ERROR.KEY_WIPED,
  DM_ERROR.NO_IDENTITY,
  DM_ERROR.SIGNER_UNAVAILABLE,
  DM_ERROR.SIGNER_DENIED,
  DM_ERROR.SIGNER_UNSUPPORTED,
]);

/** Whether `err` means "the identity cannot sign or decrypt right now" (see SIGNER_WAIT_CODES). */
export const isSignerWait = (err) => err instanceof DmError && SIGNER_WAIT_CODES.has(err.code);

/** @typedef {keyof typeof DM_ERROR} DmErrorCode */

const KNOWN_CODES = new Set(Object.values(DM_ERROR));

// ---------------------------------------------------------------------------
// DmError
// ---------------------------------------------------------------------------

/**
 * The one error type the contact chat services throw or reject with.
 *
 * Branch on `code`; the UI picks its copy from it. `message` is developer text
 * for logs and never reaches the user. Neither `message` nor `details` may
 * carry keys, decrypted content or invoices (docs/CONTACT_CHAT.md section 10).
 * The underlying failure, when there is one, is the standard `cause`.
 */
export class DmError extends Error {
  /**
   * Both checks throw a TypeError on purpose: a typo in a code, or a misplaced
   * argument, then fails in the first test that reaches it instead of
   * surfacing later as an error the UI cannot map.
   *
   * @param {DmErrorCode} code One of `DM_ERROR`; anything else throws.
   * @param {string | null} [message] Developer text; defaults to the code.
   * @param {object} [options]
   * @param {unknown} [options.cause] The underlying failure, kept as `error.cause`.
   * @param {Record<string, unknown>} [options.details] Small non-secret facts for
   *   diagnostics and recovery (a relay URL, a count), kept as `error.details`.
   */
  constructor(code, message, { cause, details } = {}) {
    if (!KNOWN_CODES.has(code)) {
      throw new TypeError(`Unknown DmError code: ${String(code)}`);
    }
    if (message !== undefined && message !== null && typeof message !== 'string') {
      throw new TypeError(
        'DmError message must be a string; cause and details go in the third argument',
      );
    }
    // Only pass `cause` when there is one, so `'cause' in error` stays honest.
    super(message || code, cause === undefined ? undefined : { cause });
    this.name = 'DmError';
    this.code = code;
    this.details = details;
  }

  /**
   * True when `err` is a DmError and, if `code` is given, carries that code.
   * A predicate for catch blocks: it never throws, and an unknown `code` just
   * matches nothing.
   *
   * @param {unknown} err
   * @param {DmErrorCode} [code] Omit to match any DmError.
   * @returns {boolean}
   */
  static is(err, code) {
    return err instanceof DmError && (code === undefined || err.code === code);
  }
}

// ---------------------------------------------------------------------------
// Relay replies (NIP-01, NIP-42)
// ---------------------------------------------------------------------------

/**
 * The machine-readable prefixes a relay puts before the human text of an `OK`
 * or `CLOSED` message (`"<prefix>: <text>"`): the eight from NIP-01 plus
 * `auth-required` from NIP-42. Values are the exact lowercase strings.
 */
export const RELAY_REASON = Object.freeze({
  /** The relay already has this event. */
  DUPLICATE: 'duplicate',
  /** The relay demands more proof of work (NIP-13) than the event carries. */
  POW: 'pow',
  /** Relay policy forbids this author, event or address. */
  BLOCKED: 'blocked',
  /** Too many requests too fast; slow down. */
  RATE_LIMITED: 'rate-limited',
  /** The event is malformed or breaks a relay rule (timestamp, size, signature). */
  INVALID: 'invalid',
  /** This identity may not do that here (no write access, kind not accepted). */
  RESTRICTED: 'restricted',
  /** The sender is muted by the relay or its owner. */
  MUTE: 'mute',
  /** The relay failed internally while handling the request. */
  ERROR: 'error',
  /** NIP-42: authenticate with this relay first, then repeat the request. */
  AUTH_REQUIRED: 'auth-required',
});

const KNOWN_PREFIXES = new Set(Object.values(RELAY_REASON));

/** Refusals that can succeed later: transient, or fixed by authenticating. */
const RETRYABLE_PREFIXES = new Set([
  RELAY_REASON.RATE_LIMITED,
  RELAY_REASON.ERROR,
  RELAY_REASON.AUTH_REQUIRED,
]);

/**
 * @typedef {object} ParsedRelayReason
 * @property {string | null} prefix A value of `RELAY_REASON`, or null when the text has no
 *   known prefix.
 * @property {string} message The human-readable text without the prefix, trimmed.
 */

/**
 * Split a relay's reason text into its NIP-01 machine-readable prefix and the
 * human-readable rest: `"Rate-Limited:  slow down "` becomes
 * `{ prefix: 'rate-limited', message: 'slow down' }`.
 *
 * Relays are third parties, so this never throws and never guesses:
 * - the prefix matches case-insensitively, but only as a whole word at the very
 *   start, so `foo: bar`, `errors: x` and `unblocked: x` have no prefix;
 * - text without a known prefix comes back whole, trimmed, in `message`;
 * - a bare keyword (`duplicate`, no colon) counts as a prefix too: its meaning
 *   is unambiguous, and dropping an `auth-required` would break AUTH;
 * - anything that is not a string (a relay that omits the reason, `null`,
 *   numbers, objects) is no reason at all.
 *
 * @param {unknown} reason Third element of an `OK` or `CLOSED` message, as sent.
 * @returns {ParsedRelayReason}
 */
export function parseRelayReason(reason) {
  if (typeof reason !== 'string') return { prefix: null, message: '' };
  const text = reason.trim();
  const colon = text.indexOf(':');
  const head = (colon === -1 ? text : text.slice(0, colon)).toLowerCase();
  if (!KNOWN_PREFIXES.has(head)) return { prefix: null, message: text };
  return { prefix: head, message: colon === -1 ? '' : text.slice(colon + 1).trim() };
}

/**
 * True when a relay is asking us to authenticate (NIP-42), that is, its reason
 * has the `auth-required` prefix. The transport answers by authenticating and
 * then repeating the subscription or publish once.
 *
 * Exactly one nested level also counts: `error: auth-required: ...`. Seen live
 * on 2026-10-10 on relay.damus.io and relay.nostr.net, which answer
 * `ERROR: auth-required: requested filter requires authentication`. It is
 * still a request to authenticate, and treating it as a plain `error` would
 * retry without AUTH. Only `error` may wrap the prefix, and only once: other
 * nestings (`blocked: auth-required: ...`, `error: error: auth-required`) are
 * not requests to authenticate. `parseRelayReason` itself stays strict and
 * reports the outer prefix.
 *
 * @param {string | ParsedRelayReason | null | undefined} reason The raw reason
 *   text, or the result of `parseRelayReason`, which is not parsed again.
 * @returns {boolean}
 */
export function isAuthRequired(reason) {
  const parsed = typeof reason === 'string' ? parseRelayReason(reason) : reason;
  if (parsed?.prefix === RELAY_REASON.AUTH_REQUIRED) return true;
  if (parsed?.prefix !== RELAY_REASON.ERROR || typeof parsed.message !== 'string') return false;
  return parseRelayReason(parsed.message).prefix === RELAY_REASON.AUTH_REQUIRED;
}

/**
 * Whether repeating the same request later can succeed, given the prefix of
 * the relay's refusal (the `prefix` field of `parseRelayReason`, not the whole
 * result).
 *
 * - Retryable: `rate-limited` and `error` are transient (back off, try again).
 *   `auth-required` is retryable only after authenticating on that relay:
 *   repeating it on an unauthenticated connection fails the same way.
 * - Not retryable: `blocked`, `invalid`, `restricted`, `mute` and `pow` are
 *   decisions about this event or sender, so the answer stays the same.
 *   `duplicate` is not a failure at all: the relay already has the event,
 *   which counts as delivered (see `isDeliveredRelayReason`).
 * - A missing or unknown prefix is not retried: without a sign that the
 *   failure is transient, repeating it only hammers the relay.
 *
 * @param {string | null | undefined} prefix
 * @returns {boolean}
 */
export function isRetryableRelayReason(prefix) {
  return RETRYABLE_PREFIXES.has(prefix);
}

/**
 * Whether a relay's answer to a publish means it now holds the event: it
 * accepted it (`ok`), or it refused it as a `duplicate` because it already had
 * it. Either way the event is delivered to that relay and needs no retry.
 * Anything else, including a missing answer, is not delivered.
 *
 * @param {{ ok?: boolean, reason?: string } | null | undefined} result
 * @returns {boolean}
 */
export function isDeliveredRelayReason(result) {
  if (result?.ok === true) return true;
  return parseRelayReason(result?.reason).prefix === RELAY_REASON.DUPLICATE;
}
