// Lazy lookup for rich OSM tags by osm_id ("node:1234" / "way:567" / "relation:8").
// Used to populate popup details for BTC Map pins, whose v4 API doesn't expose
// tags directly. Cached per id for the session.
//
// Vendored from pratik227/bitcoinmap. See VENDORED.md. BuhoGO addition:
// `verifiedAt` threaded from the OSM check_date tags so the detail sheet can
// show a precise "verified X ago" freshness chip.

import { contactsFromTags } from './places.js'

const API = 'https://api.openstreetmap.org/api/0.6'
const cache = new Map()
const inflight = new Map()

// Prefer a human-readable Lightning Address (email-style); fall back to LNURL
// and node IDs for power users. Mirrors the OSM tags BTC Map merchants use.
function lightningAddressFromTags(t) {
  const raw =
    t['payment:lightning:address'] ||
    t['lightning:address'] ||
    t['payment:lightning:lnurl'] ||
    t['lightning:lnurl'] ||
    t['payment:lightning:nodeid'] ||
    t['lightning:nodeid'] ||
    null
  if (!raw) return null
  const v = String(raw).trim()
  return v || null
}

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

function detailsFromTags(t) {
  return {
    address: addressFromTags(t),
    website: t['contact:website'] || t.website || null,
    phone: t['contact:phone'] || t.phone || null,
    email: t['contact:email'] || t.email || null,
    openingHours: t.opening_hours || null,
    payments: {
      onchain: asBool(t['payment:onchain']) ?? asBool(t['currency:XBT']) ?? true,
      lightning: asBool(t['payment:lightning']),
      lightningContactless: asBool(t['payment:lightning_contactless']),
    },
    verifiedAt:
      t['check_date:currency:XBT'] ||
      t['check_date:payment:bitcoin'] ||
      t['survey:date'] ||
      t.check_date ||
      null,
    lightningAddress: lightningAddressFromTags(t),
    contacts: contactsFromTags(t),
  }
}

export async function fetchOsmDetails(osmId, { signal } = {}) {
  if (!osmId || !osmId.includes(':')) return null
  if (cache.has(osmId)) return cache.get(osmId)
  if (inflight.has(osmId)) return inflight.get(osmId)

  const [type, id] = osmId.split(':')
  const url = `${API}/${type}/${id}.json`

  const promise = (async () => {
    try {
      const res = await fetch(url, { signal })
      if (!res.ok) return null
      const data = await res.json()
      const el = data.elements?.[0]
      const tags = el?.tags || {}
      const details = detailsFromTags(tags)
      cache.set(osmId, details)
      return details
    } catch {
      return null
    } finally {
      inflight.delete(osmId)
    }
  })()

  inflight.set(osmId, promise)
  return promise
}
