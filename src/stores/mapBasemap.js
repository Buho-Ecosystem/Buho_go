import { defineStore } from 'pinia'

// The basemap styles the user can pick from. All are free OpenFreeMap styles,
// no API key. Liberty is the default for both app themes — the basemap is the
// user's cartography choice, independent of the app's light/dark chrome.
export const BASEMAPS = ['liberty', 'positron', 'bright', 'dark', 'fiord']
export const BASEMAP_URLS = {
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  positron: 'https://tiles.openfreemap.org/styles/positron',
  bright: 'https://tiles.openfreemap.org/styles/bright',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  fiord: 'https://tiles.openfreemap.org/styles/fiord',
}
export const BASEMAP_LABELS = {
  liberty: 'Liberty',
  positron: 'Positron',
  bright: 'Bright',
  dark: 'Dark',
  fiord: 'Fiord',
}

const STORAGE_KEY = 'buhoGO_map_basemap_v1'
const PITCH_KEY = 'buhoGO_map_pitch3d_v1'
const DEFAULT_STYLE = 'liberty'

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && BASEMAPS.includes(v)) return v
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return DEFAULT_STYLE
}

function readPitch() {
  try {
    return localStorage.getItem(PITCH_KEY) === 'true'
  } catch {
    return false
  }
}

export const useMapBasemapStore = defineStore('mapBasemap', {
  state: () => ({
    style: readStored(),
    // 3D view: tilt the camera so styles with building extrusions (Liberty,
    // Bright) render in perspective. Off by default.
    pitch3D: readPitch(),
  }),
  getters: {
    styleUrl: (state) => BASEMAP_URLS[state.style] || BASEMAP_URLS[DEFAULT_STYLE],
  },
  actions: {
    setStyle(name) {
      if (!BASEMAPS.includes(name) || name === this.style) return
      this.style = name
      try {
        localStorage.setItem(STORAGE_KEY, name)
      } catch {
        // Best-effort persistence.
      }
    },
    togglePitch() {
      this.pitch3D = !this.pitch3D
      try {
        localStorage.setItem(PITCH_KEY, String(this.pitch3D))
      } catch {
        // Best-effort persistence.
      }
    },
  },
})
