<!--
  RequestSheet
  Bottom sheet to ask a contact for money: amount, optional note, and the
  wallet the money lands in.

  Presentational. Everything the sheet shows about wallets arrives as props
  (`wallets`, `landingInfo`); it creates no invoice and reads no store. On
  submit it emits `submit({ amountSats, note, walletId })` and waits: the
  parent sets `submitting` while it works and `error` if it fails.

    - Amount in whole sats (the Lightning invoice carries sats), optional fiat
      line from `formatFiat(sats)`.
    - "Receive in" is ReceiveWalletField: always shown, so the user knows where
      the money lands; a choice only when there are several wallets.
    - landingInfo: plain-language note when the money does NOT land in the
      wallet the user would expect (Arkade cannot create invoices, so the
      request is paid to the profile address instead).
-->
<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    :persistent="submitting"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <section class="request-sheet" :aria-labelledby="titleId">
      <div class="request-sheet__grab" aria-hidden="true" />

      <header class="request-sheet__top">
        <h2 :id="titleId" class="request-sheet__title">
          {{ partnerName ? $t('Request from {name}', { name: partnerName }) : $t('Request money') }}
        </h2>
        <button
          type="button"
          class="request-sheet__close"
          :disabled="submitting"
          :aria-label="$t('Close')"
          @click="$emit('update:modelValue', false)"
        >
          <Icon icon="tabler:x" width="20" height="20" />
        </button>
      </header>

      <div class="request-sheet__body">
        <div class="request-sheet__amount">
          <label :for="amountId" class="request-sheet__sr">{{ $t('Amount in sats') }}</label>
          <div class="request-sheet__amount-line">
            <span v-if="bip177" class="request-sheet__unit" aria-hidden="true">₿</span>
            <input
              :id="amountId"
              ref="amount"
              class="request-sheet__amount-input"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              placeholder="0"
              :value="amountDisplay"
              :style="{ width: amountWidth }"
              :aria-invalid="amountError ? 'true' : undefined"
              :aria-describedby="amountError ? errorId : undefined"
              :disabled="submitting"
              @input="onAmountInput"
              @keydown.enter.prevent="submit"
            >
            <span v-if="!bip177" class="request-sheet__unit" aria-hidden="true">sats</span>
          </div>
          <p v-if="fiat" class="request-sheet__fiat">{{ fiat }}</p>
          <p v-if="amountError" :id="errorId" class="request-sheet__error" role="alert">
            <Icon icon="tabler:alert-circle" width="14" height="14" />
            {{ amountError }}
          </p>
        </div>

        <div class="request-sheet__note">
          <label :for="noteId" class="request-sheet__label">{{ $t('Note (optional)') }}</label>
          <input
            :id="noteId"
            v-model="note"
            class="request-sheet__note-input"
            type="text"
            autocomplete="off"
            enterkeyhint="done"
            :maxlength="maxNoteLength"
            :placeholder="$t('What is it for?')"
            :disabled="submitting"
            @keydown.enter.prevent="submit"
          >
        </div>

        <ReceiveWalletField
          :entries="wallets"
          :model-value="walletId"
          :disabled="submitting"
          @update:model-value="$emit('update:walletId', $event)"
        />

        <p v-if="landingInfo" class="request-sheet__info">
          <Icon icon="tabler:info-circle" width="16" height="16" />
          <span>{{ landingInfo }}</span>
        </p>

        <p v-if="error" class="request-sheet__failure" role="alert">
          <Icon icon="tabler:alert-triangle" width="16" height="16" />
          <span>{{ error }}</span>
        </p>
      </div>

      <footer class="request-sheet__foot">
        <button
          type="button"
          class="request-sheet__cta"
          :disabled="!canSubmit"
          :aria-busy="submitting ? 'true' : undefined"
          @click="submit"
        >
          <Icon v-if="submitting" icon="tabler:loader-2" width="20" height="20" class="request-sheet__spin" />
          {{ ctaText }}
        </button>
      </footer>
    </section>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue'
import ReceiveWalletField from './ReceiveWalletField.vue'
import { MAX_NOTE_LENGTH } from '../../services/dm/constants.js'
import { formatSats } from './chatFormat.js'
import './chatTokens.css'

/** A sat amount never needs more digits; also keeps Number exact. */
const MAX_DIGITS = 12

