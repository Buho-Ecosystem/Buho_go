/**
 * BIP-39 mnemonic input composable.
 *
 * The shared core of the "type your 12-word recovery phrase" UI that
 * powers both the Spark wallet restore page and the identity restore
 * dialog. Owns the word grid state, the suggestion strip, the focus
 * choreography, and the paste handler, so every place we ask the user
 * to type a seed phrase looks and behaves identically.
 *
 * Behaviour:
 *   - One reactive `inputWords` array with `wordCount` slots.
 *   - One shared suggestion strip per surface (NOT per input) — pinned
 *     above the grid so the mobile keyboard never covers it.
 *   - Suggestions are BIP-39 prefix matches; capped to keep the strip
 *     from overflowing visually and to stop a one-character prefix
 *     from rendering thousands of chips.
 *   - Keyboard nav: Enter / Tab picks the highlighted chip; arrows
 *     move the highlight; Esc closes the strip.
 *   - Paste of a full mnemonic from any slot fills the whole grid
 *     from slot 0; paste of a partial run fills forward from the
 *     pasted slot. Hard-capped at PASTE_MAX_CHARS so a pathological
 *     clipboard payload never gets tokenised.
 *   - The blur timer trick handles the touch-tap-on-chip race: a
 *     plain `mousedown.prevent` isn't enough on every Android browser.
 *
 * Security:
 *   - The composable registers an `onScopeDispose` hook that wipes
 *     `inputWords` and the input ref array on unmount. Not a hard
 *     guarantee — V8 may keep finalised copies — but it shrinks the
 *     in-memory window the seed lives in to the time the dialog is
 *     actually open.
 *
 * Usage (Options API host):
 *   setup() {
 *     const seed = useBip39Mnemonic({ wordCount: 12 });
 *     return { ...seed };
 *   }
 *
 *   <input
 *     v-model="inputWords[i]"
 *     @input="onMyInput(i)"           // host wraps to also clear errors
 *     @focus="onWordFocus(i)"
 *     @blur="onWordBlur"
 *     @paste="onWordPaste($event, i)"
 *     @keydown.enter.prevent="onWordEnter(i)"
 *     @keydown.tab="onWordTab($event, i)"
 *     @keydown.right="onWordArrowRight"
 *     @keydown.left="onWordArrowLeft"
 *     @keydown.esc="closeSuggestions"
 *     :ref="el => setWordInputRef(i, el)"
 *   />
 */

import { ref, computed, onScopeDispose, nextTick } from 'vue';
import { wordlist as BIP39_WORDLIST } from '@scure/bip39/wordlists/english';

// Membership lookups for per-word "is this a real BIP-39 word" checks.
// Host components reach for this on submit (Spark restore) or while
// validating (anywhere that needs precise feedback per slot).
export const BIP39_WORDSET = new Set(BIP39_WORDLIST);
export { BIP39_WORDLIST };

export const DEFAULT_MAX_SUGGESTIONS = 8;

// Short delay on blur so tapping a suggestion chip registers before the
// strip disappears. `mousedown.prevent` alone isn't enough on touch.
export const DEFAULT_BLUR_DISMISS_MS = 120;

// Hard ceiling on raw clipboard length accepted by the paste handler.
// A valid 24-word BIP-39 phrase is <250 chars; 4 KB leaves ample
// headroom while preventing pathological clipboard payloads.
export const PASTE_MAX_CHARS = 4096;

