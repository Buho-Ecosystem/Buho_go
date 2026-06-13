// MoneyBadger — retailers accepting Bitcoin (Lightning, via Zapper / Scan to
// Pay) across South Africa. https://www.moneybadger.co.za/stores
//
// Vendored from pratik227/bitcoinmap (services/moneybadger.js). See VENDORED.md.
// Adapted for BuhoGO: dropped the upstream icons.js `guessIconKey` dependency —
// BuhoGO buckets purely off the raw `category` string via places.js bucketFor().
//
// The public store page embeds a separate map app that loads a single static
// GeoJSON FeatureCollection (~5.5k stores, all geocoded). That file is the only
// data source — there's no documented MoneyBadger API — so this is an
// unofficial third-party endpoint that could move; we fail soft. Each feature
// carries name + category + [lon, lat]; the `address` property is a
// brand/payment-rail label (e.g. "Engen (Scan to Pay)"), NOT a postal address,
// so we deliberately leave `address` null rather than misrender it.

const URLS = ['https://mbwebsitemap-benblaines-projects.vercel.app/merchants.json']

function normalize(feat, idx) {
  if (!feat || feat.geometry?.type !== 'Point') return null
  const coords = feat.geometry.coordinates
  const lon = Number(coords?.[0])
  const lat = Number(coords?.[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const props = feat.properties || {}
  const name = props.name || 'MoneyBadger merchant'
  const rawCat = (props.category || '').toLowerCase()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return {
    id: `moneybadger:${slug || 'store'}-${idx}`,
    source: 'moneybadger',
    lat,
    lon,
    name,
    // Raw source category drives BuhoGO's bucket heuristic (bucketFor matches
    // substrings: "restaurant" → food, "fuel" → fuel, "grocery" → retail …).
    category: rawCat || null,
    icon: null,
    address: null,
    website: null,
    phone: null,
    email: null,
    openingHours: null,
    contacts: { telegram: null, twitter: null, mastodon: null, instagram: null, facebook: null },
    // MoneyBadger settles over Lightning (Zapper / Scan to Pay rails).
    payments: { onchain: null, lightning: true, lightningContactless: null },
  }
}

export async function fetchMoneyBadger({ signal } = {}) {
  let lastErr
  for (const url of URLS) {
    try {
      const res = await fetch(url, { signal })
      if (!res.ok) {
        lastErr = new Error(`MoneyBadger: ${res.status}`)
        continue
      }
      const data = await res.json()
      const list = Array.isArray(data?.features) ? data.features : []
      const places = []
      list.forEach((feat, i) => {
        const p = normalize(feat, i)
        if (p) places.push(p)
      })
      return places
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('MoneyBadger: unreachable')
}
