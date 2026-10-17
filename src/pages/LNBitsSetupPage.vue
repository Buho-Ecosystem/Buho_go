<template>
  <!-- Loading Screen -->
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <!-- The route presents as a 100% bottom sheet: dimmed ground, surface
       at the large detent, grabber + glass back for chrome. The identity
       lives in the centered hero, so the bar itself stays headerless. -->
  <q-page class="iform-sheet-page">
    <div class="iform-sheet-scrim" aria-hidden="true" @click="onScrim"></div>

    <div class="iform-sheet" role="dialog" aria-modal="true" :aria-label="$t('Connect LNbits')">
      <div class="iform-sheet-grab" aria-hidden="true"></div>

      <!-- After Connect: the wallet's name, then its Lightning address (or
           why there can be none yet). Steps of this same sheet, never
           dialogs stacked on it. -->
      <LNBitsWalletFound
        v-if="step === 'name'"
        v-model:name="walletName"
        :domain="displayServerUrl"
        :balance-sats="validatedBalance"
        @back="step = 'connect'"
        @add="addWallet"
      />
      <LNBitsAddressStep
        v-else-if="step === 'address'"
        :domain="address.domain"
        :existing-addresses="address.existing"
        :default-username="walletName"
        :create-address="createLightningAddress"
        :skip-label="$t('Not now')"
        @skip="goToSuccess"
        @confirm="onLightningAddressConfirm"
      />
      <LNBitsPayLinksStep
        v-else-if="step === 'paylinks'"
        :server-url="validatedServerUrl"
        :domain="address.domain"
        :check-status="checkPayLinks"
        @done="goToSuccess"
        @available="openAddressStep"
      />

      <!-- Connect form -->
      <template v-else-if="!showScanner">
        <header class="iform-sheet-top">
          <q-btn flat round dense class="glass-back-btn" :aria-label="$t('Back')" @click="goBack">
            <Icon icon="tabler:chevron-left" width="20" height="20" />
          </q-btn>
          <div class="iform-sheet-title"></div>
          <div class="iform-sheet-spacer"></div>
        </header>

        <div class="iform-sheet-scroll">
          <div class="iform-body">
          <div class="iform-hero">
            <div class="iform-tile">
              <LNBitsMark />
            </div>
            <div class="iform-hero-title">{{ $t('Connect LNbits') }}</div>
            <div class="iform-hero-sub">{{ $t('Enter your LNbits server details') }}</div>
          </div>

          <div class="iform-secrow">
            <span class="iform-seclabel">{{ $t('Server details') }}</span>
            <button class="iform-scan" type="button" @click="openScanner">
              <!--
                Inline SVG (Tabler "scan" outline). It was inlined when icons
                still came from the network and the name used, qrcode-scan,
                is not in the Tabler set.
              -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 7V6a2 2 0 0 1 2-2h2"/><path d="M4 17v1a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v1"/><path d="M16 20h2a2 2 0 0 0 2-2v-1"/><path d="M5 12h14"/>
              </svg>
              {{ $t('Scan') }}
            </button>
          </div>

          <div class="iform-group">
            <div class="iform-row">
              <div class="iform-label">{{ $t('Server URL') }}</div>
              <q-input
                v-model="serverUrl"
                :placeholder="$t('https://your.lnbits.server')"
                class="iform-input"
                borderless
                dense
                hide-bottom-space
              />
            </div>

            <!--
              Wallet ID is intentionally *not* in this form. LNbits scopes each
              admin key to exactly one wallet, so validateCredentials() discovers
              the walletId via GET /api/v1/wallet and addLNBitsWallet persists the
              server-returned id. Asking for it would be redundant, friction-heavy
              data entry, and LNbits doesn't even issue a QR for it.
            -->
            <div class="iform-row">
              <div class="iform-label">{{ $t('Admin Key') }}</div>
              <q-input
                v-model="adminKey"
                :placeholder="$t('Paste your admin key here')"
                class="iform-input"
                borderless
                dense
                hide-bottom-space
                :type="showAdminKey ? 'text' : 'password'"
              >
                <template v-slot:append>
                  <q-btn
                    flat
                    round
                    dense
                    size="sm"
                    @click="showAdminKey = !showAdminKey"
                    :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
                  >
                    <Icon :icon="showAdminKey ? 'tabler:eye-off' : 'tabler:eye'" width="16" height="16" />
                  </q-btn>
                </template>
              </q-input>
            </div>
          </div>

          <!-- Error Message -->
          <div v-if="errorMessage" class="error-message q-mt-md">
            {{ errorMessage }}
          </div>

          <div class="iform-hint">
            {{ $t('Find your admin key in LNbits under API Info') }}
          </div>
          <div class="iform-hint">
            {{ $t('Or paste an LNDhub link and we will fill both fields') }}
          </div>
          </div>
        </div>

        <footer class="iform-sheet-footer">
          <q-btn
            class="iform-connect full-width"
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
        </footer>
      </template>

      <!-- Web QR scanner (native uses ScannerOverlay below) -->
      <template v-else>
        <header class="iform-sheet-top">
          <q-btn flat round dense class="glass-back-btn" :aria-label="$t('Back')" @click="closeScanner">
            <Icon icon="tabler:chevron-left" width="20" height="20" />
          </q-btn>
          <div class="iform-sheet-title">{{ $t('Scan QR Code') }}</div>
          <div class="iform-sheet-spacer"></div>
        </header>

        <div class="iform-sheet-scroll">
          <div class="iform-body">
          <div class="iform-scan-head">
            <div class="iform-scan-lede">{{ scannerSubtitle }}</div>
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
          </div>
        </div>

        <footer class="iform-sheet-footer">
          <q-btn
            unelevated
            class="full-width cancel-btn"
            :class="$q.dark.isActive ? 'more_btn_dark' : 'more_btn_light'"
            :label="$t('Cancel')"
            @click="closeScanner"
            no-caps
          />
        </footer>
      </template>
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
import { isAddressRequest } from '../utils/lud23.js';
import QrScanner from 'qr-scanner'
import { createQrScanner } from '../utils/qrScanner'
import { isNativeScannerAvailable } from '../utils/nativeScanner'
import ScannerOverlay from '../components/ScannerOverlay.vue'
import LoadingScreen from '../components/LoadingScreen.vue'
import LNBitsMark from '../components/lnbits/LNBitsMark.vue'
import LNBitsWalletFound from '../components/lnbits/LNBitsWalletFound.vue'
import LNBitsAddressStep from '../components/lnbits/LNBitsAddressStep.vue'
import LNBitsPayLinksStep from '../components/lnbits/LNBitsPayLinksStep.vue'
import { useWalletStore } from '../stores/wallet'
import { LNBitsWalletProvider } from '../providers/LNBitsWalletProvider'
import { mapActions, mapState } from 'pinia'
import { getUserFriendlyErrorMessage } from '../utils/userErrors'
import { isLndhubUri, parseLndhubUri } from '../utils/lndhub'

