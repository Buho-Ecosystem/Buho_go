<!--
  CardPinPanel
  The card's PIN, asked for in place: inside the redeem sheet in the wallet,
  on the pay screen at the kiosk. It never opens a screen of its own, so the
  card, the amount and where the money goes stay in view while the PIN is
  typed (LUD-XX pinLimit: the amount must be on the PIN screen).

  The fourth digit hands the PIN to the parent; there is no separate
  confirm. The digits leave component state in the same tick. While the
  parent checks the PIN (`loading`) the dots pulse and the pad rests; a
  wrong PIN (`errorMessage`) shakes the dots and clears them.

  Presentational: WithdrawAuthorization owns the attempts and the callback.
-->
<template>
  <div class="card-pin" :class="$q.dark.isActive ? 'card-pin--dark' : 'card-pin--light'">
    <div class="card-pin-summary">
      <img v-if="cardLogo && !logoFailed" :src="cardLogo" alt="" class="card-pin-logo" @error="logoFailed = true" />
      <div class="card-pin-card">
        <div class="card-pin-name">{{ cardName }}</div>
        <div v-if="cardHost" class="card-pin-host">{{ cardHost }}</div>
      </div>
      <div class="card-pin-amount">
        <div class="card-pin-sats">{{ amountDisplay }}</div>
        <div v-if="fiatAmount" class="card-pin-fiat">{{ fiatAmount }}</div>
      </div>
    </div>
    <div v-if="destination" class="card-pin-destination">{{ destination }}</div>

    <div class="card-pin-prompt" :id="promptId">{{ prompt }}</div>

    <div
      class="card-pin-dots"
      :class="{ 'card-pin-dots--error': shaking, 'card-pin-dots--checking': loading }"
      role="img"
      :aria-label="$t('{n} of {total} digits entered', { n: loading ? length : pin.length, total: length })"
    >
      <i v-for="i in length" :key="i" :class="{ filled: loading || pin.length >= i }"></i>
    </div>

    <div class="card-pin-message" role="status" aria-live="polite">
      <span v-if="loading" class="card-pin-checking"><q-spinner size="14px" />{{ loadingText }}</span>
      <template v-else-if="errorMessage">
        <span class="card-pin-error">{{ errorMessage }}</span>
        <span v-if="errorDetail" class="card-pin-error-detail">{{ errorDetail }}</span>
      </template>
    </div>

    <div class="card-pin-pad" :class="{ 'card-pin-pad--resting': loading }" :aria-labelledby="promptId" role="group">
      <template v-for="key in keys" :key="key || 'blank'">
        <span v-if="!key" class="card-pin-key card-pin-key--blank"></span>
        <button
          v-else
          type="button"
          class="card-pin-key"
          :class="{ 'card-pin-key--action': key === 'del', 'card-pin-key--pressed': pressed === key }"
          :disabled="loading"
          :aria-label="key === 'del' ? $t('Delete') : key"
          @pointerdown="pressed = key"
          @pointerup="pressed = null"
          @pointerleave="pressed = null"
          @click="press(key)"
        >
          <Icon v-if="key === 'del'" icon="tabler:backspace" width="24" height="24" />
          <span v-else>{{ key }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<script>
import { haptics } from '../utils/haptics.js'

export default {
  name: 'CardPinPanel',
  props: {
    amountDisplay: { type: String, required: true },
    fiatAmount: { type: String, default: '' },
    cardName: { type: String, default: 'Bolt Card' },
    cardHost: { type: String, default: '' },
    cardLogo: { type: String, default: '/Social_Wallet_logos/BoltCard.png' },
    /** "Into Main" in the wallet; empty at the kiosk, where the header names the shop. */
    destination: { type: String, default: '' },
    prompt: { type: String, required: true },
    errorMessage: { type: String, default: '' },
    errorDetail: { type: String, default: '' },
    loading: { type: Boolean, default: false },
    loadingText: { type: String, default: '' },
    length: { type: Number, default: 4 },
    /** Idle seconds before `timeout` (0 = never). Paused while loading. */
    timeoutSeconds: { type: Number, default: 0 },
  },
  emits: ['pin-complete', 'timeout'],
  data() {
    return { pin: '', shaking: false, pressed: null, logoFailed: false, idleTimer: null, shakeTimer: null }
  },
  computed: {
    keys() { return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] },
    promptId() { return `card-pin-prompt-${this.$.uid}` },
  },
  watch: {
    errorMessage(message) {
      if (!message) return
      // The digits of the rejected PIN go at once; the shake shows why.
      this.pin = ''
      this.shaking = true
      haptics.error()
      clearTimeout(this.shakeTimer)
      this.shakeTimer = setTimeout(() => { this.shaking = false }, 500)
    },
    loading() { this.armIdle() },
  },
  mounted() {
    window.addEventListener('keydown', this.onKey)
    this.armIdle()
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onKey)
    clearTimeout(this.idleTimer)
    clearTimeout(this.shakeTimer)
    this.pin = ''
  },
  methods: {
    press(key) {
      if (this.loading) return
      haptics.tap()
      if (key === 'del') this.pin = this.pin.slice(0, -1)
      else if (this.pin.length < this.length) this.pin += key
      this.armIdle()
      if (this.pin.length === this.length) {
        // Hand the PIN over and drop our copy in the same tick.
        const pin = this.pin
        this.pin = ''
        this.$emit('pin-complete', pin)
      }
    },
    /** A hardware keyboard types the PIN too (tablets at a counter, desktop). */
    onKey(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (/^[0-9]$/.test(event.key)) { event.preventDefault(); this.press(event.key) }
      else if (event.key === 'Backspace') { event.preventDefault(); this.press('del') }
    },
    armIdle() {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
      if (this.timeoutSeconds > 0 && !this.loading) {
        this.idleTimer = setTimeout(() => this.$emit('timeout'), this.timeoutSeconds * 1000)
      }
    },
  },
}
</script>

