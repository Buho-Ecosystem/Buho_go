<template>
  <q-page class="contact-profile-page">
    <!-- Header — header-owns-inset pattern; sticky top stays 0. -->
    <div class="page-header">
      <q-btn flat round dense @click="$router.back()" class="back-btn glass-back-btn" :aria-label="$t('Back')">
        <Icon icon="tabler:chevron-left" width="20" height="20" />
      </q-btn>
      <div class="header-title">{{ $t('Contact') }}</div>
      <q-btn
        flat
        round
        dense
        class="header-more"
        :aria-label="$t('More options')"
      >
        <Icon icon="tabler:dots-vertical" width="18" height="18" />
        <q-menu anchor="bottom right" self="top right">
          <q-list style="min-width: 180px">
            <q-item clickable v-close-popup @click="showEdit = true">
              <q-item-section avatar style="min-width: 32px;">
                <Icon icon="tabler:pencil" width="15" height="15" style="color: var(--text-secondary)" />
              </q-item-section>
              <q-item-section>{{ $t('Edit') }}</q-item-section>
            </q-item>
            <q-separator />
            <q-item clickable v-close-popup @click="showRemoveConfirm = true">
              <q-item-section avatar style="min-width: 32px;">
                <Icon icon="tabler:trash" width="15" height="15" style="color: #EF4444" />
              </q-item-section>
              <q-item-section style="color: #EF4444;">{{ $t('Remove') }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </div>

    <div v-if="entry" class="profile-content">
      <!-- Identity: avatar with the favorite star riding it, then the name. -->
      <div class="profile-id">
        <span class="profile-avatar-wrap">
          <ContactAvatar class="profile-avatar" :entry="entry" />
          <button
            type="button"
            class="profile-star"
            :class="{ 'profile-star--on': entry.isFavorite }"
            :aria-label="entry.isFavorite ? $t('Remove from favorites') : $t('Add to favorites')"
            @click="onToggleFavorite"
          >
            <Icon :icon="entry.isFavorite ? 'tabler:star-filled' : 'tabler:star'" width="13" height="13" />
          </button>
        </span>
        <strong class="profile-name">{{ entry.name }}</strong>
        <span v-if="entry.notes" class="profile-notes">{{ entry.notes }}</span>
      </div>

      <!-- The address, copyable in place. Identity-only contacts show the
           calm no-address state instead; paying still explains + re-checks. -->
      <button v-if="entryAddress" type="button" class="profile-addr" @click="copyAddress">
        <code>{{ entryAddress }}</code>
        <Icon :icon="addressCopied ? 'tabler:check' : 'tabler:copy'" width="14" height="14" />
      </button>
      <div v-else class="profile-addr profile-addr--empty">
        <Icon icon="tabler:hourglass-empty" width="14" height="14" />
        <span>{{ $t('No address yet') }}</span>
      </div>

      <button type="button" class="profile-pay" @click="onPay">
        {{ $t('Pay {name}', { name: entry.name }) }}
      </button>

      <!-- Payments between you, from the wallets' own histories joined
           with the app's tx-to-contact links. Outgoing only: what YOU
           sent this person. -->
      <div class="profile-sec-label">{{ $t('Between you') }}</div>
      <div v-if="historyLoading" class="profile-history-note">
        <q-spinner size="15px" />
        <span>{{ $t('Checking') }}</span>
      </div>
      <template v-else-if="history.length > 0">
        <div class="profile-history">
          <div v-for="tx in history" :key="tx.sourceKey" class="profile-tx">
            <span class="profile-tx-icon">
              <Icon icon="tabler:arrow-up-right" width="15" height="15" />
            </span>
            <span class="profile-tx-copy">
              <strong>{{ $t('Sent') }}</strong>
              <small>{{ formatTxDate(tx) }}</small>
            </span>
            <span class="profile-tx-amt">{{ formatSats(tx.amountSats) }} {{ $t('sats') }}</span>
          </div>
        </div>
        <p class="profile-history-note">{{ $t('Payments you made to this contact.') }}</p>
      </template>
      <p v-else class="profile-history-note">{{ $t('No payments between you yet.') }}</p>
    </div>

    <!-- Edit reuses the same modal the add flow owns. -->
    <AddressBookModal
      v-model="showEdit"
      :entry="entry"
      @saved="showEdit = false"
    />

    <!-- Remove confirmation -->
    <q-dialog v-model="showRemoveConfirm" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="delete-confirm-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="delete-header">
          <div class="delete-icon-wrapper">
            <Icon icon="tabler:trash" width="32" height="32" class="delete-icon"/>
          </div>
          <div class="delete-title">{{ $t('Delete Contact') }}</div>
          <div class="delete-message" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('Are you sure you want to delete') }} <strong>{{ entry?.name }}</strong>{{ $t('?') }}
          </div>
        </q-card-section>

        <q-card-actions class="delete-actions">
          <q-btn
            flat
            no-caps
            :label="$t('Cancel')"
            @click="showRemoveConfirm = false"
            class="cancel-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          />
          <q-btn
            unelevated
            no-caps
            :label="$t('Delete')"
            @click="executeRemove"
            class="delete-action-btn"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue'
