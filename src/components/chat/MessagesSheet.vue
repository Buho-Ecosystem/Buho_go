<!--
  MessagesSheet
  Bottom sheet listing the contact chat's threads: contacts first, then the
  senders who are not in the address book ("Not in your contacts").

  Thin store glue around a pure view-model (threadRows.js): the stores supply
  threads, contacts and the amount unit; the rows come out ready to draw.
  Tapping a row closes the sheet and opens the chat (`/address-book/:id/chat`
  for a contact, `/messages/:pubkey` for an unknown sender).
-->
<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <section class="messages-sheet" :aria-labelledby="titleId">
      <div class="messages-sheet__grab" aria-hidden="true" />

      <header class="messages-sheet__top">
        <h2 :id="titleId" class="messages-sheet__title">{{ $t('Messages') }}</h2>
        <button
          type="button"
          class="messages-sheet__close"
          :aria-label="$t('Close')"
          @click="$emit('update:modelValue', false)"
        >
          <Icon icon="tabler:x" width="20" height="20" />
        </button>
      </header>

      <div class="messages-sheet__body">
        <SignerAppNotice
          v-if="signerState"
          :state="signerState"
          :kind="signerKind"
          :busy="signerBusy"
          @turn-on="turnOnMessages"
          @retry="retrySigner"
        />
        <p v-if="!knownRows.length && !unknownRows.length" class="messages-sheet__empty">
          {{ $t('No messages yet') }}
        </p>

        <template v-for="section in sections" :key="section.id">
          <h3 v-if="section.label" class="messages-sheet__label">{{ section.label }}</h3>
          <ul class="messages-sheet__list">
            <li v-for="row in section.rows" :key="row.key">
              <button type="button" class="thread-row" :aria-label="rowLabel(row)" @click="open(row)">
                <ContactAvatar class="thread-row__avatar" :entry="row.avatarEntry" />
                <span class="thread-row__copy">
                  <span class="thread-row__name">{{ row.name }}</span>
                  <span class="thread-row__preview" :class="{ 'thread-row__preview--unread': row.unread > 0 }">
                    {{ row.preview }}
                  </span>
                </span>
                <span class="thread-row__meta">
                  <span class="thread-row__time">{{ row.time }}</span>
                  <span
                    v-if="row.badge"
                    class="thread-row__badge"
                    :class="{ 'thread-row__badge--muted': row.muted }"
                    aria-hidden="true"
                  >{{ row.badge }}</span>
                </span>
              </button>
            </li>
          </ul>
        </template>
      </div>
    </section>
  </q-dialog>
</template>

<script>
import { nip19 } from 'nostr-core'
import { Icon } from '@iconify/vue'
import ContactAvatar from '../AddressBook/ContactAvatar.vue'
import { useMessagesStore } from '../../stores/messages.js'
import { useAddressBookStore } from '../../stores/addressBook.js'
import { useWalletStore } from '../../stores/wallet.js'
import { formatSats } from './chatFormat.js'
import { buildThreadRows } from './threadRows.js'
import SignerAppNotice from './SignerAppNotice.vue'
import { useSignerAppNotice } from '../../composables/useSignerAppNotice.js'
import './chatTokens.css'

let sheetCount = 0

export default {
  name: 'MessagesSheet',
  components: { Icon, ContactAvatar, SignerAppNotice },
  props: {
    modelValue: { type: Boolean, default: false }
  },
  emits: ['update:modelValue'],
  setup() {
    const signerNotice = useSignerAppNotice()
    return {
      signerState: signerNotice.state,
      signerKind: signerNotice.kind,
      signerBusy: signerNotice.busy,
      turnOnMessages: signerNotice.turnOn,
      retrySigner: signerNotice.retry,
      messages: useMessagesStore(),
      addressBook: useAddressBookStore(),
      wallet: useWalletStore(),
      titleId: `messages-sheet-title-${++sheetCount}`
    }
  },
  computed: {
    env() {
      return {
        t: (key, params) => this.$t(key, params),
        locale: this.$i18n?.locale,
        formatAmount: sats => formatSats(sats, this.wallet.useBip177Format),
        findContact: pubkey => this.addressBook.findContactByPubkey(pubkey),
        toNpub: pubkey => {
          try { return nip19.npubEncode(pubkey) } catch { return pubkey }
        }
      }
    },
    knownRows() {
      return buildThreadRows(this.messages.knownThreads, this.env)
    },
    unknownRows() {
      return buildThreadRows(this.messages.unknownThreads, this.env)
    },
    /** Contacts need no heading; the unknown ones are labelled, never mixed in. */
    sections() {
      const sections = []
      if (this.knownRows.length) sections.push({ id: 'known', label: '', rows: this.knownRows })
      if (this.unknownRows.length) {
        sections.push({ id: 'unknown', label: this.$t('Not in your contacts'), rows: this.unknownRows })
      }
      return sections
    }
  },
  methods: {
    rowLabel(row) {
      return row.unread > 0 ? `${row.name}, ${this.$t('New messages')}: ${row.unread}` : row.name
    },
    async open(row) {
      // Navigate first, close after: the list stays until the chat page is there, so nothing
      // flashes back to the address book in between.
      await this.$router.push(row.to)
      this.$emit('update:modelValue', false)
    }
  }
}
</script>

<style scoped>
.messages-sheet {
  /* Quasar only makes a dialog's direct child <div> tappable; this root is a <section>. */
  pointer-events: all;
  width: 100%;
  max-width: 520px;
  max-height: min(86vh, calc(100vh - var(--safe-top, 0px) - 8px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  background: var(--bg-card);
  border-top: 1px solid var(--border-card);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  padding-bottom: max(1rem, var(--safe-bottom, 0px));
}

.messages-sheet__grab {
  flex: 0 0 auto;
  width: 36px;
  height: 4px;
  margin: 8px auto 4px;
  border-radius: 999px;
  background: var(--text-muted);
  opacity: 0.45;
}

.messages-sheet__top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px 4px 20px;
}
.messages-sheet__title { flex: 1; min-width: 0; margin: 0; font-size: 1.125rem; font-weight: 750; line-height: 1.3; letter-spacing: normal; }
.messages-sheet__close {
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

.messages-sheet__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 18px 8px;
}

.messages-sheet__empty {
  margin: 24px 0;
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.messages-sheet__label {
  margin: 14px 2px 4px;
  font-size: 10.5px;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.messages-sheet__list { margin: 0; padding: 0; list-style: none; }
.messages-sheet__list li + li { border-top: 1px solid var(--border-card); }

.thread-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 62px;
  padding: 10px 2px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.thread-row:active { background: rgba(127, 127, 127, 0.06); }
.thread-row:focus-visible { outline: 2px solid var(--chat-focus, var(--brand-accent)); outline-offset: 2px; border-radius: 8px; }

.thread-row__avatar { width: 40px; height: 40px; min-width: 40px; border-radius: 50%; overflow: hidden; flex-shrink: 0; }

.thread-row__copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.thread-row__name { font-size: 0.9375rem; font-weight: 700; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thread-row__preview { font-size: 0.8125rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thread-row__preview--unread { color: var(--text-primary); font-weight: 600; }

.thread-row__meta { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.thread-row__time { font-size: 0.6875rem; color: var(--text-muted); }
.thread-row__badge {
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  box-sizing: border-box;
  background: var(--brand-accent);
  color: var(--chat-on-accent, #04150b);
  font: 800 10px/1 'Manrope', sans-serif;
}
.thread-row__badge--muted { background: var(--text-muted); color: var(--bg-card); }
</style>
