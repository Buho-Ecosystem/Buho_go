<template>
  <div class="pc" :class="$q.dark.isActive ? 'pc-dark' : 'pc-light'">
    <button type="button" class="pc-main" :aria-label="openLabel" @click="$emit('open', order)">
      <div class="pc-top">
        <span class="pc-flag" aria-hidden="true">{{ order.flag || fallbackGlyph }}</span>
        <span class="pc-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ order.countryName || order.title || defaultName }}
        </span>
        <span v-if="chip" class="pc-chip" :class="`pc-chip--${chip.tone}`">{{ chip.label }}</span>
        <Icon v-else icon="tabler:chevron-right" width="16" height="16" class="pc-go" />
      </div>

      <div class="pc-sub" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
        {{ subtitle }}
      </div>

      <!-- The meter is drawn only when the provider actually reports a figure.
           A bar sitting at zero because the data is missing reads as broken. -->
      <template v-if="percent != null">
        <div class="pc-bar" :class="$q.dark.isActive ? 'pc-bar-dark' : 'pc-bar-light'">
          <span :style="{ width: `${Math.round(percent)}%` }" :class="percent >= 90 ? 'pc-bar-fill--low' : 'pc-bar-fill'"></span>
        </div>
        <div class="pc-usage" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
          <span>{{ usageLabel }}</span>
          <span class="pc-usage-pct">{{ Math.round(percent) }}%</span>
        </div>
      </template>
    </button>

    <div class="pc-actions">
      <button
        type="button"
        class="pc-btn"
        :class="$q.dark.isActive ? 'pc-btn-dark' : 'pc-btn-light'"
        @click="$emit('extend', order)"
      >
        <Icon icon="tabler:plus" width="15" height="15" />
        <span>{{ isEsim ? $t('Add data') : $t('Extend') }}</span>
      </button>
      <button
        type="button"
        class="pc-btn"
        :class="$q.dark.isActive ? 'pc-btn-dark' : 'pc-btn-light'"
        @click="$emit('open', order)"
      >
        <Icon :icon="isEsim ? 'tabler:qrcode' : 'tabler:shield-lock'" width="15" height="15" />
        <span>{{ isEsim ? $t('Install code') : $t('Show config') }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import { ORDER_KIND } from '../../services/nadanada/orders.js';

/**
 * One delivered product: an eSIM or a VPN subscription.
 *
 * Everything on the face of this card is either stored locally or reported by
 * the provider — nothing is inferred. When the live lookup has not happened
 * (offline, first render, a provider hiccup) the card falls back to what was
 * saved at purchase time and still offers both actions, because the install
 * codes and the config live on the device and never depend on the network.
 */
export default {
  name: 'ProductCard',
  components: { Icon },
  props: {
    order: { type: Object, required: true },
    /** Derived live state: { state, endsAt, startsAt, daysLeft, percent }. */
    derived: { type: Object, default: null },
  },
  emits: ['open', 'extend'],

  computed: {
    isEsim() {
      return this.order.kind === ORDER_KIND.ESIM;
    },
    fallbackGlyph() {
      return this.isEsim ? '📶' : '🛡️';
    },
    defaultName() {
      return this.isEsim ? this.$t('eSIM') : this.$t('VPN');
    },
    openLabel() {
      return this.isEsim ? this.$t('Show install code') : this.$t('Show VPN config');
    },
    percent() {
      const p = this.derived?.percent;
      return Number.isFinite(p) ? p : null;
    },

    chip() {
      // No live data yet: say nothing rather than guess a status.
      if (!this.derived) return null;
      switch (this.derived.state) {
        case 'active': return { label: this.$t('Active'), tone: 'ok' };
        case 'upcoming': return { label: this.$t('Starts soon'), tone: 'soft' };
        case 'expired': return { label: this.$t('Ended'), tone: 'soft' };
        case 'disabled': return { label: this.$t('Paused'), tone: 'warn' };
        default:
          return this.isEsim ? { label: this.$t('Ready to install'), tone: 'soft' } : null;
      }
    },

    subtitle() {
      const parts = [];
      const plan = this.order.meta || this.order.planLabel || this.order.durationLabel;
      if (plan) parts.push(plan);

      const d = this.derived;
      if (d?.startsAt && d?.endsAt) {
        parts.push(`${this.shortDate(d.startsAt)} – ${this.shortDate(d.endsAt)}`);
      } else if (d?.endsAt) {
        parts.push(this.$t('until {date}', { date: this.shortDate(d.endsAt) }));
      }
      if (Number.isFinite(d?.daysLeft) && d.state === 'active') {
        parts.push(this.$t('{n} days left', { n: d.daysLeft }));
      }
      if (!parts.length) parts.push(this.$t('Saved on this device'));
      return parts.join(' · ');
    },

    /**
     * A data figure only appears when the provider's own numbers proved the
     * unit — a bundle calling itself 1GB and reporting 1000000000 units has
     * told us what a unit is (see unitsAreBytes). Otherwise the label stays
     * unit-free and the percentage carries the meaning, because inventing a
     * unit would misstate how much allowance someone has left.
     *
     * VPN bandwidth has no such cross-check anywhere in nadanada's spec, so it
     * is always percentage-only.
     */
    usageLabel() {
      const d = this.derived;
      if (Number.isFinite(d?.bytesUsed) && Number.isFinite(d?.bytesTotal)) {
        return this.$t('{used} of {total}', {
          used: this.formatData(d.bytesUsed),
          total: this.formatData(d.bytesTotal),
        });
      }
      if (this.isEsim && d?.state !== 'active') return this.$t('Data used in total');
      return this.$t('Data used');
    },
  },

  methods: {
    /** Bytes to MB/GB, decimal like every carrier quotes an allowance. */
    formatData(bytes) {
      if (!Number.isFinite(bytes)) return '';
      const useGb = bytes >= 1e9;
      const value = useGb ? bytes / 1e9 : bytes / 1e6;
      const digits = value < 10 && !Number.isInteger(value) ? 1 : 0;
      let text;
      try {
        text = new Intl.NumberFormat(this.$i18n?.locale || undefined, {
          maximumFractionDigits: digits,
        }).format(value);
      } catch { text = value.toFixed(digits); }
      return `${text} ${useGb ? 'GB' : 'MB'}`;
    },

    shortDate(iso) {
      const t = iso ? Date.parse(iso) : NaN;
      if (!Number.isFinite(t)) return '';
      try {
        return new Intl.DateTimeFormat(this.$i18n?.locale || undefined, { day: 'numeric', month: 'short' }).format(t);
      } catch { return new Date(t).toISOString().slice(0, 10); }
    },
  },
};
</script>

<style scoped>
.pc { display: flex; flex-direction: column; border-radius: 16px; overflow: hidden; }
.pc-light { background: rgba(15, 23, 42, 0.04); box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.06); }
.pc-dark { background: rgba(255, 255, 255, 0.04); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07); }