import { useAddressBookStore } from '../stores/addressBook'
import { useWalletStore } from '../stores/wallet'
import { useTransactionMetadataStore } from '../stores/transactionMetadata'
import { usePayContact } from '../composables/usePayContact'
import { normalizeTx } from '../services/txNormalizer.js'
import ContactAvatar from '../components/AddressBook/ContactAvatar.vue'
import AddressBookModal from '../components/AddressBook/AddressBookModal.vue'

/** How many payments the Between-you list shows. */
const HISTORY_LIMIT = 8

export default {
  name: 'ContactProfilePage',

  components: { Icon, ContactAvatar, AddressBookModal },

  setup() {
    return {
      addressBook: useAddressBookStore(),
      walletStore: useWalletStore(),
      txMetadata: useTransactionMetadataStore(),
    }
  },

  data() {
    return {
      showEdit: false,
      showRemoveConfirm: false,
      addressCopied: false,
      history: [],
      historyLoading: false,
      _copyTimer: null,
      _historyToken: 0,
    }
  },

  computed: {
    /** Live from the store, so an edit or a favorite toggle re-renders. */
    entry() {
      return this.addressBook.getEntryById(this.$route.params.id) || null
    },

    entryAddress() {
      if (!this.entry) return ''
      return this.entry.address || this.entry.lightningAddress || ''
    },
  },

  async created() {
    await this.addressBook.initialize()
    // Deep link to a contact that no longer exists (removed, or another
    // identity's list): back to the book rather than a blank page.
    if (!this.entry) {
      this.$router.replace('/address-book')
      return
    }
    this.loadHistory()
  },

  beforeUnmount() {
    if (this._copyTimer) clearTimeout(this._copyTimer)
  },

  methods: {
    onPay() {
      // Shared composable: handles the identity-only explain + re-sync
      // path exactly like the list rows do.
      usePayContact(this).payContact(this.entry)
    },

    async onToggleFavorite() {
      await this.addressBook.toggleFavorite(this.entry.id)
    },

    async copyAddress() {
      if (!this.entryAddress) return
      try {
        await navigator.clipboard.writeText(this.entryAddress)
        this.addressCopied = true
        if (this._copyTimer) clearTimeout(this._copyTimer)
        this._copyTimer = setTimeout(() => { this.addressCopied = false }, 1600)
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800 })
      }
    },

    async executeRemove() {
      try {
        await this.addressBook.deleteEntry(this.entry.id)
        this.showRemoveConfirm = false
        this.$q.notify({ type: 'positive', message: this.$t('Contact removed') })
        this.$router.back()
      } catch {
        this.$q.notify({ type: 'negative', message: this.$t("Couldn't delete contact") })
      }
    },

    /**
     * Outgoing payments to this contact, joined from every available
     * provider's history: a tx counts when its own address matches the
     * contact's, or when the durable metadata link names this contact.
     * Best effort — a provider that cannot answer contributes nothing.
     */
    async loadHistory() {
      const token = ++this._historyToken
      const contactId = this.entry?.id
      const address = this.entryAddress.trim().toLowerCase()
      if (!contactId && !address) return

      const sources = this.walletStore.wallets
        .map((wallet) => ({ wallet, provider: this.walletStore.providers?.[wallet.id] }))
        .filter(({ provider }) => typeof provider?.getTransactions === 'function')
      if (!sources.length) return

      this.historyLoading = true
      try {
        const batches = await Promise.all(sources.map(async ({ wallet, provider }) => {
          try {
            const result = await provider.getTransactions({ limit: 100, offset: 0 })
            const raw = Array.isArray(result) ? result : (result?.transactions || [])
            return raw.map((r) => {
              const tx = normalizeTx(r, { walletType: wallet.type })
              const meta = this.txMetadata.getMetadataForTransaction(tx.id, wallet.id) || {}
              const txAddress = String(tx.lnaddress || '').trim().toLowerCase()
              const metaAddress = String(meta.recipientAddress || '').trim().toLowerCase()
              const matches =
                (address && (txAddress === address || metaAddress === address))
                || (contactId && meta.contactId === contactId)
              return {
                ...tx,
                sourceKey: `${wallet.id}:${tx.id || tx.timestamp}`,
                amountSats: tx.recipientSats || Math.abs(Number(tx.amount) || 0),
                timeMs: this.txTimeMs(tx),
                matches,
              }
            })
          } catch {
            return []
          }
        }))

        if (token !== this._historyToken) return
        this.history = batches
          .flat()
          .filter((tx) => (
            tx.matches
            && tx.type === 'outgoing'
            && !['pending', 'failed', 'expired'].includes(tx.status)
          ))
          .sort((a, b) => b.timeMs - a.timeMs)
          .slice(0, HISTORY_LIMIT)
      } finally {
        if (token === this._historyToken) this.historyLoading = false
      }
    },

    txTimeMs(tx) {
      const raw = tx?.settled_at ?? tx?.created_at ?? tx?.timestamp ?? tx?.time
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw < 1e12 ? raw * 1000 : raw
      }
      const parsed = Date.parse(raw)
      return Number.isFinite(parsed) ? parsed : 0
    },

    formatTxDate(tx) {
      if (!tx.timeMs) return ''
      try {
        return new Intl.DateTimeFormat(this.$i18n?.locale || undefined, {
          day: 'numeric',
          month: 'long',
        }).format(new Date(tx.timeMs))
      } catch {
        return new Date(tx.timeMs).toLocaleDateString()
      }
    },

    formatSats(n) {
      return new Intl.NumberFormat().format(Math.max(0, Math.floor(n || 0)))
    },
  },
}
</script>

