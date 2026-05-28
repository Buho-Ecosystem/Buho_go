<script setup>
import { ref, computed, nextTick, watch, onBeforeUnmount, getCurrentInstance } from 'vue'
import { Icon } from '@iconify/vue'
import { useMapPlacesStore } from '../../stores/mapPlaces.js'
import { distanceMeters } from '../../services/map/places.js'
import PlaceListRow from './PlaceListRow.vue'

/**
 * MapSearch — a full-screen search overlay.
 *
 * Primary: live, local filtering of the loaded merchants by name as the user
 * types (debounced, no network) — emits `select` with the chosen place so the
 * parent flies to it and opens its detail. Fallback: if nothing matches, the
 * query can be geocoded as a city/address via Nominatim (one request, with an
 * explicit Accept-Language per their usage policy) — emits `locate`.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'locate', 'select'])

const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)

const store = useMapPlacesStore()

const query = ref('')
const debounced = ref('')
const searching = ref(false) // geocode request in flight
const error = ref('')
const inputRef = ref(null)

const MIN_CHARS = 2
const RESULT_CAP = 25

// Debounce the filter so a 28k-row scan + sort doesn't run on every keystroke.
let debTimer = null
watch(query, (v) => {
  clearTimeout(debTimer)
  debTimer = setTimeout(() => { debounced.value = v }, 150)
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

const noMatches = computed(() => hasQuery.value && results.value.length === 0)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      error.value = ''
      nextTick(() => inputRef.value?.focus())
    } else {
      query.value = ''
      debounced.value = ''
      error.value = ''
    }
  },
)

function onSelectResult(place) {
  emit('select', place)
  emit('close')
}

// Fallback: geocode the query as a city/address and fly there.
async function geocodeLocation() {
  const q = query.value.trim()
  if (!q || searching.value) return
  searching.value = true
  error.value = ''
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
      encodeURIComponent(q)
    const res = await fetch(url, {
      headers: { 'Accept-Language': proxy.$i18n.locale || 'en' },
    })
    if (!res.ok) throw new Error(String(res.status))
    const hits = await res.json()
    const hit = hits[0]
    if (!hit) {
      error.value = t('No results found')
      return
    }
    emit('locate', { lat: Number(hit.lat), lon: Number(hit.lon) })
    emit('close')
  } catch {
    error.value = t('Search failed. Try again.')
  } finally {
    searching.value = false
  }
}

// Enter: open the top merchant match, else try a location lookup.
function onEnter() {
  if (results.value.length) onSelectResult(results.value[0])
  else if (hasQuery.value) geocodeLocation()
}

onBeforeUnmount(() => clearTimeout(debTimer))
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

        <div v-if="error" class="search-error">{{ error }}</div>

        <!-- Live merchant matches -->
        <div v-if="results.length" class="search-results">
          <PlaceListRow
            v-for="p in results"
            :key="p.id"
            :place="p"
            @select="onSelectResult"
          />
        </div>

        <!-- No merchant match: offer to look the query up as a place -->
        <div v-else-if="noMatches" class="search-empty">
          <p class="search-empty-text">{{ $t('No merchants found') }}</p>
          <button class="search-submit" type="button" :disabled="searching" @click="geocodeLocation">
            {{ searching ? $t('Searching…') : $t('Search as a place') }}
          </button>
        </div>

        <!-- Initial hint -->
        <p v-else-if="!hasQuery" class="search-hint">{{ $t('Type to search merchants by name') }}</p>
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
.search-error {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: var(--color-red, #FF4444);
}
.search-submit {
  all: unset;
  text-align: center;
  cursor: pointer;
  height: 48px;
  border-radius: 12px;
  background: var(--map-cta-bg);
  color: var(--map-cta-fg);
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
  -webkit-tap-highlight-color: transparent;
}
.search-submit:disabled { opacity: 0.5; cursor: default; }

.search-results {
  display: flex;
  flex-direction: column;
  max-height: 52vh;
  overflow-y: auto;
  margin: 0 -4px;
  -webkit-overflow-scrolling: touch;
}
.search-empty { display: flex; flex-direction: column; gap: 12px; }
.search-empty-text,
.search-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  margin: 4px 0 0;
}

.search-fade-enter-active,
.search-fade-leave-active { transition: opacity 180ms ease; }
.search-fade-enter-from,
.search-fade-leave-to { opacity: 0; }
</style>
