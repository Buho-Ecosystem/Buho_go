<script setup>
import { computed, getCurrentInstance } from 'vue'
import { Icon } from '@iconify/vue'
import { storeToRefs } from 'pinia'
import { useMapPlacesStore } from '../../stores/mapPlaces.js'
import { useMapFavoritesStore } from '../../stores/mapFavorites.js'
import { useMapBasemapStore, BASEMAPS, BASEMAP_LABELS } from '../../stores/mapBasemap.js'
import {
  SOURCE_LABEL,
  CATEGORY_BUCKET_ICONS,
  CATEGORY_BUCKET_LABELS,
} from '../../services/map/places.js'

/**
 * MapFilters — bottom-sheet dialog to filter the map by data source, category
 * bucket, and verification freshness, and to pick the basemap style. Reads/
 * writes the stores directly; the map + list recompute reactively.
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)

const store = useMapPlacesStore()
const { enabled, buckets, verifiedRecentlyOnly, favoritesOnly, counts } = storeToRefs(store)
const favorites = useMapFavoritesStore()
const basemap = useMapBasemapStore()
const { style: basemapStyle } = storeToRefs(basemap)

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const sources = ['btcmap', 'osm', 'btcpay']
const bucketKeys = ['food', 'retail', 'lodging', 'services', 'atm', 'leisure', 'other']

function bucketLabel(key) {
  // i18n keys mirror the canonical English bucket labels.
  return t(CATEGORY_BUCKET_LABELS[key])
}
</script>

<template>
  <q-dialog v-model="open" position="bottom">
    <q-card class="filters-card">
      <div class="filters-grabber" />
      <div class="filters-head">
        <span class="filters-title">{{ $t('Filters') }}</span>
        <button class="filters-close" type="button" v-close-popup aria-label="Close filters">
          <Icon icon="tabler:x" width="18" height="18" />
        </button>
      </div>

      <div class="filters-scroll">
        <!-- Saved -->
        <section class="filters-section">
          <button
            type="button"
            class="filters-toggle-row"
            @click="store.toggleFavoritesOnly()"
          >
            <span class="filters-toggle-text">
              <Icon icon="tabler:star" width="18" height="18" />
              {{ $t('Saved only') }}
              <span v-if="favorites.count" class="filters-toggle-count">{{ favorites.count }}</span>
            </span>
            <span class="filters-switch" :class="{ on: favoritesOnly }">
              <span class="filters-knob" />
            </span>
          </button>
        </section>

        <!-- Freshness -->
        <section class="filters-section">
          <button
            type="button"
            class="filters-toggle-row"
            @click="store.toggleVerifiedRecentlyOnly()"
          >
            <span class="filters-toggle-text">
              <Icon icon="tabler:rosette-discount-check" width="18" height="18" />
              {{ $t('Recently verified only') }}
            </span>
            <span class="filters-switch" :class="{ on: verifiedRecentlyOnly }">
              <span class="filters-knob" />
            </span>
          </button>
        </section>

        <!-- Sources -->
        <section class="filters-section">
          <h3 class="filters-label">{{ $t('Sources') }}</h3>
          <div class="filters-rows">
            <button
              v-for="s in sources"
              :key="s"
              type="button"
              class="filters-row"
              :class="{ active: enabled[s] }"
              @click="store.toggleSource(s)"
            >
              <span class="filters-check" :class="{ on: enabled[s] }">
                <Icon v-if="enabled[s]" icon="tabler:check" width="13" height="13" />
              </span>
              <span class="filters-row-label">{{ SOURCE_LABEL[s] }}</span>
              <span class="filters-row-count">{{ counts[s].toLocaleString() }}</span>
            </button>
          </div>
        </section>

        <!-- Categories -->
        <section class="filters-section">
          <h3 class="filters-label">{{ $t('Categories') }}</h3>
          <div class="filters-chips">
            <button
              v-for="b in bucketKeys"
              :key="b"
              type="button"
              class="filters-chip"
              :class="{ active: buckets[b] }"
              @click="store.toggleBucket(b)"
            >
              <Icon :icon="CATEGORY_BUCKET_ICONS[b]" width="15" height="15" />
              {{ bucketLabel(b) }}
            </button>
          </div>
        </section>

        <!-- Map style -->
        <section class="filters-section">
          <h3 class="filters-label">{{ $t('Map style') }}</h3>
          <div class="filters-chips">
            <button
              v-for="s in BASEMAPS"
              :key="s"
              type="button"
              class="filters-chip"
              :class="{ active: basemapStyle === s }"
              @click="basemap.setStyle(s)"
            >
              {{ BASEMAP_LABELS[s] }}
            </button>
          </div>
        </section>
      </div>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.filters-card {
  width: 100%;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  padding: 8px 16px max(16px, var(--safe-bottom, 0px));
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-card);
}
.filters-grabber {
  width: 40px;
  height: 5px;
  margin: 0 auto 8px;
  border-radius: 999px;
  background: var(--border-card);
}
.filters-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.filters-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
}
.filters-close {
  all: unset;
  cursor: pointer;
  color: var(--text-muted);
  display: flex;
  padding: 4px;
}
.filters-scroll {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 8px 0 4px;
}
.filters-section { display: flex; flex-direction: column; gap: 8px; }
.filters-label {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin: 0;
}

.filters-toggle-row,
.filters-row {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  color: var(--text-primary);
  -webkit-tap-highlight-color: transparent;
}
.filters-toggle-text {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}
.filters-toggle-count {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}
.filters-switch {
  width: 40px;
  height: 24px;
  border-radius: 999px;
  background: var(--border-card);
  position: relative;
  transition: background-color 160ms ease;
  flex-shrink: 0;
}
.filters-switch.on { background: var(--map-accent); }
.filters-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 160ms ease;
}
.filters-switch.on .filters-knob { transform: translateX(16px); }

.filters-rows { display: flex; flex-direction: column; gap: 8px; }
.filters-row.active { border-color: var(--map-accent); }
.filters-check {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1.5px solid var(--border-card);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0E1F17;
  flex-shrink: 0;
}
.filters-check.on { background: var(--map-accent); border-color: var(--map-accent); color: var(--map-cta-fg); }
.filters-row-label { flex: 1; }
.filters-row-count { color: var(--text-muted); font-size: 12.5px; }

.filters-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.filters-chip {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.filters-chip.active {
  color: var(--text-primary);
  border-color: var(--map-accent);
  background: var(--map-accent-soft);
}
</style>