<style scoped>
.contact-profile-page {
  background: var(--bg-secondary);
  min-height: 100vh;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
  padding-top: 0;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(0.75rem + var(--safe-top, 0px)) 1rem 0.75rem;
  background: var(--bg-primary);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-title {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
  flex: 1;
  text-align: center;
}

.header-more {
  width: 40px;
  color: var(--text-secondary);
}

.profile-content {
  padding: 0.5rem 1rem calc(2rem + var(--safe-bottom, 0px));
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

.profile-id {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 0 4px;
  text-align: center;
}

.profile-avatar-wrap {
  position: relative;
}

.profile-avatar {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  overflow: hidden;
  display: block;
}

/* The favorite control rides the avatar, neobank style. */
.profile-star {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 0;
  background: var(--bg-card);
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.22), inset 0 0 0 1px var(--border-card);
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.profile-star--on {
  color: var(--brand-accent-text, var(--color-green));
}

.profile-name {
  font-size: 20px;
  font-weight: 780;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.profile-notes {
  font-size: 12.5px;
  color: var(--text-secondary);
  max-width: 40ch;
  line-height: 1.45;
}

.profile-addr {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: var(--bg-input);
  border-radius: 12px;
  padding: 10px 12px;
  margin: 14px 0 10px;
  color: var(--text-muted);
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}

.profile-addr code {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-primary);
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.profile-addr--empty {
  cursor: default;
  font-size: 12.5px;
}

.profile-pay {
  width: 100%;
  height: 46px;
  border-radius: 23px;
  border: 0;
  background: #1A1A1C;
  color: #FAF7EF;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 750;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

body.body--dark .profile-pay {
  background: #F4F4F4;
  color: #0C0C0C;
}

.profile-pay:active {
  transform: scale(0.99);
}

.profile-sec-label {
  font-size: 10.5px;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin: 22px 2px 6px;
}

.profile-history {
  display: flex;
  flex-direction: column;
}

.profile-tx {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 2px;
}

.profile-tx + .profile-tx {
  border-top: 1px solid var(--border-card);
}

.profile-tx-icon {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--bg-input);
  color: var(--text-muted);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.profile-tx-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.profile-tx-copy strong {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text-primary);
}

.profile-tx-copy small {
  font-size: 11px;
  color: var(--text-muted);
}

.profile-tx-amt {
  font-size: 13px;
  font-weight: 750;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.profile-history-note {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 6px 2px 0;
}
</style>
