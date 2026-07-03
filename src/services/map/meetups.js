// Einundzwanzig Bitcoin meetups — regional Bitcoin communities ("Stammtische"),
// concentrated in Germany / Austria / Switzerland but spanning ~25 countries.
// https://portal.einundzwanzig.space/docs/api
//
// Vendored from pratik227/bitcoinmap (services/meetups.js). See VENDORED.md.
//
// Rendered as their own toggleable point layer (not merchant pins) with the
// Einundzwanzig logo as the pin: a meetup is a recurring community gathering,
// not a shop. The endpoint returns ~300 fully geocoded records in one shot, no
// auth, CORS-open.
//
// Quirk: the server replies with an HTTP 404 status line but a complete, valid
// JSON body. We therefore parse the body and validate it's a non-empty array
// instead of trusting res.ok.
//
// Cache mirrors the merchant sources (sessionStorage, 1h TTL) since the list
// changes slowly.

const ENDPOINT = 'https://portal.einundzwanzig.space/api/meetups'
const CACHE_KEY = 'eundz-meetups-cache-v1'
const CACHE_TTL_MS = 60 * 60 * 1000

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const { ts, data } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL_MS) return null
    return data
  } catch {
    return null
  }
}

function writeCache(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // Storage quota — skip caching; the in-memory copy still serves this session.
  }
}

// Derive a stable id from the portal link's trailing slug (the payload has no
// numeric id). Falls back to the name.
function slugFor(rec) {
  const link = rec.portalLink || ''
  const parts = String(link).split('/').filter(Boolean)
  if (parts.length) return parts[parts.length - 1]
  return (rec.name || 'meetup').toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function normalize(rec) {
  const lat = Number(rec?.latitude)
  const lon = Number(rec?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat === 0 && lon === 0) return null
  const id = slugFor(rec)
  // `state` arrives as null or an array of strings; flatten to a label.
  const state = Array.isArray(rec.state) ? rec.state.filter(Boolean).join(', ') : ''
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      id,
      name: rec.name || id,
      city: rec.city || '',
      state,
      country: rec.country || '',
      // `url` is the primary contact link — almost always a Telegram invite.
      telegram: rec.url || '',
      website: rec.website || '',
      twitter: rec.twitter_username || '',
      nostr: rec.nostr || '',
      portalLink: rec.portalLink || '',
    },
  }
}

export async function fetchMeetups({ signal } = {}) {
  const cached = readCache(CACHE_KEY)
  if (cached) return cached

  // Don't gate on res.ok: the API returns 404 with a valid JSON body.
  const res = await fetch(ENDPOINT, { headers: { Accept: 'application/json' }, signal })
  let raw
  try {
    raw = await res.json()
  } catch {
    throw new Error(`Meetups: unparseable response (HTTP ${res.status})`)
  }
  const list = Array.isArray(raw) ? raw : []
  if (list.length === 0) throw new Error(`Meetups: empty response (HTTP ${res.status})`)

  const features = []
  for (const rec of list) {
    const feature = normalize(rec)
    if (feature) features.push(feature)
  }

  const fc = { type: 'FeatureCollection', features }
  writeCache(CACHE_KEY, fc)
  return fc
}
