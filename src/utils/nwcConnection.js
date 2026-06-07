/**
 * NWC (Nostr Wallet Connect / NIP-47) connection string parser.
 *
 * The same connection string can land in our hands from three places:
 *   1. The NWC setup page (manual paste or QR scan).
 *   2. The legacy IndexPage NWC scanner.
 *   3. The Settings.vue add-wallet form.
 *
 * Before this module existed, each call site used a bare
 * `startsWith('nostr+walletconnect://')` check. That had three problems:
 *
 *   • It rejected several legitimate prefix variants seen in the wild
 *     (no-slash, no-plus, web+ browser-handler, lightning: deeplink wrappers).
 *   • It was case-sensitive even though RFC 3986 §3.1 defines URI schemes
 *     as case-insensitive — `NOSTR+WALLETCONNECT://...` would be rejected.
 *   • It accepted *any* string with the right prefix, even when relay or
 *     secret were missing, so failures surfaced only at the first RPC
 *     call instead of at input time.
 *
 * `parseNwcConnection(raw)` consolidates all that: it accepts every known
 * variant, validates structurally, and returns a canonical form so the
 * rest of the app (store, provider, persistence) only ever has to see
 * one shape.
 *
 * @typedef {object} NwcParseSuccess
 * @property {true}   ok
 * @property {string} normalized   Canonical `nostr+walletconnect://…` form.
 * @property {string} pubkey       Wallet pubkey (64-char hex, lowercased).
 * @property {string} relay        Raw relay URL (case preserved).
 * @property {string} secret       Secret hex (case preserved).
 * @property {?string} lud16       Optional lightning address; null if absent.
 *
 * @typedef {object} NwcParseFailure
 * @property {false}  ok
 * @property {string} reason       One of `NwcParseReason.*`.
 */

const CANONICAL_SCHEME = 'nostr+walletconnect://';

// Strict hex check — 64 chars, hex digits only. Used for both pubkey
// and secret. Case-insensitive: hex is canonically lowercase but some
// QR generators uppercase, and we don't want to reject those.
const HEX_64_RE = /^[a-f0-9]{64}$/i;

// Relays must be WebSocket URLs per NIP-01. Accept both `wss://` (the
// near-universal default) and `ws://` (used by some local-dev setups).
const RELAY_RE = /^wss?:\/\//i;

/**
 * Discrete failure reasons. Callers map these to localised messages
 * via the i18n keys exported below — avoiding a switch on raw strings
 * scattered across pages.
 */
export const NwcParseReason = Object.freeze({
  Empty: 'empty',
  Bunker: 'bunker',
  WrongScheme: 'wrongScheme',
  ParseError: 'parseError',
  MissingPubkey: 'missingPubkey',
  InvalidPubkey: 'invalidPubkey',
  MissingRelay: 'missingRelay',
  InvalidRelay: 'invalidRelay',
  MissingSecret: 'missingSecret',
  InvalidSecret: 'invalidSecret',
});

/**
 * i18n key for each reason. Centralised here so adding a new reason
 * never requires touching every call site — pages just look up the
 * key for whatever reason came back.
 *
 * Each key is registered in src/i18n/{en-US,de,es}/index.js.
 */
export const NWC_REASON_I18N_KEYS = Object.freeze({
  [NwcParseReason.Empty]: 'NWC string is required',
  [NwcParseReason.Bunker]: 'This is a NIP-46 signer URI (bunker://), not an NWC connection.',
  [NwcParseReason.WrongScheme]: 'Not a NWC connection string',
  [NwcParseReason.ParseError]: 'Invalid connection string format',
  [NwcParseReason.MissingPubkey]: 'Missing wallet pubkey',
  [NwcParseReason.InvalidPubkey]: 'Wallet pubkey must be 64 hex characters',
  [NwcParseReason.MissingRelay]: 'Missing relay parameter',
  [NwcParseReason.InvalidRelay]: 'Relay must be a wss:// or ws:// URL',
  [NwcParseReason.MissingSecret]: 'Missing secret parameter',
  [NwcParseReason.InvalidSecret]: 'Secret must be 64 hex characters',
});

/**
 * Strip wrapping deeplink prefixes and rewrite the scheme to the
 * canonical form. The body (pubkey + query string) is left untouched
 * so the URL parser can do the structural work.
 *
 * Variants handled:
 *   nostr+walletconnect://…      canonical, no-op
 *   nostr+walletconnect:…        no authority (per NIP-47 strict reading)
 *   nostrwalletconnect://…       pre-NIP-47 historical (no `+`)
 *   nostrwalletconnect:…         same, no authority
 *   web+nostrwalletconnect://…   browser-registered protocol handler prefix
 *   web+nostrwalletconnect:…     same, no authority
 *   lightning:<any of the above> system deeplink wrapper some QRs use
 *
 * Schemes are case-insensitive per RFC 3986 §3.1, so we lowercase the
 * scheme part only. The body is preserved as-is.
 */
