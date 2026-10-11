<!--
  ChatHeader
  Back · avatar · name + encryption line · more.

  Presentational. The name area is ONE 44 pt button that opens the contact page
  (the payment history lives there); the page decides what back and the menu do.

  The second line is an honest statement about the thread:
    - default            "End-to-end encrypted"  (messages are NIP-17 gift wraps)
    - paymentsOnly       "Payments only"         (the partner cannot receive messages)
    - unknown            "Not in your contacts"  (nostrdesign.org: no borrowed trust)

  The avatar slot lets the page drop in the app's ContactAvatar; without it the
  header draws the picture or the initials itself.

  Header-owns-inset pattern (like ContactProfilePage): it pads for the status bar.
-->
<template>
  <header class="chat-header">
    <button
      type="button"
      class="chat-header__icon-btn"
      :aria-label="$t('Back')"
      @click="$emit('back')"
    >
      <Icon icon="tabler:chevron-left" width="22" height="22" />
    </button>

    <button
      type="button"
      class="chat-header__person"
      :aria-label="$t('Open contact: {name}', { name })"
      @click="$emit('open-profile')"
    >
      <span class="chat-header__avatar" aria-hidden="true">
        <slot name="avatar">
          <img v-if="avatarUrl && !imageFailed" :src="avatarUrl" alt="" @error="imageFailed = true">
          <span v-else class="chat-header__initials">{{ initials }}</span>
        </slot>
      </span>
      <span class="chat-header__copy">
        <span class="chat-header__name">{{ name }}</span>
        <span class="chat-header__sub" :class="`chat-header__sub--${tone}`">
          <Icon :icon="subtitleIcon" width="12" height="12" />
          <span>{{ subtitle }}</span>
        </span>
      </span>
    </button>

    <button
      type="button"
      class="chat-header__icon-btn"
      aria-haspopup="menu"
      :aria-label="$t('More options')"
      @click="$emit('menu')"
    >
      <Icon icon="tabler:dots-vertical" width="20" height="20" />
    </button>
  </header>
</template>

<script>
import { Icon } from '@iconify/vue'
import { initialsOf } from './chatFormat.js'
import './chatTokens.css'

export default {
  name: 'ChatHeader',
  components: { Icon },
  props: {
    /** Display name of the contact (or the sender's claimed name). */
    name: { type: String, required: true },
    /** Profile picture URL; initials are drawn when it is missing or fails. */
    avatarUrl: { type: String, default: '' },
    /** The partner cannot receive messages (no DM inbox): money only. */
    paymentsOnly: { type: Boolean, default: false },
    /** The partner is not in the address book. Takes precedence over the lines above. */
    unknown: { type: Boolean, default: false }
  },
  emits: ['back', 'open-profile', 'menu'],
  data() {
    return { imageFailed: false }
  },
  computed: {
    initials() {
      return initialsOf(this.name)
    },
    tone() {
      if (this.unknown) return 'danger'
      return this.paymentsOnly ? 'muted' : 'secure'
    },
    subtitle() {
      if (this.unknown) return this.$t('Not in your contacts')
      return this.paymentsOnly ? this.$t('Payments only') : this.$t('End-to-end encrypted')
    },
    subtitleIcon() {
      if (this.unknown) return 'tabler:alert-triangle'
      return this.paymentsOnly ? 'tabler:message-off' : 'tabler:lock'
    }
  },
  watch: {
    avatarUrl() {
      this.imageFailed = false
    }
  }
}
</script>

<style scoped>
.chat-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: calc(0.5rem + var(--safe-top, 0px)) 0.5rem 0.5rem;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-card);
  font-family: 'Manrope', sans-serif;
}

.chat-header__icon-btn {
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
  -webkit-tap-highlight-color: transparent;
}
.chat-header__icon-btn:active { background: var(--bg-input); }

.chat-header__person {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 8px 2px 4px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.chat-header__person:active { background: var(--bg-input); }

.chat-header__avatar {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: var(--bg-input);
  color: var(--text-secondary);
}
.chat-header__avatar :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.chat-header__initials {
  font-size: 0.875rem;
  font-weight: 750;
  letter-spacing: 0.01em;
}

.chat-header__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.chat-header__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1rem;
  font-weight: 750;
  line-height: 1.25;
}
.chat-header__sub {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  font-size: 0.75rem;
  line-height: 1.3;
  color: var(--text-muted);
}
.chat-header__sub > svg { flex: 0 0 auto; margin-top: 0.2em; }
/* Wraps to two lines at large text sizes; the name stays on one line. */
.chat-header__sub > span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.chat-header__sub--secure { color: var(--brand-accent-text); }
.chat-header__sub--danger { color: var(--chat-danger); font-weight: 650; }

.chat-header__icon-btn:focus-visible,
.chat-header__person:focus-visible {
  outline: 2px solid var(--chat-focus);
  outline-offset: -2px;
}
</style>
