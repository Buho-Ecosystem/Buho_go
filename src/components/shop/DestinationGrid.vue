<template>
  <div class="destinations">
    <!-- Search: the primary path. -->
    <label class="search-field" :class="$q.dark.isActive ? 'field-input-wrap-dark' : 'field-input-wrap-light'">
      <Icon icon="tabler:search" width="18" height="18" class="search-icon" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'" />
      <input
        v-model="query"
        type="text"
        :placeholder="$t('Where are you going?')"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="none"
        class="search-input"
        :class="$q.dark.isActive ? 'field-input-dark' : 'field-input-light'"
      />
      <button v-if="query" type="button" class="search-clear" :aria-label="$t('Clear')" @click="query = ''">
        <Icon icon="tabler:x" width="16" height="16" />
      </button>
    </label>

    <!-- Loading skeleton (preserves layout). -->
    <div v-if="loading" class="row-list">
      <div v-for="n in 7" :key="n" class="skeleton-row" :class="$q.dark.isActive ? 'skeleton-dark' : 'skeleton-light'"></div>
    </div>

    <template v-else>
      <!-- Empty query: recent + popular + regions. -->
      <template v-if="!query">
        <section v-if="recent.length" class="block">
          <div class="block-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t('Recent') }}</div>
          <div class="chip-scroller">
            <button
              v-for="c in recent" :key="`r-${c.slug}`"
              type="button"
              class="dest-chip"
              :class="$q.dark.isActive ? 'dest-chip-dark' : 'dest-chip-light'"
              @click="select(c, 'country')"
            >
              <span class="chip-flag">{{ c.flag }}</span>
              <span class="chip-name">{{ c.name }}</span>
            </button>
          </div>
        </section>

        <section class="block">
          <div class="block-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t('Popular destinations') }}</div>
          <div class="row-list">
            <button
              v-for="c in popularResolved" :key="`p-${c.slug}`"
              type="button"
              class="dest-row"
              :class="$q.dark.isActive ? 'dest-row-dark' : 'dest-row-light'"
              @click="select(c, 'country')"
            >
              <span class="row-flag">{{ c.flag }}</span>
              <span class="row-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ c.name }}</span>
              <Icon icon="tabler:chevron-right" width="18" height="18" class="row-go" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-5'" />
            </button>
          </div>
        </section>

        <section v-if="regions.length" class="block">
          <div class="block-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t('Regions') }}</div>
          <div class="row-list">
            <button
              v-for="r in regions" :key="`reg-${r.slug}`"
              type="button"
              class="dest-row"
              :class="$q.dark.isActive ? 'dest-row-dark' : 'dest-row-light'"
              @click="select(r, 'region')"
            >
              <span class="row-flag"><Icon icon="tabler:world" width="20" height="20" /></span>
              <span class="row-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ r.name }}</span>
              <Icon icon="tabler:chevron-right" width="18" height="18" class="row-go" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-5'" />
            </button>
          </div>
        </section>
      </template>

      <!-- Active query: filtered A-Z list (countries + matching regions). -->
      <template v-else>
        <div v-if="filtered.length" class="row-list">
          <button
            v-for="item in filtered" :key="`${item._kind}-${item.slug}`"
            type="button"
            class="dest-row"
            :class="$q.dark.isActive ? 'dest-row-dark' : 'dest-row-light'"
            @click="select(item, item._kind)"
          >
            <span class="row-flag">
              <template v-if="item._kind === 'country'">{{ item.flag }}</template>
              <Icon v-else icon="tabler:world" width="20" height="20" />
            </span>
            <span class="row-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ item.name }}</span>
            <Icon icon="tabler:chevron-right" width="18" height="18" class="row-go" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-5'" />
          </button>
        </div>
        <div v-else class="empty-state" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
          {{ $t("No match for '{q}'. Try a region instead.", { q: query }) }}
        </div>
      </template>
    </template>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';

/**
 * eSIM destination picker. Empty query leads with curated popular
 * destinations + regions (and a recent row when the user has bought before);
 * typing reveals the full A-Z catalog filtered. Pure presentation — emits
 * `select` and the parent fetches bundles + opens the bundle sheet.
 */

