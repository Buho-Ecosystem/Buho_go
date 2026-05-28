import { defineStore } from 'pinia'

// Starred map places, keyed by the normalized place id (e.g. "btcmap:123",
// "osm:node/456"). Persisted to localStorage so saves survive across sessions.
// Synchronous storage keeps the getters reactive without async plumbing.
const STORAGE_KEY = 'buhoGO_map_favorites_v1'

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export const useMapFavoritesStore = defineStore('mapFavorites', {
  state: () => ({
    ids: load(),
  }),
  getters: {
    favoriteSet: (state) => new Set(state.ids),
    count: (state) => state.ids.length,
    // Returns a predicate so templates can do `isFavorite(place.id)`.
    isFavorite: (state) => (id) => state.ids.includes(id),
  },
  actions: {
    toggle(id) {
      if (!id) return
      const i = this.ids.indexOf(id)
      if (i >= 0) this.ids.splice(i, 1)
      else this.ids.push(id)
      this._persist()
    },
    _persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ids))
      } catch {
        // Quota / unavailable storage — keep the in-memory set for the session.
      }
    },
  },
})
