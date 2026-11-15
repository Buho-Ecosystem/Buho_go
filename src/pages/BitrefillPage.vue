<template>
  <q-page class="bitrefill-page">
    <!-- Header. It owns the top safe-area inset and sticks at top: 0 (a
         non-zero sticky top would push it into the content on Android). -->
    <div class="bitrefill-header">
      <q-btn flat round class="bitrefill-hbtn" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" :aria-label="$t('Back')" @click="goBack">
        <Icon icon="tabler:chevron-left" width="20" height="20" />
      </q-btn>
      <div class="bitrefill-title">Bitrefill</div>
      <q-btn flat round class="bitrefill-hbtn" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" :aria-label="$t('Voucher email')" @click="openEmailSheet(true)">
        <Icon icon="tabler:mail" width="20" height="20" />
      </q-btn>
    </div>

    <!-- One plain line when an order needs the user: Bitrefill took the
         money and could not deliver. It stays until it is read. -->
    <div v-if="refundNotice" class="bitrefill-line" role="status">
      <span>{{ $t('Bitrefill could not deliver an order. Follow the refund steps in the shop, or in the email from Bitrefill.') }}</span>
      <button type="button" class="bitrefill-line-close" :aria-label="$t('Dismiss')" @click="dismissRefundNotice">
        <Icon icon="tabler:x" width="18" height="18" />
      </button>
    </div>

    <div class="bitrefill-body">
      <!-- Bitrefill's own shop, untouched: only the documented theme and
           language follow the app. -->
      <iframe
        v-if="widgetSrc"
        ref="frame"
        :key="widgetSrc"
        class="bitrefill-frame"
        :src="widgetSrc"
        title="Bitrefill"
        allow="clipboard-write"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-scripts allow-forms"
        @load="onFrameLoad"
      ></iframe>

      <div v-if="offline" class="bitrefill-state" role="status">
        <Icon icon="tabler:wifi-off" width="28" height="28" aria-hidden="true" />
        <p>{{ $t('The shop needs an internet connection.') }}</p>
        <q-btn unelevated no-caps class="bitrefill-retry" :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'" :label="$t('Try again')" @click="retry" />
      </div>
      <div v-else-if="widgetSrc && !frameLoaded" class="bitrefill-state" role="status">
        <template v-if="frameSlow">
          <p>{{ $t('The shop is taking longer than usual.') }}</p>
          <q-btn unelevated no-caps class="bitrefill-retry" :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'" :label="$t('Try again')" @click="retry" />
        </template>
        <template v-else>
          <q-spinner size="28px" aria-hidden="true" />
          <span class="bitrefill-sr">{{ $t('Loading the shop…') }}</span>
        </template>
      </div>
    </div>

    <BitrefillEmailSheet
      v-model="emailSheetOpen"
      :initial-email="savedEmail || suggestedEmail"
      :editing="emailSheetEditing"
      :has-saved="!!savedEmail"
      :busy="emailBusy"
      @save="onEmailSave"
      @skip="onEmailSkip"
      @remove="removeEmailOpen = true"
    />

    <BitrefillConfirmDialog
      :model-value="removeEmailOpen"
      :title="$t('Remove this email?')"
      :message="$t('Bitrefill will ask for an email at checkout. The shop reloads.')"
      :confirm-label="$t('Remove')"
      :cancel-label="$t('Cancel')"
      destructive
      @confirm="onEmailRemove"
      @cancel="removeEmailOpen = false"
    />

    <BitrefillConfirmDialog
      :model-value="leaveOpen"
      :title="$t('Leave the shop?')"
      :message="leaveQuestion"
      :confirm-label="$t('Leave')"
      :cancel-label="$t('Stay')"
      destructive
      @confirm="confirmLeave"
      @cancel="leaveOpen = false"
    />

    <PaymentConfirmSheet
      ref="paySheet"
      v-model="paySheetOpen"
      :payment="paymentProps"
      :wallet-can-pay="walletCanPay"
      :wallet-hint="walletHint"
      :paying-wallets="payingWallets"
      :sending-wallet-id="sendingWalletId"
      :preferred-wallet-id="preferredWalletId"
      :is-sending="isSending"
      :is-complete="isComplete"
      :status-message="statusMessage"
      @update:sending-wallet-id="sendingWalletId = $event"
      @confirm="onConfirm"
      @cancel="onPaySheetCancel"
    />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { useCloudBackupStore } from '../stores/cloudBackup';
