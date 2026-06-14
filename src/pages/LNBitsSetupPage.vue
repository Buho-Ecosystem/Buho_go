<template>
  <!-- Loading Screen -->
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <q-page class="lnbits-setup-page flex flex-center" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <div class="container">

      <q-card
        class="setup-card"
        :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
        v-if="!showScanner"
      >
        <q-card-section class="card-header">
          <div class="header-with-back">
            <q-btn
              flat
              round
              dense
              @click="goBack"
              class="back-btn"
              :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
            >
              <svg v-if="$q.dark.isActive" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z" fill="white"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z" fill="#6D6D6D"/>
              </svg>
            </q-btn>
            <div class="header-logo">
              <svg xmlns="http://www.w3.org/2000/svg" width="30" height="32" viewBox="0 0 30 32" fill="none">
                <path d="M0 13.4423C0 6.01833 6.01833 0 13.4423 0V18.5577C13.4423 25.9817 7.42399 32 0 32V13.4423Z"
                      fill="#059573"/>
                <path
                  d="M15.3906 7.30444C15.3906 3.27031 18.6609 0 22.6951 0C26.7292 0 29.9995 3.27031 29.9995 7.30444V7.72091C29.9995 11.755 26.7292 15.0253 22.6951 15.0253C18.6609 15.0253 15.3906 11.755 15.3906 7.72091V7.30444Z"
                  fill="#15DE72"/>
                <path
                  d="M15.3906 24.281C15.3906 20.2469 18.6609 16.9766 22.6951 16.9766C26.7292 16.9766 29.9995 20.2469 29.9995 24.281V24.6975C29.9995 28.7316 26.7292 32.0019 22.6951 32.0019C18.6609 32.0019 15.3906 28.7316 15.3906 24.6975V24.281Z"
                  fill="#43B65B"/>
              </svg>
              <span class="app-title">BuhoGO</span>
            </div>
            <div class="header-spacer"></div>
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="lnbits-logo-container">
            <div class="lnbits-logo-bg">
              <!-- LNbits Lightning Bolt (official) -->
              <svg xmlns="http://www.w3.org/2000/svg" width="50" height="60" viewBox="0 0 502 902" fill="none">
                <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
              </svg>
            </div>
          </div>

          <div class="welcome-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ $t('Connect LNbits') }}
          </div>

          <div class="welcome-subtitle" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Enter your LNbits server details') }}
          </div>

          <!-- Server URL Input -->
          <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Server URL') }}
          </div>
          <q-input
            v-model="serverUrl"
            :placeholder="$t('https://your.lnbits.server')"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            input-class="q-px-md"
            borderless
            dense
            class="q-mb-md"
          />

          <!--
            Wallet ID is intentionally *not* in this form.

            LNbits server-side scopes each admin key to exactly one wallet,
            so `GET /api/v1/wallet` with just the admin key reveals the
            walletId. `LNBitsWalletProvider.validateCredentials` already
            does this discovery, and `addLNBitsWallet` persists the
            server-returned id into `connectionData.walletId`.

            Asking the user for it would be redundant data entry — and
            LNbits doesn't even issue a QR for it (only a copy button),
            so it's the most friction-heavy field by far. We just skip it.
          -->

          <!-- Admin Key Input -->
          <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Admin Key') }}
          </div>
          <q-input
            v-model="adminKey"
            :placeholder="$t('Paste your admin key here')"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            input-class="q-px-md"
            borderless
            dense
            class="q-mb-md"
            :type="showAdminKey ? 'text' : 'password'"
          >
            <template v-slot:append>
              <q-btn
                flat
                round
                dense
                @click="showAdminKey = !showAdminKey"
                :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
              >
                <Icon :icon="showAdminKey ? 'tabler:eye-off' : 'tabler:eye'" width="16" height="16" />
              </q-btn>
            </template>
          </q-input>

          <!-- Error Message -->
          <div v-if="errorMessage" class="error-message q-mb-md">
            {{ errorMessage }}
          </div>

          <div class="button-row">
            <q-btn
              class="connect-btn-inline"
              :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
              :loading="isConnecting"
              @click="validateAndConnect"
              :disable="!serverUrl || !adminKey"
              no-caps
              unelevated
            >
              <span v-if="!isConnecting">{{ $t('Connect') }}</span>
              <template v-slot:loading>
                <q-spinner-dots class="q-mr-sm"/>
                {{ $t('Connecting...') }}
              </template>
            </q-btn>

            <q-btn
              unelevated
              class="scan-qr-btn-inline"
              :class="$q.dark.isActive ? 'scan-qr-btn-inline-dark' : 'scan-qr-btn-inline-light'"
              @click="openScanner"
              no-caps
            >
              <!--
                Inline SVG (Tabler "scan" outline) rather than the Iconify
                <Icon> component: the network-loaded `tabler:qrcode-scan`
                resolves to an empty SVG in this build (see DOM audit at
                the time of the fix), and inlining keeps the button
                icon-on-first-paint with no async dependency.
              -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18" height="18" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"
                class="q-mr-sm scan-qr-btn-icon"
                aria-hidden="true"
              >
                <path d="M4 7V6a2 2 0 0 1 2-2h2" />
                <path d="M4 17v1a2 2 0 0 0 2 2h2" />
                <path d="M16 4h2a2 2 0 0 1 2 2v1" />
                <path d="M16 20h2a2 2 0 0 0 2-2v-1" />
                <path d="M5 12h14" />
              </svg>
              <span>{{ $t('Scan') }}</span>
            </q-btn>
          </div>

          <div class="help-text q-mt-md" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Find your admin key in LNbits under API Info') }}
          </div>
          <div class="help-text q-mt-xs" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Or paste an LNDhub link and we will fill both fields') }}
          </div>
        </q-card-section>

      </q-card>

      <!-- QR Scanner Card -->
      <q-card
        class="setup-card"
        :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
        v-else
      >
        <q-card-section class="card-header">
          <div class="scanner-header">
            <q-btn
              flat
              round
              dense
              @click="closeScanner"
              class="back-btn"
              :class="$q.dark.isActive ? 'back-btn-dark' : 'back-btn-light'"
            >
              <Icon icon="tabler:chevron-left" width="18" height="18" />
            </q-btn>
            <div class="scanner-title-container">
              <div class="scanner-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
                {{ $t('Scan QR Code') }}
              </div>
              <div class="scanner-subtitle" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
                {{ scannerSubtitle }}
              </div>
              <!--
                Progress strip — shows which of the two scannable values
                are already captured. Both have QRs in LNbits, so the
                user can scan both in one continuous session without
                reopening the camera.
              -->
              <div class="scan-progress-strip">
                <span class="scan-progress-pill" :class="{ 'scan-progress-pill-done': scanProgress.server }">
                  <Icon v-if="scanProgress.server" icon="tabler:check" width="12" height="12" />
                  <span>{{ $t('Server') }}</span>
                </span>
                <span class="scan-progress-divider">·</span>
                <span class="scan-progress-pill" :class="{ 'scan-progress-pill-done': scanProgress.adminKey }">
                  <Icon v-if="scanProgress.adminKey" icon="tabler:check" width="12" height="12" />
                  <span>{{ $t('Admin Key') }}</span>
                </span>
              </div>
            </div>
            <div class="header-spacer"></div>
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="qr-scanner-container" :class="$q.dark.isActive ? 'scanner-dark' : 'scanner-light'">
            <video
              v-if="!cameraError"
              ref="videoElement"
              class="qr-video"
              style="width: 100%; height: 100%; object-fit: cover; border-radius: 16px;"
              playsinline
            />

            <!-- Camera Error State -->
            <div v-if="cameraError" class="camera-error">
              <Icon icon="tabler:camera" style="font-size: 3em; color: #9CA3AF;" />
              <p class="error-text">{{ cameraErrorMessage }}</p>
              <q-btn
                unelevated
                :label="$t('Try Again')"
                @click="retryCamera"
                class="retry-btn"
                :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
                no-caps
              />
            </div>

            <!-- Loading State -->
            <div v-if="cameraLoading && !cameraError" class="camera-loading">
              <q-spinner-dots color="#15DE72" size="2em"/>
              <p class="loading-text">{{ $t('Starting camera...') }}</p>
            </div>

            <!-- Scanning Frame -->
            <div v-if="!cameraError && !cameraLoading" class="scanning-frame">
              <div class="frame-corner top-left"></div>
              <div class="frame-corner top-right"></div>
              <div class="frame-corner bottom-left"></div>
              <div class="frame-corner bottom-right"></div>
            </div>
          </div>
        </q-card-section>

        <q-card-section class="card-footer">
          <q-btn
            unelevated
            class="full-width cancel-btn"
            :class="$q.dark.isActive ? 'more_btn_dark' : 'more_btn_light'"
            :label="$t('Cancel')"
            @click="closeScanner"
            no-caps
          />
        </q-card-section>
      </q-card>

      <!-- Wallet Name Dialog -->
      <q-dialog v-model="showNameDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
        <q-card class="name-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
          <q-card-section class="dialog-header">
            <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
              {{ $t('Name Your Wallet') }}
            </div>
            <q-btn
              flat
              round
              dense
              icon="close"
              v-close-popup
              class="close-btn"
              :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
            />
          </q-card-section>

          <q-card-section class="dialog-content">
            <!-- Wallet Info Preview -->
            <div class="wallet-preview q-mb-md" :class="$q.dark.isActive ? 'preview-dark' : 'preview-light'">
              <div class="preview-row">
                <span class="preview-label">{{ $t('Server') }}</span>
                <span class="preview-value">{{ displayServerUrl }}</span>
              </div>
              <div class="preview-row">
                <span class="preview-label">{{ $t('Wallet ID') }}</span>
                <span class="preview-value preview-id">{{ validatedWalletId }}</span>
              </div>
              <div class="preview-row">
                <span class="preview-label">{{ $t('Balance') }}</span>
                <span class="preview-value">{{ validatedBalance }} sats</span>
              </div>
            </div>

            <q-input
              v-model="walletName"
              :placeholder="validatedWalletName || $t('My LNbits Wallet')"
              :rules="[val => !!val || $t('Wallet name is required')]"
              autofocus
              :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
              borderless
              input-class="q-px-md"
              dense
              hide-bottom-space
            />
            <div class="input-hint" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ $t('Choose a name to easily identify this wallet') }}
            </div>
          </q-card-section>

          <q-card-actions align="right" class="dialog-actions">
            <q-btn
              flat
              :label="$t('Cancel')"
              v-close-popup
              class="cancel-action-btn"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
            />
            <q-btn
              unelevated
              :label="$t('Add Wallet')"
              @click="addWallet"
              :disable="!walletName"
              class="continue-action-btn"
              :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
              no-caps
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- Post-connect: offer to attach a lightning address (lnurlp extension). -->
      <!-- Skipped in kiosk mode so unattended setups don't stall on this dialog. -->
      <LNBitsLightningAddressDialog
        v-if="addressPrompt.visible"
        v-model="addressPrompt.visible"
        :domain="addressPrompt.domain"
        :existing-addresses="addressPrompt.existingAddresses"
        :default-username="addressPrompt.defaultUsername"
        :create-address="addressPrompt.createAddress"
        @confirm="onLightningAddressConfirm"
        @skip="onLightningAddressSkip"
      />
    </div>

    <!-- Native MLKit scanner (iOS/Android). Continuous so it captures both the
         server URL and admin key in one session. Teleports to <body>. -->
    <ScannerOverlay
      v-if="nativeScannerActive"
      :active="nativeScannerActive"
      :title="$t('Scan QR Code')"
      :prompt="$t('Scan your LNbits server URL and admin key')"
      continuous
      @scanned="handleQrScan"
      @close="closeScanner"
    />
  </q-page>
