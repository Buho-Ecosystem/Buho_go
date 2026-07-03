import { defineStore } from 'pinia'
import { fetchDirectoryShops, fetchMarketShops } from '../services/onlineShops'

/**
 * Online-shops directory store.
 *
 * Two facets: 'shops' (the core BitcoinListings + BTCPay directory, loaded up
 * front) and 'nostr' (NIP-15 markets, loaded lazily the first time the user
 * opens that segment so the Nostr code/relays never touch first paint).
 * Filters apply to whichever facet is active. Network + caching live in the
 * service; this store holds view state + derived getters.
 */
function defaultFilters() {
  return {
    search: '',
    category: 'all',
    country: 'any', // 'any' | 'WW' | <ISO alpha-2>
    payments: { lightning: false, onchain: false },
    sources: { listings: true, btcpay: true }, // shops facet only
  }
}

export const useOnlineShopsStore = defineStore('onlineShops', {
  state: () => ({
    directory: [],
    market: [],
    loading: { directory: false, market: false },
    errors: {}, // per-source: { listings?, btcpay?, nostr? }
    loadedDirectory: false,
    loadedMarket: false,
    facet: 'shops', // 'shops' | 'nostr'
    filters: defaultFilters(),
  }),

  getters: {
    /** Shops in the active facet after applying the filters. */
    filtered(state) {
      const list = state.facet === 'nostr' ? state.market : state.directory
      const q = state.filters.search.trim().toLowerCase()
      const { category, country } = state.filters
      const { lightning, onchain } = state.filters.payments
      const sources = state.filters.sources
      return list.filter((s) => {
        if (q && !(
          (s.name && s.name.toLowerCase().includes(q)) ||
          (s.host && s.host.includes(q)) ||
          (s.description && s.description.toLowerCase().includes(q))
        )) return false
        if (category && category !== 'all' && s.category !== category) return false
        if (country === 'WW') { if (s.country?.code !== 'WW') return false }
        else if (country && country !== 'any' && s.country?.code !== country) return false
        if (lightning && !s.payments?.lightning) return false
        if (onchain && !s.payments?.onchain) return false
        if (state.facet === 'shops') {
          const ok = (s.sources && s.sources.length ? s.sources : [s.source])
            .some((src) => sources[src] !== false)
          if (!ok) return false
        }
        return true
      })
    },

    /** Distinct categories present in the active facet (for the chip row). */
    categoriesPresent(state) {
      const list = state.facet === 'nostr' ? state.market : state.directory
      return Array.from(new Set(list.map((s) => s.category))).sort()
    },

    /** Distinct named countries in the directory (for the filter dropdown). */
    countriesPresent(state) {
      const map = new Map()
      for (const s of state.directory) {
        if (s.country && s.country.code && s.country.code !== 'WW' && !map.has(s.country.code)) {
          map.set(s.country.code, s.country)
        }
      }
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
    },

    /** Top-ranked directory shops for the "Popular" carousel (unfiltered view). */
    popular(state) {
      return state.directory.slice(0, 8)
    },

    activeFilterCount(state) {
      let n = 0
      if (state.filters.category !== 'all') n += 1
      if (state.filters.country !== 'any') n += 1
      if (state.filters.payments.lightning) n += 1
      if (state.filters.payments.onchain) n += 1
      if (state.facet === 'shops') {
        if (!state.filters.sources.listings) n += 1
        if (!state.filters.sources.btcpay) n += 1
      }
      return n
    },

    hasActiveQuery(state) {
      return state.filters.search.trim().length > 0 || this.activeFilterCount > 0
    },
  },

  actions: {
    async loadDirectory({ force = false } = {}) {
      if (this.loading.directory) return
      if (this.loadedDirectory && !force) return
      this.loading.directory = true
      try {
        const { shops, errors } = await fetchDirectoryShops()
        this.directory = shops
        this.errors = { ...this.errors, listings: errors.listings, btcpay: errors.btcpay }
        this.loadedDirectory = true
      } finally {
        this.loading.directory = false
      }
    },

    async loadMarket({ force = false } = {}) {
      if (this.loading.market) return
      if (this.loadedMarket && !force) return
      this.loading.market = true
      try {
        const { shops, errors } = await fetchMarketShops()
        this.market = shops
        this.errors = { ...this.errors, nostr: errors.nostr }
        this.loadedMarket = true
      } finally {
        this.loading.market = false
      }
    },

    setFacet(facet) {
      if (facet !== 'shops' && facet !== 'nostr') return
      this.facet = facet
      if (facet === 'nostr') this.loadMarket()
    },

    setSearch(v) { this.filters.search = v || '' },
    setCategory(c) { this.filters.category = c || 'all' },
    setCountry(c) { this.filters.country = c || 'any' },
    togglePayment(key) { this.filters.payments[key] = !this.filters.payments[key] },
    toggleSource(key) { this.filters.sources[key] = !this.filters.sources[key] },
    resetFilters() { this.filters = defaultFilters() },

    retry() {
      if (this.facet === 'nostr') this.loadMarket({ force: true })
      else this.loadDirectory({ force: true })
    },
  },
})
