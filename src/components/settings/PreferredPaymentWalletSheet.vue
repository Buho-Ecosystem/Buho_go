<template>
  <q-dialog v-model="open" position="bottom" :aria-labelledby="titleId">
    <q-card class="payment-wallet-sheet">
      <header class="form-sheet-header payment-wallet-header">
        <button type="button" class="form-sheet-cancel" @click="open = false">{{ $t('Cancel') }}</button>
        <h2 :id="titleId" class="form-sheet-title">{{ $t('Default wallet') }}</h2>
        <span class="header-spacer" aria-hidden="true" />
      </header>

      <div class="payment-wallet-body">
        <p class="payment-wallet-intro">{{ $t('Choose a wallet for payments to contacts. You can pick another before you pay.') }}</p>
        <p v-if="missingPreference" class="payment-wallet-warning" role="status">
          {{ $t('This wallet is no longer available. Choose another wallet or Automatic.') }}
        </p>

        <fieldset class="payment-wallet-options">
          <legend class="sr-only">{{ $t('Default wallet') }}</legend>
          <label class="payment-wallet-option">
            <input type="radio" :name="radioName" data-wallet-id="automatic" :checked="draft === null" @change="choose(null)">
            <span class="payment-wallet-mark"><Icon icon="tabler:wallet" width="21" height="21" /></span>
            <span class="payment-wallet-copy"><strong>{{ $t('Automatic') }}</strong><small>{{ $t('Use the wallet on Home when it can pay.') }}</small></span>
            <span class="payment-wallet-check" aria-hidden="true"><Icon icon="tabler:check" width="15" height="15" /></span>
          </label>
          <label v-for="wallet in walletStore.wallets" :key="wallet.id" class="payment-wallet-option">
            <input type="radio" :name="radioName" :data-wallet-id="wallet.id" :checked="draft === wallet.id" @change="choose(wallet.id)">
            <span class="payment-wallet-mark"><WalletBrandMark :type="wallet.type || 'nwc'" :size="21" color="currentColor" /></span>
            <span class="payment-wallet-copy">
              <span class="payment-wallet-name"><strong>{{ wallet.name || $t('Wallet') }}</strong><span v-if="wallet.id === preferences.preferredWalletId" class="payment-wallet-badge">{{ $t('Default') }}</span></span>
              <small>{{ typeLabel(wallet) }}<template v-if="displayBalance(wallet) !== null"> · <HiddenAmount>{{ displayBalance(wallet) }}</HiddenAmount></template><template v-else> · {{ $t('Balance not loaded yet') }}</template></small>
            </span>
            <span class="payment-wallet-check" aria-hidden="true"><Icon icon="tabler:check" width="15" height="15" /></span>
          </label>
        </fieldset>
        <p class="payment-wallet-note">{{ $t('You still check each payment before sending.') }}</p>
        <p v-if="error" class="payment-wallet-error" role="alert">{{ error }}</p>
      </div>

      <footer class="payment-wallet-footer">
        <button type="button" class="form-sheet-primary" :disabled="!canSave" @click="save">{{ $t('Save') }}</button>
      </footer>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue'
import { useWalletStore } from '../../stores/wallet.js'
import { usePaymentPreferencesStore } from '../../stores/paymentPreferences.js'
import { formatAmount } from '../../utils/amountFormatting.js'
import { walletTypeLabel } from '../../utils/walletNames.js'
import WalletBrandMark from '../WalletBrandMark.vue'
import HiddenAmount from '../HiddenAmount.vue'

export default {
  name: 'PreferredPaymentWalletSheet',
  components: { Icon, WalletBrandMark, HiddenAmount },
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue', 'saved'],
  setup() {
    const preferences = usePaymentPreferencesStore()
    preferences.initialize()
    return { preferences, walletStore: useWalletStore() }
  },
  data: () => ({ draft: null, error: '' }),
  computed: {
    titleId() { return `payment-wallet-title-${this.$.uid}` },
    radioName() { return `preferred-payment-wallet-${this.$.uid}` },
    open: {
      get() { return this.modelValue },
      set(value) { this.$emit('update:modelValue', value) },
    },
    missingPreference() {
      return !!this.preferences.preferredWalletId && this.walletStore.hydrated
        && this.walletStore.savedStateLoaded !== false
        && !this.walletStore.wallets.some(wallet => wallet.id === this.preferences.preferredWalletId)
    },
    canSave() {
      return this.draft === null || this.walletStore.wallets.some(wallet => wallet.id === this.draft)
    },
  },
  watch: {
    modelValue: {
      immediate: true,
      handler(open) { if (open) this.resetDraft() },
    },
  },
  methods: {
    resetDraft() {
      this.preferences.initialize()
      this.draft = this.preferences.preferredWalletId
      this.error = ''
      // Wallet names are available as soon as storage is hydrated; connecting
      // a provider must never hold the settings picker open or delay its UI.
      this.walletStore.whenHydrated?.()
    },
    choose(id) { this.draft = id; this.error = '' },
    typeLabel: walletTypeLabel,
    displayBalance(wallet) {
      const balance = this.walletStore.getDisplayBalance(wallet.id)
      return balance.known ? formatAmount(balance.balance, this.walletStore.useBip177Format) : null
    },
    save() {
      if (!this.canSave) return
      if (!this.preferences.setPreferred(this.draft)) {
        this.error = this.$t("Couldn't save this choice. Try again.")
        return
      }
      this.$emit('saved', this.draft)
      this.open = false
    },
  },
}
</script>