export default {
  name: 'RequestSheet',
  components: { Icon, ReceiveWalletField },
  props: {
    /** Sheet open (v-model). */
    modelValue: { type: Boolean, default: false },
    partnerName: { type: String, default: '' },
    /** ReceiveWalletField entries: { id, name, type, detail, usable, reason }. */
    wallets: { type: Array, default: () => [] },
    /** Id of the wallet the money lands in (v-model:wallet-id). */
    walletId: { type: String, default: null },
    /** Plain-language note when the money lands somewhere unexpected. */
    landingInfo: { type: String, default: '' },
    minSats: { type: Number, default: 1 },
    maxSats: { type: Number, default: null },
    maxNoteLength: { type: Number, default: MAX_NOTE_LENGTH },
    /** sats -> "≈ $4.20" (empty string for none). Supplied by the page. */
    formatFiat: { type: Function, default: null },
    /** The parent is creating the invoice. */
    submitting: { type: Boolean, default: false },
    /** Why creating the request failed, already translated. */
    error: { type: String, default: '' },
    bip177: { type: Boolean, default: true }
  },
  emits: ['update:modelValue', 'update:walletId', 'submit'],
  data() {
    return { amountText: '', note: '' }
  },
  computed: {
    titleId() { return `request-title-${this.$.uid}` },
    amountId() { return `request-amount-${this.$.uid}` },
    noteId() { return `request-note-${this.$.uid}` },
    errorId() { return `request-amount-error-${this.$.uid}` },

    /** The field hugs its digits so the unit sits right next to them. */
    amountWidth() {
      return `${Math.max(this.amountDisplay.length, 1) + 0.6}ch`
    },
    /** Digit groups while typing: 25,000. The raw digits stay in `amountText`. */
    amountDisplay() {
      return this.amountText ? this.amountSats.toLocaleString() : ''
    },
    amountSats() {
      return this.amountText ? Number.parseInt(this.amountText, 10) : 0
    },
    fiat() {
      if (!this.amountSats || typeof this.formatFiat !== 'function') return ''
      return this.formatFiat(this.amountSats) || ''
    },
    amountError() {
      if (!this.amountSats) return ''
      if (this.amountSats < this.minSats) {
        return this.$t('The smallest request is {amount}', { amount: formatSats(this.minSats, this.bip177) })
      }
      if (this.maxSats !== null && this.amountSats > this.maxSats) {
        return this.$t('The largest request is {amount}', { amount: formatSats(this.maxSats, this.bip177) })
      }
      return ''
    },
    selectedWallet() {
      return this.wallets.find((w) => w.id === this.walletId) || this.wallets.find((w) => w.usable) || null
    },
    canSubmit() {
      return !this.submitting
        && this.amountSats >= this.minSats
        && !this.amountError
        && !!this.selectedWallet?.usable
    },
    ctaText() {
      if (this.submitting) return this.$t('Creating request')
      return this.amountSats && !this.amountError
        ? this.$t('Request {amount}', { amount: formatSats(this.amountSats, this.bip177) })
        : this.$t('Request')
    }
  },
  watch: {
    // A fresh sheet every time: nothing typed last time lingers.
    modelValue(open) {
      if (!open) return
      this.amountText = ''
      this.note = ''
      this.$nextTick(() => this.$refs.amount?.focus?.())
    }
  },
  methods: {
    onAmountInput(event) {
      const digits = event.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS)
      this.amountText = digits
      // Keep the field in step when characters were stripped or grouped.
      const shown = digits ? Number.parseInt(digits, 10).toLocaleString() : ''
      if (event.target.value !== shown) event.target.value = shown
    },
    submit() {
      if (!this.canSubmit) return
      this.$emit('submit', {
        amountSats: this.amountSats,
        note: this.note.trim(),
        walletId: this.selectedWallet.id
      })
    }
  }
}
</script>

<style scoped>
.request-sheet {
  /* Quasar only makes a dialog's direct child <div> tappable; this root is a <section>. */
  pointer-events: all;
  width: 100%;
  max-width: 520px;
  max-height: min(94vh, calc(100vh - var(--safe-top, 0px) - 8px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  background: var(--bg-card);
  border-top: 1px solid var(--border-card);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  padding-bottom: max(1rem, var(--safe-bottom, 0px));
}

.request-sheet__grab {
  flex: 0 0 auto;
  width: 36px;
  height: 4px;
  margin: 8px auto 4px;
  border-radius: 999px;
  background: var(--text-muted);
  opacity: 0.45;
}

.request-sheet__top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px 4px 20px;
}
.request-sheet__title { flex: 1; min-width: 0; margin: 0; font-size: 1.125rem; font-weight: 750; line-height: 1.3; letter-spacing: normal; overflow-wrap: anywhere; }
.request-sheet__close {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.request-sheet__close:disabled { opacity: 0.4; cursor: default; }

.request-sheet__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 18px 16px;
}

.request-sheet__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.request-sheet__amount { text-align: center; }
.request-sheet__amount-line {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
}
.request-sheet__unit { font-size: 1.25rem; font-weight: 700; color: var(--text-secondary); }
.request-sheet__amount-input {
  max-width: 100%;
  min-height: 56px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 2.75rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  text-align: center;
  outline: none;
}
.request-sheet__amount-input::placeholder { color: var(--text-muted); }
.request-sheet__amount-input:focus-visible { box-shadow: 0 2px 0 0 var(--chat-focus); }
.request-sheet__fiat { margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--text-secondary); }
.request-sheet__error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 6px 0 0;
  font-size: 0.78125rem;
  font-weight: 650;
  color: var(--chat-danger);
}

.request-sheet__label {
  display: block;
  padding: 0 4px 6px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}
.request-sheet__note-input {
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: inherit;
  /* 16px: below this iOS zooms the page on focus. */
  font-size: 1rem;
  outline: none;
}
.request-sheet__note-input::placeholder { color: var(--text-muted); }
.request-sheet__note-input:focus-visible { box-shadow: 0 0 0 2px var(--chat-focus); }

.request-sheet__info,
.request-sheet__failure {
  display: flex;
  gap: 10px;
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--radius-ms);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.request-sheet__info { background: var(--bg-input); color: var(--text-secondary); }
.request-sheet__failure { border: 1px solid var(--chat-danger-line); background: var(--chat-danger-soft); color: var(--text-primary); }
.request-sheet__info :deep(svg),
.request-sheet__failure :deep(svg) { flex: 0 0 auto; margin-top: 1px; }
.request-sheet__failure :deep(svg) { color: var(--chat-danger); }

.request-sheet__foot { flex: 0 0 auto; padding: 4px 18px 8px; }
.request-sheet__cta {
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border: 0;
  border-radius: 26px;
  background: var(--chat-pay-bg);
  color: var(--chat-pay-fg);
  font-family: inherit;
  font-size: 1rem;
  font-weight: 800;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.request-sheet__cta:disabled { opacity: 0.38; cursor: default; }
.request-sheet__spin { animation: request-spin 1s linear infinite; }
@keyframes request-spin { to { transform: rotate(360deg); } }

.request-sheet__close:focus-visible,
.request-sheet__cta:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .request-sheet__spin { animation: none; }
}
</style>
