<template>
  <section class="branta-verification-details" :class="{ 'branta-verification-details--dark': $q.dark.isActive }">
    <div class="branta-verification-card">
      <div class="branta-proof-brand">
        <span class="branta-proof-wordmark"><img src="/images/branta/wordmark-on-light.svg" alt="Branta" /></span>
        <Icon icon="tabler:rosette-discount-check-filled" width="22" height="22" />
      </div>
      <h3 :lang="$i18n?.locale">{{ $t('Verified business') }}</h3>
      <p>{{ $t(historical ? 'This payment matched the business below before you sent it.' : 'Branta matched this payment to the business below.') }}</p>
      <div class="branta-proof-business">
        <BrantaMerchantMark :verification="verification" :size="44" decorative />
        <strong>{{ verification.name || $t('Business') }}</strong>
      </div>
      <p v-if="checkedTime" class="branta-proof-time">
        <Icon icon="tabler:clock" width="17" height="17" />
        <span>{{ $t('Checked {time}', { time: checkedTime }) }}</span>
      </p>
    </div>
    <!-- A way to look closer, never the screen's main action: that is Send. -->
    <a
      v-if="recordUrl"
      :href="recordUrl"
      target="_blank"
      rel="noopener noreferrer"
      referrerpolicy="no-referrer"
      class="branta-record-link"
      :aria-disabled="opening ? 'true' : undefined"
      :aria-busy="opening ? 'true' : undefined"
      @click="openRecord"
    >{{ $t('View Branta record') }}<Icon icon="tabler:external-link" width="16" height="16" /></a>
    <p v-if="linkError" class="branta-record-error" role="status">{{ $t('The record could not be opened. Try again when you are online.') }}</p>
    <p v-if="historical" class="branta-proof-context">{{ $t('Saved on this device') }}</p>
  </section>
</template>
<script>
import { Icon } from '@iconify/vue'
import { Capacitor } from '@capacitor/core'
import { safeBrantaUrl } from '../utils/branta.js'
import BrantaMerchantMark from './BrantaMerchantMark.vue'

export default {
  name: 'BrantaVerificationDetails',
  components: { Icon, BrantaMerchantMark },
  props: {
    verification: { type: Object, required: true },
    context: { type: String, default: 'current', validator: value => ['current', 'historical'].includes(value) },
  },
  data: () => ({ opening: false, linkError: false }),
  computed: {
    historical() { return this.context === 'historical' },
    recordUrl() { return safeBrantaUrl(this.verification?.verifyUrl, this.verification?.environment, { record: true }) },
    checkedTime() {
      const checkedAt = this.verification?.checkedAt
      if (!checkedAt) return ''
      const date = new Date(checkedAt)
      return Number.isFinite(date.getTime()) ? date.toLocaleString(this.$i18n?.locale || undefined) : ''
    },
  },
  watch: {
    verification() { this.linkError = false; this.opening = false },
    context() { this.linkError = false; this.opening = false },
    recordUrl() { this.linkError = false; this.opening = false },
  },
  methods: {
    async openRecord(event) {
      const url = this.recordUrl
      if (!url || this.opening) { event?.preventDefault(); return }
      this.linkError = false
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        event?.preventDefault()
        this.linkError = true
        return
      }
      // A normal safe anchor is the web action; its browser cannot report
      // popup failure reliably. Native explicitly owns the plugin outcome.
      if (!Capacitor.isNativePlatform()) return
      event?.preventDefault()
      const verification = this.verification, context = this.context
      const current = () => this.verification === verification && this.context === context && this.recordUrl === url
      this.opening = true
      try {
        const { Browser } = await import('@capacitor/browser')
        await Browser.open({ url, presentationStyle: 'popover' })
      } catch { if (current()) this.linkError = true }
      finally { if (current()) this.opening = false }
    },
  },
}
</script>
<style scoped>
.branta-verification-details { display: flex; flex-direction: column; gap: 14px; padding: 16px 0; font-family: 'Manrope', sans-serif; }
.branta-verification-card {
  padding: 22px 20px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg, 20px);
  background: var(--bg-input);
}
.branta-proof-brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; color: var(--brand-accent-text); }
/* The wordmark is drawn for a light ground: in the dark theme it sits on a
   quiet plate of the card's own family, not on a white block. */
.branta-proof-wordmark { display: inline-flex; min-width: 0; max-width: calc(100% - 38px); }
.branta-proof-wordmark img { display: block; width: 188px; max-width: 100%; height: auto; object-fit: contain; }
.branta-verification-details--dark .branta-proof-wordmark { padding: 7px 10px; border-radius: 10px; background: #E9E6DD; }
.branta-verification-card h3 {
  margin: 22px 0 8px;
  font-size: 1.125rem;
  font-weight: 700;
  line-height: 1.4;
  color: var(--text-primary);
  overflow-wrap: anywhere;
  hyphens: auto;
}
.branta-verification-card p { margin: 0; font-size: .875rem; line-height: 1.65; color: var(--text-secondary); overflow-wrap: anywhere; }
.branta-proof-business { display: flex; align-items: center; gap: 12px; padding: 20px 0; color: var(--text-primary); }
.branta-proof-business strong { min-width: 0; font-size: 1rem; line-height: 1.5; overflow-wrap: anywhere; }
.branta-verification-card .branta-proof-time { display: flex; align-items: flex-start; gap: 8px; font-size: .8125rem; }
.branta-proof-time > :first-child { flex-shrink: 0; margin-top: 4px; }
.branta-record-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  gap: 7px;
  min-height: 44px;
  padding: 10px 14px;
  border-radius: var(--radius-pill);
  font: inherit;
  font-size: .875rem;
  font-weight: 600;
  text-decoration: none;
  text-align: center;
  color: var(--brand-accent-text);
  cursor: pointer;
}
.branta-record-link:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: 3px; }
.branta-record-link[aria-disabled="true"] { opacity: .6; cursor: wait; }
.branta-record-error, .branta-proof-context { margin: 0; font-size: .8125rem; line-height: 1.5; color: var(--text-secondary); }
.branta-record-error, .branta-proof-context { text-align: center; }
</style>
