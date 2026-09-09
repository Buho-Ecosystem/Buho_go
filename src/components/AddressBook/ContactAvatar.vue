<template>
  <span
    class="contact-avatar"
    :class="[
      visibleAvatarUrl ? 'contact-avatar--has-image' : 'contact-avatar--fallback',
      { 'contact-avatar--plated': containBrandArt },
    ]"
    :style="brandPlateStyle"
  >
    <img
      v-if="visibleAvatarUrl"
      class="contact-avatar__img"
      :class="{ 'contact-avatar__img--contain': containBrandArt }"
      :style="brandInsetStyle"
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
import { matchWalletBrandByAddress } from '../../services/walletBrands'

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

    /**
     * A bundled mark for the address itself, when we recognise where it lives.
     * Two registries can answer, and they answer different questions:
     *
     *   1. a fiat-payout rail (Tando, Bitzed) — that the money lands as local
     *      currency on a phone matters more than the wallet hosting the
     *      address, so it wins;
     *   2. the consumer wallet hosting it (Wallet of Satoshi, Strike,
     *      Coinsnap, …), so history reads by who was paid, not just by arrow.
     *
     * Neither ever outranks a picture: this is only reached once an explicit
     * picture and a Nostr profile picture have both missed (see
     * visibleAvatarUrl). The whole registry row is kept rather than just a URL,
     * because the wallet marks carry their own fit rules (below). Bundled
     * assets, resolved fresh each render so they survive asset-hash changes.
     */
    addressBrand() {
      const address = this.entry?.address || this.entry?.lightningAddress || ''
      if (!address) return null
      const svc = matchLnAddressService(address)
      if (svc?.logo) return { logo: svc.logo }
      return matchWalletBrandByAddress(address)
    },

    serviceLogoUrl() {
      return this.addressBrand?.logo || ''
    },

    /**
     * Whether the mark currently on screen is a brand logo rather than a
     * person's own picture. The fit rules below apply only then — a contact's
     * Nostr avatar must never be padded onto a plate just because their
     * address happens to be one we recognise.
     */
    showingBrandArt() {
      return !!this.serviceLogoUrl && this.visibleAvatarUrl === this.serviceLogoUrl
    },

    /**
     * Plate-less art (a bare logomark or a wordmark) is fitted whole instead of
     * cropped: the circle would otherwise slice the mark itself. The registry
     * marks these with `logoContain`, exactly as the send sheet reads them.
     */
    containBrandArt() {
      return this.showingBrandArt && this.addressBrand?.logoContain === true
    },

    /** Per-brand inset override; the stylesheet's conservative default holds
     *  for any mark whose silhouette has not been measured. */
    brandInsetStyle() {
      const inset = this.containBrandArt ? this.addressBrand?.logoInset : ''
      return inset ? { padding: inset } : null
    },

    /** Contained art sits on a plate so a light mark stays visible; a brand
     *  with its own backdrop (a white wordmark) overrides the default white. */
    brandPlateStyle() {
      if (!this.containBrandArt) return null
      const bg = this.addressBrand?.logoBg
      return bg ? { background: bg } : null
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

/* Plate-less brand art: fitted whole rather than cropped, on a plate so a
   light mark still reads. The default inset is deep enough that even a
   full-bleed square keeps its corners inside the circle; a brand whose
   silhouette is known overrides it with `logoInset`. Mirrors the send sheet's
   treatment so the same wallet looks the same everywhere. */
.contact-avatar--plated { background: #fff; }

.contact-avatar__img--contain {
  object-fit: contain;
  padding: 19%;
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
