# BIP-39 Suggestion Strip — Implementation Spec

A portable spec for adding an inline, non-native BIP-39 word-suggestion UI to a 12-word seed-phrase import screen. Originally implemented in the Coinsnap wallet (Vue 3 + Quasar). This document is framework-agnostic at the concept level and includes the concrete Vue implementation for reference.

---

## 1. Goal

When a user restores a wallet by entering their 12-word BIP-39 recovery phrase, help them enter words faster and more accurately by showing live suggestions from the official BIP-39 English wordlist as they type.

The suggestion UI must be:

- **Readable** — custom, high-contrast colors (no browser-default light-grey-on-white).
- **Always on top** — not clipped, not overlapped by the mobile keyboard, not fighting z-index.
- **Uncluttered** — exactly one suggestion surface at any time, regardless of how many input slots exist.
- **Keyboard-safe on mobile** — positioned above the input so the on-screen keyboard (which rises from the bottom) does not cover it.
- **Fast to act on** — tapping a suggestion fills the current slot and advances focus to the next one automatically.

## 2. Why not native `<datalist>`

A native `<input list="...">` + `<datalist>` is the obvious first solution and what most wallets ship. It has three blocking problems:

1. **Unstyleable.** The popup is rendered by the browser/OS in a shadow DOM that CSS cannot reach. On Chrome/Android it's low-contrast grey text on white — hard to read.
2. **No z-index control.** The popup isn't part of the page's DOM tree. Native IME suggestion strips or on-screen keyboards can overlap it, and the developer can't fix it.
3. **No positioning control.** It anchors to the input and can be clipped by narrow input fields (common in a 3-column seed grid).

The fix is to implement a custom suggestion UI in your own DOM.

## 3. Design decisions

### 3.1 One shared strip, not per-input popups

A 12-word grid (typically 3 cols × 4 rows) would produce visual chaos if every focused input had its own floating popup. Instead, render **one** suggestion strip that reflects whichever input is currently focused. This mirrors mobile password-manager autofill bars — a pattern users already know.

### 3.2 Placement: above the word grid

On mobile, the on-screen keyboard slides up from the bottom of the viewport and will cover anything below the focused input. Placing the strip **above** the grid keeps it visible regardless of keyboard state. This avoids needing `window.visualViewport` math, which is inconsistent across WebViews.

### 3.3 Visibility rules (anti-clutter)

The strip is hidden when **any** of these is true:

- No input is focused.
- The focused input is empty.
- No BIP-39 words match the current prefix.
- The only match equals the typed value exactly (the user has finished that slot).
- The import flow isn't on screen (obvious).

### 3.4 Interaction model

- **Click/tap a chip** → fills current slot, advances focus to next slot.
- **Enter** → accepts the highlighted suggestion if visible; otherwise advances focus.
- **Tab** → same as Enter (forward), plus native Shift+Tab reverse behavior preserved.
- **ArrowLeft / ArrowRight** → move highlight within the strip.
- **Escape** → dismiss strip without changing input value.
- **Blur** → dismiss strip, but with a short (~120ms) delay so mouse/touch taps on a chip register before the strip disappears.

### 3.5 Paste stays untouched

If the user pastes all 12 words at once (from a password manager), split on whitespace and distribute them across the 12 slots starting from the pasted index. Suggestions auto-hide because all slots are filled.

### 3.6 Accessibility

- `role="listbox"` on the strip; `role="option"` on chips.
- `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded` on the focused input.
- `aria-selected` reflects the highlighted chip.

## 4. Visual design

```
┌──────────────────────────────────────────────┐
│  [word] [ word ] [world] [worry] [worth] …   │  ← suggestion strip (above grid)
├──────────────────────────────────────────────┤
│  ① [_____]   ② [_____]   ③ [_____]           │
│  ④ [_____]   ⑤ [_____]   ⑥ [_____]           │
│  ⑦ [_____]   ⑧ [_____]   ⑨ [_____]           │
│  ⑩ [_____]   ⑪ [_____]   ⑫ [_____]           │
└──────────────────────────────────────────────┘
         ┌─────────────────────┐
         │   on-screen kb      │  ← rises from bottom; never covers strip
         └─────────────────────┘
```

### Colors (adapt to your brand palette)

| Element | Color |
|---|---|
| Strip background | `#ffffff` |
| Strip border | `#e2e8f0` |
| Strip shadow | `0 4px 12px -4px rgba(15, 23, 42, 0.12)` |
| Chip background (idle) | `#f1f5f9` |
| Chip text | `#1e293b` |
| Chip hover bg | brand-blue @ 8% opacity |
| Chip hover text | brand-blue |
| Chip highlighted (keyboard nav) | solid brand-blue bg, white text |

### Sizing

- Chip min-height: **36 px** (mobile tap target).
- Chip padding: `0.375rem 0.75rem`.
- Font: `0.8125rem / 600 weight`.
- Strip scrolls horizontally on overflow with scroll-snap; hide scrollbars for a clean look.