function normaliseInput(raw) {
  let s = String(raw || '').trim();
  if (!s) return s;

  // Strip the `lightning:` deeplink wrapper. Some QR generators wrap NWC
  // URIs in `lightning:` to route through the OS lightning handler.
  if (/^lightning:/i.test(s)) {
    s = s.slice('lightning:'.length).trim();
  }

  // Split scheme from rest at the first `:`. If there's no colon at all,
  // it can't be a URI and downstream checks will reject it cleanly.
  const colonIdx = s.indexOf(':');
  if (colonIdx === -1) return s;

  let scheme = s.slice(0, colonIdx).toLowerCase();
  const rest = s.slice(colonIdx); // includes the leading colon

  // Strip the `web+` prefix that some browsers prepend when a site
  // registers a protocol handler via navigator.registerProtocolHandler().
  if (scheme.startsWith('web+')) scheme = scheme.slice('web+'.length);

  // Collapse the no-`+` historical variant.
  if (scheme === 'nostrwalletconnect') scheme = 'nostr+walletconnect';

  s = scheme + rest;

  // Promote the no-authority form (`scheme:body`) to the authority form
  // (`scheme://body`) so `new URL` treats the body as the hostname
  // (i.e. the pubkey). Without this, URL would parse the pubkey as a
  // path component and `url.hostname` would be empty.
  if (s.startsWith('nostr+walletconnect:') && !s.startsWith('nostr+walletconnect://')) {
    s = CANONICAL_SCHEME + s.slice('nostr+walletconnect:'.length);
  }

  return s;
}

/**
 * Parse and validate an NWC connection string.
 *
 * @param {string|null|undefined} raw
 * @returns {NwcParseSuccess | NwcParseFailure}
 */
export function parseNwcConnection(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { ok: false, reason: NwcParseReason.Empty };

  // `bunker://…` is NIP-46 (remote signer), structurally similar to
  // NWC but a different protocol. Reject explicitly so we can show a
  // tailored message — users routinely confuse the two.
  if (/^bunker:/i.test(trimmed)) {
    return { ok: false, reason: NwcParseReason.Bunker };
  }

  const normalised = normaliseInput(trimmed);
  if (!normalised.startsWith(CANONICAL_SCHEME)) {
    return { ok: false, reason: NwcParseReason.WrongScheme };
  }

  // `new URL` doesn't know about the `nostr+walletconnect` scheme, so
  // swap it for `https://` purely for parsing. Doesn't affect what we
  // return — we rebuild the canonical form from the parsed parts.
  let url;
  try {
    url = new URL(normalised.replace(CANONICAL_SCHEME, 'https://'));
  } catch {
    return { ok: false, reason: NwcParseReason.ParseError };
  }

  const pubkey = url.hostname;
  if (!pubkey) return { ok: false, reason: NwcParseReason.MissingPubkey };
  if (!HEX_64_RE.test(pubkey)) return { ok: false, reason: NwcParseReason.InvalidPubkey };

  const relay = url.searchParams.get('relay');
  if (!relay) return { ok: false, reason: NwcParseReason.MissingRelay };
  if (!RELAY_RE.test(relay)) return { ok: false, reason: NwcParseReason.InvalidRelay };

  const secret = url.searchParams.get('secret');
  if (!secret) return { ok: false, reason: NwcParseReason.MissingSecret };
  if (!HEX_64_RE.test(secret)) return { ok: false, reason: NwcParseReason.InvalidSecret };

  // Some older NWC servers emit `lud16=null` as a literal string when
  // no lightning address is configured. Treat that as absent so we
  // don't persist the string "null" to wallet metadata.
  const rawLud16 = url.searchParams.get('lud16');
  const lud16 = (rawLud16 && rawLud16 !== 'null') ? rawLud16 : null;

  // Rebuild the canonical form. URLSearchParams handles encoding for us.
  const params = new URLSearchParams();
  params.set('relay', relay);
  params.set('secret', secret);
  if (lud16) params.set('lud16', lud16);

  return {
    ok: true,
    normalized: `${CANONICAL_SCHEME}${pubkey.toLowerCase()}?${params.toString()}`,
    pubkey: pubkey.toLowerCase(),
    relay,
    secret,
    lud16,
  };
}

/**
 * Boolean convenience predicate for callers that don't need the parsed
 * parts (e.g. early-return guards before opening a confirmation dialog).
 */
export function isValidNwcConnection(raw) {
  return parseNwcConnection(raw).ok;
}
