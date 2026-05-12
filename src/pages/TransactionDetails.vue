<template>
  <q-page class="transaction-details-page">
    <!-- Header -->
    <div class="page-header">
      <q-btn
        flat
        round
        dense
        @click="$router.back()"
        class="back-btn"
      >
        <Icon icon="tabler:chevron-left" width="18" height="18" />
      </q-btn>
      <div class="header-title">
        {{ $t('Transaction Details') }}
      </div>
      <div class="header-actions">
        <q-btn
          flat
          round
          dense
          @click="shareTransaction"
          class="share-btn"
        >
          <Icon icon="tabler:share" width="20" height="20" style="color: var(--text-secondary)" />
          <q-tooltip>{{ $t('Share') }}</q-tooltip>
        </q-btn>
        <q-btn
          flat
          round
          dense
          @click="toggleDeveloperMode"
          :class="['dev-toggle', { 'dev-active': showDeveloperMode }]"
        >
          <Icon
            icon="tabler:code"
            width="20"
            height="20"
            :class="showDeveloperMode ? 'dev-icon-active' : 'dev-icon-muted'"
          />
          <div v-if="showDeveloperMode" class="dev-active-dot"></div>
          <q-tooltip>{{ showDeveloperMode ? $t('Hide') : $t('Show') }} {{ $t('Developer Details') }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Skeleton Loading State -->
    <div v-if="loading">
      <!-- Hero Card skeleton -->
      <div class="transaction-hero">
        <div class="hero-card">
          <div class="hero-content">
            <!-- Header: icon + type/status -->
            <div class="hero-header">
              <q-skeleton type="circle" size="40px" animation="wave" />
              <div class="hero-info">
                <q-skeleton type="text" width="120px" height="17px" animation="wave" style="margin-bottom: 4px;" />
                <q-skeleton type="text" width="80px" height="14px" animation="wave" />
              </div>
            </div>
            <!-- Amounts -->
            <div class="hero-amounts">
              <q-skeleton type="text" width="180px" height="28px" animation="wave" style="margin: 0 auto 4px;" />
              <q-skeleton type="text" width="100px" height="14px" animation="wave" style="margin: 0 auto;" />
            </div>
          </div>
        </div>
      </div>

      <!-- Detail Fields skeleton -->
      <div style="padding: 0 1rem;">
        <div class="detail-fields-grid">
          <div v-for="n in 3" :key="'detail-skel-'+n" class="detail-field-group">
            <q-skeleton type="text" width="30%" height="12px" animation="wave" style="margin-bottom: 6px;" />
            <div class="detail-field-container">
              <q-skeleton type="text" width="75%" height="14px" animation="wave" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Transaction Details -->
    <div v-else-if="transaction" class="transaction-content">
      <!-- Transaction Hero Card -->
      <div class="transaction-hero">
        <div class="hero-card">
          <!-- Hero Content: single row -->
          <div class="hero-content">
            <!-- Left: Icon + Type + Status -->
            <div class="hero-left">
              <div class="direction-circle" :class="getDirectionCircleClass()">
                <Icon :icon="getTransactionIcon()" width="20" height="20"/>
              </div>
              <div class="hero-info">
                <div class="hero-type">
                  {{ getTransactionTypeLabel() }}
                </div>
                <div class="hero-status" :class="getStatusClass()">
                  <Icon :icon="getStatusIcon()" width="12" height="12"/>
                  {{ getTransactionStatus() }}
                </div>
              </div>
            </div>

            <!-- Right: Amount + Fiat -->
            <div class="hero-amounts">
              <div class="hero-amount" :class="getAmountClass()">
                {{ getFormattedAmount() }}
              </div>
              <div class="hero-fiat">
                <q-skeleton v-if="loadingFiatRates" type="text" width="60px" height="14px" />
                <template v-else>{{ getFiatAmount() }}</template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Transaction Info -->
      <div class="details-section">
        <div class="section-label">
          {{ $t('TRANSACTION DETAILS') }}
        </div>
        <div class="detail-fields-grid">
          <div class="detail-field-group">
            <div class="detail-field-label">{{ $t('Date & Time') }}</div>
            <div class="detail-field-container">{{ formatDateTime(transaction.settled_at) }}</div>
          </div>

          <div v-if="isBitcoinTransaction()" class="detail-field-group">
            <div class="detail-field-label">{{ $t('Network') }}</div>
            <div class="detail-field-container">{{ $t('Bitcoin L1 (on-chain)') }}</div>
          </div>

          <div v-if="getTransactionDescription()" class="detail-field-group">
            <div class="detail-field-label">{{ $t('Description') }}</div>
            <div class="detail-field-container">{{ getTransactionDescription() }}</div>
          </div>

          <div v-if="transaction.memo && transaction.memo !== getTransactionDescription()" class="detail-field-group">
            <div class="detail-field-label">{{ $t('Memo') }}</div>
            <div class="detail-field-container">{{ transaction.memo }}</div>
          </div>

          <div v-if="getExtraComment()" class="detail-field-group">
            <div class="detail-field-label">{{ $t('Comment') }}</div>
            <div class="detail-field-container">{{ getExtraComment() }}</div>
          </div>

          <div v-if="transaction.fee && transaction.fee > 0" class="detail-field-group">
            <div class="detail-field-label">{{ $t('Fee') }}</div>
            <div class="detail-field-container">{{ formatAmount(transaction.fee, walletStore.useBip177Format) }}</div>
          </div>
        </div>
      </div>

      <!-- Personal Note -->
      <div class="details-section">
        <div class="section-label">
          {{ $t('NOTE') }}
        </div>
        <div class="settings-card detail-card">
          <div class="note-content">
            <q-input
              :model-value="currentNote"
              @update:model-value="debounceSaveNote"
              :placeholder="$t('Add a personal note...')"
              type="textarea"
              autogrow
              borderless
              dense
              input-class="note-input"
              maxlength="500"
            />
          </div>
        </div>
      </div>

      <!-- Nostr Profile Section -->
      <div
        v-if="transaction.senderNpub && nostrProfile"
        class="profile-section"
        @click="viewNostrProfile"
      >
        <div class="profile-card">
          <div class="profile-avatar">
            <q-avatar size="48px">
              <img
                v-if="nostrProfile.picture"
                :src="nostrProfile.picture"
                :alt="nostrProfile.displayName || nostrProfile.name"
              />
              <Icon v-else icon="tabler:user" width="24" height="24" />
            </q-avatar>
          </div>
          <div class="profile-info">
            <div class="profile-name">
              {{ nostrProfile.displayName || nostrProfile.name }}
            </div>
            <div class="profile-meta">
              <Icon icon="tabler:bolt" class="zap-icon q-mr-xs" />
              {{ $t('Zap Transaction') }}
            </div>
            <div class="profile-about" v-if="nostrProfile.about">
              {{ nostrProfile.about }}
            </div>
          </div>
          <Icon icon="tabler:external-link" class="external-icon" />
        </div>
      </div>

      <!-- Contact Assignment Section -->
      <div class="details-section">
        <div class="section-label">
          {{ $t('CONTACT') }}
        </div>
        <div class="settings-card detail-card">
          <q-item v-if="!assignedContact" clickable v-ripple @click="openContactPicker">
            <q-item-section avatar>
              <Icon icon="tabler:user-plus" class="icon-muted" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="item-label">
                {{ $t('Assign Contact') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <Icon icon="tabler:chevron-right" class="chevron-icon" />
            </q-item-section>
          </q-item>

          <q-item v-else>
            <q-item-section avatar>
              <div class="contact-avatar-small" :style="{ backgroundColor: assignedContact.color }">
                {{ assignedContact.name.substring(0, 2).toUpperCase() }}
              </div>
            </q-item-section>
            <q-item-section>
              <q-item-label class="item-label">
                {{ assignedContact.name }}
              </q-item-label>
              <q-item-label caption class="item-caption">
                {{ truncateAddress(assignedContact.address) }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn flat round dense @click="removeContact"
                     class="icon-muted">
                <Icon icon="tabler:x" width="20" height="20" />
                <q-tooltip>{{ $t('Remove Contact') }}</q-tooltip>
              </q-btn>
            </q-item-section>
          </q-item>
        </div>
      </div>

      <!-- Tags Section -->
      <div class="details-section">
        <div class="section-label">
          {{ $t('TAGS') }}
        </div>
        <div class="settings-card detail-card">
          <div class="tags-content">
            <div class="tag-selector">
              <button
                v-for="tag in availableTags"
                :key="tag"
                @click="toggleTag(tag)"
                class="tag-option"
                :class="{
                  selected: isTagSelected(tag),
                  disabled: currentTags.length >= 2 && !isTagSelected(tag)
                }"
                :disabled="currentTags.length >= 2 && !isTagSelected(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Developer Details -->
      <q-slide-transition>
        <div v-show="showDeveloperMode" class="developer-section">
          <div class="developer-card">
            <div class="section-title">
              <Icon icon="tabler:code" class="q-mr-sm" />
              {{ $t('Developer Details') }}
            </div>

            <div class="developer-grid">
              <div class="dev-item" v-if="transaction.id">
                <div class="detail-field-label">
                  {{ $t('Transaction ID') }}
                </div>
                <div class="dev-value hash-value ellipsis"
                     @click="copyToClipboard(transaction.id)">
                  {{ transaction.id }}
                  <Icon icon="tabler:copy" class="copy-icon" />
                </div>
              </div>

              <div class="dev-item" v-if="transaction.payment_hash">
                <div class="detail-field-label">
                  {{ $t('Payment Hash') }}
                </div>
                <div class="dev-value hash-value ellipsis"
                     @click="copyToClipboard(transaction.payment_hash)">
                  {{ transaction.payment_hash }}
                  <Icon icon="tabler:copy" class="copy-icon" />
                </div>
              </div>

              <div class="dev-item" v-if="transaction.preimage">
                <div class="detail-field-label">
                  {{ $t('Preimage') }}
                </div>
                <div class="dev-value hash-value ellipsis"
                     @click="copyToClipboard(transaction.preimage)">
                  {{ transaction.preimage }}
                  <Icon icon="tabler:copy" class="copy-icon" />
                </div>
              </div>

              <div class="dev-item" v-if="transaction.fee">
                <div class="detail-field-label">
                  {{ $t('Fee') }}
                </div>
                <div class="dev-value">
                  {{ formatAmount(transaction.fee, walletStore.useBip177Format) }}
                </div>
              </div>
            </div>

            <!-- Raw Invoice -->
            <div class="raw-section" v-if="transaction.payment_request">
              <div class="detail-field-label">
                {{ $t('Raw Invoice') }}
              </div>
              <div class="raw-content">
                <pre class="raw-text">{{
                    transaction.payment_request
                  }}</pre>
                <q-btn
                  flat
                  dense
                  @click="copyToClipboard(transaction.payment_request)"
                  class="copy-btn"
                >
                  <Icon icon="tabler:copy" width="16" height="16" />
                </q-btn>
              </div>
            </div>

            <!-- Raw JSON -->
            <div class="raw-section">
              <div class="detail-field-label">
                {{ $t('Raw JSON') }}
              </div>
              <div class="raw-content">
                <pre class="raw-text">{{
                    JSON.stringify(transaction, null, 2)
                  }}</pre>
                <q-btn
                  flat
                  dense
                  @click="copyToClipboard(JSON.stringify(transaction, null, 2))"
                  class="copy-btn"
                >
                  <Icon icon="tabler:copy" width="16" height="16" />
                </q-btn>
              </div>
            </div>
          </div>
        </div>
      </q-slide-transition>
    </div>

    <!-- Error State -->
    <div v-else class="error-state">
      <Icon icon="tabler:alert-triangle" style="font-size: 4rem; color: red;" />
      <div class="error-title">
        {{ $t('Transaction Not Found') }}
      </div>
      <div class="error-subtitle">
        {{ $t('The requested transaction could not be found or loaded.') }}
      </div>
      <q-btn
        :label="$t('Go Back')"
        @click="$router.back()"
        class="go-back-btn"
      />
    </div>

    <!-- Contact Picker Modal -->
    <q-dialog v-model="showContactPicker">
      <q-card class="contact-picker-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title">
            {{ $t('Select Contact') }}
          </div>
          <q-btn
            flat
            round
            dense
            v-close-popup
            class="close-btn"
            style="color: var(--text-muted)"
          >
            <Icon icon="tabler:x" width="20" height="20" />
          </q-btn>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="contactSearch"
            :placeholder="$t('Search contacts...')"
            dense
            borderless
            class="search-input"
            input-class="q-px-md"
          >
            <template v-slot:prepend>
              <Icon icon="tabler:search" class="q-ml-sm" style="color: var(--text-muted)" />
            </template>
          </q-input>
        </q-card-section>

        <q-scroll-area style="height: 280px" class="q-px-md">
          <q-list class="contact-list">
            <q-item
              v-for="contact in filteredContacts"
              :key="contact.id"
              clickable
              v-ripple
              @click="assignContact(contact)"
              class="contact-item"
            >
              <q-item-section avatar>
                <div class="contact-avatar-picker" :style="{ backgroundColor: contact.color }">
                  {{ contact.name.substring(0, 2).toUpperCase() }}
                </div>
              </q-item-section>
              <q-item-section>
                <q-item-label class="item-label">
                  {{ contact.name }}
                </q-item-label>
                <q-item-label caption class="contact-address-caption item-caption">
                  {{ truncateAddress(contact.address) }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <Icon icon="tabler:chevron-right" width="18" height="18" class="chevron-icon" />
              </q-item-section>
            </q-item>

            <div v-if="filteredContacts.length === 0" class="empty-contacts-state">
              <Icon icon="tabler:users" width="48" height="48" style="color: var(--text-muted)" />
              <div class="empty-contacts-text">
                {{ $t('No contacts found') }}
              </div>
            </div>
          </q-list>
        </q-scroll-area>

        <q-card-actions class="dialog-actions q-px-md q-pb-md">
          <q-btn
            flat
            :label="$t('Cancel')"
            v-close-popup
            class="full-width"
            style="color: var(--text-secondary)"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { NostrWebLNProvider } from "@getalby/sdk";
import { fiatRatesService } from '../utils/fiatRates.js';
import { formatAmount, formatAmountWithPrefix } from '../utils/amountFormatting.js';
import { useWalletStore } from '../stores/wallet';
import { useAddressBookStore } from '../stores/addressBook';
import { useTransactionMetadataStore } from '../stores/transactionMetadata';
import { shareContent } from '../utils/share';

export default {
  name: 'TransactionDetailsPage',
  components: {},
  data() {
    return {
      loading: true,
      showDeveloperMode: false,
      transaction: null,
      nostrProfile: null,
      walletState: {},
      walletStore: null,
      addressBookStore: null,
      metadataStore: null,
      showLoadingScreen: true,
      fiatRates: {},
      loadingFiatRates: true,
      // Contact picker
      showContactPicker: false,
      contactSearch: '',
      // Available tags
      availableTags: [
        'Groceries',
        'Business',
        'Personal',
        'Entertainment',
        'Bills',
        'Travel',
        'Food & Drink',
        'Shopping',
        'Other'
      ]
    }
  },
  async created() {
    this.walletStore = useWalletStore();
    this.addressBookStore = useAddressBookStore();
    this.metadataStore = useTransactionMetadataStore();

    // Initialize stores
    await this.addressBookStore.initialize();
    await this.metadataStore.initialize();

    this.initializeTransactionDetails();
    this.loadFiatRates();
  },

  watch: {
    'fiatRates': {
      handler() {
        this.$forceUpdate();
      },
      deep: true
    }
  },

  computed: {
    assignedContact() {
      if (!this.transaction || !this.metadataStore) return null;
      const metadata = this.metadataStore.getMetadataForTransaction(this.transaction.id);
      if (!metadata?.contactId) return null;
      return this.addressBookStore.getEntryById(metadata.contactId);
    },

    currentTags() {
      if (!this.transaction || !this.metadataStore) return [];
      return this.metadataStore.getTagsForTransaction(this.transaction.id);
    },

    currentNote() {
      if (!this.transaction || !this.metadataStore) return '';
      return this.metadataStore.getNoteForTransaction(this.transaction.id);
    },

    filteredContacts() {
      if (!this.addressBookStore) return [];
      const entries = [...this.addressBookStore.entries].sort((a, b) => {
        return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
      });
      const query = this.contactSearch.toLowerCase();
      if (!query) return entries;

      return entries.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.address.toLowerCase().includes(query)
      );
    }
  },

  methods: {
    // Notes
    debounceSaveNote(value) {
      clearTimeout(this._noteTimer);
      this._noteTimer = setTimeout(() => {
        this.metadataStore.setNoteForTransaction(this.transaction.id, value);
      }, 500);
    },

    // Contact and Tag methods
    openContactPicker() {
      console.log('Opening contact picker...');
      console.log('Address book entries:', this.addressBookStore?.entries?.length || 0);
      this.showContactPicker = true;
      console.log('showContactPicker set to:', this.showContactPicker);
    },

    async assignContact(contact) {
      try {
        await this.metadataStore.setContactForTransaction(this.transaction.id, contact.id);
        this.showContactPicker = false;
        this.contactSearch = '';

        // Update lastUsedAt in address book
        await this.addressBookStore.updateEntry(contact.id, { lastUsedAt: Date.now() });

        this.$q.notify({
          type: 'positive',
          message: this.$t('Contact assigned'),
          
          timeout: 2000
        });
      } catch (error) {
        console.error('Error assigning contact:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to assign contact'),
          
        });
      }
    },

    async removeContact() {
      try {
        await this.metadataStore.setContactForTransaction(this.transaction.id, null);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Contact removed'),
          
          timeout: 2000
        });
      } catch (error) {
        console.error('Error removing contact:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to remove contact'),
          
        });
      }
    },

    isTagSelected(tag) {
      return this.currentTags.includes(tag);
    },

    async toggleTag(tag) {
      try {
        const currentTags = this.currentTags;

        // Check if tag is already selected
        if (currentTags.includes(tag)) {
          // Remove tag
          const newTags = currentTags.filter(t => t !== tag);
          await this.metadataStore.setTagsForTransaction(this.transaction.id, newTags);
        } else {
          if (currentTags.length >= 2) return;

          // Add tag
          const newTags = [...currentTags, tag];
          await this.metadataStore.setTagsForTransaction(this.transaction.id, newTags);
        }
      } catch (error) {
        console.error('Error toggling tag:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to update tags'),
          
        });
      }
    },

    truncateAddress(address) {
      if (!address || address.length <= 20) return address;
      return `${address.substring(0, 10)}...${address.substring(address.length - 6)}`;
    },

    async initializeTransactionDetails() {
      try {
        await this.loadTransactionDetails();
        this.loadDeveloperModePreference();
        this.showLoadingScreen = false;
      } catch (error) {
        console.error('Error initializing transaction details:', error);
        this.showLoadingScreen = false;
      }
    },

    async loadTransactionDetails() {
      this.loading = true;
      try {
        const txId = this.$route.params.id;

        // Load wallet state
        const savedState = localStorage.getItem('buhoGO_wallet_state');
        if (savedState) {
          this.walletState = JSON.parse(savedState);
        }

        // Try to find transaction in local storage first
        const cachedTransactions = localStorage.getItem('buhoGO_cached_transactions');
        if (cachedTransactions) {
          const transactions = JSON.parse(cachedTransactions);
          this.transaction = transactions.find(tx => tx.id === txId);
        }

        // If not found locally, fetch from wallet
        if (!this.transaction) {
          await this.fetchTransactionFromWallet(txId);
        }

        // Load nostr profile if it's a zap
        if (this.transaction && this.transaction.senderNpub) {
          await this.loadNostrProfile(this.transaction.senderNpub);
        }

      } catch (error) {
        console.error('Error loading transaction details:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t load details'),
          
        });
      } finally {
        this.loading = false;
      }
    },

    async fetchTransactionFromWallet(txId) {
      try {
        // Check wallet type and fetch accordingly
        if (this.walletStore.isActiveWalletSpark) {
          await this.fetchSparkTransaction(txId);
        } else if (this.walletStore.isActiveWalletLNBits) {
          await this.fetchLNBitsTransaction(txId);
        } else {
          await this.fetchNWCTransaction(txId);
        }

        // Process zap info if applicable
        if (this.transaction && this.isZapTransaction(this.transaction)) {
          this.transaction.senderNpub = this.extractNpubFromZap(this.transaction);
        }
      } catch (error) {
        console.error('Error fetching transaction from wallet:', error);
      }
    },

    async fetchSparkTransaction(txId) {
      // Ensure Spark wallet is connected (auto-connects if session PIN available)
      const provider = await this.walletStore.ensureSparkConnected();

      const transactions = await provider.getTransactions({ limit: 100, offset: 0 });
      const found = transactions.find(tx => tx.id === txId);

      if (found) {
        // Normalize Spark transaction to expected format
        this.transaction = {
          id: found.id,
          type: found.type === 'receive' ? 'incoming' : 'outgoing',
          amount: found.amount,
          description: found.description || '',
          memo: found.description || '',
          settled_at: found.timestamp,
          fee: found.fee || 0,
          status: found.status || 'completed',
          sparkTransfer: found.sparkTransfer || false
        };
        console.log('Transaction loaded with description:', this.transaction.description);
      }
    },

    async fetchNWCTransaction(txId) {
      const activeWallet = this.walletState.connectedWallets?.find(
        w => w.id === this.walletState.activeWalletId
      );

      if (!activeWallet?.nwcString) {
        throw new Error('No active NWC wallet found');
      }

      const nwc = new NostrWebLNProvider({
        nostrWalletConnectUrl: activeWallet.nwcString,
      });

      await nwc.enable();

      const transactionsResponse = await nwc.listTransactions({ limit: 100 });

      if (transactionsResponse && transactionsResponse.transactions) {
        this.transaction = transactionsResponse.transactions.find(tx =>
          tx.id === txId || tx.payment_hash === txId
        );

        if (this.transaction) {
          // Ensure consistent field names across different API responses
          this.transaction.id = this.transaction.id || this.transaction.payment_hash || txId;
          this.transaction.type = this.transaction.type || (this.transaction.amount > 0 ? 'incoming' : 'outgoing');
          this.transaction.description = this.transaction.description || this.transaction.memo || '';
          this.transaction.settled_at = this.transaction.settled_at || this.transaction.created_at || null;
          this.transaction.fee = this.transaction.fee || this.transaction.fees_paid || 0;
          this.transaction.payment_request = this.transaction.payment_request || this.transaction.invoice || null;
          console.log('NWC Transaction loaded with description:', this.transaction.description);
        }
      }
    },

    async fetchLNBitsTransaction(txId) {
      const activeWallet = this.walletStore.activeWallet;
      if (!activeWallet) {
        throw new Error('No active LNBits wallet found');
      }

      let provider = this.walletStore.providers[activeWallet.id];
      if (!provider) {
        await this.walletStore.connectLNBitsWallet(activeWallet.id);
        provider = this.walletStore.providers[activeWallet.id];
      }

      if (!provider) {
        throw new Error('Could not connect to LNBits wallet');
      }

      const transactions = await provider.getTransactions({ limit: 100, offset: 0 });
      const found = transactions.find(tx => tx.id === txId);

      if (found) {
        // Normalize LNBits transaction to expected format
        this.transaction = {
          id: found.id,
          type: found.type === 'receive' ? 'incoming' : 'outgoing',
          amount: found.amount,
          description: found.description || '',
          memo: found.description || '',
          settled_at: found.timestamp,
          fee: found.fee || 0,
          status: found.status || 'completed',
          extra: found.extra || null
        };
      }
    },

    isZapTransaction(tx) {
      return tx.description && (
        tx.description.toLowerCase().includes('zap') ||
        tx.description.includes('⚡') ||
        tx.type === 'incoming' && tx.description.match(/npub1[a-zA-Z0-9]{58}/)
      );
    },

    extractNpubFromZap(tx) {
      const npubMatch = tx.description.match(/npub1[a-zA-Z0-9]{58}/);
      return npubMatch ? npubMatch[0] : null;
    },

    async loadNostrProfile(npub) {
      try {
        const cachedProfiles = localStorage.getItem('buhoGO_nostr_profiles');
        if (cachedProfiles) {
          const profiles = JSON.parse(cachedProfiles);
          this.nostrProfile = profiles[npub];
        }

        if (!this.nostrProfile) {
          this.nostrProfile = {
            name: npub.substring(0, 12) + '...',
            displayName: 'Nostr User',
            picture: `https://api.dicebear.com/7.x/avataaars/svg?seed=${npub}`,
            about: 'Lightning Network enthusiast',
            nip05: '',
            lud16: `${npub.substring(0, 8)}@getalby.com`
          };
        }
      } catch (error) {
        console.error('Error loading nostr profile:', error);
      }
    },

    loadDeveloperModePreference() {
      // Always start closed — devs can toggle per session
      this.showDeveloperMode = false;
    },

    toggleDeveloperMode() {
      this.showDeveloperMode = !this.showDeveloperMode;
    },

    getTransactionTypeLabel() {
      if (this.isBitcoinTransaction()) {
        return this.transaction.type === 'incoming' ? this.$t('Bitcoin Deposit') : this.$t('Bitcoin Withdrawal');
      }
      if (this.transaction.senderNpub) return this.$t('Zap Received');
      return this.transaction.type === 'incoming' ? this.$t('Payment Received') : this.$t('Payment Sent');
    },

    getTransactionIconClass() {
      if (this.isBitcoinTransaction()) return 'tx-status-bitcoin';
      if (this.transaction.senderNpub) return 'tx-status-zap';
      return this.transaction.type === 'incoming' ? 'tx-status-received' : 'tx-status-sent';
    },

    getDirectionCircleClass() {
      if (this.isBitcoinTransaction()) return 'direction-circle-bitcoin';
      if (this.transaction.senderNpub) return 'direction-circle-green';
      return this.transaction.type === 'incoming' ? 'direction-circle-green' : 'direction-circle-red';
    },

    getTransactionIcon() {
      if (this.isBitcoinTransaction()) return 'tabler:currency-bitcoin';
      if (this.transaction.senderNpub) return 'tabler:bolt';
      return this.transaction.type === 'incoming' ? 'tabler:arrow-down' : 'tabler:arrow-up';
    },

    /**
     * Check if transaction is a Bitcoin L1 deposit/withdrawal
     */
    isBitcoinTransaction() {
      if (!this.transaction) return false;
      // Check rawType or type from Spark SDK
      const rawType = (this.transaction.rawType || '').toLowerCase();
      if (rawType.includes('l1') || rawType.includes('deposit') || rawType.includes('withdrawal') ||
          rawType.includes('coop_exit') || rawType.includes('static_deposit')) {
        return true;
      }
      // Check description/memo
      const desc = (this.transaction.description || this.transaction.memo || '').toLowerCase();
      if (desc.includes('bitcoin deposit') || desc.includes('bitcoin withdrawal') ||
          desc.includes('l1 deposit') || desc.includes('l1 withdrawal')) {
        return true;
      }
      return false;
    },

    getAccentClass() {
      if (this.transaction.senderNpub) return 'accent-zap';
      return this.transaction.type === 'incoming' ? 'accent-positive' : 'accent-negative';
    },

    getTransactionStatus() {
      if (this.transaction.settled) return this.$t('Completed');
      if (this.transaction.pending) return this.$t('Pending');
      return this.$t('Completed');
    },

    getStatusIcon() {
      if (this.transaction.settled) return 'tabler:circle-check';
      if (this.transaction.pending) return 'tabler:clock';
      return 'tabler:circle-check';
    },

    getStatusClass() {
      if (this.transaction.settled) return 'status-completed';
      if (this.transaction.pending) return 'status-pending';
      return 'status-completed';
    },

    getAmountClass() {
      return this.transaction.type === 'incoming' ? 'amount-positive' : 'amount-negative';
    },

    getTransactionDescription() {
      if (this.transaction.description && this.transaction.description.trim() !== '') {
        return this.transaction.description;
      }
      if (this.transaction.memo && this.transaction.memo.trim() !== '') {
        return this.transaction.memo;
      }
      return null;
    },

    getExtraComment() {
      if (!this.transaction?.extra) return null;
      const extra = this.transaction.extra;
      // LNbits stores LNURL comments in extra.comment
      if (typeof extra === 'object' && extra.comment) return extra.comment;
      if (typeof extra === 'string') {
        try {
          const parsed = JSON.parse(extra);
          return parsed.comment || null;
        } catch { return null; }
      }
      return null;
    },

    getFormattedAmount() {
      const prefix = this.transaction.type === 'incoming' ? '+' : '-';
      return formatAmountWithPrefix(Math.abs(this.transaction.amount), this.walletStore.useBip177Format, prefix);
    },

    async loadFiatRates() {
      try {
        this.loadingFiatRates = true;
        await fiatRatesService.ensureRatesLoaded();
        this.fiatRates = await fiatRatesService.getRates();
      } catch (error) {
        console.error('Error loading fiat rates:', error);
      } finally {
        this.loadingFiatRates = false;
      }
    },

    getFiatAmount() {
      if (this.loadingFiatRates || !this.transaction) {
        return '...';
      }

      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const fiatValue = fiatRatesService.convertSatsToFiatSync(Math.abs(this.transaction.amount), currency);

        // Handle unavailable rates
        if (fiatValue === null) {
          return '--';
        }

        const symbols = {
          USD: '$',
          EUR: '€',
          GBP: '£',
          CAD: 'C$',
          CHF: 'CHF',
          AUD: 'A$',
          JPY: '¥'
        };

        const symbol = symbols[currency] || currency;
        return symbol + fiatValue.toFixed(2);
      } catch (error) {
        console.error('Error converting to fiat:', error);
        return '--';
      }
    },

    formatDateTime(timestamp) {
      const date = new Date(timestamp * 1000);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const txDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

      if (txDate.getTime() === today.getTime()) {
        return `${this.$t('Today at')} ${date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })}`;
      } else if (txDate.getTime() === yesterday.getTime()) {
        return `${this.$t('Yesterday at')} ${date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })}`;
      } else {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }) + ` ${this.$t('at')} ${date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })}`;
      }
    },

    formatTimestamp(timestamp) {
      return new Date(timestamp * 1000).toISOString();
    },

    async copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Copied'),
          
        });
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          
        });
      }
    },

    viewNostrProfile() {
      if (this.transaction.senderNpub) {
        const nostrUrl = `https://snort.social/p/${this.transaction.senderNpub}`;
        window.open(nostrUrl, '_blank');
      }
    },

    async shareTransaction() {
      if (!this.transaction) return;

      const direction = this.transaction.type === 'incoming' ? 'Received' : 'Sent';
      const amount = this.getFormattedAmount();
      const fiat = this.getFiatAmount();
      const date = this.formatDateTime(this.transaction.settled_at);
      const desc = this.getTransactionDescription();

      let text = `${direction} ${amount}`;
      if (fiat && fiat !== '--' && fiat !== '...') text += ` (${fiat})`;
      text += `\n${date}`;
      if (desc) text += `\n${desc}`;
      text += '\n\nvia BuhoGO\nhttps://home.mybuho.de/buhogo';

      const result = await shareContent({ title: `${direction} ${amount}`, text });
      if (result.reason === 'unsupported' || result.reason === 'error') {
        await this.copyToClipboard(text);
      }
    }
  }
}
</script>

