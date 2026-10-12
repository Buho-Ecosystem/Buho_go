<!--
  RequestSheet
  Bottom sheet to ask a contact for money: amount, optional note, and the
  Lightning address of the user's profile the money is paid to.

  Presentational. It creates nothing and reads no store. On submit it emits
  `submit({ amountSats, note })` and waits: the parent sets `submitting` while
  it works and `error` if it fails.

    - Amount in whole sats, or in the preferred fiat currency: the unit pill
      switches (the confirm sheet's pattern) and clears the field, so no
      half-converted number is left behind. The line underneath shows the
      other unit. The request itself is always in sats: that is what the
      partner is asked for.
    - "To: <address>" is a quiet row; tapping it emits `open-address` (the
      parent opens the sheet where the profile address is changed).
    - No profile address: the sheet explains it and offers one button that
      emits `open-address` instead of the amount form, so there is no dead end.
    - The shared form-sheet pieces (app.css): grabber, Cancel + title header,
      primary button, error colour.
-->
<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    :persistent="submitting"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <section class="request-sheet" :aria-labelledby="titleId">
      <div class="form-sheet-grabber" aria-hidden="true" />

      <header class="form-sheet-header">
        <button
          type="button"
          class="form-sheet-cancel"
          :disabled="submitting"
          @click="$emit('update:modelValue', false)"
        >
          {{ $t('Cancel') }}
        </button>
        <h2 :id="titleId" class="form-sheet-title request-sheet__title">
          {{ partnerName ? $t('Request from {name}', { name: partnerName }) : $t('Request money') }}
        </h2>
        <span aria-hidden="true" />
      </header>

      <div v-if="!address" class="request-sheet__body request-sheet__body--empty">
        <span class="request-sheet__empty-icon"><Icon icon="tabler:at" width="26" height="26" /></span>
        <p class="request-sheet__empty-text">{{ $t('To request money you need a Lightning address in your profile.') }}</p>
      </div>

      <div v-else class="request-sheet__body">
        <div class="request-sheet__amount">
          <label :for="amountId" class="request-sheet__sr">{{ amountLabel }}</label>
          <div class="request-sheet__amount-line">
            <span v-if="!inFiat && bip177" class="request-sheet__unit" aria-hidden="true">₿</span>
            <input
              :id="amountId"
              ref="amount"
              class="request-sheet__amount-input"
              type="text"
              :inputmode="inFiat ? 'decimal' : 'numeric'"
              autocomplete="off"
              :placeholder="inFiat ? '0.00' : '0'"
              :value="amountDisplay"
              :style="{ width: amountWidth }"
              :aria-invalid="amountError ? 'true' : undefined"
              :aria-describedby="amountError ? errorId : undefined"
              :disabled="submitting"
              @input="onAmountInput"
              @keydown.enter.prevent="submit"
            >
            <span v-if="!inFiat && !bip177" class="request-sheet__unit" aria-hidden="true">sats</span>
          </div>
          <button
            v-if="fiatCode"
            type="button"
            class="request-sheet__unit-pill"
            :aria-label="$t('Enter the amount in {unit}', { unit: otherUnitLabel })"
            :disabled="submitting"
            @click="switchUnit"
          >
            <span class="request-sheet__unit-chip">
              {{ unitLabel }}
              <Icon icon="tabler:arrows-up-down" width="12" height="12" aria-hidden="true" />
            </span>
          </button>
          <p v-if="conversion" class="request-sheet__fiat">{{ conversion }}</p>
          <p v-if="amountError" :id="errorId" class="form-sheet-error request-sheet__error" role="alert">
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

        <button type="button" class="request-sheet__to" :disabled="submitting" @click="$emit('open-address')">
          <span class="request-sheet__to-label">{{ $t('To') }}</span>
          <span class="request-sheet__to-address">{{ address }}</span>
          <Icon icon="tabler:chevron-right" width="16" height="16" />
        </button>

        <p v-if="error" class="request-sheet__failure" role="alert">
          <Icon icon="tabler:alert-triangle" width="16" height="16" />
          <span>{{ error }}</span>
        </p>
      </div>

      <footer class="request-sheet__foot">
        <button v-if="!address" type="button" class="form-sheet-primary request-sheet__cta" @click="$emit('open-address')">
          {{ $t('Set up Lightning address') }}
        </button>
        <button
          v-else
          type="button"
          class="form-sheet-primary request-sheet__cta"
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
import { MAX_NOTE_LENGTH } from '../../services/dm/constants.js'
import { formatSats } from './chatFormat.js'
import './chatTokens.css'

/** A sat amount never needs more digits; also keeps Number exact. */
const MAX_DIGITS = 12

/** Whole sats: digits only, no leading zeros. */
const satsText = (raw) => raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS)

/** A fiat amount: digits and one decimal point (a comma counts as one), two decimals at most. */
function fiatText(raw) {
  const [whole, ...rest] = raw.replace(/,/g, '.').replace(/[^\d.]/g, '').split('.')
  const integer = whole.replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS)
  return rest.length ? `${integer || '0'}.${rest.join('').slice(0, 2)}` : integer
}

