/**
 * Online-shops directory — the unified model + the pure helpers every source
 * adapter and the aggregator share. This is the "places.js" of the online-shops
 * feature: no network, no Pinia, fully unit-testable.
 *
 * A Shop is a normalized online business that accepts Bitcoin, merged from
 * three sources (BitcoinListings.org, the BTCPay Server Directory, and Nostr
 * NIP-15 stalls). See ./aggregator.js for orchestration.
 *
 * @typedef {Object} Shop
 * @property {string}  id          `${source}:${nativeId}`, stable across reloads
 * @property {string}  name        display name, trimmed
 * @property {string}  description short blurb, '' if none
 * @property {string}  website     absolute https URL (the "Visit shop" target), '' for nostr-only stalls
 * @property {string}  host        normalized bare domain (dedupe key + favicon primitive), '' if no website
 * @property {string}  category    canonical category key (SHOP_CATEGORIES), 'other' fallback
 * @property {{code:string,name:string,flag:string}|null} country  code 'WW' = worldwide; null = unknown
 * @property {{lightning:(boolean|null), onchain:(boolean|null)}} payments
 * @property {'listings'|'btcpay'|'nostr'} source  canonical source after dedupe
 * @property {string[]} sources    every source that vouches for this shop
 * @property {string|null} lnAddress  LUD-16 (name@domain) -> enables "Pay with BuhoGO"; null otherwise
 * @property {string|null} logoUrl    explicit logo if a source provided one; null -> resolve at render
 * @property {boolean}  verified    true only when a verified source vouches for it
 * @property {Object}   raw         untouched source record(s)
 */

// Canonical, small, durable category set. Source-specific labels are mapped in.
export const SHOP_CATEGORIES = Object.freeze([
  'food', 'ecommerce', 'tech', 'services', 'travel', 'media', 'gaming', 'charity', 'other',
]);

// Tabler icon per category (parallels the map's CATEGORY_BUCKET_ICONS).
export const SHOP_CATEGORY_ICONS = Object.freeze({
  food: 'tabler:coffee',
  ecommerce: 'tabler:shopping-bag',
  tech: 'tabler:device-laptop',
  services: 'tabler:briefcase',
  travel: 'tabler:plane',
  media: 'tabler:movie',
  gaming: 'tabler:device-gamepad-2',
  charity: 'tabler:heart-handshake',
  other: 'tabler:building-store',
});

// English fallback labels; the UI prefers the i18n key `shopCat.<key>`.
export const SHOP_CATEGORY_LABELS = Object.freeze({
  food: 'Food & drink',
  ecommerce: 'Shopping',
  tech: 'Tech',
  services: 'Services',
  travel: 'Travel',
  media: 'Media',
  gaming: 'Gaming',
  charity: 'Charity',
  other: 'Other',
});

// BitcoinListings is richest (country + payment methods), so it wins on dedupe;
// btcpay next; nostr last (and rarely shares a domain).
export const SHOP_SOURCE_PRIORITY = Object.freeze(['listings', 'btcpay', 'nostr']);

// Keyword -> canonical category, evaluated in order (first match wins).
// Substring match against the lowercased source category/subType, tolerating
// casing dupes + bespoke labels without an exhaustive table.
//
// Order + keyword choice matter: ecommerce is checked BEFORE tech so "Apparel"
// resolves to shopping (not tech via a bare "app"), and short ambiguous tokens
// (app/dev/art/bar/web) are intentionally avoided in favour of unambiguous
// forms so we don't misclassify (apparel->tech, barbershop->food, department->
// media). tech is last so it still catches the bare "App" category.
const CATEGORY_RULES = [
  ['food', ['food', 'beverage', 'drink', 'coffee', 'restaurant', 'grocery', 'cafe', 'brew', 'wine']],
  ['travel', ['travel', 'flight', 'hotel', 'tourism', 'esim', 'booking', 'vacation']],
  ['gaming', ['game', 'gaming', 'casino', 'esport']],
  ['media', ['media', 'music', 'book', 'publish', 'news', 'film', 'movie', 'photo', 'podcast', 'collectible', 'artwork', 'artist', 'gallery', 'magazine']],
  ['charity', ['charity', 'donation', 'non-profit', 'nonprofit', 'sustainab']],
  ['services', ['service', 'legal', 'consult', 'health', 'education', 'marketing', 'finance', 'accounting', 'design', 'agency', 'repair', 'barber']],
  ['ecommerce', ['e-commerce', 'ecommerce', 'commerce', 'apparel', 'clothing', 'fashion', 'jewel', 'shop', 'store', 'retail', 'merch', 'storefront', 'merchant', 'gift', 'market']],
  ['tech', ['tech', 'software', 'hosting', 'hardware', 'electronic', 'developer', 'development', 'saas', 'cloud', 'domain', 'website', 'server', 'apps', 'application', 'app', 'vpn', 'crypto', 'mining', 'node']],
];