<style scoped>
.payment-wallet-sheet { pointer-events: all; width: 100%; max-width: 520px; max-height: min(92dvh, calc(100dvh - var(--safe-top, 0px) - 8px)); display: flex; flex-direction: column; border-radius: var(--radius-xl) var(--radius-xl) 0 0; background: var(--bg-card); color: var(--text-primary); border-top: 1px solid var(--border-card); }
.payment-wallet-header { flex-shrink: 0; padding-top: 14px; grid-template-columns: auto minmax(0, 1fr) 44px; gap: 12px; }
.form-sheet-title { font-size: 1.0625rem; overflow-wrap: anywhere; }
.form-sheet-cancel, .form-sheet-primary { font-size: 1rem; }
.payment-wallet-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 12px 20px 22px; }
.payment-wallet-intro, .payment-wallet-note, .payment-wallet-warning { font: 400 .8125rem/1.8 'Manrope', sans-serif; color: var(--text-secondary); margin: 4px 0 20px; overflow-wrap: anywhere; }
.payment-wallet-note { font-size: .75rem; margin: 16px 2px 0; }
.payment-wallet-warning { color: var(--color-warn); }
.payment-wallet-options { padding: 0; margin: 0; border: 1px solid var(--border-card); border-radius: 17px; overflow: hidden; min-width: 0; }
.payment-wallet-option { position: relative; display: flex; align-items: center; gap: 12px; padding: 16px 14px; min-height: 80px; cursor: pointer; }
.payment-wallet-option + .payment-wallet-option { border-top: 1px solid var(--border-card); }
.payment-wallet-option:has(input:checked) { background: var(--brand-accent-soft); }
.payment-wallet-option:has(input:focus-visible) { outline: 2px solid var(--brand-accent-text); outline-offset: -3px; }
.payment-wallet-option input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.payment-wallet-mark { display: grid; place-items: center; width: 37px; height: 37px; border-radius: 11px; flex-shrink: 0; background: var(--bg-input); color: var(--text-secondary); }
.payment-wallet-copy { flex: 1; min-width: 0; }
.payment-wallet-copy strong { display: block; font: 700 .875rem/1.5 'Manrope', sans-serif; overflow-wrap: anywhere; }
.payment-wallet-copy small { display: block; color: var(--text-secondary); font: 400 .75rem/1.65 'Manrope', sans-serif; margin-top: 4px; overflow-wrap: anywhere; }
.payment-wallet-name { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.payment-wallet-badge { font: 700 .625rem/1.4 'Manrope', sans-serif; background: var(--brand-accent-soft); color: var(--brand-accent-text); padding: 2px 5px; border-radius: 5px; }
.payment-wallet-check { display: grid; place-items: center; width: 21px; height: 21px; border: 1px solid var(--border-card); border-radius: 50%; flex-shrink: 0; }
.payment-wallet-check :deep(svg) { opacity: 0; }
input:checked ~ .payment-wallet-check { border-color: var(--brand-accent); background: var(--brand-accent); color: var(--bg-card); }
input:checked ~ .payment-wallet-check :deep(svg) { opacity: 1; }
.payment-wallet-footer { flex-shrink: 0; border-top: 1px solid var(--border-card); padding: 15px 20px max(20px, var(--safe-bottom, 0px)); }
.payment-wallet-footer .form-sheet-primary { width: 100%; padding: .625em .75em; overflow-wrap: anywhere; }
.payment-wallet-error { color: var(--color-negative); font: 600 .8125rem/1.65 'Manrope', sans-serif; margin: 16px 0 0; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 360px) {
  .payment-wallet-header { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .payment-wallet-header .form-sheet-cancel { grid-row: 1; }
  .payment-wallet-header .form-sheet-title { grid-row: 2; }
  .payment-wallet-header .header-spacer { display: none; }
}
</style>
