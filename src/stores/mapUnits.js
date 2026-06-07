import { defineStore } from 'pinia'

// Distance unit preference for the map list + detail. 'auto' defers to the UI
// locale (en-US/en-GB → miles, else km); 'km' / 'mi' force a unit.
export const DISTANCE_UNITS = ['auto', 'km', 'mi']

const STORAGE_KEY = 'buhoGO_map_distance_unit_v1'
const DEFAULT_UNIT = 'auto'

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && DISTANCE_UNITS.includes(v)) return v
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return DEFAULT_UNIT
}

export const useMapUnitsStore = defineStore('mapUnits', {
  state: () => ({
    distanceUnit: readStored(),
  }),
  actions: {
    setDistanceUnit(unit) {
      if (!DISTANCE_UNITS.includes(unit) || unit === this.distanceUnit) return
      this.distanceUnit = unit
      try {
        localStorage.setItem(STORAGE_KEY, unit)
      } catch {
        // Best-effort persistence.
      }
    },
  },
})
