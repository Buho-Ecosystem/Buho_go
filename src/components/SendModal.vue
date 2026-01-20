<template>
  <q-dialog
    v-model="show"
    persistent
    maximized
    transition-show="slide-up"
    transition-hide="slide-down"
    class="send-modal"
  >
    <q-card class="send-card" :class="$q.dark.isActive ? 'send-card-dark' : 'send-card-light'">
      <!-- Header -->
      <q-card-section class="send-header">
        <div class="header-content">
          <q-btn
            flat
            round
            dense
            @click="closeModal"
            class="back-btn"
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
            {{ $t('Send') }}
          </div>
          <div class="header-spacer"></div>
        </div>
      </q-card-section>

      <!-- Camera View -->
      <div class="camera-container">
        <video
          v-if="showCamera && !isProcessing"
          ref="videoElement"
          class="camera-view"
          style="width: 100%; height: 100%; object-fit: cover;"
          playsinline
        />

        <!-- Processing Overlay -->
        <div v-if="isProcessing" class="processing-overlay">
          <q-spinner-dots color="#15DE72" size="3rem"/>
          <div class="processing-text">{{ $t('Processing payment...') }}</div>
        </div>

        <!-- Camera Error -->
        <div v-if="cameraError" class="camera-error">
          <q-icon name="las la-camera-retro" size="4rem" color="grey-4"/>
          <div class="error-title">{{ $t('Camera Access Required') }}</div>
          <div class="error-subtitle">{{ cameraError }}</div>
          <q-btn
            class="retry-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Retry')"
            @click="initializeCamera"
            no-caps
          />
        </div>

        <!-- Scanning Frame -->
        <div v-if="showCamera && !isProcessing" class="scanning-frame">
          <div class="frame-corner top-left"></div>
          <div class="frame-corner top-right"></div>
          <div class="frame-corner bottom-left"></div>
          <div class="frame-corner bottom-right"></div>
        </div>
      </div>

      <!-- Bottom Actions -->
      <q-card-section class="send-actions">
        <div class="action-buttons">
          <q-btn
            flat
            class="action-btn"
            :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
            @click="showManualInput"
          >
            <div class="btn-content">
              <q-icon name="las la-keyboard" size="24px" class="btn-icon"/>
              <span class="btn-label">{{ $t('Manual') }}</span>
            </div>
          </q-btn>

          <q-btn
            flat
            class="action-btn"
            :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
            @click="pasteFromClipboard"
          >
            <div class="btn-content">
              <q-icon name="las la-clipboard" size="24px" class="btn-icon"/>
              <span class="btn-label">{{ $t('Paste') }}</span>
            </div>
          </q-btn>

          <q-btn
            flat
            class="action-btn"
            :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
            @click="showContactPicker"
          >
            <div class="btn-content">
              <q-icon name="las la-address-book" size="24px" class="btn-icon"/>
              <span class="btn-label">{{ $t('Contacts') }}</span>
            </div>
          </q-btn>
        </div>
      </q-card-section>
    </q-card>

    <!-- Manual Input Dialog -->
    <q-dialog v-model="showManualDialog" class="manual-dialog-backdrop">
      <q-card class="manual-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="manual-header">
          <div class="manual-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Who do you want to pay?') }}
          </div>
          <q-btn flat round dense icon="las la-times" v-close-popup
                 class="close-btn" :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"/>
        </q-card-section>

        <q-card-section class="manual-content">
          <q-input
            v-model="manualInput"
            outlined
            :label="$t('Paste invoice or enter address')"
            :placeholder="manualInputPlaceholder"
            class="manual-input"
            :class="$q.dark.isActive ? 'manual-input-dark' : 'manual-input-light'"
            color="green"
            autofocus
            :rules="[validatePaymentInput]"
          />
        </q-card-section>

        <q-card-actions align="right" class="manual-actions" :class="$q.dark.isActive ? 'actions-dark' : 'actions-light'">
          <q-btn flat :label="$t('Cancel')" v-close-popup :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"/>
          <q-btn
            flat
            :label="$t('Continue')"
            class="continue-btn"
            @click="processManualInput"
            :disable="!isValidManualInput"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Contact Picker Dialog -->
    <q-dialog v-model="showContactDialog" class="contact-dialog-backdrop">
      <q-card class="contact-picker-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="contact-picker-header">
          <div class="contact-picker-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Choose a contact') }}
          </div>
          <q-btn flat round dense icon="las la-times" v-close-popup
                 class="close-btn" :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"/>
        </q-card-section>

        <!-- Search (only show if 5+ contacts) -->
        <q-card-section v-if="contacts.length >= 5" class="contact-search-section">
          <q-input
            v-model="contactSearch"
            outlined
            dense
            :placeholder="$t('Search contacts...')"
            class="contact-search"
            :class="$q.dark.isActive ? 'manual-input-dark' : 'manual-input-light'"
          >
            <template v-slot:prepend>
              <q-icon name="las la-search" :color="$q.dark.isActive ? 'grey-5' : 'grey-6'" />
            </template>
            <template v-slot:append v-if="contactSearch">
              <q-icon name="las la-times" class="cursor-pointer" @click="contactSearch = ''" />
            </template>
          </q-input>
        </q-card-section>

        <!-- Contact List -->
        <q-card-section class="contact-list-section">
          <!-- Empty State -->
          <div v-if="contacts.length === 0" class="contact-empty-state">
            <q-icon name="las la-user-friends" size="48px" :color="$q.dark.isActive ? 'grey-6' : 'grey-5'" />
            <div class="empty-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('No contacts yet') }}
            </div>
            <div class="empty-subtitle" :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-5'">
              {{ $t('Save contacts in the Address Book to quickly pay them') }}
            </div>
            <q-btn
              unelevated
              no-caps
              class="add-contact-cta"
              :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
              @click="goToAddressBook"
            >
              <q-icon name="las la-plus" class="q-mr-sm" />
              {{ $t('Add Contact') }}
            </q-btn>
          </div>

          <!-- No Results -->
          <div v-else-if="!hasContactsToShow" class="contact-empty-state">
            <q-icon name="las la-search" size="48px" :color="$q.dark.isActive ? 'grey-6' : 'grey-5'" />
            <div class="empty-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('No matches found') }}
            </div>
          </div>

          <!-- Sectioned Contact List -->
          <div v-else class="contact-list">
            <!-- Favorites Section -->
            <template v-if="favoriteContacts.length > 0">
              <div class="contact-section-header" :class="$q.dark.isActive ? 'section-header-dark' : 'section-header-light'">
                <q-icon name="las la-star" size="14px" color="amber" />
                <span>{{ $t('Favorites') }}</span>
              </div>
              <div
                v-for="contact in favoriteContacts"
                :key="'fav-' + contact.id"
                class="contact-item"
                :class="[
                  $q.dark.isActive ? 'contact-item-dark' : 'contact-item-light',
                  { 'contact-disabled': !canPayContact(contact) }
                ]"
                @click="selectContact(contact)"
              >
                <div class="contact-avatar" :style="{ backgroundColor: contact.color }">
                  {{ contact.name.charAt(0).toUpperCase() }}
                </div>
                <div class="contact-info">
                  <div class="contact-name-row">
                    <div class="contact-name" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">
                      {{ contact.name }}
                    </div>
                    <q-icon name="las la-star" size="12px" color="amber" class="q-ml-xs" />
                    <div class="contact-type-badge" :class="getContactTypeBadgeClass(contact)">
                      <q-icon :name="getContactTypeIcon(contact)" size="10px" />
                      <span>{{ getContactTypeLabel(contact) }}</span>
                    </div>
                  </div>
                  <div class="contact-address" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                    {{ getContactAddress(contact) }}
                  </div>
                </div>
                <q-icon name="las la-chevron-right" size="20px" :color="$q.dark.isActive ? 'grey-6' : 'grey-5'" />
              </div>
            </template>

            <!-- Recent Section -->
            <template v-if="recentContacts.length > 0">
              <div class="contact-section-header" :class="$q.dark.isActive ? 'section-header-dark' : 'section-header-light'">
                <q-icon name="las la-clock" size="14px" />
                <span>{{ $t('Recent') }}</span>
              </div>
              <div
                v-for="contact in recentContacts"
                :key="'recent-' + contact.id"
                class="contact-item"
                :class="[
                  $q.dark.isActive ? 'contact-item-dark' : 'contact-item-light',
                  { 'contact-disabled': !canPayContact(contact) }
                ]"
                @click="selectContact(contact)"
              >
                <div class="contact-avatar" :style="{ backgroundColor: contact.color }">
                  {{ contact.name.charAt(0).toUpperCase() }}
                </div>
                <div class="contact-info">
                  <div class="contact-name-row">
                    <div class="contact-name" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">
                      {{ contact.name }}
                    </div>
                    <div class="contact-type-badge" :class="getContactTypeBadgeClass(contact)">
                      <q-icon :name="getContactTypeIcon(contact)" size="10px" />
                      <span>{{ getContactTypeLabel(contact) }}</span>
                    </div>
                  </div>
                  <div class="contact-address" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                    {{ getContactAddress(contact) }}
                  </div>
                </div>
                <q-icon name="las la-chevron-right" size="20px" :color="$q.dark.isActive ? 'grey-6' : 'grey-5'" />
              </div>
            </template>

            <!-- All Contacts Section -->
            <template v-if="otherContacts.length > 0">
              <div class="contact-section-header" :class="$q.dark.isActive ? 'section-header-dark' : 'section-header-light'">
                <q-icon name="las la-user-friends" size="14px" />
                <span>{{ $t('All Contacts') }}</span>
              </div>
              <div
                v-for="contact in otherContacts"
                :key="'other-' + contact.id"
                class="contact-item"
                :class="[
                  $q.dark.isActive ? 'contact-item-dark' : 'contact-item-light',
                  { 'contact-disabled': !canPayContact(contact) }
                ]"
                @click="selectContact(contact)"
              >
                <div class="contact-avatar" :style="{ backgroundColor: contact.color }">
                  {{ contact.name.charAt(0).toUpperCase() }}
                </div>
                <div class="contact-info">
                  <div class="contact-name-row">
                    <div class="contact-name" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">
                      {{ contact.name }}
                    </div>
                    <div class="contact-type-badge" :class="getContactTypeBadgeClass(contact)">
                      <q-icon :name="getContactTypeIcon(contact)" size="10px" />
                      <span>{{ getContactTypeLabel(contact) }}</span>
                    </div>
                  </div>
                  <div class="contact-address" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                    {{ getContactAddress(contact) }}
                  </div>
                </div>
                <q-icon name="las la-chevron-right" size="20px" :color="$q.dark.isActive ? 'grey-6' : 'grey-5'" />
              </div>
            </template>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-dialog>
