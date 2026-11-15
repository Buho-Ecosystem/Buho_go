<template>
  <span
    class="branta-merchant-mark"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : businessName"
    :aria-hidden="decorative ? 'true' : undefined"
    :style="markStyle"
  >
    <img v-if="imageUrl && !failed" :src="imageUrl" alt="" referrerpolicy="no-referrer" @error="failed = true" />
    <span v-else class="branta-merchant-initials" aria-hidden="true">{{ initials }}</span>
  </span>
</template>
<script>
import { brantaAvatar } from '../utils/branta.js'
// A checked business's logo, or its initials when there is no artwork.
// Shared by the check view and the paid screen; takes the check as it is
// shown or as it was saved ({ name, logoUrl, logoLightUrl, environment }).
export default {
  name: 'BrantaMerchantMark',
  props: {
    verification: { type: Object, default: null },
    size: { type: Number, default: 56 },
    decorative: { type: Boolean, default: false },
  },
  data: () => ({ failed: false }),
  computed: {
    businessName() { return this.verification?.name || this.$t('Business') },
    initials() { return this.businessName.trim().replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase() },
    imageUrl() { return brantaAvatar(this.verification)?.url || '' },
    markStyle() {
      const hasArtwork = this.imageUrl && !this.failed
      const darkArt = hasArtwork && this.verification?.logoUrl && !this.verification?.logoLightUrl
      return {
        width: `${this.size}px`,
        height: `${this.size}px`,
        fontSize: `${this.size * .35}px`,
        background: darkArt ? '#152129' : 'var(--bg-input)',
      }
    },
  },
  watch: { imageUrl() { this.failed = false } },
}
</script>
<style scoped>
.branta-merchant-mark { display: inline-grid; place-items: center; flex-shrink: 0; border-radius: 24%; overflow: hidden; color: var(--text-primary); vertical-align: middle; }
.branta-merchant-mark img { display: block; width: 100%; height: 100%; object-fit: contain; padding: 8%; }
.branta-merchant-initials { font-family: 'Manrope', sans-serif; font-weight: 700; line-height: 1; }
</style>
