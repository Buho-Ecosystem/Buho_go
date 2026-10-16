<!--
  LNBitsPayLinksStep: the server answered that its Pay Links extension
  (lnurlp) is off, so no Lightning address can be made yet. Instead of a
  dead end it asks who runs the server and gives each answer a next step:

    • I do         — opens the server's Extensions page
    • Someone else — shares a ready-made request to turn it on

  When the person comes back from the browser, the server is asked again
  on its own; once Pay Links answers, `available` is emitted and the
  caller moves on to the address step. No "Check again" button needed.
-->
<template>
  <FormSheetStep
    :title="$t('Pay Links is off')"
    :subtitle="$t('This LNbits extension gives you a Lightning address.')"
    badge="warn"
    :back="back"
    @back="$emit('back')"
  >
    <template #icon>
      <Icon icon="tabler:puzzle" width="26" height="26" />
    </template>

    <p class="iform-seclabel pay-links__label">{{ $t('Who runs this server?') }}</p>
    <div class="iform-group">
      <button type="button" class="pay-links__row" @click="openExtensions">
        <span class="pay-links__tile" aria-hidden="true"><Icon icon="tabler:user-cog" width="17" height="17" /></span>
        <span class="pay-links__text">{{ $t('I do') }}<small>{{ $t('Turn it on in Extensions') }}</small></span>
        <Icon icon="tabler:external-link" width="16" height="16" class="pay-links__chevron" aria-hidden="true" />
      </button>
      <button type="button" class="pay-links__row" @click="askOwner">
        <span class="pay-links__tile" aria-hidden="true"><Icon icon="tabler:send" width="16" height="16" /></span>
        <span class="pay-links__text">{{ $t('Someone else') }}<small>{{ $t('Ask them to turn it on') }}</small></span>
        <Icon icon="tabler:chevron-right" width="16" height="16" class="pay-links__chevron" aria-hidden="true" />
      </button>
    </div>
    <p class="pay-links__foot" role="status">
      <template v-if="checking"><q-spinner size="12px" class="q-mr-xs" />{{ $t('Checking server…') }}</template>
      <template v-else>{{ $t('Sending and receiving work without it.') }}</template>
    </p>

    <template #footer>
      <q-btn
        class="iform-connect full-width"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        no-caps
        unelevated
        @click="$emit('done')"
      >{{ primaryLabel || $t('Continue') }}</q-btn>
    </template>
  </FormSheetStep>
</template>

<script>
import { Capacitor } from '@capacitor/core';
import FormSheetStep from '../sheets/FormSheetStep.vue';
import { openInAppBrowser } from '../../utils/inAppBrowser.js';
import { shareContent } from '../../utils/share.js';
import { extensionsUrl } from '../../utils/lnbitsAddress.js';

export default {
  name: 'LNBitsPayLinksStep',
  components: { FormSheetStep },
  props: {
    serverUrl: { type: String, required: true },
    domain: { type: String, required: true },
    /** Asks the server again: () => Promise<'available'|'off'|'unknown'>. */
    checkStatus: { type: Function, required: true },
    back: { type: Boolean, default: false },
    primaryLabel: { type: String, default: '' },
  },
  emits: ['back', 'done', 'available'],
  data() {
    return { checking: false, watching: false, browserListener: null };
  },
  beforeUnmount() {
    this.stopWatching();
  },
  methods: {
    async openExtensions() {
      this.startWatching();
      await openInAppBrowser(extensionsUrl(this.serverUrl));
    },

    async askOwner() {
      const text = this.$t('Could you turn on Pay Links on {domain}? I would like a Lightning address.', { domain: this.domain });
      const result = await shareContent({ text });
      if (result.success || result.reason === 'cancelled') return;
      // No share sheet here (desktop browsers): the message goes to the clipboard instead.
      try {
        await navigator.clipboard.writeText(text);
        this.$q.notify({ type: 'positive', message: this.$t('Message copied') });
      } catch {
        this.$q.notify({ type: 'negative', message: this.$t('Failed to copy') });
      }
    },

    /** Re-check once the person is back from the Extensions page. */
    startWatching() {
      if (this.watching) return;
      this.watching = true;
      document.addEventListener('visibilitychange', this.onReturn);
      window.addEventListener('focus', this.onReturn);
      if (Capacitor.isNativePlatform()) {
        import('@capacitor/browser')
          .then(({ Browser }) => Browser.addListener('browserFinished', this.onReturn))
          .then((handle) => {
            if (this.watching) this.browserListener = handle;
            else handle.remove();
          })
          .catch(() => {});
      }
    },

    stopWatching() {
      this.watching = false;
      document.removeEventListener('visibilitychange', this.onReturn);
      window.removeEventListener('focus', this.onReturn);
      this.browserListener?.remove();
      this.browserListener = null;
    },

    async onReturn() {
      if (document.visibilityState === 'hidden' || this.checking) return;
      this.checking = true;
      try {
        if (await this.checkStatus() === 'available') {
          this.stopWatching();
          this.$emit('available');
        }
      } finally {
        this.checking = false;
      }
    },
  },
};
</script>

<style scoped>
.pay-links__label {
  margin: 0 4px 9px;
}
.pay-links__row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 60px;
  padding: 10px 14px;
  border: 0;
  background: none;
  color: var(--text-primary);
  font: 600 15px 'Manrope', sans-serif;
  text-align: left;
  cursor: pointer;
}
.pay-links__row + .pay-links__row {
  border-top: 1px solid var(--border-card);
}
.pay-links__row:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: -2px;
  border-radius: 12px;
}
.pay-links__tile {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: var(--bg-card);
  color: var(--text-secondary);
}
.pay-links__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pay-links__text small {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-secondary);
}
.pay-links__chevron {
  flex-shrink: 0;
  color: var(--text-muted);
}
.pay-links__foot {
  display: flex;
  align-items: center;
  margin: 10px 4px 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-muted);
}
</style>