</template>

<script>
import QrScanner from 'qr-scanner';
import { useAddressBookStore } from '../stores/addressBook';
import { useWalletStore } from '../stores/wallet';

export default {
  name: 'SendModal',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue', 'payment-detected'],
  setup() {
    const addressBookStore = useAddressBookStore();
    const walletStore = useWalletStore();
    return { addressBookStore, walletStore };
  },
  data() {
    return {
      showCamera: false,
      isProcessing: false,
      cameraError: null,
      showManualDialog: false,
      showContactDialog: false,
      contactSearch: '',
      manualInput: '',
      qrScanner: null,
      videoElement: null
    }
  },
  computed: {
    show: {
      get() {
        return this.modelValue;
      },
      set(value) {
        this.$emit('update:modelValue', value);
      }
    },
    isValidManualInput() {
      return this.manualInput.trim().length > 0 && this.validatePaymentInput(this.manualInput) === true;
    },
    contacts() {
      return this.addressBookStore.entries || [];
    },
    // Favorite contacts (filtered by search)
    favoriteContacts() {
      return (this.addressBookStore.favoriteEntries || [])
        .filter(c => this.matchesSearch(c));
    },
    // Recent contacts (filtered by search)
    recentContacts() {
      return (this.addressBookStore.recentEntries || [])
        .filter(c => this.matchesSearch(c));
    },
    // Other contacts (not in favorites or recent, filtered by search)
    otherContacts() {
      const favoriteIds = new Set((this.addressBookStore.favoriteEntries || []).map(c => c.id));
      const recentIds = new Set((this.addressBookStore.recentEntries || []).map(c => c.id));
      return this.contacts
        .filter(c => !favoriteIds.has(c.id) && !recentIds.has(c.id))
        .filter(c => this.matchesSearch(c))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    // All filtered contacts (for backward compatibility and empty state check)
    filteredContacts() {
      if (!this.contactSearch) return this.contacts;
      const search = this.contactSearch.toLowerCase();
      return this.contacts.filter(c => {
        const address = c.address || c.lightningAddress || '';
        const notes = c.notes || '';
        return c.name.toLowerCase().includes(search) ||
          address.toLowerCase().includes(search) ||
          notes.toLowerCase().includes(search);
      });
    },
    // Check if we have any contacts to show in sections
    hasContactsToShow() {
      return this.favoriteContacts.length > 0 ||
             this.recentContacts.length > 0 ||
             this.otherContacts.length > 0;
    },
    isActiveWalletSpark() {
      return this.walletStore.isActiveWalletSpark;
    },
    manualInputPlaceholder() {
      return this.isActiveWalletSpark
        ? this.$t('e.g. name@wallet.com, lnbc..., or spark1...')
        : this.$t('e.g. name@wallet.com or lnbc...');
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.initializeCamera();
      } else {
        this.stopQrScanner();
        this.showCamera = false;
        this.resetState();
      }
    }
  },
  beforeUnmount() {
    this.stopQrScanner();
  },
  methods: {
    // Search filter helper
    matchesSearch(contact) {
      if (!this.contactSearch) return true;
      const search = this.contactSearch.toLowerCase();
      const address = contact.address || contact.lightningAddress || '';
      const notes = contact.notes || '';
      return contact.name.toLowerCase().includes(search) ||
        address.toLowerCase().includes(search) ||
        notes.toLowerCase().includes(search);
    },

    async initializeCamera() {
      this.cameraError = null;
      try {
        // Check if QrScanner has camera support
        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          throw new Error('No camera found on this device.');
        }

        this.showCamera = true;
        // Wait for the next tick to ensure the video element is rendered
        await this.$nextTick();
        await this.startQrScanner();
      } catch (error) {
        console.error('Camera initialization error:', error);
        this.handleCameraError(error);
      }
    },

    async startQrScanner() {
      try {
        if (!this.$refs.videoElement) {
          throw new Error('Video element not found');
        }

        this.videoElement = this.$refs.videoElement;

        // Create QR scanner instance
        this.qrScanner = new QrScanner(
          this.videoElement,
          (result) => {
            // Handle both string and object result formats from qr-scanner
            const data = typeof result === 'string' ? result : (result?.data || result?.text || '');
            this.onQRDetect(data);
          },
          {
            returnDetailedScanResult: true,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: 'environment'
          }
        );

        // Start scanning
        await this.qrScanner.start();

      } catch (error) {
        console.error('Error starting QR scanner:', error);
        this.handleCameraError(error);
      }
    },

    stopQrScanner() {
      if (this.qrScanner) {
        this.qrScanner.stop();
        this.qrScanner.destroy();
        this.qrScanner = null;
      }
    },

    handleCameraError(error) {
      if (error.name === 'NotAllowedError') {
        this.cameraError = this.$t('Camera permission denied. Please allow camera access and try again.');
      } else if (error.name === 'NotFoundError') {
        this.cameraError = this.$t('No camera found on this device.');
      } else if (error.name === 'NotSupportedError') {
        this.cameraError = this.$t('Camera not supported in this browser.');
      } else {
        this.cameraError = this.$t('Failed to access camera. Please try again.');
      }
    },

    async onQRDetect(qrContent) {
      if (this.isProcessing || !qrContent) return;

      this.isProcessing = true;

      try {
        await this.processPaymentData(qrContent);
      } catch (error) {
        console.error('QR processing error:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Invalid QR code'),
          caption: error.message,
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
        this.isProcessing = false;
      }
    },

    async processPaymentData(paymentData) {
      try {
        // Ensure paymentData is a string
        const inputData = typeof paymentData === 'string'
          ? paymentData
          : (paymentData?.data || paymentData?.text || String(paymentData || ''));

        // Basic validation
        if (!inputData || inputData.trim().length === 0) {
          throw new Error(this.$t('Invalid payment data'));
        }

        let trimmedData = inputData.trim();
        // Handle lightning: prefix and extract the actual invoice
        let cleanData = trimmedData.toLowerCase().startsWith('lightning:')
          ? trimmedData.substring(10)
          : trimmedData;

        // Normalize lightning addresses to lowercase (LN address standard)
        if (cleanData.includes('@') && cleanData.includes('.')) {
          cleanData = cleanData.toLowerCase();
        }

        const paymentType = this.determinePaymentType(cleanData);

        // Early warning: NWC wallet cannot pay Spark addresses
        if (paymentType === 'spark_address' && !this.isActiveWalletSpark) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Spark address detected'),
            caption: this.$t('Switch to Spark wallet to pay this address'),
            position: 'bottom',
            timeout: 4000,
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
        }

        // Emit the detected payment data to parent component
        this.$emit('payment-detected', {
          data: cleanData,
          type: paymentType
        });

        this.closeModal();

      } catch (error) {
        throw error;
      }
    },

    determinePaymentType(data) {
      const trimmed = data.trim().toLowerCase();
      // Handle lightning: prefix
      const cleanData = trimmed.startsWith('lightning:') ? trimmed.substring(10) : trimmed;

      // Spark addresses - Zero fee transfers
      // New format: spark1 (mainnet), sparkrt1 (regtest), sparkt1 (testnet), sparks1 (signet), sparkl1 (local)
      // Legacy format: sp1 (mainnet), tsp1 (testnet), sprt1 (regtest)
      if (this.isSparkAddress(cleanData)) return 'spark_address';
      // Lightning invoices: lnbc (mainnet), lntb (testnet), lntbs (signet), lnbcrt (regtest)
      if (cleanData.startsWith('lnbc') || cleanData.startsWith('lntb') ||
          cleanData.startsWith('lntbs') || cleanData.startsWith('lnbcrt')) return 'lightning_invoice';
      if (cleanData.includes('@') && cleanData.includes('.')) return 'lightning_address';
      if (cleanData.startsWith('lnurl')) return 'lnurl';
      return 'unknown';
    },

    isSparkAddress(address) {
      if (!address) return false;
      const normalized = address.toLowerCase().trim();
      // New format prefixes
      const newPrefixes = ['spark1', 'sparkrt1', 'sparkt1', 'sparks1', 'sparkl1'];
      // Legacy format prefixes
      const legacyPrefixes = ['sp1', 'tsp1', 'sprt1'];
      return newPrefixes.some(p => normalized.startsWith(p)) ||
             legacyPrefixes.some(p => normalized.startsWith(p));
    },

    validatePaymentInput(input) {
      if (!input || input.trim().length === 0) {
        return this.$t('Please enter a payment request');
      }

      let trimmed = input.trim().toLowerCase();
      // Strip lightning: prefix if present
      if (trimmed.startsWith('lightning:')) {
        trimmed = trimmed.substring(10);
      }
      // Lightning invoices: lnbc (mainnet), lntb (testnet), lntbs (signet), lnbcrt (regtest)
      const isLightningInvoice = trimmed.startsWith('lnbc') || trimmed.startsWith('lntb') ||
        trimmed.startsWith('lntbs') || trimmed.startsWith('lnbcrt');
      const isLightningAddress = trimmed.includes('@') && trimmed.includes('.');
      const isLnurl = trimmed.startsWith('lnurl');
      const isSparkAddr = this.isSparkAddress(trimmed);

      const isValid = isLightningInvoice || isLightningAddress || isLnurl || isSparkAddr;

      return isValid ? true : this.$t('Invalid payment format');
    },

    showManualInput() {
      this.showManualDialog = true;
      this.manualInput = '';
    },

    async pasteFromClipboard() {
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText.trim()) {
          await this.processPaymentData(clipboardText.trim());
        } else {
          this.$q.notify({
            type: 'info',
            message: this.$t('Nothing to paste'),
            position: 'bottom',
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
        }
      } catch (error) {
        console.error('Clipboard error:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t access clipboard'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      }
    },

    async showContactPicker() {
      // Initialize the address book store to load contacts from localStorage
      await this.addressBookStore.initialize();
      this.showContactDialog = true;
      this.contactSearch = '';
    },

    goToAddressBook() {
      this.showContactDialog = false;
      this.closeModal();
      this.$router.push('/address-book');
    },

    async selectContact(contact) {
      // Check if user can pay this contact
      if (!this.canPayContact(contact)) {
        this.$q.notify({
          type: 'warning',
          message: this.$t('Cannot pay this contact'),
          caption: this.getContactDisabledReason(contact),
          position: 'bottom',
          timeout: 3500,
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
        return;
      }

      // Use store methods for consistent address/type detection
      const address = this.getContactAddress(contact);
      const addressType = this.getContactAddressType(contact);

      // Update last used timestamp for recent contacts tracking
      await this.addressBookStore.updateLastUsed(contact.id);

      this.$emit('payment-detected', {
        data: address,
        type: addressType === 'spark' ? 'spark_address' : 'lightning_address'
      });
      this.showContactDialog = false;
      this.closeModal();
    },

    // Contact type helper methods - use store methods for consistency and auto-detection
    getContactAddress(contact) {
      return this.addressBookStore.getEntryAddress(contact);
    },

    getContactAddressType(contact) {
      return this.addressBookStore.getEntryAddressType(contact);
    },

    getContactTypeIcon(contact) {
      const type = this.getContactAddressType(contact);
      return type === 'spark' ? 'las la-fire' : 'las la-bolt';
    },

    getContactTypeLabel(contact) {
      const type = this.getContactAddressType(contact);
      return type === 'spark' ? 'Spark' : 'Lightning';
    },

    getContactTypeBadgeClass(contact) {
      const type = this.getContactAddressType(contact);
      return type === 'spark' ? 'badge-spark' : 'badge-lightning';
    },

    canPayContact(contact) {
      const type = this.getContactAddressType(contact);
      if (type === 'spark') {
        // Spark contacts can only be paid from Spark wallet
        return this.isActiveWalletSpark;
      }
      // Lightning contacts can be paid from any wallet
      return true;
    },

    getContactDisabledReason(contact) {
      if (!this.canPayContact(contact)) {
        return this.$t('Switch to Spark wallet to pay this contact');
      }
      return '';
    },

    async processManualInput() {
      if (!this.isValidManualInput) return;

      this.showManualDialog = false;
      this.isProcessing = true;

      try {
        await this.processPaymentData(this.manualInput.trim());
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Invalid payment request'),
          caption: error.message,
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
        this.isProcessing = false;
      }
    },

    closeModal() {
      this.show = false;
    },

    resetState() {
      this.isProcessing = false;
      this.cameraError = null;
      this.manualInput = '';
      this.showManualDialog = false;
    }
  }
}
</script>

<style scoped>
.send-modal :deep(.q-dialog__inner) {
  padding: 0;
}

.send-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.send-card-dark {
  background: #0C0C0C;
  color: #FFF;
}

.send-card-light {
  background: #FFF;
  color: #212121;
}

/* Header */
.send-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding: 1rem;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.back-btn {
  color: inherit;
}

.header-title {
  flex: 1;
  text-align: center;
}

.header-spacer {
  width: 40px;
}

/* Camera Container */
.camera-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #000;
}

