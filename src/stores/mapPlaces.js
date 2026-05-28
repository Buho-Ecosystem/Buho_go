import { defineStore } from 'pinia'
import { fetchBtcMap } from '../services/map/btcmap.js'
import { fetchOverpass } from '../services/map/overpass.js'
import { fetchBtcPay } from '../services/map/btcpay.js'
import {
  mergePlaces,
  toFeatureCollection,
  bucketFor,
  distanceMeters,
} from '../services/map/places.js'

// Vendored from pratik227/bitcoinmap (store + services). See
// src/services/map/VENDORED.md. BuhoGO additions on top of the original store:
//   - userLocation + `nearby` distance-sorted getter (drives the list sheet)
//   - verifiedRecentlyOnly filter (freshness)
//   - `online` source records flow through unchanged
//
// Source caching uses sessionStorage with a short TTL so re-opening the map in
// the same session is instant without holding stale data across days.

const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_KEYS = { btcmap: 'btcmap-cache-v1', btcpay: 'btcpay-cache-v1' }

// A listing counts as "recently verified" if its check/update date is within
// this window. Mirrors BTC Map's own ~1-year freshness convention.
const VERIFIED_RECENT_MS = 365 * 24 * 60 * 60 * 1000

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
    // Storage quota - skip caching; in-memory copy is still good for the session.
  }
}

function isRecentlyVerified(verifiedAt) {
  if (!verifiedAt) return false
  const t = Date.parse(verifiedAt)
  if (!Number.isFinite(t)) return false
  return Date.now() - t <= VERIFIED_RECENT_MS
}

export const useMapPlacesStore = defineStore('mapPlaces', {
  state: () => ({
    btcmap: [],
    osm: [],
    btcpay: [],

    enabled: { btcmap: true, osm: true, btcpay: true },
    buckets: { food: true, retail: true, lodging: true, services: true, atm: true, leisure: true, other: true },
    verifiedRecentlyOnly: false,

    loading: { btcmap: false, osm: false, btcpay: false },
    errors: { btcmap: null, osm: null, btcpay: null },
    lastViewportFetchAt: 0,

    // Set once geolocation resolves. Drives the `nearby` getter and the
    // per-place distance shown in the list + detail sheet.
    userLocation: null, // { lat, lon } | null
  }),
  getters: {
    merged(state) {
      const lists = []
      if (state.enabled.btcmap) lists.push(state.btcmap)
      if (state.enabled.osm) lists.push(state.osm)
      if (state.enabled.btcpay) lists.push(state.btcpay)
      let all = mergePlaces(...lists)
      all = all.filter((p) => state.buckets[bucketFor(p.category)])
      if (state.verifiedRecentlyOnly) {
        all = all.filter((p) => isRecentlyVerified(p.verifiedAt))
      }
      return all
    },
    featureCollection() {
      return toFeatureCollection(this.merged)
    },
    // Merged places annotated with distance from the user and sorted nearest
    // first. Empty until a user location is known. Online (BTCPay) merchants
    // are pushed to the end since their synthetic centroid distance is
    // meaningless for "near me".
    nearby(state) {
      const loc = state.userLocation
      if (!loc) return []
      const out = this.merged.map((p) => ({
        ...p,
        distance: distanceMeters(loc.lat, loc.lon, p.lat, p.lon),
      }))
      out.sort((a, b) => {
        if (a.online !== b.online) return a.online ? 1 : -1
        const da = a.distance ?? Infinity
        const db = b.distance ?? Infinity
        return da - db
      })
      return out
    },
    counts(state) {
      return {
        btcmap: state.btcmap.length,
        osm: state.osm.length,
        btcpay: state.btcpay.length,
      }
    },
    totalVisible() {
      return this.merged.length
    },
    isLoading(state) {
      return Object.values(state.loading).some(Boolean)
    },
    hasAnyError(state) {
      return Object.values(state.errors).some(Boolean)
    },
  },
  actions: {
    async loadGlobal() {
      // BTC Map + BTCPay are global, no bbox required. Run them in parallel.
      await Promise.allSettled([this.loadBtcMap(), this.loadBtcPay()])
    },

    async loadBtcMap() {
      if (this.loading.btcmap) return
      this.loading.btcmap = true
      this.errors.btcmap = null
      try {
        const cached = readCache(CACHE_KEYS.btcmap)
        if (cached) {
          this.btcmap = cached
        } else {
          const list = await fetchBtcMap()
          this.btcmap = list
          writeCache(CACHE_KEYS.btcmap, list)
        }
      } catch (e) {
        this.errors.btcmap = e.message || String(e)
      } finally {
        this.loading.btcmap = false
      }
    },

    async loadBtcPay() {
      if (this.loading.btcpay) return
      this.loading.btcpay = true
      this.errors.btcpay = null
      try {
        const cached = readCache(CACHE_KEYS.btcpay)
        if (cached) {
          this.btcpay = cached
        } else {
          const list = await fetchBtcPay()
          this.btcpay = list
          writeCache(CACHE_KEYS.btcpay, list)
        }
      } catch (e) {
        this.errors.btcpay = e.message || String(e)
      } finally {
        this.loading.btcpay = false
      }
    },

    async loadViewport(bbox, zoom) {
      // Overpass is bbox-scoped; gate at a regional zoom so the world-wide view
      // doesn't blow up the query, but a country-level zoom already populates.
      if (!bbox || zoom < 4) return
      this.lastViewportFetchAt = Date.now()
      const stamp = this.lastViewportFetchAt
      await this.loadOverpass(bbox, stamp)
    },

    async loadOverpass(bbox, stamp) {
      if (this.loading.osm) return
      this.loading.osm = true
      this.errors.osm = null
      try {
        const list = await fetchOverpass(bbox)
        // Discard if the viewport changed again while we were waiting.
        if (stamp === this.lastViewportFetchAt) this.osm = list
      } catch (e) {
        this.errors.osm = e.message || String(e)
      } finally {
        this.loading.osm = false
      }
    },

    setUserLocation(lat, lon) {
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        this.userLocation = { lat, lon }
      }
    },

    toggleSource(source) {
      this.enabled[source] = !this.enabled[source]
    },
    toggleBucket(bucket) {
      this.buckets[bucket] = !this.buckets[bucket]
    },
    toggleVerifiedRecentlyOnly() {
      this.verifiedRecentlyOnly = !this.verifiedRecentlyOnly
    },
  },
})
