<!--
  RequestSheet
  Bottom sheet to ask someone for money: how much, an optional note, and the
  Lightning address of the user's profile the money is paid to. Opened from
  the chat's money bar and from Receive (after "Request from").

  Presentational. It creates nothing and reads no store. On submit it emits
  `submit({ amountSats, note })` and waits: the parent sets `submitting` while
  it works and `error` if it fails.

    - The amount is typed on the app's keypad (AmountKeypad), in sats or, one
      tap on the other unit, in the preferred fiat currency. The request
      itself is always in sats: that is what the partner is asked for.
    - "Add a note" is a quiet link; tapping it turns it into the note field.
    - "Paid to <address>" says where the money lands; tapping it emits
      `open-address` (the parent opens the sheet where it is changed).
    - No profile address: the sheet explains it and offers one button that
      emits `open-address` instead of the keypad, so there is no dead end.
    - The `avatar` slot shows who is asked next to the title.
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

      <header class="request-sheet__head">
        <button
          type="button"
          class="request-sheet__back"
          :aria-label="$t('Back')"
          :disabled="submitting"
          @click="$emit('update:modelValue', false)"
        >
          <Icon icon="tabler:chevron-left" width="20" height="20" />
        </button>
        <h2 :id="titleId" class="request-sheet__title">
          <span v-if="$slots.avatar" class="request-sheet__avatar"><slot name="avatar" /></span>
          <span class="request-sheet__title-text">{{ partnerName ? $t('Request from {name}', { name: partnerName }) : $t('Request money') }}</span>
        </h2>
      </header>

      <div v-if="!address" class="request-sheet__empty">
        <span class="request-sheet__empty-icon"><Icon icon="tabler:at" width="26" height="26" /></span>
        <p class="request-sheet__empty-text">{{ $t('To request money you need a Lightning address in your profile.') }}</p>
      </div>

      <AmountKeypad
        v-else
        v-model="amount"
        v-model:fiat="inFiat"
        class="request-sheet__keypad"
        :fiat-code="keypadCurrency"
        :fiat-rate="keypadRate"
      >
        <input
          v-if="noteOpen"
          :id="noteId"
          ref="note"
          v-model="note"
          class="request-sheet__note"
          type="text"
          autocomplete="off"
          enterkeyhint="done"
          :maxlength="maxNoteLength"
          :placeholder="$t('What is it for?')"
          :aria-label="$t('Note (optional)')"
          :disabled="submitting"
          @blur="closeEmptyNote"
          @keydown.enter.prevent="$event.target.blur()"
        >
        <button v-else type="button" class="request-sheet__add-note" :disabled="submitting" @click="openNote">
          <Icon icon="tabler:notes" width="18" height="18" />
          {{ $t('Add a note') }}
        </button>
        <p v-if="amountError" class="form-sheet-error request-sheet__error" role="alert">
          <Icon icon="tabler:alert-circle" width="14" height="14" />
          {{ amountError }}
        </p>
      </AmountKeypad>

      <footer class="request-sheet__foot">
        <p v-if="error" class="request-sheet__failure" role="alert">
          <Icon icon="tabler:alert-triangle" width="16" height="16" />
          <span>{{ error }}</span>
        </p>
        <button v-if="!address" type="button" class="form-sheet-primary request-sheet__cta" @click="$emit('open-address')">
          {{ $t('Set up Lightning address') }}
        </button>
        <template v-else>
          <button type="button" class="request-sheet__to" :disabled="submitting" @click="$emit('open-address')">
            {{ $t('Paid to {address}', { address }) }}
          </button>
          <button
            type="button"
            class="form-sheet-primary request-sheet__cta"
            :disabled="!canSubmit"
            :aria-busy="submitting ? 'true' : undefined"
            @click="submit"
          >
            <Icon v-if="submitting" icon="tabler:loader-2" width="20" height="20" class="request-sheet__spin" />
            {{ ctaText }}
          </button>
        </template>
      </footer>
    </section>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue'
import AmountKeypad from '../AmountKeypad.vue'
import { keypadSats } from '../../utils/amountKeypad.js'
import { MAX_NOTE_LENGTH } from '../../services/dm/constants.js'
import { formatSats } from './chatFormat.js'
import './chatTokens.css'

