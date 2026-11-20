<!--
  WalletLogoTile: a wallet type's real logo on a rounded square in that
  brand's own colour, for Settings and Security rows. The marks come from
  WalletBrandMark, so every list draws the same logos:

    spark   white asterisk on black (both themes)
    nwc     the orange and violet mark on deep indigo
    lnbits  the magenta mark on deep plum
    arkade  the theme's Arkade tile (lavender in light, violet in dark),
            the mark recolours itself by theme

  Any other type falls back to a neutral tile with the wallet glyph.
-->
<template>
  <span
    class="wallet-logo-tile"
    :class="`wallet-logo-tile--${known ? type : 'other'}`"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.24)}px` }"
    aria-hidden="true"
  >
    <WalletBrandMark :type="known ? type : ''" :size="markSize" color="currentColor" />
  </span>
</template>

<script setup>
import { computed } from 'vue';
import WalletBrandMark from '../WalletBrandMark.vue';

const props = defineProps({
  /** Wallet type: 'spark' | 'nwc' | 'lnbits' | 'arkade'. */
  type: { type: String, default: '' },
  /** Edge length in px. */
  size: { type: Number, default: 32 },
});

const known = computed(() => ['spark', 'nwc', 'lnbits', 'arkade'].includes(props.type));
// Each mark has its own optical weight: the asterisk and the plug fill more of their box.
const markSize = computed(() => Math.round(props.size * ({ spark: 0.5, nwc: 0.6, lnbits: 0.6, arkade: 0.62 }[props.type] || 0.56)));
</script>

<style scoped>
.wallet-logo-tile {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.wallet-logo-tile--spark { background: #111113; }
.wallet-logo-tile--nwc { background: #2B2742; }
.wallet-logo-tile--lnbits { background: #2C2140; }
.wallet-logo-tile--arkade { background: var(--arkade-tile); box-shadow: inset 0 0 0 1px var(--arkade-tint-border); }
.wallet-logo-tile--other { background: var(--bg-input); color: var(--text-secondary); }
/* On the dark page the black and indigo tiles need an edge to stand apart. */
body.body--dark .wallet-logo-tile--spark,
body.body--dark .wallet-logo-tile--nwc,
body.body--dark .wallet-logo-tile--lnbits { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1); }
</style>
