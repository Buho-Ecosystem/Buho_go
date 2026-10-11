<!--
  MoneyBar
  The bottom of the thread. Money first, text second, and no modes (HIG):

      [ message field                       ]   only while the partner can receive messages
      [ ↙ Request ]  [ ↗ Send ]                 always

  The message field is the default slot (the Composer), so the bar knows
  nothing about it. Without it ("Payments only") the bar is the two money
  buttons. Request / Send are the quiet pair: a filled button on the screen
  belongs to the one thing waiting for the person (a request's Pay).
  A disabled money button never stands there unexplained: `disabledHint`
  says why, right above the buttons, and the buttons point to it.
-->
<template>
  <div class="money-bar">
    <div v-if="canMessage" class="money-bar__composer"><slot /></div>
    <p v-if="disabledHint" :id="hintId" class="money-bar__hint">{{ disabledHint }}</p>
    <div class="money-bar__actions">
      <button
        type="button"
        class="money-btn money-btn--request"
        :disabled="requestDisabled"
        :aria-describedby="requestDisabled && disabledHint ? hintId : undefined"
        @click="$emit('request')"
      >
        <Icon icon="tabler:arrow-down-left" width="20" height="20" />
        <span>{{ $t('Request') }}</span>
      </button>
      <button
        type="button"
        class="money-btn money-btn--send"
        :disabled="sendDisabled"
        :aria-describedby="sendDisabled && disabledHint ? hintId : undefined"
        @click="$emit('send')"
      >
        <Icon icon="tabler:arrow-up-right" width="20" height="20" />
        <span>{{ $t('Send') }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue'
import './chatTokens.css'

export default {
  name: 'MoneyBar',
  components: { Icon },
  props: {
    /** False when the partner has no DM inbox: no message field, just the money buttons. */
    canMessage: { type: Boolean, default: true },
    requestDisabled: { type: Boolean, default: false },
    sendDisabled: { type: Boolean, default: false },
    /** Why a money button is disabled, already translated. */
    disabledHint: { type: String, default: '' }
  },
  emits: ['request', 'send'],
  computed: {
    hintId() { return `money-bar-hint-${this.$.uid}` }
  }
}
</script>

<style scoped>
.money-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px max(14px, var(--safe-bottom, 0px));
  background: var(--bg-primary);
  border-top: 1px solid var(--border-card);
  font-family: 'Manrope', sans-serif;
}

.money-bar__hint {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-secondary);
  text-align: center;
}

.money-bar__actions {
  display: flex;
  gap: 8px;
}

.money-btn {
  flex: 1;
  min-height: 48px;
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
.money-btn:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .money-btn { transition: none; }
  .money-btn:active:not(:disabled) { transform: none; }
}
</style>