</template>

<script>
import QrScanner from 'qr-scanner'
import { createQrScanner } from '../utils/qrScanner'
import { isNativeScannerAvailable } from '../utils/nativeScanner'
import ScannerOverlay from '../components/ScannerOverlay.vue'
import LoadingScreen from '../components/LoadingScreen.vue'
import LNBitsLightningAddressDialog from '../components/LNBitsLightningAddressDialog.vue'
import { useWalletStore } from '../stores/wallet'
import { LNBitsWalletProvider } from '../providers/LNBitsWalletProvider'
import { mapActions, mapState } from 'pinia'
import { getUserFriendlyErrorMessage } from '../utils/userErrors'
import { isLndhubUri, parseLndhubUri } from '../utils/lndhub'

export default {
  name: 'LNBitsSetupPage',
  components: {
    LoadingScreen,
    LNBitsLightningAddressDialog,
    ScannerOverlay,
  },
  data() {
    return {
      serverUrl: '',
      adminKey: '',
      showAdminKey: false,
      isConnecting: false,
      errorMessage: '',
      showScanner: false,
      nativeScannerActive: false,
      // Continuous-scan flow state. The scanner stays open until both
      // scannable values (serverUrl, adminKey) are populated or the
      // user cancels. `scanMode` is the value we're currently prompting
      // for; it auto-advances after each successful scan. Wallet ID
      // isn't here — LNbits server-side scopes the adminKey to one
      // wallet, so the store action discovers it via GET /api/v1/wallet.
      scanMode: 'url', // 'url' | 'key'
      cameraError: false,
      cameraErrorMessage: '',
      cameraLoading: true,
      qrScanner: null,
      showNameDialog: false,
      walletName: '',
      showLoadingScreen: false,
      loadingText: '',
      // Validated data from server
      validatedServerUrl: '',
      validatedWalletId: '',
      validatedWalletName: '',
      validatedBalance: 0,
      // Post-connect lightning-address prompt.
      // Populated by maybePromptLightningAddress() once the wallet is saved and
      // we've verified the lnurlp extension is available.
      addressPrompt: {
        visible: false,
        walletId: null,
        domain: '',
        existingAddresses: [],
        defaultUsername: '',
        createAddress: null,
      },
    }
  },
  computed: {
    ...mapState(useWalletStore, ['kioskEnabled']),
    displayServerUrl() {
      try {
        const url = new URL(this.validatedServerUrl);
        return url.hostname;
      } catch {
        return this.validatedServerUrl;
      }
    },

    /**
     * Has the current scanner session captured each scannable value?
     * Wallet ID isn't here because LNbits doesn't issue a QR for it.
     */
    scanProgress() {
      return {
        server: !!this.serverUrl,
        adminKey: !!this.adminKey,
      };
    },

    /**
     * True when both scannable values are in. Scanner closes when this
     * flips to true (see handleQrScan).
     */
    allScannableFieldsCaptured() {
      return this.scanProgress.server && this.scanProgress.adminKey;
    },

    /**
     * Header subtitle for the scanner — reflects what we're currently
     * asking the user to scan, based on which field is still missing.
     */
    scannerSubtitle() {
      if (this.scanMode === 'url' && !this.serverUrl) {
        return this.$t('Scan your LNbits server URL');
      }
      return this.$t('Scan your admin key');
    },
  },
  watch: {
    // Accept an LNbits LNDhub export pasted into EITHER field. The URI
    // carries the server URL + admin key, so we split it across both
    // fields wherever it lands. Setting the fields with the exploded
    // (non-lndhub) values re-triggers these watchers harmlessly —
    // isLndhubUri() short-circuits, so there's no recursion.
    serverUrl(val) {
      this.applyLndhubUri(val);
    },
    adminKey(val) {
      this.applyLndhubUri(val);
    },
  },
  beforeUnmount() {
    this.stopQrScanner();
  },
  methods: {
    ...mapActions(useWalletStore, ['addLNBitsWallet', 'setWalletLightningAddress', 'showPaymentError']),

    /**
     * If `value` is an LNbits LNDhub export URI, explode it into the
     * serverUrl + adminKey fields and return true. LNbits hands users a
     * single `lndhub://login:key@host/lndhub/ext/` string that already
     * carries exactly what this form needs, so we accept it pasted into
     * either field or scanned, rather than making them tease it apart.
     *
     * @param {string} value
     * @param {{scanned?: boolean}} [opts] - tweaks the feedback wording and
     *        routes parse errors to a toast (scan) vs the inline error (form).
     * @returns {boolean} true if an LNDhub URI was consumed.
     */
    applyLndhubUri(value, { scanned = false } = {}) {
      if (!isLndhubUri(value)) return false;

      const parsed = parseLndhubUri(value);
      if (!parsed) {
        // Looked like lndhub:// but wasn't an LNbits endpoint we can use.
        // Only complain once it's a complete-looking URI (has the '@host'
        // part) so we don't nag mid-paste / mid-type.
        if (value.includes('@')) {
          const msg = this.$t('This LNDhub link is not from an LNbits server');
          if (scanned) {
            this.$q.notify({ type: 'warning', message: msg, timeout: 2200 });
          } else {
            this.errorMessage = msg;
          }
        }
        return false;
      }

      this.serverUrl = parsed.serverUrl;
      this.adminKey = parsed.adminKey;
      this.errorMessage = '';

      if (parsed.login === 'invoice') {
        // The invoice key is read-only: it can receive but never pay. Fill
        // the field anyway (receive-only is still useful) but warn loudly,
        // or the user only finds out when their first send fails.
        this.$q.notify({
          type: 'warning',
          message: this.$t('That looks like an invoice (read-only) key'),
          caption: this.$t('You can receive but not send'),
          timeout: 3000,
        });
      } else {
        this.$q.notify({
          type: 'positive',
          message: scanned
            ? this.$t('LNbits connection scanned')
            : this.$t('LNbits connection details detected'),
          timeout: 1700,
        });
      }
      return true;
    },

    goBack() {
      if (window.history.length > 1) {
        this.$router.back();
      } else {
        this.$router.push('/');
      }
    },

    async validateAndConnect() {
      if (!this.serverUrl.trim() || !this.adminKey.trim()) {
        this.errorMessage = this.$t('Please fill in all fields');
        return;
      }

      this.isConnecting = true;
      this.errorMessage = '';

      try {
        // Walletid is server-side scoped to the admin key, so we don't
        // require it from the user — validateCredentials() will discover
        // it via GET /api/v1/wallet and we'll persist whatever comes back.
        const validation = await LNBitsWalletProvider.validateCredentials(
          this.serverUrl.trim(),
          undefined, // walletId — auto-discover
          this.adminKey.trim()
        );

        // Store validated data
        this.validatedServerUrl = validation.serverUrl;
        this.validatedWalletId = validation.walletInfo.id;
        this.validatedWalletName = validation.walletInfo.name;
        this.validatedBalance = validation.walletInfo.balance;
        this.walletName = validation.walletInfo.name;

        // Show name dialog
        this.showNameDialog = true;

      } catch (error) {
        console.error('LNbits validation failed:', error);
        this.errorMessage = getUserFriendlyErrorMessage(error, 'connect', this.$t.bind(this));
      } finally {
        this.isConnecting = false;
      }
    },

    async addWallet() {
      if (!this.walletName.trim()) return;

      this.showNameDialog = false;
      this.showLoadingScreen = true;
      this.loadingText = this.$t('Adding wallet...');

      let wallet;
      try {
        wallet = await this.addLNBitsWallet({
          name: this.walletName.trim(),
          serverUrl: this.validatedServerUrl,
          walletId: this.validatedWalletId,
          adminKey: this.adminKey.trim(),
        });

        this.loadingText = this.$t('Loading wallet...');
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error('Failed to add LNbits wallet:', error);
        this.showLoadingScreen = false;
        this.showPaymentError(error, {
          context: 'connect',
          route: 'Add LNbits wallet',
          t: this.$t.bind(this),
        });
        return;
      }

      // Wallet is saved. In kiosk mode we never interrupt with extra dialogs —
      // head straight to the success screen. Otherwise offer to set up a
      // lightning address if the server supports it.
      if (this.kioskEnabled) {
        this.goToSuccess();
        return;
      }

      const prompted = await this.maybePromptLightningAddress(wallet);
      if (!prompted) {
        // No lnurlp extension (or probe failed) — nothing to prompt, just finish.
        this.goToSuccess();
      }
      // If prompted === true, navigation happens after the user responds to
      // the dialog (see onLightningAddressConfirm / onLightningAddressSkip).
    },

    /**
     * Navigate to the standard post-setup success screen. Kept as a single
     * method so every exit path (kiosk, dialog skipped, dialog confirmed,
     * lnurlp unavailable) lands in the same place.
     */
    goToSuccess() {
      this.$router.replace('/spark-success?mode=nwc-lnbits');
    },

    /**
     * Check whether the connected LNbits server has the lnurlp extension and,
     * if so, open the lightning-address dialog pre-populated with any
     * existing addresses on the wallet.
     *
     * Hides the loading screen before opening the dialog so the user sees
     * the prompt on a clean background.
     *
     * @param {Object} wallet - the freshly-created wallet object from the store
     * @returns {Promise<boolean>} true if the dialog was opened, false otherwise
     */
    async maybePromptLightningAddress(wallet) {
      if (!wallet) return false;

      // Build a throwaway provider instance pinned to the wallet we just added.
      // We don't use the store-managed connection because the dialog's lifecycle
      // is self-contained and we want to keep these API calls isolated.
      const provider = new LNBitsWalletProvider(wallet.id, {
        name: wallet.name,
        serverUrl: wallet.connectionData.serverUrl,
        walletId: wallet.connectionData.walletId,
        adminKey: wallet.connectionData.adminKey,
      });

      const available = await provider.checkLnurlpAvailable();
      if (!available) return false;

      let existing = [];
      try {
        existing = await provider.listLightningAddresses();
      } catch (e) {
        // Extension present but listing failed — proceed with empty list so
        // the user can still create one. Don't block the flow on a non-fatal error.
        console.warn('Failed to list existing lightning addresses:', e);
      }

      const domain = new URL(wallet.connectionData.serverUrl).hostname;

      this.showLoadingScreen = false;
      this.addressPrompt = {
        visible: true,
        walletId: wallet.id,
        domain,
        existingAddresses: existing,
        // Suggest a username derived from the wallet name (lowercase, alphanumeric).
        // The dialog sanitises this further before using it.
        defaultUsername: wallet.name || '',
        // The dialog invokes this when the user clicks "Create address".
        // Bound here so the provider instance stays in closure.
        createAddress: (username) => provider.createLightningAddress({ username }),
      };
      return true;
    },

    async onLightningAddressConfirm({ address }) {
      try {
        await this.setWalletLightningAddress(this.addressPrompt.walletId, address);
      } catch (e) {
        // Persisting the address is a local-only op; failure here is extremely
        // unlikely but we don't want to strand the user. Notify and move on.
        console.error('Failed to save lightning address locally:', e);
        this.$q.notify({
          type: 'warning',
          message: this.$t('Address created but not saved locally'),
          caption: this.$t('You can set it again from Settings.'),
        });
      } finally {
        this.resetAddressPrompt();
        this.goToSuccess();
      }
    },

    onLightningAddressSkip() {
      this.resetAddressPrompt();
      this.goToSuccess();
    },

    resetAddressPrompt() {
      this.addressPrompt = {
        visible: false,
        walletId: null,
        domain: '',
        existingAddresses: [],
        defaultUsername: '',
        createAddress: null,
      };
    },

    async openScanner() {
      // Pick initial mode based on which scannable field is still empty.
      // The mode auto-advances after each successful scan (see handleQrScan).
      this.scanMode = !this.serverUrl ? 'url' : 'key';

      // Native (iOS/Android): mount the MLKit ScannerOverlay in continuous mode
      // so it keeps scanning across both fields. Web/PWA keeps the in-page
      // qr-scanner video.
      if (isNativeScannerAvailable()) {
        this.nativeScannerActive = true;
        return;
      }
      this.showScanner = true;
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';

      await this.$nextTick();
      await this.startQrScanner();
    },

    /**
     * Pick the next mode based on which scannable field is still empty.
     * Returns `null` if both are captured (caller closes the scanner).
     */
    nextScanMode() {
      if (!this.serverUrl) return 'url';
      if (!this.adminKey) return 'key';
      return null;
    },

    closeScanner() {
      this.stopQrScanner();
      this.nativeScannerActive = false;
      this.showScanner = false;
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';
    },

    async startQrScanner() {
      try {
        if (!this.$refs.videoElement) {
          throw new Error('Video element not found');
        }

        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          throw new Error('No camera found on this device.');
        }

        this.qrScanner = createQrScanner(
          this.$refs.videoElement,
          (result) => this.handleQrScan(result.data),
          {
            returnDetailedScanResult: false,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: 'environment'
          }
        );

        await this.qrScanner.start();
        this.cameraLoading = false;
        this.cameraError = false;

      } catch (error) {
        console.error('Error starting QR scanner:', error);
        this.onCameraError(error);
      }
    },

    stopQrScanner() {
      if (this.qrScanner) {
        this.qrScanner.stop();
        this.qrScanner.destroy();
        this.qrScanner = null;
      }
    },

    /**
     * Classify a scanned QR payload into one of the two scannable fields,
     * then advance the continuous-scan flow:
     *
     *   • URL                → fills serverUrl (origin only — strips path/query)
     *   • 32+ character string → fills adminKey
     *
     * After capture, the scanner advances `scanMode` to whichever
     * scannable field is still empty and stays open. It only closes
     * once both `serverUrl` and `adminKey` are populated, or the user
     * taps Cancel.
     *
     * Re-scans of an already-captured field are non-blocking: we toast
     * "already captured" and keep listening so the user can keep aiming
     * at the next QR without re-opening the scanner.
     */
    handleQrScan(qrData) {
      if (!qrData) return;

      const data = qrData.trim();

      // LNbits LNDhub export — one QR that carries BOTH the server URL and
      // the admin key. Explode it and finish; no need to scan twice. Must
      // run before the URL / 32+ char classification below, or this long
      // string would be mistaken for a bare admin key.
      if (isLndhubUri(data)) {
        if (this.applyLndhubUri(data, { scanned: true })) {
          this.closeScanner();
        }
        // Whether or not it parsed, it was an LNDhub attempt — don't fall
        // through to the URL/key classifier (applyLndhubUri already gave
        // feedback on failure).
        return;
      }

      let captured = null; // 'server' | 'key' — what we just filled

      if (data.startsWith('http://') || data.startsWith('https://')) {
        // Strip path + query to keep just the origin. Handles users
        // scanning their LNbits wallet page URL (`/wallet?usr=…&wal=…`)
        // instead of the bare Node URL QR — we want the server origin
        // regardless of which one they aimed at.
        let serverUrl = data;
        try {
          const url = new URL(data);
          serverUrl = `${url.protocol}//${url.host}`;
        } catch {
          // Unparseable URL — fall through and use the raw string. The
          // connect step will surface the real error.
        }
        if (!this.serverUrl) {
          this.serverUrl = serverUrl;
          captured = 'server';
        }
      } else if (data.length >= 32 && !this.adminKey) {
        // Admin key — anything 32+ chars that isn't a URL. The server
        // is the arbiter of whether the key is actually valid; we just
        // classify the QR payload here.
        this.adminKey = data;
        captured = 'key';
      }

      if (!captured) {
        // Either we couldn't classify, or every field we *could* fill
        // is already filled. Distinguish the two for a useful message.
        const alreadyHave = (
          (data.startsWith('http') && this.serverUrl) ||
          (data.length >= 32 && this.adminKey)
        );
        this.$q.notify({
          type: alreadyHave ? 'info' : 'warning',
          message: alreadyHave ? this.$t('Already captured') : this.$t('Unrecognized QR code'),
          caption: alreadyHave ? null : this.$t('Expected a URL or an admin key'),
          timeout: 1500,
        });
        return;
      }

      const next = this.nextScanMode();
      if (next === null) {
        // Both scannable values captured — close.
        this.closeScanner();
        this.$q.notify({
          type: 'positive',
          message: this.$t('Both fields captured. Review and connect.'),
          timeout: 1800,
        });
        return;
      }

      // Stay open, advance the mode, give a brief positive cue.
      this.scanMode = next;
      this.$q.notify({
        type: 'positive',
        message: captured === 'server'
          ? this.$t('Server URL scanned')
          : this.$t('Admin key scanned'),
        timeout: 1200,
      });
    },

    onCameraError(error) {
      this.cameraError = true;
      this.cameraLoading = false;

      if (error.name === 'NotAllowedError') {
        this.cameraErrorMessage = this.$t('Camera access denied. Please allow camera permissions.');
      } else if (error.name === 'NotFoundError') {
        this.cameraErrorMessage = this.$t('No camera found on this device.');
      } else {
        this.cameraErrorMessage = this.$t('Unable to access camera.');
      }
    },

    async retryCamera() {
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';
      await this.startQrScanner();
    },
  }
}
</script>

