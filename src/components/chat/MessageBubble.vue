<!--
  MessageBubble
  One text message, incoming (left) or outgoing (right).

    - Quoted reply on top, text, then the time and, for the user's own
      messages, an HONEST delivery line: waiting / sending / sent / not sent.
      There is no "delivered" or "read": NIP-17 cannot tell (docs section 4).
    - "Not sent" carries a "Send again" button (44 pt).
    - degraded: the message claimed a BuhoGO type that did not validate; it is
      shown as plain text with a dashed outline and a note, never with actions.
    - Long press (touch), right click or the context-menu key opens the
      MessageMenu: react, reply, copy, send again. The bubble is a button so a
      keyboard or screen-reader user reaches the same menu with Enter.

  Presentational: props in, events out (`react(emoji)`, `reply`, `copy(text)`,
  `retry`). The clipboard, the store and the composer belong to the page.
-->
<template>
  <div class="bubble-row" :class="outgoing ? 'bubble-row--out' : 'bubble-row--in'">
    <div class="bubble-wrap">
      <div
        class="bubble"
        :class="{
          'bubble--out': outgoing,
          'bubble--in': !outgoing,
          'bubble--failed': delivery === 'failed',
          'bubble--degraded': degraded
        }"
        role="button"
        tabindex="0"
        aria-haspopup="menu"
        :aria-label="spokenText"
        @contextmenu.prevent="openMenu"
        @keydown.enter.self.prevent="openMenu"
        @keydown.space.self.prevent="openMenu"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="cancelPress"
        @pointercancel="cancelPress"
        @pointerleave="cancelPress"
      >
        <div v-if="reply" class="bubble__quote">
          <strong>{{ reply.author }}</strong>
          <span>{{ reply.text }}</span>
        </div>
        <p class="bubble__text">{{ text }}</p>
      </div>

      <p v-if="degraded" class="bubble__note">
        <Icon icon="tabler:info-circle" width="12" height="12" />
        {{ $t('Shown as plain text') }}
      </p>

      <div v-if="reactions.length" class="bubble__reactions" role="group" :aria-label="$t('Reactions')">
        <button
          v-for="reaction in reactions"
          :key="reaction.emoji"
          type="button"
          class="bubble__reaction"
          :class="{ 'bubble__reaction--mine': reaction.mine }"
          :aria-pressed="reaction.mine ? 'true' : 'false'"
          :aria-label="reactionLabel(reaction)"
          :disabled="!canReact"
          @click="$emit('react', reaction.emoji)"
        >
          <span aria-hidden="true">{{ reaction.emoji }}</span>
          <span v-if="reaction.count > 1" class="bubble__reaction-count" aria-hidden="true">{{ reaction.count }}</span>
        </button>
      </div>

      <div class="bubble__meta" :class="{ 'bubble__meta--out': outgoing }">
        <span v-if="time" class="bubble__time">{{ time }}</span>
        <template v-if="outgoing">
          <span class="bubble__delivery" :class="`bubble__delivery--${delivery}`" role="status">
            <Icon :icon="deliveryIcon" width="12" height="12" />
            {{ deliveryText }}
          </span>
          <button v-if="delivery === 'failed'" type="button" class="bubble__retry" @click="$emit('retry')">
            {{ $t('Send again') }}
          </button>
        </template>
      </div>
    </div>

    <MessageMenu
      v-if="menuMounted"
      v-model="menuOpen"
      :can-react="canReact"
      :can-retry="outgoing && delivery === 'failed'"
      :my-reaction="myReaction"
      @react="$emit('react', $event)"
      @reply="$emit('reply')"
      @copy="$emit('copy', text)"
      @retry="$emit('retry')"
    />
  </div>
</template>

<script>
import { Icon } from '@iconify/vue'
import MessageMenu from './MessageMenu.vue'
import { formatClock } from './chatFormat.js'
import './chatTokens.css'

const LONG_PRESS_MS = 450
/** A finger that moves further than this is scrolling, not pressing. */
const PRESS_SLOP_PX = 10

