<template>
  <q-dialog v-model="open" :aria-labelledby="titleId" :aria-describedby="descriptionId" @hide="$emit('hidden')">
    <q-card class="default-wallet-dialog">
      <!-- The question scrolls when large text makes it taller than the
           screen; the two answers below it never leave the screen. -->
      <div class="default-wallet-body">
        <!-- The wallet's own mark: the question is about this wallet. -->
        <span class="default-wallet-icon"><WalletBrandMark :type="walletType || 'nwc'" :size="28" color="currentColor" /></span>
        <I18nT :id="titleId" tag="h2" keypath="Use {name} when you pay contacts?" scope="global">
          <template #name><strong>{{ walletName }}</strong></template>
        </I18nT>
        <p :id="descriptionId">{{ $t('It becomes your default wallet for payments to contacts. You can change this in Settings.') }}</p>
        <p v-if="error" class="default-wallet-error" role="alert">{{ error }}</p>
      </div>
      <div class="default-wallet-actions">
        <button type="button" class="default-wallet-use" @click="$emit('accept')">{{ $t('Use {name}', { name: walletName }) }}</button>
        <button type="button" class="default-wallet-later" @click="$emit('dismiss')">{{ $t('Not now') }}</button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Translation as I18nT } from 'vue-i18n'
import WalletBrandMark from './WalletBrandMark.vue'

export default {
  name: 'DefaultPaymentWalletDialog',
  components: { I18nT, WalletBrandMark },
  props: {
    modelValue: { type: Boolean, default: false },
    walletName: { type: String, default: '' },
    walletType: { type: String, default: '' },
    error: { type: String, default: '' },
  },
  // `dismiss` is the answer "Not now". `later` is a tap beside the dialog or
  // Escape: no answer was given, so nothing is remembered.
  emits: ['accept', 'dismiss', 'later', 'hidden'],
  computed: {
    titleId() { return `default-wallet-title-${this.$.uid}` },
    descriptionId() { return `default-wallet-description-${this.$.uid}` },
    open: {
      get() { return this.modelValue },
      set(value) { if (!value) this.$emit('later') },
    },
  },
}
</script>

<style scoped>
.default-wallet-dialog { width: 340px; max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; overflow: hidden; padding: 24px; border: 1px solid var(--border-card); border-radius: var(--radius-xl); background: var(--bg-card); color: var(--text-primary); text-align: center; }
.default-wallet-icon { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 18px; background: var(--brand-accent-soft); color: var(--brand-accent-text); }
h2 { margin: 0; font: 400 1.25rem/1.45 'Manrope', sans-serif; overflow-wrap: anywhere; }
h2 strong { font-weight: 700; }
p { margin: 12px 0 0; font: 400 .9375rem/1.6 'Manrope', sans-serif; color: var(--text-secondary); overflow-wrap: anywhere; }
.default-wallet-error { color: var(--color-negative); }
.default-wallet-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.default-wallet-actions { flex: none; display: grid; gap: 8px; margin-top: 24px; }
button { width: 100%; min-height: 48px; padding: 12px; border: 0; border-radius: var(--radius-md); font: 600 1rem/1.5 'Manrope', sans-serif; overflow-wrap: anywhere; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: 3px; }
.default-wallet-use { background: var(--brand-accent); color: var(--bg-card); font-weight: 700; }
.default-wallet-later { background: transparent; color: var(--text-secondary); font-weight: 400; }
</style>
