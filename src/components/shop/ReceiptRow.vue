<template>
  <div class="receipt" :class="$q.dark.isActive ? 'receipt-dark' : 'receipt-light'">
    <div class="receipt-head">
      <span class="receipt-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
        {{ $t('Your receipt') }}
      </span>
      <ShopInfoTooltip
        tone="toolbox"
        trigger-icon="tabler:tools"
        icon="tabler:tools"
        :aria-label="$t('What the receipt is for')"
        :title="$t('What this receipt is for')"
        :lede="$t('It is the proof that this order is yours.')"
        :steps="helpSteps"
      />
      <button
        type="button"
        class="receipt-copy"
        :class="$q.dark.isActive ? 'receipt-copy-dark' : 'receipt-copy-light'"
        :aria-label="$t('Copy receipt')"
        @click="copy"
      >
        <Icon :icon="copied ? 'tabler:check' : 'tabler:copy'" width="15" height="15" />
        <span>{{ copied ? $t('Copied') : $t('Copy') }}</span>
      </button>
    </div>

    <div class="receipt-ref">{{ reference }}</div>

    <div v-if="expanded" class="receipt-lines">
      <div v-for="line in detailLines" :key="line.label" class="receipt-line">
        <span class="receipt-line-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">{{ line.label }}</span>
        <span class="receipt-line-value">{{ line.value }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import { orderReference, orderReceiptText } from '../../services/nadanada/orders.js';
import { writeClipboardCrossPlatform } from '../../utils/shopClipboard.js';
import ShopInfoTooltip from './ShopInfoTooltip.vue';

/**
 * The receipt for one nadanada order.
 *
 * nadanada has no accounts, so the payment hash / checkout id on this row is
 * the only handle that can redeem a paid order — from inside the app or, if it
 * ever comes to that, in an email to the provider. It appears the moment money
 * is at stake and never disappears, because "I paid and there is nothing to
 * show for it" is precisely the state this whole feature exists to prevent.
 */
export default {
  name: 'ReceiptRow',
  components: { Icon, ShopInfoTooltip },
  props: {
    order: { type: Object, required: true },
    /** Show every stored reference, not just the short one. */
    expanded: { type: Boolean, default: false },
  },

  data() {
    return { copied: false, copiedTimer: null };
  },

  beforeUnmount() {
    clearTimeout(this.copiedTimer);
  },

  computed: {
    reference() {
      return orderReference(this.order) || this.$t('Not available');
    },
    helpSteps() {
      return [
        this.$t('Keep it if an order ever gets stuck.'),
        this.$t('Copy it into a message to the provider and they can find your order.'),
        this.$t('Treat it like a ticket. Anyone who has it can claim this order, so only send it to the provider.'),
        this.$t('It stays in Your products, so you can come back for it any time.'),
      ];
    },
    detailLines() {
      const o = this.order || {};
      const lines = [];
      if (o.paymentHash) lines.push({ label: this.$t('Payment hash'), value: o.paymentHash });
      if (o.checkoutId) lines.push({ label: this.$t('Checkout ID'), value: o.checkoutId });
      if (o.orderReference) lines.push({ label: this.$t('Order reference'), value: o.orderReference });
      if (o.iccid) lines.push({ label: this.$t('ICCID'), value: o.iccid });
      if (o.publicKey) lines.push({ label: this.$t('Public key'), value: o.publicKey });
      if (Number.isFinite(o.priceSats)) {
        lines.push({ label: this.$t('Paid'), value: `${o.priceSats} ${this.$t('sats')}` });
      }
      return lines;
    },
  },

  methods: {
    async copy() {
      try {
        await writeClipboardCrossPlatform(orderReceiptText(this.order));
        this.copied = true;
        clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => { this.copied = false; }, 1600);
      } catch { /* clipboard denied — the reference is on screen to read */ }
    },
  },
};
</script>

<style scoped>
.receipt { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-radius: 14px; }
.receipt-light { background: rgba(15, 23, 42, 0.045); }
.receipt-dark { background: rgba(255, 255, 255, 0.05); }

.receipt-head { display: flex; align-items: center; gap: 6px; }
.receipt-label { font-family: 'Manrope', sans-serif; font-size: 11.5px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; }

.receipt-copy {
  all: unset;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px;
  border-radius: 9px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  position: relative;
  -webkit-tap-highlight-color: transparent;
}
/* Invisible 44px tap target without changing the visual size. */
.receipt-copy::before { content: ''; position: absolute; inset: 50% 50% 50% 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); }
.receipt-copy-light { background: rgba(15, 23, 42, 0.06); color: #334155; }
.receipt-copy-dark { background: rgba(255, 255, 255, 0.08); color: #e2e8f0; }
.receipt-copy:active { transform: scale(0.97); }

.receipt-ref {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 13px;
  letter-spacing: 0.01em;
  overflow-wrap: anywhere;
}

.receipt-lines { display: flex; flex-direction: column; gap: 7px; margin-top: 4px; }
.receipt-line { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.receipt-line-label { font-family: 'Manrope', sans-serif; font-size: 11px; font-weight: 600; }
.receipt-line-value { font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace; font-size: 11.5px; overflow-wrap: anywhere; }
</style>