<style scoped>
.card-pin {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  font-family: 'Manrope', sans-serif;
  color: var(--text-primary);
  width: 100%;
}

.card-pin-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--bg-input);
}
.card-pin-logo { width: 36px; height: 36px; border-radius: 50%; flex: none; }
.card-pin-card { min-width: 0; flex: 1; text-align: left; }
.card-pin-name { font-weight: 700; font-size: 15px; }
.card-pin-host { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-pin-amount { text-align: right; flex: none; }
.card-pin-sats { font-weight: 800; font-size: 16px; letter-spacing: -0.01em; }
.card-pin-fiat { font-size: 12px; color: var(--text-muted); }

.card-pin-destination {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  margin-top: 10px;
}

.card-pin-prompt {
  text-align: center;
  font-weight: 700;
  font-size: 17px;
  margin-top: 22px;
}

.card-pin-dots { display: flex; justify-content: center; gap: 20px; margin: 16px 0 8px; }
.card-pin-dots i {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.6px solid var(--text-muted);
  display: block;
  transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
}
.card-pin-dots i.filled { background: var(--text-primary); border-color: var(--text-primary); transform: scale(1.06); }
.card-pin-dots--error { animation: card-pin-shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
.card-pin-dots--error i { border-color: var(--color-red); }
.card-pin-dots--checking i.filled { animation: card-pin-pulse 1s ease-in-out infinite; }
.card-pin-dots--checking i:nth-child(2) { animation-delay: 0.12s; }
.card-pin-dots--checking i:nth-child(3) { animation-delay: 0.24s; }
.card-pin-dots--checking i:nth-child(4) { animation-delay: 0.36s; }

.card-pin-message {
  min-height: 38px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  font-size: 13px;
  line-height: 1.4;
}
.card-pin-checking { display: inline-flex; align-items: center; gap: 8px; color: var(--text-secondary); font-weight: 600; }
.card-pin-error { color: var(--color-red); font-weight: 600; }
.card-pin-error-detail { color: var(--text-muted); }

.card-pin-pad {
  display: grid;
  grid-template-columns: repeat(3, 68px);
  gap: 12px 26px;
  justify-content: center;
  margin-top: 4px;
  transition: opacity 0.25s ease;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}
.card-pin-pad--resting { opacity: 0.35; }

.card-pin-key {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  border: none;
  display: grid;
  place-items: center;
  font-family: 'Manrope', sans-serif;
  font-size: 28px;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--bg-input);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.08s ease, transform 0.08s ease;
}
.card-pin--dark .card-pin-key { background: rgba(255, 255, 255, 0.08); }
.card-pin-key--pressed { transform: scale(0.94); background: var(--border-card); }
.card-pin--dark .card-pin-key--pressed { background: rgba(255, 255, 255, 0.18); }
.card-pin-key--action, .card-pin--dark .card-pin-key--action { background: transparent; color: var(--text-secondary); }
.card-pin-key--blank, .card-pin--dark .card-pin-key--blank { background: transparent; }
.card-pin-key:disabled { cursor: default; }
.card-pin-key:focus-visible { outline: 2px solid var(--brand-accent, #059573); outline-offset: 2px; }

@media (max-height: 700px) {
  .card-pin-prompt { margin-top: 12px; }
  .card-pin-pad { grid-template-columns: repeat(3, 60px); gap: 8px 24px; }
  .card-pin-key { width: 60px; height: 60px; font-size: 25px; }
}

@keyframes card-pin-shake {
  20% { transform: translateX(-9px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-6px); }
  80% { transform: translateX(5px); }
}
@keyframes card-pin-pulse { 50% { opacity: 0.3; } }

@media (prefers-reduced-motion: reduce) {
  .card-pin-dots--error, .card-pin-dots--checking i.filled { animation: none; }
}
</style>