export default {
  name: 'MessageBubble',
  components: { Icon, MessageMenu },
  props: {
    text: { type: String, required: true },
    outgoing: { type: Boolean, default: false },
    /** Unix seconds. */
    createdAt: { type: Number, default: null },
    /** Outgoing only: 'queued' | 'sending' | 'sent' | 'failed'. */
    delivery: { type: String, default: 'sent' },
    /** An invalid BuhoGO payload shown as its plain-text fallback. */
    degraded: { type: Boolean, default: false },
    /** [{ emoji, count, mine }] */
    reactions: { type: Array, default: () => [] },
    /** { author, text } of the message this one answers. */
    reply: { type: Object, default: null },
    /** False for strangers: no reactions. */
    canReact: { type: Boolean, default: true }
  },
  emits: ['react', 'reply', 'copy', 'retry'],
  data() {
    // The menu is created on first use and then kept, so it can animate closed.
    return { menuOpen: false, menuMounted: false, pressTimer: null, pressOrigin: null }
  },
  computed: {
    time() {
      return this.createdAt === null ? '' : formatClock(this.createdAt, this.$i18n?.locale)
    },
    myReaction() {
      return this.reactions.find((r) => r.mine)?.emoji || ''
    },
    deliveryIcon() {
      return {
        queued: 'tabler:clock',
        sending: 'tabler:loader-2',
        sent: 'tabler:check',
        failed: 'tabler:alert-circle'
      }[this.delivery] || 'tabler:check'
    },
    deliveryText() {
      return {
        queued: this.$t('Waiting to send'),
        sending: this.$t('Sending…'),
        sent: this.$t('Sent'),
        failed: this.$t('Not sent')
      }[this.delivery] || this.$t('Sent')
    },
    /** What a screen reader says for the bubble: who, then what. */
    spokenText() {
      const who = this.outgoing ? this.$t('You') : this.$t('Them')
      const quote = this.reply ? `${this.$t('Reply to {name}', { name: this.reply.author })}: ${this.reply.text}. ` : ''
      return `${who}: ${quote}${this.text}`
    }
  },
  beforeUnmount() {
    this.cancelPress()
  },
  methods: {
    openMenu() {
      this.cancelPress()
      this.menuMounted = true
      this.menuOpen = true
    },
    reactionLabel(reaction) {
      // Two keys rather than a plural rule: legacy-mode vue-i18n, no pipe plurals in this app.
      const count = reaction.count || 1
      return this.$t(count === 1 ? '{emoji} {count} reaction' : '{emoji} {count} reactions', { emoji: reaction.emoji, count })
    },

    // Touch and pen: a long press. A mouse uses the contextmenu event instead,
    // and touch browsers fire contextmenu after a long press too (harmless:
    // the menu is already open).
    onPointerDown(event) {
      if (event.pointerType === 'mouse') return
      this.cancelPress()
      this.pressOrigin = { x: event.clientX, y: event.clientY }
      this.pressTimer = setTimeout(() => this.openMenu(), LONG_PRESS_MS)
    },
    onPointerMove(event) {
      if (!this.pressOrigin) return
      const dx = event.clientX - this.pressOrigin.x
      const dy = event.clientY - this.pressOrigin.y
      if (Math.hypot(dx, dy) > PRESS_SLOP_PX) this.cancelPress()
    },
    cancelPress() {
      if (this.pressTimer) clearTimeout(this.pressTimer)
      this.pressTimer = null
      this.pressOrigin = null
    }
  }
}
</script>

<style scoped>
.bubble-row {
  display: flex;
  font-family: 'Manrope', sans-serif;
}
.bubble-row--out { justify-content: flex-end; }

.bubble-wrap {
  display: flex;
  flex-direction: column;
  max-width: min(80%, 34rem);
}
.bubble-row--out .bubble-wrap { align-items: flex-end; }

.bubble {
  padding: 9px 13px;
  border-radius: 18px;
  color: var(--text-primary);
  font-size: 0.9375rem;
  line-height: 1.38;
  overflow-wrap: anywhere;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.bubble--in { background: var(--chat-bubble-in); border-bottom-left-radius: 6px; }
.bubble--out { background: var(--chat-bubble-out); border-bottom-right-radius: 6px; }
.bubble--failed { outline: 1.5px solid var(--chat-danger-line); }
.bubble--degraded { outline: 1.5px dashed var(--border-card); outline-offset: -1.5px; }
.bubble:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }

.bubble__text { margin: 0; white-space: pre-wrap; }

.bubble__quote {
  display: flex;
  flex-direction: column;
  margin-bottom: 6px;
  padding: 5px 10px;
  border-left: 3px solid var(--brand-accent);
  border-radius: 8px;
  background: var(--bg-input);
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--text-secondary);
}
.bubble__quote strong { font-weight: 700; color: var(--text-primary); }
.bubble__quote span {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.bubble__note {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 3px 6px 0;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.bubble__reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: -6px;
  padding: 0 8px;
  position: relative;
  z-index: 1;
}
.bubble__reaction {
  position: relative;
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 8px;
  border: 1px solid var(--border-card);
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}
/* The chip is small; the touch area is not. */
.bubble__reaction::after { content: ''; position: absolute; inset: -9px -4px; }
.bubble__reaction:disabled { cursor: default; }
.bubble__reaction--mine { border-color: var(--brand-accent); background: var(--brand-accent-soft); }
.bubble__reaction:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 1px; }

.bubble__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 2px 6px 6px;
  font-size: 0.6875rem;
  color: var(--text-muted);
}
.bubble__meta--out { justify-content: flex-end; }
.bubble__delivery { display: inline-flex; align-items: center; gap: 3px; }
.bubble__delivery--sent { color: var(--brand-accent-text); }
.bubble__delivery--failed { color: var(--chat-danger); font-weight: 700; }
.bubble__delivery--sending :deep(svg) { animation: bubble-spin 1s linear infinite; }

.bubble__retry {
  min-height: 44px;
  margin: -10px -6px -10px 0;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--brand-accent-text);
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 800;
  cursor: pointer;
}
.bubble__retry:focus-visible { outline: 2px solid var(--chat-focus); border-radius: 8px; }

@keyframes bubble-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .bubble__delivery--sending :deep(svg) { animation: none; }
}
</style>
