<!--
  RequestCard
  A payment request in the thread, from either side.

    Header   direction: "You requested" / "{name} requests"
    Body     amount (+ optional fiat), note, "valid until" (the request's
             lifetime, 30 days)
    Footer   state line, and the next action of YOUR side in every state that
             has one (docs section 8a, there is no dead end):
               pending, payer      [Decline] [Pay]    (Pay is the one filled button)
               pending, requester  [Remind]  [Withdraw]
               expired, payer      [Send anyway]
               expired, requester  [Request again]
               paid                says where it arrived, or that it is only
                                   reported by the payer (`paidVerified`)

  Honest states (nostrdesign.org: no silent failure):
    - disabledReason   Pay stays visible but is aria-disabled and says why
                       inline ("Lightning is unavailable on Arkade").
    - untrusted        the sender is a stranger: danger styling, Pay is no
                       longer the filled primary action.
  The request carries no invoice: it is fetched when the payer taps Pay.

  Presentational: events `pay`, `decline`, `remind`, `withdraw`, `send-anyway`,
  `request-again`.
-->
<template>
  <section
    class="request-card"
    :class="[`request-card--${state}`, { 'request-card--untrusted': untrusted && state === 'pending' }]"
    role="group"
    :aria-label="spoken"
  >
    <p class="request-card__label">
      <Icon :icon="outgoing ? 'tabler:arrow-down-left' : 'tabler:arrow-up-right'" width="14" height="14" />
      <span>{{ directionLabel }}</span>
    </p>

    <p class="request-card__amount">
      <span>{{ amount }}</span>
      <small v-if="fiatText">{{ fiatText }}</small>
    </p>

    <p v-if="note" class="request-card__note">{{ note }}</p>

    <p v-if="state === 'pending' && validUntilText" class="request-card__meta">
      <Icon icon="tabler:clock" width="13" height="13" />
      {{ $t('Valid until {when}', { when: validUntilText }) }}
    </p>

    <p v-if="stateLine" class="request-card__state" :class="`request-card__state--${stateTone}`">
      <Icon :icon="stateIcon" width="15" height="15" />
      {{ stateLine }}
    </p>

    <p v-if="receivedText" class="request-card__hint">
      <Icon icon="tabler:wallet" width="14" height="14" />
      {{ receivedText }}
    </p>

    <p v-if="showReason" :id="reasonId" class="request-card__reason" role="status">
      <Icon icon="tabler:alert-triangle" width="14" height="14" />
      {{ reasonText }}
    </p>

    <div v-if="state === 'pending' && !outgoing" class="request-card__actions">
      <button type="button" class="request-btn request-btn--quiet" :disabled="busy" @click="$emit('decline')">
        {{ $t('Decline') }}
      </button>
      <button
        type="button"
        class="request-btn"
        :class="untrusted ? 'request-btn--outline' : 'request-btn--pay'"
        :disabled="busy"
        :aria-disabled="payBlocked ? 'true' : undefined"
        :aria-describedby="showReason ? reasonId : undefined"
        @click="onPay"
      >
        {{ $t('Pay') }}
      </button>
    </div>

    <div v-else-if="state === 'pending' && outgoing" class="request-card__actions request-card__actions--even">
      <button type="button" class="request-btn request-btn--quiet" :disabled="busy" @click="$emit('remind')">
        {{ $t('Remind') }}
      </button>
      <button type="button" class="request-btn request-btn--quiet" :disabled="busy" @click="$emit('withdraw')">
        {{ $t('Withdraw') }}
      </button>
    </div>

    <!-- The request ran out: the payer can still send the money, the requester can ask again. -->
    <div v-else-if="state === 'expired'" class="request-card__actions request-card__actions--single">
      <button
        v-if="outgoing"
        type="button"
        class="request-btn request-btn--quiet"
        :disabled="busy"
        @click="$emit('request-again')"
      >
        {{ $t('Request again') }}
      </button>
      <button
        v-else
        type="button"
        class="request-btn request-btn--pay"
        :disabled="busy"
        @click="$emit('send-anyway')"
      >
        {{ $t('Send anyway') }}
      </button>
    </div>
  </section>
