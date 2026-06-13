<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card class="loc-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ $t('Choose a server') }}
        </div>
        <q-btn flat round dense :aria-label="$t('Close')" class="sheet-close-btn" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-scroll">
        <div class="step-body">
          <label class="search-field" :class="$q.dark.isActive ? 'field-input-wrap-dark' : 'field-input-wrap-light'">
            <Icon icon="tabler:search" width="18" height="18" class="search-icon" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'" />
            <input
              ref="searchEl"
              v-model="query"
              type="text"
              :placeholder="$t('Search country')"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="none"
              class="search-input"
              :class="$q.dark.isActive ? 'field-input-dark' : 'field-input-light'"
            />
          </label>

          <div class="row-list">
            <button
              v-for="loc in filtered"
              :key="loc.code"
              type="button"
              class="loc-row"
              :class="[$q.dark.isActive ? 'loc-row-dark' : 'loc-row-light', { 'loc-row--selected': selectedCode === loc.code }]"
              @click="choose(loc)"
            >
              <span class="row-flag">{{ loc.flag }}</span>
              <span class="row-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ loc.name }}</span>
              <Icon v-if="selectedCode === loc.code" icon="tabler:check" width="18" height="18" class="row-check" />
            </button>
          </div>

          <div v-if="!filtered.length" class="empty-state" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t("No match for '{q}'.", { q: query }) }}
          </div>
        </div>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';

/**
 * Reusable VPN server picker (search + flagged list). Emits `select(location)`.
 */
export default {
  name: 'LocationPickerSheet',
  components: { Icon },
  props: {
    modelValue: { type: Boolean, default: false },
    locations: { type: Array, default: () => [] },
    selectedCode: { type: String, default: '' },
  },
  emits: ['update:modelValue', 'select'],

  data() {
    return { query: '', focusTimer: null };
  },

  beforeUnmount() {
    clearTimeout(this.focusTimer);
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },
    filtered() {
      const q = this.query.trim().toLowerCase();
      if (!q) return this.locations;
      return this.locations.filter((l) => l.name.toLowerCase().includes(q) || (l.isoCode || '').toLowerCase() === q);
    },
  },

  methods: {
    onShow() {
      this.query = '';
      this.$nextTick(() => {
        this.focusTimer = setTimeout(() => this.$refs.searchEl?.focus(), 80);
      });
    },
    onHide() {
      clearTimeout(this.focusTimer);
    },
    choose(loc) {
      this.$emit('select', loc);
      this.open = false;
    },
  },
};
</script>

<style scoped>
.loc-sheet { width: 100%; max-width: 520px; border-top-left-radius: 22px; border-top-right-radius: 22px; overflow: hidden; padding-bottom: max(16px, env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; max-height: 88vh; max-height: 88dvh; }
.sheet-handle { display: flex; justify-content: center; padding: 8px 0 4px; flex-shrink: 0; }
.sheet-handle-bar-light, .sheet-handle-bar-dark { width: 36px; height: 4px; border-radius: 999px; display: block; }
.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark { background: rgba(255, 255, 255, 0.22); }
.sheet-header { display: flex; align-items: center; padding: 4px 18px 8px; gap: 8px; flex-shrink: 0; }
.sheet-title { flex: 1 1 auto; font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 600; letter-spacing: -0.005em; }
.sheet-close-btn { flex: 0 0 auto; }
.sheet-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.step-body { display: flex; flex-direction: column; gap: 12px; padding: 6px 18px 18px; }

.search-field { display: flex; align-items: center; gap: 8px; border-radius: 12px; border: 1px solid transparent; padding: 0 12px; }
.field-input-wrap-light { background: rgba(15, 23, 42, 0.04); border-color: rgba(15, 23, 42, 0.08); }
.field-input-wrap-light:focus-within { background: #fff; border-color: rgba(15, 23, 42, 0.32); }
.field-input-wrap-dark { background: rgba(255, 255, 255, 0.04); border-color: rgba(255, 255, 255, 0.06); }
.field-input-wrap-dark:focus-within { background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.28); }
.search-icon { flex-shrink: 0; }
.search-input { flex: 1 1 auto; width: 100%; border: 0; outline: none; padding: 12px 0; background: transparent; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 500; }
.field-input-light { color: #0f172a; }
.field-input-dark { color: #f8fafc; }

.row-list { display: flex; flex-direction: column; gap: 8px; }
.loc-row { display: flex; align-items: center; gap: 12px; padding: 0 14px; height: 56px; border: 0; border-radius: 14px; cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: left; box-shadow: inset 0 0 0 1.5px transparent; }
.loc-row-light { background: rgba(15, 23, 42, 0.04); }
.loc-row-dark { background: rgba(255, 255, 255, 0.04); }
.loc-row--selected { box-shadow: inset 0 0 0 1.5px rgba(21, 222, 114, 0.5); background: rgba(21, 222, 114, 0.08); }
.row-flag { font-size: 22px; width: 26px; text-align: center; flex-shrink: 0; }
.row-name { flex: 1 1 auto; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-check { color: #15a35b; flex-shrink: 0; }
body.body--dark .row-check { color: #2bd17f; }
.empty-state { font-family: 'Manrope', sans-serif; font-size: 14px; text-align: center; padding: 24px 16px; }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
