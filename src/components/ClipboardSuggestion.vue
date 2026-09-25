<template>
  <!-- Anchored right under the home toolbar, whatever height that toolbar
       takes, and laid over the content instead of pushing it: the offer is
       transient, the balance below it should not jump. -->
  <div class="clipboard-strip-anchor">
    <transition name="clipboard-strip">
      <div
        v-if="offered"
        class="clipboard-strip"
        :class="{ 'is-busy': busy }"
        role="status"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerEnd"
        @pointercancel="onPointerEnd"
      >
        <span class="clipboard-strip-copy">
          <!-- Once tapped, this strip IS the progress: the destination is
               resolved behind it and the confirm sheet is the next thing
               the user sees. No sheet opens in between to show a spinner. -->
          <span class="clipboard-strip-label">{{ busy ? $t('Fetching…') : $t(labelKey) }}</span>
          <span class="clipboard-strip-value">{{ abbreviated }}</span>
        </span>
        <button v-if="!busy" type="button" class="clipboard-strip-use" @click="use">{{ $t(actionKey) }}</button>
        <span v-else class="clipboard-strip-spinner" aria-hidden="true"></span>
        <!-- The countdown is the dismissal: when the bar reaches zero the
             strip leaves. A finger resting on the strip pauses it. While
             resolving it gives way to an indeterminate bar — the offer is
             no longer expiring, it is working. -->
        <span
          v-if="!busy"
          class="clipboard-strip-timer"
          :class="{ 'is-held': held }"
          :style="{ animationDuration: `${OFFER_MS}ms` }"
          aria-hidden="true"
          @animationend="dismiss"
        ></span>
        <span v-else class="clipboard-strip-progress" aria-hidden="true"></span>
      </div>
    </transition>
  </div>
</template>