<style scoped>
/* ===== Base Page ===== */
.transaction-details-page {
  background: var(--bg-secondary);
  min-height: 100vh;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
}

/* ===== Header ===== */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-card);
  position: sticky;
  top: var(--safe-top, 0px);
  z-index: 100;
}

.back-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
  transition: background-color 0.15s ease;
}

.back-btn:hover {
  background: var(--bg-input);
}

.header-title {
  color: var(--text-primary);
  font-size: 1.25rem;
  font-weight: 600;
  flex: 1;
  text-align: center;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.dev-toggle {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.dev-toggle:hover {
  background: var(--bg-input);
}

.dev-toggle.dev-active {
  background: rgba(21, 222, 114, 0.1);
}

.dev-icon-active {
  color: #15DE72;
}

.dev-icon-muted {
  color: var(--text-secondary);
}

.dev-active-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #15DE72;
}

/* ===== Note Field ===== */
.note-content {
  padding: 4px 12px;
}

.note-input {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
}

/* ===== Loading States ===== */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  background: var(--bg-primary);
}

.loading-text {
  margin-top: 1rem;
  color: var(--text-secondary);
  font-size: 1rem;
}

/* ===== Transaction Content ===== */
.transaction-content {
  min-height: calc(100vh - 80px);
}

/* ===== Transaction Hero Card ===== */
.transaction-hero {
  padding: 1rem;
}