<style scoped>
.lnbits-setup-page {
  min-height: 100vh;
  padding: 1rem;
}

.bg-dark {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.bg-light {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.container {
  width: 100%;
  max-width: 500px;
  margin: 0 auto;
}

/* Header Styling */
.card-header {
  padding: 1.5rem 1rem 1rem;
  text-align: center;
}

.header-with-back {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.header-with-back .header-logo {
  margin-bottom: 0;
}

.header-with-back .header-spacer {
  width: 40px;
}

.back-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.app-title {
  font-family: 'Manrope', sans-serif;
  font-size: 24px;
  font-weight: 800;
  line-height: 100%;
  background: linear-gradient(90deg, #059573 0%, #15DE72 50%, #78D53C 100%);
  background-size: 200% 200%;
  animation: gradientShift 3s ease-in-out infinite;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

@keyframes gradientShift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

/* LNbits Logo */
.lnbits-logo-container {
  display: flex;
  justify-content: center;
  margin: 2rem 0 1.5rem;
}

.lnbits-logo-bg {
  width: 100px;
  height: 100px;
  background: linear-gradient(135deg, #1a1a2e, #2d2d44);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(255, 31, 225, 0.3);
  position: relative;
  overflow: hidden;
}

.lnbits-logo-bg::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255, 31, 225, 0.1), transparent);
  border-radius: 50%;
}

.lnbits-logo-bg svg {
  z-index: 1;
}

/* Typography */
.welcome-title {
  text-align: center;
  margin-bottom: 0.75rem;
  font-size: 22px;
  font-weight: 700;
  font-family: 'Manrope', sans-serif;
}

.welcome-subtitle {
  text-align: center;
  margin-bottom: 1.5rem;
  font-size: 14px;
  font-family: 'Manrope', sans-serif;
}

.view_title_dark {
  color: #B0B0B0;
}

/* Input Labels */
.input-label {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 0.5rem;
  padding-left: 0.25rem;
}

/* Error Message */
.error-message {
  color: #FF4B4B;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  text-align: center;
  padding: 0.5rem;
  background: rgba(255, 75, 75, 0.1);
  border-radius: 8px;
}

/* Button Styling */
.button-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.connect-btn-inline {
  flex: 2;
  height: 52px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 400;
}

/* Secondary "Scan" CTA — paired visually with the primary "Connect"
   button beside it. Earlier revisions referenced .btn_light / .btn_dark
   which weren't defined anywhere global, so the button rendered with
   no background and a white-on-cream icon (invisible) in light mode.
   Explicit styling here keeps the icon legible across themes. */
.scan-qr-btn-inline {
  flex: 1;
  height: 52px;
  border-radius: 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  min-width: 0;
}
.scan-qr-btn-inline-light {
  background: var(--bg-input);
  color: var(--text-primary);
  border: 1px solid var(--border-card);
}
.scan-qr-btn-inline-dark {
  background: rgba(255, 255, 255, 0.06);
  color: #e8eaed;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
/* Force the QR icon to follow the button's text colour so it stays
   visible regardless of Quasar's q-btn defaults or theme variant. */
.scan-qr-btn-icon {
  color: currentColor;
}

/* Help Text */
.help-text {
  text-align: center;
  font-size: 12px;
  font-family: 'Manrope', sans-serif;
}

/* Scanner Styles */
.scanner-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  text-align: left;
}

.scanner-title-container {
  flex: 1;
}

.scanner-title {
  font-family: 'Manrope', sans-serif;
  margin-bottom: 0.5rem;
}

.scanner-subtitle {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  line-height: 1.4;
}

/* Continuous-scan progress strip — two pills (Server, Admin Key) that
   light up as their respective values get captured. Sits right under
   the scanner subtitle and provides the only visual feedback that the
   scanner is staying open for more input. */
.scan-progress-strip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.5rem;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.scan-progress-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 3px 8px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: background 0.18s ease, color 0.18s ease, transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}
body.body--light .scan-progress-pill {
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.45);
  border-color: rgba(0, 0, 0, 0.06);
}
.scan-progress-pill-done {
  background: rgba(21, 222, 114, 0.16);
  color: #15DE72;
  border-color: rgba(21, 222, 114, 0.22);
}
body.body--light .scan-progress-pill-done {
  background: rgba(5, 149, 115, 0.10);
  color: #059573;
  border-color: rgba(5, 149, 115, 0.20);
}
.scan-progress-divider {
  color: rgba(255, 255, 255, 0.25);
  font-weight: 400;
}
body.body--light .scan-progress-divider {
  color: rgba(0, 0, 0, 0.2);
}

/* Hidden-shortcut tip — only shown in URL mode before serverUrl is set.
   Surfaces the `?wal=` two-in-one scan that the parser handles
   automatically but is invisible to first-time users. */
.scan-tip {
  display: inline-flex;
  align-items: center;
  margin-top: 0.5rem;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  line-height: 1.4;
  opacity: 0.75;
}

.qr-scanner-container {
  height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  overflow: hidden;
  position: relative;
  border: 2px solid;
}

.scanner-dark {
  background: var(--bg-secondary);
  border-color: var(--border-card);
}

.scanner-light {
  background: var(--bg-secondary);
  border-color: var(--border-card);
}

/*
  Overlay the camera-error / camera-loading states on top of the
  <video> element rather than rendering them as sibling flex items.
  Without `position: absolute` the <video> (100% × 100%) and the
  overlay share row-flex space, squeezing the overlay text into a
  narrow column at the right edge of the scanner box.
*/
.camera-error,
.camera-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
}