</template>

<script>
import { Icon } from '@iconify/vue'
import { REQUEST_STATES, formatSats, formatWhen } from './chatFormat.js'
import './chatTokens.css'

export default {
  name: 'RequestCard',
  components: { Icon },
  props: {
    amountSats: { type: Number, required: true },
    /** Pre-formatted fiat equivalent ("≈ $4.20"); empty hides it. */
    fiatText: { type: String, default: '' },
    note: { type: String, default: '' },
    /** True when the user is the requester. */
    outgoing: { type: Boolean, default: false },
    /** 'pending' | 'paying' | 'paid' | 'declined' | 'cancelled' | 'expired' (REQUEST_STATE). */
    state: {
      type: String,
      default: 'pending',
      validator: (value) => REQUEST_STATES.includes(value)
    },
    /** Name of the other person, for "{name} requests". */
    partnerName: { type: String, default: '' },
    /** When the request itself stops being open (its lifetime, not its invoice's), unix seconds. */
    validUntil: { type: Number, default: null },
    /**
     * Why the user cannot pay right now. Either the DM_ERROR code
     * WALLET_CANNOT_PAY or ready, translated text. Empty = can pay.
     */
    disabledReason: { type: String, default: '' },
    /**
     * Own request that is paid: did the user's own wallet show the money
     * (true), or is it only what the payer says (false: "Reported paid, not verified")?
     */
    paidVerified: { type: Boolean, default: true },
    /** Own request, paid and verified: name of the wallet it arrived in ("Received in {wallet}"). */
    receivedIn: { type: String, default: '' },
    /** Paid and verified through the user's Lightning address, not a wallet of theirs ("Received at {address}"). */
    receivedAt: { type: String, default: '' },
    /** A stranger sent this: no primary Pay, danger styling. */
    untrusted: { type: Boolean, default: false },
    /** An action is in flight: all buttons wait. */
    busy: { type: Boolean, default: false },
    /** ₿ 1,234 (true) or 1,234 sats (false). */
    bip177: { type: Boolean, default: true }
  },
  emits: ['pay', 'decline', 'remind', 'withdraw', 'send-anyway', 'request-again'],
  computed: {
    reasonId() { return `request-reason-${this.$.uid}` },
    amount() {
      return formatSats(this.amountSats, this.bip177)
    },
    directionLabel() {
      if (this.outgoing) return this.$t('You requested')
      return this.partnerName
        ? this.$t('{name} requests', { name: this.partnerName })
        : this.$t('Payment request')
    },
    validUntilText() {
      return this.validUntil === null ? '' : formatWhen(this.validUntil)
    },
    payBlocked() {
      return !!this.disabledReason
    },
    /** The reason as a sentence: a known code is worded here, other text passes through. */
    reasonText() {
      return this.disabledReason === 'WALLET_CANNOT_PAY'
        ? this.$t('This wallet cannot pay this request. Choose another wallet.')
        : this.disabledReason
    },
    showReason() {
      return this.state === 'pending' && !this.outgoing && this.payBlocked
    },
    stateLine() {
      if (this.state === 'paid') {
        if (this.outgoing && !this.paidVerified) return this.$t('Reported paid, not verified')
        return this.$t('Paid')
      }
      return {
        // The user paid it and the payment is still routing: nothing to tap, nothing to pay again.
        paying: this.$t('Payment on its way'),
        declined: this.$t('Declined'),
        cancelled: this.$t('Withdrawn'),
        expired: this.$t('Expired')
      }[this.state] || ''
    },
    stateTone() {
      return this.state === 'paid' ? 'ok' : 'muted'
    },
    stateIcon() {
      return {
        paid: 'tabler:circle-check',
        paying: 'tabler:hourglass',
        declined: 'tabler:circle-x',
        cancelled: 'tabler:arrow-back-up',
        expired: 'tabler:clock-off'
      }[this.state] || 'tabler:circle'
    },
    /** Where a verified payment of the user's own request arrived. */
    receivedText() {
      if (this.state !== 'paid' || !this.outgoing || !this.paidVerified) return ''
      if (this.receivedIn) return this.$t('Received in {wallet}', { wallet: this.receivedIn })
      return this.receivedAt ? this.$t('Received at {address}', { address: this.receivedAt }) : ''
    },
    /** What a screen reader hears when it lands on the card. */
    spoken() {
      const who = this.directionLabel
      const state = this.state === 'pending' ? this.$t('open') : this.stateLine
      return `${who}, ${this.amount}${this.note ? `, ${this.note}` : ''}, ${state}`
    }
  },
  methods: {
    /** A blocked Pay stays focusable (so its reason is reachable) but does nothing. */
    onPay() {
      if (this.payBlocked || this.busy) return
      this.$emit('pay')
    }
  }
}
</script>

