<!--
  PaymentLine
  A payment between the two people, as a quiet grey line in the thread:
    "↗ You sent ₿ 5,000 · Coffee"      "↙ Received ₿ 5,000"

  Money that moved is shown, never decorated: no card, no colour except a
  green arrow for money in. The whole line is one button (details live on the
  contact page), at least 44 pt tall.

  The parent only passes incoming payments its OWN wallet confirmed; this
  component never judges a payment (docs section 4).
-->
<template>
  <button type="button" class="payment-line" :aria-label="spoken" @click="$emit('open')">
    <span class="payment-line__icon" :class="{ 'payment-line__icon--in': !outgoing }" aria-hidden="true">
      <Icon :icon="outgoing ? 'tabler:arrow-up-right' : 'tabler:arrow-down-left'" width="14" height="14" />
    </span>
    <span class="payment-line__text">{{ text }}</span>
    <span v-if="time" class="payment-line__time" aria-hidden="true">{{ time }}</span>
  </button>
</template>

<script>
import { Icon } from '@iconify/vue'
import { formatClock, formatSats } from './chatFormat.js'
import './chatTokens.css'

export default {
  name: 'PaymentLine',
  components: { Icon },
  props: {
    /** True when the user sent the money. */
    outgoing: { type: Boolean, default: false },
    amountSats: { type: Number, required: true },
    /** The payment note, if any. */
    note: { type: String, default: '' },
    /** Unix seconds. */
    createdAt: { type: Number, default: null },
    /** ₿ 1,234 (true) or 1,234 sats (false): the user's BIP-177 setting. */
    bip177: { type: Boolean, default: true }
  },
  emits: ['open'],
  computed: {
    amount() {
      return formatSats(this.amountSats, this.bip177)
    },
    text() {
      const head = this.outgoing
        ? this.$t('You sent {amount}', { amount: this.amount })
        : this.$t('Received {amount}', { amount: this.amount })
      return this.note ? `${head} · ${this.note}` : head
    },
    time() {
      return this.createdAt === null ? '' : formatClock(this.createdAt, this.$i18n?.locale)
    },
    spoken() {
      return this.time ? `${this.text}, ${this.time}` : this.text
    }
  }
}
</script>

<style scoped>
.payment-line {
  align-self: center;
  max-width: 94%;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 6px;
  margin: 2px 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-family: 'Manrope', sans-serif;
  font-size: 0.8125rem;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.payment-line:active { background: var(--bg-input); }
.payment-line:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 0; }

.payment-line__icon {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--bg-input);
  color: var(--text-secondary);
}
.payment-line__icon--in { color: var(--brand-accent-text); }

.payment-line__text { min-width: 0; overflow-wrap: anywhere; }
.payment-line__time { flex: 0 0 auto; font-size: 0.6875rem; color: var(--text-muted); }
</style>