<script>
import { offerActionKey } from '../utils/clipboardSuggestion.js';
import { ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { useWalletStore } from '../stores/wallet';
import { readClipboardForSuggestion } from '../utils/shopClipboard.js';
import { createClipboardOfferSession } from '../utils/clipboardOfferSession.js';
import {
  abbreviateDestination,
  createClipboardOfferMemory,
  isSuggestibleDestination,
  offerLabelKey,
} from '../utils/clipboardSuggestion.js';

/** How long an offer stays before it leaves on its own. */
const OFFER_MS = 10000;
/** Belt to the countdown's braces: if the bar never reports its end, leave anyway. */
const OFFER_FALLBACK_MS = OFFER_MS * 2;
/** Upward drag that dismisses the suggestion. */
const SWIPE_DISMISS_PX = 28;

const memory = createClipboardOfferMemory();
const session = createClipboardOfferSession({ read: readClipboardForSuggestion });
let returnListener = null;

// Listen across route changes; only the current Home can display a suggestion.
function ensureReturnListener() {
  if (!returnListener) {
    returnListener = App.addListener('appStateChange', ({ isActive }) => session.setActive(isActive))
      .catch(() => { returnListener = null; });
  }
}

/**
 * The home screen's clipboard offer.
 *
 * Once on start and once per return to the app, read the clipboard and,
 * if it holds a supported destination or address request, offer the
 * corresponding Send, Open, or Review action with a countdown. Use hands
 * the text to the matching flow; nothing advances on its own.
 *
 * Use does not dismiss the strip — the parent resolves the destination
 * with the sheet still down and holds `busy` while it does, so the strip
 * shows the wait in place and the confirm sheet is the only surface that
 * arrives. The strip leaves when that sheet opens (the dialog observer
 * below) or when `busy` clears.
 *
 * Android only: iOS uses explicit Paste to avoid unsolicited permission
 * prompts; on the web the Send sheet's own chip covers this. Reads happen
 * only on the home screen, while no sheet or dialog is in front, and never
 * while the app lock is up. The same clipboard content is offered once:
 * used or dismissed, it is not offered again until it changes, and that
 * memory is kept on disk so a restart does not repeat the offer.
 */
export default {
  name: 'ClipboardSuggestion',

  inject: {
    // Provided by the app shell while the lock overlay is up.
    appLocked: { default: () => ref(false) },
  },

  props: {
    // True while the parent resolves the destination this strip handed it.
    // Freezes the countdown and turns the strip into its own progress.
    busy: { type: Boolean, default: false },
  },

  emits: ['use'],

  setup() {
    return { wallet: useWalletStore() };
  },

  data() {
    return {
      offered: null,
      held: false,
      pointerStartY: null,
      homeVisible: false,
      dialogObserver: null,
      fallbackTimer: null,
      OFFER_MS,
    };
  },

  computed: {
    abbreviated() {
      return abbreviateDestination(this.offered);
    },
    actionKey() { return offerActionKey(this.offered, this.wallet.activeWalletType); },
    labelKey() {
      return offerLabelKey(this.offered, this.wallet.activeWalletType);
    },
  },

  watch: {
    // Resolving takes the offer out of its countdown: it is no longer an
    // expiring suggestion, it is work in progress. When the parent is done
    // the strip has served its purpose either way — the confirm sheet is up
    // (the dialog observer has already cleared it) or the Send sheet took
    // the string over — so it leaves.
    busy(now) {
      if (now) {
        clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
        this.held = false;
        this.pointerStartY = null;
      } else {
        this.clear();
      }
    },
  },

  mounted() {
    if (Capacitor.getPlatform() !== 'android') return;
    this.homeVisible = true;
    // Options API automatically unwraps injected refs.
    this.$watch(() => this.appLocked, (locked) => {
      if (locked) this.clear();
      else this.check();
    });
    this.dialogObserver = new MutationObserver(() => {
      if (document.body.classList.contains('q-body--dialog')) this.clear();
      else this.check();
    });
    this.dialogObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('focus', this.check);
    ensureReturnListener();
    session.attach(this);
  },

  beforeUnmount() {
    this.homeVisible = false;
    session.detach(this);
    this.dialogObserver?.disconnect();
    window.removeEventListener('focus', this.check);
    this.clear();
  },

  methods: {
    canOffer() {
      return this.homeVisible && !this.appLocked && document.hasFocus()
        && !document.body.classList.contains('q-body--dialog');
    },

    check() {
      return session.check();
    },

    async offer(text, stillVisible = () => this.canOffer()) {
      if (!stillVisible()) return false;
      const value = text.trim();
      memory.observe(value);
      if (this.offered && this.offered !== value) this.clear();
      if (!value || memory.hasBeenOffered(value)
        || !isSuggestibleDestination(value, this.wallet.activeWalletType)) return true;

      this.clear();
      this.offered = value;
      await this.$nextTick();
      // Navigation, locking or a new dialog can interrupt the render.
      if (!stillVisible() || this.offered !== value) {
        this.clear();
        return false;
      }
      memory.rememberOffered(value);
      this.fallbackTimer = setTimeout(() => this.dismiss(), OFFER_FALLBACK_MS);
      return true;
    },

    // Hand the destination over and stay: the parent resolves it behind
    // this strip and flips `busy`, so the wait is shown here instead of in
    // a sheet that only exists to be left again.
    use() {
      if (this.busy || !this.offered) return;
      this.$emit('use', this.offered);
    },

    // The countdown reaching zero, or a swipe. Never while resolving: the
    // offer stopped being an offer the moment it was used.
    dismiss() {
      if (this.busy) return;
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
      // A resolve in flight cannot be paused or swiped away — it owns the
      // strip until it settles.
      if (this.busy) return;
      this.held = true;
      this.pointerStartY = event.clientY;
    },

    onPointerMove(event) {
      if (this.busy || this.pointerStartY === null) return;
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

/* Nothing to tap while it resolves — the strip is a status line now. */
.clipboard-strip.is-busy {
  pointer-events: none;
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
  min-height: 44px;
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

/* Resolving: the Use button's footprint, holding a spinner instead. Same
   box, so nothing in the strip shifts when the tap lands. */
.clipboard-strip-spinner {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin: 11px 29px;
  border-radius: 50%;
  border: 2px solid var(--border-card);
  border-top-color: var(--brand-accent);
  animation: clipboard-strip-spin 0.7s linear infinite;
}

.body--light .clipboard-strip-spinner {
  border-top-color: var(--btn-neutral-bg);
}

@keyframes clipboard-strip-spin {
  to { transform: rotate(360deg); }
}

/* Indeterminate stand-in for the countdown while the destination resolves:
   the strip is working, not expiring. */
.clipboard-strip-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 3px;
  overflow: hidden;
}

.clipboard-strip-progress::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 40%;
  background: var(--brand-accent);
  animation: clipboard-strip-sweep 1.1s ease-in-out infinite;
}

@keyframes clipboard-strip-sweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
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
  .clipboard-strip-spinner { animation-duration: 2s; }
  .clipboard-strip-progress::after { animation: none; width: 100%; opacity: 0.5; }
  .clipboard-strip-enter-active,
  .clipboard-strip-leave-active { transition: none; }
}
</style>
