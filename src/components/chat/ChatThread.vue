<!--
  ChatThread
  The scrolling body of the chat: day separators, bubbles, request cards and
  payment lines, oldest first.

  Presentational: it draws a list of view-model items the page derives from the
  store, and reports what the user does with them. It never reads the store.

  ── Item shape (`items`, ascending by `ts`) ────────────────────────────────
  Every item has a stable `key` (React-style identity: message id, or
  `day-<date>`) and `ts` (unix seconds). `insertDaySeparators(items)` from
  chatFormat.js adds the `day` items.

    { key, type: 'day', ts }

    { key, type: 'message', ts, message: {
        id, text, outgoing,
        delivery,         // outgoing: 'queued' | 'sending' | 'sent' | 'failed'
        degraded,         // invalid BuhoGO payload shown as plain text
        reactions,        // [{ emoji, count, mine }]
        reply,            // { author, text } | null
        canReact          // false for strangers
    } }

    { key, type: 'request', ts, request: {
        id, amountSats, fiatText, note,
        outgoing,         // true = the user requested
        state,            // 'pending' | 'paid' | 'declined' | 'cancelled' | 'expired' (derived)
        validUntil,       // unix seconds: when the request stops being open
        settlement,       // own paid request: { verified, walletName } | null
        disabledReason,   // why the user cannot pay now (translated) | ''
        untrusted,        // sender is a stranger
        busy              // an action is in flight
    } }

    { key, type: 'payment', ts, payment: {
        id, outgoing, amountSats, note   // incoming ones only when the wallet confirmed
    } }

  ── Events (all carry the item's id) ───────────────────────────────────────
  react {id, emoji} · reply {id} · copy {id, text} · retry {id}
  pay-request / decline-request / remind-request / withdraw-request {id}
  send-anyway-request / request-again {id}
  open-payment {id}

  ── Scrolling ──────────────────────────────────────────────────────────────
  Opens at the bottom. New items keep the view at the bottom, unless the user
  scrolled up to read: then the view stays put and a "New messages" pill
  appears. The user's own new items always scroll into view. The log region is
  announced politely by screen readers; reduced motion jumps instead of glides.

  Slots: `header` (scrolls with the thread: encryption note, UnknownSenderBanner),
  `empty` (replaces the default text when there are no items).
-->
<template>
  <div class="chat-thread">
    <div
      ref="scroller"
      class="chat-thread__scroll"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      tabindex="0"
      :aria-label="$t('Messages')"
      @scroll.passive="onScroll"
    >
      <div ref="content" class="chat-thread__content">
        <div class="chat-thread__fill" />
        <slot name="header" />

        <slot v-if="!items.length" name="empty">
          <p class="chat-thread__empty">{{ $t('Nothing here yet. Request or send money to get started.') }}</p>
        </slot>

        <template v-for="row in rows" :key="row.item.key">
          <DaySeparator v-if="row.item.type === 'day'" :ts="row.item.ts" />

          <div
            v-else-if="row.item.type === 'message'"
            class="chat-thread__row chat-thread__row--message"
            :class="{ 'chat-thread__row--tight': row.tight }"
          >
            <MessageBubble
              :text="row.item.message.text"
              :outgoing="row.item.message.outgoing"
              :created-at="row.item.ts"
              :delivery="row.item.message.delivery || 'sent'"
              :degraded="!!row.item.message.degraded"
              :reactions="row.item.message.reactions || []"
              :reply="row.item.message.reply || null"
              :can-react="row.item.message.canReact !== false"
              @react="forward('react', row.item.message.id, { emoji: $event })"
              @reply="forward('reply', row.item.message.id)"
              @copy="forward('copy', row.item.message.id, { text: $event })"
              @retry="forward('retry', row.item.message.id)"
            />
          </div>

          <div
            v-else-if="row.item.type === 'request'"
            class="chat-thread__row chat-thread__row--card"
            :class="row.item.request.outgoing ? 'chat-thread__row--out' : 'chat-thread__row--in'"
          >
            <RequestCard
              :amount-sats="row.item.request.amountSats"
              :fiat-text="row.item.request.fiatText || ''"
              :note="row.item.request.note || ''"
              :outgoing="row.item.request.outgoing"
              :state="row.item.request.state"
              :partner-name="partnerName"
              :valid-until="row.item.request.validUntil ?? null"
              :paid-verified="row.item.request.settlement ? row.item.request.settlement.verified : true"
              :received-in="row.item.request.settlement?.walletName || ''"
              :disabled-reason="row.item.request.disabledReason || ''"
              :untrusted="!!row.item.request.untrusted"
              :busy="!!row.item.request.busy"
              :bip177="bip177"
              @pay="forward('pay-request', row.item.request.id)"
              @decline="forward('decline-request', row.item.request.id)"
              @remind="forward('remind-request', row.item.request.id)"
              @withdraw="forward('withdraw-request', row.item.request.id)"
              @send-anyway="forward('send-anyway-request', row.item.request.id)"
              @request-again="forward('request-again', row.item.request.id)"
            />
          </div>

          <PaymentLine
            v-else-if="row.item.type === 'payment'"
            :outgoing="row.item.payment.outgoing"
            :amount-sats="row.item.payment.amountSats"
            :note="row.item.payment.note || ''"
            :created-at="row.item.ts"
            :bip177="bip177"
            @open="forward('open-payment', row.item.payment.id)"
          />
        </template>
      </div>
    </div>

    <transition name="chat-thread-pill">
      <button v-if="hasUnseen" type="button" class="chat-thread__pill" @click="onPillClick">
        <Icon icon="tabler:arrow-down" width="16" height="16" />
        {{ $t('New messages') }}
      </button>
    </transition>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue'
import DaySeparator from './DaySeparator.vue'
import MessageBubble from './MessageBubble.vue'
import PaymentLine from './PaymentLine.vue'
import RequestCard from './RequestCard.vue'
import './chatTokens.css'

/** Within this distance from the end the view counts as "at the bottom". */
const BOTTOM_SLACK_PX = 64

/** The user's own item (right-hand bubble, own request or payment). */
function isOwn(item) {
  return !!(item.message?.outgoing || item.request?.outgoing || item.payment?.outgoing)
}

export default {
  name: 'ChatThread',
  components: { Icon, DaySeparator, MessageBubble, PaymentLine, RequestCard },
  props: {
    /** View-model items, ascending; see the shape in the header comment. */
    items: { type: Array, default: () => [] },
    /** Name of the other person, for "{name} requests". */
    partnerName: { type: String, default: '' },
    /** ₿ 1,234 (true) or 1,234 sats (false). */
    bip177: { type: Boolean, default: true }
  },
  emits: [
    'react', 'reply', 'copy', 'retry',
    'pay-request', 'decline-request', 'remind-request', 'withdraw-request',
    'send-anyway-request', 'request-again',
    'open-payment'
  ],
  data() {
    return { atBottom: true, hasUnseen: false }
  },
  computed: {
    /** Items plus `tight`: consecutive same-side bubbles sit closer together. */
    rows() {
      let previous = null
      return this.items.map((item) => {
        const tight = item.type === 'message'
          && previous?.type === 'message'
          && previous.message.outgoing === item.message.outgoing
        previous = item
        return { item, tight }
      })
    }
  },
  watch: {
    items(next, previous) {
      const lastKey = previous?.[previous.length - 1]?.key
      const at = lastKey === undefined ? -1 : next.findIndex((item) => item.key === lastKey)
      const added = at === -1 ? next : next.slice(at + 1)
      if (!added.length) return
      if (this.atBottom || added.some(isOwn)) {
        this.scrollToBottom({ smooth: this.atBottom })
      } else if (added.some((item) => item.type !== 'day')) {
        this.hasUnseen = true
      }
    }
  },
  mounted() {
    this.scrollToBottom({ smooth: false })
    // The keyboard opening or a card changing state resizes things under a
    // reader who is at the end: keep them at the end.
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        if (this.atBottom) this.scrollToBottom({ smooth: false })
      })
      this.observer.observe(this.$refs.scroller)
      this.observer.observe(this.$refs.content)
    }
  },
  beforeUnmount() {
    this.observer?.disconnect()
  },
  methods: {
    forward(name, id, extra = {}) {
      this.$emit(name, { id, ...extra })
    },

    onScroll() {
      const el = this.$refs.scroller
      if (!el) return
      this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX
      if (this.atBottom) this.hasUnseen = false
    },

    onPillClick() {
      this.scrollToBottom({ smooth: true })
    },

    /** Scrolls to the newest item. Public: the page calls it after opening the composer. */
    scrollToBottom({ smooth = false } = {}) {
      this.hasUnseen = false
      this.$nextTick(() => {
        const el = this.$refs.scroller
        if (!el) return
        const reduce = typeof window !== 'undefined'
          && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' })
        this.atBottom = true
      })
    }
  }
}
</script>