.camera-view {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.processing-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 5;
}

.processing-text {
  color: white;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 500;
  margin-top: 1rem;
}

.camera-error {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #1f2937;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
}

.error-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 20px;
  font-weight: 600;
  color: white;
  margin: 1rem 0 0.5rem;
}

.error-subtitle {
  color: #9ca3af;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  margin-bottom: 1.5rem;
  line-height: 1.5;
}

.retry-btn {
  border-radius: 24px;
}

/* Scanning Frame */
.scanning-frame {
  display: none !Important;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 250px;
  height: 250px;
  pointer-events: none;
}

.frame-corner {
  position: absolute;
  width: 30px;
  height: 30px;
  border: 3px solid #15DE72;
}

.frame-corner.top-left {
  top: 0;
  left: 0;
  border-right: none;
  border-bottom: none;
}

.frame-corner.top-right {
  top: 0;
  right: 0;
  border-left: none;
  border-bottom: none;
}

.frame-corner.bottom-left {
  bottom: 0;
  left: 0;
  border-right: none;
  border-top: none;
}

.frame-corner.bottom-right {
  bottom: 0;
  right: 0;
  border-left: none;
  border-top: none;
}

/* Bottom Actions */
.send-actions {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 1rem;
  flex-shrink: 0;
}

.action-buttons {
  display: flex;
  justify-content: space-around;
  gap: 1rem;
}

