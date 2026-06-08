<template>
  <q-dialog v-model="open" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
    <q-card class="filter-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ $t('Filters') }}</div>
        <button type="button" class="reset-link" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'" @click="store.resetFilters()">{{ $t('Clear filters') }}</button>
        <q-btn flat round dense :aria-label="$t('Close')" class="sheet-close-btn" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-scroll">
        <!-- Payment -->
        <section class="block">
          <div class="block-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t('Payment') }}</div>
          <div class="toggle-row">
            <button type="button" class="toggle-chip" :class="[$q.dark.isActive ? 'toggle-chip-dark' : 'toggle-chip-light', { 'toggle-chip--on': store.filters.payments.lightning }]" @click="store.togglePayment('lightning')">
              <Icon icon="tabler:bolt" width="15" height="15" /> {{ $t('Lightning') }}
            </button>
            <button type="button" class="toggle-chip" :class="[$q.dark.isActive ? 'toggle-chip-dark' : 'toggle-chip-light', { 'toggle-chip--on': store.filters.payments.onchain }]" @click="store.togglePayment('onchain')">
              <Icon icon="tabler:currency-bitcoin" width="15" height="15" /> {{ $t('On-chain') }}
            </button>
          </div>
        </section>

        <!-- Source (shops facet only) -->
        <section v-if="store.facet === 'shops'" class="block">
          <div class="block-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t('Source') }}</div>
          <div class="toggle-row">
            <button type="button" class="toggle-chip" :class="[$q.dark.isActive ? 'toggle-chip-dark' : 'toggle-chip-light', { 'toggle-chip--on': store.filters.sources.listings }]" @click="store.toggleSource('listings')">
              <Icon icon="tabler:rosette-discount-check" width="15" height="15" /> {{ $t('Verified directory') }}
            </button>
            <button type="button" class="toggle-chip" :class="[$q.dark.isActive ? 'toggle-chip-dark' : 'toggle-chip-light', { 'toggle-chip--on': store.filters.sources.btcpay }]" @click="store.toggleSource('btcpay')">
              <Icon icon="tabler:server-2" width="15" height="15" /> {{ $t('BTCPay merchants') }}
            </button>
          </div>
        </section>

        <!-- Country -->
        <section v-if="store.facet === 'shops'" class="block">
          <div class="block-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t('Country') }}</div>
          <label class="search-field" :class="$q.dark.isActive ? 'field-input-wrap-dark' : 'field-input-wrap-light'">
            <Icon icon="tabler:search" width="16" height="16" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'" />
            <input v-model="countryQuery" type="text" :placeholder="$t('Search country')" class="search-input" :class="$q.dark.isActive ? 'field-input-dark' : 'field-input-light'" />
          </label>
          <div class="country-list">
            <button type="button" class="country-row" :class="[$q.dark.isActive ? 'country-row-dark' : 'country-row-light', { 'country-row--sel': store.filters.country === 'any' }]" @click="store.setCountry('any')">
              <span class="country-flag country-flag-spacer" aria-hidden="true"></span>
              <span class="country-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ $t('Anywhere') }}</span>
              <Icon v-if="store.filters.country === 'any'" icon="tabler:check" width="18" height="18" class="country-check" />
            </button>
            <button type="button" class="country-row" :class="[$q.dark.isActive ? 'country-row-dark' : 'country-row-light', { 'country-row--sel': store.filters.country === 'WW' }]" @click="store.setCountry('WW')">
              <Icon icon="tabler:world" width="24" height="24" class="country-flag country-globe" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'" />
              <span class="country-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ $t('Worldwide only') }}</span>
              <Icon v-if="store.filters.country === 'WW'" icon="tabler:check" width="18" height="18" class="country-check" />
            </button>
            <button v-for="c in filteredCountries" :key="c.code" type="button" class="country-row" :class="[$q.dark.isActive ? 'country-row-dark' : 'country-row-light', { 'country-row--sel': store.filters.country === c.code }]" @click="store.setCountry(c.code)">
              <Icon v-if="flagIcon(c.code)" :icon="flagIcon(c.code)" width="24" height="24" class="country-flag" />
              <span v-else class="country-flag country-flag-spacer" aria-hidden="true"></span>
              <span class="country-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ c.name }}</span>
              <Icon v-if="store.filters.country === c.code" icon="tabler:check" width="18" height="18" class="country-check" />
            </button>
          </div>
        </section>
      </div>

      <div class="sheet-actions" :class="$q.dark.isActive ? 'sheet-actions-dark' : 'sheet-actions-light'">
        <button type="button" class="primary-cta" :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'" @click="open = false">
          <span>{{ $t('Show results') }}</span>
        </button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useOnlineShopsStore } from '../../stores/onlineShops';
