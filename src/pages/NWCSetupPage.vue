<template>

  <!-- The route presents as a 100% bottom sheet: dimmed ground, surface
       at the large detent, grabber + glass back for chrome. The identity
       lives in the centered hero, so the bar itself stays headerless. -->
  <q-page class="iform-sheet-page">
    <div class="iform-sheet-scrim" aria-hidden="true" @click="goBack"></div>

    <div class="iform-sheet" role="dialog" aria-modal="true" :aria-label="$t('Connect a wallet')">
      <div class="iform-sheet-grab" aria-hidden="true"></div>

      <!-- Choose how, connect, then the wallet's own answer: what it is
           (found), that it is already here (duplicate), or which part did
           not answer (problem). Steps of this one sheet, never dialogs on
           top of it. -->
      <template v-if="!showScanner">
        <ConnectWalletChooser
          v-if="step === 'choose'"
          :offers="chooserOffers"
          @choose="choose"
          @back="goBack"
        />
        <GetWalletAppStep
          v-else-if="step === 'get-app'"
          @back="step = 'choose'"
          @show-code="showCode"
        />
        <WalletApproveStep
          v-else-if="step === 'approve' && approvingWallet"
          v-model:location="approveLocation"
          v-model:own-address="ownAddress"
          :wallet="approvingWallet"
          :state="pairingState"
          :error="addressError"
          @open="openApproval"
          @cancel="cancelPairing"
          @restart="restartPairing"
          @scan="scanFromApprove"
          @back="backToChooser"
        />
        <WalletAuthCodeStep
          v-else-if="step === 'code'"
          :uri="codeUri"
          :expired="pairingState === 'expired'"
          :copied="codeCopied"
          @copy="copyCode"
          @open="openCode"
          @restart="showCode"
          @back="backFromCode"
        />
        <PairingReturnStep
          v-else-if="step === 'return'"
          :hand-off="canHandOff"
          @hand-off="handOffToApp"
          @restart="backToChooser"
          @back="goBack"
        />
        <NWCWalletFound
          v-else-if="step === 'found'"
          v-model:name="walletName"
          :probe="probe"
          :relay="relay"
          :busy="isAdding"
          @back="backToInput"
          @add="addConnectedWallet"
        />
        <NWCDuplicateStep
          v-else-if="step === 'duplicate'"
          :existing="duplicate.wallet"
          :same-connection="duplicate.sameConnection"
          @back="backToInput"
          @open="openExisting"
          @add-anyway="step = 'found'"
        />
        <NWCConnectProblem
          v-else-if="step === 'problem'"
          :kind="problemKind"
          :relay="relay"
          :busy="isTesting"
          @retry="testConnection"
          @edit="backToInput"
        />
        <NWCConnectStep
          v-else
          v-model="nwcString"
          :error="errorMessage"
          :busy="isTesting"
          :waiting="isWaiting"
          :offer-code="fromChooser"
          @back="backFromConnect"
          @paste="pasteConnection"
          @scan="openScanner"
          @continue="testConnection"
          @show-code="showCode"
        />
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
            <div class="iform-scan-lede">{{ $t('Scan your NWC connection QR code') }}</div>

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
                <q-spinner-dots color="#F7931A" size="2em"/>
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

    <!-- Native MLKit scanner (iOS/Android). Teleports to <body>. -->
    <ScannerOverlay
      v-if="nativeScannerActive"
      :active="nativeScannerActive"
      :title="$t('Scan QR Code')"
      :prompt="$t('Scan your NWC connection QR code')"
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
import NWCConnectStep from '../components/nwc/NWCConnectStep.vue'
import NWCWalletFound from '../components/nwc/NWCWalletFound.vue'
import NWCDuplicateStep from '../components/nwc/NWCDuplicateStep.vue'
import NWCConnectProblem from '../components/nwc/NWCConnectProblem.vue'
import { useWalletStore } from '../stores/wallet'
import { mapActions, mapState } from 'pinia'
import { getUserFriendlyErrorMessage, translateErrorCode } from '../utils/userErrors'
import { parseNwcConnection, NWC_REASON_I18N_KEYS } from '../utils/nwcConnection'
import { findSameWallet, relayHost, suggestedWalletName } from '../utils/nwcWallet.js'
import { NWC_ERROR } from '../utils/nwcErrors.js'
import { probeNwcConnection } from '../services/nwcProbe.js'
import { readClipboardCrossPlatform } from '../utils/shopClipboard.js'
import { listenForNwcConnection, listenForPairingReturn, takeNwcConnection } from '../services/nwcConnectionIntake.js'
import { NWCClient } from '@getalby/sdk'
import { Capacitor } from '@capacitor/core'
import ConnectWalletChooser from '../components/nwc/ConnectWalletChooser.vue'
import WalletApproveStep from '../components/nwc/WalletApproveStep.vue'
import WalletAuthCodeStep from '../components/nwc/WalletAuthCodeStep.vue'
import PairingReturnStep from '../components/nwc/PairingReturnStep.vue'
import GetWalletAppStep from '../components/nwc/GetWalletAppStep.vue'
import { findWalletApps, walletAppOffer } from '../services/walletApps.js'
import {
  APP_RETURN_URL, CODE_REQUEST, PAIRING_TTL_MS, RETURN_PATH,
  answerRelays, approvalUrl, connectionFor, createPairingRequest, isPairingExpired, knownConnection,
  normalizeWalletUrl, readReturn, returnRequestId, returnUrlFor, walletAuthUri,
} from '../utils/nwcPairing.js'
import { PAIRING, connectWallet, pairsByApproval } from '../utils/connectWallets.js'
import {
  clearPairing, listenForWalletAnswer, loadPairing, savePairing, takePairing,
  waitForApproval, walletKnowsConnection,
} from '../services/nwcPairing.js'
import { buildAppHandoffUrl, isAndroidBrowser } from '../utils/publicCard.js'
import { writeClipboardCrossPlatform } from '../utils/shopClipboard.js'
import { openInAppBrowser } from '../utils/inAppBrowser.js'

