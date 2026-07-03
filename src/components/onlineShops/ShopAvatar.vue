<template>
  <span class="shop-avatar" :style="{ width: size + 'px', height: size + 'px' }">
    <!-- A deliberately published logo (Nostr merchant picture): list + detail. -->
    <img
      v-if="showLogo"
      :src="shop.logoUrl"
      alt=""
      class="shop-avatar-img"
      referrerpolicy="no-referrer"
      loading="lazy"
      @error="logoFailed = true"
    />
    <!-- Company favicon (first-party). Detail only. -->
    <img
      v-else-if="showFavicon"
      :src="faviconSrc"
      alt=""
      class="shop-avatar-img"
      referrerpolicy="no-referrer"
      loading="lazy"
      @error="faviconFailed = true"
    />
    <!-- Country flag (where they ship) from the offline circle-flags set. -->
    <Icon v-else-if="flagIconName" :icon="flagIconName" :width="size" :height="size" class="shop-avatar-flag" />
    <span v-else class="shop-avatar-letter" :style="{ background: letter.bg, color: letter.fg }">
      {{ letter.initial }}
    </span>
  </span>
</template>

<script>
import { Icon } from '@iconify/vue';
import { letterAvatar, faviconUrl } from '../../services/onlineShops';
import { flagIcon } from '../../services/onlineShops/flags.js';

/**
 * Shop avatar, most to least recognisable:
 *   1. logoUrl  — published logo (Nostr merchant picture); list + detail
 *   2. favicon  — first-party company favicon; DETAIL only (no per-shop pings in the list)
 *   3. flag     — offline circle-flags country flag (where they ship); never a CDN
 *   4. letter   — deterministic fallback
 * Circular tile so the circular flags fit edge to edge and all avatar types
 * read as one consistent shape.
 */
export default {
  name: 'ShopAvatar',
  components: { Icon },
  props: {
    shop: { type: Object, required: true },
    size: { type: Number, default: 44 },
    remote: { type: Boolean, default: false },
  },
  data() {
    return { logoFailed: false, faviconFailed: false };
  },
  computed: {
    showLogo() { return !!this.shop?.logoUrl && !this.logoFailed; },
    faviconSrc() { return this.shop?.host ? faviconUrl(this.shop.host) : ''; },
    showFavicon() { return !this.showLogo && this.remote && !!this.faviconSrc && !this.faviconFailed; },
    flagIconName() {
      return (!this.showLogo && !this.showFavicon) ? flagIcon(this.shop?.country?.code) : '';
    },
    letter() { return letterAvatar(this.shop || {}); },
  },
  watch: {
    'shop.id'() { this.logoFailed = false; this.faviconFailed = false; },
  },
};
</script>

<style scoped>
.shop-avatar { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; border-radius: 50%; overflow: hidden; }
.shop-avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.shop-avatar-flag { display: block; }
.shop-avatar-letter {
  width: 100%; height: 100%;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 18px; letter-spacing: -0.01em;
}
</style>
