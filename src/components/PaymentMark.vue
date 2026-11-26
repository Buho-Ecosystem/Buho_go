<template>
  <span v-if="kind" class="payment-mark" :class="`payment-mark--${kind}`" aria-hidden="true">
    <ArkadeLogo v-if="kind === 'arkade'" variant="mark" :size="size" alt="" />
    <img v-else :src="src" alt="" :style="{ height: `${size}px` }" draggable="false" />
  </span>
</template>

<script>
/**
 * The logo of how an address is paid, the same in every list, sheet and page:
 *
 *   Lightning address or pay link  the Bitcoin Lightning mark
 *   Bitcoin address                the Bitcoin coin
 *   Spark address                  the Spark asterisk, in the theme's ink
 *   Arkade address                 the Arkade mark (ArkadeLogo owns its colours)
 *
 * The kind is the address's stored `addressType`, else what the address reads
 * as (utils/contactAddress). Decorative: the address or a word next to it says
 * the same, so screen readers skip it.
 */
import ArkadeLogo from './ArkadeLogo.vue'
import { paymentMarkKind } from '../utils/paymentMark.js'

const SOURCES = {
  lightning: '/icons/bitcoin-lightning-logos.svg',
  bitcoin: '/icons/bitcoin.svg',
}

export default {
  name: 'PaymentMark',
  components: { ArkadeLogo },
  props: {
    addressType: { type: String, default: '' },
    address: { type: String, default: '' },
    /** Height in px; the Bitcoin Lightning mark is wider than tall. */
    size: { type: Number, default: 14 },
  },
  computed: {
    kind() {
      return paymentMarkKind(this.addressType, this.address)
    },
    src() {
      if (this.kind === 'spark') {
        return this.$q.dark.isActive ? '/Spark/Spark Asterisk White.svg' : '/Spark/Spark Asterisk Black.svg'
      }
      return SOURCES[this.kind] || ''
    },
  },
}
</script>

<style scoped>
.payment-mark {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  line-height: 0;
}

.payment-mark img {
  display: block;
  width: auto;
}
</style>