.action-btn {
  flex: 1;
  height: 80px;
  border-radius: 16px;
  transition: all 0.2s ease;
}

.action-btn-dark {
  background: rgba(42, 52, 42, 0.5);
  color: white;
}

.action-btn-light {
  background: rgba(0, 0, 0, 0.05);
  color: #212121;
}

.action-btn-dark:hover {
  background: rgba(42, 52, 42, 0.8);
  transform: translateY(-2px);
}

.action-btn-light:hover {
  background: rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.btn-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.btn-icon {
  color: #15DE72;
}

.btn-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Manual Input Dialog */
.manual-dialog :deep(.q-dialog__inner) {
  padding: 1rem;
}

.manual-card {
  width: 100%;
  max-width: 500px;
  border-radius: 24px;
}

.manual-header {
  border-bottom: 1px solid;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.manual-title {
  font-family: Fustat, 'Inter', sans-serif;
}

.close-btn {
  color: #6b7280;
}

/* Blur backdrop for manual dialog */
.manual-dialog-backdrop :deep(.q-dialog__backdrop) {
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.manual-content {
  padding: 1.5rem;
}

.manual-input {
  margin-bottom: 0.5rem;
}

.manual-input :deep(.q-field__control) {
  border-radius: 12px;
}

/* Dark mode input styling - green instead of blue */
.manual-input-dark :deep(.q-field__control) {
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.manual-input-dark :deep(.q-field--focused .q-field__control) {
  border-color: #15DE72 !important;
}

.manual-input-dark :deep(.q-field__label) {
  color: #B0B0B0;
}

.manual-input-dark :deep(.q-field--focused .q-field__label),
.manual-input-dark :deep(.q-field--float .q-field__label) {
  color: #15DE72 !important;
}

.manual-input-dark :deep(.q-field__native) {
  color: #FFF !important;
}

/* Light mode input styling - green instead of blue */
.manual-input-light :deep(.q-field__control) {
  border-color: rgba(0, 0, 0, 0.15) !important;
}

.manual-input-light :deep(.q-field--focused .q-field__control) {
  border-color: #15DE72 !important;
}

.manual-input-light :deep(.q-field__label) {
  color: #6B7280;
}

.manual-input-light :deep(.q-field--focused .q-field__label),
.manual-input-light :deep(.q-field--float .q-field__label) {
  color: #15DE72 !important;
}

.manual-input-light :deep(.q-field__native) {
  color: #212121 !important;
}

/* Continue button - green text */
.continue-btn {
  color: #15DE72 !important;
  font-weight: 600;
}

.continue-btn:disabled {
  color: #6b7280 !important;
  opacity: 0.5;
}

/* Action buttons border colors */
.actions-dark {
  border-top-color: rgba(255, 255, 255, 0.1);
}

.actions-light {
  border-top-color: rgba(0, 0, 0, 0.1);
}

.manual-actions {
  border-top: 1px solid;
}

/* Responsive Design */
@media (max-width: 480px) {
  .scanning-frame {
    width: 200px;
    height: 200px;
  }

  .action-buttons {
    gap: 0.5rem;
  }

  .action-btn {
    height: 70px;
  }

  .btn-label {
    font-size: 12px;
  }

  .manual-content {
    padding: 1rem;
  }
}

/* Contact Picker Dialog */
.contact-dialog-backdrop :deep(.q-dialog__backdrop) {
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.contact-picker-card {
  width: 100%;
  max-width: 400px;
  border-radius: 24px;
  overflow: hidden;
}

.contact-picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.contact-picker-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 600;
}

.contact-search-section {
  padding: 0.75rem 1rem 0;
}

.contact-search :deep(.q-field__control) {
  border-radius: 12px;
}

.contact-list-section {
  padding: 0.5rem 0;
  max-height: 350px;
  overflow-y: auto;
}

/* Empty State */
.contact-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1.5rem;
  text-align: center;
}

.empty-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 16px;
  font-weight: 600;
  margin-top: 1rem;
}

.empty-subtitle {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  margin-top: 0.5rem;
  line-height: 1.4;
  max-width: 250px;
}

.add-contact-cta {
  margin-top: 1.25rem;
  height: 44px;
  border-radius: 22px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
  padding: 0 1.5rem;
}

/* Contact List */
.contact-list {
  display: flex;
  flex-direction: column;
}

/* Contact Section Headers */
.contact-section-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem 0.5rem;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-header-dark {
  color: #777;
}

.section-header-light {
  color: #9CA3AF;
}

.contact-item {
  display: flex;
  align-items: center;
  padding: 0.875rem 1.25rem;
  cursor: pointer;
  transition: background-color 0.15s ease;
  gap: 0.875rem;
}

.contact-item-dark:hover {
  background: rgba(21, 222, 114, 0.08);
}

.contact-item-dark:active {
  background: rgba(21, 222, 114, 0.15);
}

.contact-item-light:hover {
  background: rgba(21, 222, 114, 0.08);
}

.contact-item-light:active {
  background: rgba(21, 222, 114, 0.12);
}

.contact-disabled {
  opacity: 0.5;
}

.contact-disabled:hover {
  background: transparent !important;
  cursor: not-allowed;
}

.contact-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 600;
  color: white;
  flex-shrink: 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.contact-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.contact-name-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.contact-name {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact-type-badge {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.badge-lightning {
  background: linear-gradient(135deg, #F59E0B, #D97706);
  color: white;
}

.badge-spark {
  background: linear-gradient(135deg, #EF4444, #DC2626);
  color: white;
}

.contact-address {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Scrollbar styling for contact list */
.contact-list-section::-webkit-scrollbar {
  width: 4px;
}

.contact-list-section::-webkit-scrollbar-track {
  background: transparent;
}

.contact-list-section::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.3);
  border-radius: 2px;
}

.contact-list-section::-webkit-scrollbar-thumb:hover {
  background: rgba(128, 128, 128, 0.5);
}
</style>
