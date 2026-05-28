<script setup>
import { ref, computed, onMounted, getCurrentInstance } from 'vue'
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
import MapBottomSheet from '../components/map/MapBottomSheet.vue'
import PlaceListRow from '../components/map/PlaceListRow.vue'

/**
 * MapPage — orchestrator for the Bitcoin merchant map.
 *
 * Owns the places store, the bottom sheet (peek/half/full), selected place,
 * the user-location flow, and the map↔list sync. MapView is a dumb surface;
 * the sheet is the distance-sorted nearby list. Place detail + directions +
 * share land in phase 4.
 */

const router = useRouter()
const $q = useQuasar()
// vue-i18n legacy mode (src/boot/i18n.js): reach $t through the proxy.
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const store = useMapPlacesStore()
const { featureCollection, userLocation, listPlaces, visibleCount } = storeToRefs(store)

const mapRef = ref(null)
const sheetRef = ref(null)
const selectedId = ref('')
const locating = ref(false)

const sheetDetent = ref('peek')
const sheetHeight = ref(124)
const sheetDragging = ref(false)

const isDark = computed(() => $q.dark.isActive)

// Controls ride above the sheet but never higher than ~half the screen
// (beyond that the sheet covers the map below them anyway).
const controlsInset = computed(() => {
  const cap = (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.5
  return Math.min(sheetHeight.value, cap) + 16
})

const summaryText = computed(() => {
  const n = visibleCount.value
  if (store.isLoading && n === 0) return t('Finding places…')
  if (n === 0) return t('No places in this area')
  return t('{n} places here', { n })
})

const listTruncated = computed(() => visibleCount.value > listPlaces.value.length)

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/settings')
}

function onMapReady() {
  store.loadGlobal()
}

function onMapMove({ bbox, center, zoom }) {
  store.setViewport(bbox, center)
  store.loadViewport(bbox, zoom)
}

// Tapping a pin or a list row: highlight, center, and lift the sheet to half
// so map + list are both visible.
function selectPlace(place) {
  selectedId.value = place.id || ''
  const lat = Number(place.lat)
  const lon = Number(place.lon)
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    mapRef.value?.flyTo(lat, lon, 15)
  }
  if (sheetDetent.value === 'peek') sheetRef.value?.setDetent('half')
}

function onSheetHeight(px) {
  sheetHeight.value = px
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
        message: t('Location permission denied'),
        caption: t('Enable location access to find shops near you.'),
        timeout: 3500,
        position: 'top',
      })
    } else if (err.code === GEO_ERROR.UNSUPPORTED) {
      $q.notify({ type: 'warning', message: t('Location not available on this device'), timeout: 3000, position: 'top' })
    } else {
      $q.notify({ type: 'warning', message: t("Couldn't get your location"), timeout: 3000, position: 'top' })
    }
  } finally {
    locating.value = false
  }
}

onMounted(async () => {
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
      :bottom-inset="controlsInset"
      :controls-animated="!sheetDragging"
      @ready="onMapReady"
      @move="onMapMove"
      @select="selectPlace"
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

    <!-- Bottom sheet = the distance-sorted nearby list. -->
    <MapBottomSheet
      ref="sheetRef"
      v-model="sheetDetent"
      @height="onSheetHeight"
      @dragging="(v) => (sheetDragging = v)"
    >
      <template #header>
        <div class="sheet-summary">
          <span class="sheet-summary-count">{{ summaryText }}</span>
          <q-spinner-dots
            v-if="store.isLoading"
            size="18px"
            :color="isDark ? 'brand-green' : 'brand-green-dark'"
          />
        </div>
      </template>

      <div class="sheet-list">
        <PlaceListRow
          v-for="p in listPlaces"
          :key="p.id"
          :place="p"
          :selected="p.id === selectedId"
          @select="selectPlace"
        />
        <div v-if="listTruncated" class="sheet-truncated">
          {{ $t('Showing the nearest {n}. Zoom in for more.', { n: listPlaces.length }) }}
        </div>
        <div v-else-if="listPlaces.length === 0 && !store.isLoading" class="sheet-empty">
          {{ $t('No Bitcoin places in view. Pan or zoom out to explore.') }}
        </div>
      </div>
    </MapBottomSheet>
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
  z-index: 9;
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

/* Sheet header summary */
.sheet-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 2px 2px 8px;
}
.sheet-summary-count {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.sheet-list {
  display: flex;
  flex-direction: column;
  padding: 0 4px;
}
.sheet-truncated,
.sheet-empty {
  padding: 14px 16px 8px;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  color: var(--text-muted);
}
</style>
