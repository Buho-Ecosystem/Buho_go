<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { storeToRefs } from 'pinia'
import { useMapPlacesStore } from '../stores/mapPlaces.js'
import {
  getCurrentPosition,
  checkLocationPermission,
  GEO_ERROR,
} from '../utils/mapGeolocation.js'
import MapView from '../components/map/MapView.vue'

/**
 * MapPage — orchestrator for the Bitcoin merchant map.
 *
 * Owns: the places store, the selected-place + user-location state, the
 * geolocation flow, and (in later phases) the bottom sheet, filters, and
 * search. MapView is a dumb surface that reports taps + viewport changes.
 */

const router = useRouter()
const $q = useQuasar()
const store = useMapPlacesStore()
const { featureCollection, userLocation } = storeToRefs(store)

const mapRef = ref(null)
const selectedId = ref('')
const locating = ref(false)

const isDark = computed(() => $q.dark.isActive)

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/settings')
}

function onMapReady() {
  // Kick the global sources (BTC Map + BTCPay) once the map is up.
  store.loadGlobal()
}

function onMapMove({ bbox, zoom }) {
  store.loadViewport(bbox, zoom)
}

function onSelect(placeProps) {
  // Phase 3 opens the detail sheet here. For now just highlight the pin and
  // center it.
  selectedId.value = placeProps.id || ''
  const lat = Number(placeProps.lat)
  const lon = Number(placeProps.lon)
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    mapRef.value?.flyTo(lat, lon, Math.max(15, 14))
  }
}

async function locateUser({ silent = false } = {}) {
  if (locating.value) return
  locating.value = true
  try {
    const pos = await getCurrentPosition()
    store.setUserLocation(pos.lat, pos.lon)
    mapRef.value?.flyTo(pos.lat, pos.lon, 14)
  } catch (err) {
    if (silent) return
    if (err.code === GEO_ERROR.PERMISSION_DENIED) {
      $q.notify({
        type: 'warning',
        message: 'Location permission denied',
        caption: 'Enable location access to find shops near you.',
        timeout: 3500,
        position: 'top',
      })
    } else if (err.code === GEO_ERROR.UNSUPPORTED) {
      $q.notify({ type: 'warning', message: 'Location not available on this device', timeout: 3000, position: 'top' })
    } else {
      $q.notify({ type: 'warning', message: "Couldn't get your location", timeout: 3000, position: 'top' })
    }
  } finally {
    locating.value = false
  }
}

onMounted(async () => {
  // Respectful auto-locate: only resolve a position without a prompt if the
  // user has already granted permission. Otherwise wait for the locate tap.
  const perm = await checkLocationPermission()
  if (perm === 'granted') locateUser({ silent: true })
})
</script>

<template>
  <q-page class="map-page">
    <MapView
      ref="mapRef"
      :data="featureCollection"
      :dark="isDark"
      :selected-id="selectedId"
      :user-location="userLocation"
      :bottom-inset="36"
      @ready="onMapReady"
      @move="onMapMove"
      @select="onSelect"
      @recenter-request="locateUser"
    />

    <!-- Top bar: back + title pill. Sits below the safe-area inset. -->
    <header class="map-topbar">
      <button class="map-back" type="button" @click="goBack" aria-label="Back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <div class="map-title">
        <span class="map-title-main">{{ $t('Bitcoin Map') }}</span>
        <span class="map-title-sub">{{ $t('Spend Bitcoin near you') }}</span>
      </div>
    </header>
  </q-page>
</template>

<style scoped>
.map-page {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

.map-topbar {
  position: absolute;
  top: calc(var(--safe-top, 0px) + 12px);
  left: 14px;
  right: 14px;
  z-index: 7;
  display: flex;
  align-items: center;
  gap: 12px;
  pointer-events: none;
}
.map-topbar > * { pointer-events: auto; }

.map-back {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-card);
  border-radius: 50%;
  box-shadow: var(--shadow-md);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.map-back:active { transform: scale(0.94); }

.map-title {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md, 16px);
  box-shadow: var(--shadow-md);
}
.map-title-main {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.1;
}
.map-title-sub {
  font-family: 'Manrope', sans-serif;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-muted);
}
</style>
