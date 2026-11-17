<template>
  <section class="kiosk-receipt" :aria-label="$t('Receipt')">
    <div class="kiosk-receipt__summary">
      <div class="kiosk-receipt__summary-line">
        <h2>{{ primaryAmount || defaultPrimary }}</h2>
        <span class="kiosk-receipt__status" :class="{ 'is-paid': confirmed }"><Icon v-if="confirmed" icon="tabler:check" width="15" height="15" />{{ confirmed ? $t('Paid') : $t('Waiting for confirmation') }}</span>
      </div>
      <p>{{ dateText }}<template v-if="dateText"> · </template>{{ formatSats(sale.totalSats) }}</p>
    </div>
    <div class="kiosk-receipt__items" tabindex="0" role="region" :aria-label="$t('Receipt items')">
      <div v-for="(item, index) in sale.items" :key="item.id || index" class="kiosk-receipt__item">
        <span class="kiosk-receipt__item-name">{{ item.qty }} × {{ item.name }}<small>{{ $t('{price} each', { price: figures.items[index].unit }) }}</small></span>
        <strong>{{ lineLabel(item, index) }}</strong>
      </div>
      <p v-if="!sale.items?.length" class="kiosk-receipt__empty">{{ $t('No item details were recorded for this payment.') }}</p>
    </div>
    <div v-if="hasExtras" class="kiosk-receipt__totals">
      <div><span>{{ $t('Items') }}</span><strong>{{ figures.subtotal }}</strong></div>
      <div v-if="sale.tipSats || sale.tipMinor"><span>{{ $t('Tip') }}</span><strong>{{ figures.tip }}</strong></div>
      <div v-if="sale.roundUpSats || sale.roundUpMinor"><span>{{ $t('Round-up') }}</span><strong>{{ figures.roundUp }}</strong></div>
    </div>
  </section>
</template>

<script>
import { Icon } from '@iconify/vue';
import { kioskReceiptFigures } from '../../utils/kioskMerchant.js';

/** An immutable receipt snapshot. Details, labels, printing and export belong to the owner's More menu. */
export default {
  name: 'KioskReceipt',
  components: { Icon },
  props: {
    sale: { type: Object, required: true },
    formatCurrency: { type: Function, required: true },
    formatSats: { type: Function, required: true },
    formatDate: { type: Function, default: null },
    formatItemTotal: { type: Function, default: null },
    primaryAmount: { type: String, default: '' },
    /** An explicit parent confirmation may be used when the snapshot status is held separately. */
    paid: { type: Boolean, default: false },
  },
  computed: {
    confirmed() { return this.paid || this.sale.status === 'paid'; },
    hasExtras() { return Boolean(this.sale.tipSats || this.sale.tipMinor || this.sale.roundUpSats || this.sale.roundUpMinor); },
    figures() { return kioskReceiptFigures(this.sale, { money: this.formatCurrency, bitcoin: this.formatSats }); },
    defaultPrimary() { return this.figures.total; },
    dateText() {
      const value = this.sale.paidAt || this.sale.createdAt;
      if (this.formatDate) return this.formatDate(value);
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(this.$i18n?.locale || undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
    },
  },
  methods: {
    lineLabel(item, index) {
      return this.formatItemTotal ? this.formatItemTotal(item) : this.figures.items[index].line;
    },
  },
};
</script>

<style scoped>
.kiosk-receipt { display: flex; flex: 1; flex-direction: column; gap: 8px; height: 100%; min-height: 0; color: var(--text-primary); }
.kiosk-receipt__summary { flex: none; padding: 2px 0 8px; border-bottom: 1px solid var(--border-card); }
.kiosk-receipt__summary-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.kiosk-receipt__summary h2 { min-width: 0; margin: 0; color: var(--text-primary); font: 750 28px/1.2 'Manrope', sans-serif; letter-spacing: -.03em; overflow-wrap: anywhere; }
.kiosk-receipt__summary p { margin: 5px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.4; }
.kiosk-receipt__status { display: inline-flex; align-items: center; justify-content: center; gap: 4px; flex: none; max-width: 50%; padding: 4px 9px; border-radius: 9px; background: var(--bg-input); color: var(--text-secondary); font: 650 11px/1.4 'Manrope', sans-serif; }
.kiosk-receipt__status.is-paid { background: rgba(5,149,115,.08); color: var(--brand-accent-text); }
.kiosk-receipt__items { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: thin; }
.kiosk-receipt__item { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; min-height: 78px; padding: 15px 2px; border-bottom: 1px solid var(--border-card); }
.kiosk-receipt__item:last-child { border-bottom: 0; }
.kiosk-receipt__item-name { min-width: 0; color: var(--text-primary); font: 500 14px/1.45 'Manrope', sans-serif; overflow-wrap: anywhere; }
.kiosk-receipt__item-name small { display: block; margin-top: 4px; color: var(--text-secondary); font-size: 12px; line-height: 1.45; }
.kiosk-receipt__item strong { flex: none; color: var(--text-primary); font: 650 14px/1.45 'Manrope', sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
.kiosk-receipt__totals { flex: none; padding-top: 5px; border-top: 1px solid var(--border-card); }
.kiosk-receipt__totals div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 3px 0; font-size: 12px; }
.kiosk-receipt__totals strong { font-weight: 650; font-variant-numeric: tabular-nums; }
.kiosk-receipt__empty { padding: 24px 8px; color: var(--text-secondary); text-align: center; font-size: 13px; line-height: 1.5; }
.kiosk-receipt__items:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: -2px; }
@media(max-width:350px) { .kiosk-receipt__summary h2 { font-size: 27px; } }
@media print { .kiosk-receipt, .kiosk-receipt__items { display: block; height: auto; overflow: visible; } .kiosk-receipt__status { display: none; } }
</style>
