/**
 * Inbox relay lists (NIP-17 kind 10050): publish ours, discover theirs.
 *
 * NIP-17 says a message goes to the relays its recipient listed in their kind
 * 10050 event, and to nowhere else, so every send first needs that list. The
 * lookup is therefore a small service of its own: it asks several relays in
 * parallel, trusts only a correctly signed list by the right author, remembers
 * the answer so a send does not wait for a relay round trip, and tells apart
 * "this person has no list" (do not send) from "we could not find out" (try
 * again later), which `pool.querySync` cannot do because it returns an empty
 * array for both. That is why the resolver runs its own per-relay query.
 *
 * Everything the resolver touches comes in as an argument (`ensureRelay`, the
 * clock, the timers), so it runs in tests without network. No Vue, Pinia or
 * i18n; nothing is logged. Relay lists are third-party input and every value
 * read from one is validated before it is used.
 *
 * Contract: docs/CONTACT_CHAT.md section 6 (`inboxRelays.js`).
 */

import { getDeliveryRelayFilter, normalizeURL, verifyEventSignature } from 'nostr-core';
import {
  DM_DISCOVERY_RELAYS,
  INBOX_RELAY_CACHE_TTL_MS,
  KIND,
  MAX_INBOX_RELAYS_PER_CONTACT,
} from './constants.js';
import { DM_ERROR, DmError } from './errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How long a "this contact has no inbox relay list" answer is trusted: 30
 * minutes. A missing list is often temporary (the contact has not opened a
 * NIP-17 capable client yet, or is about to publish one), so it is retried far
 * sooner than a found list; but not on every send, or a contact with no list
 * would cost a round of relay queries per message attempt.
 */
export const INBOX_RELAY_MISSING_TTL_MS = 30 * 60 * 1000;

/**
 * Default time budget for one relay to connect and answer: long enough for a
 * slow mobile connection, short enough that one dead relay never holds up a
 * lookup that the others already answered.
 */
export const INBOX_RELAY_QUERY_TIMEOUT_MS = 5_000;

/** Longest relay URL accepted from a list; real URLs are far shorter. */
const MAX_RELAY_URL_LENGTH = 256;

/** Version of the `snapshot()` format, so a later change can migrate or drop old data. */
const SNAPSHOT_VERSION = 1;

const HEX_PUBKEY = /^[0-9a-f]{64}$/;

/** Outcomes of a lookup. */
export const INBOX_STATUS = Object.freeze({
  /** A valid list with at least one relay was found. */
  FOUND: 'found',
  /** At least one relay answered and none had a usable list: do not send. */
  MISSING: 'missing',
  /** No relay answered, so nothing is known; never cached. */
  UNKNOWN: 'unknown',
});

// ---------------------------------------------------------------------------
// URL and list helpers
// ---------------------------------------------------------------------------

/**
 * IPv4 ranges a relay URL may never point at: "this network", private, shared
 * (CGNAT), loopback, link-local, benchmarking, and multicast plus reserved.
 * Each entry is [first address, prefix length].
 */
const BLOCKED_IPV4 = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

/** Host name suffixes that never resolve to a public relay. */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.onion'];

function isBlockedIpv4(octets) {
  const value = octets.reduce((acc, octet) => acc * 256 + octet, 0);
  return BLOCKED_IPV4.some(([base, bits]) => {
    const start = base.reduce((acc, octet) => acc * 256 + octet, 0);
    const size = 2 ** (32 - bits);
    return value >= start && value < start + size;
  });
}

/** Expand a normalised IPv6 literal (no brackets) into 8 numeric groups, or null. */
function parseIpv6(text) {
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part) => (part === '' ? [] : part.split(':').map((g) => parseInt(g, 16)));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill(0), ...tail];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

