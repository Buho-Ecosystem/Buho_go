<template>
  <span class="arkade-logo" :class="`arkade-logo--${variant}`" :style="wrapStyle">
    <img :src="src" :alt="alt" class="arkade-logo__img" :class="{ 'arkade-logo__img--white': color === 'white' }" :style="imgStyle" draggable="false" />
  </span>
</template>

<script>
/**
 * Theme-aware Arkade logo.
 *
 * Single source of truth for the Arkade mark across the app, so the (space-
 * containing) media-kit paths and the light/dark colour swap live in one place
 * — reuse this in WalletSwitcher / Settings rather than inlining <img>.
 *
 * Brand rule: orange (#F14317) in light mode, purple (#351791) in dark.
 * Assets: public/Arkade-Media-Kit/Logo/SVG/Logo Only/ (transparent variants).
 *
 * Sizing: the media-kit mark sits in the centre 49.5% of its 94×94 canvas with
 * symmetric transparent padding, so a bare <img> renders it at ~half the visual
 * size of the edge-to-edge LNbits / Spark / NWC logos it sits beside. We crop
 * that padding here so `size` means the VISIBLE mark size — the same contract
 * every sibling logo has — and call sites can use the same numbers as the icon
 * next to them. (The wordmark `variant="full"` is laid out as-is.)
 */
const BASE = '/Arkade-Media-Kit/Logo/SVG/Logo Only';

// Glyph bounding box ÷ canvas, measured from the SVG (46.5532 / 94 ≈ 0.495).
const MARK_GLYPH_RATIO = 46.5532 / 94;

export default {
  name: 'ArkadeLogo',
  props: {
    // 'mark' = the symbol only; 'full' = symbol + "Arkade" wordmark.
    variant: {
      type: String,
      default: 'mark',
      validator: (v) => v === 'mark' || v === 'full',
    },
    // px number (or any CSS length string). For the mark this is the visible
    // glyph size (padding cropped); for the wordmark it drives width.
    size: {
      type: [Number, String],
      default: 96,
    },
    alt: {
      type: String,
      default: 'Arkade',
    },
    // Force a brand color regardless of theme. Use 'orange' when the mark sits
    // on an always-dark surface (icon box / dark avatar circle) so it stays
    // high-contrast in both light and dark app themes. Use 'white' when the
    // mark sits on a SOLID brand-color surface (e.g. the orange type-badge pill)
    // so it matches the white label. Null = theme-aware (orange in light, purple
    // in dark) for marks on the app background.
    color: {
      type: String,
      default: null,
      validator: (v) => v === null || v === 'orange' || v === 'purple' || v === 'white',
    },
  },
  computed: {
    src() {
      // 'white' renders the Black asset recolored via a CSS invert filter
      // (no white asset ships in the media kit).
      const color = this.color === 'orange' ? 'Orange'
        : this.color === 'purple' ? 'Purple'
        : this.color === 'white' ? 'Black'
        : (this.$q.dark.isActive ? 'Purple' : 'Orange');
      const file = this.variant === 'full'
        ? `Logo + text - ${color}.svg`
        : `Logo Only + ${color}.svg`;
      return `${BASE}/${file}`;
    },
    wrapStyle() {
      const s = typeof this.size === 'number' ? `${this.size}px` : this.size;
      return this.variant === 'full'
        ? { width: s, height: 'auto' }
        : { width: s, height: s };
    },
    imgStyle() {
      if (this.variant === 'full') {
        return { width: '100%', height: 'auto' };
      }
      // Scale the canvas up so the centred glyph fills the box; the wrapper
      // clips the transparent overflow. maxWidth:none defeats any global
      // `img { max-width: 100% }` reset.
      const pct = `${(1 / MARK_GLYPH_RATIO) * 100}%`;
      return { width: pct, height: pct, maxWidth: 'none' };
    },
  },
};
</script>

<style scoped>
.arkade-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  line-height: 0;
}

.arkade-logo--mark {
  overflow: hidden;
}

.arkade-logo__img {
  display: block;
  object-fit: contain;
  flex: 0 0 auto;
  user-select: none;
  -webkit-user-drag: none;
}

/* Recolor the Black mark to solid white (for solid brand-color surfaces). */
.arkade-logo__img--white {
  filter: brightness(0) invert(1);
}
</style>
