<!--
  The mark of a way to connect a wallet: the wallet's own logo where there
  is one, a plain glyph for "another wallet". Sized by the tile around it.
-->
<template>
  <img v-if="logo" :src="logo" alt="" class="connect-mark" :class="`connect-mark--${wallet}`" :width="size" :height="size">
  <svg v-else-if="wallet === 'lnbits'" :width="size * 0.62" :height="size * 0.72" viewBox="0 0 502 902" fill="none" aria-hidden="true">
    <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1" />
  </svg>
  <Icon v-else icon="tabler:qrcode" :width="size * 0.7" :height="size * 0.7" :aria-hidden="true" />
</template>

<script>
const LOGOS = {
  albyhub: '/Social_Wallet_logos/alby-hub.svg',
  coinos: '/Social_Wallet_logos/coinos.svg',
  buhohub: '/buho-mark-512.png',
};

export default {
  name: 'ConnectWalletMark',
  props: {
    /** 'albyhub' | 'coinos' | 'lnbits' | 'buhohub' | 'other' */
    wallet: { type: String, required: true },
    size: { type: Number, default: 22 },
  },
  computed: {
    logo() { return LOGOS[this.wallet] || ''; },
  },
};
</script>

<style scoped>
.connect-mark {
  display: block;
  object-fit: contain;
}
</style>