function isBlockedIpv6(groups) {
  const embedded = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
  // :: and ::1, plus the deprecated IPv4-compatible ::a.b.c.d form.
  if (groups.slice(0, 6).every((g) => g === 0)) return true;
  // fc00::/7 unique local, fe80::/10 link-local.
  if ((groups[0] & 0xfe00) === 0xfc00 || (groups[0] & 0xffc0) === 0xfe80) return true;
  // IPv4-mapped ::ffff:a.b.c.d, and NAT64 64:ff9b::/96, carry an IPv4 address.
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0);
  return (mapped || nat64) && isBlockedIpv4(embedded);
}

/**
 * True when `hostname` (as `new URL(...).hostname` gives it) may be used as an
 * inbox relay host. Inbox lists and relay hints come from other people, so a
 * hostile kind 10050 list could otherwise make the app open sockets to
 * `localhost`, a router or a printer: SSRF-style probing of the user's own
 * network. Blocked: `localhost` and `*.localhost`, `*.local`, `*.internal`,
 * `.onion` (unreachable from the app), single-label names, IPv4 literals in
 * loopback, private, shared, link-local, benchmarking, multicast and reserved
 * ranges, and IPv6 `::`, `::1`, unique-local, link-local and IPv4-mapped or
 * NAT64 forms of those IPv4 ranges. WHATWG URL parsing has already turned
 * decimal, hex and octal IPv4 spellings into dotted form before this runs.
 *
 * @param {string} hostname Hostname as produced by the URL parser (IPv6 in brackets).
 * @returns {boolean}
 */
export function isPublicRelayHost(hostname) {
  if (typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  if (host === '') return false;
  if (host.startsWith('[') && host.endsWith(']')) {
    const groups = parseIpv6(host.slice(1, -1));
    return groups !== null && !isBlockedIpv6(groups);
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return !isBlockedIpv4(v4.slice(1).map(Number));
  if (!host.includes('.') || host === 'localhost') return false;
  return !BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Normalise a relay URL for storage and comparison, or return null when it is
 * not acceptable. Only `wss://` is accepted (no clear-text `ws://`, no other
 * scheme, no scheme-less host), without credentials, with a host, and of sane
 * length, and a public host (see `isPublicRelayHost`). The result is `nostr-core`'s `normalizeURL` form (lowercase host,
 * default port and fragment dropped, trailing slash on a bare host), the same
 * key the relay pool uses, so equal relays compare equal.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeInboxRelayUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_RELAY_URL_LENGTH) return null;
  if (!/^wss:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'wss:' || !isPublicRelayHost(url.hostname) || url.username || url.password) return null;
    return normalizeURL(text);
  } catch {
    return null;
  }
}

/** Normalise, drop invalid entries and duplicates, keep order. */
function normalizeUnique(values) {
  const seen = new Set();
  for (const value of values) {
    const url = normalizeInboxRelayUrl(value);
    if (url) seen.add(url);
  }
  return [...seen];
}

/**
 * Build the unsigned kind 10050 event that publishes our inbox relays. The
 * caller signs and publishes it. Replaceable: the newest list replaces older
 * ones on the relays.
 *
 * @param {readonly string[]} relays `wss://` URLs; duplicates are merged.
 * @param {object} [options]
 * @param {number} [options.now] Unix time in SECONDS (the Nostr `created_at`
 *   unit); defaults to the current time.
 * @returns {{ kind: number, created_at: number, tags: string[][], content: string }}
 * @throws {DmError} INVALID_ARGUMENT for a non-array, an invalid URL, an empty
 *   list or more than `MAX_INBOX_RELAYS_PER_CONTACT` distinct relays.
 */
export function buildInboxRelayListTemplate(relays, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (!Array.isArray(relays)) {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'relays must be an array');
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'now must be a non-negative integer of seconds');
  }
  const urls = [];
  for (const relay of relays) {
    const url = normalizeInboxRelayUrl(relay);
    if (!url) {
      throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'relay must be a valid wss:// URL');
    }
    if (!urls.includes(url)) urls.push(url);
  }
  if (urls.length === 0) {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'at least one relay is required');
  }
  if (urls.length > MAX_INBOX_RELAYS_PER_CONTACT) {
    throw new DmError(
      DM_ERROR.INVALID_ARGUMENT,
      `at most ${MAX_INBOX_RELAYS_PER_CONTACT} relays are allowed`,
      { details: { count: urls.length } },
    );
  }
  return {
    kind: KIND.DM_RELAYS,
    created_at: now,
    tags: urls.map((url) => ['relay', url]),
    content: '',
  };
}

