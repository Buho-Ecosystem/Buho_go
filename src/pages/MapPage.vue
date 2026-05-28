<script setup>
import { ref, computed, onMounted, watch, getCurrentInstance } from 'vue'
import { Icon } from '@iconify/vue'
import { useRouter, useRoute } from 'vue-router'
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
import PlaceDetail from '../components/map/PlaceDetail.vue'
import MapSearch from '../components/map/MapSearch.vue'
import MapFilters from '../components/map/MapFilters.vue'

/**
 * MapPage — orchestrator for the Bitcoin merchant map.
 *
 * Owns the places store, the bottom sheet (peek/half/full), selected place,
 * the user-location flow, and the map↔list sync. MapView is a dumb surface;
 * the sheet is the distance-sorted nearby list. Place detail + directions +
 * share land in phase 4.
 */

const router = useRouter()
const route = useRoute()
const $q = useQuasar()
// vue-i18n legacy mode (src/boot/i18n.js): reach $t through the proxy.
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const store = useMapPlacesStore()
const { featureCollection, userLocation, listPlaces, visibleCount } = storeToRefs(store)

const mapRef = ref(null)
const sheetRef = ref(null)
const selectedId = ref('')
const selectedPlace = ref(null) // canonical detail object, null = show list
const locating = ref(false)

const sheetDetent = ref('peek')
const sheetHeight = ref(124)
const sheetDragging = ref(false)

const showSearch = ref(false)
const showFilters = ref(false)

// The map view's own light/dark. Initialised from the app theme on mount, then
// owned by the in-map toggle. Drives the basemap AND the whole chrome (top bar,
// controls, sheet, list, detail) via a theme-scope class on the page root — so
// the toggle is all-or-nothing, never half-applied.
const mapDark = ref($q.dark.isActive)
const isDark = computed(() => mapDark.value)

function toggleBasemap() {
  mapDark.value = !mapDark.value
}

// Whether any filter deviates from the all-on default — drives the dot on the
// filter button so the user knows results are being narrowed.
const filtersActive = computed(() => {
  const e = store.enabled
  const b = store.buckets
  return (
    store.verifiedRecentlyOnly ||
    !e.btcmap || !e.osm || !e.btcpay ||
    Object.values(b).some((v) => !v)
  )
})

// The primary global source failing is worth surfacing; Overpass (osm) rate-
// limiting is common and noisy, so we don't banner on that alone.
const showErrorBanner = computed(
  () => !!store.errors.btcmap && store.btcmap.length === 0,
)
const showSkeleton = computed(
  () => store.isLoading && store.listPlaces.length === 0,
)

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

// Normalize either a list place (payments object, sources[]) or a pin's
// flattened feature properties (payOnchain/payLightning flags) into one shape
// PlaceDetail can consume.
function toDetail(p) {
  const payments = p.payments || {
    onchain: Number(p.payOnchain) === 1,
    lightning: Number(p.payLightning) === 1,
    lightningContactless: Number(p.payContactless) === 1,
  }
  const sources = p.sources
    ? (Array.isArray(p.sources) ? p.sources : String(p.sources).split(','))
    : (p.source ? [p.source] : [])
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    osmId: p.osmId || '',
    lat: Number(p.lat),
    lon: Number(p.lon),
    address: p.address || '',
    website: p.website || '',
    phone: p.phone || '',
    email: p.email || '',
    openingHours: p.openingHours || '',
    verifiedAt: p.verifiedAt || '',
    online: !!p.online || Number(p.online) === 1,
    distance: p.distance ?? null,
    sources,
    payments,
  }
}

// Tapping a pin or a list row: open the detail, lift the sheet to at least
// half, and fly to the place — offsetting the camera so the pin lands in the
// map area above the sheet rather than behind it.
function selectPlace(place) {
  selectedId.value = place.id || ''
  selectedPlace.value = toDetail(place)

  // The sheet settles to at least half on select, so offset the fly by the
  // half height (or the current height if already taller) to keep the pin
  // visible above it.
  if (sheetDetent.value === 'peek') sheetRef.value?.setDetent('half')
  const halfPx = (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.5
  const inset = Math.min(Math.max(sheetHeight.value, halfPx), (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.55)

  const lat = Number(place.lat)
  const lon = Number(place.lon)
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    mapRef.value?.flyTo(lat, lon, 15, { bottomInset: inset })
  }
}

function backToList() {
  selectedPlace.value = null
  selectedId.value = ''
}

// User grabbed the map: if the sheet is hogging the screen, drop it to half so
// it's out of the way. Gentle — we don't collapse half→peek, which would feel
// like the sheet is running from the user.
function onUserPan() {
  if (sheetDetent.value === 'full') sheetRef.value?.setDetent('half')
}

function onSheetHeight(px) {
  sheetHeight.value = px
}

function onSearchLocate({ lat, lon }) {
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    mapRef.value?.flyTo(lat, lon, 13)
  }
}