// Curated by travel demand, not alphabet. Resolved against the live catalog
// so any slug the API drops simply disappears.
const POPULAR_SLUGS = [
  'united-states', 'united-kingdom', 'turkey', 'thailand', 'spain',
  'italy', 'france', 'germany', 'japan', 'united-arab-emirates',
];

export default {
  name: 'DestinationGrid',
  components: { Icon },
  props: {
    countries: { type: Array, default: () => [] },
    regions: { type: Array, default: () => [] },
    recent: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
  },
  emits: ['select'],

  data() {
    return { query: '' };
  },

  computed: {
    popularResolved() {
      const bySlug = new Map(this.countries.map((c) => [c.slug, c]));
      const picked = POPULAR_SLUGS.map((s) => bySlug.get(s)).filter(Boolean);
      // Backfill from the front of the catalog if the curated list under-fills.
      if (picked.length < 6) {
        for (const c of this.countries) {
          if (picked.length >= 8) break;
          if (!picked.includes(c)) picked.push(c);
        }
      }
      return picked.slice(0, 10);
    },

    filtered() {
      const q = this.query.trim().toLowerCase();
      if (!q) return [];
      const countryHits = this.countries
        .filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q)
        .map((c) => ({ ...c, _kind: 'country' }));
      const regionHits = this.regions
        .filter((r) => r.name.toLowerCase().includes(q))
        .map((r) => ({ ...r, _kind: 'region' }));
      return [...countryHits, ...regionHits].slice(0, 60);
    },
  },

  methods: {
    select(item, kind) {
      this.$emit('select', { ...item, _kind: kind });
    },
  },
};
</script>

<style scoped>
.destinations { display: flex; flex-direction: column; gap: 18px; }

.search-field { display: flex; align-items: center; gap: 8px; border-radius: 12px; border: 1px solid transparent; padding: 0 12px; transition: border-color 0.18s ease, background-color 0.18s ease; }
.field-input-wrap-light { background: rgba(15, 23, 42, 0.04); border-color: rgba(15, 23, 42, 0.08); }
.field-input-wrap-light:focus-within { background: #fff; border-color: rgba(15, 23, 42, 0.32); }
.field-input-wrap-dark { background: rgba(255, 255, 255, 0.04); border-color: rgba(255, 255, 255, 0.06); }
.field-input-wrap-dark:focus-within { background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.28); }
.search-icon { flex-shrink: 0; }
.search-input { flex: 1 1 auto; width: 100%; border: 0; outline: none; padding: 12px 0; background: transparent; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 500; }
.field-input-light { color: #0f172a; }
.field-input-dark { color: #f8fafc; }
.search-clear { border: 0; background: transparent; cursor: pointer; padding: 4px; display: inline-flex; color: inherit; opacity: 0.6; }

.block { display: flex; flex-direction: column; gap: 10px; }
.block-title { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; }

.row-list { display: flex; flex-direction: column; gap: 8px; }
.dest-row { display: flex; align-items: center; gap: 12px; padding: 0 14px; height: 56px; border: 0; border-radius: 14px; cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: left; transition: transform 0.1s ease; }
.dest-row-light { background: rgba(15, 23, 42, 0.04); }
.dest-row-dark { background: rgba(255, 255, 255, 0.04); }
.dest-row:active { transform: scale(0.99); }
.row-flag { font-size: 22px; width: 26px; text-align: center; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
.row-name { flex: 1 1 auto; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; letter-spacing: -0.005em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-go { flex-shrink: 0; opacity: 0.7; }

.chip-scroller { display: flex; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
.dest-chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border: 0; border-radius: 999px; cursor: pointer; -webkit-tap-highlight-color: transparent; white-space: nowrap; flex-shrink: 0; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600; }
.dest-chip-light { background: rgba(15, 23, 42, 0.05); color: #0f172a; }
.dest-chip-dark { background: rgba(255, 255, 255, 0.06); color: #f8fafc; }
.chip-flag { font-size: 16px; }

.skeleton-row { height: 56px; border-radius: 14px; }
.skeleton-light { background: rgba(15, 23, 42, 0.05); animation: pulse 1.4s ease-in-out infinite; }
.skeleton-dark { background: rgba(255, 255, 255, 0.05); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) { .skeleton-light, .skeleton-dark { animation: none; } }

.empty-state { font-family: 'Manrope', sans-serif; font-size: 14px; text-align: center; padding: 24px 16px; }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