/**
 * Read the relays out of a kind 10050 event. Never throws, whatever the
 * event looks like. Only `["relay", url]` tags count; invalid URLs are
 * skipped, duplicates merged, and the result is capped at
 * `MAX_INBOX_RELAYS_PER_CONTACT` (the first valid ones win). This does not
 * check the signature or author: the resolver does that before it calls this.
 *
 * @param {unknown} event
 * @returns {string[]} Normalised `wss://` URLs; empty for anything unusable.
 */
export function parseInboxRelayList(event) {
  try {
    if (!event || typeof event !== 'object' || event.kind !== KIND.DM_RELAYS) return [];
    if (!Array.isArray(event.tags)) return [];
    const candidates = [];
    for (const tag of event.tags) {
      if (Array.isArray(tag) && tag[0] === 'relay') candidates.push(tag[1]);
    }
    return normalizeUnique(candidates).slice(0, MAX_INBOX_RELAYS_PER_CONTACT);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/** True when `candidate` should replace `best`: newer, or same age and lower id. */
function isBetter(candidate, best) {
  if (!best) return true;
  if (candidate.created_at !== best.created_at) return candidate.created_at > best.created_at;
  return candidate.id < best.id;
}

/**
 * Ask one relay for a pubkey's list. Never rejects.
 *
 * `answered` is true only when the relay sent EOSE: it then told us what it
 * has, even if that is nothing. A refusal (`CLOSED`), a connection failure or
 * silence until the timeout is not an answer. Whatever valid event arrived
 * before is kept either way, because a signed list is good evidence on its own.
 *
 * @returns {Promise<{ answered: boolean, event: object | null }>}
 */
function queryRelay({ ensureRelay, url, pubkey, timeoutMs, setTimer, clearTimer }) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    let sub = null;
    let best = null;

    const closeSub = () => {
      if (!sub) return;
      const current = sub;
      sub = null;
      try {
        current.close();
      } catch {
        // A relay that fails while closing has nothing more to tell us.
      }
    };
    const finish = (answered) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      closeSub();
      resolve({ answered, event: best });
    };
    const onevent = (event) => {
      if (settled || !event || typeof event !== 'object') return;
      if (event.kind !== KIND.DM_RELAYS || event.pubkey !== pubkey) return;
      if (!isBetter(event, best)) return;
      // Verify only a candidate that could win: the signature is the costly part.
      if (!Number.isSafeInteger(event.created_at) || typeof event.id !== 'string') return;
      let valid = false;
      try {
        valid = verifyEventSignature(event) === true;
      } catch {
        valid = false;
      }
      if (valid) best = event;
    };

    timer = setTimer(() => finish(false), timeoutMs);

    let connecting;
    try {
      connecting = Promise.resolve(ensureRelay(url, { connectionTimeout: timeoutMs }));
    } catch {
      finish(false);
      return;
    }
    connecting.then(
      (relay) => {
        if (settled) return;
        try {
          const filter = { ...getDeliveryRelayFilter([pubkey]), limit: 1 };
          sub = relay.subscribe([filter], {
            onevent,
            oneose: () => finish(true),
            onclose: () => finish(false),
          });
        } catch {
          finish(false);
          return;
        }
        // The relay may have answered before `subscribe` returned.
        if (settled) closeSub();
      },
      () => finish(false),
    );
  });
}

/**
 * @typedef {object} InboxRelayResult
 * @property {'found' | 'missing' | 'unknown'} status
 * @property {string[]} relays Inbox relays; empty unless `status` is `found`.
 * @property {number} checkedAt Milliseconds (from the injected clock) when the lookup finished.
 */

