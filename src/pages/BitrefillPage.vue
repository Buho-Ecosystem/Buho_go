<template>
  <q-page class="bitrefill-page" :class="$q.dark.isActive ? 'bitrefill-dark' : 'bitrefill-light'">
    <!-- Header. It owns the top safe-area inset and sticks at top: 0 (a
         non-zero sticky top would push it into the content on Android). -->
    <div class="bitrefill-header">
      <q-btn flat round dense class="bitrefill-hbtn" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" :aria-label="$t('Back')" @click="goBack">
        <Icon icon="tabler:chevron-left" width="20" height="20" />
      </q-btn>
      <div class="bitrefill-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">Bitrefill</div>
      <q-btn flat round dense class="bitrefill-hbtn" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" :aria-label="$t('Voucher email')" @click="openEmailSheet(true)">
        <Icon icon="tabler:mail" width="20" height="20" />
      </q-btn>
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
        @load="frameLoaded = true"
      ></iframe>

      <div v-if="offline" class="bitrefill-state" role="status">
        <Icon icon="tabler:wifi-off" width="28" height="28" aria-hidden="true" />
        <p>{{ $t('The shop needs an internet connection.') }}</p>
        <q-btn unelevated no-caps class="bitrefill-retry" :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'" :label="$t('Try again')" @click="retry" />
      </div>
      <div v-else-if="widgetSrc && !frameLoaded" class="bitrefill-state" aria-hidden="true">
        <q-spinner size="28px" />
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
      @remove="onEmailRemove"
    />

    <PaymentConfirmSheet
      ref="paySheet"
      v-model="paySheetOpen"
      :payment="paymentProps"
      :wallet-can-pay="walletCanPay"
      :wallet-hint="walletHint"
      :paying-wallets="payingWallets"
      :sending-wallet-id="sendingWalletId"
      :is-sending="isSending"
      :is-complete="isComplete"
      :status-message="statusMessage"
      @update:sending-wallet-id="sendingWalletId = $event"
      @confirm="onConfirm"
      @cancel="closePaySheet"
    />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { useCloudBackupStore } from '../stores/cloudBackup';
import BitrefillEmailSheet from '../components/bitrefill/BitrefillEmailSheet.vue';
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
  isPaidUpdate,
  isExpiredUpdate,
  isValidEmail,
  WIDGET_EVENT,
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
import { payBitrefillInvoice } from '../services/bitrefill/pay.js';

/** How long a refused payment waits for the widget to report it paid anyway. */
const SETTLE_WAIT_MS = 4000;

/**
 * The Bitrefill shop: Bitrefill's widget in a frame, paid from the user's own
 * wallets on BuhoGO's confirm sheet.
 *
 *   first open   ask where vouchers go (once; "Not now" leaves it to Bitrefill)
 *   shopping     the widget, with the documented theme and language only
 *   paying       payment_intent -> the confirm sheet -> the chosen wallet
 *   after        the widget shows the voucher; it is emailed as well
 *
 * One invoice is paid at most once (services/bitrefill/storage.js). The route
 * is out of reach in kiosk mode, like every route (boot/kiosk.js).
 */