## 5. Dependencies

Any BIP-39 library that exports the English wordlist. In the Coinsnap implementation:

```js
import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
```

`wordlist` is the 2048-word BIP-39 English array. Use the same wordlist reference throughout (suggestions *and* validation) so suggestions can never produce an invalid word.

## 6. Core logic (framework-agnostic pseudocode)

```
state:
  words: string[12]        // the input values
  activeIndex: number      // which input is focused, -1 if none
  highlightedIndex: number // which chip is selected for Enter/Tab

suggestionsFor(i):
  prefix = words[i].trim().toLowerCase()
  if prefix is empty: return []
  return wordlist.filter(w => w startsWith prefix).slice(0, 8)

showSuggestions:
  if activeIndex < 0: false
  current = words[activeIndex].trim().toLowerCase()
  if !current: false
  matches = suggestionsFor(activeIndex)
  if matches.length == 0: false
  if matches.length == 1 && matches[0] == current: false
  true

onFocus(i):
  cancel pending blurTimer
  activeIndex = i
  highlightedIndex = 0

onBlur():
  blurTimer = setTimeout(() => activeIndex = -1, 120)

onInput(i):
  words[i] = words[i].toLowerCase()
  highlightedIndex = 0

pickSuggestion(word):
  words[activeIndex] = word
  focusNext(activeIndex)

onEnter(i):
  if showSuggestions:
    pickSuggestion(activeSuggestions[highlightedIndex])
  else:
    focusNext(i)

onArrowRight():  highlightedIndex = (highlightedIndex + 1) % len
onArrowLeft():   highlightedIndex = (highlightedIndex - 1 + len) % len
onEscape():      activeIndex = -1

handlePaste(event, startIndex):
  tokens = pastedText.trim().toLowerCase().split(whitespace).slice(0, 12)
  if tokens.length > 1:
    event.preventDefault()
    for each token at i: words[startIndex + i] = token
    activeIndex = -1
```

Key nuance: `@mousedown.prevent` (or the equivalent in your framework) on each chip so the parent input doesn't blur before the click handler fires. Combined with the 120 ms blur-timer, this guarantees taps register reliably.

## 7. Reference implementation (Vue 3 Options API)

### Template

```vue
<div class="word-grid-container">
  <!-- Suggestion strip — ABOVE the grid -->
  <div
    v-if="showSuggestions"
    id="bip39-suggestion-strip"
    class="suggestion-strip"
    role="listbox"
  >
    <button
      v-for="(suggestion, sIdx) in activeSuggestions"
      :key="suggestion"
      type="button"
      class="suggestion-chip"
      :class="{ 'suggestion-chip--highlighted': sIdx === highlightedIndex }"
      role="option"
      :aria-selected="sIdx === highlightedIndex"
      @mousedown.prevent
      @click="pickSuggestion(suggestion)"
    >
      {{ suggestion }}
    </button>
  </div>

  <div class="word-grid">
    <div
      v-for="(word, index) in words"
      :key="index"
      class="word-input-wrapper"
      :class="{ 'word-filled': words[index].trim() }"
    >
      <span class="word-number">{{ index + 1 }}</span>
      <input
        v-model="words[index]"
        type="text"
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        class="word-input"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="bip39-suggestion-strip"
        :aria-expanded="showSuggestions && activeIndex === index"
        @paste="handlePaste($event, index)"
        @input="onWordInput(index)"
        @focus="onWordFocus(index)"
        @blur="onWordBlur"
        @keydown.enter.prevent="onEnter(index)"
        @keydown.tab="onTab($event, index)"
        @keydown.arrow-right="onArrowRight($event)"
        @keydown.arrow-left="onArrowLeft($event)"
        @keydown.esc="closeSuggestions"
      />
    </div>
  </div>
</div>
```

### Script

