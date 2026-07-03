// Common Place shape used across all sources.
//
// {
//   id: string,                    // `${source}:${native_id}`
//   source: 'btcmap'|'osm'|'btcpay',
//   lat, lon,
//   name, category, icon,
//   address, website, phone, email, openingHours,
//   payments: { onchain, lightning, lightningContactless },
//   verifiedAt: string|null,       // ISO-ish date the listing was last checked
//   online: boolean,               // true for synthetic BTCPay online merchants
// }
//
// Vendored from pratik227/bitcoinmap. See VENDORED.md. BuhoGO additions:
// `verifiedAt` and `online` are carried through the merge + feature collection
// so the UI can show a freshness chip and label online-only merchants.

export const SOURCE_LABEL = {
  btcmap: 'BTC Map',
  osm: 'OpenStreetMap',
  btcpay: 'BTCPay Directory',
  blink: 'Blink',
  bitcoinjungle: 'Bitcoin Jungle',
  moneybadger: 'MoneyBadger',
}

// The social/contact platforms we surface (OSM `contact:<platform>` tags).
export const CONTACT_PLATFORMS = ['telegram', 'twitter', 'mastodon', 'instagram', 'facebook']

/**
 * Turn a raw OSM `contact:<platform>` value into an openable https URL.
 * Accepts a bare handle ("@user" / "user"), a Mastodon "user@instance", and an
 * already-formed URL. Returns null when empty. Used by osm.js + overpass.js so
 * the normalized place carries ready-to-open links.
 */
export function normalizeContact(platform, value) {
  if (!value) return null
  const v = String(value).trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  const handle = v.replace(/^@/, '')
  switch (platform) {
    case 'telegram':
      return `https://t.me/${handle}`
    case 'twitter':
      return `https://twitter.com/${handle}`
    case 'mastodon': {
      // "user@instance.social" → "https://instance.social/@user"
      const parts = handle.split('@')
      if (parts.length === 2 && parts[1]) return `https://${parts[1]}/@${parts[0]}`
      return `https://${handle}`
    }
    case 'instagram':
      return `https://instagram.com/${handle}`
    case 'facebook':
      return `https://facebook.com/${handle}`
    default:
      return null
  }
}

/** Build the normalized `contacts` object from an OSM tag bag. */
export function contactsFromTags(t) {
  const out = {}
  for (const p of CONTACT_PLATFORMS) {
    out[p] = normalizeContact(p, t[`contact:${p}`])
  }
  return out
}

// Source priority for dedupe winner selection - earlier wins. BTC Map / OSM /
// BTCPay stay highest (richest tags); the regional Lightning directories rank
// below them so a place they share with a global source keeps the richer record.
const SOURCE_PRIORITY = ['btcmap', 'osm', 'btcpay', 'bitcoinjungle', 'blink', 'moneybadger']

const SOURCE_RANK = Object.fromEntries(SOURCE_PRIORITY.map((s, i) => [s, i]))

// Round to 4 decimals (~11m) so coordinates that differ slightly between
// sources still collide. Combined with a normalized name token, that's
// enough to fold "Joe's Coffee" from BTC Map and OSM into one pin.
function dedupeKey(p) {
  const lat = Math.round(p.lat * 10000) / 10000
  const lon = Math.round(p.lon * 10000) / 10000
  const name = (p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
  return `${lat},${lon}|${name}`
}

export function mergePlaces(...lists) {
  const map = new Map()
  for (const list of lists) {
    if (!list) continue
    for (const p of list) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue
      const key = dedupeKey(p)
      const existing = map.get(key)
      if (!existing) {
        map.set(key, { ...p, sources: [p.source] })
        continue
      }
      // Keep the higher-priority record but remember every source that vouches for this place.
      if (!existing.sources.includes(p.source)) existing.sources.push(p.source)
      if (SOURCE_RANK[p.source] < SOURCE_RANK[existing.source]) {
        const sources = existing.sources
        map.set(key, { ...p, sources })
      } else {
        // Fill in fields the winner is missing.
        for (const f of ['name', 'category', 'icon', 'address', 'website', 'phone', 'email', 'openingHours', 'verifiedAt', 'lightningAddress', 'contacts']) {
          if (!existing[f] && p[f]) existing[f] = p[f]
        }
        const wp = existing.payments || {}
        const np = p.payments || {}
        existing.payments = {
          onchain: wp.onchain ?? np.onchain ?? null,
          lightning: wp.lightning ?? np.lightning ?? null,
          lightningContactless: wp.lightningContactless ?? np.lightningContactless ?? null,
        }
      }
    }
  }
  return [...map.values()]
}

