<template>
  <span class="branta-merchant-mark" :role="decorative ? undefined : 'img'" :aria-label="decorative ? undefined : businessName" :aria-hidden="decorative ? 'true' : undefined" :style="markStyle">
    <img v-if="imageUrl && !failed" :src="imageUrl" alt="" referrerpolicy="no-referrer" @error="failed = true" />
    <span v-else class="branta-merchant-initials" aria-hidden="true">{{ initials }}</span>
  </span>
</template>
<script>
import { brantaAvatar, safeBrantaUrl } from '../utils/branta.js'
// Shared by review, payment status and the saved verification view. The
// old receipt shape remains supported without inventing a current check.
export default {
  name: 'BrantaMerchantMark',
  props: {
    verification: { type: Object, default: null },
    merchant: { type: Object, default: null },
    size: { type: Number, default: 56 },
    decorative: { type: Boolean, default: false },
  },
  data: () => ({ failed: false }),
  computed: {
    businessName() { return this.verification?.name || this.merchant?.name || this.$t('Business') },
    initials() { return this.businessName.trim().replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase() },
    imageUrl() {
      return this.verification ? brantaAvatar(this.verification)?.url || ''
        : safeBrantaUrl(this.merchant?.avatar?.url, this.merchant?.environment)
    },
    markStyle() {
      const hasArtwork = this.imageUrl && !this.failed
      const darkArt = hasArtwork && this.verification?.logoUrl && !this.verification?.logoLightUrl
      return { width: `${this.size}px`, height: `${this.size}px`, fontSize: `${this.size * .35}px`, background: darkArt ? '#152129' : hasArtwork && this.merchant?.avatar?.background || 'var(--bg-input)' }
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
