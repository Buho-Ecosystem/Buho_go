<!--
  WalletTypeChip — a small capsule naming a wallet's provider beside its mark.

  It takes the place of secondary text on rows that share one title (the
  Security page lists two "Bitcoin Backup" rows), so Spark and Arkade are
  told apart at a glance and by name. The mark is decorative; the label
  carries the meaning for assistive tech.
-->
<template>
  <span class="wallet-type-chip" :class="`wallet-type-chip--${type}`">
    <span class="wallet-type-chip__mark" aria-hidden="true">
      <WalletBrandMark :type="type" :size="11" color="currentColor" />
    </span>
    {{ label }}
  </span>
</template>

<script setup>
import { computed } from 'vue';
import { WALLET_TYPE_LABELS } from '../providers/WalletFactory';
import WalletBrandMark from './WalletBrandMark.vue';

const props = defineProps({
  /** Wallet type: 'spark' | 'arkade' | 'nwc' | 'lnbits'. */
  type: { type: String, required: true },
});

const label = computed(() => WALLET_TYPE_LABELS[props.type] || props.type);
</script>

<style scoped>
.wallet-type-chip {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 5px;
  padding: 3px 9px 3px 7px;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--chip-text);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.wallet-type-chip__mark { display: inline-flex; line-height: 0; }

/* Dark is the app default; light follows the body class, as in app.css.
   Neutral tint for providers that render in the text colour; Arkade keeps
   its orange, darkened for small text on the light paper. */
.wallet-type-chip { --chip-bg: rgba(255, 255, 255, 0.1); --chip-text: var(--text-primary); }
.wallet-type-chip--arkade { --chip-bg: rgba(241, 67, 23, 0.18); --chip-text: #FF8A66; }
body.body--light .wallet-type-chip { --chip-bg: rgba(26, 26, 28, 0.07); }
body.body--light .wallet-type-chip--arkade { --chip-bg: rgba(241, 67, 23, 0.11); --chip-text: #C0360F; }
</style>