export default {
  name: 'RequestSheet',
  components: { Icon, AmountKeypad },
  props: {
    /** Sheet open (v-model). */
    modelValue: { type: Boolean, default: false },
    partnerName: { type: String, default: '' },
    /** The profile Lightning address the money is paid to; empty = none set up yet. */
    address: { type: String, default: '' },
    minSats: { type: Number, default: 1 },
    maxSats: { type: Number, default: null },
    maxNoteLength: { type: Number, default: MAX_NOTE_LENGTH },
    /** The preferred fiat currency ("EUR"); '' = sats only. */
    fiatCode: { type: String, default: '' },
    /** Its price per bitcoin; 0 = no rate yet, sats only. */
    fiatRate: { type: Number, default: 0 },
    /** An amount to start from (Receive's typed amount); 0 = empty. */
    initialSats: { type: Number, default: 0 },
    /** The parent is checking the address and sending the request. */
    submitting: { type: Boolean, default: false },
    /** Why creating the request failed, already translated. */
    error: { type: String, default: '' },
    bip177: { type: Boolean, default: true }
  },
  emits: ['update:modelValue', 'open-address', 'submit'],
  data() {
    return { amount: '', inFiat: false, note: '', noteOpen: false }
  },
  computed: {
    titleId() { return `request-title-${this.$.uid}` },
    noteId() { return `request-note-${this.$.uid}` },
    /** The keypad offers fiat only with both a currency and a rate. */
    keypadRate() { return this.fiatCode ? this.fiatRate : 0 },
    keypadCurrency() { return (this.fiatCode || 'usd').toLowerCase() },
    amountSats() {
      return keypadSats(this.amount, { fiat: this.inFiat, rate: this.keypadRate })
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
      this.amount = this.initialSats > 0 ? String(this.initialSats) : ''
      this.inFiat = false
      this.note = ''
      this.noteOpen = false
    }
  },
  methods: {
    openNote() {
      this.noteOpen = true
      this.$nextTick(() => this.$refs.note?.focus?.())
    },
    /** A note left empty turns back into the link. */
    closeEmptyNote() {
      if (!this.note.trim()) this.noteOpen = false
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
  height: min(94vh, calc(100vh - var(--safe-top, 0px) - 8px));
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

.request-sheet__head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding: 0 64px;
}
.request-sheet__back {
  position: absolute;
  left: 14px;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-card);
  border-radius: 50%;
  background: var(--bg-input);
  color: var(--text-primary);
  cursor: pointer;
}
.request-sheet__back:disabled { opacity: 0.4; cursor: default; }
/* A long contact name ends in an ellipsis instead of pushing the back button off the sheet. */
.request-sheet__title {
  margin: 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.125rem;
  font-weight: 800;
}
.request-sheet__title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.request-sheet__avatar { flex: 0 0 auto; width: 28px; height: 28px; display: grid; }

.request-sheet__keypad { padding: 0 18px; }

.request-sheet__add-note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font: 500 15px 'Manrope', sans-serif;
  cursor: pointer;
}
.request-sheet__add-note:active { background: rgba(128, 128, 128, 0.1); }

/* The note reads like the description chip it replaces, not like a form field. */
.request-sheet__note {
  width: min(100%, 300px);
  min-height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: inherit;
  /* 16px: below this iOS zooms the page on focus. */
  font-size: 1rem;
  text-align: center;
  outline: none;
}
.request-sheet__note::placeholder { color: var(--text-muted); }
.request-sheet__note:focus-visible { box-shadow: 0 0 0 2px var(--chat-focus); }

.request-sheet__error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  font-weight: 650;
}

.request-sheet__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px 28px 20px;
  text-align: center;
}
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

.request-sheet__foot {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 18px 8px;
}
.request-sheet__to {
  align-self: center;
  max-width: 100%;
  min-height: 44px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: 500 13px 'Manrope', sans-serif;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.request-sheet__to:disabled { opacity: 0.5; cursor: default; }

.request-sheet__failure {
  display: flex;
  gap: 10px;
  margin: 0 0 6px;
  padding: 12px 14px;
  border: 1px solid var(--chat-danger-line);
  border-radius: var(--radius-ms);
  background: var(--chat-danger-soft);
  color: var(--text-primary);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.request-sheet__failure :deep(svg) { flex: 0 0 auto; margin-top: 1px; color: var(--chat-danger); }

.request-sheet__cta { width: 100%; padding: 0 18px; -webkit-tap-highlight-color: transparent; }
.request-sheet__spin { animation: request-spin 1s linear infinite; }
@keyframes request-spin { to { transform: rotate(360deg); } }

.request-sheet__back:focus-visible,
.request-sheet__add-note:focus-visible,
.request-sheet__to:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .request-sheet__spin { animation: none; }
}
</style>
