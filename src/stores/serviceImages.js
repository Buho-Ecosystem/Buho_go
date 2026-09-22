import { defineStore } from 'pinia'
import { SERVICE_IMAGE_DATA_URL_MAX } from '../utils/lnurlMetadata.js'

/**
 * Local registry of service logos (LUD-06 `image/*;base64` entries), keyed
 * by the canonical payment address of the service that sent them.
 *
 * Kept apart from the address book on purpose: a picture is the one part of
 * a service's metadata that must never travel. The shared contacts doc, the
 * Lotus mirror and every backup payload copy explicit fields from the
 * address book entry; nothing reads this store but the avatars. Small,
 * bounded, and safe to lose: the next payment to the service refills it.
 */

const STORAGE_KEY = 'buhoGO_service_images'
const MAX_ENTRIES = 40

function keyOf(address) {
  return typeof address === 'string' ? address.trim().toLowerCase() : ''
}

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    const images = parsed && typeof parsed.images === 'object' && parsed.images ? parsed.images : {}
    const clean = {}
    for (const [key, entry] of Object.entries(images)) {
      if (typeof entry?.dataUrl === 'string' && entry.dataUrl.startsWith('data:image/') && entry.dataUrl.length <= SERVICE_IMAGE_DATA_URL_MAX) {
        clean[key] = { dataUrl: entry.dataUrl, updatedAt: Number(entry.updatedAt) || 0 }
      }
    }
    return clean
  } catch {
    return {}
  }
}

export const useServiceImagesStore = defineStore('serviceImages', {
  state: () => ({
    // Read synchronously so avatars resolve on first paint; there is nothing
    // async about a localStorage read.
    images: typeof localStorage !== 'undefined' ? load() : {},
  }),

  getters: {
    /** The stored data URL for a canonical address, or null. */
    get: (state) => (address) => state.images[keyOf(address)]?.dataUrl || null,
  },

  actions: {
    persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ images: this.images }))
      } catch (error) {
        console.warn('[serviceImages] could not persist:', error)
      }
    },

    /**
     * Remember a downscaled logo for an address. Refuses anything that is
     * not a small image data URL. Least recently updated entries fall off
     * the end once the cap is reached.
     * @param {string} address  canonical address (lowercase LNURL or Lightning address)
     * @param {string} dataUrl  from normalizeServiceImage()
     * @returns {boolean} whether it was stored
     */
    put(address, dataUrl) {
      const key = keyOf(address)
      if (!key || typeof dataUrl !== 'string') return false
      if (!dataUrl.startsWith('data:image/') || dataUrl.length > SERVICE_IMAGE_DATA_URL_MAX) return false
      const next = { ...this.images, [key]: { dataUrl, updatedAt: Date.now() } }
      const keys = Object.keys(next).sort((a, b) => (next[b].updatedAt || 0) - (next[a].updatedAt || 0))
      for (const stale of keys.slice(MAX_ENTRIES)) delete next[stale]
      this.images = next
      this.persist()
      return true
    },

    remove(address) {
      const key = keyOf(address)
      if (!key || !this.images[key]) return
      const next = { ...this.images }
      delete next[key]
      this.images = next
      this.persist()
    },
  },
})
