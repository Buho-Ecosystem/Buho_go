<template>
  <div class="vpn-config">
    <!-- Loading -->
    <div v-if="loading" class="row-list">
      <div v-for="n in 4" :key="n" class="skeleton-row" :class="$q.dark.isActive ? 'skeleton-dark' : 'skeleton-light'"></div>
    </div>

    <template v-else-if="durations.length">
      <!-- Server location (top, compact) -->
      <button
        type="button"
        class="location-row"
        :class="$q.dark.isActive ? 'location-row-dark' : 'location-row-light'"
        @click="locationSheetOpen = true"
      >
        <span class="row-flag">{{ selectedLocation?.flag || '🌍' }}</span>
        <span class="loc-text">
          <span class="loc-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ $t('Server location') }}</span>
          <span class="row-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
            {{ selectedLocation?.name || $t('Choose a server') }}
          </span>
        </span>
        <Icon icon="tabler:chevron-right" width="18" height="18" class="row-go" />
      </button>

      <!-- Plan section head + inline help -->
      <div class="plan-head">
        <span class="block-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t('Choose your plan') }}</span>
        <ShopInfoTooltip
          tone="brand"
          icon="tabler:shield-lock"
          :aria-label="$t('How VPN works')"
          :title="$t('How you get your VPN')"
          :lede="$t('A private connection you set up with the WireGuard app.')"
          :steps="vpnHelpSteps"
        />
      </div>

      <!-- Selectable duration rows -->
      <div
        class="plan-group"
        :class="$q.dark.isActive ? 'plan-group-dark' : 'plan-group-light'"
        role="radiogroup"
        :aria-label="$t('Choose your plan')"
      >
        <button
          v-for="d in durations"
          :key="d.value"
          type="button"
          class="plan-row"
          :class="{ 'plan-row--selected': d.value === selectedDurationValue }"
          role="radio"
          :aria-checked="d.value === selectedDurationValue ? 'true' : 'false'"
          @click="selectedDurationValue = d.value"
        >
          <span class="plan-radio" :class="$q.dark.isActive ? 'plan-radio-dark' : 'plan-radio-light'" aria-hidden="true">
            <Icon :icon="d.value === selectedDurationValue ? 'tabler:circle-check-filled' : 'tabler:circle'" width="20" height="20" />
          </span>

          <span class="bundle-main">
            <span class="bundle-data" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ d.label }}</span>
            <span class="plan-sub" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
              <span v-if="isBest(d) && savePct(d) >= 15" class="popular-tag">{{ $t('Best value · save {pct}%', { pct: savePct(d) }) }}</span>
              <span v-if="perDayLabel(d)">{{ perDayLabel(d) }}</span>
            </span>
          </span>

          <span class="bundle-price">
            <span
              class="bundle-price-amount"
              :class="d.value === selectedDurationValue ? 'plan-price--selected' : ($q.dark.isActive ? 'item-label-dark' : 'item-label-light')"
            >
              {{ d.priceSatsEstimate ? `≈ ${formatSats(d.priceSatsEstimate)}` : formatUsd(d.priceUsd) }}
            </span>
            <span v-if="d.priceSatsEstimate" class="bundle-price-sub" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t('sats') }} · {{ formatUsd(d.priceUsd) }}
            </span>
          </span>
        </button>
      </div>

      <!-- Trust line -->
      <div class="trust-row" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
        <span class="trust-item"><Icon icon="tabler:shield-check" width="15" height="15" /> {{ $t('High security') }}</span>
        <span class="trust-item"><Icon icon="tabler:bolt" width="15" height="15" /> {{ $t('Fast connection') }}</span>
      </div>

      <!-- Sticky CTA -->
      <div class="cta-bar" :class="$q.dark.isActive ? 'cta-bar-dark' : 'cta-bar-light'">
        <button
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :disabled="!canContinue"
          @click="onContinue"
        >
          <span>{{ ctaLabel }}</span>
        </button>
        <span v-if="canContinue" class="cta-context" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">{{ ctaContext }}</span>
      </div>
    </template>

    <div v-else class="info-state" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
      <Icon icon="tabler:cloud-off" width="22" height="22" />
      <span>{{ $t("Couldn't load VPN plans. Try again.") }}</span>
    </div>

    <LocationPickerSheet
      v-model="locationSheetOpen"
      :locations="locations"
      :selected-code="selectedLocation?.code || ''"
      @select="onLocationSelect"
    />
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import LocationPickerSheet from './LocationPickerSheet.vue';
import ShopInfoTooltip from './ShopInfoTooltip.vue';

/**
 * VPN configurator. A compact plan-selector: a server-location row up top,
 * then selectable duration rows (mirroring the eSIM bundle rows) that each
 * carry their own price + a per-day / best-value hint, and a sticky CTA that
 * restates the total. Emits `continue({ duration, location })`; the parent
 * builds the purchase descriptor.
 */
