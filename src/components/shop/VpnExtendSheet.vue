<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="ext-sheet shop-surface" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <div class="sheet-header">
        <div class="sheet-title-wrap">
          <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
            {{ $t('Add more time') }}
          </div>
          <div v-if="subtitle" class="sheet-subtitle" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
            {{ subtitle }}
          </div>
        </div>
        <q-btn flat round dense :aria-label="$t('Close')" class="sheet-close-btn" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-scroll">
        <div class="step-body">
          <div v-if="loading" class="row-list">
            <div v-for="n in 3" :key="n" class="skeleton-row" :class="$q.dark.isActive ? 'skeleton-dark' : 'skeleton-light'"></div>
          </div>

          <div v-else-if="error" class="info-state" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            <Icon icon="tabler:cloud-off" width="22" height="22" />
            <span>{{ error }}</span>
          </div>

          <template v-else>
            <div class="row-list">
              <button
                v-for="d in durations"
                :key="d.value"
                type="button"
                class="plan-row"
                :class="$q.dark.isActive ? 'plan-row-dark' : 'plan-row-light'"
                @click="$emit('select', d)"
              >
                <span class="plan-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                  {{ durationLabel(d) }}
                </span>
                <span class="plan-price">
                  <span class="plan-price-amount" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                    {{ d.priceSatsEstimate ? `≈ ${formatSats(d.priceSatsEstimate)}` : formatUsd(d.priceUsd) }}
                  </span>
                  <span v-if="d.priceSatsEstimate" class="plan-price-sub" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                    {{ $t('sats') }} · {{ formatUsd(d.priceUsd) }}
                  </span>
                </span>
              </button>
            </div>

            <p class="foot-note" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('The extra time is added to your current end date. Your connection details stay the same.') }}
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
 * Duration picker for extending a VPN subscription.
 *
 * Kept separate from VpnConfigurator because extending has no location to
 * choose: the subscription is already tied to a server and a keypair, and
 * offering a country here would imply otherwise.
 */
export default {
  name: 'VpnExtendSheet',
  components: { Icon },
  props: {
    modelValue: { type: Boolean, default: false },
    durations: { type: Array, default: () => [] },
    subtitle: { type: String, default: '' },
    loading: { type: Boolean, default: false },
    error: { type: String, default: '' },
  },
  emits: ['update:modelValue', 'select'],

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },
  },

  methods: {
    /** Localised "1 month" / "3 months" from the API's amount + unit pair. */
    durationLabel(d) {
      const n = d?.amount ?? 1;
      switch (d?.unit) {
        case 'day': return this.$t('{n} days', { n });
        case 'week': return this.$t('{n} weeks', { n });
        case 'month': return this.$t('{n} months', { n });
        case 'year': return this.$t('{n} years', { n });
        default: return d?.label || '';
      }
    },
    formatSats(n) {
      if (!Number.isFinite(n)) return '';
      try { return new Intl.NumberFormat(this.$i18n?.locale || undefined).format(n); }
      catch { return String(n); }
    },
    formatUsd(n) {
      if (!Number.isFinite(n)) return '';
      try {
        return new Intl.NumberFormat(this.$i18n?.locale || undefined, { style: 'currency', currency: 'USD' }).format(n);
      } catch { return `$${n}`; }
    },
  },
};
</script>

<style scoped>
.ext-sheet {
  width: 100%; max-width: 520px;
  border-top-left-radius: 22px; border-top-right-radius: 22px;
  overflow: hidden;
  padding-bottom: max(16px, var(--safe-bottom, 16px));
  display: flex; flex-direction: column;
  max-height: 88vh; max-height: 88dvh;
}
.sheet-handle { display: flex; justify-content: center; padding: 8px 0 4px; flex-shrink: 0; }
.sheet-handle-bar-light, .sheet-handle-bar-dark { width: 36px; height: 4px; border-radius: 999px; display: block; }
.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark { background: rgba(255, 255, 255, 0.22); }

.sheet-header { display: flex; align-items: center; padding: 4px 18px 8px; gap: 8px; flex-shrink: 0; }
.sheet-title-wrap { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.sheet-title { font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.sheet-subtitle { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 500; }
.sheet-close-btn { flex: 0 0 auto; }

.sheet-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.step-body { display: flex; flex-direction: column; gap: 12px; padding: 6px 18px 18px; }

.row-list { display: flex; flex-direction: column; gap: 8px; }
.plan-row {
  all: unset; box-sizing: border-box;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-height: 60px; padding: 12px 14px; border-radius: 14px;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.plan-row-light { background: rgba(15, 23, 42, 0.04); }
.plan-row-dark { background: rgba(255, 255, 255, 0.05); }
.plan-row:active { transform: scale(0.99); }
.plan-name { font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; letter-spacing: -0.005em; }
.plan-price { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; text-align: right; }
.plan-price-amount { font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.plan-price-sub { font-family: 'Manrope', sans-serif; font-size: 11.5px; font-weight: 500; }

.skeleton-row { height: 60px; border-radius: 14px; }
.skeleton-light { background: linear-gradient(90deg, rgba(15,23,42,0.05) 25%, rgba(15,23,42,0.09) 37%, rgba(15,23,42,0.05) 63%); background-size: 400% 100%; animation: shimmer 1.3s ease-in-out infinite; }
.skeleton-dark { background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.09) 37%, rgba(255,255,255,0.05) 63%); background-size: 400% 100%; animation: shimmer 1.3s ease-in-out infinite; }
@keyframes shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
@media (prefers-reduced-motion: reduce) { .skeleton-light, .skeleton-dark { animation: none; } }

.info-state { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 28px 16px; font-family: 'Manrope', sans-serif; font-size: 14px; line-height: 1.45; }
.foot-note { margin: 0; font-family: 'Manrope', sans-serif; font-size: 12px; line-height: 1.45; text-align: center; }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