// Convert a normalized place list into a MapLibre-ready FeatureCollection.
export function toFeatureCollection(places) {
  return {
    type: 'FeatureCollection',
    features: places.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        id: p.id,
        source: p.source,
        sources: (p.sources || [p.source]).join(','),
        osmId: p.osmId || '',
        name: p.name || '',
        category: p.category || '',
        icon: p.icon || '',
        // Broad group that drives the map pin glyph. Online merchants share the
        // `world` marker the list/detail use, so they read the same everywhere.
        bucket: p.online === true ? 'online' : bucketFor(p.category),
        address: p.address || '',
        website: p.website || '',
        phone: p.phone || '',
        email: p.email || '',
        openingHours: p.openingHours || '',
        verifiedAt: p.verifiedAt || '',
        online: p.online === true ? 1 : 0,
        lat: p.lat,
        lon: p.lon,
        payOnchain: p.payments?.onchain === true ? 1 : 0,
        payLightning: p.payments?.lightning === true ? 1 : 0,
        payContactless: p.payments?.lightningContactless === true ? 1 : 0,
      },
    })),
  }
}

// Heuristic category → broad filter group, matched as a substring of the
// source category. BTC Map tags places with Material Symbols icon names
// (`storefront`, `lunch_dining`, `content_cut`, `local_grocery_store`, …),
// while OSM/Overpass uses amenity values (`restaurant`, `hairdresser`, …), so
// each list carries keywords for both. Order = match priority (first wins),
// e.g. `sports_bar` resolves to food (via `bar`) before leisure.
const CATEGORY_BUCKETS = {
  atm: ['atm', 'currency_exchange'],
  fuel: ['gas_station', 'fuel', 'petrol'],
  food: [
    'restaurant', 'cafe', 'coffee', 'dining', 'pizza', 'bakery', 'bar', 'pub',
    'fast_food', 'fastfood', 'food', 'ramen', 'ice_cream', 'icecream', 'cake',
    'brunch', 'lunch', 'dinner', 'liquor', 'wine', 'beer', 'biergarten',
  ],
  lodging: ['hotel', 'hostel', 'guest', 'apartment', 'cottage', 'cabin', 'motel', 'bed', 'camp_site'],
  services: [
    'content_cut', 'hairdresser', 'beauty', 'spa', 'salon', 'laundry', 'cleaning',
    'car_repair', 'directions_car', 'repair', 'handyman', 'medical', 'doctor',
    'dentist', 'hospital', 'pharmacy', 'health', 'bank', 'business', 'post_office',
    'engineering', 'construction', 'build', 'photo_camera', 'plumbing', 'electrical',
  ],
  retail: [
    'storefront', 'store', 'shop', 'grocery', 'supermarket', 'convenience', 'mall',
    'florist', 'diamond', 'jewel', 'clothes', 'checkroom', 'electronics', 'computer',
    'book', 'gift', 'market', 'boutique', 'pets', 'furniture', 'chair',
  ],
  leisure: [
    'fitness', 'gym', 'sports_center', 'sports_centre', 'cinema', 'movie', 'theater',
    'theatre', 'casino', 'museum', 'golf', 'arts', 'celebration', 'self_improvement',
    'attractions', 'nightlife',
  ],
}

export function bucketFor(category) {
  if (!category) return 'other'
  const c = category.toLowerCase()
  for (const [bucket, list] of Object.entries(CATEGORY_BUCKETS)) {
    if (list.some((k) => c.includes(k))) return bucket
  }
  return 'other'
}

// Bucket → representative icon (Tabler icon name) for list rows and detail.
export const CATEGORY_BUCKET_ICONS = {
  food: 'tabler:tools-kitchen-2',
  retail: 'tabler:shopping-bag',
  lodging: 'tabler:bed',
  services: 'tabler:briefcase',
  atm: 'tabler:cash',
  fuel: 'tabler:gas-station',
  leisure: 'tabler:device-gamepad-2',
  other: 'tabler:map-pin',
}

// NOTE: bucket label strings are localized at the component layer via i18n
// keys (`mapBucket.food` etc.) rather than hardcoded here, so this object
// only holds the canonical English fallback used if a key is missing.
export const CATEGORY_BUCKET_LABELS = {
  food: 'Food & drink',
  retail: 'Retail',
  lodging: 'Lodging',
  services: 'Services',
  atm: 'Bitcoin ATMs',
  fuel: 'Fuel',
  leisure: 'Leisure',
  other: 'Other',
}

// Haversine great-circle distance in metres between two [lat, lon] points.
// Used to sort the nearby list and render per-place distance.
export function distanceMeters(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