const DEFAULT_LOCATION_ISO = 'NL'; // privacy-friendly, central default

// Term length (the catalog `value`) -> day count, for the per-day / savings
// math. Falls back to parsing the label, then to the raw value.
const DAYS_BY_VALUE = { 1: 1, 7: 7, 30: 30, 90: 90, 180: 180, 365: 365 };

export default {
  name: 'VpnConfigurator',
  components: { Icon, LocationPickerSheet, ShopInfoTooltip },
  props: {
    durations: { type: Array, default: () => [] },
    locations: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
  },
  emits: ['continue'],

  data() {
    return {
      selectedDurationValue: null,
      selectedLocation: null,
      locationSheetOpen: false,
    };
  },

  computed: {
    selectedDuration() {
      return this.durations.find((d) => d.value === this.selectedDurationValue) || null;
    },
    canContinue() {
      return !!this.selectedDuration && !!this.selectedLocation;
    },
    /** Longest term = best value (the one ensureDefaults preselects). */
    bestDuration() {
      if (!this.durations.length) return null;
      return this.durations.reduce((a, b) => (b.value > a.value ? b : a), this.durations[0]);
    },
    /** Worst (highest) per-day USD rate across plans — the savings baseline. */
    baselinePerDayUsd() {
      let max = 0;
      for (const d of this.durations) {
        const days = this.durationDays(d);
        if (days > 0 && Number.isFinite(d.priceUsd)) max = Math.max(max, d.priceUsd / days);
      }
      return max;
    },
    vpnHelpSteps() {
      return [
        this.$t('Pick a server location and how long you want it.'),
        this.$t('Pay the invoice in bitcoin. No account needed.'),
        this.$t('Your config and a setup QR code appear right here after payment.'),
        this.$t('Open the WireGuard app, tap add, then scan the QR or import the file.'),
        this.$t('Switch the tunnel on to connect. Keep the config safe, it is your key.'),
      ];
    },
    ctaLabel() {
      if (!this.canContinue) return this.$t('Continue');
      const d = this.selectedDuration;
      const price = d.priceSatsEstimate
        ? `≈ ${this.formatSats(d.priceSatsEstimate)} ${this.$t('sats')}`
        : this.formatUsd(d.priceUsd);
      return `${this.$t('Continue')} · ${price}`;
    },
    ctaContext() {
      const d = this.selectedDuration;
      const l = this.selectedLocation;
      return [this.formatUsd(d?.priceUsd), d?.label, l?.name].filter(Boolean).join(' · ');
    },
  },

  watch: {
    durations: { handler() { this.ensureDefaults(); }, immediate: true },
    locations: { handler() { this.ensureDefaults(); }, immediate: true },
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

    durationDays(d) {
      if (DAYS_BY_VALUE[d.value]) return DAYS_BY_VALUE[d.value];
      const m = String(d.label || '').match(/(\d+)\s*(day|week|month|year)/i);
      if (m) {
        const n = +m[1];
        const unit = m[2].toLowerCase();
        if (unit.startsWith('week')) return n * 7;
        if (unit.startsWith('month')) return n * 30;
        if (unit.startsWith('year')) return n * 365;
        return n;
      }
      return Number(d.value) || 1;
    },

    isBest(d) {
      return this.bestDuration && d.value === this.bestDuration.value;
    },

    /** Savings vs the worst per-day rate. Rate-independent (a ratio), so it is
     *  computed in USD and stays stable regardless of the sats estimate. */
    savePct(d) {
      const base = this.baselinePerDayUsd;
      const days = this.durationDays(d);
      if (!base || !days || !Number.isFinite(d.priceUsd)) return 0;
      return Math.round((1 - (d.priceUsd / days) / base) * 100);
    },

    perDayLabel(d) {
      const days = this.durationDays(d);
      if (days <= 0) return '';
      if (d.priceSatsEstimate) {
        return `≈ ${this.$t('{n} sats/day', { n: this.formatSats(Math.round(d.priceSatsEstimate / days)) })}`;
      }
      if (Number.isFinite(d.priceUsd)) {
        return `≈ ${this.$t('{usd}/day', { usd: this.formatUsd(d.priceUsd / days) })}`;
      }
      return '';
    },

    ensureDefaults() {
      if (this.selectedDurationValue == null && this.bestDuration) {
        this.selectedDurationValue = this.bestDuration.value;
      }
      if (!this.selectedLocation && this.locations.length) {
        this.selectedLocation =
          this.locations.find((l) => l.isoCode === DEFAULT_LOCATION_ISO) || this.locations[0];
      }
    },

    onLocationSelect(loc) {
      this.selectedLocation = loc;
    },

    onContinue() {
      if (!this.canContinue) return;
      this.$emit('continue', { duration: this.selectedDuration, location: this.selectedLocation });
    },
  },
};
</script>

