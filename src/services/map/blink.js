// Blink Bitcoin map — merchants accepting Lightning via the Blink wallet.
// https://dev.blink.sv/public-api-reference.html
//
// Vendored from pratik227/bitcoinmap (services/blink.js). See VENDORED.md.
//
// The public GraphQL API exposes `businessMapMarkers`, which returns every pin
// on the Blink map in one unpaginated shot (~600 records). It's fully public
// (no API key) and CORS-open, so we can call it straight from the client.
//
// The marker type is intentionally thin: only a Blink `username`, a display
// `title`, and coordinates. There's no category, address, phone, or website —
// so we derive the merchant's Blink Pay page (and Lightning Address) from the
// username and treat every marker as Lightning-accepting (true by definition).

const ENDPOINT = 'https://api.blink.sv/graphql'
const QUERY =
  'query { businessMapMarkers { username mapInfo { title coordinates { latitude longitude } } } }'

function normalize(rec) {
  const info = rec?.mapInfo
  const coords = info?.coordinates
  const lat = Number(coords?.latitude)
  const lon = Number(coords?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const username = rec.username || ''
  const name = info?.title || username || 'Blink merchant'
  return {
    id: `blink:${username || name}`,
    source: 'blink',
    lat,
    lon,
    name,
    // No category in the API — leave null so bucketFor() resolves "other" and
    // the default bitcoin pin renders.
    category: null,
    icon: null,
    address: null,
    // The username maps to a public Blink Pay page (and `<username>@blink.sv`
    // Lightning Address), the closest thing to a website the API gives us.
    website: username ? `https://pay.blink.sv/${username}` : null,
    phone: null,
    email: null,
    openingHours: null,
    lightningAddress: username ? `${username}@blink.sv` : null,
    contacts: { telegram: null, twitter: null, mastodon: null, instagram: null, facebook: null },
    // Blink merchants are paid over Lightning; on-chain support is unknown.
    payments: { onchain: null, lightning: true, lightningContactless: null },
  }
}

export async function fetchBlink({ signal } = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY }),
    signal,
  })
  if (!res.ok) throw new Error(`Blink: ${res.status}`)
  const data = await res.json()
  const list = data?.data?.businessMapMarkers || []
  const places = []
  for (const rec of list) {
    const p = normalize(rec)
    if (p) places.push(p)
  }
  return places
}