// Where each self-hosted wallet lives, by wallet id: { albyhub: 'https://…' }.
const OWN_ADDRESSES_KEY = 'buhoGO_connect_addresses'

function readOwnAddresses() {
  try { return JSON.parse(localStorage.getItem(OWN_ADDRESSES_KEY) || '{}') || {} } catch { return {} }
}

/**
 * Connect a wallet over Nostr Wallet Connect, test first and name second:
 *
 *   choose    — which wallet (utils/connectWallets: Alby Hub, Coinos, …)
 *   approve   — approve BuhoGO on the wallet's own page or app
 *   get-app   — web on Android: a wallet app on this phone needs BuhoGO for Android
 *   code      — a code the wallet app scans and approves (NWC-08)
 *   return    — a wallet sent the person back, but nothing waits for it here
 *   connect   — paste or scan; the secret stays hidden
 *   found     — the wallet answered: its name, balance, address, what this
 *               connection may do and its spending limit; then Add wallet
 *   duplicate — it is a wallet that is already here
 *   problem   — the relay or the wallet did not answer, and which one
 *
 * Nothing is saved until Add wallet; the store reuses the test result.
 * Approving and the code never show a secret: BuhoGO makes the
 * connection's key pair, the wallet answers with its own key and relays
 * (utils/nwcPairing), and the result is tested like a pasted one.
 *
 * Routes: /connect-wallet starts at choose, /nwc-setup at connect (links
 * and Home hand a connection over), /nwc/connected is a Hub's return.
 */
