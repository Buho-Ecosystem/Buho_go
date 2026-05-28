// OSM Overpass - pulls anything tagged with bitcoin acceptance inside a bbox.
// Scoped to the visible viewport (and zoom-gated) so we don't try to fetch the
// whole planet every viewport change.
//
// Vendored from pratik227/bitcoinmap. See VENDORED.md.

const ENDPOINT = 'https://overpass-api.de/api/interpreter'

function asBool(v) {
  if (v == null) return null
  const s = String(v).toLowerCase()
  if (s === 'yes' || s === 'true' || s === '1') return true
  if (s === 'no' || s === 'false' || s === '0') return false
  return null
}

function addressFromTags(t) {
  const parts = [
    [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
    t['addr:city'],
    t['addr:postcode'],
    t['addr:country'],
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

function categoryFromTags(t) {
  return t.shop || t.amenity || t.tourism || t.craft || t.leisure || t.office || null
}

function buildQuery(bbox) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  // ISO-compliant currency tag + the legacy payment:bitcoin tag. `out center tags;`
  // gives us the centroid for ways so we can render them as points.
  return `[out:json][timeout:25];
(
  node["currency:XBT"="yes"](${b});
  way["currency:XBT"="yes"](${b});
  node["payment:bitcoin"="yes"](${b});
  way["payment:bitcoin"="yes"](${b});
);
out center tags;`
}

function normalize(el) {
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const t = el.tags || {}
  return {
    id: `osm:${el.type}/${el.id}`,
    source: 'osm',
    lat,
    lon,
    name: t.name || t['name:en'] || t.operator || 'Bitcoin merchant',
    category: categoryFromTags(t),
    icon: null,
    address: addressFromTags(t),
    website: t['contact:website'] || t.website || null,
    phone: t['contact:phone'] || t.phone || null,
    email: t['contact:email'] || t.email || null,
    openingHours: t.opening_hours || null,
    payments: {
      onchain: asBool(t['payment:onchain']) ?? asBool(t['currency:XBT']) ?? asBool(t['payment:bitcoin']),
      lightning: asBool(t['payment:lightning']),
      lightningContactless: asBool(t['payment:lightning_contactless']),
    },
    verifiedAt: t['check_date:currency:XBT'] || t['check_date:payment:bitcoin'] || t.check_date || null,
  }
}

export async function fetchOverpass(bbox, { signal } = {}) {
  if (!bbox) return []
  const body = `data=${encodeURIComponent(buildQuery(bbox))}`
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal,
  })
  if (!res.ok) throw new Error(`Overpass: ${res.status}`)
  const data = await res.json()
  const elements = data.elements || []
  const places = []
  for (const el of elements) {
    const p = normalize(el)
    if (p) places.push(p)
  }
  return places
}
