<template>
  <span
    class="contact-avatar"
    :class="{ 'contact-avatar--has-image': visibleAvatarUrl }"
    :style="!visibleAvatarUrl ? { background: backgroundColor } : null"
  >
    <img
      v-if="visibleAvatarUrl"
      class="contact-avatar__img"
      :src="visibleAvatarUrl"
      :alt="''"
      @error="onImgError"
    />
    <span v-else class="contact-avatar__initial">{{ initial }}</span>
  </span>
</template>

<script>
/**
 * Unified contact avatar.
 *
 * Renders a Nostr-sourced profile picture when one is available,
 * otherwise falls back to the colored-initial circle every part of
 * the app already shows for manual contacts.
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
 * lightweight payment-recipient adapter, or just `{ name, color }`
 * all work. `picture` / `name` / `color` explicit overrides win when
 * supplied so callers can render in-flight resolved profiles before
 * a store entry exists yet.
 *
 * `initialLength` defaults to 1 char, matching the existing
 * AddressBookEntry pattern. Set to `2` for the transaction-row look
 * which uses `name.substring(0, 2)`.
 */

const DEFAULT_FALLBACK_COLOR = '#3B82F6'

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
      if (explicit) return this.gateUrl(explicit)
      // We accept Nostr pictures from any source — the helper is also
      // used for entries the address-book store doesn't own yet (e.g.
      // search results, scan results). Treat `nostr_profile.picture`
      // as the canonical field and only render when it gates clean.
      const raw = this.entry?.nostr_profile?.picture
      if (typeof raw !== 'string') return ''
      return this.gateUrl(raw.trim())
    },

    initial() {
      const candidate = (this.name || this.entry?.name || '').trim()
      if (!candidate) return '?'
      if (this.initialLength === 2) {
        const cleaned = candidate.replace(/[^\p{L}\p{N}\s]/gu, '').trim()
        const chars = cleaned.slice(0, 2)
        return chars ? chars.toUpperCase() : '?'
      }
      const ch = candidate.replace(/[^\p{L}\p{N}]/u, '').charAt(0)
      return (ch || '?').toUpperCase()
    },

    backgroundColor() {
      return this.color || this.entry?.color || DEFAULT_FALLBACK_COLOR
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

.contact-avatar__initial {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
}
</style>