.pc-main {
  all: unset;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 14px 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.pc-main:active { opacity: 0.75; }

.pc-top { display: flex; align-items: center; gap: 9px; min-width: 0; }
.pc-flag { font-size: 20px; flex-shrink: 0; line-height: 1; }
.pc-name {
  font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 700; letter-spacing: -0.01em;
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pc-go { flex-shrink: 0; opacity: 0.5; }

.pc-chip {
  flex-shrink: 0;
  font-family: 'Manrope', sans-serif; font-size: 10.5px; font-weight: 700;
  letter-spacing: 0.03em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 999px; white-space: nowrap;
}
.pc-chip--ok { background: rgba(21, 222, 114, 0.14); color: #0e7b3f; }
body.body--dark .pc-chip--ok { background: rgba(21, 222, 114, 0.18); color: #6ee7a8; }
.pc-chip--warn { background: rgba(247, 147, 26, 0.16); color: #b45309; }
body.body--dark .pc-chip--warn { background: rgba(247, 147, 26, 0.2); color: #fbbf24; }
.pc-chip--soft { background: rgba(100, 116, 139, 0.14); color: #475569; }
body.body--dark .pc-chip--soft { background: rgba(148, 163, 184, 0.16); color: #cbd5e1; }

.pc-sub { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 500; line-height: 1.4; }

.pc-bar { height: 6px; border-radius: 999px; overflow: hidden; margin-top: 4px; }
.pc-bar-light { background: rgba(15, 23, 42, 0.08); }
.pc-bar-dark { background: rgba(255, 255, 255, 0.1); }
.pc-bar span { display: block; height: 100%; border-radius: 999px; }
.pc-bar-fill { background: #15a35b; }
body.body--dark .pc-bar-fill { background: #2bd17f; }
.pc-bar-fill--low { background: #d97706; }
body.body--dark .pc-bar-fill--low { background: #fbbf24; }

.pc-usage {
  display: flex; justify-content: space-between; gap: 10px;
  font-family: 'Manrope', sans-serif; font-size: 11.5px; font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.pc-usage-pct { flex-shrink: 0; }

.pc-actions { display: flex; gap: 8px; padding: 0 14px 12px; }
.pc-btn {
  all: unset;
  box-sizing: border-box;
  flex: 1 1 0;
  min-height: 44px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border-radius: 11px;
  font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 600;
  cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: center;
}
.pc-btn-light { background: rgba(15, 23, 42, 0.06); color: #0f172a; }
.pc-btn-dark { background: rgba(255, 255, 255, 0.08); color: #f8fafc; }
.pc-btn:active { transform: scale(0.98); }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
