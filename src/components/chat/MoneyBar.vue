<!--
  MoneyBar
  The bottom bar of the thread. Money first, text second:

      money mode   [ ↙ Request ] [ ↗ Send ] [ 💬 ]
      text mode    [ ₿ ] <default slot: the Composer>

  `v-model` is the mode ('money' | 'text'). The 💬 button only exists while the
  partner can receive messages (`canMessage`); without it the bar is just the
  two money buttons ("Payments only"). The text-mode content is a slot, so the
  bar knows nothing about the composer.

  Request / Send keep the home screen's colours in dark mode (green / blue
  tint) and the neutral pair in light mode (see Wallet.vue).
-->
<template>
  <div class="money-bar" :class="{ 'money-bar--text': isText }">
    <template v-if="!isText">
      <button type="button" class="money-btn money-btn--request" :disabled="requestDisabled" @click="$emit('request')">
        <Icon icon="tabler:arrow-down-left" width="20" height="20" />
        <span>{{ $t('Request') }}</span>
      </button>
      <button type="button" class="money-btn money-btn--send" :disabled="sendDisabled" @click="$emit('send')">
        <Icon icon="tabler:arrow-up-right" width="20" height="20" />
        <span>{{ $t('Send') }}</span>
      </button>
      <button
        v-if="canMessage"
        type="button"
        class="money-switch"
        :aria-label="$t('Write a message')"
        @click="setMode('text')"
      >
        <Icon icon="tabler:message" width="22" height="22" />
      </button>
    </template>

    <template v-else>
      <button type="button" class="money-switch" :aria-label="$t('Back to payments')" @click="setMode('money')">
        <Icon icon="tabler:currency-bitcoin" width="22" height="22" />
      </button>
      <div class="money-bar__slot"><slot /></div>
    </template>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue'
import './chatTokens.css'

export default {
  name: 'MoneyBar',
  components: { Icon },
  props: {
    /** 'money' | 'text' */
    modelValue: {
      type: String,
      default: 'money',
      validator: (value) => value === 'money' || value === 'text'
    },
    /** False when the partner has no DM inbox: no way to switch to text. */
    canMessage: { type: Boolean, default: true },
    requestDisabled: { type: Boolean, default: false },
    sendDisabled: { type: Boolean, default: false }
  },
  emits: ['update:modelValue', 'request', 'send'],
  computed: {
    /** Text mode is only honoured while messaging is possible. */
    isText() {
      return this.modelValue === 'text' && this.canMessage
    }
  },
  methods: {
    setMode(mode) {
      this.$emit('update:modelValue', mode)
    }
  }
}
</script>

<style scoped>
.money-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px max(14px, var(--safe-bottom, 0px));
  background: var(--bg-primary);
  border-top: 1px solid var(--border-card);
  font-family: 'Manrope', sans-serif;
}

.money-btn {
  flex: 1;
  min-height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
  border-radius: var(--radius-md);
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}
.money-btn:active:not(:disabled) { transform: scale(0.97); }
.money-btn:disabled { opacity: 0.45; cursor: default; }
.money-btn--request {
  background: var(--chat-request-bg);
  color: var(--chat-request-fg);
  border: 1px solid var(--chat-request-border);
}
.money-btn--send {
  background: var(--chat-send-bg);
  color: var(--chat-send-fg);
  border: 1px solid var(--chat-send-border);
}

/* Text mode: the composer can grow upward (reply preview, warning), the switch stays on the field's row. */
.money-bar--text { align-items: flex-end; }
.money-bar--text .money-switch { width: 44px; height: 44px; border-radius: 22px; }

.money-switch {
  flex: 0 0 auto;
  width: 50px;
  height: 50px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.money-bar__slot { flex: 1; min-width: 0; }

.money-btn:focus-visible,
.money-switch:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .money-btn { transition: none; }
  .money-btn:active:not(:disabled) { transform: none; }
}
</style>
