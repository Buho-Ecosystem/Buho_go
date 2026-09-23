import { RelayPool, nip19, verifyEvent } from 'nostr-core';
import { classifyIdentifier } from '../utils/nostrLookup.js';
import { compareEventFreshness, parseProfileContent } from '../utils/nostrFetch.js';
import { DEFAULT_RELAYS } from '../utils/nostrRelays.js';

export const PROFILE_SEARCH_RELAYS = Object.freeze([
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to',
]);
export const PROFILE_SEARCH_TIMEOUT_MS = 8000;
export const PROFILE_SEARCH_DEBOUNCE_MS = 350;
const text = value => typeof value === 'string' ? value.trim() : '';
const fold = value => text(value).normalize('NFKC').toLowerCase();

// Classify before any network access. Incomplete identifiers must never
// fall through to name search, and private keys must never leave the device.
export function classifyPeopleInput(raw) {
  const value = text(raw).normalize('NFKC');
  if (!value) return 'empty';
  if (/nsec1/i.test(value)) return 'private';
  if (classifyIdentifier(value)) return 'identifier';
  if (/^(nostr:|npub1|nprofile1)/i.test(value) || value.includes('@')) return 'incomplete';
  return [...value].length < 2 ? 'short' : 'name';
}

export function profileMatchScore(profile, query) {
  const needle = fold(query);
  const names = [profile.name, profile.display_name, profile.displayName, profile.nip05].map(fold);
  if (!needle || !needle.split(/\s+/).every(word => names.join(' ').includes(word))) return -1;
  return names.includes(needle) ? 2 : names.some(name => name.startsWith(needle)) ? 1 : 0;
}

function resultFromEvent(event, query) {
  const profile = parseProfileContent(event);
  const npub = nip19.npubEncode(event.pubkey);
  return {
    pubkey: event.pubkey, npub, event,
    name: (text(profile.display_name) || text(profile.displayName) || text(profile.name)).slice(0, 100),
    nip05: text(profile.nip05).slice(0, 200),
    picture: text(profile.picture),
    about: text(profile.about).slice(0, 300),
    score: query ? profileMatchScore(profile, query) : 0,
  };
}

// Use Relay directly through nostr-core's pool: pool.subscribe treats a
// connection failure as EOSE. We need to distinguish empty from unavailable.
function queryRelay(pool, url, filter, { signal, timeoutMs, onEvent }) {
  return new Promise(resolve => {
    let done = false, subscription, timer;
    let received = 0;
    const authors = new Set();
    const finish = complete => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      subscription?.close();
      resolve({ complete, received: authors.size });
    };
    const abort = () => finish(false);
    if (signal?.aborted) return finish(false);
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(false), timeoutMs);
    Promise.resolve().then(() => pool.ensureRelay(url, { connectionTimeout: Math.min(3000, timeoutMs) }))
      .then(relay => {
        if (done) return;
        // This pool belongs to this finite query. Disable the library's
        // synthetic EOSE timeout in favour of our explicit deadline.
        relay.eoseTimeout = timeoutMs + 1000;
        subscription = relay.subscribe([filter], {
          onevent(event) {
            if (done || signal?.aborted) return;
            if (++received > Math.max(200, (filter.limit || 20) * 2)) return finish(false);
            if (onEvent(event)) authors.add(event.pubkey);
          },
          oneose: () => finish(true),
          onclose: () => finish(false),
        });
        if (done) subscription.close();
      }).catch(() => finish(false));
  });
}

async function queryProfiles(filter, { relays, signal, timeoutMs = PROFILE_SEARCH_TIMEOUT_MS, onResults, pool: injectedPool, query, limit = 20, previousEvents = [], visiblePubkeys = [] }) {
  if (signal?.aborted) return { profiles: [], complete: false, partial: true };
  const pool = injectedPool || new RelayPool({ reconnect: false });
  const byPubkey = new Map(previousEvents.map(event => [event.pubkey, event]));
  const visible = new Set(visiblePubkeys);
  const snapshot = () => [...byPubkey.values()].map(event => resultFromEvent(event, query))
    .filter(profile => profile.score >= 0)
    .sort((a, b) => Number(visible.has(b.pubkey)) - Number(visible.has(a.pubkey))
      || b.score - a.score || compareEventFreshness(a.event, b.event))
    .slice(0, limit);
  const onEvent = event => {
    if (!event || event.kind !== 0 || (filter.authors && !filter.authors.includes(event.pubkey))) return;
    if (typeof event.content !== 'string' || event.content.length > 65536) return;
    try { if (!verifyEvent(event)) return; } catch { return; }
    const previous = byPubkey.get(event.pubkey);
    if (previous && compareEventFreshness(previous, event) <= 0) return true;
    // Keep newer non-matching revisions too: they invalidate stale matches.
    byPubkey.set(event.pubkey, event);
    onResults?.(snapshot());
    return true;
  };
  try {
    const completed = await Promise.all([...new Set(relays)].map(url =>
      queryRelay(pool, url, filter, { signal, timeoutMs, onEvent })));
    return {
      profiles: snapshot(), events: [...byPubkey.values()],
      complete: completed.some(result => result.complete),
      partial: !completed.every(result => result.complete),
      // NIP-50 sorts by relevance, so an `until` timestamp would skip
      // matches. Grow the requested window instead; EOSE below the limit
      // tells us a relay has exhausted the results it is willing to return.
      hasMore: completed.some(result => result.received >= filter.limit)
        || [...byPubkey.values()].filter(event => profileMatchScore(parseProfileContent(event), query) >= 0).length > limit,
    };
  } finally {
    if (!injectedPool) pool.close();
  }
}

export async function searchProfiles(query, options = {}) {
  if (classifyPeopleInput(query) !== 'name') return { profiles: [], complete: false, partial: false };
  const normalized = text(query).normalize('NFKC');
  const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 20;
  return queryProfiles({ kinds: [0], search: normalized, limit }, {
    ...options, limit, relays: options.relays || PROFILE_SEARCH_RELAYS, query: normalized,
  });
}

/** Cancellable author lookup for this UI; retains existing profile relays. */
export async function fetchPeopleProfile(pubkey, options = {}) {
  if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new TypeError('Invalid public key');
  const result = await queryProfiles({ kinds: [0], authors: [pubkey] }, {
    ...options, relays: options.relays?.length ? options.relays : DEFAULT_RELAYS, limit: 1,
  });
  return { ...result, event: result.profiles[0]?.event || null };
}