.error-text,
.loading-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  margin: 1rem 0;
  color: #666;
  line-height: 1.4;
}

.retry-btn {
  height: 40px;
  border-radius: 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  padding: 0 1.5rem;
  margin-top: 0.5rem;
}

.scanning-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 200px;
  height: 200px;
  pointer-events: none;
  z-index: 5;
}

.frame-corner {
  position: absolute;
  width: 30px;
  height: 30px;
  border: 3px solid #FF1FE1;
}

.frame-corner.top-left { top: 0; left: 0; border-right: none; border-bottom: none; }
.frame-corner.top-right { top: 0; right: 0; border-left: none; border-bottom: none; }
.frame-corner.bottom-left { bottom: 0; left: 0; border-right: none; border-top: none; }
.frame-corner.bottom-right { bottom: 0; right: 0; border-left: none; border-top: none; }

.card-footer {
  padding: 1rem;
}

.cancel-btn {
  height: 48px;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Dialog Styling */
.name-dialog {
  width: 100%;
  max-width: 400px;
  border-radius: 24px;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid;
  border-bottom-color: #2A342A;
}

.close-btn {
  width: 32px;
  height: 32px;
}

.dialog-content {
  padding: 1.5rem;
}

/* Wallet Preview */
.wallet-preview {
  padding: 1rem;
  border-radius: 12px;
}

.preview-dark {
  background: #1A1A1A;
}

.preview-light {
  background: var(--bg-input);
}

.preview-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0;
}

