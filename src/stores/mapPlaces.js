import { defineStore } from 'pinia'
import { fetchBtcMap } from '../services/map/btcmap.js'
import { fetchOverpass } from '../services/map/overpass.js'
import { fetchBtcPay } from '../services/map/btcpay.js'
import { fetchBlink } from '../services/map/blink.js'
import { fetchBitcoinJungle } from '../services/map/bitcoinjungle.js'
import { fetchMoneyBadger } from '../services/map/moneybadger.js'
import {
  mergePlaces,
  toFeatureCollection,
  bucketFor,
  distanceMeters,
} from '../services/map/places.js'
import { useMapFavoritesStore } from './mapFavorites.js'

// Vendored from pratik227/bitcoinmap (store + services). See
// src/services/map/VENDORED.md. BuhoGO additions on top of the original store:
//   - userLocation + distance-sorted `listPlaces` getter (drives the list sheet)
//   - favoritesOnly filter
//   - `online` source records flow through unchanged
//
// Source caching uses sessionStorage with a short TTL so re-opening the map in
// the same session is instant without holding stale data across days.

const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_KEYS = {
  btcmap: 'btcmap-cache-v1',
  btcpay: 'btcpay-cache-v1',
  blink: 'blink-cache-v1',
  bitcoinjungle: 'bitcoinjungle-cache-v1',
  moneybadger: 'moneybadger-cache-v1',
}

// Max rows rendered in the list sheet. The map still shows every pin; the
// list shows the nearest slice so the scroll container stays light.
const LIST_CAP = 60

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

// Is a place inside the current viewport? MapLibre's getBounds() returns
// west > east when the viewport straddles the 180° meridian, so the longitude
// test wraps in that case (east of west OR west of east). Latitude never wraps.
function inBbox(p, bbox) {
  if (p.lat < bbox.south || p.lat > bbox.north) return false
  return bbox.west <= bbox.east
    ? p.lon >= bbox.west && p.lon <= bbox.east
    : p.lon >= bbox.west || p.lon <= bbox.east
}