```js
import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

export default {
  data () {
    return {
      words: Array(12).fill(''),
      activeIndex: -1,
      highlightedIndex: 0,
      blurTimer: null
    }
  },
  computed: {
    activeSuggestions () {
      if (this.activeIndex < 0) return []
      return this.suggestionsFor(this.activeIndex)
    },
    showSuggestions () {
      if (this.activeIndex < 0) return false
      const current = (this.words[this.activeIndex] || '').trim().toLowerCase()
      if (!current) return false
      const matches = this.activeSuggestions
      if (matches.length === 0) return false
      if (matches.length === 1 && matches[0] === current) return false
      return true
    }
  },
  methods: {
    suggestionsFor (index) {
      const prefix = (this.words[index] || '').trim().toLowerCase()
      if (!prefix) return []
      return wordlist.filter(w => w.startsWith(prefix)).slice(0, 8)
    },
    onWordInput (index) {
      this.words[index] = (this.words[index] || '').toLowerCase()
      this.highlightedIndex = 0
    },
    onWordFocus (index) {
      if (this.blurTimer) { clearTimeout(this.blurTimer); this.blurTimer = null }
      this.activeIndex = index
      this.highlightedIndex = 0
    },
    onWordBlur () {
      this.blurTimer = setTimeout(() => { this.activeIndex = -1; this.blurTimer = null }, 120)
    },
    closeSuggestions () { this.activeIndex = -1 },
    pickSuggestion (word) {
      const idx = this.activeIndex
      if (idx < 0) return
      this.words[idx] = word
      this.highlightedIndex = 0
      this.focusNext(idx)
    },
    onEnter (index) {
      if (this.showSuggestions) {
        const pick = this.activeSuggestions[this.highlightedIndex]
        if (pick) return this.pickSuggestion(pick)
      }
      this.focusNext(index)
    },
    onTab (event, index) {
      if (this.showSuggestions && !event.shiftKey) {
        const pick = this.activeSuggestions[this.highlightedIndex]
        if (pick) { event.preventDefault(); this.pickSuggestion(pick) }
      }
    },
    onArrowRight (event) {
      if (!this.showSuggestions) return
      event.preventDefault()
      this.highlightedIndex = (this.highlightedIndex + 1) % this.activeSuggestions.length
    },
    onArrowLeft (event) {
      if (!this.showSuggestions) return
      event.preventDefault()
      const len = this.activeSuggestions.length
      this.highlightedIndex = (this.highlightedIndex - 1 + len) % len
    },
    handlePaste (event, startIndex) {
      const text = event.clipboardData.getData('text')
      const tokens = text.trim().toLowerCase().split(/\s+/).slice(0, 12)
      if (tokens.length > 1) {
        event.preventDefault()
        tokens.forEach((w, i) => { if (startIndex + i < 12) this.words[startIndex + i] = w })
        this.activeIndex = -1
      }
    },
    focusNext (index) {
      const inputs = document.querySelectorAll('.word-input')
      const nextIndex = index + 1
      if (nextIndex < this.words.length && inputs[nextIndex]) inputs[nextIndex].focus()
      else if (inputs[index]) inputs[index].blur()
    },
    handleImport () {
      const phrase = this.words.map(w => w.trim().toLowerCase()).join(' ')
      if (!validateMnemonic(phrase, wordlist)) { /* show error */ return }
      // proceed with restore
    }
  }
}
```

### CSS

```css
.suggestion-strip {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.375rem;
  margin-bottom: 0.75rem;
  padding: 0.375rem;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 0.625rem;
  box-shadow: 0 4px 12px -4px rgba(15, 23, 42, 0.12);
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.suggestion-strip::-webkit-scrollbar { display: none; }

.suggestion-chip {
  flex: 0 0 auto;
  min-height: 36px;
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #1e293b;
  background: #f1f5f9;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  scroll-snap-align: start;
  touch-action: manipulation;
}
.suggestion-chip:hover {
  background: rgba(26, 59, 139, 0.08);
  color: #1A3B8B;
}
.suggestion-chip--highlighted {
  background: #1A3B8B;
  color: #ffffff;
  border-color: #1A3B8B;
}
.suggestion-chip:active { transform: scale(0.97); }
```

Replace `#1A3B8B` with your brand color.

## 8. Porting to other frameworks

- **React**: `activeIndex` / `highlightedIndex` as `useState`; use `useRef` on a list of inputs for `focusNext`; `onMouseDown={e => e.preventDefault()}` on chips; memoize `activeSuggestions`.
- **Svelte**: bind:value on inputs; `$:` reactive declaration for `showSuggestions`; `on:mousedown|preventDefault` on chips.
- **Plain JS**: the logic is <80 LOC — track state in a module-scoped object, wire events manually, re-render the strip on state change.

## 9. Acceptance checklist

- [ ] Strip renders **above** the word grid, never below.
- [ ] Strip appears only when the focused input has a non-empty prefix with matches.
- [ ] Strip disappears when the typed word is an exact sole BIP-39 match.
- [ ] Tapping a chip fills the current input and focuses the next input.
- [ ] Enter, Tab, ArrowLeft, ArrowRight, Escape all behave as specified.
- [ ] Pasting 12 words fills all slots and hides the strip.
- [ ] Auto-lowercase works (users typing capitalized words still get matches).
- [ ] Custom colors — no browser-default grey suggestion popup anywhere.
- [ ] Mobile keyboard never covers the strip.
- [ ] Tap targets ≥36 px.
- [ ] Works with `validateMnemonic` on the same `wordlist` used for suggestions.

## 10. Non-goals

- Live per-word validation / red outlines for unknown words (separate feature; will add clutter if combined).
- Support for non-English BIP-39 wordlists (trivial to add: swap the `wordlist` import).
- Word count toggle (12 / 15 / 18 / 21 / 24). Add only if your product supports it.
