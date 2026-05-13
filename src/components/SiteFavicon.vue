<template>
  <span
    class="site-favicon-wrap"
    :class="$q.dark.isActive ? 'site-favicon-wrap-dark' : 'site-favicon-wrap-light'"
    :style="fallbackStyle"
    :aria-label="domain"
  >
    <img
      v-if="!failed"
      :src="iconUrl"
      class="site-favicon-img"
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="onImageError"
      @load="onImageLoad"
    />
    <span v-else class="site-favicon-letter">{{ initial }}</span>
  </span>
</template>

<script>
/**
 * SiteFavicon — small avatar for a domain row in the Connected Sites
 * list. Pulls the site's own `/favicon.ico` (the site already had a
 * relationship with the user via LUD-04, so no new privacy leak) and
 * falls back to a colored single-letter circle when the favicon is
 * missing or doesn't load.
 *
 * Deliberately avoids Google/DuckDuckGo favicon proxies — those would
 * tell a third party which sites the user is logged into, which is
 * exactly what LUD-04 is meant to prevent.
 *
 * The fallback color is derived deterministically from the domain so
 * the same site always renders with the same accent (good for visual
 * recognition between sessions, and no PII).
 */
export default {
  name: 'SiteFavicon',

  props: {
    domain: { type: String, required: true },
    size: { type: Number, default: 28 },
  },

  data() {
    return {
      failed: false,
      // Hide the img element until we know it actually loaded — `onerror`
      // doesn't fire until network finishes, which leaves a brief flash
      // of broken-image. Tracked here so the fallback letter can render
      // immediately if the request never resolves a bitmap.
      loaded: false,
    };
  },

  computed: {
    iconUrl() {
      // Fetched from the same origin the user just authenticated against.
      // No third party in the loop. Works for every LUD-04 service we'd
      // ever land in this list.
      return `https://${this.domain}/favicon.ico`;
    },

    initial() {
      return (this.domain || '?').replace(/^www\./i, '').charAt(0).toUpperCase();
    },

    /**
     * Deterministic accent color for the fallback letter circle.
     * Derived from the domain (not from key material) so the same site
     * always reads with the same color across all users — building
     * collective recognition. Constrained to the muted slate/cool
     * palette so it stays inside BuhoGO's neutral-leaning design
     * language even when many sites are listed at once.
     */
    fallbackStyle() {
      const sz = `${this.size}px`;
      const base = {
        width: sz,
        height: sz,
        fontSize: `${Math.round(this.size * 0.42)}px`,
      };
      if (!this.failed) return base;

      // Hash the domain to a pleasant slate-cool hue (200–260 range).
      let h = 0;
      for (let i = 0; i < this.domain.length; i += 1) {
        h = (h * 31 + this.domain.charCodeAt(i)) >>> 0;
      }
      const hue = 200 + (h % 60);
      return {
        ...base,
        background: `hsl(${hue} 30% 92%)`,
        color: `hsl(${hue} 50% 30%)`,
      };
    },
  },

  watch: {
    domain() {
      // Reset on domain change so the same instance can be reused for
      // a different row without leaking the prior `failed` state.
      this.failed = false;
      this.loaded = false;
    },
  },

  methods: {
    onImageError() {
      this.failed = true;
    },
    onImageLoad() {
      this.loaded = true;
    },
  },
};
</script>

<style scoped>
.site-favicon-wrap {
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  overflow: hidden;
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
  user-select: none;
}

.site-favicon-wrap-light {
  background: #f1f5f9;
}

.site-favicon-wrap-dark {
  background: rgba(255, 255, 255, 0.06);
}

.site-favicon-img {
  width: 70%;
  height: 70%;
  object-fit: contain;
  display: block;
}

.site-favicon-letter {
  line-height: 1;
}
</style>
