<!--
  SignerAppNotice
  For an identity that signs in another app (browser extension, remote
  signer): every message asks that app, so the chat says what it needs.

    - off          receiving waits for the person: Turn on messages, with the
                   hint to always allow, so the app asks once, not per message
    - approval     the app said no, or waits for approval there: Try again
    - away         the app does not answer (closed, offline): Try again
    - unsupported  the app cannot do the encryption messages use

  Presentational: the parent picks the state and runs the actions.
-->
<template>
  <section class="signer-notice" role="status">
    <Icon :icon="icon" width="20" height="20" class="signer-notice__icon" />
    <div class="signer-notice__body">
      <h3 class="signer-notice__title">{{ copy.title }}</h3>
      <p class="signer-notice__text">{{ copy.text }}</p>
      <button
        v-if="copy.action"
        type="button"
        class="signer-notice__btn"
        :disabled="busy"
        @click="$emit(state === 'off' ? 'turn-on' : 'retry')"
      >
        {{ copy.action }}
      </button>
    </div>
  </section>
</template>

<script>
import { Icon } from '@iconify/vue'
import './chatTokens.css'

export default {
  name: 'SignerAppNotice',
  components: { Icon },
  props: {
    /** 'off' | 'approval' | 'away' | 'unsupported' */
    state: { type: String, required: true },
    /** The identity's signer: 'nip07' (browser extension) or 'nip46' (remote signer); picks the icon the identity screens use. */
    kind: { type: String, default: 'nip46' },
    busy: { type: Boolean, default: false }
  },
  emits: ['turn-on', 'retry'],
  computed: {
    icon() {
      if (this.state === 'off') return 'tabler:message-off'
      return this.kind === 'nip07' ? 'tabler:puzzle' : 'tabler:link'
    },
    copy() {
      switch (this.state) {
        case 'off':
          return {
            title: this.$t('Messages are off for this identity'),
            text: this.$t('Your signer app opens every message and will ask you to approve. Choose to always allow, so it asks only once.'),
            action: this.$t('Turn on messages')
          }
        case 'approval':
          return {
            title: this.$t('Approve messages in your signer app'),
            text: this.$t('Your signer app declined or is waiting for your approval. Allow it there, then try again.'),
            action: this.$t('Try again')
          }
        case 'away':
          return {
            title: this.$t("Your signer app isn't answering"),
            text: this.$t('New messages wait until it is open and online.'),
            action: this.$t('Try again')
          }
        default:
          return {
            title: this.$t("Your signer app can't open messages"),
            text: this.$t("It doesn't support the encryption messages use. Update it or use another signer app."),
            action: ''
          }
      }
    }
  }
}
</script>

<style scoped>
.signer-notice {
  display: flex;
  gap: 12px;
  margin: 8px 0;
  padding: 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-card);
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
}
.signer-notice__icon { flex: 0 0 auto; color: var(--text-secondary); }
.signer-notice__body { min-width: 0; flex: 1; }
.signer-notice__title { margin: 0; font-size: 0.9375rem; font-weight: 750; line-height: 1.3; letter-spacing: normal; }
.signer-notice__text { margin: 4px 0 0; font-size: 0.8125rem; line-height: 1.45; color: var(--text-secondary); }
.signer-notice__btn {
  margin-top: 12px;
  min-height: 44px;
  padding: 0 18px;
  border: 0;
  border-radius: 22px;
  background: var(--btn-primary-bg);
  color: var(--btn-primary-fg);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 750;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.signer-notice__btn:disabled { opacity: 0.45; cursor: default; }
.signer-notice__btn:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }
</style>