.hero-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  overflow: visible;
}

.hero-content {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hero-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

/* direction-circle is defined globally in app.css */
.direction-circle-bitcoin {
  background: rgba(247, 147, 26, 0.15);
  color: #F7931A;
}

.hero-info {
  flex: 1;
  min-width: 0;
}

.hero-type {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: 2px;
  color: var(--text-primary);
}

.hero-status {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--text-muted);
}

.hero-status.status-completed {
  color: #15DE72;
}

.hero-status.status-pending {
  color: #78716c;
}

/* Hero Amounts */
.hero-amounts {
  text-align: right;
  flex-shrink: 0;
}

.hero-amount {
  font-family: 'Manrope', sans-serif;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 2px;
}

.hero-amount.amount-positive {
  color: #15DE72;
}

.hero-amount.amount-negative {
  color: #FF4B4B;
}

.hero-fiat {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

/* ===== Profile Section ===== */
.profile-section {
  padding: 1rem;
  cursor: pointer;
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  transition: background-color 0.2s;
}

.profile-card:hover {
  background: var(--bg-input);
}

.profile-info {
  flex: 1;
}

.profile-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.profile-meta {
  display: flex;
  align-items: center;
  color: #15DE72;
  font-weight: 500;
  margin-bottom: 0.5rem;
}

.zap-icon {
  color: #78D53C;
}

.profile-about {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.external-icon {
  color: var(--text-secondary);
}

/* ===== Details Section ===== */
.details-section {
  padding: 0 1rem;
  margin-bottom: 1rem;
}

.section-label {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin: 1.5rem 0 0.5rem 0.25rem;
  color: var(--text-muted);
}

.section-label:first-child {
  margin-top: 0.5rem;
}

/* ===== Cards ===== */
.settings-card {
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: 0;
}

.detail-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
}

.settings-card :deep(.q-item) {
  padding: 14px 16px;
  min-height: 48px;
}

/* ===== Item labels / captions (unified) ===== */
.item-label {
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
}

.item-caption {
  color: var(--text-secondary);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  margin-top: 2px;
}

.chevron-icon {
  color: var(--text-muted);
  font-size: 18px;
}

.icon-muted {
  color: var(--text-muted);
}

.contact-avatar-small {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  font-weight: 600;
  color: white;
  font-family: 'Manrope', sans-serif;
}

/* ===== Detail Fields (3A) ===== */
.detail-fields-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-field-group {
  display: flex;
  flex-direction: column;
}

.detail-field-container {
  background: var(--bg-input);
  border-radius: 16px;
  padding: 12px 16px;
  color: var(--text-primary);
  font-size: 14px;
}

.detail-field-label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 400;
  margin-bottom: 6px;
}