function retryLoad() {
  store.loadGlobal()
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

// Deep-link: /#/map?place=<id>. We can't select until the place exists in the
// merged set, so watch the data and resolve once. `pendingPlaceId` is consumed
// on first match so a later data refresh doesn't re-open the sheet.
const pendingPlaceId = ref('')

function tryResolveDeepLink() {
  if (!pendingPlaceId.value) return
  const match = store.merged.find((p) => p.id === pendingPlaceId.value)
  if (match) {
    pendingPlaceId.value = ''
    selectPlace(match)
  }
}

watch(() => store.merged, tryResolveDeepLink)

onMounted(async () => {
  const placeId = route.query.place
  if (typeof placeId === 'string' && placeId) {
    pendingPlaceId.value = placeId
    tryResolveDeepLink() // in case data is already cached this session
  }

  const perm = await checkLocationPermission()
  // Don't yank the camera away from a deep-linked place with an auto-locate.
  if (perm === 'granted' && !pendingPlaceId.value && !selectedPlace.value) {
    locateUser({ silent: true })
  }
})
</script>

<template>
  <q-page class="map-page" :class="mapDark ? 'map-theme-dark' : 'map-theme-light'">
    <MapView
      ref="mapRef"
      :data="featureCollection"
      :dark="mapDark"
      :selected-id="selectedId"
      :user-location="userLocation"
      :bottom-inset="controlsInset"
      :controls-animated="!sheetDragging"
      @ready="onMapReady"
      @move="onMapMove"
      @select="selectPlace"
      @recenter-request="locateUser"
      @user-pan="onUserPan"
      @toggle-basemap="toggleBasemap"
    />

    <!-- Top bar: back + search pill + filter. Below the safe-area inset. -->
    <header class="map-topbar">
      <button class="map-back" type="button" @click="goBack" aria-label="Back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <button class="map-search-pill" type="button" @click="showSearch = true" :aria-label="$t('Find a place')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span class="map-search-text">
          <span class="map-search-title">{{ $t('Bitcoin Map') }}</span>
          <span class="map-search-sub">{{ $t('Find a place') }}</span>
        </span>
      </button>

      <button
        class="map-filter-btn"
        type="button"
        :class="{ active: filtersActive }"
        @click="showFilters = true"
        :aria-label="$t('Filters')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="18" x2="14" y2="18" />
        </svg>
        <span v-if="filtersActive" class="map-filter-dot" />
      </button>
    </header>

    <!-- Source-failure banner (primary global source only). -->
    <transition name="banner-slide">
      <div v-if="showErrorBanner" class="map-banner">
        <Icon icon="tabler:cloud-off" width="16" height="16" />
        <span>{{ $t("Couldn't load places. Check your connection.") }}</span>
        <button type="button" class="map-banner-retry" @click="retryLoad">{{ $t('Retry') }}</button>
      </div>
    </transition>

    <MapSearch :open="showSearch" @close="showSearch = false" @locate="onSearchLocate" />
    <MapFilters v-model="showFilters" :dark="mapDark" />

    <!-- Bottom sheet = the distance-sorted nearby list. -->
    <MapBottomSheet
      ref="sheetRef"
      v-model="sheetDetent"
      @height="onSheetHeight"
      @dragging="(v) => (sheetDragging = v)"
    >
      <template #header>
        <div v-if="!selectedPlace" class="sheet-summary">
          <span class="sheet-summary-count">{{ summaryText }}</span>
          <q-spinner-dots
            v-if="store.isLoading"
            size="18px"
            :color="isDark ? 'brand-green' : 'brand-green-dark'"
          />
        </div>
      </template>

      <!-- Detail card replaces the list when a place is selected. -->
      <PlaceDetail
        v-if="selectedPlace"
        :place="selectedPlace"
        @back="backToList"
      />

      <div v-else class="sheet-list">
        <!-- Loading skeleton: shimmer rows while the first data lands. -->
        <template v-if="showSkeleton">
          <div v-for="i in 6" :key="'sk' + i" class="skel-row">
            <div class="skel-icon" />
            <div class="skel-lines">
              <div class="skel-line skel-line-name" />
              <div class="skel-line skel-line-sub" />
            </div>
          </div>
        </template>

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

/* Map-local theme scope tokens live in app.css as global .map-theme-dark /
   .map-theme-light so they also apply to the teleported filter dialog. The
   class is bound on the page root above. */

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

.map-search-pill {
  all: unset;
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 52px;
  padding: 0 18px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 999px;
  box-shadow: var(--shadow-md);
  cursor: pointer;
  color: var(--text-primary);
  -webkit-tap-highlight-color: transparent;
}
.map-search-pill:active { transform: scale(0.99); }
.map-search-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.map-search-title {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.1;
}
.map-search-sub {
  font-family: 'Manrope', sans-serif;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-muted);
}

.map-filter-btn {
  position: relative;
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
.map-filter-btn:active { transform: scale(0.94); }
.map-filter-btn.active { border-color: var(--map-accent); }
.map-filter-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--map-accent);
  border: 1.5px solid var(--bg-card);
}

/* Error banner */
.map-banner {
  position: absolute;
  top: calc(var(--safe-top, 0px) + 72px);
  left: 14px;
  right: 14px;
  z-index: 8;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  box-shadow: var(--shadow-md);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: var(--text-secondary);
}
.map-banner span { flex: 1; }
.map-banner-retry {
  all: unset;
  cursor: pointer;
  font-weight: 700;
  color: var(--map-accent);
  padding: 2px 4px;
}
.banner-slide-enter-active,
.banner-slide-leave-active { transition: opacity 200ms ease, transform 200ms ease; }
.banner-slide-enter-from,
.banner-slide-leave-to { opacity: 0; transform: translateY(-8px); }

/* Loading skeleton rows */
.skel-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}
.skel-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--bg-input);
  flex-shrink: 0;
}
.skel-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.skel-line { height: 11px; border-radius: 6px; background: var(--bg-input); }
.skel-line-name { width: 55%; }
.skel-line-sub { width: 32%; }
.skel-icon,
.skel-line {
  animation: skel-pulse 1.3s ease-in-out infinite;
}
@keyframes skel-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .skel-icon, .skel-line { animation: none; }
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
