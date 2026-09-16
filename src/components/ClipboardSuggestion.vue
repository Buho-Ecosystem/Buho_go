<template>
  <!-- Anchored right under the home toolbar, whatever height that toolbar
       takes, and laid over the content instead of pushing it: the offer is
       transient, the balance below it should not jump. -->
  <div class="clipboard-strip-anchor">
    <transition name="clipboard-strip">
      <div
        v-if="offered"
        class="clipboard-strip"
        role="status"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerEnd"
        @pointercancel="onPointerEnd"
      >
        <span class="clipboard-strip-copy">
          <span class="clipboard-strip-label">{{ $t('Found in your clipboard') }}</span>
          <span class="clipboard-strip-value">{{ abbreviated }}</span>
        </span>
        <button type="button" class="clipboard-strip-use" @click="use">{{ $t('Use') }}</button>
        <!-- The countdown is the dismissal: when the bar reaches zero the
             strip leaves. A finger resting on the strip pauses it. -->
        <span
          class="clipboard-strip-timer"
          :class="{ 'is-held': held }"
          :style="{ animationDuration: `${OFFER_MS}ms` }"
          aria-hidden="true"
          @animationend="dismiss"
        ></span>
      </div>
    </transition>
  </div>
</template>

<script>
import { ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { useWalletStore } from '../stores/wallet';
import { readClipboardCrossPlatform } from '../utils/shopClipboard.js';
import { abbreviateDestination, isSuggestibleDestination } from '../utils/clipboardSuggestion.js';

/** How long an offer stays before it leaves on its own. */
const OFFER_MS = 10000;
/** Belt to the countdown's braces: if the bar never reports its end, leave anyway. */
const OFFER_FALLBACK_MS = OFFER_MS * 2;
/** A shorter absence is a system dialog closing (unlock, paste consent), not a return to the app. */
const MIN_ABSENCE_MS = 1500;
/** Android hands the clipboard only to the focused window, which lags the resume event by a beat. */
const READ_DELAY_MS = 350;
const READ_RETRY_MS = 900;
/** Upward drag that counts as "get rid of it". */
const SWIPE_DISMISS_PX = 28;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The home screen's clipboard offer.
 *
 * Once per return to the app, and once on start, read the clipboard and,
 * if it holds something this wallet can pay, show it with a Use button and
 * a countdown. Use hands the text to the Send sheet exactly as a paste
 * would; nothing advances on its own.
 *
 * Native only: on the web the Send sheet's own chip covers this, and a
 * programmatic read there needs a permission prompt. Reads happen only on
 * the home screen, only while no sheet or dialog is in front, and never
 * while the app lock is up. The same clipboard content is offered once:
 * used or dismissed, it is not offered again until it changes.
 */
export default {
  name: 'ClipboardSuggestion',

  inject: {
    // Provided by the app shell while the lock overlay is up.
    appLocked: { default: () => ref(false) },
  },

  emits: ['use'],

  setup() {
    return { wallet: useWalletStore() };
  },

  data() {
    return {
      offered: null,
      lastOffered: '',
      held: false,
      pointerStartY: null,
      inactiveSince: 0,
      pendingCheck: false,
      stateListener: null,
      fallbackTimer: null,
      OFFER_MS,
    };
  },

  computed: {
    abbreviated() {
      return abbreviateDestination(this.offered);
    },
  },

  async mounted() {
    if (!Capacitor.isNativePlatform()) return;
    // A read that was waiting for the lock runs as soon as it clears.
    this.$watch(() => this.appLocked.value, (locked) => {
      if (!locked && this.pendingCheck) this.check();
    });
    const { App } = await import('@capacitor/app');
    this.stateListener = await App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        this.inactiveSince = Date.now();
        return;
      }
      if (this.inactiveSince && Date.now() - this.inactiveSince >= MIN_ABSENCE_MS) this.check();
    });
    this.check();
  },

  beforeUnmount() {
    this.stateListener?.remove();
    clearTimeout(this.fallbackTimer);
  },

  methods: {
    async check() {
      if (this.appLocked.value) {
        this.pendingCheck = true;
        return;
      }
      this.pendingCheck = false;
      // A sheet or dialog in front means the user is mid-task; an offer
      // behind it would only confuse, and the read would still cost the
      // system's clipboard notice.
      if (document.body.classList.contains('q-body--dialog')) return;
      this.offer(await this.readWhenFocused());
    },

    async readWhenFocused() {
      await wait(READ_DELAY_MS);
      let text = (await readClipboardCrossPlatform() || '').trim();
      if (!text) {
        await wait(READ_RETRY_MS);
        text = (await readClipboardCrossPlatform() || '').trim();
      }
      return text;
    },

    /** Show `text` if it is new and payable. Public, so a test can offer without a clipboard. */
    offer(text) {
      const value = (text || '').trim();
      if (!value || value === this.lastOffered) return;
      if (!isSuggestibleDestination(value, this.wallet.activeWalletType)) return;
      this.lastOffered = value;
      this.held = false;
      this.offered = value;
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = setTimeout(() => this.dismiss(), OFFER_FALLBACK_MS);
    },

    use() {
      const value = this.offered;
      this.clear();
      this.$emit('use', value);
    },

    dismiss() {
      this.clear();
    },

    clear() {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
      this.offered = null;
      this.held = false;
      this.pointerStartY = null;
    },

    onPointerDown(event) {
      this.held = true;
      this.pointerStartY = event.clientY;
    },

    onPointerMove(event) {
      if (this.pointerStartY === null) return;
      if (this.pointerStartY - event.clientY > SWIPE_DISMISS_PX) this.dismiss();
    },

    onPointerEnd() {
      this.held = false;
      this.pointerStartY = null;
    },
  },
};
</script>

<style scoped>
.clipboard-strip-anchor {
  position: relative;
  height: 0;
  z-index: 1900;
}

.clipboard-strip {
  position: absolute;
  top: 8px;
  left: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px 15px 16px;
  border-radius: 18px;
  border: 1px solid var(--border-card);
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 18px 40px -20px rgba(0, 0, 0, 0.6);
  font-family: 'Manrope', sans-serif;
  overflow: hidden;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}

.clipboard-strip-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.clipboard-strip-label {
  font-size: 13.5px;
  font-weight: 650;
  line-height: 1.3;
}

.clipboard-strip-value {
  font: 12px/1.35 var(--font-mono);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.clipboard-strip-use {
  flex-shrink: 0;
  min-height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background: var(--brand-accent);
  color: #061c12;
  font: 700 15px/1 'Manrope', sans-serif;
  cursor: pointer;
}

.body--light .clipboard-strip-use {
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
}

.clipboard-strip-use:active {
  opacity: 0.85;
}

.clipboard-strip-use:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 2px;
}

.clipboard-strip-timer {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 3px;
  background: var(--brand-accent);
  transform-origin: left;
  animation: clipboard-strip-countdown linear both;
}

.clipboard-strip-timer.is-held {
  animation-play-state: paused;
}

@keyframes clipboard-strip-countdown {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}

.clipboard-strip-enter-active,
.clipboard-strip-leave-active {
  transition: transform 0.32s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.32s ease;
}

.clipboard-strip-enter-from,
.clipboard-strip-leave-to {
  transform: translateY(-16px);
  opacity: 0;
}

/* Without motion the bar cannot count down, so the JS fallback timer is
   what ends the offer. */
@media (prefers-reduced-motion: reduce) {
  .clipboard-strip-timer { animation: none; }
  .clipboard-strip-enter-active,
  .clipboard-strip-leave-active { transition: none; }
}
</style>