import { flagIcon as resolveFlagIcon } from '../../services/onlineShops/flags.js';

/** Tier-2 filter sheet. Operates on the online-shops store directly. */
export default {
  name: 'ShopFilterSheet',
  components: { Icon },
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue'],
  setup() {
    return { store: useOnlineShopsStore() };
  },
  data() {
    return { countryQuery: '' };
  },
  methods: {
    flagIcon(code) { return resolveFlagIcon(code); },
  },
  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },
    filteredCountries() {
      const q = this.countryQuery.trim().toLowerCase();
      const list = this.store.countriesPresent;
      if (!q) return list;
      return list.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
    },
  },
};
</script>

<style scoped>
.filter-sheet { width: 100%; max-width: 520px; border-top-left-radius: 22px; border-top-right-radius: 22px; overflow: hidden; padding-bottom: max(16px, env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; max-height: 88vh; max-height: 88dvh; }
.sheet-handle { display: flex; justify-content: center; padding: 8px 0 4px; flex-shrink: 0; }
.sheet-handle-bar-light, .sheet-handle-bar-dark { width: 36px; height: 4px; border-radius: 999px; display: block; }
.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark { background: rgba(255, 255, 255, 0.22); }
.sheet-header { display: flex; align-items: center; padding: 4px 18px 8px; gap: 8px; flex-shrink: 0; }
.sheet-title { flex: 1 1 auto; font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 600; letter-spacing: -0.005em; }
.reset-link { all: unset; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 600; cursor: pointer; padding: 6px 8px; -webkit-tap-highlight-color: transparent; }
.sheet-close-btn { flex: 0 0 auto; }
.sheet-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px 18px 12px; display: flex; flex-direction: column; gap: 18px; }

.block { display: flex; flex-direction: column; gap: 10px; }
.block-title { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; }
.toggle-row { display: flex; flex-wrap: wrap; gap: 8px; }
.toggle-chip { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 9px 14px; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; box-shadow: inset 0 0 0 1.5px transparent; }
.toggle-chip-light { background: rgba(15, 23, 42, 0.05); color: #0f172a; }
.toggle-chip-dark { background: rgba(255, 255, 255, 0.06); color: #f8fafc; }
.toggle-chip--on { background: rgba(21, 222, 114, 0.12); box-shadow: inset 0 0 0 1.5px rgba(21, 222, 114, 0.5); }
body.body--dark .toggle-chip--on { background: rgba(21, 222, 114, 0.18); }

.search-field { display: flex; align-items: center; gap: 8px; border-radius: 12px; border: 1px solid transparent; padding: 0 12px; }
.field-input-wrap-light { background: rgba(15, 23, 42, 0.04); border-color: rgba(15, 23, 42, 0.08); }
.field-input-wrap-dark { background: rgba(255, 255, 255, 0.04); border-color: rgba(255, 255, 255, 0.06); }
.search-input { flex: 1 1 auto; border: 0; outline: none; padding: 10px 0; background: transparent; font-family: 'Manrope', sans-serif; font-size: 14px; font-weight: 500; }
.field-input-light { color: #0f172a; }
.field-input-dark { color: #f8fafc; }
.field-input-light::placeholder { color: rgba(15, 23, 42, 0.45); }
.field-input-dark::placeholder { color: rgba(255, 255, 255, 0.45); }
.country-list { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; padding: 2px 2px 2px 0; }
.country-row { display: flex; align-items: center; gap: 14px; padding: 0 16px; height: 54px; border: 0; border-radius: 14px; cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: left; transition: background-color 0.12s ease; }
.country-row-light { background: rgba(15, 23, 42, 0.03); }
.country-row-dark { background: rgba(255, 255, 255, 0.03); }
.country-row--sel { box-shadow: inset 0 0 0 1.5px rgba(21, 222, 114, 0.45); }
.country-flag { flex: 0 0 auto; width: 24px; height: 24px; border-radius: 50%; }
.country-flag-spacer { display: inline-block; }
.country-name { flex: 1 1 auto; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; letter-spacing: -0.005em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.country-check { flex: 0 0 auto; color: #15a35b; }
body.body--dark .country-check { color: #2bd17f; }
body.body--dark .country-check { color: #2bd17f; }

.sheet-actions { flex-shrink: 0; padding: 10px 18px 4px; border-top: 1px solid transparent; }
.sheet-actions-light { border-top-color: rgba(15, 23, 42, 0.06); }
.sheet-actions-dark { border-top-color: rgba(255, 255, 255, 0.06); }
.primary-cta { width: 100%; height: 48px; border-radius: 16px; border: 0; display: inline-flex; align-items: center; justify-content: center; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.primary-cta:active { transform: scale(0.98); }

.item-label-light { color: #0f172a; }
.item-label-dark { color: #f8fafc; }
</style>
