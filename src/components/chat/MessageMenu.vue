<!--
  MessageMenu
  The action sheet behind a long press (or the context-menu key) on a bubble:
  a row of reactions, then Reply / Copy text / Send again, then Cancel.

  Presentational. It reports the pick and closes itself; the bubble forwards it.
  Reactions are only offered when `canReact` (never to a stranger: a reaction
  is a message and would tell them this inbox is read).
-->
<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="message-menu" role="menu" :aria-label="$t('Message actions')">
      <div v-if="canReact" class="message-menu__reactions" role="group" :aria-label="$t('React')">
        <button
          v-for="emoji in emojis"
          :key="emoji"
          type="button"
          class="message-menu__emoji"
          :class="{ 'message-menu__emoji--on': emoji === myReaction }"
          :aria-pressed="emoji === myReaction ? 'true' : 'false'"
          :aria-label="$t('React with {emoji}', { emoji })"
          @click="pick('react', emoji)"
        >{{ emoji }}</button>
      </div>

      <div class="message-menu__group">
        <button type="button" role="menuitem" class="message-menu__item" @click="pick('reply')">
          <span>{{ $t('Reply') }}</span>
          <Icon icon="tabler:arrow-back-up" width="19" height="19" />
        </button>
        <button type="button" role="menuitem" class="message-menu__item" @click="pick('copy')">
          <span>{{ $t('Copy text') }}</span>
          <Icon icon="tabler:copy" width="19" height="19" />
        </button>
        <button v-if="canRetry" type="button" role="menuitem" class="message-menu__item" @click="pick('retry')">
          <span>{{ $t('Send again') }}</span>
          <Icon icon="tabler:refresh" width="19" height="19" />
        </button>
      </div>

      <button type="button" class="message-menu__cancel" @click="$emit('update:modelValue', false)">
        {{ $t('Cancel') }}
      </button>
    </div>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue'
import { REACTION_EMOJIS } from './chatFormat.js'
import './chatTokens.css'

export default {
  name: 'MessageMenu',
  components: { Icon },
  props: {
    modelValue: { type: Boolean, default: false },
    canReact: { type: Boolean, default: true },
    /** Offer "Send again" (the message failed to send). */
    canRetry: { type: Boolean, default: false },
    /** The emoji the user already reacted with, shown pressed. */
    myReaction: { type: String, default: '' },
    emojis: { type: Array, default: () => [...REACTION_EMOJIS] }
  },
  emits: ['update:modelValue', 'react', 'reply', 'copy', 'retry'],
  methods: {
    pick(action, payload) {
      this.$emit('update:modelValue', false)
      if (action === 'react') this.$emit('react', payload)
      else this.$emit(action)
    }
  }
}
</script>

<style scoped>
.message-menu {
  width: min(100%, 420px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px max(12px, var(--safe-bottom, 0px));
  font-family: 'Manrope', sans-serif;
}

.message-menu__reactions {
  align-self: center;
  display: flex;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  box-shadow: var(--shadow-md);
}
.message-menu__emoji {
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.message-menu__emoji--on { background: var(--brand-accent-soft); }

.message-menu__group,
.message-menu__cancel {
  border-radius: var(--radius-md);
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  overflow: hidden;
}
.message-menu__item {
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 18px;
  border: 0;
  border-bottom: 1px solid var(--border-card);
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 1rem;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.message-menu__item:last-child { border-bottom: 0; }
.message-menu__item:active { background: var(--bg-input); }

.message-menu__cancel {
  width: 100%;
  min-height: 52px;
  color: var(--brand-accent-text);
  font-family: inherit;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
}

.message-menu__emoji:focus-visible,
.message-menu__item:focus-visible,
.message-menu__cancel:focus-visible {
  outline: 2px solid var(--chat-focus);
  outline-offset: -2px;
}
</style>
