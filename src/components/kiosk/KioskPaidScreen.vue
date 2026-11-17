<template>
  <!-- A paid sale fills the screen in green, to be read from across the
       counter. It grows out of the payment code and goes back to the register
       on its own after a short while, or at a tap anywhere. -->
  <div
    class="kiosk-paid"
    :class="{ 'kiosk-paid--dark': dark }"
    @pointerdown.capture="pressed"
    @click="tapAnywhere"
  >
    <div ref="flood" class="kiosk-paid__flood" aria-hidden="true">
      <span v-if="growsFromCode" class="kiosk-paid__veil" />
      <span class="kiosk-paid__sheen" />
    </div>
    <!-- Filled just after the screen appears: a live region that arrives
         together with its text is often not read out. -->
    <span class="kiosk-paid__announce" role="status">{{ announcement }}</span>
    <section class="kiosk-paid__body">
      <svg class="kiosk-paid__mark" viewBox="0 0 112 112" aria-hidden="true">
        <circle class="kiosk-paid__ring" cx="56" cy="56" r="53" pathLength="1" transform="rotate(-90 56 56)" />
        <path class="kiosk-paid__check" d="M35 57.5 L49.5 72 L77 43" pathLength="1" />
      </svg>
      <p class="kiosk-paid__title">{{ $t('Bitcoin received') }}</p>
      <p
        ref="amount"
        class="kiosk-paid__amount"
        :class="{ 'kiosk-paid__amount--travels': travels }"
        :style="{ '--chars': amount.length }"
      >
        {{ amount }}
      </p>
      <p v-if="secondary" class="kiosk-paid__secondary">{{ secondary }}</p>
      <p v-if="duplicate" class="kiosk-paid__alert" role="alert">
        {{ $t('More than one payment arrived for this sale. Ask the owner to review it.') }}
      </p>
    </section>
    <div class="kiosk-paid__actions">
      <button type="button" class="kiosk-paid__receipt" @click.stop="began($event) && $emit('receipt')">
        {{ $t('Receipt') }}
      </button>
      <button type="button" class="kiosk-paid__next" @click.stop="began($event) && leave()">
        <!-- Fills while the screen waits, so going back on its own is no surprise. -->
        <span
          v-if="counting"
          :key="countdown"
          class="kiosk-paid__countdown"
          :style="{ animationDuration: `${waitMs}ms` }"
          aria-hidden="true"
        />
        <span class="kiosk-paid__label">{{ $t('kiosk.newCharge') }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'

/** How long a paid sale stays on screen before the register takes the next one. */
export const KIOSK_PAID_SCREEN_MS = 10_000
/** A tap anywhere counts once the amount has landed, not while the screen still arrives. */
export const KIOSK_PAID_TAP_AFTER_MS = 800

const onScreen = () => globalThis.document?.visibilityState !== 'hidden'

export default {
  name: 'KioskPaidScreen',
  props: {
    /** The sale's amount as the customer was asked for it. */
    amount: { type: String, required: true },
    /** The Bitcoin figure under a fiat amount; empty when the amount is Bitcoin. */
    secondary: { type: String, default: '' },
    /** More than one payment arrived: the screen then stays until New charge. */
    duplicate: { type: Boolean, default: false },
    /** Something sits on top (the receipt): the screen waits until it closes. */
    paused: { type: Boolean, default: false },
    dark: { type: Boolean, default: false },
    /**
     * Where the payment code and its amount were on screen when the sale was
     * paid: `{ card, amount }`, each a box (`top`, `left`, `right`, `bottom`,
     * `width`, `height`; the amount also its `fontSize` and `color`). Null
     * when the payment screen was not showing them.
     */
    origin: { type: Object, default: null },
  },
  emits: ['done', 'receipt'],
  data() {
    return {
      waitMs: KIOSK_PAID_SCREEN_MS,
      countdown: 0,
      timer: null,
      shownAt: 0,
      pressedAt: null,
      seen: onScreen(),
      left: false,
      announcement: '',
      announceTimer: null,
      still: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    }
  },
  computed: {
    /** The wait runs only while someone can see the screen: a phone that slept through the sale shows it on waking. */
    counting() {
      return !this.duplicate && !this.paused && this.seen && !this.left
    },
    growsFromCode() {
      return !this.still && !!this.origin?.card
    },
    travels() {
      return !this.still && !!this.origin?.amount
    },
  },
  watch: {
    counting() {
      this.restartCountdown()
    },
  },
  mounted() {
    this.shownAt = Date.now()
    globalThis.document?.addEventListener('visibilitychange', this.onVisibility)
    this.systemBars(SystemBarsStyle?.Dark)
    this.grow()
    this.restartCountdown()
    this.announceTimer = setTimeout(() => {
      this.announcement = `${this.$t('Bitcoin received')} ${this.amount}`
    }, 100)
  },
  beforeUnmount() {
    clearTimeout(this.timer)
    clearTimeout(this.announceTimer)
    globalThis.document?.removeEventListener('visibilitychange', this.onVisibility)
    this.systemBars(SystemBarsStyle?.Default)
  },
  methods: {
    /** Starts the wait again from the full time, or stops it while the screen must stay. */
    restartCountdown() {
      clearTimeout(this.timer)
      this.timer = null
      if (!this.counting) return
      this.countdown += 1
      this.timer = setTimeout(() => this.leave(), this.waitMs)
    },
    onVisibility() {
      this.seen = onScreen()
    },
    pressed() {
      this.pressedAt = Date.now()
    },
    /**
     * Only a press that began on this screen counts: a finger already down
     * when the sale was paid must not end it unseen. A key press has no pointer.
     */
    began(event) {
      return event?.detail === 0 || this.pressedAt !== null
    },
    tapAnywhere(event) {
      // A second payment keeps the screen until New charge, so a stray tap cannot clear its warning.
      if (this.duplicate || !this.began(event) || this.pressedAt - this.shownAt < KIOSK_PAID_TAP_AFTER_MS) return
      this.leave()
    },
    leave() {
      this.left = true
      this.$emit('done')
    },
    /** Light status bar icons on the green; the app's usual ones once it goes. */
    systemBars(style) {
      if (style && Capacitor?.isNativePlatform?.()) SystemBars.setStyle({ style }).catch(() => {})
    },
    /** The green grows out of the payment code (or the middle), and the amount moves into place. */
    grow() {
      const flood = this.$refs.flood
      if (this.still || typeof flood?.animate !== 'function') return
      const easing = 'cubic-bezier(0.3, 0, 0.1, 1)'
      const { innerWidth: width, innerHeight: height } = window
      const card = this.origin?.card
      const shapes = card
        ? [
            `inset(${card.top}px ${width - card.right}px ${height - card.bottom}px ${card.left}px round 20px)`,
            'inset(0px 0px 0px 0px round 0px)',
          ]
        : ['circle(0px at 50% 42%)', `circle(${Math.ceil(Math.hypot(width, height))}px at 50% 42%)`]
      flood.animate(
        shapes.map(clipPath => ({ clipPath })),
        { duration: card ? 600 : 520, easing }
      )
      if (!this.travels) return
      const element = this.$refs.amount
      const from = this.origin.amount
      const to = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const scale = parseFloat(from.fontSize) / parseFloat(style.fontSize) || 1
      const dx = from.left + from.width / 2 - (to.left + to.width / 2)
      const dy = from.top + from.height / 2 - (to.top + to.height / 2)
      element.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'none' }], {
        duration: 620,
        easing,
      })
      // Its old colour while it still sits on the light screen, then white at
      // once: a fade between the two passes through grey.
      if (from.color) element.animate([{ color: from.color }, { color: from.color }], { duration: 110 })
    },
  },
}
</script>