.preview-label {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: #888;
}

.preview-value {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

.preview-id {
  font-family: var(--font-mono);
  font-size: 11px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.input-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  text-align: center;
  margin-top: 0.5rem;
}

.dialog-actions {
  padding: 1rem 1.5rem 1.5rem;
  gap: 0.75rem;
}

.cancel-action-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.continue-action-btn {
  height: 40px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 400;
  padding: 0 1.5rem;
}

/* Responsive Design */
@media (max-width: 480px) {
  .lnbits-setup-page {
    padding: 0.75rem;
  }

  .container {
    max-width: 100%;
  }

  .lnbits-logo-bg {
    width: 80px;
    height: 80px;
  }

  .lnbits-logo-bg svg {
    width: 42px;
    height: 50px;
  }

  .welcome-title {
    font-size: 20px;
  }

  .welcome-subtitle {
    font-size: 13px;
    margin-bottom: 1.25rem;
  }

  .button-row {
    gap: 0.5rem;
  }

  .connect-btn-inline,
  .scan-qr-btn-inline {
    height: 48px;
    font-size: 13px;
  }

  .qr-scanner-container {
    height: 250px;
  }

  .scanning-frame {
    width: 180px;
    height: 180px;
  }

  .name-dialog {
    max-width: 350px;
    margin: 1rem;
  }
}
</style>