<style scoped>
.vpn-config { display: flex; flex-direction: column; gap: 14px; }

.block-title { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; }

/* Server location row (compact, stacked label). */
.location-row { display: flex; align-items: center; gap: 12px; padding: 0 14px; height: 60px; border: 0; border-radius: 14px; cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: left; }
.location-row-light { background: rgba(15, 23, 42, 0.04); }
.location-row-dark { background: rgba(255, 255, 255, 0.04); }
.row-flag { font-size: 22px; width: 26px; text-align: center; flex-shrink: 0; }
.loc-text { flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.loc-label { font-family: 'Manrope', sans-serif; font-size: 11.5px; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }
.row-name { font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-go { flex-shrink: 0; opacity: 0.6; }

.plan-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

/* Grouped selectable rows (one container + hairline dividers). */
.plan-group { border-radius: 16px; overflow: hidden; }
.plan-group-light { background: rgba(15, 23, 42, 0.04); box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.05); }
.plan-group-dark { background: rgba(255, 255, 255, 0.04); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }

.plan-row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 14px 16px; min-height: 68px; border: 0; background: transparent; cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: left; position: relative; transition: background-color 0.12s ease, box-shadow 0.12s ease; }
.plan-row + .plan-row::before { content: ''; position: absolute; top: 0; left: 16px; right: 16px; height: 1px; }
.plan-group-light .plan-row + .plan-row::before { background: rgba(15, 23, 42, 0.06); }
.plan-group-dark .plan-row + .plan-row::before { background: rgba(255, 255, 255, 0.08); }

/* Selected: ring + tint + filled radio + green price (color-independent cues). */
.plan-row--selected { background: rgba(21, 222, 114, 0.10); box-shadow: inset 0 0 0 1.5px rgba(21, 222, 114, 0.5); border-radius: 16px; }
.plan-row--selected::before,
.plan-row--selected + .plan-row::before { display: none; }
body.body--dark .plan-row--selected { background: rgba(21, 222, 114, 0.16); }

.plan-radio { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; }
.plan-radio-light { color: #94a3b8; }
.plan-radio-dark { color: #64748b; }
.plan-row--selected .plan-radio { color: #15a35b; }
body.body--dark .plan-row--selected .plan-radio { color: #15de72; }

.bundle-main { flex: 1 1 auto; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.bundle-data { font-family: 'Manrope', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
.plan-sub { font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.popular-tag { font-size: 10.5px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: #0e7b3f; background: rgba(21, 222, 114, 0.12); padding: 2px 7px; border-radius: 999px; }
body.body--dark .popular-tag { color: #6ee7a8; background: rgba(21, 222, 114, 0.16); }

.bundle-price { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
.bundle-price-amount { font-family: 'Manrope', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.bundle-price-sub { font-family: 'Manrope', sans-serif; font-size: 11.5px; font-weight: 500; }
.plan-price--selected { color: #0e7b3f; }
body.body--dark .plan-price--selected { color: #6ee7a8; }

.trust-row { display: flex; gap: 16px; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 500; }
.trust-item { display: inline-flex; align-items: center; gap: 5px; }

/* Sticky CTA bar — fades over the shop page background. */
.cta-bar { position: sticky; bottom: 0; display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 12px 0 max(8px, env(safe-area-inset-bottom, 0px)); margin-top: 2px; }
.cta-bar-light { background: linear-gradient(to top, #FAF7EF 62%, rgba(250, 247, 239, 0)); }
.cta-bar-dark { background: linear-gradient(to top, #0C0C0C 62%, rgba(12, 12, 12, 0)); }
.cta-context { text-align: center; font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 500; }

.primary-cta { width: 100%; height: 48px; border-radius: 16px; border: 0; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: filter 0.18s ease, transform 0.1s ease, opacity 0.18s ease; }
.primary-cta:disabled { opacity: 0.45; cursor: default; }
.primary-cta:not(:disabled):active { transform: scale(0.98); }

.row-list { display: flex; flex-direction: column; gap: 8px; }
.skeleton-row { height: 60px; border-radius: 14px; }
.skeleton-light { background: rgba(15, 23, 42, 0.05); animation: pulse 1.4s ease-in-out infinite; }
.skeleton-dark { background: rgba(255, 255, 255, 0.05); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) { .skeleton-light, .skeleton-dark { animation: none; } }

.info-state { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 28px 16px; font-family: 'Manrope', sans-serif; font-size: 14px; }

.item-label-light { color: #0f172a; }
.item-label-dark { color: #f8fafc; }
</style>