/**
 * Create a resolver for contacts' inbox relay lists.
 *
 * Statuses:
 * - `found`: the newest valid list names at least one usable relay. Cached
 *   `ttlMs`.
 * - `missing`: at least one relay answered (EOSE) and none produced a usable
 *   list, or the newest list is empty. NIP-17 then says not to send. Cached
 *   `missingTtlMs`, much shorter, because the contact may publish one soon.
 * - `unknown`: no relay answered at all (offline, all down). Not a fact about
 *   the contact, so it is never cached and the next call asks again.
 *
 * Only events of kind 10050, authored by the pubkey asked about, with a valid
 * signature are considered; the newest `created_at` wins and a tie goes to the
 * lowest id, so every client picks the same list. Concurrent lookups for one
 * pubkey share a single query, `force` included.
 *
 * @param {object} options
 * @param {(url: string, opts: { connectionTimeout: number }) => Promise<{
 *   subscribe: Function }>} options.ensureRelay Connects to a relay, like
 *   `RelayPool.ensureRelay`; its `subscribe(filters, { onevent, oneose, onclose })`
 *   returns an object with `close()`.
 * @param {readonly string[]} [options.discoveryRelays] Relays asked for every lookup.
 * @param {number} [options.ttlMs] How long `found` is trusted.
 * @param {number} [options.missingTtlMs] How long `missing` is trusted.
 * @param {number} [options.timeoutMs] Per-relay time budget (connect plus answer).
 * @param {() => number} [options.now] Clock in milliseconds.
 * @param {typeof setTimeout} [options.setTimer] Injected for tests.
 * @param {typeof clearTimeout} [options.clearTimer] Injected for tests.
 */
