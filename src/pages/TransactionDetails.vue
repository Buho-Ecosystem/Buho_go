<template>
  <!-- Loading Screen -->
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <q-page :class="$q.dark.isActive ? 'transaction-details-page-dark' : 'transaction-details-page-light'">
    <!-- Header -->
    <div class="page-header" :class="$q.dark.isActive ? 'page_header_dark' : 'page_header_light'">
      <q-btn
        flat
        round
        dense
        @click="$router.back()"
        :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
      >
        <svg v-if="$q.dark.isActive" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"
             fill="none">
          <path
            d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z"
            fill="white"/>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z"
            fill="#6D6D6D"/>
        </svg>
      </q-btn>
      <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
        {{ $t('Transaction Details') }}
      </div>
      <div class="header-actions">
        <q-btn
          flat
          round
          dense
          @click="toggleDeveloperMode"
          :class="[$q.dark.isActive ? 'dev_toggle_dark' : 'dev_toggle_light', { 'dev-active': showDeveloperMode }]"
        >
          <q-icon
            name="las la-code"
            size="20px"
            :color="$q.dark.isActive ? (showDeveloperMode ? '#15DE72' : '#B0B0B0') : (showDeveloperMode ? '#15DE72' : '#6D6D6D')"
          />
          <q-tooltip>{{ showDeveloperMode ? $t('Hide') : $t('Show') }} {{ $t('Developer Details') }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container"
         :class="$q.dark.isActive ? 'loading_container_dark' : 'loading_container_light'">
      <q-spinner-dots :color="$q.dark.isActive ? '#15DE72' : '#059573'" size="3rem"/>
      <div class="loading-text" :class="$q.dark.isActive ? 'loading_text_dark' : 'loading_text_light'">
        {{ $t('Loading transaction details...') }}
      </div>
    </div>

    <!-- Transaction Details -->
    <div v-else-if="transaction" class="transaction-content">
      <!-- Transaction Hero Card -->
      <div class="transaction-hero">
        <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
          <!-- Accent Bar (left edge) -->
          <div class="hero-accent" :class="getAccentClass()"></div>

          <!-- Hero Content -->
          <div class="hero-content">
            <!-- Top: Icon + Type + Status -->
            <div class="hero-header">
              <div class="hero-icon-container" :class="getTransactionIconClass()">
                <q-icon :name="getTransactionIcon()" size="20px"/>
              </div>
              <div class="hero-info">
                <div class="hero-type" :class="$q.dark.isActive ? 'hero-type-dark' : 'hero-type-light'">
                  {{ getTransactionTypeLabel() }}
                </div>
                <div class="hero-status" :class="[getStatusClass(), $q.dark.isActive ? 'hero-status-dark' : 'hero-status-light']">
                  <q-icon :name="getStatusIcon()" size="14px"/>
                  {{ getTransactionStatus() }}
                </div>
              </div>
            </div>

            <!-- Bottom: Amount + Fiat -->
            <div class="hero-amounts">
              <div class="hero-amount" :class="[getAmountClass(), $q.dark.isActive ? 'hero-amount-dark' : 'hero-amount-light']">
                {{ getFormattedAmount() }}
              </div>
              <div class="hero-fiat" :class="$q.dark.isActive ? 'hero-fiat-dark' : 'hero-fiat-light'">
                {{ getFiatAmount() }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Nostr Profile Section -->
      <div
        v-if="transaction.senderNpub && nostrProfile"
        class="profile-section"
        @click="viewNostrProfile"
      >
        <div class="profile-card" :class="$q.dark.isActive ? 'profile_card_dark' : 'profile_card_light'">
          <div class="profile-avatar">
            <q-avatar size="48px">
              <img
                v-if="nostrProfile.picture"
                :src="nostrProfile.picture"
                :alt="nostrProfile.displayName || nostrProfile.name"
              />
              <q-icon v-else name="las la-user" size="24px"/>
            </q-avatar>
          </div>
          <div class="profile-info">
            <div class="profile-name" :class="$q.dark.isActive ? 'profile_name_dark' : 'profile_name_light'">
              {{ nostrProfile.displayName || nostrProfile.name }}
            </div>
            <div class="profile-meta" :class="$q.dark.isActive ? 'profile_meta_dark' : 'profile_meta_light'">
              <q-icon name="las la-bolt" class="zap-icon q-mr-xs"/>
              {{ $t('Zap Transaction') }}
            </div>
            <div class="profile-about" v-if="nostrProfile.about"
                 :class="$q.dark.isActive ? 'profile_about_dark' : 'profile_about_light'">
              {{ nostrProfile.about }}
            </div>
          </div>
          <q-icon name="las la-external-link-alt"
                  :class="$q.dark.isActive ? 'external_icon_dark' : 'external_icon_light'"/>
        </div>
      </div>

      <!-- Contact Assignment Section -->
      <div class="details-section">
        <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
          {{ $t('CONTACT') }}
        </div>
        <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
          <q-item v-if="!assignedContact" clickable v-ripple @click="openContactPicker">
            <q-item-section avatar>
              <q-icon name="las la-user-plus" :class="$q.dark.isActive ? 'icon-muted-dark' : 'icon-muted-light'"/>
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Assign Contact') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-icon name="las la-chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'"/>
            </q-item-section>
          </q-item>

          <q-item v-else>
            <q-item-section avatar>
              <div class="contact-avatar-small" :style="{ backgroundColor: assignedContact.color }">
                {{ assignedContact.name.substring(0, 2).toUpperCase() }}
              </div>
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ assignedContact.name }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ truncateAddress(assignedContact.address) }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn flat round dense icon="las la-times" @click="removeContact"
                     :class="$q.dark.isActive ? 'icon-muted-dark' : 'icon-muted-light'">
                <q-tooltip>{{ $t('Remove Contact') }}</q-tooltip>
              </q-btn>
            </q-item-section>
          </q-item>
        </div>
      </div>

      <!-- Tags Section -->
      <div class="details-section">
        <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
          {{ $t('TAGS') }}
        </div>
        <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
          <div class="tags-content">
            <div class="tag-selector">
              <button
                v-for="tag in availableTags"
                :key="tag"
                @click="toggleTag(tag)"
                class="tag-option"
                :class="[
                  { selected: isTagSelected(tag) },
                  $q.dark.isActive ? 'tag_option_dark' : 'tag_option_light'
                ]"
              >
                {{ tag }}
              </button>
            </div>

            <div v-if="currentTags.length >= 2" class="tag-limit-notice"
                 :class="$q.dark.isActive ? 'tag_limit_dark' : 'tag_limit_light'">
              <q-icon name="las la-info-circle" class="q-mr-xs"/>
              {{ $t('Maximum 2 tags per transaction') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Transaction Info -->
      <div class="details-section">
        <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
          {{ $t('TRANSACTION DETAILS') }}
        </div>
        <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
          <q-item v-if="getTransactionDescription()">
            <q-item-section>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('Description') }}
              </q-item-label>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ getTransactionDescription() }}
              </q-item-label>
            </q-item-section>
          </q-item>

          <q-separator v-if="getTransactionDescription() && transaction.memo" :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>

          <q-item v-if="transaction.memo && transaction.memo !== getTransactionDescription()">
            <q-item-section>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('Memo') }}
              </q-item-label>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ transaction.memo }}
              </q-item-label>
            </q-item-section>
          </q-item>

          <q-separator v-if="getTransactionDescription() || transaction.memo" :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>

          <q-item>
            <q-item-section>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('Date & Time') }}
              </q-item-label>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ formatDateTime(transaction.settled_at) }}
              </q-item-label>
            </q-item-section>
          </q-item>

          <q-separator v-if="transaction.fee && transaction.fee > 0" :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>

          <q-item v-if="transaction.fee && transaction.fee > 0">
            <q-item-section>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('Fee') }}
              </q-item-label>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ formatAmount(transaction.fee, walletStore.useBip177Format) }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </div>
      </div>

      <!-- Developer Details -->
      <q-slide-transition>
        <div v-show="showDeveloperMode" class="developer-section">
          <div class="developer-card" :class="$q.dark.isActive ? 'developer_card_dark' : 'developer_card_light'">
            <div class="section-title" :class="$q.dark.isActive ? 'section_title_dark' : 'section_title_light'">
              <q-icon name="las la-code" class="q-mr-sm"/>
              {{ $t('Developer Details') }}
            </div>

            <div class="developer-grid">
              <div class="dev-item" v-if="transaction.id">
                <div class="dev-label" :class="$q.dark.isActive ? 'dev_label_dark' : 'dev_label_light'">
                  {{ $t('Transaction ID') }}
                </div>
                <div class="dev-value hash-value ellipsis" :class="$q.dark.isActive ? 'hash_value_dark' : 'hash_value_light'"
                     @click="copyToClipboard(transaction.id)">
                  {{ transaction.id }}
                  <q-icon name="las la-copy" class="copy-icon"/>
                </div>
              </div>

              <div class="dev-item" v-if="transaction.payment_hash">
                <div class="dev-label" :class="$q.dark.isActive ? 'dev_label_dark' : 'dev_label_light'">
                  {{ $t('Payment Hash') }}
                </div>
                <div class="dev-value hash-value ellipsis" :class="$q.dark.isActive ? 'hash_value_dark' : 'hash_value_light'"
                     @click="copyToClipboard(transaction.payment_hash)">
                  {{ transaction.payment_hash }}
                  <q-icon name="las la-copy" class="copy-icon"/>
                </div>
              </div>

              <div class="dev-item" v-if="transaction.preimage">
                <div class="dev-label" :class="$q.dark.isActive ? 'dev_label_dark' : 'dev_label_light'">
                  {{ $t('Preimage') }}
                </div>
                <div class="dev-value hash-value ellipsis" :class="$q.dark.isActive ? 'hash_value_dark' : 'hash_value_light'"
                     @click="copyToClipboard(transaction.preimage)">
                  {{ transaction.preimage }}
                  <q-icon name="las la-copy" class="copy-icon"/>
                </div>
              </div>

              <div class="dev-item" v-if="transaction.fee">
                <div class="dev-label" :class="$q.dark.isActive ? 'dev_label_dark' : 'dev_label_light'">{{
                    $t('Fee')
                  }}
                </div>
                <div class="dev-value" :class="$q.dark.isActive ? 'dev_value_dark' : 'dev_value_light'">
                  {{ formatAmount(transaction.fee, walletStore.useBip177Format) }}
                </div>
              </div>
            </div>

            <!-- Raw Invoice -->
            <div class="raw-section" v-if="transaction.payment_request">
              <div class="dev-label" :class="$q.dark.isActive ? 'dev_label_dark' : 'dev_label_light'">
                {{ $t('Raw Invoice') }}
              </div>
              <div class="raw-content" :class="$q.dark.isActive ? 'raw_content_dark' : 'raw_content_light'">
                <pre class="raw-text" :class="$q.dark.isActive ? 'raw_text_dark' : 'raw_text_light'">{{
                    transaction.payment_request
                  }}</pre>
                <q-btn
                  flat
                  dense
                  icon="las la-copy"
                  @click="copyToClipboard(transaction.payment_request)"
                  :class="$q.dark.isActive ? 'copy_btn_dark' : 'copy_btn_light'"
                />
              </div>
            </div>

            <!-- Raw JSON -->
            <div class="raw-section">
              <div class="dev-label" :class="$q.dark.isActive ? 'dev_label_dark' : 'dev_label_light'">{{
                  $t('Raw JSON')
                }}
              </div>
              <div class="raw-content" :class="$q.dark.isActive ? 'raw_content_dark' : 'raw_content_light'">
                <pre class="raw-text" :class="$q.dark.isActive ? 'raw_text_dark' : 'raw_text_light'">{{
                    JSON.stringify(transaction, null, 2)
                  }}</pre>
                <q-btn
                  flat
                  dense
                  icon="las la-copy"
                  @click="copyToClipboard(JSON.stringify(transaction, null, 2))"
                  :class="$q.dark.isActive ? 'copy_btn_dark' : 'copy_btn_light'"
                />
              </div>
            </div>
          </div>
        </div>
      </q-slide-transition>
    </div>

    <!-- Error State -->
    <div v-else class="error-state" :class="$q.dark.isActive ? 'error_state_dark' : 'error_state_light'">
      <q-icon name="las la-exclamation-triangle" size="4rem" :color="$q.dark.isActive ? '#FF4B4B' : '#DC2626'"/>
      <div class="error-title" :class="$q.dark.isActive ? 'error_title_dark' : 'error_title_light'">
        {{ $t('Transaction Not Found') }}
      </div>
      <div class="error-subtitle" :class="$q.dark.isActive ? 'error_subtitle_dark' : 'error_subtitle_light'">
        {{ $t('The requested transaction could not be found or loaded.') }}
      </div>
      <q-btn
        :label="$t('Go Back')"
        @click="$router.back()"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
      />
    </div>

    <!-- Contact Picker Modal -->
    <q-dialog v-model="showContactPicker" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="contact-picker-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Select Contact') }}
          </div>
          <q-btn
            flat
            round
            dense
            icon="las la-times"
            v-close-popup
            class="close-btn"
            :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
          />
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="contactSearch"
            :placeholder="$t('Search contacts...')"
            dense
            borderless
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            input-class="q-px-md"
          >
            <template v-slot:prepend>
              <q-icon name="las la-search" class="q-ml-sm" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"/>
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
              :class="$q.dark.isActive ? 'contact-item-dark' : 'contact-item-light'"
            >
              <q-item-section avatar>
                <div class="contact-avatar-picker" :style="{ backgroundColor: contact.color }">
                  {{ contact.name.substring(0, 2).toUpperCase() }}
                </div>
              </q-item-section>
              <q-item-section>
                <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                  {{ contact.name }}
                </q-item-label>
                <q-item-label caption class="contact-address-caption" :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                  {{ truncateAddress(contact.address) }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon name="las la-chevron-right" size="18px" :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-5'"/>
              </q-item-section>
            </q-item>

            <div v-if="filteredContacts.length === 0" class="empty-contacts-state">
              <q-icon name="las la-users" size="48px" :class="$q.dark.isActive ? 'text-grey-7' : 'text-grey-5'"/>
              <div class="empty-contacts-text" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
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
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { NostrWebLNProvider } from "@getalby/sdk";
import LoadingScreen from '../components/LoadingScreen.vue';
import { fiatRatesService } from '../utils/fiatRates.js';
import { formatAmount, formatAmountWithPrefix } from '../utils/amountFormatting.js';
import { useWalletStore } from '../stores/wallet';
import { useAddressBookStore } from '../stores/addressBook';
import { useTransactionMetadataStore } from '../stores/transactionMetadata';

export default {
  name: 'TransactionDetailsPage',
  components: {
    LoadingScreen
  },
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
      loadingText: 'Loading transaction details...',
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

    filteredContacts() {
      if (!this.addressBookStore) return [];
      const query = this.contactSearch.toLowerCase();
      if (!query) return this.addressBookStore.entries;

      return this.addressBookStore.entries.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.address.toLowerCase().includes(query)
      );
    }
  },

  methods: {
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
          // Check if already at limit (2 tags)
          if (currentTags.length >= 2) {
            this.$q.notify({
              type: 'warning',
              message: this.$t('Maximum 2 tags allowed per transaction'),
              
              timeout: 2000
            });
            return;
          }

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
        this.loadingText = 'Loading transaction details...';
        await this.loadTransactionDetails();

        this.loadingText = 'Loading preferences...';
        this.loadDeveloperModePreference();

        this.loadingText = 'Ready!';
        await new Promise(resolve => setTimeout(resolve, 300));
        this.showLoadingScreen = false;
      } catch (error) {
        console.error('Error initializing transaction details:', error);
        this.showLoadingScreen = false;
      }
    },

    async loadTransactionDetails() {
      this.loading = true;
      try {
        if (this.showLoadingScreen) {
          this.loadingText = 'Finding transaction...';
        }

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
          if (this.showLoadingScreen) {
            this.loadingText = 'Fetching from wallet...';
          }
          await this.fetchTransactionFromWallet(txId);
        }

        // Load nostr profile if it's a zap
        if (this.transaction && this.transaction.senderNpub) {
          if (this.showLoadingScreen) {
            this.loadingText = 'Loading profile...';
          }
          await this.loadNostrProfile(this.transaction.senderNpub);
        }

      } catch (error) {
        console.error('Error loading transaction details:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t load details'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } finally {
        this.loading = false;
      }
    },

    async fetchTransactionFromWallet(txId) {
      try {
        if (this.showLoadingScreen) {
          this.loadingText = 'Connecting to wallet...';
        }

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

      if (this.showLoadingScreen) {
        this.loadingText = 'Fetching transaction data...';
      }

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

      if (this.showLoadingScreen) {
        this.loadingText = 'Fetching transaction data...';
      }

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

      if (this.showLoadingScreen) {
        this.loadingText = 'Fetching transaction data...';
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
          status: found.status || 'completed'
        };
        console.log('LNBits Transaction loaded with description:', this.transaction.description);
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
      const saved = localStorage.getItem('buhoGO_developer_mode');
      this.showDeveloperMode = saved === 'true';
    },

    toggleDeveloperMode() {
      this.showDeveloperMode = !this.showDeveloperMode;
      localStorage.setItem('buhoGO_developer_mode', this.showDeveloperMode.toString());
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

    getTransactionIcon() {
      if (this.isBitcoinTransaction()) return 'lab la-bitcoin';
      if (this.transaction.senderNpub) return 'las la-bolt';
      return this.transaction.type === 'incoming' ? 'las la-arrow-down' : 'las la-arrow-up';
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
      if (this.transaction.settled) return 'las la-check-circle';
      if (this.transaction.pending) return 'las la-clock';
      return 'las la-check-circle';
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

    getFormattedAmount() {
      const prefix = this.transaction.type === 'incoming' ? '+' : '-';
      return formatAmountWithPrefix(Math.abs(this.transaction.amount), this.walletStore.useBip177Format, prefix);
    },

    async loadFiatRates() {
      try {
        this.loadingFiatRates = true;
        await fiatRatesService.ensureRatesLoaded();
        this.fiatRates = fiatRatesService.getRates();
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
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      }
    },

    viewNostrProfile() {
      if (this.transaction.senderNpub) {
        const nostrUrl = `https://snort.social/p/${this.transaction.senderNpub}`;
        window.open(nostrUrl, '_blank');
      }
    }
  }
}
</script>

<style scoped>
/* Base Page Styles */
.transaction-details-page-dark {
  background: #171717;
  min-height: 100vh;
  font-family: Fustat, sans-serif;
}

.transaction-details-page-light {
  background: #F6F6F6;
  min-height: 100vh;
  font-family: Fustat, sans-serif;
}

/* Header Styles */
.page_header_dark {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: #0C0C0C;
  border-bottom: 1px solid #2A342A;
  position: sticky;
  top: 0;
  z-index: 100;
}

.page_header_light {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: white;
  border-bottom: 1px solid #E5E7EB;
  position: sticky;
  top: 0;
  z-index: 100;
}

.back_btn_dark,
.back_btn_light {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease;
}

.back_btn_dark:hover {
  background: #2A342A;
}

.back_btn_light:hover {
  background: #f1f5f9;
}

.main_page_title_dark {
  color: #F6F6F6;
  font-size: 1.25rem;
  font-weight: 600;
  flex: 1;
  text-align: center;
}

.main_page_title_light {
  color: #212121;
  font-size: 1.25rem;
  font-weight: 600;
  flex: 1;
  text-align: center;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.dev_toggle_dark,
.dev_toggle_light {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.dev_toggle_dark:hover {
  background: #2A342A;
}

.dev_toggle_light:hover {
  background: #f1f5f9;
}

.dev_toggle_dark.dev-active {
  background: rgba(21, 222, 114, 0.1);
}

.dev_toggle_light.dev-active {
  background: rgba(5, 149, 115, 0.1);
}

/* Loading States */
.loading_container_dark {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  background: #0C0C0C;
}

.loading_container_light {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  background: white;
}

.loading_text_dark {
  margin-top: 1rem;
  color: #B0B0B0;
  font-size: 1rem;
}

.loading_text_light {
  margin-top: 1rem;
  color: #6B7280;
  font-size: 1rem;
}

/* Transaction Content */
.transaction-content {
  min-height: calc(100vh - 80px);
}

/* Transaction Hero Card */
.transaction-hero {
  padding: 1rem;
}

.transaction-hero .settings-card {
  position: relative;
  overflow: visible;
}

/* Accent Bar (left edge) */
.hero-accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-top-left-radius: 12px;
  border-bottom-left-radius: 12px;
}

.hero-accent.accent-positive {
  background: linear-gradient(180deg, #15DE72, #059573);
}

.hero-accent.accent-negative {
  background: linear-gradient(180deg, #6B7280, #4B5563);
}

.hero-accent.accent-zap {
  background: linear-gradient(180deg, #15DE72, #78D53C);
}

/* Hero Content */
.hero-content {
  padding: 20px 20px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Hero Header (Icon + Type + Status) */
.hero-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.hero-icon-container {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: white;
}

.hero-icon-container.tx-status-received {
  background: linear-gradient(135deg, #15DE72, #059573);
}

.hero-icon-container.tx-status-sent {
  background: linear-gradient(135deg, #6B7280, #4B5563);
}

.hero-icon-container.tx-status-zap {
  background: linear-gradient(135deg, #15DE72, #78D53C);
}

.hero-icon-container.tx-status-bitcoin {
  background: linear-gradient(135deg, #F7931A, #D97706);
}

.hero-info {
  flex: 1;
  min-width: 0;
}

.hero-type,
.hero-type-dark,
.hero-type-light {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: 4px;
}

.hero-type-dark {
  color: #FFFFFF;
}

.hero-type-light {
  color: #000000;
}

.hero-status,
.hero-status-dark,
.hero-status-light {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}

.hero-status-dark {
  color: #999;
}

.hero-status-light {
  color: #6B7280;
}

.hero-status.status-completed {
  color: #15DE72;
}

.hero-status.status-pending {
  color: #78716c;
}

.status-completed {
  color: #15DE72;
}

.status-pending {
  color: #78716c;
}

/* Hero Amounts */
.hero-amounts {
  text-align: center;
  padding-top: 4px;
}

.hero-amount,
.hero-amount-dark,
.hero-amount-light {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: 4px;
}

.hero-amount.amount-positive {
  color: #15DE72;
}

.hero-amount.amount-negative {
  color: #FF4B4B;
}

.amount-positive {
  color: #15DE72;
}

.amount-negative {
  color: #FF4B4B;
}

.hero-fiat,
.hero-fiat-dark,
.hero-fiat-light {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.hero-fiat-dark {
  color: #999;
}

.hero-fiat-light {
  color: #6B7280;
}

/* Profile Section */
.profile-section {
  padding: 1rem;
  cursor: pointer;
}

.profile_card_dark {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: #171717;
  border: 1px solid #2A342A;
  border-radius: 12px;
  transition: background-color 0.2s;
}

.profile_card_light {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: #F6F6F6;
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  transition: background-color 0.2s;
}

.profile_card_dark:hover {
  background: #2A342A;
}

.profile_card_light:hover {
  background: #F3F4F6;
}

.profile-info {
  flex: 1;
}

.profile_name_dark {
  font-size: 1.125rem;
  font-weight: 600;
  color: #F6F6F6;
  margin-bottom: 0.25rem;
}

.profile_name_light {
  font-size: 1.125rem;
  font-weight: 600;
  color: #212121;
  margin-bottom: 0.25rem;
}

.profile_meta_dark {
  display: flex;
  align-items: center;
  color: #15DE72;
  font-weight: 500;
  margin-bottom: 0.5rem;
}

.profile_meta_light {
  display: flex;
  align-items: center;
  color: #059573;
  font-weight: 500;
  margin-bottom: 0.5rem;
}

.zap-icon {
  color: #78D53C;
}

.profile_about_dark {
  color: #B0B0B0;
  font-size: 0.875rem;
}

.profile_about_light {
  color: #6B7280;
  font-size: 0.875rem;
}

.external_icon_dark {
  color: #B0B0B0;
}

.external_icon_light {
  color: #9CA3AF;
}

/* Details Section (iOS-inspired) */
.details-section {
  padding: 0 1rem;
  margin-bottom: 1rem;
}

.section-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin: 1.5rem 0 0.5rem 0.25rem;
}

.section-label:first-child {
  margin-top: 0.5rem;
}

.section-label-dark {
  color: #666;
}

.section-label-light {
  color: #6B7280;
}

.settings-card {
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 0;
}

.card-dark {
  background: #1A1A1A;
}

.card-light {
  background: #FFFFFF;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.settings-card :deep(.q-item) {
  padding: 14px 16px;
  min-height: 48px;
}

.item-label-dark {
  color: #FFFFFF;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 500;
}

.item-label-light {
  color: #000000;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 500;
}

.item-caption-dark {
  color: #999;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  margin-top: 2px;
}

.item-caption-light {
  color: #6B7280;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  margin-top: 2px;
}

.chevron-dark {
  color: #666;
  font-size: 18px;
}

.chevron-light {
  color: #9CA3AF;
  font-size: 18px;
}

.separator-dark {
  background: #2A2A2A;
  margin-left: 16px;
}

.separator-light {
  background: #E5E7EB;
  margin-left: 16px;
}

.icon-muted-dark {
  color: #999;
}

.icon-muted-light {
  color: #6B7280;
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
  font-family: Fustat, sans-serif;
}

/* Contact Picker Dialog */
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
}

.contact-picker-dialog .close-btn {
  width: 32px;
  height: 32px;
  margin-right: -8px;
}

.contact-list {
  padding: 0;
}

.contact-item {
  border-radius: 12px;
  margin-bottom: 8px;
  padding: 12px;
}

.contact-item-dark {
  background: #171717;
}

.contact-item-dark:hover {
  background: #1F1F1F;
}

.contact-item-light {
  background: #F8F8F8;
}

.contact-item-light:hover {
  background: #F0F0F0;
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
  font-family: Fustat, sans-serif;
}

.contact-address-caption {
  font-family: 'Monaco', 'Menlo', monospace;
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
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
}

/* Tags Section */
.tags-content {
  padding: 14px 16px;
}

.tag-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.tag-option,
.tag_option_dark,
.tag_option_light {
  padding: 0.625rem 1.25rem;
  border-radius: 16px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 2px solid transparent;
  font-family: Fustat, sans-serif;
}

.tag_option_dark {
  background: #2A342A;
  color: #F6F6F6;
  border-color: #2A342A;
}

.tag_option_dark:hover {
  background: #374444;
  border-color: #374444;
}

.tag_option_dark.selected {
  background: #78716c;
  color: white;
  border-color: #78716c;
}

.tag_option_light {
  background: #F3F4F6;
  color: #212121;
  border-color: #F3F4F6;
}

.tag_option_light:hover {
  background: #E5E7EB;
  border-color: #E5E7EB;
}

.tag_option_light.selected {
  background: #78716c;
  color: white;
  border-color: #78716c;
}

.tag-limit-notice,
.tag_limit_dark,
.tag_limit_light {
  display: flex;
  align-items: center;
  margin-top: 1rem;
  padding: 0.75rem;
  border-radius: 8px;
  font-size: 0.8rem;
  font-family: Fustat, sans-serif;
}

.tag_limit_dark {
  background: #2A342A;
  color: #B0B0B0;
}

.tag_limit_light {
  background: #FEF3C7;
  color: #92400E;
}

/* Contact Picker Modal */
.contact_picker_card_dark {
  background: #0C0C0C;
  color: #F6F6F6;
}

.contact_picker_card_light {
  background: white;
  color: #212121;
}

.picker_title_dark,
.picker_title_light {
  font-family: Fustat, sans-serif;
  font-weight: 600;
}

.picker_title_dark {
  color: #F6F6F6;
}

.picker_title_light {
  color: #212121;
}

.search_input_dark :deep(.q-field__control) {
  background: #2A342A;
  color: #F6F6F6;
}

.search_input_light :deep(.q-field__control) {
  background: #F9FAFB;
  color: #212121;
}

.contact_item_dark,
.contact_item_light {
  transition: background-color 0.2s ease;
}

.contact_item_dark:hover {
  background: #2A342A;
}

.contact_item_light:hover {
  background: #F9FAFB;
}

.picker-contact-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  font-weight: 600;
  color: white;
  font-family: Fustat, sans-serif;
}

.picker_contact_name_dark,
.picker_contact_name_light {
  font-weight: 500;
  font-family: Fustat, sans-serif;
}

.picker_contact_name_dark {
  color: #F6F6F6;
}

.picker_contact_name_light {
  color: #212121;
}

.picker_contact_address_dark,
.picker_contact_address_light {
  font-size: 0.8rem;
  font-family: Fustat, sans-serif;
}

.picker_contact_address_dark {
  color: #B0B0B0;
}

.picker_contact_address_light {
  color: #6B7280;
}

.empty-contacts {
  padding: 2rem 1rem;
  text-align: center;
}

.empty_text_dark,
.empty_text_light {
  font-family: Fustat, sans-serif;
}

.empty_text_dark {
  color: #B0B0B0;
}

.empty_text_light {
  color: #6B7280;
}

.cancel_btn_dark,
.cancel_btn_light {
  font-family: Fustat, sans-serif;
}

.cancel_btn_dark {
  color: #B0B0B0;
}

.cancel_btn_light {
  color: #6B7280;
}

/* Removed old info section styles - using Settings card pattern now */

/* Developer Section */
.developer-section {
  padding: 0 1rem 1rem 1rem;
}

.section_title_dark {
  font-size: 1.125rem;
  font-weight: 600;
  color: #F6F6F6;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
}

.section_title_light {
  font-size: 1.125rem;
  font-weight: 600;
  color: #212121;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
}

.developer_card_dark {
  background: #171717;
  border: 2px dashed #2A342A;
  border-radius: 12px;
  padding: 1.5rem;
}

.developer_card_light {
  background: #F9FAFB;
  border: 2px dashed #D1D5DB;
  border-radius: 12px;
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

.dev_label_dark {
  font-size: 0.875rem;
  font-weight: 500;
  color: #B0B0B0;
}

.dev_label_light {
  font-size: 0.875rem;
  font-weight: 500;
  color: #6B7280;
}

.dev_value_dark {
  font-size: 1rem;
  color: #F6F6F6;
  word-break: break-all;
}

.dev_value_light {
  font-size: 1rem;
  color: #212121;
  word-break: break-all;
}

.hash_value_dark {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: #0C0C0C;
  border-radius: 8px;
  transition: background-color 0.2s;
  border: 1px solid #2A342A;
}

.hash_value_light {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: white;
  border-radius: 8px;
  transition: background-color 0.2s;
  border: 1px solid #E5E7EB;
}

.hash_value_dark:hover {
  background: #2A342A;
}

.hash_value_light:hover {
  background: #F9FAFB;
}

.copy-icon {
  color: #6B7280;
  opacity: 0.7;
  flex-shrink: 0;
}

.raw-section {
  margin-bottom: 1.5rem;
}

.raw-section:last-child {
  margin-bottom: 0;
}

.raw_content_dark {
  position: relative;
  background: #0C0C0C;
  border: 1px solid #2A342A;
  border-radius: 8px;
  margin-top: 0.5rem;
}

.raw_content_light {
  position: relative;
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  margin-top: 0.5rem;
}

.raw_text_dark {
  padding: 1rem;
  font-size: 0.75rem;
  overflow-x: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: #F6F6F6;
}

.raw_text_light {
  padding: 1rem;
  font-size: 0.75rem;
  overflow-x: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: #212121;
}

.copy_btn_dark {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: #2A342A;
  border: 1px solid #2A342A;
  border-radius: 4px;
  color: #F6F6F6;
}

.copy_btn_light {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 4px;
  color: #212121;
}

/* Error State */
.error_state_dark {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  padding: 2rem;
  background: #0C0C0C;
}

.error_state_light {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  padding: 2rem;
  background: white;
}

.error_title_dark {
  font-size: 1.25rem;
  font-weight: 600;
  color: #F6F6F6;
  margin: 1rem 0 0.5rem;
}

.error_title_light {
  font-size: 1.25rem;
  font-weight: 600;
  color: #212121;
  margin: 1rem 0 0.5rem;
}

.error_subtitle_dark {
  color: #B0B0B0;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
}

.error_subtitle_light {
  color: #6B7280;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
}

/* Primary Action Buttons */
.dialog_add_btn_dark {
  border-radius: 24px !important;
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  color: #0C0C0C !important;
  font-weight: 600 !important;
  box-shadow: 0px 4px 8px 0px rgba(61, 61, 61, 0.25) !important;
  font-family: Fustat, sans-serif !important;
}

.dialog_add_btn_light {
  border-radius: 24px !important;
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  color: #0C0C0C !important;
  font-weight: 600 !important;
  box-shadow: 0px 4px 8px 0px rgba(159, 159, 159, 0.25) !important;
  font-family: Fustat, sans-serif !important;
}

/* Responsive Design */
@media (max-width: 480px) {
  /* Hero Card Responsive */
  .hero-content {
    padding: 16px 16px 16px 20px;
    gap: 12px;
  }

  .hero-icon-container {
    width: 28px;
    height: 28px;
  }

  .hero-icon-container :deep(.q-icon) {
    font-size: 16px !important;
  }

  .hero-type,
  .hero-type-dark,
  .hero-type-light {
    font-size: 16px;
  }

  .hero-amount,
  .hero-amount-dark,
  .hero-amount-light {
    font-size: 24px;
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

  .developer_card_dark,
  .developer_card_light {
    padding: 1rem;
  }

  .raw_text_dark,
  .raw_text_light {
    font-size: 0.6875rem;
    padding: 0.75rem;
  }

  .settings-card :deep(.q-item) {
    padding: 12px 14px;
    min-height: 44px;
  }
}
</style>
