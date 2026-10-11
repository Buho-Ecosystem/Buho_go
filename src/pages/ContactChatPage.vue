<!--
  ContactChatPage
  The contact chat (docs/CONTACT_CHAT.md section 2): money first, short
  end-to-end encrypted messages second.

    /address-book/:id/chat   a saved contact
    /messages/:pubkey        a sender who is not in the address book ("unknown"
                             mode: banner with add contact / block, no
                             reactions, their requests are drawn untrusted).
                             The route notifications use. Once the sender is
                             saved the page moves to the contact route.

  This file is layout, navigation and dialogs. What the thread shows and what
  the actions do lives in composables/useContactChat.js (view-model, tested
  under Node); the only way to act on the chat is `useChatRuntime()`.

  Paying (a request's Pay, or Send) is handed to the existing pipeline
  (usePayContact -> /wallet -> confirm sheet with "Pay with"). The chat is gone
  by the time that payment succeeds, so the announcement to the partner is not
  made here: see services/dm/paymentAnnouncer.js.

  Height: the page is as tall as the visible viewport (`visualViewport` where
  there is one, so the composer sits above the on-screen keyboard on iOS too;
  Android resizes the WebView and `100dvh` follows).
-->
<template>
  <q-page class="contact-chat-page" :style-fn="pageStyle">
    <!-- Not ready: loading, no identity, or a contact without a Nostr profile. -->
    <div v-if="view !== 'chat'" class="chat-state" :style="viewportStyle">
      <button type="button" class="chat-state__back" :aria-label="$t('Back')" @click="goBack">
        <Icon icon="tabler:chevron-left" width="22" height="22" />
      </button>

      <div v-if="view === 'loading'" class="chat-state__body" role="status">
        <q-spinner size="28px" color="grey-6" />
      </div>

      <div v-else-if="view === 'no-identity'" class="chat-state__body">
        <span class="chat-state__icon"><Icon icon="tabler:lock" width="26" height="26" /></span>
        <p class="chat-state__text">{{ $t('Set up your identity to use the chat.') }}</p>
        <button type="button" class="chat-state__action" @click="$router.push('/identity')">
          {{ $t('Set up identity') }}
        </button>
      </div>

      <div v-else class="chat-state__body">
        <span class="chat-state__icon"><Icon icon="tabler:message-off" width="26" height="26" /></span>
        <p class="chat-state__text">
          {{ $t("{name} has no Nostr profile, so there is no chat. You can still pay them.", { name: displayName }) }}
        </p>
        <button type="button" class="chat-state__action" @click="openProfile">
          {{ $t('Profile') }}
        </button>
      </div>
    </div>

    <div v-else class="chat" :style="viewportStyle">
      <ChatHeader
        ref="header"
        :name="displayName"
        :payments-only="paymentsOnly"
        :unknown="unknown"
        @back="goBack"
        @open-profile="openProfile"
        @menu="openMenu"
      >
        <template #avatar>
          <ContactAvatar class="chat-avatar" :entry="avatarEntry" :name="displayName" />
        </template>
      </ChatHeader>

      <q-menu v-model="menuOpen" :target="menuTarget" no-parent-event anchor="bottom right" self="top right">
        <q-list class="chat-menu" style="min-width: 190px">
          <q-item v-if="contact" v-close-popup clickable @click="openProfile">
            <q-item-section avatar class="chat-menu__icon">
              <Icon icon="tabler:user" width="18" height="18" />
            </q-item-section>
            <q-item-section>{{ $t('View profile') }}</q-item-section>
          </q-item>
          <q-item v-else v-close-popup clickable @click="addContact">
            <q-item-section avatar class="chat-menu__icon">
              <Icon icon="tabler:user-plus" width="18" height="18" />
            </q-item-section>
            <q-item-section>{{ $t('Add contact') }}</q-item-section>
          </q-item>
          <q-item v-if="contact" v-close-popup clickable @click="toggleMute">
            <q-item-section avatar class="chat-menu__icon">
              <Icon :icon="muted ? 'tabler:bell' : 'tabler:bell-off'" width="18" height="18" />
            </q-item-section>
            <q-item-section>{{ muted ? $t('Unmute') : $t('Mute') }}</q-item-section>
          </q-item>
          <q-separator />
          <q-item v-if="blocked" v-close-popup clickable @click="unblock">
            <q-item-section avatar class="chat-menu__icon">
              <Icon icon="tabler:circle-check" width="18" height="18" />
            </q-item-section>
            <q-item-section>{{ $t('Unblock') }}</q-item-section>
          </q-item>
          <q-item v-else v-close-popup clickable @click="blockOpen = true">
            <q-item-section avatar class="chat-menu__icon chat-menu__icon--danger">
              <Icon icon="tabler:ban" width="18" height="18" />
            </q-item-section>
            <q-item-section class="chat-menu__danger">{{ $t('Block') }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>

      <ChatThread
        ref="thread"
        :items="items"
        :partner-name="displayName"
        :bip177="bip177"
        @react="onReact"
        @reply="onReply"
        @copy="onCopy"
        @retry="onRetry"
        @pay-request="onPayRequest"
        @decline-request="onDecline"
        @remind-request="onRemind"
        @withdraw-request="onWithdraw"
        @send-anyway-request="onSendAnyway"
        @request-again="onRequestAgain"
        @open-payment="openProfile"
      >
        <template #header>
          <UnknownSenderBanner
            v-if="unknown"
            :npub="npub"
            @add-contact="addContact"
            @block="blockOpen = true"
          />
        </template>
        <template #empty>
          <p class="chat-empty">
            {{ paymentsOnly
              ? $t("{name} can't receive messages yet. You can still send money.", { name: displayName })
              : $t('Nothing here yet. Request or send money to get started.') }}
          </p>
        </template>
      </ChatThread>

      <div v-if="blocked" class="chat-blocked" role="status">
        <span class="chat-blocked__text">{{ $t('You blocked {name}.', { name: displayName }) }}</span>
        <button type="button" class="chat-blocked__action" @click="unblock">{{ $t('Unblock') }}</button>
      </div>
      <MoneyBar
        v-else
        v-model="mode"
        :can-message="!paymentsOnly"
        :send-disabled="unknown"
        @request="onRequest"
        @send="onSend"
      >
        <Composer
          ref="composer"
          v-model="draft"
          :secret-key-warning="secretKeyWarning"
          :reply="replyPreview"
          @send="onSendText"
          @cancel-reply="replyToId = null"
        />
      </MoneyBar>
    </div>

    <RequestSheet
      v-model="requestOpen"
      :partner-name="displayName"
      :address="profile.lud16 || ''"
      :format-fiat="formatFiat"
      :submitting="requestSubmitting"
      :error="requestError"
      :bip177="bip177"
      @open-address="getPaidOpen = true"
      @submit="onSubmitRequest"
    />

    <!-- The contact has no inbox: a request cannot be delivered. Offer the payment link instead. -->
    <q-dialog v-model="linkOpen">
      <div class="chat-dialog" role="alertdialog" :aria-label="$t('Payment request')">
        <span class="chat-dialog__icon"><Icon icon="tabler:link" width="26" height="26" /></span>
        <p class="chat-dialog__title">{{ $t("{name} can't receive requests in the chat yet.", { name: displayName }) }}</p>
        <p class="chat-dialog__text">
          {{ $t('Share your payment link instead. They can pay it from any wallet.') }}
        </p>
        <button type="button" class="chat-dialog__primary" @click="shareLink">
          {{ $t('Share payment link') }}
        </button>
        <button type="button" class="chat-dialog__quiet" @click="linkOpen = false">
          {{ $t('Close') }}
        </button>
      </div>
    </q-dialog>
    <IdentityGetPaidSheet v-model="getPaidOpen" />

    <!-- Block: confirm first, it cannot be done by accident. -->
    <q-dialog v-model="blockOpen">
      <div class="chat-dialog" role="alertdialog" :aria-label="$t('Block')">
        <span class="chat-dialog__icon chat-dialog__icon--danger"><Icon icon="tabler:ban" width="26" height="26" /></span>
        <p class="chat-dialog__title">{{ $t('Block {name}?', { name: displayName }) }}</p>
        <p class="chat-dialog__text">{{ $t('You will no longer receive messages or requests from them.') }}</p>
        <button type="button" class="chat-dialog__danger" @click="confirmBlock">
          {{ $t('Block') }}
        </button>
        <button type="button" class="chat-dialog__quiet" @click="blockOpen = false">
          {{ $t('Cancel') }}
        </button>
      </div>
    </q-dialog>

    <!-- Add contact: the existing flow, opened on the sender's npub. -->
    <AddressBookModal
      v-model="addOpen"
      initial-tab="search"
      :initial-query="npub"
      @saved="onContactSaved"
      @open-existing="onContactSaved"
    />
  </q-page>
</template>

<script>
import { getCurrentInstance } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { Icon } from '@iconify/vue'
import { nip19 } from 'nostr-core'
import ChatHeader from '../components/chat/ChatHeader.vue'
import ChatThread from '../components/chat/ChatThread.vue'
import MoneyBar from '../components/chat/MoneyBar.vue'
import Composer from '../components/chat/Composer.vue'
import RequestSheet from '../components/chat/RequestSheet.vue'
import UnknownSenderBanner from '../components/chat/UnknownSenderBanner.vue'
import ContactAvatar from '../components/AddressBook/ContactAvatar.vue'
import AddressBookModal from '../components/AddressBook/AddressBookModal.vue'
import IdentityGetPaidSheet from '../components/identity/IdentityGetPaidSheet.vue'
import { shortNpub } from '../components/chat/chatFormat.js'
import { useMessagesStore } from '../stores/messages.js'
import { useAddressBookStore } from '../stores/addressBook.js'
import { useWalletStore } from '../stores/wallet.js'
import { useProfileStore } from '../stores/profile.js'
import { useChatRuntime } from '../composables/useChatRuntime.js'
import { usePayContact } from '../composables/usePayContact.js'
import { useContactChat } from '../composables/useContactChat.js'
import { containsSecretKey } from '../services/dm/protocol.js'
import { contactChatRoute } from '../services/dm/runtime.js'
import { loadIncomingTransactions } from '../services/dm/incomingTransactions.js'
import { normalizeTx } from '../services/txNormalizer.js'
import { fiatRatesService } from '../utils/fiatRates.js'
import { onAppVisibility } from '../utils/appVisibility.js'
import { shareContent } from '../utils/share.js'
import { knownFeeReserveSats, listPayingWallets, pickDefaultPayingWallet } from '../utils/payingWallets.js'

const HEX_64 = /^[0-9a-f]{64}$/

/** How long a toast stays; errors a little longer than confirmations. */
const TOAST_MS = 2200
const TOAST_ERROR_MS = 4000

export default {
  name: 'ContactChatPage',

  components: {
    Icon, ChatHeader, ChatThread, MoneyBar, Composer, RequestSheet, UnknownSenderBanner,
    ContactAvatar, AddressBookModal, IdentityGetPaidSheet,
  },

  setup() {
    const { proxy } = getCurrentInstance()
    const t = (key, params) => proxy.$t(key, params)
    const $q = useQuasar()
    const route = useRoute()
    const router = useRouter()

    const store = useMessagesStore()
    const addressBook = useAddressBookStore()
    const walletStore = useWalletStore()
    const profile = useProfileStore()
    const runtime = useChatRuntime()

    // Who the chat is with. `/address-book/:id/chat` names a contact,
    // `/messages/:pubkey` a pubkey; both end in a partner pubkey (null while
    // it is not known, or for a contact without a Nostr profile).
    const routePubkey = () => {
      const value = route.params.pubkey
      return typeof value === 'string' && HEX_64.test(value) ? value : null
    }
    const contact = () => {
      const id = route.params.id
      if (typeof id === 'string') return addressBook.getEntryById(id) || null
      const pubkey = routePubkey()
      return pubkey ? addressBook.findContactByPubkey(pubkey) : null
    }
    const partner = () => {
      const entry = contact()
      if (entry) return HEX_64.test(entry.nostr_pubkey || '') ? entry.nostr_pubkey : null
      return routePubkey()
    }
    const displayName = () => {
      const entry = contact()
      if (entry) return entry.name || ''
      const key = partner()
      return key ? shortNpubOf(key) : ''
    }

    const fiatCode = () => walletStore.preferredFiatCurrency || 'USD'
    const formatFiat = (sats) => {
      try {
        const value = fiatRatesService.convertSatsToFiatSync(sats, fiatCode())
        return value === null || value === undefined ? '' : `≈ ${fiatRatesService.formatFiatAmount(value, fiatCode())}`
      } catch {
        return ''
      }
    }

    /** The wallet "Pay with" starts with for a payment of `amountSats` over `destinationType`. */
    const payingWalletFor = (amountSats, destinationType = 'lightning') => pickDefaultPayingWallet(listPayingWallets({
      wallets: walletStore.wallets || [],
      activeWalletId: walletStore.activeWalletId,
      balances: walletStore.balances || {},
      connectionStates: walletStore.connectionStates || {},
      destinationType,
      amountSats,
      feeReserve: knownFeeReserveSats(destinationType, null),
    }))

    const chat = useContactChat({
      partner,
      partnerName: displayName,
      unknown: () => !contact(),
      contact,
      store,
      runtime,
      pay: usePayContact({ $q, $t: t, $router: router }),
      payingWalletFor,
      loadIncomingTransactions: () => loadIncomingTransactions({
        wallets: walletStore.wallets || [],
        getProvider: (id) => walletStore.providers?.[id],
        normalizeTx,
      }),
      walletNameOf: (walletId) => {
        const wallet = (walletStore.wallets || []).find((entry) => entry.id === walletId)
        return wallet?.name || ''
      },
      t,
      formatFiat,
    })

    return { t, router, store, addressBook, walletStore, profile, runtime, chat, partner, contact, partnerName: displayName, formatFiat }
  },

  data() {
    return {
      /** Address book loaded (contact lookups are meaningful). */
      bookReady: false,
      /** 'money' | 'text' (MoneyBar). */
      mode: 'money',
      draft: '',
      replyToId: null,
      requestOpen: false,
      requestSubmitting: false,
      requestError: '',
      linkOpen: false,
      getPaidOpen: false,
      blockOpen: false,
      addOpen: false,
      menuOpen: false,
      /** The header's ⋮ button while the menu is open; `false` = no anchor yet. */
      menuTarget: false,
      viewportHeight: null,
      viewportTop: 0,
      /** The partner whose chat was opened (guards against opening it twice). */
      activeKey: null,
    }
  },

  computed: {
    unknown() {
      return !this.contact()
    },
    contactEntry() {
      return this.contact()
    },
    partnerKey() {
      return this.partner()
    },
    displayName() {
      return this.partnerName()
    },
    npub() {
      return this.partnerKey ? npubOf(this.partnerKey) : ''
    },
    /** What ContactAvatar draws: the entry, or nothing (the silhouette) for a stranger. */
    avatarEntry() {
      return this.contact() || {}
    },
    bip177() {
      return this.walletStore.useBip177Format !== false
    },
    blocked() {
      return this.partnerKey ? this.store.isBlocked(this.partnerKey) : false
    },
    muted() {
      return this.partnerKey ? this.store.thread(this.partnerKey).muted : false
    },

    /** 'loading' | 'no-identity' | 'no-nostr' | 'chat' */
    view() {
      if (!this.runtime.available.value) return 'no-identity'
      if (!this.bookReady) return 'loading'
      if (!this.partnerKey) return 'no-nostr'
      if (this.store.scope !== this.runtime.me.value) return 'loading'
      return 'chat'
    },

    items() {
      return this.chat.items.value
    },
    paymentsOnly() {
      return this.chat.paymentsOnly.value
    },

    secretKeyWarning() {
      return containsSecretKey(this.draft)
    },
    /** { author, text } of the message being answered. */
    replyPreview() {
      if (!this.replyToId) return null
      const item = this.items.find((entry) => entry.key === this.replyToId && entry.type === 'message')
      if (!item) return null
      const text = [...item.message.text.replace(/\s+/g, ' ').trim()].slice(0, 140).join('')
      return { author: item.message.outgoing ? this.t('You') : this.displayName, text }
    },

    viewportStyle() {
      if (this.viewportHeight === null) return {}
      return { height: `${this.viewportHeight}px`, transform: `translateY(${this.viewportTop}px)` }
    },
  },

  watch: {
    // The same page instance serves another chat (a notification tap, a
    // saved sender): start over for the new partner.
    partnerKey() {
      this.activeKey = null
      this.resetConversationState()
      this.activate()
    },
    view() {
      this.activate()
    },
    // A sender who gets saved moves to the contact route.
    contactEntry(entry) {
      if (entry && this.$route.params.pubkey) this.$router.replace(contactChatRoute(entry.id))
    },
    requestOpen(open) {
      if (open) return
      this.requestError = ''
      this.requestSubmitting = false
    },
    mode() {
      this.$nextTick(() => this.$refs.thread?.scrollToBottom?.())
    },
  },

  async created() {
    await this.addressBook.initialize()
    this.bookReady = true
    this.checkRoute()
  },

  mounted() {
    this.syncViewport()
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.syncViewport)
      window.visualViewport.addEventListener('scroll', this.syncViewport)
    }
    this.stopVisibility = onAppVisibility((visible) => {
      // Hidden app: the chat is not being read. Back: read what arrived.
      if (visible) this.chat.resume()
      else this.chat.close()
    })
    this.activate()
  },

  beforeUnmount() {
    this.stopVisibility?.()
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.syncViewport)
      window.visualViewport.removeEventListener('scroll', this.syncViewport)
    }
    this.chat.dispose()
  },

  methods: {
    pageStyle() {
      return { height: '100dvh', minHeight: '100dvh', padding: 0 }
    },

    // ----- route and lifecycle --------------------------------------------

    /** Leave for the address book when the route names nobody we can show. */
    checkRoute() {
      const { id, pubkey } = this.$route.params
      if (typeof id === 'string') {
        if (!this.addressBook.getEntryById(id)) this.$router.replace('/address-book')
        return
      }
      if (typeof pubkey === 'string' && !HEX_64.test(pubkey)) {
        this.$router.replace('/address-book')
        return
      }
      const entry = this.contact()
      if (entry) this.$router.replace(contactChatRoute(entry.id))
    },

    /** The chat is ready and on screen: read it, look up the partner's inbox. */
    activate() {
      if (this.view !== 'chat' || !this.partnerKey || this.activeKey === this.partnerKey) return
      this.activeKey = this.partnerKey
      this.chat.open()
    },

    resetConversationState() {
      this.mode = 'money'
      this.draft = ''
      this.replyToId = null
      this.requestOpen = false
      this.menuOpen = false
    },

    goBack() {
      if (typeof window !== 'undefined' && window.history.state?.back) this.$router.back()
      else this.$router.replace('/address-book')
    },

    openProfile() {
      const entry = this.contact()
      if (entry) this.$router.push(`/address-book/${encodeURIComponent(entry.id)}`)
    },

    openMenu() {
      this.menuTarget = this.$refs.header?.$el?.querySelector?.('[aria-haspopup="menu"]') || false
      this.menuOpen = true
    },

    // ----- viewport ---------------------------------------------------------

    syncViewport() {
      const viewport = typeof window !== 'undefined' ? window.visualViewport : null
      if (!viewport) return
      const height = Math.round(viewport.height)
      const resized = height !== this.viewportHeight
      this.viewportHeight = height
      this.viewportTop = Math.round(viewport.offsetTop)
      // The composer rises with the keyboard: keep the newest message in view.
      if (resized) this.$nextTick(() => this.$refs.thread?.scrollToBottom?.())
    },

    // ----- feedback ---------------------------------------------------------

    toast(message, { error = false } = {}) {
      if (!message) return
      this.$q.notify({ type: error ? 'negative' : 'positive', message, timeout: error ? TOAST_ERROR_MS : TOAST_MS })
    },

    /** Show the words of a failed action; `{ ok: true }` is a no-op. */
    report(result) {
      if (!result || result.ok || !result.error?.message) return result?.ok === true
      this.toast(result.error.message, { error: true })
      return false
    },

    // ----- text -------------------------------------------------------------

    async onSendText() {
      const text = this.draft.trim()
      if (!text || this.secretKeyWarning) return
      const replyTo = this.replyToId
      // Cleared at once; a failed send puts the words back.
      this.draft = ''
      this.replyToId = null
      const result = await this.chat.sendText(text, replyTo ? { replyTo } : {})
      if (!this.report(result)) {
        if (!this.draft) this.draft = text
        if (!this.replyToId) this.replyToId = replyTo
      }
    },

    onReply({ id }) {
      this.replyToId = id
      this.mode = 'text'
      this.$nextTick(() => this.$refs.composer?.focus?.())
    },

    async onCopy({ text }) {
      try {
        await navigator.clipboard.writeText(text)
        this.toast(this.t('Copied'))
      } catch {
        this.toast(this.t("Couldn't copy"), { error: true })
      }
    },

    async onReact({ id, emoji }) {
      this.report(await this.chat.react(id, emoji))
    },

    async onRetry({ id }) {
      this.report(await this.chat.retry(id))
    },

    // ----- requests ---------------------------------------------------------

    onRequest() {
      // The contact cannot receive a message: a request would never arrive.
      if (this.paymentsOnly) {
        this.linkOpen = true
        return
      }
      this.requestError = ''
      this.requestOpen = true
    },

    async onSubmitRequest({ amountSats, note }) {
      this.requestSubmitting = true
      this.requestError = ''
      const result = await this.chat.requestMoney({ amountSats, note })
      this.requestSubmitting = false
      if (result.ok) {
        this.requestOpen = false
        return
      }
      if (result.error?.kind === 'no-inbox') {
        this.requestOpen = false
        this.linkOpen = true
        this.chat.refreshReachability()
        return
      }
      this.requestError = result.error?.message || ''
    },

    async onPayRequest({ id }) {
      this.report(await this.chat.payRequest(id))
    },

    /** The request is over; the money goes through the ordinary send flow, linked to the request. */
    async onSendAnyway({ id }) {
      this.report(await this.chat.sendAnyway(id))
    },

    /** One tap: the same amount and note as a new request. */
    async onRequestAgain({ id }) {
      this.report(await this.chat.requestAgain(id))
    },

    async onDecline({ id }) {
      this.report(await this.chat.decline(id))
    },

    async onRemind({ id }) {
      if (this.report(await this.chat.remind(id))) this.toast(this.t('Reminder sent'))
    },

    async onWithdraw({ id }) {
      this.report(await this.chat.withdraw(id))
    },

    /** No inbox: the payment link (the user's address as a QR and link) is the way to ask. */
    shareLink() {
      this.linkOpen = false
      this.getPaidOpen = true
    },

    // ----- money ------------------------------------------------------------

    onSend() {
      this.report(this.chat.sendMoney())
    },

    // ----- menu: mute, block, add -------------------------------------------

    toggleMute() {
      if (!this.partnerKey) return
      this.store.mute(this.partnerKey, !this.muted)
    },

    confirmBlock() {
      this.blockOpen = false
      if (!this.partnerKey) return
      const name = this.displayName
      this.store.block(this.partnerKey)
      this.toast(this.t('Blocked {name}', { name }))
      this.goBack()
    },

    unblock() {
      if (!this.partnerKey) return
      this.store.unblock(this.partnerKey)
      this.toast(this.t('Unblocked {name}', { name: this.displayName }))
    },

    addContact() {
      this.addOpen = true
    },

    /** The sender is saved (or already was): the contact route takes over via the `contactEntry` watcher. */
    onContactSaved() {
      this.addOpen = false
    },
  },
}