<style scoped>
.chat-thread {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-family: 'Manrope', sans-serif;
}

.chat-thread__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.chat-thread__scroll::-webkit-scrollbar { display: none; }
.chat-thread__scroll:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: -2px; }

/* The fill pushes a short thread to the bottom, like every messenger. */
.chat-thread__content {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 8px 12px 14px;
}
.chat-thread__fill { flex: 1 1 auto; }

.chat-thread__empty {
  align-self: center;
  max-width: 24ch;
  margin: 24px 0;
  text-align: center;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-muted);
}

.chat-thread__row { display: flex; flex-direction: column; margin-top: 8px; }
.chat-thread__row--tight { margin-top: 2px; }
.chat-thread__row--card { align-items: flex-start; }
.chat-thread__row--card.chat-thread__row--out { align-items: flex-end; }

.chat-thread__pill {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  border: 1px solid var(--border-card);
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: var(--shadow-md);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.chat-thread__pill:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }

.chat-thread-pill-enter-active,
.chat-thread-pill-leave-active { transition: opacity 0.16s ease, transform 0.16s ease; }
.chat-thread-pill-enter-from,
.chat-thread-pill-leave-to { opacity: 0; transform: translate(-50%, 8px); }

@media (prefers-reduced-motion: reduce) {
  .chat-thread-pill-enter-active,
  .chat-thread-pill-leave-active { transition: none; }
}
</style>