export default {
  name: 'LNBitsSetupPage',
  components: {
    LoadingScreen,
    LNBitsMark,
    LNBitsWalletFound,
    LNBitsAddressStep,
    LNBitsPayLinksStep,
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
      // Which step of the sheet shows: 'connect' | 'name' | 'address' | 'paylinks'.
      step: 'connect',
      walletName: '',
      showLoadingScreen: false,
      loadingText: '',
      // Validated data from server
      validatedServerUrl: '',
      validatedWalletId: '',
      validatedWalletName: '',
      validatedBalance: 0,
      // The saved wallet the address steps work on (set by offerLightningAddress).
      address: { walletId: null, domain: '', existing: [] },
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
  created() {
    // Set once the wallet is saved. Not reactive on purpose: a provider
    // holds a live connection and must never be wrapped in a Vue proxy.
    this.addressProvider = null;
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
        this.step = 'name';

      } catch (error) {
        console.error('LNbits validation failed:', error);
        this.errorMessage = getUserFriendlyErrorMessage(error, 'connect', this.$t.bind(this));
      } finally {
        this.isConnecting = false;
      }
    },

    async addWallet() {
      if (!this.walletName.trim()) return;

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

      // Wallet is saved. In kiosk mode nothing interrupts: straight to the
      // wallet. Otherwise offer a Lightning address, or say why there can
      // be none yet.
      if (this.kioskEnabled || !(await this.offerLightningAddress(wallet))) {
        this.goToSuccess();
      }
    },

    /** A tap on the dimmed ground: a step back before saving, done after. */
    onScrim() {
      if (this.step === 'connect') this.goBack();
      else if (this.step === 'name') this.step = 'connect';
      else this.goToSuccess();
    },

    /**
     * Every exit path (kiosk, dialog skipped, dialog confirmed, lnurlp
     * unavailable) lands in the same place: the wallet itself. The feature
     * tour left the setup flow and waits in About > Onboarding Guide.
     */
    goToSuccess() {
      this.$router.replace('/wallet');
    },

    /**
     * After the wallet is saved: the address step when the server's Pay
     * Links extension answers, the Pay Links step when the server says it
     * is off. When the server cannot tell (no network, server error), the
     * person goes straight to the wallet: nothing is claimed about Pay
     * Links that the server did not say.
     *
     * @returns {Promise<boolean>} true when a step is shown
     */
    async offerLightningAddress(wallet) {
      if (!wallet) return false;
      // A provider of its own, pinned to the wallet just added, so these
      // calls stay out of the store-managed connection.
      this.addressProvider = new LNBitsWalletProvider(wallet.id, {
        name: wallet.name,
        serverUrl: wallet.connectionData.serverUrl,
        walletId: wallet.connectionData.walletId,
        adminKey: wallet.connectionData.adminKey,
      });
      this.address = {
        walletId: wallet.id,
        domain: new URL(wallet.connectionData.serverUrl).hostname,
        existing: [],
      };

      const status = await this.addressProvider.lnurlpStatus();
      if (status === 'unknown') return false;
      this.showLoadingScreen = false;
      if (status === 'off') this.step = 'paylinks';
      else await this.openAddressStep();
      return true;
    },

    /** Existing addresses first: if the wallet has some, the step offers them. */
    async openAddressStep() {
      try {
        this.address.existing = await this.addressProvider.listLightningAddresses();
      } catch (e) {
        // Listing failed while Pay Links answered: creating still works.
        console.warn('Failed to list existing lightning addresses:', e);
        this.address.existing = [];
      }
      this.step = 'address';
    },

    createLightningAddress(username, options = {}) {
      return this.addressProvider.createLightningAddress({ username, successText: options.successText });
    },

    checkPayLinks() {
      return this.addressProvider.lnurlpStatus();
    },

    async onLightningAddressConfirm({ address }) {
      try {
        await this.setWalletLightningAddress(this.address.walletId, address);
      } catch (e) {
        // A local-only write; unlikely to fail, but never strand the person.
        console.error('Failed to save lightning address locally:', e);
        this.$q.notify({
          type: 'warning',
          message: this.$t('Address created but not saved locally'),
          caption: this.$t('You can set it again from Settings.'),
        });
      }
      this.goToSuccess();
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
      if (isAddressRequest(qrData)) {
        this.closeScanner();
        this.$q.notify({ type: 'info', message: this.$t('This code asks for your Lightning address. Scan it from Home after setting up your wallet.') });
        return;
      }
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
/* Sheet shell + form recipes live in app.css (.iform-*). Only the
   page-specific pieces remain here. */

.iform-scan-head {
  text-align: center;
  margin: 4px 0 14px;
}

.iform-scan-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
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

.cancel-btn {
  height: 48px;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Responsive Design */
@media (max-width: 480px) {
  .qr-scanner-container {
    height: 250px;
  }

  .scanning-frame {
    width: 180px;
    height: 180px;
  }
}
</style>
