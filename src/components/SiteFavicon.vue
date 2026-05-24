<template>
  <span
    class="site-favicon-wrap"
    :class="[
      $q.dark.isActive ? 'site-favicon-wrap-dark' : 'site-favicon-wrap-light',
      shape === 'rounded-square' ? 'site-favicon-wrap--squircle' : 'site-favicon-wrap--circle',
    ]"
    :style="fallbackStyle"
    :aria-label="domain"
  >
    <img
      v-if="!failed && currentIconUrl"
      :src="currentIconUrl"
      class="site-favicon-img"
      :class="shape === 'rounded-square' ? 'site-favicon-img--fill' : 'site-favicon-img--inset'"
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
 * SiteFavicon — small avatar for a domain row.
 *
 * Resolves a site's icon at runtime from the site's own origin. The
 * site already had (or is about to have) a relationship with the
 * user, so no new privacy leak is introduced — and crucially we
 * stay off Google/DuckDuckGo favicon proxies, which would tell a
 * third party which sites the user is interested in.
 *
 * Resolution order:
 *   1. `iconUrl` prop, if the caller already knows a specific URL.
 *   2. `/apple-touch-icon.png` (modern, high-res, near-universal
 *      on any site with a mobile presence — the apps in our
 *      example sheets all expose one).
 *   3. `/apple-touch-icon-precomposed.png` (older iOS variant).
 *   4. `/favicon.ico` (legacy, sometimes the only one served).
 *   5. Colored single-letter circle (deterministic per-domain so
 *      the same site always renders with the same accent).
 *
 * Apple-touch icons sit first in the fallback chain because they
 * tend to be properly sized for our 28–32px avatar slot, whereas
 * many `/favicon.ico` files are 16×16 and scale up muddily.
 */
const ICON_CANDIDATE_PATHS = Object.freeze([
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
  '/favicon.ico',
]);

export default {
  name: 'SiteFavicon',

  props: {
    domain: { type: String, required: true },
    size: { type: Number, default: 28 },
    /**
     * Optional explicit URL. Skips the multi-path resolution and
     * uses this directly. Lets callers that know a specific
     * brand-asset URL (or a bundled local asset) override the
     * automatic detection.
     */
    iconUrl: { type: String, default: '' },
    /**
     * Visual shape of the wrap:
     *   - `'circle'` (default): perfect circle, image inset to 70%.
     *     Right for tiny / inconsistent favicons that benefit from a
     *     colored disc behind them (the connected-sites list).
     *   - `'rounded-square'`: iOS / Play Store style squircle, image
     *     fills the wrap edge-to-edge. Right for actual brand-icon
     *     assets where the image already IS a square app icon and
     *     shouldn't get extra padding (the example sheets).
     */
    shape: {
      type: String,
      default: 'circle',
      validator: (v) => v === 'circle' || v === 'rounded-square',
    },
  },

  data() {
    return {
      failed: false,
      // Hide the img element until we know it actually loaded — `onerror`
      // doesn't fire until network finishes, which leaves a brief flash
      // of broken-image. Tracked here so the fallback letter can render
      // immediately if the request never resolves a bitmap.
      loaded: false,
      // Index into ICON_CANDIDATE_PATHS for the current attempt.
      // Advances on each `onerror`; when it exceeds the list we set
      // `failed = true` to render the letter circle.
      attemptIndex: 0,
    };
  },

  computed: {
    currentIconUrl() {
      // Explicit override wins. Empty domain → render nothing
      // (parent shows letter fallback via `failed` flag chain).
      if (this.iconUrl) return this.iconUrl;
      if (!this.domain) return '';
      const path = ICON_CANDIDATE_PATHS[this.attemptIndex];
      if (!path) return '';
      return `https://${this.domain}${path}`;
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
      // a different row without leaking the prior attempt state.
      this.resetAttempts();
    },
    iconUrl() {
      // Explicit override changed — reset so we re-attempt with the
      // new URL (or, if cleared, fall back into the multi-path
      // resolution chain).
      this.resetAttempts();
    },
  },

  methods: {
    /**
     * Move to the next candidate path; mark as `failed` (letter
     * fallback) when the chain is exhausted. Skipped entirely when
     * the caller supplied an explicit `iconUrl` — that URL is final;
     * we don't fall back to /apple-touch-icon.png on a custom URL
     * because the caller's intent was specific.
     */
    onImageError() {
      if (this.iconUrl) {
        this.failed = true;
        return;
      }
      const next = this.attemptIndex + 1;
      if (next >= ICON_CANDIDATE_PATHS.length) {
        this.failed = true;
        return;
      }
      this.attemptIndex = next;
    },
    onImageLoad() {
      this.loaded = true;
    },
    resetAttempts() {
      this.failed = false;
      this.loaded = false;
      this.attemptIndex = 0;
    },
  },
};
</script>

<style scoped>
.site-favicon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  overflow: hidden;
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
  user-select: none;
}

/* Circle wrap — default. The image sits inset so small/ragged
   favicons get a clean colored disc behind them. */
.site-favicon-wrap--circle {
  border-radius: 50%;
}

/* Rounded-square ("squircle") wrap — iOS / Play Store app-icon
   shape. Image fills the wrap edge-to-edge because the asset is
   already a square brand icon and needs no extra padding ring. */
.site-favicon-wrap--squircle {
  border-radius: 22%;
}

.site-favicon-wrap-light {
  background: #f1f5f9;
}

.site-favicon-wrap-dark {
  background: rgba(255, 255, 255, 0.06);
}

.site-favicon-img {
  object-fit: contain;
  display: block;
}

/* Inset image — paired with the circle wrap. Leaves a colored
   ring around small favicons so they read as a deliberate avatar. */
.site-favicon-img--inset {
  width: 70%;
  height: 70%;
}

/* Edge-to-edge image — paired with the squircle wrap. The brand
   icon IS the visual; no padding ring needed. */
.site-favicon-img--fill {
  width: 100%;
  height: 100%;
}

.site-favicon-letter {
  line-height: 1;
}
</style>