import { usePaymentPreferencesStore } from '../stores/paymentPreferences';
import BitrefillEmailSheet from '../components/bitrefill/BitrefillEmailSheet.vue';
import BitrefillConfirmDialog from '../components/bitrefill/BitrefillConfirmDialog.vue';
import PaymentConfirmSheet from '../components/PaymentConfirmSheet.vue';
import { parseLightningInvoice } from '../utils/lightningInvoice.js';
import {
  PAYING_REASON,
  payingWalletsInStore,
  pickDefaultPayingWallet,
  payingWalletHint,
} from '../utils/payingWallets.js';
import { NWC_ERROR } from '../utils/nwcErrors.js';
import { haptics } from '../utils/haptics';
import {
  buildWidgetUrl,
  parseWidgetMessage,
  invoiceFromIntent,
  intentAmountMatches,
  isPaidUpdate,
  isExpiredUpdate,
  isRefundedUpdate,
  deliveryOutcome,
  isValidEmail,
  WIDGET_EVENT,
  DELIVERY,
} from '../services/bitrefill/widget.js';
import {
  createInvoiceLedger,
  PAY_STATE,
  PAY_BLOCK,
  loadEmail,
  saveEmail,
  clearEmail,
  wasEmailAsked,
  markEmailAsked,
} from '../services/bitrefill/storage.js';
import {
  payBitrefillInvoice,
  probeBitrefillPayment,
  outcomeAfterError,
  secondsToPay,
  PAY_OUTCOME,
  BITREFILL_PRICE_EXPIRED,
} from '../services/bitrefill/pay.js';
import { setFrameCookies } from '../services/bitrefill/frameCookies.js';

/** How long a refused payment waits for the widget to report it paid anyway. */
const SETTLE_WAIT_MS = 4000;
/** After this long without the shop's first screen, say so and offer a way on. */
const LOAD_SLOW_MS = 15000;
/** The longest the sheet waits for a fee quote before going on without one. */
const FEE_QUOTE_WAIT_MS = 8000;
/** One ledger, also across browser tabs (the web app can be open twice). */
const LEDGER_LOCK = 'buhogo-bitrefill-ledger';

/**
 * The Bitrefill shop: Bitrefill's widget in a frame, paid from the user's own
 * wallets on BuhoGO's confirm sheet.
 *
 *   first open   ask where vouchers go (once; "Not now" leaves it to Bitrefill)
 *   shopping     the widget, with the documented theme and language only
 *   paying       payment_intent -> the confirm sheet -> the chosen wallet
 *   after        "Paid" once the money settled; "ready" once Bitrefill says
 *                the order was delivered; one plain line if it needs a refund
 *
 * Paid means settled. A wallet that answers "on its way", or whose answer
 * cannot be told, leaves the order unresolved: nothing is celebrated, the
 * invoice stays blocked, and the paying wallet is asked again the next time
 * the shop opens. One invoice is paid at most once
 * (services/bitrefill/storage.js). The route is out of reach in kiosk mode,
 * like every route (boot/kiosk.js).
 */