<style scoped>
.request-card {
  width: min(100%, 17rem);
  margin: 4px 0;
  padding: 14px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-card);
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  user-select: none;
  -webkit-user-select: none;
}
.request-card--pending { background: var(--color-warn-soft); border: 1.5px dashed var(--chat-warn-line); }
.request-card--untrusted { background: var(--chat-danger-soft); border-color: var(--chat-danger-line); }
.request-card--paid { border-color: var(--brand-accent); }
.request-card--declined,
.request-card--cancelled,
.request-card--expired { background: transparent; }
.request-card--declined .request-card__amount,
.request-card--cancelled .request-card__amount,
.request-card--expired .request-card__amount { color: var(--text-secondary); text-decoration: line-through; text-decoration-thickness: 1px; }

.request-card__label {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-secondary);
}

.request-card__label :deep(svg) { flex: 0 0 auto; margin-top: 0.15em; }

.request-card__amount {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin: 6px 0 0;
  font-size: 1.625rem;
  font-weight: 780;
  letter-spacing: -0.02em;
  line-height: 1.15;
}
.request-card__amount small {
  font-size: 0.8125rem;
  font-weight: 650;
  letter-spacing: 0;
  color: var(--text-secondary);
}

.request-card__note {
  margin: 10px 0 0;
  font-size: 0.875rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.request-card__meta,
.request-card__hint,
.request-card__reason,
.request-card__state {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 8px 0 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--text-secondary);
}
.request-card__meta :deep(svg),
.request-card__hint :deep(svg),
.request-card__reason :deep(svg),
.request-card__state :deep(svg) { flex: 0 0 auto; margin-top: 0.1em; }
.request-card__state { margin-top: 10px; font-size: 0.8125rem; font-weight: 700; }
.request-card__state--ok { color: var(--brand-accent-text); }
.request-card__reason { color: var(--color-warn); font-weight: 650; }

.request-card__actions {
  display: grid;
  grid-template-columns: 1fr 1.25fr;
  gap: 8px;
  margin-top: 12px;
}
/* Requester side: two equal quiet buttons. */
.request-card__actions--even { grid-template-columns: 1fr 1fr; }
/* An expired request has one way forward. */
.request-card__actions--single { grid-template-columns: 1fr; }

.request-btn {
  min-height: 44px;
  padding: 0 14px;
  border: 0;
  border-radius: 22px;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 750;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.request-btn--pay { background: var(--chat-pay-bg); color: var(--chat-pay-fg); }
.request-btn--quiet { background: var(--bg-input); color: var(--text-primary); }
.request-btn--outline { background: transparent; color: var(--text-primary); border: 1.5px solid var(--border-card); }
.request-btn:disabled { opacity: 0.45; cursor: default; }
.request-btn[aria-disabled='true'] { opacity: 0.45; cursor: not-allowed; }
.request-btn:active:not(:disabled):not([aria-disabled='true']) { transform: scale(0.98); }
.request-btn:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .request-btn:active:not(:disabled) { transform: none; }
}
</style>
