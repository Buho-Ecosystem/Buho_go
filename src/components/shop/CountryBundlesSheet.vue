<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="bundles-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          <span v-if="country?.flag" class="title-flag">{{ country.flag }}</span>
          {{ country?.name || $t('Data plans') }}
        </div>
        <q-btn flat round dense :aria-label="$t('Close')" class="sheet-close-btn" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-scroll">
        <div class="step-body">
          <!-- Loading -->
          <div v-if="loading" class="row-list">
            <div v-for="n in 4" :key="n" class="skeleton-row" :class="$q.dark.isActive ? 'skeleton-dark' : 'skeleton-light'"></div>
          </div>

          <!-- Error / empty -->
          <div v-else-if="error" class="info-state" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            <Icon icon="tabler:cloud-off" width="22" height="22" />
            <span>{{ error }}</span>
          </div>
          <div v-else-if="!bundles.length" class="info-state" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            <Icon icon="tabler:mood-empty" width="22" height="22" />
            <span>{{ $t('No plans available here right now. Try a regional plan.') }}</span>
          </div>

          <!-- Bundle list -->
          <template v-else>
            <div class="row-list">
              <button
                v-for="(b, i) in visibleBundles"
                :key="b.bundleName"
                type="button"
                class="bundle-row"
                :class="$q.dark.isActive ? 'bundle-row-dark' : 'bundle-row-light'"
                @click="$emit('select', b)"
              >
                <div class="bundle-main">
                  <div class="bundle-data" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                    {{ b.unlimited ? $t('Unlimited') : formatData(b.dataInGB) }}
                    <span v-if="isPopular(i)" class="popular-tag">{{ $t('Popular') }}</span>
                  </div>
                  <div class="bundle-days" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
                    {{ formatDays(b.durationInDays) }}
                  </div>
                </div>
                <div class="bundle-price">
                  <span class="bundle-price-amount" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                    {{ b.priceSatsEstimate ? `≈ ${formatSats(b.priceSatsEstimate)}` : formatUsd(b.priceUsd) }}
                  </span>
                  <span v-if="b.priceSatsEstimate" class="bundle-price-sub" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                    {{ $t('sats') }} · {{ formatUsd(b.priceUsd) }}
                  </span>
                </div>
              </button>
            </div>

            <button
              v-if="bundles.length > collapsedCount && !expanded"
              type="button"
              class="more-row"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
              @click="expanded = true"
            >
              <Icon icon="tabler:chevron-down" width="16" height="16" />
              <span>{{ $t('More options ({n})', { n: bundles.length - collapsedCount }) }}</span>
            </button>

            <p class="foot-note" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('Data only. Installs as a QR code, no SIM swap.') }}
            </p>
          </template>
        </div>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';

/**
 * eSIM bundle sheet for one country/region. Lean rows: data, validity, price.
 * Sorted by data ascending upstream. Selecting a row emits `select(bundle)`;
 * the parent builds a purchase descriptor and opens the PurchaseSheet.
 */
const COLLAPSED_COUNT = 6;

export default {
  name: 'CountryBundlesSheet',
  components: { Icon },
  props: {
    modelValue: { type: Boolean, default: false },
    country: { type: Object, default: null },
    bundles: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    error: { type: String, default: '' },
  },
  emits: ['update:modelValue', 'select'],

  data() {
    return { expanded: false, collapsedCount: COLLAPSED_COUNT };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },
    visibleBundles() {
      return this.expanded ? this.bundles : this.bundles.slice(0, this.collapsedCount);
    },
  },

  watch: {
    open(v) { if (v) this.expanded = false; },
  },

  methods: {
    formatSats(n) {
      if (n == null || !Number.isFinite(n)) return '';
      try { return new Intl.NumberFormat(this.$i18n?.locale || undefined).format(n); }
      catch { return String(n); }
    },
    formatUsd(n) {
      if (n == null || !Number.isFinite(n)) return '';
      try { return new Intl.NumberFormat(this.$i18n?.locale || undefined, { style: 'currency', currency: 'USD' }).format(n); }
      catch { return `$${n}`; }
    },
    formatData(gb) {
      if (gb == null) return '';
      return `${gb} GB`;
    },
    formatDays(d) {
      if (d == null) return '';
      return this.$t('{n} days', { n: d });
    },
    // Badge a single mid-tier plan as "Popular" (only when there are enough
    // to make a recommendation meaningful, and never when expanded clutters).
    isPopular(i) {
      if (this.bundles.length < 3) return false;
      const target = Math.min(this.collapsedCount, this.bundles.length);
      return i === Math.floor(target / 2);
    },
  },
};
</script>