<style scoped>
.kiosk-paid {
  --paid-flood: #046b53;
  --paid-mark: #ffffff;
  --paid-button: #ffffff;
  --paid-button-ink: #046b53;
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--safe-top, 0px) 16px max(24px, var(--safe-bottom, 0px));
  color: #ffffff;
  font-family: 'Manrope', sans-serif;
  text-align: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.kiosk-paid--dark {
  --paid-flood: #0e3b2c;
  --paid-mark: #15de72;
  --paid-button: #edeef0;
  --paid-button-ink: #0e3b2c;
}
.kiosk-paid__flood {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--paid-flood);
}
/* The white of the payment code, fading as it turns green. */
.kiosk-paid__veil {
  position: absolute;
  inset: 0;
  background: #ffffff;
  animation: kiosk-paid-out 240ms ease-out both;
}
.kiosk-paid__sheen {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 45%;
  background: linear-gradient(
    105deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.14) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  transform: translateX(-120%);
  animation: kiosk-paid-sheen 900ms cubic-bezier(0.4, 0, 0.2, 1) 1000ms both;
}
.kiosk-paid__body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 8px;
  /* Centred while it fits, scrolls from the top when it does not. */
  overflow-y: auto;
  overscroll-behavior: contain;
}
.kiosk-paid__body > :first-child {
  margin-top: auto;
}
.kiosk-paid__body > :last-child {
  margin-bottom: auto;
}
.kiosk-paid__announce {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.kiosk-paid__mark {
  width: 112px;
  height: 112px;
  flex-shrink: 0;
  animation: kiosk-paid-pop 500ms cubic-bezier(0.2, 0.9, 0.3, 1.2) 340ms both;
}
.kiosk-paid__ring,
.kiosk-paid__check {
  fill: none;
  stroke: var(--paid-mark);
  stroke-dasharray: 1;
}
.kiosk-paid__ring {
  stroke-width: 4;
  stroke-linecap: round;
  animation: kiosk-paid-draw 420ms cubic-bezier(0.4, 0, 0.2, 1) 380ms both;
}
.kiosk-paid__check {
  stroke-width: 7;
  stroke-linecap: round;
  stroke-linejoin: round;
  animation: kiosk-paid-draw 300ms cubic-bezier(0.65, 0, 0.35, 1) 620ms both;
}
.kiosk-paid__title {
  margin: 22px 0 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
  animation: kiosk-paid-rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) 560ms both;
}
.kiosk-paid__amount {
  margin: 8px 0 0;
  /* As large as fits: a long amount shrinks instead of wrapping. */
  font-size: min(64px, calc((100vw - 48px) / (var(--chars) * 0.62)));
  line-height: 1.05;
  font-weight: 800;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  animation: kiosk-paid-rise 520ms cubic-bezier(0.2, 0.8, 0.2, 1) 600ms both;
}
.kiosk-paid__amount--travels {
  animation: none;
}
.kiosk-paid__secondary {
  margin: 10px 0 0;
  font-size: 17px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.86);
  animation: kiosk-paid-rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) 720ms both;
}
.kiosk-paid__alert {
  margin: 24px 0 0;
  max-width: 320px;
  padding: 12px 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.14);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  animation: kiosk-paid-rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) 800ms both;
}
.kiosk-paid__actions {
  position: relative;
  width: 100%;
  max-width: 448px;
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
  animation: kiosk-paid-rise 480ms cubic-bezier(0.2, 0.8, 0.2, 1) 880ms both;
}
.kiosk-paid__actions button {
  font-family: inherit;
  border: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.08s ease;
}
.kiosk-paid__actions button:active {
  transform: scale(0.97);
}
.kiosk-paid__actions button:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}
.kiosk-paid__receipt {
  height: 48px;
  background: transparent;
  color: #ffffff;
  font-size: 17px;
  font-weight: 600;
}
.kiosk-paid__next {
  position: relative;
  overflow: hidden;
  height: 56px;
  border-radius: 16px;
  background: var(--paid-button);
  color: var(--paid-button-ink);
  font-size: 17px;
  font-weight: 700;
}
.kiosk-paid__countdown {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: var(--paid-button-ink);
  transform-origin: left center;
  animation: kiosk-paid-count linear both;
}
.kiosk-paid__label {
  position: relative;
}
@keyframes kiosk-paid-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
@keyframes kiosk-paid-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes kiosk-paid-pop {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  55% {
    opacity: 1;
    transform: scale(1.05);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}
/* Hidden until it starts: a round cap would show a dot while it waits. */
@keyframes kiosk-paid-draw {
  0% {
    stroke-dashoffset: 1;
    opacity: 0;
  }
  1% {
    opacity: 1;
  }
  100% {
    stroke-dashoffset: 0;
    opacity: 1;
  }
}
@keyframes kiosk-paid-rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes kiosk-paid-sheen {
  from {
    transform: translateX(-120%);
  }
  to {
    transform: translateX(260%);
  }
}
@keyframes kiosk-paid-count {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
/* Short screens, such as a phone on its side. */
@media (max-height: 600px) {
  .kiosk-paid__body {
    padding: 12px 8px;
  }
  .kiosk-paid__mark {
    width: 80px;
    height: 80px;
  }
  .kiosk-paid__title {
    margin-top: 14px;
  }
  .kiosk-paid__amount {
    font-size: min(48px, calc((100vw - 48px) / (var(--chars) * 0.62)));
  }
}
@media (max-height: 480px) {
  .kiosk-paid__body {
    padding: 8px;
  }
  .kiosk-paid__mark {
    width: 56px;
    height: 56px;
  }
  .kiosk-paid__title {
    margin-top: 8px;
  }
  .kiosk-paid__amount {
    margin-top: 4px;
    font-size: min(40px, calc((100vw - 48px) / (var(--chars) * 0.62)));
  }
  .kiosk-paid__secondary {
    margin-top: 6px;
  }
  .kiosk-paid__alert {
    max-width: 520px;
    margin-top: 12px;
  }
  .kiosk-paid__actions {
    flex-direction: row;
    align-items: center;
  }
  .kiosk-paid__receipt {
    padding: 0 20px;
  }
  .kiosk-paid__next {
    flex: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .kiosk-paid__flood,
  .kiosk-paid__mark,
  .kiosk-paid__title,
  .kiosk-paid__amount,
  .kiosk-paid__secondary,
  .kiosk-paid__alert,
  .kiosk-paid__actions {
    animation: kiosk-paid-fade 200ms ease-out both;
  }
  .kiosk-paid__ring,
  .kiosk-paid__check,
  .kiosk-paid__sheen {
    animation: none;
  }
  .kiosk-paid__sheen {
    display: none;
  }
}
</style>