export default {
  name: 'RequestSheet',
  components: { Icon },
  props: {
    /** Sheet open (v-model). */
    modelValue: { type: Boolean, default: false },
    partnerName: { type: String, default: '' },
    /** The profile Lightning address the money is paid to; empty = none set up yet. */
    address: { type: String, default: '' },
    minSats: { type: Number, default: 1 },
    maxSats: { type: Number, default: null },
    maxNoteLength: { type: Number, default: MAX_NOTE_LENGTH },
    /** sats -> "≈ $4.20" (empty string for none). Supplied by the page. */
    formatFiat: { type: Function, default: null },
    /** The preferred fiat currency ("USD") when there is a rate to enter it in; '' = sats only. */
    fiatCode: { type: String, default: '' },
    /** fiat amount -> whole sats (null without a rate). Supplied by the page with `fiatCode`. */
    fiatToSats: { type: Function, default: null },
    /** The parent is checking the address and sending the request. */
    submitting: { type: Boolean, default: false },
    /** Why creating the request failed, already translated. */
    error: { type: String, default: '' },
    bip177: { type: Boolean, default: true }
  },
  emits: ['update:modelValue', 'open-address', 'submit'],
  data() {
    return { amountText: '', note: '', unit: 'sats' }
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
    inFiat() {
      return this.unit === 'fiat' && Boolean(this.fiatCode) && typeof this.fiatToSats === 'function'
    },
    satsLabel() { return this.bip177 ? '₿' : 'sats' },
    unitLabel() { return this.inFiat ? this.fiatCode : this.satsLabel },
    otherUnitLabel() { return this.inFiat ? this.satsLabel : this.fiatCode },
    amountLabel() {
      return this.inFiat ? this.$t('Amount in {unit}', { unit: this.fiatCode }) : this.$t('Amount in sats')
    },
    /** Digit groups while typing sats: 25,000. A fiat amount is shown as typed. The raw text stays in `amountText`. */
    amountDisplay() {
      if (!this.amountText) return ''
      return this.inFiat ? this.amountText : Number.parseInt(this.amountText, 10).toLocaleString()
    },
    amountSats() {
      if (!this.amountText) return 0
      if (!this.inFiat) return Number.parseInt(this.amountText, 10)
      const value = Number.parseFloat(this.amountText)
      return value > 0 ? (this.fiatToSats(value) || 0) : 0
    },
    /** The amount in the other unit: "≈ $4.20" under sats, "≈ ₿ 4,200" under fiat. */
    conversion() {
      if (!this.amountSats) return ''
      if (this.inFiat) return `≈ ${formatSats(this.amountSats, this.bip177)}`
      return typeof this.formatFiat === 'function' ? this.formatFiat(this.amountSats) || '' : ''
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
    canSubmit() {
      return !this.submitting && this.amountSats >= this.minSats && !this.amountError
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
      this.unit = 'sats'
      this.$nextTick(() => this.$refs.amount?.focus?.())
    }
  },
  methods: {
    onAmountInput(event) {
      this.amountText = this.inFiat ? fiatText(event.target.value) : satsText(event.target.value)
      // Keep the field in step when characters were stripped or grouped.
      if (event.target.value !== this.amountDisplay) event.target.value = this.amountDisplay
    },
    switchUnit() {
      this.unit = this.inFiat ? 'sats' : 'fiat'
      this.amountText = ''
      this.$nextTick(() => this.$refs.amount?.focus?.())
    },
    submit() {
      if (!this.canSubmit) return
      this.$emit('submit', { amountSats: this.amountSats, note: this.note.trim() })
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

/* A long contact name wraps instead of pushing Cancel off the sheet. */
.request-sheet__title { min-width: 0; overflow-wrap: anywhere; }
.form-sheet-cancel:disabled { opacity: 0.4; cursor: default; }

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
/* A 44 pt hit area around a small chip, like the confirm sheet's unit pill. */
.request-sheet__unit-pill {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin: 2px auto 0;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.request-sheet__unit-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--bg-input);
}
.request-sheet__unit-pill:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }
.request-sheet__unit-pill:disabled { opacity: 0.45; cursor: default; }
.request-sheet__fiat { margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--text-secondary); }
.request-sheet__error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 6px 0 0;
  font-weight: 650;
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

.request-sheet__body--empty { align-items: center; gap: 12px; padding: 24px 28px 20px; text-align: center; }
.request-sheet__empty-icon {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--bg-input);
  color: var(--text-secondary);
}
.request-sheet__empty-text { margin: 0; font-size: 0.9375rem; line-height: 1.5; color: var(--text-secondary); }

.request-sheet__to {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  text-align: left;
}
.request-sheet__to:disabled { opacity: 0.5; cursor: default; }
.request-sheet__to-label { font-weight: 600; }
.request-sheet__to-address { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
.request-sheet__to:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }

.request-sheet__failure {
  display: flex;
  gap: 10px;
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--radius-ms);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.request-sheet__failure { border: 1px solid var(--chat-danger-line); background: var(--chat-danger-soft); color: var(--text-primary); }
.request-sheet__failure :deep(svg) { flex: 0 0 auto; margin-top: 1px; }
.request-sheet__failure :deep(svg) { color: var(--chat-danger); }

.request-sheet__foot { flex: 0 0 auto; padding: 4px 18px 8px; }
.request-sheet__cta { width: 100%; padding: 0 18px; -webkit-tap-highlight-color: transparent; }
.request-sheet__spin { animation: request-spin 1s linear infinite; }
@keyframes request-spin { to { transform: rotate(360deg); } }


@media (prefers-reduced-motion: reduce) {
  .request-sheet__spin { animation: none; }
}
</style>
