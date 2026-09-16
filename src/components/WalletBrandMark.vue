<!--
  WalletBrandMark — the one place a wallet type turns into its brand glyph.

  The Spark / NWC / LNbits SVGs used to be pasted into every list that
  showed a wallet (Manage Wallets rows, the switcher sheet, now the wallet
  detail sheet); three copies of a 2KB path string is how they drift apart.
  Renders at `size` px inside whatever circle the caller draws.
-->
<template>
  <svg v-if="type === 'spark'" :width="size" :height="Math.round(size * 0.95)" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="white"/>
  </svg>
  <svg v-else-if="type === 'nwc'" :width="size" :height="size" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" :fill="`url(#${gradientId})`"/>
    <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="#897FFF"/>
    <defs>
      <linearGradient :id="gradientId" x1="123.989" y1="10.4384" x2="123.989" y2="249.939" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FFCA4A"/>
        <stop offset="1" stop-color="#F7931A"/>
      </linearGradient>
    </defs>
  </svg>
  <svg v-else-if="type === 'lnbits'" :width="Math.round(size * 0.9)" :height="size" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
  </svg>
  <ArkadeLogo v-else-if="type === 'arkade'" variant="mark" color="orange" :size="size" />
  <Icon v-else icon="tabler:wallet" :width="size" :height="size" style="color: white;" />
</template>

<script>
import ArkadeLogo from './ArkadeLogo.vue';

let uid = 0;

export default {
  name: 'WalletBrandMark',

  components: { ArkadeLogo },

  props: {
    /** Wallet type: 'spark' | 'nwc' | 'lnbits' | 'arkade' | anything else. */
    type: {
      type: String,
      default: ''
    },
    /** Glyph size in px (the caller draws its own circle around it). */
    size: {
      type: Number,
      default: 20
    }
  },

  data() {
    return {
      // SVG gradients are addressed by document-global id; a fixed id would
      // collide the moment two marks render on one screen.
      gradientId: `nwc_mark_grad_${++uid}`
    };
  }
};
</script>
