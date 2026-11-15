<!--
  Composer
  The message field (it lives in MoneyBar's slot, above Request and Send).

    - A field that grows with the text up to five lines, then scrolls, and a
      44 pt send button. Enter sends (not during IME input); Shift+Enter is a
      new line.
    - Counter appears only near the limit and turns red above it. Over the
      limit is blocked, never silently truncated.
    - secretKeyWarning: the text contains an nsec / ncryptsec. Sending is
      blocked and the reason is shown, because a pasted key cannot be taken
      back. (The parent decides with protocol.containsSecretKey.)
    - reply: preview of the message being answered, with a cancel button.
    - Emoji button: inside the field, only for a mouse or trackpad (a touch
      screen has emoji on its keyboard). It emits `emoji`; the parent opens
      the picker and calls `insertEmoji`, which writes at the caret.

  `v-model` is the text. Events: `send`, `cancel-reply`, `emoji`. The component
  never clears the text itself: the parent does it once the message is queued.
-->
<template>
  <div class="composer">
    <p v-if="secretKeyWarning" class="composer__warning" role="alert">
      <Icon icon="tabler:alert-triangle" width="18" height="18" />
      <span>
        <strong>{{ $t('This looks like a secret key or recovery phrase') }}</strong>
        {{ $t('Never share it. Sending is blocked.') }}
      </span>
    </p>

    <div v-if="reply" class="composer__reply">
      <div class="composer__reply-body">
        <strong>{{ $t('Reply to {name}', { name: reply.author }) }}</strong>
        <span>{{ reply.text }}</span>
      </div>
      <button type="button" class="composer__icon-btn" :aria-label="$t('Cancel reply')" @click="$emit('cancel-reply')">
        <Icon icon="tabler:x" width="18" height="18" />
      </button>
    </div>

    <div class="composer__row">
      <div class="composer__field" :class="{ 'composer__field--focused': typing, 'composer__field--invalid': invalid, 'composer__field--disabled': disabled }">
        <textarea
          ref="input"
          class="composer__input"
          rows="1"
          enterkeyhint="send"
          autocomplete="off"
          autocapitalize="sentences"
          :value="modelValue"
          :placeholder="$t('Message')"
          :aria-label="$t('Message')"
          :aria-invalid="invalid ? 'true' : undefined"
          :aria-describedby="showCounter ? counterId : undefined"
          :disabled="disabled"
          @input="$emit('update:modelValue', $event.target.value)"
          @focus="typing = true"
          @blur="typing = false"
          @keydown.enter="onEnter"
        />
        <button ref="emojiButton" type="button" class="composer__icon-btn composer__emoji" :disabled="disabled"
          :aria-label="$t('Choose emoji')" :aria-expanded="emojiOpen" :aria-controls="emojiOpen ? 'chat-emoji-panel' : undefined"
          :title="$t('Choose emoji')" @click="$emit('emoji')">
          <Icon icon="tabler:mood-smile" width="22" height="22" />
        </button>
      </div>
      <button
        type="button"
        class="composer__send"
        :disabled="!canSend"
        :aria-label="$t('Send message')"
        @click="submit"
      >
        <Icon icon="tabler:arrow-up" width="22" height="22" />
      </button>
    </div>

    <p v-if="showCounter" :id="counterId" class="composer__counter" :class="{ 'composer__counter--over': over }" role="status">
      {{ over ? $t('{count} characters too long', { count: -remaining }) : $t('{count} characters left', { count: remaining }) }}
    </p>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue'
import { MAX_TEXT_LENGTH } from '../../services/dm/constants.js'
import { countChars } from './chatFormat.js'
import './chatTokens.css'

/** The counter appears when this many characters are left. */
const COUNTER_THRESHOLD = 200

export default {
  name: 'Composer',
  components: { Icon },
  props: {
    modelValue: { type: String, default: '' },
    maxLength: { type: Number, default: MAX_TEXT_LENGTH },
    /** The text contains a secret key: blocks sending and shows the warning. */
    secretKeyWarning: { type: Boolean, default: false },
    /** { author, text } of the message being answered. */
    reply: { type: Object, default: null },
    disabled: { type: Boolean, default: false },
    emojiOpen: { type: Boolean, default: false },
    /** Focus the field when it appears. Off by default: opening a chat must not raise the keyboard over the money buttons. */
    autofocus: { type: Boolean, default: false }
  },
  emits: ['update:modelValue', 'send', 'cancel-reply', 'emoji'],
  data() {
    // The caret is in the text: the field wears the focus ring.
    return { typing: false }
  },
  computed: {
    counterId() { return `composer-counter-${this.$.uid}` },
    length() { return countChars(this.modelValue) },
    remaining() { return this.maxLength - this.length },
    over() { return this.remaining < 0 },
    showCounter() { return this.remaining <= COUNTER_THRESHOLD },
    invalid() { return this.over || this.secretKeyWarning },
    canSend() {
      return !this.disabled && !this.invalid && this.modelValue.trim().length > 0
    }
  },
  watch: {
    // Typing, a draft restored, the field cleared after sending: the height follows the text.
    modelValue() {
      this.$nextTick(this.fitHeight)
    }
  },
  mounted() {
    this.fitHeight()
    // Opening the dock or rotating a phone can wrap an unchanged draft.
    // Width only: the field's own growth must not start another round.
    if (typeof ResizeObserver === 'function') {
      this.sizeObserver = new ResizeObserver(([entry]) => this.onWidth(entry.contentRect.width))
      this.sizeObserver.observe(this.$refs.input)
    }
    if (this.autofocus) this.focus()
  },
  beforeUnmount() {
    this.sizeObserver?.disconnect()
    if (this.fitFrame) cancelAnimationFrame(this.fitFrame)
  },
  methods: {
    /**
     * The field got wider or narrower. The refit waits for the next frame:
     * resizing the observed element inside its own callback makes the browser
     * report an undelivered-notifications error on every refit.
     */
    onWidth(width) {
      if (width === this.observedWidth) return
      this.observedWidth = width
      if (this.fitFrame) return
      this.fitFrame = requestAnimationFrame(() => {
        this.fitFrame = null
        this.fitHeight()
      })
    },
    /**
     * Write an emoji at the caret, replacing a selection. The caret is read
     * from the field at this moment (a blurred field keeps its selection), so
     * a draft that was restored or changed in between cannot shift it.
     */
    insertEmoji(char, { focus = false } = {}) {
      if (this.disabled) return
      const text = this.modelValue
      const field = this.$refs.input
      const start = Math.min(field?.selectionStart ?? text.length, text.length)
      const end = Math.max(start, Math.min(field?.selectionEnd ?? start, text.length))
      this.$emit('update:modelValue', text.slice(0, start) + char + text.slice(end))
      const caret = start + char.length
      this.$nextTick(() => {
        if (focus) field?.focus({ preventScroll: true })
        field?.setSelectionRange(caret, caret)
      })
    },
    focusEmojiButton() { this.$refs.emojiButton?.focus({ preventScroll: true }) },
    hasInputFocus() { return typeof document !== 'undefined' && document.activeElement === this.$refs.input },
    focus() {
      this.$refs.input?.focus?.({ preventScroll: true })
    },
    submit() {
      if (this.canSend) this.$emit('send')
    },
    /** Grow with the text; the CSS max-height caps it at five lines, then it scrolls. */
    fitHeight() {
      const field = this.$refs.input
      if (!field?.style) return
      field.style.height = 'auto'
      field.style.height = `${field.scrollHeight}px`
    },
    onEnter(event) {
      // Enter that confirms an IME composition (CJK, emoji pickers) is not a send; Shift+Enter is a new line.
      if (event.isComposing || event.keyCode === 229 || event.shiftKey) return
      event.preventDefault()
      this.submit()
    }
  }
}
</script>

<style scoped>
.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
}

