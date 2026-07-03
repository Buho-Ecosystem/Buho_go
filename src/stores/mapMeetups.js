import { defineStore } from 'pinia'
import { fetchMeetups } from '../services/map/meetups.js'

// Einundzwanzig meetups layer — a separate, opt-in point layer on the Bitcoin
// map. Kept out of the merchant places store because meetups are a distinct
// thing (recurring community gatherings, not shops): they have their own pin
// (the Einundzwanzig logo), their own detail card, and lazy-load only when the
// user enables the layer. Vendored from pratik227/bitcoinmap (stores/meetups.js).

const EMPTY_FC = { type: 'FeatureCollection', features: [] }

export const useMapMeetupsStore = defineStore('mapMeetups', {
  state: () => ({
    featureCollection: null,
    enabled: false,
    loading: false,
    error: null,
  }),
  getters: {
    loaded(state) {
      return state.featureCollection !== null
    },
    count(state) {
      return state.featureCollection?.features?.length || 0
    },
    // What MapView renders: the meetup features when the layer is on, an empty
    // collection otherwise. Keeping the layer always-present (just empty when
    // off) avoids tearing the MapLibre source down and back up on every toggle.
    visibleCollection(state) {
      return state.enabled && state.featureCollection ? state.featureCollection : EMPTY_FC
    },
  },
  actions: {
    async load() {
      if (this.loading || this.featureCollection) return
      this.loading = true
      this.error = null
      try {
        this.featureCollection = await fetchMeetups()
      } catch (e) {
        this.error = e.message || String(e)
      } finally {
        this.loading = false
      }
    },
    toggle() {
      this.enabled = !this.enabled
      if (this.enabled && !this.featureCollection && !this.loading) {
        void this.load()
      }
    },
  },
})
