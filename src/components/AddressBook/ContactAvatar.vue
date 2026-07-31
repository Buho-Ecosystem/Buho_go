<template>
  <span
    class="contact-avatar"
    :class="visibleAvatarUrl ? 'contact-avatar--has-image' : 'contact-avatar--fallback'"
  >
    <img
      v-if="visibleAvatarUrl"
      class="contact-avatar__img"
      :src="visibleAvatarUrl"
      :alt="''"
      @error="onImgError"
    />
    <!-- No picture: the filled-bust silhouette (the reference wallet's
         treatment, adopted 1:1) — solid blue figure on a pale blue-
         tinted disc, both themes. One mark for everyone, no initials,
         no per-contact color. The glyph scales with whatever size the
         parent sets, so every surface keeps its rhythm. -->
    <svg
      v-else
      class="contact-avatar__glyph"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 12.3a4.05 4.05 0 1 0 0-8.1 4.05 4.05 0 0 0 0 8.1Zm0 2.2c-4.3 0-7.6 2.6-8.1 6.3h16.2c-.5-3.7-3.8-6.3-8.1-6.3Z" />
    </svg>
  </span>
</template>

<script>
/**
 * Unified contact avatar.
 *
 * Renders a Nostr-sourced profile picture when one is available,
 * otherwise falls back to the filled-bust silhouette — one mark for
 * every picture-less contact, blue on a pale blue-tinted disc in both
 * themes (the reference wallet's treatment, adopted 1:1). The old
 * colored-initial circles are retired (design decision 2026-07-25).
 *
 * Layout is intentionally *not* owned by this component — the parent
 * supplies width / height / font-size through its own class so each
 * surface (tx row, send sheet, batch picker) keeps its existing
 * rhythm. The component owns three responsibilities:
 *
 *   1. URL safety gate (only https / http / data:image)
 *   2. img-vs-initial decision
 *   3. graceful fallback when the image fails to load
 *
 * `entry` is intentionally permissive — full address-book entry, a
 * lightweight payment-recipient adapter, or just `{ name }` all work.
 * `picture` explicit override wins when supplied so callers can
 * render in-flight resolved profiles before a store entry exists yet.
 *
 * `name` / `color` / `initialLength` remain declared so existing call
 * sites keep working, but the silhouette fallback ignores them — the
 * per-contact color field is legacy data now.
 */

import { matchLnAddressService } from '../../services/lnAddressServices'

export default {
  name: 'ContactAvatar',

  props: {
    entry: { type: Object, default: () => ({}) },
    name: { type: String, default: '' },
    picture: { type: String, default: '' },
    color: { type: String, default: '' },
    initialLength: {
      type: Number,
      default: 1,
      validator: (v) => v === 1 || v === 2,
    },
  },

  data() {
    return {
      imgBroken: false,
    }
  },

  computed: {
    visibleAvatarUrl() {
      if (this.imgBroken) return ''
      const explicit = typeof this.picture === 'string' ? this.picture.trim() : ''
      if (explicit) {
        const gated = this.gateUrl(explicit)
        if (gated) return gated
      }
      // We accept Nostr pictures from any source — the helper is also
      // used for entries the address-book store doesn't own yet (e.g.
      // search results, scan results). Treat `nostr_profile.picture`
      // as the canonical field and only render when it gates clean.
      const raw = this.entry?.nostr_profile?.picture
      if (typeof raw === 'string') {
        const gated = this.gateUrl(raw.trim())
        if (gated) return gated
      }
      // Fiat-payout provider logo (Bitzed for Zambia, …), derived from the
      // contact's address so a saved mobile-money recipient reads clearly
      // everywhere it appears (tx list, tx detail, address book). It's a
      // trusted bundled asset, so it bypasses the URL gate that guards
      // user/Nostr images, and is resolved fresh each render (never stored)
      // so it survives asset-hash changes across builds.
      return this.serviceLogoUrl
    },

    serviceLogoUrl() {
      const address = this.entry?.address || this.entry?.lightningAddress || ''
      const svc = matchLnAddressService(address)
      return svc?.logo || ''
    },

  },

  watch: {
    'entry.nostr_profile.picture'() { this.imgBroken = false },
    picture() { this.imgBroken = false },
  },

  methods: {
    gateUrl(url) {
      if (!url) return ''
      if (!/^(https?:|data:image\/)/i.test(url)) return ''
      return url
    },
    onImgError() {
      this.imgBroken = true
    },
  },
}
</script>

<style scoped>
.contact-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  color: #FFF;
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
  line-height: 1;
  /* Parent supplies width / height / font-size through its own
     class — the component never imposes a size of its own so each
     surface keeps its existing rhythm. */
}

.contact-avatar__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Silhouette fallback — the reference wallet's look, copied 1:1:
   solid blue bust on a pale blue-tinted disc. Dark mode keeps the
   same blue (slightly lifted for contrast) on a cool dark disc. */
.contact-avatar--fallback {
  background: #EAEFF7;
  color: #3B82F6;
}

.body--dark .contact-avatar--fallback {
  background: #23272E;
  color: #5B8DEF;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
}

.contact-avatar__glyph {
  /* Filled marks read smaller than strokes — 52% matches the
     reference wallet's bust-to-disc ratio. */
  width: 52%;
  height: 52%;
  display: block;
}
</style>