export function useBip39Mnemonic(opts = {}) {
  const wordCount = Number.isInteger(opts.wordCount) && opts.wordCount > 0
    ? opts.wordCount
    : 12;
  const maxSuggestions = Number.isInteger(opts.maxSuggestions) && opts.maxSuggestions > 0
    ? opts.maxSuggestions
    : DEFAULT_MAX_SUGGESTIONS;
  const blurDelayMs = Number.isFinite(opts.blurDelayMs) && opts.blurDelayMs >= 0
    ? opts.blurDelayMs
    : DEFAULT_BLUR_DISMISS_MS;

  const inputWords = ref(Array(wordCount).fill(''));
  // Template refs assigned via `:ref="el => setWordInputRef(i, el)"`.
  // Held as a plain ref of arrays rather than a reactive array because
  // we never need to *react* to ref churn — we just need the latest
  // element when navigating focus.
  const wordInputRefs = ref([]);
  const activeIndex = ref(-1);
  const highlightedIndex = ref(0);

  let blurTimer = null;

  function suggestionsFor(index) {
    const prefix = (inputWords.value[index] || '').trim().toLowerCase();
    if (!prefix) return [];
    return BIP39_WORDLIST
      .filter((word) => word.startsWith(prefix))
      .slice(0, maxSuggestions);
  }

  const activeSuggestions = computed(() => {
    if (activeIndex.value < 0) return [];
    return suggestionsFor(activeIndex.value);
  });

  const showSuggestions = computed(() => {
    if (activeIndex.value < 0) return false;
    const current = (inputWords.value[activeIndex.value] || '').trim().toLowerCase();
    if (!current) return false;
    const matches = activeSuggestions.value;
    if (matches.length === 0) return false;
    // Typed value already exactly matches its sole suggestion — the
    // user is done with this slot, hiding the strip removes noise.
    if (matches.length === 1 && matches[0] === current) return false;
    return true;
  });

  const mnemonicIsComplete = computed(
    () => inputWords.value.every((w) => w.trim().length > 0),
  );

  const normalisedMnemonic = computed(
    () => inputWords.value.map((w) => w.trim().toLowerCase()).join(' '),
  );

  function setWordInputRef(index, el) {
    wordInputRefs.value[index] = el || null;
  }

  /**
   * Side-effect-free normalisation called on every keystroke. Lowercases
   * the slot (BIP-39 words are all lowercase, so this prevents stray
   * autocapitalisation on Android from breaking prefix matching) and
   * resets the highlighted chip back to the first suggestion.
   *
   * Host components typically wrap this to also clear their per-input
   * error state — e.g. `onMyInput(i) { this.normalizeWordInput(i); this.errorText = ''; }`.
   */
  function normalizeWordInput(index) {
    inputWords.value[index] = (inputWords.value[index] || '').toLowerCase();
    highlightedIndex.value = 0;
  }

  function onWordFocus(index) {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    activeIndex.value = index;
    highlightedIndex.value = 0;
  }

  function onWordBlur() {
    blurTimer = setTimeout(() => {
      activeIndex.value = -1;
      blurTimer = null;
    }, blurDelayMs);
  }

  function closeSuggestions() {
    activeIndex.value = -1;
  }

  function focusWord(index) {
    const el = wordInputRefs.value[index];
    if (el && typeof el.focus === 'function') el.focus();
  }

  function blurWord(index) {
    const el = wordInputRefs.value[index];
    if (el && typeof el.blur === 'function') el.blur();
  }

  function focusNextWord(index) {
    const next = index + 1;
    if (next < wordCount && wordInputRefs.value[next]) {
      focusWord(next);
    } else {
      blurWord(index);
    }
  }

  function pickSuggestion(word) {
    const idx = activeIndex.value;
    if (idx < 0) return;
    inputWords.value[idx] = word;
    highlightedIndex.value = 0;
    focusNextWord(idx);
  }

  function onWordEnter(index) {
    if (showSuggestions.value) {
      const pick = activeSuggestions.value[highlightedIndex.value];
      if (pick) {
        pickSuggestion(pick);
        return;
      }
    }
    focusNextWord(index);
  }

  // `_index` is accepted for call-site symmetry with onWordEnter — Tab
  // navigation itself uses the browser's native focus order, so the
  // slot index is irrelevant here.
  function onWordTab(event, _index) {
    if (showSuggestions.value && !event.shiftKey) {
      const pick = activeSuggestions.value[highlightedIndex.value];
      if (pick) {
        event.preventDefault();
        pickSuggestion(pick);
      }
    }
    // Otherwise let the browser do its thing (focusing the next input
    // for plain Tab, the previous one for Shift+Tab).
  }

  function onWordArrowRight(event) {
    if (!showSuggestions.value) return;
    event.preventDefault();
    const len = activeSuggestions.value.length;
    highlightedIndex.value = (highlightedIndex.value + 1) % len;
  }

  function onWordArrowLeft(event) {
    if (!showSuggestions.value) return;
    event.preventDefault();
    const len = activeSuggestions.value.length;
    highlightedIndex.value = (highlightedIndex.value - 1 + len) % len;
  }

  /**
   * Paste handler. If the user pastes a string that contains 2+
   * whitespace-separated tokens, fan them out across the grid:
   *   - a full `wordCount`-word phrase always fills from slot 0 so
   *     pasting into any cell does the obviously right thing;
   *   - a partial run fills forward from the pasted slot.
   * Single-word pastes fall through to the browser's native handler.
   */
  function onWordPaste(event, startIndex) {
    const raw = event.clipboardData?.getData('text') || '';
    if (!raw) return;
    const bounded = raw.slice(0, PASTE_MAX_CHARS).trim().toLowerCase();
    const tokens = bounded.split(/\s+/).filter(Boolean).slice(0, wordCount);
    if (tokens.length <= 1) return;

    event.preventDefault();
    const base = tokens.length >= wordCount ? 0 : startIndex;
    const limit = Math.min(tokens.length, wordCount - base);
    for (let i = 0; i < limit; i += 1) {
      inputWords.value[base + i] = tokens[i];
    }
    activeIndex.value = -1;

    // After a paste, drop focus into the next empty cell (or off the
    // grid entirely when the paste filled the last slot) so the user
    // can continue typing without an extra tap.
    const lastFilled = Math.min(base + limit - 1, wordCount - 1);
    nextTick(() => {
      const next = lastFilled + 1;
      if (next < wordCount && wordInputRefs.value[next]) {
        focusWord(next);
      } else {
        blurWord(lastFilled);
      }
    });
  }

  /** Membership check against the official BIP-39 English wordlist. */
  function isValidBip39Word(word) {
    return BIP39_WORDSET.has((word || '').trim().toLowerCase());
  }

  /** Clear the grid and dismiss the strip. Host calls this when
   *  reopening the dialog or after a successful submit. */
  function resetMnemonic() {
    inputWords.value = Array(wordCount).fill('');
    activeIndex.value = -1;
    highlightedIndex.value = 0;
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
  }

  // Defense-in-depth: wipe the in-memory seed words when the host
  // component is destroyed so they don't linger in the closure until
  // GC. Not a hard guarantee (V8 may hold finalised copies), but
  // shrinks the obvious surface.
  onScopeDispose(() => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    inputWords.value = Array(wordCount).fill('');
    wordInputRefs.value = [];
  });

  return {
    // State
    inputWords,
    wordInputRefs,
    activeIndex,
    highlightedIndex,
    // Computed
    activeSuggestions,
    showSuggestions,
    mnemonicIsComplete,
    normalisedMnemonic,
    // Methods
    setWordInputRef,
    normalizeWordInput,
    onWordFocus,
    onWordBlur,
    closeSuggestions,
    pickSuggestion,
    focusNextWord,
    onWordEnter,
    onWordTab,
    onWordArrowRight,
    onWordArrowLeft,
    onWordPaste,
    isValidBip39Word,
    resetMnemonic,
  };
}