export default {
  name: 'BitrefillPage',
  components: { Icon, BitrefillEmailSheet, PaymentConfirmSheet },
  data() {
    return {
      widgetSrc: '',
      frameLoaded: false,
      offline: false,

      savedEmail: '',
      emailSheetOpen: false,
      emailSheetEditing: false,
      emailBusy: false,

      paySheetOpen: false,
      intent: null, // { invoiceId, invoice, amountSats, description, expiresAt }
      sendingWalletId: null,
      isSending: false,
      isComplete: false,
      sendingType: null,
      nowSec: Math.floor(Date.now() / 1000),

      paidInvoiceIds: [],
    };
  },
  computed: {
    walletStore() { return useWalletStore(); },
    suggestedEmail() {
      const email = useCloudBackupStore().signedInEmail;
      return isValidEmail(email) ? email : '';
    },
    secondsLeft() {
      if (!this.intent?.expiresAt) return 0;
      return Math.max(0, this.intent.expiresAt - this.nowSec);
    },
    paymentProps() {
      if (!this.intent) return null;
      return {
        recipient: {
          name: 'Bitrefill',
          logoUrl: '/Bitrefill/bitrefill-mark.png',
          color: '#002B28',
          addressType: 'invoice',
          address: '',
        },
        amount: { mode: 'fixed', fixedSats: this.intent.amountSats },
        description: this.intent.description,
        commentAllowed: false,
        countdown: this.secondsLeft > 0 ? { seconds: this.secondsLeft, urgentBelow: 60 } : null,
        feeEstimate: null,
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
  },
  watch: {
    // Closed with its Back button: nothing is pending any more.
    paySheetOpen(open) {
      if (!open && !this.isSending) this.intent = null;
    },
    secondsLeft(left) {
      // The price ran out while the sheet was open and nothing was sent.
      if (left === 0 && this.paySheetOpen && this.intent && !this.isSending && !this.isComplete) {
        this.closePaySheet();
        this.$q.notify({ type: 'warning', message: this.$t('The price ran out. Choose the card again for a new price.'), timeout: 3500 });
      }
    },
  },
  created() {
    this.ledger = createInvoiceLedger();
  },
  async mounted() {
    window.addEventListener('message', this.onMessage);
    window.addEventListener('online', this.onOnline);
    this.clock = setInterval(() => { this.nowSec = Math.floor(Date.now() / 1000); }, 1000);

    this.savedEmail = await loadEmail();
    if (!this.savedEmail && !wasEmailAsked()) {
      this.openEmailSheet(false);
    } else {
      this.loadWidget();
    }
  },
  beforeUnmount() {
    window.removeEventListener('message', this.onMessage);
    window.removeEventListener('online', this.onOnline);
    clearInterval(this.clock);
    clearTimeout(this.closeTimer);
  },
  methods: {
    goBack() {
      if (window.history.length > 1) this.$router.back();
      else this.$router.replace('/spend');
    },

    // ───── Widget ─────
    loadWidget() {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.offline = true;
        return;
      }
      this.offline = false;
      this.frameLoaded = false;
      this.widgetSrc = buildWidgetUrl({
        dark: this.$q.dark.isActive,
        locale: this.$i18n.locale,
        email: this.savedEmail,
      });
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
      } else if (isExpiredUpdate(message) && this.intent?.invoiceId === message.invoiceId && !this.isSending) {
        this.closePaySheet();
      }
    },

    onPaymentIntent(message) {
      // The sheet shows one order until it closes. The widget sits behind it
      // and cannot be used meanwhile, so another intent is not the user's;
      // swapping it in could change what a finger already on the slide pays.
      if (this.paySheetOpen || this.isSending) return;

      const verdict = this.ledger.canPay(message.invoiceId);
      if (!verdict.ok) {
        this.$q.notify(verdict.reason === PAY_BLOCK.PAID
          ? { type: 'positive', message: this.$t('This order is already paid.'), timeout: 2500 }
          : { type: 'warning', message: this.$t('A payment for this order may still be on its way. Check the order in the shop before paying again.'), timeout: 5000 });
        return;
      }

      const invoice = invoiceFromIntent(message);
      let parsed = null;
      try { parsed = invoice ? parseLightningInvoice(invoice) : null; } catch { parsed = null; }
      if (!parsed || !(parsed.amount > 0)) {
        this.$q.notify({ type: 'negative', message: this.$t("BuhoGO can't pay this order. Please try again in the shop."), timeout: 3500 });
        return;
      }
      if (parsed.expiry && parsed.expiry <= Math.floor(Date.now() / 1000)) {
        this.$q.notify({ type: 'warning', message: this.$t('The price ran out. Choose the card again for a new price.'), timeout: 3500 });
        return;
      }

      this.intent = {
        invoiceId: message.invoiceId,
        invoice: parsed.invoice,
        amountSats: parsed.amount,
        description: parsed.description,
        expiresAt: parsed.expiry,
      };
      this.isSending = false;
      this.isComplete = false;
      this.sendingWalletId = pickDefaultPayingWallet(this.payingWallets)?.id || null;
      this.paySheetOpen = true;
    },

    /** The widget saw the payment: true whatever our wallet call said. */
    onWidgetPaid(invoiceId) {
      if (!this.paidInvoiceIds.includes(invoiceId)) this.paidInvoiceIds.push(invoiceId);
      const entry = this.ledger.get(invoiceId);
      if (entry && entry.state !== PAY_STATE.PAID) this.ledger.mark(invoiceId, PAY_STATE.PAID);
    },

    // ───── Paying ─────
    async onConfirm() {
      const intent = this.intent;
      const walletId = this.sendingWalletId;
      if (!intent || !walletId || this.isSending) return;
      if (!this.ledger.canPay(intent.invoiceId).ok) {
        this.closePaySheet();
        return;
      }

      const wallet = this.walletStore.wallets.find((w) => w.id === walletId);
      this.sendingType = wallet?.type || 'nwc';
      this.isSending = true;
      // Recorded before the invoice reaches the wallet: from here on this
      // invoice is never handed to a wallet again unless it is known to
      // have failed.
      this.ledger.mark(intent.invoiceId, PAY_STATE.ATTEMPTED, { walletId, amountSats: intent.amountSats });

      try {
        await payBitrefillInvoice(this.walletStore, walletId, intent.invoice, { amountSats: intent.amountSats });
        this.finishPaid(intent);
      } catch (error) {
        // A wallet can report failure on a payment that landed: give the
        // widget a moment to say it saw the money before calling it failed.
        if (await this.waitForWidgetPaid(intent.invoiceId)) {
          this.finishPaid(intent);
          return;
        }
        const unknown = error?.code === NWC_ERROR.UNCONFIRMED;
        // An unknown outcome keeps the invoice blocked; a refusal frees it.
        if (!unknown) this.ledger.mark(intent.invoiceId, PAY_STATE.FAILED);
        this.isSending = false;
        if (unknown) haptics.warning();
        else haptics.error();
        this.walletStore.showPaymentError(error, {
          context: 'payment',
          walletType: this.sendingType,
          walletName: wallet?.name,
          amountSats: intent.amountSats,
          t: this.$t.bind(this),
        });
        if (unknown) this.closePaySheet();
        else this.$refs.paySheet?.resetSlide();
      }
    },

    finishPaid(intent) {
      this.ledger.mark(intent.invoiceId, PAY_STATE.PAID);
      this.isSending = false;
      this.isComplete = true;
      haptics.success();
      clearTimeout(this.closeTimer);
      // Let the sheet show its finished state, then hand the screen back to
      // the widget, which shows the voucher.
      this.closeTimer = setTimeout(() => {
        this.closePaySheet();
        this.$q.notify({ type: 'positive', message: this.$t('Paid. Your voucher appears in the shop and in your email.'), timeout: 3000 });
      }, 900);
    },

    waitForWidgetPaid(invoiceId) {
      if (this.paidInvoiceIds.includes(invoiceId)) return Promise.resolve(true);
      return new Promise((resolve) => {
        const started = Date.now();
        const tick = setInterval(() => {
          if (this.paidInvoiceIds.includes(invoiceId)) { clearInterval(tick); resolve(true); }
          else if (Date.now() - started >= SETTLE_WAIT_MS) { clearInterval(tick); resolve(false); }
        }, 250);
      });
    },

    closePaySheet() {
      this.paySheetOpen = false;
      this.isComplete = false;
      this.isSending = false;
      this.intent = null;
    },

    // ───── Email ─────
    openEmailSheet(editing) {
      this.emailSheetEditing = editing;
      this.emailSheetOpen = true;
    },
    async onEmailSave(email) {
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
      markEmailAsked();
      this.emailSheetOpen = false;
      if (!this.widgetSrc) this.loadWidget();
    },
    onEmailRemove() {
      clearEmail();
      this.savedEmail = '';
      this.emailSheetOpen = false;
      this.loadWidget();
    },
  },
};
</script>

<style scoped>
/* The page cancels the global .q-page top inset so the header can own it. */
.bitrefill-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  padding-top: 0;
  overflow: hidden;
}
.bitrefill-light { background: #FAF7EF; }
.bitrefill-dark { background: #0C0C0C; }

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
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.bitrefill-hbtn { flex: 0 0 auto; }

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
  font-size: 15px;
  line-height: 1.45;
}
.bitrefill-light .bitrefill-state { background: #FAF7EF; color: #475569; }
.bitrefill-dark .bitrefill-state { background: #0C0C0C; color: #a3a3a3; }
.bitrefill-state p { margin: 0; max-width: 280px; }
.bitrefill-retry { min-height: 44px; border-radius: 14px; padding: 0 22px; font-weight: 700; }
</style>