export function createInboxRelayResolver({
  ensureRelay,
  discoveryRelays = DM_DISCOVERY_RELAYS,
  ttlMs = INBOX_RELAY_CACHE_TTL_MS,
  missingTtlMs = INBOX_RELAY_MISSING_TTL_MS,
  timeoutMs = INBOX_RELAY_QUERY_TIMEOUT_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof ensureRelay !== 'function') {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'ensureRelay must be a function');
  }
  const discovery = normalizeUnique(discoveryRelays ?? []);

  /** @type {Map<string, InboxRelayResult>} */
  const cache = new Map();
  /** @type {Map<string, Promise<InboxRelayResult>>} */
  const inFlight = new Map();

  const ttlFor = (status) => (status === INBOX_STATUS.FOUND ? ttlMs : missingTtlMs);
  const isFresh = (entry) => now() - entry.checkedAt < ttlFor(entry.status) && entry.checkedAt <= now();
  const copy = (entry) => ({ status: entry.status, relays: [...entry.relays], checkedAt: entry.checkedAt });

  function assertPubkey(pubkey) {
    if (typeof pubkey !== 'string' || !HEX_PUBKEY.test(pubkey)) {
      throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'pubkey must be 64 lowercase hex characters');
    }
  }

  function freshEntry(pubkey) {
    const entry = cache.get(pubkey);
    if (!entry) return null;
    if (isFresh(entry)) return entry;
    cache.delete(pubkey);
    return null;
  }

  async function lookup(pubkey, hints) {
    // Hints come from a contact's own data, so they are capped like a list.
    const hinted = normalizeUnique(hints).slice(0, MAX_INBOX_RELAYS_PER_CONTACT);
    const urls = [...new Set([...discovery, ...hinted])];
    const answers = await Promise.all(
      urls.map((url) => queryRelay({ ensureRelay, url, pubkey, timeoutMs, setTimer, clearTimer })),
    );
    let best = null;
    let anyAnswered = false;
    for (const answer of answers) {
      if (answer.answered) anyAnswered = true;
      if (answer.event && isBetter(answer.event, best)) best = answer.event;
    }
    const relays = best ? parseInboxRelayList(best) : [];
    const checkedAt = now();
    if (relays.length > 0) return { status: INBOX_STATUS.FOUND, relays, checkedAt };
    // An event was received (so a relay spoke) or a relay said "nothing here".
    if (anyAnswered || best) return { status: INBOX_STATUS.MISSING, relays: [], checkedAt };
    return { status: INBOX_STATUS.UNKNOWN, relays: [], checkedAt };
  }

  return {
    /**
     * Find the inbox relays of `pubkey`.
     *
     * @param {string} pubkey 64 lowercase hex characters.
     * @param {object} [options]
     * @param {readonly string[]} [options.hints] Extra relays to ask (a contact's
     *   known relays); invalid ones are ignored.
     * @param {boolean} [options.force] Skip the cache. A lookup already in
     *   flight is still shared.
     * @returns {Promise<InboxRelayResult>} Never rejects for relay trouble; that is `unknown`.
     * @throws {DmError} INVALID_ARGUMENT (as a rejection) for a malformed pubkey.
     */
    async resolve(pubkey, { hints = [], force = false } = {}) {
      assertPubkey(pubkey);
      if (!force) {
        const cached = freshEntry(pubkey);
        if (cached) return copy(cached);
      }
      let promise = inFlight.get(pubkey);
      if (!promise) {
        const run = lookup(pubkey, Array.isArray(hints) ? hints : []).then((result) => {
          // `invalidate` removes the in-flight entry: that answer may predate the
          // reason for invalidating, so it is returned to its callers but not kept.
          if (inFlight.get(pubkey) === run) {
            inFlight.delete(pubkey);
            if (result.status !== INBOX_STATUS.UNKNOWN) cache.set(pubkey, result);
          }
          return result;
        });
        promise = run;
        inFlight.set(pubkey, run);
      }
      return copy(await promise);
    },

    /**
     * The cached, still fresh answer for `pubkey`, or null. Never queries.
     *
     * @param {string} pubkey
     * @returns {InboxRelayResult | null}
     */
    peek(pubkey) {
      if (typeof pubkey !== 'string') return null;
      const entry = freshEntry(pubkey);
      return entry ? copy(entry) : null;
    },

    /**
     * Forget `pubkey`: its cached answer and any lookup in flight, whose result
     * will no longer be cached (for example after a send failed on a stale list).
     *
     * @param {string} pubkey
     */
    invalidate(pubkey) {
      cache.delete(pubkey);
      inFlight.delete(pubkey);
    },

    /**
     * The fresh cache as plain JSON-serialisable data, for persisting between sessions.
     *
     * @returns {{ version: number, entries: Record<string, InboxRelayResult> }}
     */
    snapshot() {
      const entries = {};
      for (const [pubkey, entry] of cache) {
        if (isFresh(entry)) entries[pubkey] = copy(entry);
      }
      return { version: SNAPSHOT_VERSION, entries };
    },

    /**
     * Load a previously saved `snapshot()`. The data came from storage, so it is
     * validated: a wrong version or shape loads nothing, and malformed, expired,
     * future-dated or `unknown` entries are skipped one by one. Relay URLs are
     * normalised and capped again. An entry never replaces a fresher one.
     *
     * @param {unknown} snapshot
     * @returns {number} How many entries were loaded.
     */
    hydrate(snapshot) {
      if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== SNAPSHOT_VERSION) return 0;
      const { entries } = snapshot;
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return 0;
      let loaded = 0;
      for (const [pubkey, raw] of Object.entries(entries)) {
        if (!HEX_PUBKEY.test(pubkey) || !raw || typeof raw !== 'object') continue;
        const { status, checkedAt } = raw;
        if (status !== INBOX_STATUS.FOUND && status !== INBOX_STATUS.MISSING) continue;
        if (!Number.isFinite(checkedAt)) continue;
        const relays = Array.isArray(raw.relays)
          ? normalizeUnique(raw.relays).slice(0, MAX_INBOX_RELAYS_PER_CONTACT)
          : [];
        if (status === INBOX_STATUS.FOUND && relays.length === 0) continue;
        const entry = { status, relays: status === INBOX_STATUS.FOUND ? relays : [], checkedAt };
        if (!isFresh(entry)) continue;
        const existing = cache.get(pubkey);
        if (existing && isFresh(existing) && existing.checkedAt >= checkedAt) continue;
        cache.set(pubkey, entry);
        loaded += 1;
      }
      return loaded;
    },
  };
}
