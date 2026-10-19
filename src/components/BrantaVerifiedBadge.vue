<!--
  BrantaVerifiedBadge

  The seal for a payment whose destination Branta verified as a known
  business. It sits in the confirm sheet's top bar while the business is the
  recipient below it; tapping it opens Branta's verification page in the
  in-app browser. Without a page to open it is a plain image.

  Presentational: the parent shows it only for a verified result. A miss
  never renders anything, so there is no "not verified" state.
-->
<template>
  <button
    v-if="verifyUrl"
    type="button"
    class="branta-badge"
    :aria-label="spokenLabel"
    @click.stop="open"
  >
    <Icon icon="tabler:rosette-discount-check-filled" width="22" height="22" class="branta-badge-seal" />
    <q-tooltip anchor="bottom right" self="top right">{{ $t('Verified by Branta') }}</q-tooltip>
  </button>
  <span v-else class="branta-badge" role="img" :aria-label="$t('Verified by Branta')">
    <Icon icon="tabler:rosette-discount-check-filled" width="22" height="22" class="branta-badge-seal" />
  </span>
</template>

<script>
import { Icon } from '@iconify/vue'
import { openInAppBrowser } from '../utils/inAppBrowser.js'

export default {
  name: 'BrantaVerifiedBadge',
  components: { Icon },
  props: {
    /** Branta's verification page for this payment; opened on tap. */
    verifyUrl: { type: String, default: '' },
  },
  computed: {
    spokenLabel() {
      return `${this.$t('Verified by Branta')}. ${this.$t("Opens Branta's verification.")}`
    },
  },
  methods: {
    open() {
      openInAppBrowser(this.verifyUrl)
    },
  },
}
</script>

<style scoped>
/* A 44 pt target around a 22 px seal, so the seal keeps the bar quiet. */
.branta-badge {
  all: unset;
  box-sizing: border-box;
  width: 44px;
  height: 44px;
  margin: -2px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  -webkit-tap-highlight-color: transparent;
}

button.branta-badge {
  cursor: pointer;
  transition: transform 0.08s ease;
}

button.branta-badge:active { transform: scale(0.92); }

button.branta-badge:focus-visible {
  outline: 2px solid var(--brand-accent, #059573);
  outline-offset: -2px;
}

/* Monochrome: ink in light mode, silver in dark mode. */
.branta-badge-seal { color: var(--text-primary); }
body.body--dark .branta-badge-seal { color: #C7CCD4; }
</style>
