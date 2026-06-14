/**
 * Nostr NIP-15 adapter — the decentralized "markets" facet. Queries kind:30017
 * stalls (online shops run by a merchant pubkey) and resolves each merchant's
 * kind:0 profile for a Lightning address (lud16) so the user can pay directly.
 *
 * Best-effort and quarantined: this is opt-in (loaded lazily when the user
 * picks the Nostr segment), heavily filtered (signature-verified, JSON-content
 * only so encrypted blobs drop, name + d-tag required, per-pubkey capped), and
 * NEVER throws — a weak or empty relay result returns [] so the core directory
 * is unaffected. Uses the user's own NostrCore lib (never nostr-tools).
 */

import { verifyEvent, nip19 } from 'nostr-core';
import { getRelayPool, DEFAULT_RELAYS } from '../../utils/nostrRelays.js';
import { parseProfileContent, compareEventFreshness } from '../../utils/nostrFetch.js';
import { normalizeHost } from './shop.js';

const STALL_KIND = 30017;
const PROFILE_KIND = 0;
// Marketplace-heavy relays appended to the defaults for stall coverage.
const MARKET_RELAYS = ['wss://relay.shopstr.store'];
const QUERY_TIMEOUT_MS = 6000;
const MAX_STALLS = 120;
const MAX_PER_PUBKEY = 5;

const LUD16_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function dTagOf(event) {
  const t = (event.tags || []).find((x) => Array.isArray(x) && x[0] === 'd');
  return t ? String(t[1] || '') : '';
}

function safeVerify(ev) {
  try { return verifyEvent(ev) === true; } catch { return false; }
}

/**
 * A public Nostr-market URL for a stall, so there is always a real place to
 * browse the seller's catalog and complete an order in a market client (BuhoGO
 * cannot run the NIP-15 order protocol in-app). njump renders the addressable
 * stall event and offers "open in app" handoff to market clients (e.g. Shopstr).
 */
function marketUrlFor(pubkey, d) {
  try {
    const naddr = nip19.naddrEncode({ identifier: d, pubkey, kind: STALL_KIND, relays: MARKET_RELAYS.slice(0, 1) });
    return `https://njump.me/${naddr}`;
  } catch {
    try { return `https://njump.me/${nip19.npubEncode(pubkey)}`; } catch { return ''; }
  }
}

/**
 * @param {{ signal?: AbortSignal, limit?: number, relays?: string[] }} [opts]
 * @returns {Promise<import('./shop.js').Shop[]>}
 */
export async function fetchNostrShops({ signal, limit = MAX_STALLS, relays } = {}) {
  const pool = getRelayPool();
  if (!pool || typeof pool.querySync !== 'function') return [];
  const urls = Array.from(new Set([...(relays || DEFAULT_RELAYS), ...MARKET_RELAYS]));

  let events = [];
  try {
    events = await pool.querySync(urls, { kinds: [STALL_KIND], limit }, { maxWait: QUERY_TIMEOUT_MS });
  } catch {
    return [];
  }
  if (signal?.aborted || !Array.isArray(events)) return [];

  // Verify + parse JSON content (drops encrypted/non-JSON stalls) + dedupe the
  // replaceable event per (pubkey, d) by freshness.
  const byAddr = new Map();
  for (const ev of events) {
    if (!ev || ev.kind !== STALL_KIND || !safeVerify(ev)) continue;
    let content;
    try { content = JSON.parse(ev.content); } catch { continue; }
    if (!content || typeof content !== 'object') continue;
    const name = String(content.name || '').trim();
    if (!name || name.length > 80) continue; // empty/spam sanity
    const d = dTagOf(ev);
    if (!d) continue;
    const addr = `${ev.pubkey}:${d}`;
    const prev = byAddr.get(addr);
    if (!prev || compareEventFreshness(ev, prev.ev) < 0) byAddr.set(addr, { ev, content, name, d });
  }

  // Per-pubkey cap so one merchant can't flood the facet.
  const perPub = new Map();
  const stalls = [];
  for (const s of byAddr.values()) {
    const n = perPub.get(s.ev.pubkey) || 0;
    if (n >= MAX_PER_PUBKEY) continue;
    perPub.set(s.ev.pubkey, n + 1);
    stalls.push(s);
  }
  if (!stalls.length) return [];

  // Batch-resolve merchant profiles (one query for all authors).
  const pubkeys = Array.from(new Set(stalls.map((s) => s.ev.pubkey)));
  const profiles = new Map();
  try {
    const pevents = await pool.querySync(
      urls,
      { kinds: [PROFILE_KIND], authors: pubkeys, limit: pubkeys.length * 2 },
      { maxWait: QUERY_TIMEOUT_MS },
    );
    for (const pe of pevents || []) {
      if (!pe || pe.kind !== PROFILE_KIND || !safeVerify(pe)) continue;
      const cur = profiles.get(pe.pubkey);
      if (!cur || compareEventFreshness(pe, cur) < 0) profiles.set(pe.pubkey, pe);
    }
  } catch {
    // Profiles are optional; a stall with no resolvable lud16/site is dropped below.
  }

  const out = [];
  for (const s of stalls) {
    const meta = profiles.has(s.ev.pubkey) ? parseProfileContent(profiles.get(s.ev.pubkey)) : {};
    const lnAddress = typeof meta.lud16 === 'string' && LUD16_RE.test(meta.lud16.trim()) ? meta.lud16.trim() : null;
    const website = typeof meta.website === 'string' && /^https?:\/\//.test(meta.website) ? meta.website : '';
    const host = normalizeHost(website);
    const picture = typeof meta.picture === 'string' && /^https:\/\//.test(meta.picture) ? meta.picture : null;
    const description = String(s.content.description || '').trim();
    // Skip context-free noise: a stall with no description, no site and no
    // payable address is not a useful "shop" to surface. Everything kept has a
    // marketUrl to view, so it never dead-ends on a bare "Pay" button.
    if (!description && !lnAddress && !host) continue;
    out.push({
      id: `nostr:${s.ev.pubkey}:${s.d}`,
      name: s.name,
      description,
      website: host ? website : '',
      host,
      marketUrl: marketUrlFor(s.ev.pubkey, s.d),
      category: 'other',
      country: null,
      payments: { lightning: !!lnAddress, onchain: null },
      source: 'nostr',
      sources: ['nostr'],
      lnAddress,
      logoUrl: picture,
      verified: false,
      raw: { stall: s.ev, profile: profiles.get(s.ev.pubkey) || null },
    });
  }
  return out;
}