<style scoped>
.bundles-sheet { width: 100%; max-width: 520px; border-top-left-radius: 22px; border-top-right-radius: 22px; overflow: hidden; padding-bottom: max(16px, env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; max-height: 88vh; max-height: 88dvh; position: relative; }
.bundles-sheet::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 180px; background: linear-gradient(to bottom, rgba(21, 222, 114, 0.14) 0%, rgba(21, 222, 114, 0.07) 50%, transparent 100%); pointer-events: none; z-index: 0; border-top-left-radius: 22px; border-top-right-radius: 22px; }
body.body--dark .bundles-sheet::before { background: linear-gradient(to bottom, rgba(21, 222, 114, 0.24) 0%, rgba(21, 222, 114, 0.10) 50%, transparent 100%); }
.bundles-sheet > * { position: relative; z-index: 1; }

.sheet-handle { display: flex; justify-content: center; padding: 8px 0 4px; flex-shrink: 0; }
.sheet-handle-bar-light, .sheet-handle-bar-dark { width: 36px; height: 4px; border-radius: 999px; display: block; }
.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark { background: rgba(255, 255, 255, 0.22); }

.sheet-header { display: flex; align-items: center; padding: 4px 18px 8px; gap: 8px; flex-shrink: 0; }
.sheet-title { flex: 1 1 auto; font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; min-width: 0; }
.title-flag { font-size: 20px; }
.sheet-close-btn { flex: 0 0 auto; }

.sheet-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.step-body { display: flex; flex-direction: column; gap: 12px; padding: 6px 18px 18px; }

.row-list { display: flex; flex-direction: column; gap: 8px; }
.bundle-row { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: 0; border-radius: 16px; cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: left; transition: transform 0.1s ease; }
.bundle-row-light { background: rgba(15, 23, 42, 0.04); box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.05); }
.bundle-row-dark { background: rgba(255, 255, 255, 0.04); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
.bundle-row:active { transform: scale(0.99); }
.bundle-main { flex: 1 1 auto; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.bundle-data { font-family: 'Manrope', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
.popular-tag { font-size: 10.5px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: #0e7b3f; background: rgba(21, 222, 114, 0.12); padding: 2px 7px; border-radius: 999px; }
body.body--dark .popular-tag { color: #6ee7a8; background: rgba(21, 222, 114, 0.16); }
.bundle-days { font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 500; }
.bundle-price { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
.bundle-price-amount { font-family: 'Manrope', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.bundle-price-sub { font-family: 'Manrope', sans-serif; font-size: 11.5px; font-weight: 500; }

.more-row { all: unset; display: inline-flex; align-items: center; gap: 6px; align-self: center; padding: 8px 12px; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.foot-note { font-family: 'Manrope', sans-serif; font-size: 12.5px; line-height: 1.45; margin: 4px 0 0; text-align: center; }

.skeleton-row { height: 72px; border-radius: 16px; }
.skeleton-light { background: rgba(15, 23, 42, 0.05); animation: pulse 1.4s ease-in-out infinite; }
.skeleton-dark { background: rgba(255, 255, 255, 0.05); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) { .skeleton-light, .skeleton-dark { animation: none; } }

.info-state { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 28px 16px; font-family: 'Manrope', sans-serif; font-size: 14px; line-height: 1.45; }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
