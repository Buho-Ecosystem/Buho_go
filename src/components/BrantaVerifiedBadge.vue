<!--
  BrantaVerifiedBadge

  The trust marker for a payment whose destination Branta has verified as
  belonging to a known business. Rendered under the recipient name on the
  confirm sheets (Lightning + on-chain), it reads as a refined "verified"
  seal chip, tapping it opens Branta's verification page for the full
  counterparty details.

  Presentational only. The parent decides whether to show it (a verified
  result exists) and supplies the verifyUrl. A miss shows nothing, so this
  component never renders an error or a "not verified" state.

  Layout note: the chip is a block-level, content-width element so it
  always sits on its OWN line and never crowds the "via Lightning" line or
  the on-chain address-reveal beneath the recipient name.
-->
<template>
  <button
    type="button"
    class="branta-verified"
    :class="{ 'branta-verified--compact': compact, 'branta-verified--static': !verifyUrl }"
    :aria-label="$t('Verified by Branta')"
    :title="$t('Verified by Branta')"
    @click.stop="open"
  >
    <Icon
      icon="tabler:rosette-discount-check-filled"
      :width="iconSize"
      :height="iconSize"
      class="branta-verified-seal"
    />
    <span class="branta-verified-text">{{ $t('Verified by Branta') }}</span>
    <Icon
      v-if="verifyUrl"
      icon="tabler:chevron-right"
      :width="compact ? 11 : 12"
      :height="compact ? 11 : 12"
      class="branta-verified-chev"
    />
  </button>
</template>

<script>
import { Icon } from '@iconify/vue'
import { openInAppBrowser } from '../utils/inAppBrowser.js'

export default {
  name: 'BrantaVerifiedBadge',
  components: { Icon },
  props: {
    /** Branta verification page for this payment. Opened on tap. */
    verifyUrl: { type: String, default: '' },
    /** Smaller variant for the confirm-stage recipient summary. */
    compact: { type: Boolean, default: false },
  },
  computed: {
    iconSize() {
      return this.compact ? 14 : 16
    },
  },
  methods: {
    open() {
      if (!this.verifyUrl) return
      // In-app browser keeps the user inside the Capacitor shell on native
      // and falls back to a new tab on web.
      openInAppBrowser(this.verifyUrl)
    },
  },
}
</script>

<style scoped>
/*
  A trust signal, not a CTA. Deliberately neutral: a neutral ink chip with a
  monochrome verified seal so it reads as "identity confirmed / premium" and
  never competes with the green send button or reads as Branta's brand blue.

  `display: flex` + `width: fit-content` makes it a block-level,
  content-width pill: it claims its own line (so the via / address line
  drops below it) while only being as wide as its label.
*/
.branta-verified {
  all: unset;
  display: flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
  padding: 6px 10px 6px 8px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.05);
  box-shadow: inset 0 0 0 1px rgba(17, 24, 39, 0.10);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease;
  box-sizing: border-box;
}

.branta-verified--compact {
  margin-top: 6px;
  padding: 5px 9px 5px 7px;
  font-size: 11px;
  gap: 5px;
}

/* Static variant: rendered when there is no verifyUrl to open, so the pill
   reads as a seal rather than a tappable link (no chevron, no pointer). */
.branta-verified--static { cursor: default; }

.branta-verified:not(.branta-verified--static):hover {
  background: rgba(17, 24, 39, 0.08);
}
.branta-verified:not(.branta-verified--static):active {
  transform: scale(0.97);
}

/* Monochrome verified seal, matched to the app palette: near-black ink in
   light mode, silver in dark mode. No blue, no green, no gold. */
.branta-verified-seal {
  flex-shrink: 0;
  color: var(--text-primary);
}

.branta-verified-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branta-verified-chev {
  flex-shrink: 0;
  opacity: 0.45;
}

/* Dark theme: lift the chip off the dark recipient strip and warm the
   seal so it stays legible. */
body.body--dark .branta-verified {
  background: rgba(255, 255, 255, 0.07);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}
body.body--dark .branta-verified:not(.branta-verified--static):hover {
  background: rgba(255, 255, 255, 0.11);
}
body.body--dark .branta-verified-seal {
  color: #C7CCD4;
}
</style>