/* ===== Contact Picker Dialog ===== */
.contact-picker-dialog {
  width: 100%;
  max-width: 380px;
  border-radius: 24px;
}

.contact-picker-dialog .dialog-header {
  padding: 20px 20px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.contact-picker-dialog .dialog-title {
  flex: 1;
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
}

.contact-picker-dialog .close-btn {
  width: 32px;
  height: 32px;
  margin-right: -8px;
}

.search-input :deep(.q-field__control) {
  background: var(--bg-input);
  border-radius: var(--radius-md);
  color: var(--text-primary);
}

.contact-list {
  padding: 0;
}

.contact-item {
  border-radius: 12px;
  margin-bottom: 8px;
  padding: 12px;
  background: var(--bg-input);
}

.contact-item:hover {
  background: var(--bg-secondary);
}

.contact-avatar-picker {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: white;
  font-family: 'Manrope', sans-serif;
}

.contact-address-caption {
  font-family: var(--font-mono);
  font-size: 11px;
}

.empty-contacts-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 12px;
}

.empty-contacts-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  color: var(--text-muted);
}

/* ===== Tags Section ===== */
.tags-content {
  padding: 10px 14px;
}

.tag-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-option {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
  font-family: 'Manrope', sans-serif;
  background: var(--bg-input);
  color: var(--text-secondary);
  border-color: var(--bg-input);
}

