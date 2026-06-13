// Bitcoin Jungle — community merchant directory, centred on Costa Rica.
// https://maps.bitcoinjungle.app/
//
// Vendored from pratik227/bitcoinmap (services/bitcoinjungle.js). See
// VENDORED.md. Adapted for BuhoGO: dropped the upstream icons.js `guessIconKey`
// dependency — BuhoGO buckets off the raw `category` string via bucketFor().
//
// The map SPA loads everything from a single endpoint that returns ~600
// merchants in one shot (no auth, CORS-open). Each record has nested
// `coordinates {latitude, longitude}`, an optional website + phone, and a
// `categories[]` array with bilingual (EN + ES) entries — we request
// `locale=en` and take the first category name for bucketing. Every listing is
// a Bitcoin/Lightning merchant by definition, so both payment flags are true.

const ENDPOINT = 'https://maps.bitcoinjungle.app/api/list?locale=en'

function pickCategory(categories) {
  if (!Array.isArray(categories)) return null
  for (const c of categories) {
    const name = c?.name
    if (name) return name
  }
  return null
}

function normalize(rec) {
  const coords = rec?.coordinates
  const lat = Number(coords?.latitude)
  const lon = Number(coords?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const catName = pickCategory(rec.categories)
  return {
    id: `bitcoinjungle:${rec.id}`,
    source: 'bitcoinjungle',
    lat,
    lon,
    name: rec.name || 'Bitcoin Jungle merchant',
    // Human category text feeds BuhoGO's bucketFor (substring match).
    category: catName ? catName.toLowerCase() : null,
    icon: null,
    address: null,
    website: rec.website || null,
    phone: rec.phone || null,
    email: null,
    openingHours: null,
    contacts: { telegram: null, twitter: null, mastodon: null, instagram: null, facebook: null },
    payments: { onchain: true, lightning: true, lightningContactless: null },
  }
}

export async function fetchBitcoinJungle({ signal } = {}) {
  // Content-type is text/plain; res.json() parses the body regardless.
  const res = await fetch(ENDPOINT, { signal })
  if (!res.ok) throw new Error(`Bitcoin Jungle: ${res.status}`)
  const data = await res.json()
  const list = Array.isArray(data?.locations) ? data.locations : []
  const places = []
  for (const rec of list) {
    const p = normalize(rec)
    if (p) places.push(p)
  }
  return places
}