.composer__warning {
  display: flex;
  gap: 10px;
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-ms);
  border: 1px solid var(--chat-danger-line);
  background: var(--chat-danger-soft);
  color: var(--text-primary);
  font-size: 0.78125rem;
  line-height: 1.4;
}
.composer__warning :deep(svg) { flex: 0 0 auto; margin-top: 1px; color: var(--chat-danger); }
.composer__warning strong { display: block; color: var(--chat-danger); font-size: 0.8125rem; }

.composer__reply {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 2px;
  font-size: 0.78125rem;
  color: var(--text-secondary);
}
.composer__reply-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding-left: 8px;
  border-left: 3px solid var(--brand-accent);
}
.composer__reply-body strong { color: var(--text-primary); font-weight: 700; }
.composer__reply-body span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.composer__icon-btn {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.composer__row { display: flex; align-items: flex-end; gap: 8px; }

.composer__field {
  display: flex;
  align-items: flex-end;
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 1px 3px 1px 0;
  border: 1px solid var(--border-card);
  border-radius: 24px;
  background: var(--bg-input);
}
/* The ring belongs to the text: the emoji button inside shows its own focus. */
.composer__field--focused { border-color: var(--chat-focus); box-shadow: 0 0 0 1px var(--chat-focus); }
.composer__field--invalid { border-color: var(--chat-danger); }
.composer__field--invalid.composer__field--focused { box-shadow: 0 0 0 1px var(--chat-danger); }
.composer__field--disabled { opacity: .6; }

/* A touch screen types emoji with its own keyboard: the button is for a mouse
   or trackpad (the same query as composables/useEmojiPicker.js). */
.composer__emoji { display: none; align-self: flex-end; }
@media (hover: hover) and (pointer: fine) {
  .composer__emoji { display: grid; }
  .composer__emoji:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-card); }
}
.composer__emoji[aria-expanded='true'] { color: var(--brand-accent-text); background: var(--brand-accent-soft); }
.composer__field .composer__emoji:focus-visible { outline-offset: -3px; }
.composer__icon-btn:disabled { cursor: default; }

.composer__input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  /* Five lines, then it scrolls. The shared field paints the border. */
  max-height: 134px;
  box-sizing: border-box;
  padding: 11px 8px 11px 14px;
  border: 0;
  border-radius: 22px;
  line-height: 22px;
  resize: none;
  overflow-y: auto;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  /* 16px: below this iOS zooms the page on focus. */
  font-size: 1rem;
  outline: none;
}
.composer__input::placeholder { color: var(--text-muted); }

.composer__send {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--brand-accent);
  color: var(--chat-on-accent);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.composer__send:disabled { background: var(--bg-input); color: var(--text-muted); cursor: default; }
.composer__send:focus-visible,
.composer__icon-btn:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }

.composer__counter {
  margin: 0;
  padding: 0 14px;
  text-align: right;
  font-size: 0.6875rem;
  color: var(--text-muted);
}
.composer__counter--over { color: var(--chat-danger); font-weight: 700; }
</style>