export default {
  name: 'BitrefillPage',
  components: { Icon, BitrefillEmailSheet, BitrefillConfirmDialog, PaymentConfirmSheet },
  beforeRouteLeave(to, from, next) {
    if (this.leaveConfirmed || !this.leaveQuestion) return next();
    // Leaving reloads the shop: an order on screen, or one still on its way,
    // is worth one question.
    this.leaveTarget = to.fullPath;
    this.leaveOpen = true;
    next(false);
  },
  data() {
    return {
      widgetSrc: '',
      frameLoaded: false,
      frameSlow: false,
      offline: false,

      savedEmail: '',
      emailSheetOpen: false,
      emailSheetEditing: false,
      emailBusy: false,
      removeEmailOpen: false,

      paySheetOpen: false,
      intent: null, // { invoiceId, invoice, paymentHash, amountSats, description, expiresAt }
      sendingWalletId: null,
      isSending: false,
      isComplete: false,
      sendingType: null,
      nowSec: Math.floor(Date.now() / 1000),

      // The fee the paying wallet quoted for this invoice (Spark), or none.
      feeSats: null,
      feeWalletId: null,
      feeEstimating: false,

      paidInvoiceIds: [],
      // Orders handed to a wallet in this visit whose outcome is still open.
      unresolvedInvoiceIds: [],
      refundNotice: false,

      leaveOpen: false,
    };
  },
  computed: {
    walletStore() { return useWalletStore(); },
    preferredWalletId() { return usePaymentPreferencesStore().preferredWalletId; },
    suggestedEmail() {
      const email = useCloudBackupStore().signedInEmail;
      return isValidEmail(email) ? email : '';
    },
    secondsLeft() {
      if (!this.intent?.expiresAt) return 0;
      return secondsToPay(this.intent.expiresAt, this.nowSec * 1000);
    },
    paymentProps() {
      if (!this.intent) return null;
      const quoted = typeof this.feeSats === 'number' && this.feeWalletId === this.sendingWalletId;
      const feeEstimate = this.feeEstimating ? { sats: null, isEstimating: true }
        : quoted ? { sats: this.feeSats, isEstimating: false } : null;
      return {
        recipient: {
          name: 'Bitrefill',
          logoUrl: '/Bitrefill/bitrefill-mark.png',
          color: '#002B28',
          addressType: 'invoice',
          address: '',
          // What is being bought, under the name: the order as the shop wrote it.
          caption: this.intent.description,
        },
        amount: { mode: 'fixed', fixedSats: this.intent.amountSats },
        description: this.intent.description,
        // Behind the sheet's details: what is paid, in plain words first.
        details: {
          typeLabel: this.$t('Bitcoin payment'),
          address: this.intent.invoice,
          addressLabel: this.$t('Payment request'),
          description: this.intent.description,
          metadata: [{ label: this.$t('Order reference'), value: this.intent.invoiceId }],
        },
        commentAllowed: false,
        countdown: this.secondsLeft > 0 ? { seconds: this.secondsLeft, urgentBelow: 60 } : null,
        feeEstimate,
        feeNotice: feeEstimate ? '' : this.$t('Fee calculated when sending.'),
        // A frame's message opened this sheet, not a tap in the app: paying
        // always takes the deliberate gesture, whatever the amount.
        forceSlide: true,
      };
    },
    payingWallets() {
      if (!this.intent) return [];
      return payingWalletsInStore(this.walletStore, this.intent.amountSats, 'lightning');
    },
    sendingEntry() {
      return this.payingWallets.find((w) => w.id === this.sendingWalletId) || null;
    },
    /** The paying wallet's verdict; a saved balance being re-read never refuses. */
    sendingBlock() {
      const entry = this.sendingEntry;
      if (!entry || entry.usable) return null;
      if (entry.reason === PAYING_REASON.INSUFFICIENT_BALANCE && this.walletStore.getDisplayBalance?.(entry.id)?.isCached) return null;
      return entry;
    },
    walletCanPay() {
      return !!this.sendingEntry && !this.sendingBlock;
    },
    walletHint() {
      const block = this.sendingBlock;
      if (!block) return this.payingWallets.length ? '' : this.$t('Add a wallet to pay.');
      const hasAlternative = this.payingWallets.some((w) => w.usable && w.id !== block.id);
      return payingWalletHint(block, 'lightning', this.$t.bind(this), { hasAlternative });
    },
    statusMessage() {
      return this.isSending && this.sendingType === 'nwc' ? this.$t('Waiting for your wallet app…') : '';
    },
    /** What leaving would lose, as a question's second line; '' when nothing. */
    leaveQuestion() {
      if (this.isSending || this.unresolvedInvoiceIds.length) {
        return this.$t('A payment is still on its way. You can come back to the shop later.');
      }
      if (this.paidInvoiceIds.length) return this.$t('Your order is shown here. It also arrives by email.');
      return '';
    },
  },
  watch: {
    paySheetOpen(open) {
      // The countdown only runs while there is a price on screen.
      if (open) this.startClock();
      else this.stopClock();
      // Closed with its Back button: nothing is pending any more.
      if (!open && !this.isSending) this.intent = null;
    },
    secondsLeft(left) {
      // The price ran out while the sheet was open and nothing was sent.
      if (left === 0 && this.paySheetOpen && this.intent && !this.isSending && !this.isComplete) {
        this.closePaySheet();
        this.notifyPriceRanOut();
      }
    },
    sendingWalletId() {
      if (this.paySheetOpen && !this.isSending && !this.isComplete) this.refreshFee();
    },
  },
  created() {
    this.ledger = createInvoiceLedger();
    usePaymentPreferencesStore().initialize();
  },
  async mounted() {
    window.addEventListener('message', this.onMessage);
    window.addEventListener('online', this.onOnline);

    this.restoreRefundNotice();
    this.reconcile();

    // The widget keeps its checkout session in a cookie inside the frame.
    await setFrameCookies(true);
    this.savedEmail = await loadEmail();
    if (this.unmounted) return;
    if (!this.savedEmail && !wasEmailAsked()) {
      this.openEmailSheet(false);
    } else {
      this.loadWidget();
    }
  },
  beforeUnmount() {
    this.unmounted = true;
    window.removeEventListener('message', this.onMessage);
    window.removeEventListener('online', this.onOnline);
    this.stopClock();
    clearTimeout(this.closeTimer);
    clearTimeout(this.loadTimer);
    clearTimeout(this.feeTimer);
    clearInterval(this.settleTick);
    this.settleDone?.(false);
    setFrameCookies(false);
  },
  methods: {
    // ───── Leaving ─────
    /** The header's way out: to Spend, whatever the frame did to the history. */
    goBack() {
      this.$router.replace('/spend');
    },
    confirmLeave() {
      this.leaveConfirmed = true;
      this.leaveOpen = false;
      this.$router.replace(this.leaveTarget || '/spend');
    },

    // ───── Widget ─────
    loadWidget() {
      clearTimeout(this.loadTimer);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.offline = true;
        return;
      }
      this.offline = false;
      this.frameLoaded = false;
      this.frameSlow = false;
      const src = buildWidgetUrl({
        dark: this.$q.dark.isActive,
        locale: this.$i18n.locale,
        email: this.savedEmail,
      });
      // The same address again would not reload the frame: drop it first.
      if (src === this.widgetSrc) {
        this.widgetSrc = '';
        this.$nextTick(() => { if (!this.unmounted) this.widgetSrc = src; });
      } else {
        this.widgetSrc = src;
      }
      this.loadTimer = setTimeout(() => { if (!this.frameLoaded) this.frameSlow = true; }, LOAD_SLOW_MS);
    },
    onFrameLoad() {
      this.frameLoaded = true;
      this.frameSlow = false;
      clearTimeout(this.loadTimer);
    },
    retry() { this.loadWidget(); },
    onOnline() { if (this.offline) this.loadWidget(); },

    onMessage(event) {
      const message = parseWidgetMessage(event, this.$refs.frame?.contentWindow || null);
      if (!message) return;
      if (message.event === WIDGET_EVENT.PAYMENT_INTENT) {
        this.onPaymentIntent(message);
      } else if (isPaidUpdate(message)) {
        this.onWidgetPaid(message.invoiceId);
      } else if (isRefundedUpdate(message)) {
        this.onWidgetRefunded(message.invoiceId);
      } else if (message.event === WIDGET_EVENT.INVOICE_COMPLETE) {
        this.onInvoiceComplete(message);
      } else if (isExpiredUpdate(message) && this.intent?.invoiceId === message.invoiceId && !this.isSending && !this.isComplete) {
        this.closePaySheet();
        this.notifyPriceRanOut();
      }
    },

    onPaymentIntent(message) {
      // The sheet shows one order until it closes. The widget sits behind it
      // and cannot be used meanwhile, so another intent is not the user's;
      // swapping it in could change what a finger already on the slide pays.
      if (this.paySheetOpen || this.isSending) return;

      if (this.paidInvoiceIds.includes(message.invoiceId)) {
        this.$q.notify({ type: 'positive', message: this.$t('This order is already paid.'), timeout: 2500 });
        return;
      }

      // The invoice is what gets paid: its amount, its end and its identity
      // are read from it, never taken from the message.
      const invoice = invoiceFromIntent(message);
      let parsed = null;
      try { parsed = invoice ? parseLightningInvoice(invoice) : null; } catch { parsed = null; }
      if (!parsed || !(parsed.amount > 0) || !parsed.paymentHash || !intentAmountMatches(message, parsed.amount)) {
        this.$q.notify({ type: 'negative', message: this.$t("BuhoGO can't pay this order. Please try again in the shop."), timeout: 3500 });
        return;
      }

      const verdict = this.ledger.canPay({ invoiceId: message.invoiceId, paymentHash: parsed.paymentHash });
      if (!verdict.ok) {
        this.notifyBlocked(verdict.reason);
        return;
      }

      if (parsed.expiry && secondsToPay(parsed.expiry) <= 0) {
        this.notifyPriceRanOut();
        return;
      }

      this.intent = {
        invoiceId: message.invoiceId,
        invoice: parsed.invoice,
        paymentHash: parsed.paymentHash,
        amountSats: parsed.amount,
        description: parsed.description,
        expiresAt: parsed.expiry,
      };
      this.isSending = false;
      this.isComplete = false;
      this.nowSec = Math.floor(Date.now() / 1000);
      this.sendingWalletId = this.defaultWalletId();
      this.paySheetOpen = true;
      this.refreshFee();
    },

    /**
     * The wallet the sheet starts with: the one chosen as default in
     * Settings when it can pay this order, else the usual pick. A default
     * that cannot pay is passed over, so the sheet never opens on a dead end.
     */
    defaultWalletId() {
      const list = this.payingWallets;
      const preferred = this.preferredWalletId
        ? list.find((wallet) => wallet.id === this.preferredWalletId && wallet.usable) : null;
      return (preferred || pickDefaultPayingWallet(list))?.id || null;
    },

    notifyPriceRanOut() {
      this.$q.notify({ type: 'warning', message: this.$t('The price ran out. Confirm the order in the shop again for a new price.'), timeout: 3500 });
    },
    notifyBlocked(reason) {
      if (reason === PAY_BLOCK.UNAVAILABLE) {
        this.$q.notify({ type: 'negative', message: this.$t("Couldn't prepare this payment. Please try again."), timeout: 3500 });
      } else if (reason === PAY_BLOCK.PAID) {
        this.$q.notify({ type: 'positive', message: this.$t('This order is already paid.'), timeout: 2500 });
      } else {
        this.$q.notify({ type: 'warning', message: this.$t('A payment for this order may still be on its way. Check History before paying again.'), timeout: 5000 });
      }
    },

    /** The widget saw the payment: true whatever our wallet call said. */
    onWidgetPaid(invoiceId) {
      const wasOpen = this.unresolvedInvoiceIds.includes(invoiceId);
      if (!this.paidInvoiceIds.includes(invoiceId)) this.paidInvoiceIds.push(invoiceId);
      this.unresolvedInvoiceIds = this.unresolvedInvoiceIds.filter((id) => id !== invoiceId);
      try { this.ledger.mark(invoiceId, PAY_STATE.PAID); } catch { /* retained in memory; unreadable ledgers block payment */ }
      // The person was told it was on its way: now tell them it arrived.
      if (wasOpen) {
        haptics.success();
        this.$q.notify({ type: 'positive', message: this.$t('Paid. Bitrefill is preparing your order.'), timeout: 3000 });
      }
    },

    /** The order's own end: delivered, or in need of a refund. */
    onInvoiceComplete(message) {
      const outcome = deliveryOutcome(message);
      if (outcome === DELIVERY.UNKNOWN) return;
      try { this.ledger.annotate(message.invoiceId, { delivery: outcome }); } catch { /* shown for this visit */ }
      if (outcome === DELIVERY.REFUND) {
        this.refundNotice = true;
      } else if (this.paidInvoiceIds.includes(message.invoiceId)) {
        this.$q.notify({ type: 'positive', message: this.$t('Your order is ready. It shows in the shop and arrives by email.'), timeout: 3500 });
      }
    },
    onWidgetRefunded(invoiceId) {
      try { this.ledger.annotate(invoiceId, { refunded: true }); } catch { /* shown for this visit */ }
      this.refundNotice = false;
      this.$q.notify({ type: 'info', message: this.$t('Bitrefill refunded this order.'), timeout: 3500 });
    },
    /** An order that still needs its refund is said again on the next visit. */
    restoreRefundNotice() {
      try {
        this.refundNotice = this.ledger.all().some((e) => e.delivery === DELIVERY.REFUND && !e.refunded && !e.refundSeen);
      } catch { /* an unreadable ledger blocks payment; nothing to restore */ }
    },
    dismissRefundNotice() {
      this.refundNotice = false;
      try {
        for (const entry of this.ledger.all()) {
          if (entry.delivery === DELIVERY.REFUND && !entry.refundSeen) this.ledger.annotate(entry, { refundSeen: true });
        }
      } catch { /* hidden for this visit */ }
    },

    /**
     * Attempts whose outcome was never learned (the app closed mid-send, or
     * the wallet could not say): ask the paying wallet by payment hash. Paid
     * and failed are recorded; anything else stays blocked.
     */
    async reconcile() {
      let open = [];
      try { open = this.ledger.unresolved(); } catch { return; }
      for (const entry of open) {
        if (!entry.paymentHash || !entry.walletId) continue;
        const outcome = await probeBitrefillPayment(this.walletStore, entry.walletId, entry.paymentHash);
        if (this.unmounted) return;
        const state = outcome === PAY_OUTCOME.PAID ? PAY_STATE.PAID : outcome === PAY_OUTCOME.FAILED ? PAY_STATE.FAILED : null;
        if (!state) continue;
        try { this.ledger.mark(entry, state); } catch { /* asked again next time */ }
      }
    },

    // ───── Fee ─────
    /** A Spark wallet quotes the fee before the slide; the quote is the cap. */
    async refreshFee() {
      const run = this.feeRun = (this.feeRun || 0) + 1;
      clearTimeout(this.feeTimer);
      this.feeSats = null;
      this.feeWalletId = null;
      const intent = this.intent;
      const walletId = this.sendingWalletId;
      const wallet = this.walletStore.wallets.find((w) => w.id === walletId);
      if (!intent || wallet?.type !== 'spark') {
        this.feeEstimating = false;
        return;
      }
      this.feeEstimating = true;
      // A wallet that takes too long to quote must not hold the payment up.
      this.feeTimer = setTimeout(() => {
        if (run !== this.feeRun) return;
        this.feeRun += 1;
        this.feeEstimating = false;
      }, FEE_QUOTE_WAIT_MS);
      try {
        const provider = await this.walletStore.ensureWalletConnectedForTransfer(walletId);
        const estimate = await provider.getLightningSendFeeEstimate(intent.invoice, intent.amountSats);
        if (run !== this.feeRun) return;
        const fee = estimate?.estimatedFeeSats;
        // A guess is not a quote: it is neither shown nor used as the cap.
        if (estimate?.isEstimated !== true && Number.isSafeInteger(fee) && fee >= 0) {
          this.feeSats = fee;
          this.feeWalletId = walletId;
        }
      } catch {
        // No quote: the payment is still capped (see BreezSparkWalletProvider.payInvoice).
      } finally {
        if (run === this.feeRun) {
          clearTimeout(this.feeTimer);
          this.feeEstimating = false;
        }
      }
    },

    // ───── Paying ─────
    /**
     * Check and record the attempt as one step, also across browser tabs.
     * The step itself never throws inside the lock: a lock must not outlive
     * a ledger that could not be written.
     */
    async claim(intent, walletId) {
      const run = () => {
        try {
          return { verdict: this.ledger.claim(
            { invoiceId: intent.invoiceId, paymentHash: intent.paymentHash },
            { walletId, amountSats: intent.amountSats, expiresAt: intent.expiresAt },
          ) };
        } catch (error) {
          return { error };
        }
      };
      const locks = globalThis.navigator?.locks;
      const result = locks?.request ? await locks.request(LEDGER_LOCK, run) : run();
      if (result.error) throw result.error;
      return result.verdict;
    },

    async onConfirm() {
      const intent = this.intent;
      const walletId = this.sendingWalletId;
      if (!intent || !walletId || this.isSending || this.isComplete) return;
      if (secondsToPay(intent.expiresAt) <= 0) {
        this.closePaySheet();
        this.notifyPriceRanOut();
        return;
      }
      if (this.paidInvoiceIds.includes(intent.invoiceId)) {
        this.closePaySheet();
        this.notifyBlocked(PAY_BLOCK.PAID);
        return;
      }

      const wallet = this.walletStore.wallets.find((w) => w.id === walletId);
      this.sendingType = wallet?.type || 'nwc';
      this.isSending = true;
      // Recorded before the invoice reaches the wallet: from here on this
      // invoice is never handed to a wallet again unless it is known to
      // have failed.
      let verdict;
      try {
        verdict = await this.claim(intent, walletId);
      } catch {
        this.isSending = false;
        this.$refs.paySheet?.resetSlide();
        this.$q.notify({ type: 'negative', message: this.$t("Couldn't prepare this payment. Please try again."), timeout: 3500 });
        return;
      }
      if (!verdict.ok) {
        this.closePaySheet();
        this.notifyBlocked(verdict.reason);
        return;
      }

      const maxFeeSats = this.feeWalletId === walletId && typeof this.feeSats === 'number' ? this.feeSats : null;
      try {
        const { outcome } = await payBitrefillInvoice(this.walletStore, walletId, intent.invoice, {
          amountSats: intent.amountSats,
          expiresAt: intent.expiresAt,
          maxFeeSats,
          note: `${this.$t('Order reference')}: ${intent.invoiceId}`,
        });
        if (outcome === PAY_OUTCOME.PAID) this.finishPaid(intent);
        else this.finishUnresolved(intent, PAY_OUTCOME.PENDING);
      } catch (error) {
        await this.onPayError(error, intent, walletId, wallet);
      }
    },

    /**
     * The wallet call threw. services/bitrefill/pay.js sorts it into:
     * certainly not paid (the invoice is freed), paid after all (the shop or
     * the wallet's records say so), or unknown, which keeps it blocked.
     */
    async onPayError(error, intent, walletId, wallet) {
      const key = { invoiceId: intent.invoiceId, paymentHash: intent.paymentHash };
      if (error?.code === BITREFILL_PRICE_EXPIRED) {
        try { this.ledger.mark(key, PAY_STATE.FAILED); } catch { /* original attempt stays blocked */ }
        this.closePaySheet();
        this.notifyPriceRanOut();
        return;
      }

      let outcome = await outcomeAfterError(error, {
        walletStore: this.walletStore,
        walletId,
        walletType: this.sendingType,
        paymentHash: intent.paymentHash,
        shopSawPayment: () => this.waitForWidgetPaid(intent.invoiceId),
      });
      // The shop's word, however late, beats a wallet's refusal.
      if (this.paidInvoiceIds.includes(intent.invoiceId)) outcome = PAY_OUTCOME.PAID;

      if (outcome === PAY_OUTCOME.PAID) {
        this.finishPaid(intent);
        return;
      }
      if (outcome !== PAY_OUTCOME.FAILED) {
        this.finishUnresolved(intent, outcome, error, wallet);
        return;
      }
      // A refusal frees the invoice: it may be paid again, from any wallet.
      try { this.ledger.mark(key, PAY_STATE.FAILED); } catch { /* original attempted entry remains blocked */ }
      this.isSending = false;
      if (this.unmounted) return;
      haptics.error();
      this.showPayError(error, intent, wallet);
      this.$refs.paySheet?.resetSlide();
    },

    showPayError(error, intent, wallet) {
      this.walletStore.showPaymentError(error, {
        context: 'payment',
        walletType: this.sendingType,
        walletName: wallet?.name,
        amountSats: intent.amountSats,
        t: this.$t.bind(this),
      });
    },

    finishPaid(intent) {
      if (!this.paidInvoiceIds.includes(intent.invoiceId)) this.paidInvoiceIds.push(intent.invoiceId);
      this.unresolvedInvoiceIds = this.unresolvedInvoiceIds.filter((id) => id !== intent.invoiceId);
      try { this.ledger.mark({ invoiceId: intent.invoiceId, paymentHash: intent.paymentHash }, PAY_STATE.PAID); } catch { /* original attempted entry remains blocked */ }
      this.isSending = false;
      if (this.unmounted) return;
      this.isComplete = true;
      haptics.success();
      clearTimeout(this.closeTimer);
      // Let the sheet show its finished state, then hand the screen back to
      // the widget. Paid is not delivered yet: the voucher is promised only
      // once Bitrefill reports the order complete (onInvoiceComplete).
      this.closeTimer = setTimeout(() => {
        this.closePaySheet();
        this.$q.notify({ type: 'positive', message: this.$t('Paid. Bitrefill is preparing your order.'), timeout: 3000 });
      }, 900);
    },

    /**
     * Handed to the wallet, and not known to be paid: still on its way
     * (PENDING) or impossible to tell (UNKNOWN). The invoice stays blocked
     * and nothing is celebrated; the widget's "paid" or the next visit's look
     * at the wallet settles it.
     */
    finishUnresolved(intent, outcome, error = null, wallet = null) {
      if (!this.unresolvedInvoiceIds.includes(intent.invoiceId)) this.unresolvedInvoiceIds.push(intent.invoiceId);
      this.isSending = false;
      if (this.unmounted) return;
      this.closePaySheet();
      if (outcome === PAY_OUTCOME.PENDING) {
        this.$q.notify({ type: 'info', message: this.$t('This payment is on its way. Your order shows in the shop as soon as it arrives.'), timeout: 5000 });
        return;
      }
      haptics.warning();
      if (error?.code === NWC_ERROR.UNCONFIRMED) this.showPayError(error, intent, wallet);
      else this.$q.notify({ type: 'warning', message: this.$t("We couldn't confirm this payment. Check History before ordering again."), timeout: 6000 });
    },

    waitForWidgetPaid(invoiceId) {
      if (this.paidInvoiceIds.includes(invoiceId)) return Promise.resolve(true);
      return new Promise((resolve) => {
        const started = Date.now();
        const done = (paid) => {
          clearInterval(this.settleTick);
          this.settleDone = null;
          resolve(paid);
        };
        // Leaving the page ends the wait (beforeUnmount).
        this.settleDone = done;
        this.settleTick = setInterval(() => {
          if (this.paidInvoiceIds.includes(invoiceId)) done(true);
          else if (Date.now() - started >= SETTLE_WAIT_MS) done(false);
        }, 250);
      });
    },

    /** The sheet's own Back: never while a payment is out or just landed. */
    onPaySheetCancel() {
      if (this.isSending || this.isComplete) return;
      this.closePaySheet();
    },
    closePaySheet() {
      this.paySheetOpen = false;
      this.isComplete = false;
      this.isSending = false;
      this.intent = null;
      this.feeRun = (this.feeRun || 0) + 1;
      clearTimeout(this.feeTimer);
      this.feeEstimating = false;
    },

    startClock() {
      this.stopClock();
      this.nowSec = Math.floor(Date.now() / 1000);
      this.clock = setInterval(() => { this.nowSec = Math.floor(Date.now() / 1000); }, 1000);
    },
    stopClock() {
      clearInterval(this.clock);
      this.clock = null;
    },

    // ───── Email ─────
    openEmailSheet(editing) {
      this.emailSheetEditing = editing;
      this.emailSheetOpen = true;
    },
    async onEmailSave(email) {
      if (this.emailBusy) return;
      this.emailBusy = true;
      try {
        await saveEmail(email);
        const changed = email !== this.savedEmail;
        this.savedEmail = email;
        this.emailSheetOpen = false;
        // The widget reads the email from its address: reload it only when
        // it changed, so a cart in progress is not lost for nothing.
        if (changed || !this.widgetSrc) this.loadWidget();
      } catch {
        this.$q.notify({ type: 'negative', message: this.$t("Couldn't save the email. Please try again."), timeout: 3000 });
      } finally {
        this.emailBusy = false;
      }
    },
    onEmailSkip() {
      if (this.emailBusy) return;
      markEmailAsked();
      this.emailSheetOpen = false;
      if (!this.widgetSrc) this.loadWidget();
    },
    /** Asked first (the remove dialog): the shop reloads without the email. */
    onEmailRemove() {
      this.removeEmailOpen = false;
      if (this.emailBusy) return;
      clearEmail();
      this.savedEmail = '';
      this.emailSheetOpen = false;
      this.loadWidget();
    },
  },
};
</script>

