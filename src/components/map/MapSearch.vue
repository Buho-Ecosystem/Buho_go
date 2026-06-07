<script setup>
import { ref, computed, nextTick, watch, onBeforeUnmount, getCurrentInstance } from 'vue'
import { Icon } from '@iconify/vue'
import { useMapPlacesStore } from '../../stores/mapPlaces.js'
import { distanceMeters } from '../../services/map/places.js'
import PlaceListRow from './PlaceListRow.vue'

/**
 * MapSearch — a full-screen search overlay with two complementary lookups:
 *
 *  • Merchants — live, local filtering of the loaded places by name as the
 *    user types (debounced, no network). Emits `select` so the parent flies
 *    to the place and opens its detail.
 *  • Place — a debounced background geocode of the same query via Nominatim
 *    (the bulk dataset has no per-merchant city, so a city search can't be a
 *    local filter). The top hit surfaces as a tappable "go here" row that
 *    emits `locate` to jump the map there.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'locate', 'select'])

const { proxy } = getCurrentInstance()

const store = useMapPlacesStore()

const query = ref('')
const debounced = ref('')
const inputRef = ref(null)

const MIN_CHARS = 2
const RESULT_CAP = 25
const GEO_MIN_CHARS = 3
const GEO_DEBOUNCE_MS = 500

// The local merchant filter debounces fast (a 28k-row scan is cheap). The
// place lookup hits the network, so it debounces slower — one request per
// typing pause — to respect Nominatim's usage policy.
let filterTimer = null
let geoTimer = null
watch(query, (v) => {
  clearTimeout(filterTimer)
  filterTimer = setTimeout(() => { debounced.value = v }, 150)
  clearTimeout(geoTimer)
  geoTimer = setTimeout(() => lookupPlace(v), GEO_DEBOUNCE_MS)
})

const hasQuery = computed(() => debounced.value.trim().length >= MIN_CHARS)

const results = computed(() => {
  const q = debounced.value.trim().toLowerCase()
  if (q.length < MIN_CHARS) return []
  const origin = store.userLocation || store.viewportCenter
  const matched = []
  for (const p of store.merged) {
    if (p.name && p.name.toLowerCase().includes(q)) {
      matched.push(
        origin
          ? { ...p, distance: distanceMeters(origin.lat, origin.lon, p.lat, p.lon) }
          : p,
      )
    }
  }
  // Nearest first; online (centroid) merchants last; name as tiebreak.
  matched.sort((a, b) => {
    if (!!a.online !== !!b.online) return a.online ? 1 : -1
    const da = a.distance ?? Infinity
    const db = b.distance ?? Infinity
    if (da !== db) return da - db
    return (a.name || '').localeCompare(b.name || '')
  })
  return matched.slice(0, RESULT_CAP)
})

// ── Place lookup (geocode the query as a city/address) ──────────────────────
// `geoResult` is the top Nominatim hit, surfaced as a "go here" row. `geoSeq`
// discards a response whose query has already changed (stale, out-of-order).
const geoResult = ref(null) // { lat, lon, label } | null
const geoLoading = ref(false)
let geoSeq = 0

async function lookupPlace(raw) {
  const term = (raw || '').trim()
  const seq = ++geoSeq
  geoResult.value = null
  if (term.length < GEO_MIN_CHARS) {
    geoLoading.value = false
    return
  }
  geoLoading.value = true
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
      encodeURIComponent(term)
    const res = await fetch(url, {
      headers: { 'Accept-Language': proxy.$i18n.locale || 'en' },
    })
    if (seq !== geoSeq || !res.ok) return
    const hit = (await res.json())[0]
    if (seq !== geoSeq) return
    if (hit) {
      geoResult.value = { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name }
    }
  } catch {
    // Network / parse error — leave the row hidden; merchant search still works.
  } finally {
    if (seq === geoSeq) geoLoading.value = false
  }
}

function resetSearch() {
  query.value = ''
  debounced.value = ''
  geoResult.value = null
  geoLoading.value = false
  geoSeq++ // invalidate any in-flight lookup
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) nextTick(() => inputRef.value?.focus())
    else resetSearch()
  },
)

function onSelectResult(place) {
  emit('select', place)
  emit('close')
}

function goToPlace() {
  if (!geoResult.value) return
  emit('locate', { lat: geoResult.value.lat, lon: geoResult.value.lon })
  emit('close')
}

// Enter: open the top merchant match, else jump to the looked-up place.
function onEnter() {
  if (results.value.length) onSelectResult(results.value[0])
  else if (geoResult.value) goToPlace()
}

onBeforeUnmount(() => {
  clearTimeout(filterTimer)
  clearTimeout(geoTimer)
})
</script>

<template>
  <transition name="search-fade">
    <div v-if="open" class="search-overlay" @click.self="emit('close')">
      <div class="search-card">
        <div class="search-card-head">
          <span class="search-card-title">{{ $t('Find a place') }}</span>
          <button class="search-close" type="button" @click="emit('close')" :aria-label="$t('Close search')">
            <Icon icon="tabler:x" width="18" height="18" />
          </button>
        </div>

        <div class="search-input-wrap">
          <Icon icon="tabler:search" width="18" height="18" class="search-input-icon" />
          <input
            ref="inputRef"
            v-model="query"
            type="search"
            class="search-input"
            :placeholder="$t('Search by name or place…')"
            @keydown.enter="onEnter"
            @keydown.esc="emit('close')"
          />
        </div>

        <!-- City / address jump for the query — kept above the merchant list so
             a place search is one tap, not a scroll past name collisions. -->
        <button v-if="geoResult" type="button" class="search-place" @click="goToPlace">
          <span class="search-place-icon">
            <Icon icon="tabler:map-pin" width="18" height="18" />
          </span>
          <span class="search-place-text">
            <span class="search-place-title">{{ geoResult.label }}</span>
            <span class="search-place-sub">{{ $t('Go to place') }}</span>
          </span>
          <Icon icon="tabler:arrow-up-right" width="16" height="16" class="search-place-go" />
        </button>

        <!-- Merchant matches -->
        <div v-if="results.length" class="search-results">
          <PlaceListRow
            v-for="p in results"
            :key="p.id"
            :place="p"
            @select="onSelectResult"
          />
        </div>

        <!-- Nothing typed yet -->
        <p v-else-if="!hasQuery && !geoResult" class="search-hint">{{ $t('Search a merchant or a city') }}</p>

        <!-- Typed, but no merchant and no place matched -->
        <p v-else-if="hasQuery && !geoResult && !geoLoading" class="search-empty-text">{{ $t('No results found') }}</p>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.search-overlay {
  position: absolute;
  inset: 0;
  z-index: 12;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: calc(var(--safe-top, 0px) + 70px) 16px 16px;
}
.search-card {
  width: 100%;
  max-width: 460px;
  border-radius: 18px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  box-shadow: var(--shadow-lg);
}
.search-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.search-card-title {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}
.search-close {
  all: unset;
  cursor: pointer;
  color: var(--text-muted);
  display: flex;
  padding: 4px;
}
.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  height: 48px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  border-radius: 12px;
}
.search-input-icon { color: var(--text-muted); flex-shrink: 0; }
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  color: var(--text-primary);
}
.search-results {
  display: flex;
  flex-direction: column;
  max-height: 52vh;
  overflow-y: auto;
  margin: 0 -4px;
  -webkit-overflow-scrolling: touch;
}
.search-empty-text,
.search-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  margin: 4px 0 0;
}

/* "Go to a place" row — the geocoded city/address jump. */
.search-place {
  all: unset;
  box-sizing: border-box;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px;
  margin: 0 4px;
  border-radius: 12px;
  -webkit-tap-highlight-color: transparent;
}
.search-place:active { background: var(--bg-input); }
.search-place-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-input);
  color: var(--map-accent);
}
.search-place-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.search-place-title {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search-place-sub {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  color: var(--text-muted);
}
.search-place-go { flex-shrink: 0; color: var(--text-muted); }

.search-fade-enter-active,
.search-fade-leave-active { transition: opacity 180ms ease; }
.search-fade-enter-from,
.search-fade-leave-to { opacity: 0; }
</style>
