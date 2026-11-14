<template>
  <q-dialog v-model="open" :aria-labelledby="titleId" :aria-describedby="descriptionId" @hide="$emit('hidden')">
    <q-card class="default-wallet-dialog">
      <span class="default-wallet-icon"><Icon icon="tabler:wallet" width="28" height="28" /></span>
      <h2 :id="titleId">{{ $t('Use {name} for future payments?', { name: walletName }) }}</h2>
      <p :id="descriptionId">{{ $t('You can change this in Settings.') }}</p>
      <p v-if="error" class="default-wallet-error" role="alert">{{ error }}</p>
      <div class="default-wallet-actions">
        <button type="button" class="default-wallet-use" @click="$emit('accept')">{{ $t('Use {name}', { name: walletName }) }}</button>
        <button type="button" class="default-wallet-later" @click="$emit('dismiss')">{{ $t('Not now') }}</button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue'

export default {
  name: 'DefaultPaymentWalletDialog',
  components: { Icon },
  props: {
    modelValue: { type: Boolean, default: false },
    walletName: { type: String, default: '' },
    error: { type: String, default: '' },
  },
  emits: ['accept', 'dismiss', 'hidden'],
  computed: {
    titleId() { return `default-wallet-title-${this.$.uid}` },
    descriptionId() { return `default-wallet-description-${this.$.uid}` },
    open: {
      get() { return this.modelValue },
      set(value) { if (!value) this.$emit('dismiss') },
    },
  },
}
</script>

<style scoped>
.default-wallet-dialog { width: 340px; max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 24px; border: 1px solid var(--border-card); border-radius: var(--radius-xl); background: var(--bg-card); color: var(--text-primary); text-align: center; }
.default-wallet-icon { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 18px; background: var(--brand-accent-soft); color: var(--brand-accent-text); }
h2 { margin: 0; font: 700 1.1875rem/1.45 'Manrope', sans-serif; overflow-wrap: anywhere; }
p { margin: 12px 0 0; font: 400 .9375rem/1.6 'Manrope', sans-serif; color: var(--text-secondary); overflow-wrap: anywhere; }
.default-wallet-error { color: var(--color-negative); }
.default-wallet-actions { display: grid; gap: 8px; margin-top: 24px; }
button { width: 100%; min-height: 48px; padding: 12px; border: 0; border-radius: var(--radius-md); font: 600 1rem/1.5 'Manrope', sans-serif; overflow-wrap: anywhere; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: 3px; }
.default-wallet-use { background: var(--brand-accent); color: var(--bg-card); }
.default-wallet-later { background: transparent; color: var(--text-secondary); }
</style>