export default {
  name: 'NWCSetupPage',
  components: {
    ScannerOverlay,
    NWCConnectStep,
    NWCWalletFound,
    NWCDuplicateStep,
    NWCConnectProblem,
    ConnectWalletChooser,
    WalletApproveStep,
    WalletAuthCodeStep,
    PairingReturnStep,
    GetWalletAppStep,
  },
  data() {
    return {
      step: 'connect',
      // Reached from the chooser: Back returns there, and the code is offered.
      fromChooser: false,
      // The connection came from approving or a code, not from the field.
      paired: false,
      // The name a paired wallet gets when its own is not one (an entry's
      // `keepName`, for wallets that call themselves after a server).
      pairedName: '',
      // utils/nwcPairing request while one is out; its state for the steps.
      pairing: null,
      pairingState: 'ready',
      // The utils/connectWallets id being approved, where it lives (a
      // location id, or 'own' with the address typed), and what is wrong
      // with that address.
      approveWallet: '',
      approveLocation: '',
      ownAddress: '',
      addressError: '',
      codeUri: '',
      codeCopied: false,
      // The step Back from the code returns to.
      codeBackStep: '',
      canHandOff: false,
      // services/walletApps: how a wallet app on this phone is offered, if at all.
      walletApp: null,
      nwcString: '',
      walletName: '',
      errorMessage: '',
      isTesting: false,
      isWaiting: false,
      isAdding: false,
      // services/nwcProbe result for the connection being added.
      probe: null,
      problemKind: 'no-answer',
      duplicate: { wallet: null, sameConnection: false },
      showScanner: false,
      nativeScannerActive: false,
      cameraError: false,
      cameraErrorMessage: '',
      cameraLoading: true,
      qrScanner: null,
    }
  },
  computed: {
    ...mapState(useWalletStore, ['wallets']),
    approvingWallet() {
      const wallet = connectWallet(this.approveWallet);
      if (wallet?.pairing !== PAIRING.WALLET_APP) return wallet;
      // Named after the app when there is one; Android asks which when several.
      const names = this.walletApp?.names || [];
      return { ...wallet, name: names.length === 1 ? names[0] : this.$t('Wallet app') };
    },
    /** Choices that depend on this device, for the chooser. */
    chooserOffers() {
      const offer = this.walletApp;
      if (!offer) return {};
      const subtitle = offer.mode === 'open' ? offer.names.join(', ') : this.$t('In BuhoGO for Android');
      return { walletapp: { subtitle } };
    },
    relay() {
      return relayHost(this.probe?.normalized || parseNwcConnection(this.nwcString).normalized || '');
    },
  },
  watch: {
    nwcString() {
      this.errorMessage = '';
    },
  },
  // A connection opened from another app, or scanned or pasted on Home,
  // arrives here and is tested at once; while the sheet is open, a new one
  // replaces it.
  mounted() {
    this.findWalletApp();
    this.stopListening = listenForNwcConnection((connection) => this.useHandedConnection(connection));
    this.stopReturnListening = listenForPairingReturn((query) => this.finishFromReturn(query));
    if (this.$route.path === RETURN_PATH) {
      this.finishFromReturn(this.$route.query);
      return;
    }
    const handed = takeNwcConnection();
    if (handed) {
      this.useHandedConnection(handed);
    } else if (this.$route.path === '/connect-wallet') {
      this.step = 'choose';
    }
  },
  beforeUnmount() {
    this.stopListening?.();
    this.stopReturnListening?.();
    // The kept request stays: a Hub's return can still finish it.
    this.stopWatching();
    this.stopQrScanner();
  },
  methods: {
    ...mapActions(useWalletStore, ['addWallet', 'switchActiveWallet']),

    goBack() {
      if (window.history.length > 1) {
        this.$router.back();
      } else {
        this.$router.push('/');
      }
    },

    /** Why a connection string cannot be used, or '' when it can. */
    connectionProblem(raw) {
      const result = parseNwcConnection(raw);
      if (result.ok) return '';
      return this.$t(NWC_REASON_I18N_KEYS[result.reason] || 'Invalid connection string format');
    },

    useHandedConnection(connection, { paired = false, name = '' } = {}) {
      if (this.isTesting || this.isAdding) return;
      this.closeScanner();
      this.paired = paired;
      this.pairedName = name;
      this.nwcString = connection;
      this.testConnection();
    },

    /** Back from found, duplicate or problem: to where the connection came from. */
    backToInput() {
      this.step = this.paired ? 'choose' : 'connect';
      if (this.paired) this.nwcString = '';
    },

    backFromConnect() {
      if (this.fromChooser) this.step = 'choose';
      else this.goBack();
    },

    backToChooser() {
      this.cancelPairing();
      this.step = 'choose';
    },

    backFromCode() {
      this.cancelPairing();
      this.step = this.codeBackStep || 'choose';
    },

    /** Whether this device can offer a wallet app on this phone (services/walletApps). */
    async findWalletApp() {
      const native = Capacitor.isNativePlatform();
      const apps = await findWalletApps({ native });
      this.walletApp = walletAppOffer({ apps, native, userAgent: navigator.userAgent });
    },

    /** A row in the chooser: its entry says how that wallet connects. */
    choose(id) {
      const wallet = connectWallet(id);
      if (!wallet) return;
      this.fromChooser = true;
      this.errorMessage = '';
      if (wallet.pairing === PAIRING.WALLET_APP && this.walletApp?.mode !== 'open') {
        this.step = 'get-app';
        return;
      }
      if (wallet.pairing === PAIRING.SHEET) {
        this.$router.replace(wallet.route);
        return;
      }
      if (wallet.pairing === PAIRING.MANUAL) {
        this.step = 'connect';
        return;
      }
      this.approveWallet = wallet.id;
      this.pairingState = 'ready';
      this.addressError = '';
      this.restoreLocation(wallet);
      this.step = 'approve';
      // A wallet app opens at once: the tap on its row is the tap that opens it.
      if (wallet.pairing === PAIRING.WALLET_APP) this.openApproval();
    },

    /** The first location, or the person's own address when they used one before. */
    restoreLocation(wallet) {
      const saved = wallet.approval.selfHosted ? readOwnAddresses()[wallet.id] : '';
      this.ownAddress = saved || '';
      this.approveLocation = saved ? 'own' : (wallet.approval.locations?.[0]?.id || '');
    },

    /** Where the approval page lives for this approval, or '' (and why) when the typed address is not one. */
    approvalBase(wallet) {
      if (this.approveLocation !== 'own') {
        return wallet.approval.locations?.find((place) => place.id === this.approveLocation)?.url || '';
      }
      const url = normalizeWalletUrl(this.ownAddress, { approvalPath: wallet.approval.path });
      if (!url) {
        this.addressError = this.$t("That doesn't look like a web address.");
        return null;
      }
      try {
        localStorage.setItem(OWN_ADDRESSES_KEY, JSON.stringify({ ...readOwnAddresses(), [wallet.id]: url }));
      } catch { /* storage unavailable */ }
      return url;
    },

    /**
     * Open the wallet's approval page. The first time makes and keeps the
     * request and starts watching for the answer; later taps reopen the
     * same page for the same request.
     */
    async openApproval() {
      const wallet = this.approvingWallet;
      if (!pairsByApproval(wallet)) return;
      if (this.pairingState !== 'waiting') {
        const baseUrl = this.approvalBase(wallet);
        if (baseUrl === null) return;
        this.addressError = '';
        await this.startPairing(wallet.id, { baseUrl });
      }
      if (wallet.pairing === PAIRING.WALLET_APP) {
        this.openOutside(walletAuthUri(this.pairing, { returnTo: APP_RETURN_URL }));
        return;
      }
      // A wallet that sends the person back opens in place on the web;
      // one that does not gets its own tab.
      this.openOutside(approvalUrl(this.pairing, wallet), { sameTab: wallet.pairing === PAIRING.APPROVE_AND_RETURN });
    },

    /** The code a wallet app scans (NWC-08), with a fresh request. */
    async showCode() {
      // A new code from an expired one keeps where Back goes.
      if (this.step !== 'code') this.codeBackStep = this.step;
      this.step = 'code';
      this.codeUri = '';
      this.codeCopied = false;
      await this.startPairing(CODE_REQUEST);
      this.codeUri = walletAuthUri(this.pairing);
    },

    async copyCode() {
      await writeClipboardCrossPlatform(this.codeUri);
      this.codeCopied = true;
    },

    /** The code, opened in a wallet app on this phone; in the app, the wallet may send the person back. */
    openCode() {
      const returnTo = Capacitor.isNativePlatform() ? APP_RETURN_URL : '';
      this.openOutside(walletAuthUri(this.pairing, { returnTo }), { sameTab: true });
    },

    /**
     * Make, keep and watch a request. An approve-known wallet answers by
     * knowing the connection; every other one (and a code) by an info
     * event on its relays.
     */
    async startPairing(walletId, { baseUrl = '' } = {}) {
      this.stopWatching();
      const request = createPairingRequest(walletId, { baseUrl });
      await savePairing(request);
      this.watchPairing(request);
    },

    /** Wait for the answer to a kept request, until it expires. */
    watchPairing(request) {
      const wallet = connectWallet(request.walletId);
      // A connection from an earlier pairing in this sheet is done with.
      this.paired = false;
      this.pairing = request;
      this.pairingState = 'waiting';
      const left = PAIRING_TTL_MS - (Date.now() - Number(request.createdAt));
      this.expiryTimer = setTimeout(() => this.expirePairing(), Math.max(0, left));
      const name = wallet?.keepName ? wallet.name : '';
      if (wallet?.pairing === PAIRING.APPROVE_KNOWN) {
        const connection = knownConnection(request, wallet);
        const watch = new AbortController();
        this.knownWatch = watch;
        waitForApproval(connection, { signal: watch.signal, ask: (c) => this.askWallet(c) })
          .then((approved) => { if (approved) this.finishPairing(request, connection, { name }); });
      } else {
        this.stopAnswerListening = this.listenForAnswer(request, (answer) => {
          this.finishPairing(request, connectionFor(request, answer), { name });
        });
      }
    },

    /** Listening for a wallet's answer, one method so a test harness can answer instead. */
    listenForAnswer(request, onAnswer) {
      return listenForWalletAnswer(request, answerRelays(connectWallet(request.walletId)), onAnswer);
    },

    /** Does the wallet know this connection yet (approve-known)? Replaceable in a test harness. */
    askWallet(connection) {
      return walletKnowsConnection(connection, { createClient: (url) => new NWCClient({ nostrWalletConnectUrl: url }) });
    },

    /**
     * An answer arrived: take the kept request (once, so a second answer
     * for the same approval does nothing) and test the connection.
     */
    async finishPairing(request, connection, { name = '' } = {}) {
      const taken = await takePairing(request.id);
      if (!taken) return;
      this.stopWatching();
      this.closeInAppBrowser();
      this.pairing = null;
      this.pairingState = 'ready';
      if (!connection) {
        this.errorMessage = this.$t('The wallet answered with a connection BuhoGO cannot use.');
        this.step = 'connect';
        return;
      }
      this.useHandedConnection(connection, { paired: true, name });
    },

    /**
     * A wallet's return address, opened on this route or handed to this
     * open sheet. A Hub's return carries the answer; a wallet app's return
     * only names the request, whose answer comes over the relay: it brings
     * the waiting step back, also after the system closed BuhoGO.
     */
    async finishFromReturn(query) {
      const answer = readReturn(query);
      const requestId = answer?.requestId || returnRequestId(query);
      if (!answer && requestId && (this.paired || this.isTesting || this.pairing?.id === requestId)) return;
      const request = requestId && await loadPairing();
      if (!answer && request?.id === requestId && !isPairingExpired(request)) {
        this.resumePairing(request);
        return;
      }
      if (!answer || !request || request.id !== answer.requestId || (answer.state && answer.state !== request.state)) {
        // Answered already over the relay (this sheet is on it), or not
        // this BuhoGO's request.
        if (this.paired || this.isTesting) return;
        this.canHandOff = !Capacitor.isNativePlatform() && isAndroidBrowser(navigator.userAgent);
        this.returnQuery = query;
        this.step = 'return';
        return;
      }
      const wallet = connectWallet(request.walletId);
      this.finishPairing(request, connectionFor(request, answer), { name: wallet?.keepName ? wallet.name : '' });
    },

    /** Back to the step a kept request belongs to, waiting for its answer. */
    resumePairing(request) {
      if (request.walletId === CODE_REQUEST) {
        this.codeUri = walletAuthUri(request);
        this.step = 'code';
      } else {
        this.approveWallet = request.walletId;
        this.step = 'approve';
      }
      this.watchPairing(request);
    },

    /** From an Android browser, give the return address to the app. */
    handOffToApp() {
      const intent = buildAppHandoffUrl(returnUrlFor(this.returnQuery));
      if (intent) window.location.href = intent;
    },

    expirePairing() {
      this.stopWatching();
      clearPairing();
      this.pairing = null;
      this.pairingState = 'expired';
    },

    cancelPairing() {
      this.stopWatching();
      clearPairing();
      this.pairing = null;
      this.pairingState = 'ready';
    },

    restartPairing() {
      this.pairingState = 'ready';
      this.openApproval();
    },

    stopWatching() {
      clearTimeout(this.expiryTimer);
      this.knownWatch?.abort();
      this.knownWatch = null;
      this.stopAnswerListening?.();
      this.stopAnswerListening = null;
    },

    scanFromApprove() {
      this.step = 'connect';
      this.openScanner();
    },

    /**
     * Open a wallet's page or app. In the app a web page opens in the
     * in-app browser, so the person approves without leaving BuhoGO, and a
     * wallet app's link opens that app. On the web a page that sends the
     * person back opens in place, any other in a new tab.
     */
    openOutside(url, { sameTab = false } = {}) {
      const webPage = /^https?:/i.test(url);
      if (Capacitor.isNativePlatform() && webPage) {
        openInAppBrowser(url);
        return;
      }
      if (Capacitor.isNativePlatform() || sameTab) {
        window.location.href = url;
        return;
      }
      window.open(url, '_blank', 'noopener');
    },

    /** The approval page is done with once the answer is here (where the system lets an app close it). */
    async closeInAppBrowser() {
      if (!Capacitor.isNativePlatform()) return;
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.close();
      } catch { /* not open, or not closable on this system */ }
    },

    async pasteConnection() {
      const text = (await readClipboardCrossPlatform()) || '';
      if (!text.trim()) {
        this.errorMessage = this.$t('The clipboard is empty.');
        return;
      }
      this.nwcString = text.trim();
      this.errorMessage = this.connectionProblem(this.nwcString);
    },

    /**
     * Ask the wallet before saving anything. Its answer decides the next
     * step: found, duplicate, or which part did not answer.
     */
    async testConnection() {
      const problem = this.connectionProblem(this.nwcString);
      if (problem) {
        this.errorMessage = problem;
        this.step = 'connect';
        return;
      }
      this.isTesting = true;
      this.isWaiting = false;
      this.errorMessage = '';
      try {
        const probe = await this.probeConnection(this.nwcString, { onWaiting: () => { this.isWaiting = true; } });
        this.probe = probe;
        this.walletName = this.pairedName || suggestedWalletName(probe, this.$t('Lightning wallet'));
        const existing = findSameWallet(this.wallets, probe);
        if (existing) {
          const sameConnection = parseNwcConnection(existing.nwcUrl).pubkey === probe.connectionPubkey;
          this.duplicate = { wallet: existing, sameConnection };
          this.step = 'duplicate';
        } else {
          this.step = 'found';
        }
      } catch (error) {
        console.warn('NWC connection test failed:', error?.message || error);
        if (error?.code === NWC_ERROR.NO_ANSWER || error?.code === NWC_ERROR.RELAY_UNREACHABLE) {
          this.problemKind = error.code === NWC_ERROR.RELAY_UNREACHABLE ? 'relay' : 'no-answer';
          this.step = 'problem';
        } else {
          const t = this.$t.bind(this);
          this.errorMessage = translateErrorCode(error, t) || getUserFriendlyErrorMessage(error, 'connect', t);
          this.step = 'connect';
        }
      } finally {
        this.isTesting = false;
        this.isWaiting = false;
      }
    },

    /** The connection test (services/nwcProbe), one method so a test harness can stand in for a wallet. */
    probeConnection(url, options) {
      return probeNwcConnection(url, options);
    },

    async addConnectedWallet() {
      if (!this.probe || this.isAdding) return;
      this.isAdding = true;
      try {
        await this.addWallet({ name: this.walletName, nwcUrl: this.probe.normalized, probe: this.probe });
        // Straight into the wallet; the tour waits in About > Onboarding Guide.
        this.$router.replace('/wallet');
      } catch (error) {
        console.error('Failed to add NWC wallet:', error);
        // A reason BuhoGO knows (already added, saved wallets unavailable)
        // replaces the generic title, which would blame the connection.
        const t = this.$t.bind(this);
        this.errorMessage = translateErrorCode(error, t) || getUserFriendlyErrorMessage(error, 'connect', t);
        this.step = 'connect';
      } finally {
        this.isAdding = false;
      }
    },

    /** The wallet is already here: use it instead of adding it twice. */
    async openExisting() {
      await this.switchActiveWallet(this.duplicate.wallet.id);
      this.$router.replace('/wallet');
    },

    async openScanner() {
      // Native (iOS/Android): mount the MLKit ScannerOverlay. Web/PWA keeps the
      // in-page qr-scanner video.
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

    handleQrScan(qrData) {
      if (isAddressRequest(qrData)) {
        this.closeScanner();
        this.$q.notify({ type: 'info', message: this.$t('This code asks for your Lightning address. Scan it from Home after setting up your wallet.') });
        return;
      }
      if (!qrData) return;

      // Use the same parser as the manual-input path so the two flows
      // never diverge on what counts as valid. The parser accepts every
      // known prefix variant and rejects bunker:// (NIP-46) with a
      // tailored message — users routinely confuse the two.
      const result = parseNwcConnection(qrData);
      if (result.ok) {
        // The canonical form (every relay kept), then straight on to the test.
        this.nwcString = result.normalized;
        this.closeScanner();
        this.testConnection();
        return;
      }

      const reasonKey = NWC_REASON_I18N_KEYS[result.reason] || 'Expected a NWC connection string';
      this.$q.notify({
        type: 'warning',
        message: this.$t('Invalid QR code'),
        caption: this.$t(reasonKey),
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

.iform-scan-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
  text-align: center;
  margin: 4px 0 14px;
}


/* Scanner Styles */
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
  border: 3px solid #F7931A;
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