.tag-option:hover:not(.disabled) {
  background: var(--bg-secondary);
  border-color: var(--text-muted);
}

.tag-option.selected {
  background: rgba(21, 222, 114, 0.15);
  color: var(--color-green);
  border-color: rgba(21, 222, 114, 0.3);
}

.tag-option.disabled {
  opacity: 0.35;
  cursor: default;
}

/* ===== Developer Section ===== */
.developer-section {
  padding: 0 1rem 1rem 1rem;
}

.section-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
}

.developer-card {
  background: var(--bg-secondary);
  border: 2px dashed var(--border-card);
  border-radius: var(--radius-md);
  padding: 1.5rem;
}

.developer-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.dev-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.dev-value {
  font-size: 1rem;
  color: var(--text-primary);
  word-break: break-all;
}

.hash-value {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--bg-primary);
  border-radius: 8px;
  transition: background-color 0.2s;
  border: 1px solid var(--border-card);
}

.hash-value:hover {
  background: var(--bg-input);
}

.copy-icon {
  color: var(--text-muted);
  opacity: 0.7;
  flex-shrink: 0;
}

.raw-section {
  margin-bottom: 1.5rem;
}

.raw-section:last-child {
  margin-bottom: 0;
}

.raw-content {
  position: relative;
  background: var(--bg-primary);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  margin-top: 0.5rem;
}

