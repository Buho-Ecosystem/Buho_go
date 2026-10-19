<!--
  The mark of a way to connect a wallet, from its utils/connectWallets
  entry: the wallet's own logo, or a plain glyph (`icon`) for "another
  wallet". Sized by the tile around it.
-->
<template>
  <img v-if="wallet.logo" :src="wallet.logo" alt="" class="connect-mark" :width="size" :height="size">
  <Icon v-else :icon="wallet.icon || 'tabler:wallet'" :width="size * 0.7" :height="size * 0.7" :aria-hidden="true" />
</template>

<script>
export default {
  name: 'ConnectWalletMark',
  props: {
    /** utils/connectWallets entry. */
    wallet: { type: Object, required: true },
    size: { type: Number, default: 22 },
  },
};
</script>

<style scoped>
.connect-mark {
  display: block;
  object-fit: contain;
}
</style>