export const useMapPlacesStore = defineStore('mapPlaces', {
  state: () => ({
    btcmap: [],
    osm: [],
    btcpay: [],
    blink: [],
    bitcoinjungle: [],
    moneybadger: [],

    enabled: { btcmap: true, osm: true, btcpay: true, blink: true, bitcoinjungle: true, moneybadger: true },
    buckets: { food: true, retail: true, lodging: true, services: true, atm: true, fuel: true, leisure: true, other: true },
    favoritesOnly: false,

    loading: { btcmap: false, osm: false, btcpay: false, blink: false, bitcoinjungle: false, moneybadger: false },
    errors: { btcmap: null, osm: null, btcpay: null, blink: null, bitcoinjungle: null, moneybadger: null },
    lastViewportFetchAt: 0,

    // Set once geolocation resolves. Distance origin preference for the list.
    userLocation: null, // { lat, lon } | null

    // Current map viewport, set on every move. The list reflects "places in
    // this area" (Google-Maps model) so it stays relevant and bounded rather
    // than rendering the whole global set.
    viewportBbox: null, // { south, west, north, east } | null
    viewportCenter: null, // { lat, lon } | null
  }),
  getters: {
    merged(state) {
      const lists = []
      if (state.enabled.btcmap) lists.push(state.btcmap)
      if (state.enabled.osm) lists.push(state.osm)
      if (state.enabled.btcpay) lists.push(state.btcpay)
      if (state.enabled.blink) lists.push(state.blink)
      if (state.enabled.bitcoinjungle) lists.push(state.bitcoinjungle)
      if (state.enabled.moneybadger) lists.push(state.moneybadger)
      let all = mergePlaces(...lists)
      all = all.filter((p) => state.buckets[bucketFor(p.category)])
      if (state.favoritesOnly) {
        // Saved-only narrows the whole map (pins + list + counts) to starred
        // places. The list then shows them globally; see listPlaces.
        const favs = useMapFavoritesStore().favoriteSet
        all = all.filter((p) => favs.has(p.id))
      }
      return all
    },
    featureCollection() {
      return toFeatureCollection(this.merged)
    },
    // The bottom-sheet list: merged places within the current viewport,
    // annotated with distance from the user (or the viewport centre when
    // location is unknown), sorted nearest-first, and capped so the scroll
    // list never renders tens of thousands of rows. Online (BTCPay) merchants
    // sort last — their synthetic centroid distance isn't a real "near me".
    listPlaces(state) {
      const bbox = state.viewportBbox
      const origin = state.userLocation || state.viewportCenter
      let list = this.merged
      // In Saved-only mode `merged` is already limited to favourites; show them
      // globally (skip the viewport filter) so saved places elsewhere still
      // appear, distance-sorted from the user. Otherwise clip to the viewport.
      if (!state.favoritesOnly && bbox) {
        list = list.filter((p) => inBbox(p, bbox))
      }
      if (origin) {
        list = list.map((p) => ({
          ...p,
          distance: distanceMeters(origin.lat, origin.lon, p.lat, p.lon),
        }))
      }
      list.sort((a, b) => {
        if (!!a.online !== !!b.online) return a.online ? 1 : -1
        const da = a.distance ?? Infinity
        const db = b.distance ?? Infinity
        if (da !== db) return da - db
        return (a.name || '').localeCompare(b.name || '')
      })
      // The viewport list is capped so the scroll container stays light; the
      // Saved-only list is a small, user-curated set so we show all of it.
      return state.favoritesOnly ? list : list.slice(0, LIST_CAP)
    },
    // How many places fall in the current viewport, before the list cap —
    // drives the "X places here" summary and the "showing nearest N" hint.
    visibleCount(state) {
      const bbox = state.viewportBbox
      if (!bbox) return this.merged.length
      let n = 0
      for (const p of this.merged) {
        if (inBbox(p, bbox)) n++
      }
      return n
    },
    counts(state) {
      return {
        btcmap: state.btcmap.length,
        osm: state.osm.length,
        btcpay: state.btcpay.length,
        blink: state.blink.length,
        bitcoinjungle: state.bitcoinjungle.length,
        moneybadger: state.moneybadger.length,
      }
    },
    isLoading(state) {
      return Object.values(state.loading).some(Boolean)
    },
  },
  actions: {
    async loadGlobal() {
      // All of these return their whole dataset in one shot (no bbox). Run them
      // in parallel; each fails soft into its own `errors[source]` slot.
      await Promise.allSettled([
        this.loadBtcMap(),
        this.loadBtcPay(),
        this.loadCachedSource('blink', fetchBlink),
        this.loadCachedSource('bitcoinjungle', fetchBitcoinJungle),
        this.loadCachedSource('moneybadger', fetchMoneyBadger),
      ])
    },

    // Generic loader for a global, cacheable source. Mirrors loadBtcMap/
    // loadBtcPay but parameterized so the regional Lightning directories
    // (Blink / Bitcoin Jungle / MoneyBadger) don't each need a bespoke action.
    async loadCachedSource(name, fetchFn) {
      if (this.loading[name]) return
      this.loading[name] = true
      this.errors[name] = null
      try {
        const cached = readCache(CACHE_KEYS[name])
        if (cached) {
          this[name] = cached
        } else {
          const list = await fetchFn()
          this[name] = list
          writeCache(CACHE_KEYS[name], list)
        }
      } catch (e) {
        this.errors[name] = e.message || String(e)
      } finally {
        this.loading[name] = false
      }
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

    setViewport(bbox, center) {
      this.viewportBbox = bbox || null
      this.viewportCenter = center || null
    },

    toggleSource(source) {
      this.enabled[source] = !this.enabled[source]
    },
    toggleBucket(bucket) {
      this.buckets[bucket] = !this.buckets[bucket]
    },
    toggleFavoritesOnly() {
      this.favoritesOnly = !this.favoritesOnly
    },
  },
})