.raw-text {
  padding: 1rem;
  font-size: 0.75rem;
  overflow-x: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-primary);
}

.copy-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  border-radius: 4px;
  color: var(--text-primary);
}

/* ===== Error State ===== */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  padding: 2rem;
  background: var(--bg-primary);
}

.error-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 1rem 0 0.5rem;
}

.error-subtitle {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
}

.go-back-btn {
  border-radius: 24px !important;
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  color: #0C0C0C !important;
  font-weight: 600 !important;
  box-shadow: 0px 4px 8px 0px rgba(61, 61, 61, 0.25) !important;
  font-family: 'Manrope', sans-serif !important;
}

/* ===== Responsive Design ===== */
@media (max-width: 480px) {
  .hero-content {
    padding: 14px 16px;
    gap: 10px;
  }

  .hero-type {
    font-size: 14px;
  }

  .hero-amount {
    font-size: 18px;
  }

  .profile-section {
    padding: 1rem 0.75rem;
  }

  .details-section {
    padding: 0 0.75rem;
  }

  .developer-section {
    padding: 0 0.75rem 1rem 0.75rem;
  }

  .developer-card {
    padding: 1rem;
  }

  .raw-text {
    font-size: 0.6875rem;
    padding: 0.75rem;
  }

  .settings-card :deep(.q-item) {
    padding: 12px 14px;
    min-height: 44px;
  }
}
</style>
