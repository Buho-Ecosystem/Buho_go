<script setup>
import { ref, nextTick, watch, getCurrentInstance } from 'vue'
import { Icon } from '@iconify/vue'

/**
 * MapSearch — a full-screen search overlay for jumping the map to a city or
 * address. Geocodes via Nominatim (OSM). Per Nominatim's usage policy we send
 * an explicit Accept-Language and keep it to one request per submit (no
 * per-keystroke autocomplete, which would hammer the public endpoint).
 *
 * Emits `locate` with { lat, lon } for the parent to fly the map to.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'locate'])

const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)

const query = ref('')
const searching = ref(false)
const error = ref('')
const inputRef = ref(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      error.value = ''
      nextTick(() => inputRef.value?.focus())
    } else {
      query.value = ''
    }
  },
)

async function submit() {
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
    const results = await res.json()
    const hit = results[0]
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
</script>

<template>
  <transition name="search-fade">
    <div v-if="open" class="search-overlay" @click.self="emit('close')">
      <div class="search-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <div class="search-card-head">
          <span class="search-card-title">{{ $t('Find a place') }}</span>
          <button class="search-close" type="button" @click="emit('close')" aria-label="Close search">
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
            :placeholder="$t('Search city or address…')"
            @keydown.enter="submit"
            @keydown.esc="emit('close')"
          />
        </div>

        <div v-if="error" class="search-error">{{ error }}</div>

        <button class="search-submit" type="button" :disabled="searching || !query.trim()" @click="submit">
          {{ searching ? $t('Searching…') : $t('Search') }}
        </button>
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

.search-fade-enter-active,
.search-fade-leave-active { transition: opacity 180ms ease; }
.search-fade-enter-from,
.search-fade-leave-to { opacity: 0; }
</style>