/** `npub1…` of a hex pubkey, '' when it is not one. */
function npubOf(pubkey) {
  try {
    return nip19.npubEncode(pubkey)
  } catch {
    return ''
  }
}

/** An unnamed sender as `npub1abcdef…`: enough to tell people apart, never the whole key. */
function shortNpubOf(pubkey) {
  return shortNpub(npubOf(pubkey)) || `${pubkey.slice(0, 8)}…`
}
</script>

<style scoped>
.contact-chat-page {
  background: var(--bg-secondary);
  font-family: 'Manrope', sans-serif;
  overflow: hidden;
  max-width: 100vw;
}

/* One column: header, scrolling thread, money bar. Its height follows the
   visible viewport (the keyboard shrinks it), set inline by the page. */
.chat {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-secondary);
}

.chat-avatar {
  width: 100%;
  height: 100%;
}

.chat-empty {
  align-self: center;
  max-width: 26ch;
  margin: 24px 0;
  text-align: center;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-muted);
}

/* ---- header menu --------------------------------------------------------- */
.chat-menu__icon {
  min-width: 32px;
  color: var(--text-secondary);
}
.chat-menu__icon--danger,
.chat-menu__danger {
  color: var(--chat-danger);
}

/* ---- states without a chat ---------------------------------------------- */
.chat-state {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: calc(0.5rem + var(--safe-top, 0px)) 0.5rem max(16px, var(--safe-bottom, 0px));
  background: var(--bg-secondary);
}
.chat-state__back {
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
.chat-state__back:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }
.chat-state__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 0 28px 64px;
  text-align: center;
}
.chat-state__icon {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--bg-input);
  color: var(--text-secondary);
}
.chat-state__text {
  max-width: 30ch;
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--text-secondary);
}
.chat-state__action {
  min-height: 46px;
  padding: 0 24px;
  border: 0;
  border-radius: 23px;
  background: var(--chat-pay-bg);
  color: var(--chat-pay-fg);
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 750;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.chat-state__action:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }

/* ---- dialogs ------------------------------------------------------------- */
.chat-dialog {
  width: min(88vw, 340px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px 20px 16px;
  border-radius: var(--radius-lg, 20px);
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  color: var(--text-primary);
  text-align: center;
  font-family: 'Manrope', sans-serif;
}
.chat-dialog__icon {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--bg-input);
  color: var(--text-secondary);
}
.chat-dialog__icon--danger { background: var(--chat-danger-soft); color: var(--chat-danger); }
.chat-dialog__title { margin: 4px 0 0; font-size: 1.0625rem; font-weight: 750; line-height: 1.3; }
.chat-dialog__text { margin: 0 0 6px; font-size: 0.875rem; line-height: 1.5; color: var(--text-secondary); }

.chat-dialog__primary,
.chat-dialog__danger,
.chat-dialog__quiet {
  width: 100%;
  min-height: 46px;
  border: 0;
  border-radius: 23px;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 750;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.chat-dialog__primary { background: var(--chat-pay-bg); color: var(--chat-pay-fg); }
.chat-dialog__danger { background: var(--chat-danger); color: #fff; }
.chat-blocked {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0.5rem 1rem max(0.5rem, var(--safe-bottom, 0px));
  border-top: 1px solid var(--border-card);
  background: var(--bg-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 0.875rem;
  color: var(--text-secondary);
}
.chat-blocked__text { min-width: 0; overflow-wrap: anywhere; }
.chat-blocked__action {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0 14px;
  border: 0;
  border-radius: 22px;
  background: transparent;
  color: var(--brand-accent-text);
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 750;
  cursor: pointer;
}
.chat-blocked__action:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }
.chat-dialog__quiet { background: transparent; color: var(--text-secondary); }
.chat-dialog__primary:focus-visible,
.chat-dialog__danger:focus-visible,
.chat-dialog__quiet:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }
</style>