/**
 * Map a source's raw category/subType string to a canonical key. Lowercases +
 * trims first (so `Food & Beverages` / `food & Beverages` collapse), then
 * keyword-matches. Defaults to 'other'.
 * @param {string} _source  the source name (reserved for source-specific tweaks)
 * @param {string} raw
 * @returns {string}
 */
export function mapCategory(_source, raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return 'other';
  for (const [cat, words] of CATEGORY_RULES) {
    if (words.some((w) => s.includes(w))) return cat;
  }
  return 'other';
}

/**
 * Reduce a URL or host to a bare, comparable domain: lowercase, no scheme, no
 * leading `www.`, no port, no path/query/hash, no trailing dot. The dedupe key
 * and the favicon primitive. Returns '' on garbage.
 * @param {string} urlOrHost
 * @returns {string}
 */
export function normalizeHost(urlOrHost) {
  let v = String(urlOrHost || '').trim().toLowerCase();
  if (!v) return '';
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  v = v.replace(/^www\./, '');
  v = v.split(/[/?#]/)[0]; // path/query/hash
  v = v.split(':')[0]; // port
  v = v.replace(/\.$/, ''); // trailing dot
  // A bare domain must have a dot and no spaces.
  if (!v || v.includes(' ') || !v.includes('.')) return '';
  return v;
}

/** Flag emoji from an ISO-3166 alpha-2 code; globe for worldwide/unknown. */
export function codeToFlag(code) {
  const cc = String(code || '').toUpperCase();
  if (!cc || cc === 'WW' || cc === 'GLOBAL') return '🌍';
  if (cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) return '🌍';
  const A = 0x1f1e6;
  const base = 'A'.charCodeAt(0);
  return String.fromCodePoint(A + cc.charCodeAt(0) - base, A + cc.charCodeAt(1) - base);
}

// Country flags are rendered from the offline `circle-flags` Iconify set
// (see ./flags.js) keyed by `country.code` — no CDN. `codeToFlag` above stays
// only for plain-text contexts.

/**
 * Merge shop lists from multiple sources into one deduped list. Mirrors the
 * map's mergePlaces: keyed by host, higher-priority source wins, the loser fills
 * only the winner's empty fields, payment flags merge with `??` precedence, and
 * a Nostr lnAddress is promoted onto a website shop that lacks one (so that shop
 * gains "Pay with BuhoGO" while its canonical source stays listings/btcpay).
 * Shops with no host (nostr-only stalls) are never deduped.
 *
 * @param {...Shop[]} lists
 * @returns {Shop[]}
 */
export function mergeShops(...lists) {
  const byHost = new Map();
  const out = [];
  const rank = (s) => {
    const i = SHOP_SOURCE_PRIORITY.indexOf(s);
    return i === -1 ? SHOP_SOURCE_PRIORITY.length : i;
  };

  for (const list of lists) {
    for (const shop of list || []) {
      if (!shop) continue;
      if (!shop.host) { out.push(shop); continue; } // nostr-only: keep distinct

      const existing = byHost.get(shop.host);
      if (!existing) {
        byHost.set(shop.host, shop);
        out.push(shop);
        continue;
      }

      // Decide winner/loser by source priority.
      const winner = rank(shop.source) < rank(existing.source) ? shop : existing;
      const loser = winner === shop ? existing : shop;

      // Record every contributing source.
      winner.sources = Array.from(new Set([...(winner.sources || [winner.source]), ...(loser.sources || [loser.source])]));
      // Fill only falsy winner fields from the loser.
      for (const f of ['name', 'description', 'category', 'country', 'logoUrl', 'lnAddress', 'website', 'host']) {
        if (!winner[f] && loser[f]) winner[f] = loser[f];
      }
      winner.payments = {
        lightning: winner.payments?.lightning ?? loser.payments?.lightning ?? null,
        onchain: winner.payments?.onchain ?? loser.payments?.onchain ?? null,
      };
      winner.verified = !!winner.verified || !!loser.verified;
      winner.raw = { [winner.source]: winner.raw, [loser.source]: loser.raw };

      if (winner !== existing) {
        // The new shop outranked the stored one: replace it in `out`.
        const idx = out.indexOf(existing);
        if (idx >= 0) out.splice(idx, 1, winner);
        byHost.set(shop.host, winner);
      }
    }
  }
  return out;
}

/**
 * Rank for the list + the "Popular" seed: verified first, then payable directly
 * (lnAddress), then Lightning-accepting, then alphabetical (locale-aware).
 * @param {Shop[]} shops
 * @param {string} [locale]
 * @returns {Shop[]}
 */
export function sortShops(shops, locale) {
  const score = (s) => (s.verified ? 8 : 0) + (s.lnAddress ? 4 : 0) + (s.payments?.lightning ? 2 : 0);
  return [...(shops || [])].sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return String(a.name || '').localeCompare(String(b.name || ''), locale || undefined);
  });
}
