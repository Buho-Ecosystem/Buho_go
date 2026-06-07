// BTC Map v4 - global directory of bitcoin-accepting venues.
// https://api.btcmap.org/v4/places
//
// v4 returns only the slim pin record. The known working fields are:
//   id, lat, lon, icon, name, osm_id, updated_at, created_at
// Rich details (address, hours, payment methods) are NOT exposed by BTC Map's
// API - they live in OSM. We carry the osm_id forward so the popup can lazy-
// fetch full tags from api.openstreetmap.org on demand.
//
// Vendored from pratik227/bitcoinmap. See VENDORED.md. BuhoGO addition:
// `verifiedAt` is threaded from `updated_at` as a coarse freshness signal;
// the precise OSM `check_date` is filled in lazily by osm.js when the detail
// sheet opens.

const ENDPOINT = 'https://api.btcmap.org/v4/places'
const FIELDS = 'id,lat,lon,icon,name,osm_id,updated_at'

function normalize(rec) {
  const lat = Number(rec.lat)
  const lon = Number(rec.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  return {
    id: `btcmap:${rec.id}`,
    source: 'btcmap',
    lat,
    lon,
    name: rec.name || 'Bitcoin merchant',
    // BTC Map's `icon` (e.g., "hotel", "restaurant", "atm", "spa") doubles as a
    // category - it's already bucketed for our category filter.
    category: rec.icon || null,
    icon: rec.icon || null,
    osmId: rec.osm_id || null,
    address: null,
    website: null,
    phone: null,
    email: null,
    openingHours: null,
    // BTC Map only lists places that accept bitcoin, so on-chain is true by
    // default. Lightning/contactless require the OSM tag, fetched lazily.
    payments: {
      onchain: true,
      lightning: null,
      lightningContactless: null,
    },
    verifiedAt: rec.updated_at || null,
  }
}

export async function fetchBtcMap({ signal } = {}) {
  const url = `${ENDPOINT}?fields=${FIELDS}&include_deleted=false`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`BTC Map: ${res.status}`)
  const data = await res.json()
  const list = Array.isArray(data) ? data : data?.places || []
  const places = []
  for (const rec of list) {
    const p = normalize(rec)
    if (p) places.push(p)
  }
  return places
}