<style scoped>
/* The page cancels the global .q-page top inset so the header can own it.
   Only the app's own chrome is styled here: the shop inside the frame is
   Bitrefill's and stays untouched. */
.bitrefill-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  padding-top: 0;
  overflow: hidden;
  background: var(--bg-primary);
}

.bitrefill-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(8px + var(--safe-top, 0px)) 12px 8px;
}
.bitrefill-title {
  flex: 1 1 auto;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 1.0625rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}
/* A full touch target, whatever the shared back-button class sets. */
.bitrefill-hbtn { flex: 0 0 44px; width: 44px; height: 44px; min-width: 44px; min-height: 44px; }

.bitrefill-line {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 8px 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--text-primary);
}
.bitrefill-line span { flex: 1 1 auto; overflow-wrap: anywhere; }
.bitrefill-line-close {
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}
.bitrefill-line-close:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: -4px; border-radius: var(--radius-ms); }

.bitrefill-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  padding-bottom: var(--safe-bottom, 0px);
}
.bitrefill-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

.bitrefill-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 0.9375rem;
  line-height: 1.45;
  background: var(--bg-primary);
  color: var(--text-secondary);
}
.bitrefill-state p { margin: 0; max-width: 280px; }
.bitrefill-retry { min-height: 44px; border-radius: 14px; padding: 0 22px; font-weight: 700; }
.bitrefill-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
