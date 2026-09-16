<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card
      class="shop-sheet shop-surface"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Drag handle -->
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <!-- Header. The close control is NEVER disabled: once a payment has been
           made the order lives in the ledger, so leaving can no longer lose
           anything, and a spinner the user cannot escape is how a slow
           fulfilment turned into a lost purchase. -->
      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ headerTitle }}
        </div>
        <q-btn
          flat round dense
          :aria-label="$t('Close')"
          class="sheet-close-btn"
          :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          @click="open = false"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-scroll">
        <!-- ─────────── STEP: preparing (creating the invoice) ─────────── -->
        <section v-if="step === 'preparing'" class="step-body step-body--centered">
          <div class="centered-stage">
            <template v-if="prepareError">
              <div class="error-icon">
                <Icon icon="tabler:alert-circle" width="40" height="40" />
              </div>
              <div class="centered-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t("Couldn't start this purchase") }}
              </div>
              <div class="centered-caption" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ prepareError }}
              </div>
              <div class="centered-caption" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                {{ $t('Nothing was charged.') }}
              </div>
            </template>
            <template v-else>
              <q-spinner color="grey" size="34px" />
              <div class="centered-caption" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Preparing your order…') }}
              </div>
            </template>
          </div>
        </section>

        <!-- ─────────── STEP: paying (confirm + pay) ─────────── -->
        <section v-else-if="step === 'paying'" class="step-body">
          <!-- Summary -->
          <div class="summary-card" :class="$q.dark.isActive ? 'summary-card-dark' : 'summary-card-light'">
            <div class="summary-handle">
              <Icon :icon="kindIcon" width="18" height="18" class="summary-check" />
              <span class="summary-handle-text">{{ descriptor.title }}</span>
            </div>
            <div v-if="descriptor.meta" class="summary-meta" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
              {{ descriptor.meta }}
            </div>
            <div class="summary-price">
              <span class="summary-price-amount" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ formatSats(priceSats) }}
              </span>
              <span class="summary-price-unit" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
                {{ $t('sats') }}
              </span>
              <span v-if="priceUsd" class="summary-price-fiat" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                {{ formatUsd(priceUsd) }}
              </span>
              <span v-if="discountPct" class="summary-discount">
                {{ $t('{pct}% off', { pct: discountPct }) }}
              </span>
              <ShopInfoTooltip
                tone="toolbox"
                trigger-icon="tabler:tools"
                icon="tabler:tools"
                :aria-label="$t('What happens when I pay')"
                :title="$t('What happens when you pay')"
                :lede="$t('The price is fixed on the invoice. No extra fees are added.')"
                :steps="payHelpSteps"
              />
            </div>
          </div>

          <!-- Already paid, awaiting confirmation. No re-pay path from here, so
               a slow confirmation cannot double-charge. -->
          <div
            v-if="paid"
            class="paid-note"
            :class="$q.dark.isActive ? 'paid-note-dark' : 'paid-note-light'"
            aria-live="polite"
          >
            <Icon icon="tabler:circle-check" width="16" height="16" />
            <span>{{ $t('Paid. Waiting for the provider to hand it over.') }}</span>
          </div>

          <!-- Pay source (internal balance, invisible affiliate) -->
          <div v-else-if="payableWallets.length" class="pay-source">
            <span class="pay-source-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('Pay with') }}
            </span>
            <button
              v-if="payableWallets.length > 1"
              type="button"
              class="pay-source-pill"
              :class="$q.dark.isActive ? 'pay-source-pill-dark' : 'pay-source-pill-light'"
              @click="walletMenuOpen = true"
            >
              <span class="pay-source-name">{{ selectedWalletLabel }}</span>
              <Icon icon="tabler:chevron-down" width="14" height="14" />
              <q-menu v-model="walletMenuOpen" anchor="bottom right" self="top right" :offset="[0, 6]">
                <q-list class="wallet-menu-list" :class="$q.dark.isActive ? 'wallet-menu-list-dark' : 'wallet-menu-list-light'">
                  <q-item
                    v-for="w in payableWallets"
                    :key="w.id"
                    clickable v-close-popup
                    @click="selectedWalletId = w.id"
                  >
                    <q-item-section>
                      <q-item-label>{{ w.name }}</q-item-label>
                      <q-item-label caption>{{ formatSats(w.balance) }} {{ $t('sats') }}</q-item-label>
                    </q-item-section>
                    <q-item-section v-if="w.id === selectedWalletId" side>
                      <Icon icon="tabler:check" width="16" height="16" />
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </button>
            <span
              v-else
              class="pay-source-static"
              :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
            >
              {{ payableWallets[0].name }}
              <span class="pay-source-balance" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
                · {{ formatSats(payableWallets[0].balance) }} {{ $t('sats') }}
              </span>
            </span>
          </div>

          <!-- Insufficient balance: never a dead end. -->
          <div
            v-else
            class="pay-error"
            :class="$q.dark.isActive ? 'pay-error-dark' : 'pay-error-light'"
            role="alert"
          >
            <Icon icon="tabler:wallet" width="16" height="16" />
            <span>{{ $t('No wallet can cover this yet. Top up, or pay from another wallet below.') }}</span>
          </div>

          <!-- Pay error -->
          <div
            v-if="payError"
            class="pay-error"
            :class="$q.dark.isActive ? 'pay-error-dark' : 'pay-error-light'"
            role="alert"
          >
            <Icon icon="tabler:alert-circle" width="16" height="16" />
            <span>{{ payError }}</span>
          </div>

          <!-- The receipt. Shown the moment money is at stake, because it is
               the only thing that can redeem this order later. -->
          <ReceiptRow v-if="paid && order" :order="order" />

          <!-- External pay: collapsed unless no wallet can cover. Keeps the
               purchase alive from another wallet without stranding the user. -->
          <div v-if="!paid" class="external-pay">
            <button
              type="button"
              class="external-pay-toggle"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
              @click="toggleExternalPay"
            >
              <Icon :icon="showExternalPay ? 'tabler:chevron-up' : 'tabler:chevron-down'" width="14" height="14" />
              <span>{{ $t('Or pay from another wallet') }}</span>
            </button>

            <div v-if="showExternalPay" class="invoice-row-wrap">
              <button
                type="button"
                class="invoice-row"
                :class="$q.dark.isActive ? 'invoice-row-dark' : 'invoice-row-light'"
                :aria-label="$t('Copy invoice')"
                @click="copyInvoice"
              >
                <span class="invoice-row-text">{{ truncatedInvoice }}</span>
                <Icon :icon="invoiceCopied ? 'tabler:check' : 'tabler:copy'" width="14" height="14" class="invoice-row-icon" />
              </button>
              <button
                type="button"
                class="qr-icon-btn"
                :class="$q.dark.isActive ? 'qr-icon-btn-dark' : 'qr-icon-btn-light'"
                :aria-label="$t('Show QR code')"
                @click="qrExpanded = !qrExpanded"
              >
                <Icon icon="tabler:qrcode" width="18" height="18" />
              </button>
            </div>
            <div v-if="showExternalPay && qrExpanded" class="qr-stage">
              <vue-qrcode v-if="invoice?.paymentRequest" :value="invoice.paymentRequest.toUpperCase()" :options="qrOptions" class="qr-canvas" />
            </div>
            <div v-if="showExternalPay && waitingExternal" class="external-waiting" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'" aria-live="polite">
              <q-spinner size="13px" />
              <span>{{ $t('Waiting for payment…') }}</span>
            </div>
          </div>
        </section>

        <!-- ─────────── STEP: activating ─────────── -->
        <section v-else-if="step === 'activating'" class="step-body">
          <div class="centered-stage">
            <q-spinner color="grey" size="36px" />
            <div class="centered-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ activatingTitle }}
            </div>
            <div class="centered-caption" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('This usually takes a few seconds.') }}
            </div>
          </div>

          <!-- The escape hatch, stated plainly. Closing here is safe and the
               user is told so before they need to guess. -->
          <div class="safe-note" :class="$q.dark.isActive ? 'safe-note-dark' : 'safe-note-light'">
            <Icon icon="tabler:shield-check" width="16" height="16" />
            <span>{{ $t('You can close this. Your order is saved and will be waiting in Your products.') }}</span>
          </div>

          <ReceiptRow v-if="order" :order="order" />
        </section>

        <!-- ─────────── STEP: success ─────────── -->
        <section v-else-if="step === 'success'" class="step-body">
          <!-- A top-up or an extension renews something the user already has,
               so there is nothing new to install. Saying so plainly beats
               re-showing an install code they do not need to scan again. -->
          <template v-if="order && successView === 'renewal'">
            <div class="centered-stage">
              <div class="success-check">
                <Icon icon="tabler:circle-check-filled" width="48" height="48" />
              </div>
              <div class="centered-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ renewalCopy.title }}
              </div>
              <div class="centered-caption" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ renewalCopy.body }}
              </div>
            </div>
            <ReceiptRow :order="order" />
            <button
              type="button"
              class="primary-cta"
              :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
              @click="open = false"
            >
              <span>{{ $t('Done') }}</span>
            </button>
          </template>
          <SuccessEsim v-else-if="order && successView === 'esim'" :receipt="order" @done="open = false" />
          <SuccessVpn v-else-if="order" :receipt="order" @done="open = false" />
        </section>

        <!-- ─────────── STEP: problem (terminal) ─────────── -->
        <section v-else-if="step === 'problem'" class="step-body">
          <div class="centered-stage">
            <div class="error-icon">
              <Icon icon="tabler:alert-triangle" width="40" height="40" />
            </div>
            <div class="centered-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ problemCopy.title }}
            </div>
            <div class="centered-caption" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ problemCopy.body }}
            </div>
          </div>

          <div class="help-row">
            <ShopInfoTooltip
              tone="toolbox"
              trigger-icon="tabler:tools"
              icon="tabler:tools"
              :aria-label="$t('What can I do now')"
              :title="$t('What you can do now')"
              :lede="$t('Your payment is not lost. It just needs a person to look at it.')"
              :steps="problemHelpSteps"
            />
            <span class="help-row-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('What you can do now') }}
            </span>
          </div>

          <ReceiptRow v-if="order" :order="order" expanded />
        </section>
      </div>

      <!-- Sticky action bar. One primary action per step. -->
      <div
        v-if="actionBarVisible"
        class="sheet-actions"
        :class="$q.dark.isActive ? 'sheet-actions-dark' : 'sheet-actions-light'"
      >
        <!-- Paid, or external-only (no internal wallet): re-poll, never re-pay. -->
        <button
          v-if="step === 'paying' && showCheckAgain"
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :disabled="actionInflight"
          @click="reCheck"
        >
          <q-spinner v-if="actionInflight" size="18px" />
          <span>{{ $t('Check again') }}</span>
        </button>
        <button
          v-else-if="step === 'paying'"
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :disabled="!canPay || actionInflight"
          @click="onPay"
        >
          <q-spinner v-if="actionInflight" size="18px" />
          <span>{{ payLabel }}</span>
        </button>

        <button
          v-else-if="step === 'preparing' && prepareError"
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          @click="prepare"
        >
          <span>{{ $t('Try again') }}</span>
        </button>

        <button
          v-else-if="step === 'problem'"
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          @click="copyReceipt"
        >
          <Icon :icon="receiptCopied ? 'tabler:check' : 'tabler:copy'" width="18" height="18" />
          <span>{{ receiptCopied ? $t('Copied') : $t('Copy my receipt') }}</span>
        </button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { Invoice } from '@getalby/lightning-tools';
import { useWalletStore } from '../../stores/wallet';
import { useNadanadaOrdersStore } from '../../stores/nadanadaOrders';
import {
  redeemOrder, orderReceiptText, ORDER_KIND, ORDER_STATE,
  REDEEM_ATTEMPT_MS, PROBE_ATTEMPT_MS,
} from '../../services/nadanada/orders.js';
import SuccessEsim from './SuccessEsim.vue';
import SuccessVpn from './SuccessVpn.vue';
import ShopInfoTooltip from './ShopInfoTooltip.vue';
import ReceiptRow from './ReceiptRow.vue';

import { writeClipboardCrossPlatform } from '../../utils/shopClipboard.js';

const INVOICE_TRUNCATE_HEAD = 16;
const INVOICE_TRUNCATE_TAIL = 8;

/**
 * Generic purchase sheet for the nadanada shop. Product-agnostic: it is
 * driven by a `descriptor` so eSIM, eSIM top-up, VPN and VPN extension all
 * share one payment surface (the affiliate, fees, and earnings are invisible
 * — there is only a single all-in sats price).
 *
 * Descriptor contract:
 *   {
 *     kind: 'esim' | 'esim_topup' | 'vpn' | 'vpn_extend',
 *     title: string,          // summary line 1, e.g. "🇯🇵 Japan"
 *     meta: string,           // summary line 2, e.g. "5 GB · 30 days"
 *     createInvoice: async () => ({ paymentRequest, paymentHash, checkoutId, priceUsd?, originalPriceUsd?, expiresAt? }),
 *     orderFields: (invoice) => object,   // product context stored on the order
 *   }
 *
 * THE ORDERING RULE THIS COMPONENT EXISTS TO ENFORCE: an order is written to
 * the ledger the moment an invoice exists, and marked paid the instant the
 * wallet returns — both before fulfilment is attempted. Every later step
 * (polling, closing the sheet, the app being killed) is then recoverable,
 * because the keys that redeem the order are already on disk. See
 * services/nadanada/orders.js.
 */
export default {
  name: 'PurchaseSheet',
  components: { Icon, VueQrcode, SuccessEsim, SuccessVpn, ShopInfoTooltip, ReceiptRow },

  props: {
    modelValue: { type: Boolean, default: false },
    descriptor: { type: Object, default: null },
  },

  emits: ['update:modelValue', 'purchased', 'backgrounded'],

  setup() {
    const walletStore = useWalletStore();
    const ordersStore = useNadanadaOrdersStore();
    return { walletStore, ordersStore };
  },

  data() {
    return {
      step: 'preparing',
      invoice: null,            // { paymentRequest, paymentHash, checkoutId, priceUsd, ... }
      orderId: null,            // ledger key — the receipt lives here, not in this component
      priceSats: null,
      prepareError: null,
      payError: null,
      problem: null,            // { error, code } for the terminal step
      selectedWalletId: null,
      walletMenuOpen: false,
      actionInflight: false,
      // Set once the internal payment has actually been sent. Guards against a
      // second payment if confirmation is slow: the CTA becomes "Check again"
      // (re-poll) instead of "Pay".
      paid: false,
      showExternalPay: false,
      qrExpanded: false,
      invoiceCopied: false,
      invoiceCopiedTimer: null,
      receiptCopied: false,
      receiptCopiedTimer: null,
      waitingExternal: false,
      activationController: null,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    /** Live view of the ledger record, so the receipt and success body always
     *  render what is actually persisted rather than a local copy. */
    order() {
      return this.orderId ? this.ordersStore.orderById(this.orderId) : null;
    },

    isEsimKind() {
      return this.descriptor?.kind === ORDER_KIND.ESIM || this.descriptor?.kind === ORDER_KIND.ESIM_TOPUP;
    },

    /** Which success body to render: a fresh product, or a renewal of one the
     *  user already holds. */
    successView() {
      const k = this.descriptor?.kind;
      if (k === ORDER_KIND.ESIM_TOPUP || k === ORDER_KIND.VPN_EXTEND) return 'renewal';
      return k === ORDER_KIND.ESIM ? 'esim' : 'vpn';
    },

    renewalCopy() {
      if (this.descriptor?.kind === ORDER_KIND.ESIM_TOPUP) {
        return {
          title: this.$t('Data added'),
          body: this.$t('Your eSIM has the new plan on it. Nothing to install, nothing to scan.'),
        };
      }
      return {
        title: this.$t('Time added'),
        body: this.$t('Your VPN runs for longer now. Keep using the same connection.'),
      };
    },

    headerTitle() {
      switch (this.step) {
        case 'activating': return this.$t('Almost there');
        case 'success': return this.$t('Success');
        case 'problem': return this.$t('This order needs a hand');
        default: return this.$t('Confirm purchase');
      }
    },

    kindIcon() {
      return this.isEsimKind ? 'tabler:world' : 'tabler:shield-lock';
    },

    activatingTitle() {
      switch (this.descriptor?.kind) {
        case ORDER_KIND.VPN:
        case ORDER_KIND.VPN_EXTEND:
          return this.$t('Building your VPN config…');
        case ORDER_KIND.ESIM_TOPUP:
          return this.$t('Adding the data to your eSIM…');
        default:
          return this.$t('Getting your eSIM ready…');
      }
    },

    payHelpSteps() {
      return [
        this.$t('The sats leave the wallet you picked. Nothing else is charged.'),
        this.$t('We save your receipt before you pay, so the order can always be found again.'),
        this.$t('The provider hands over your product, usually within seconds.'),
        this.$t('If it takes longer, you can close this screen. The order waits for you in Your products.'),
      ];
    },

    problemHelpSteps() {
      return [
        this.$t('Copy your receipt with the button below. It holds every reference the provider needs.'),
        this.$t('Email it to info{\'@\'}nadanada.me and tell them what you bought.'),
        this.$t('The order also stays in Your products, so you can copy it again any time.'),
      ];
    },

    problemCopy() {
      const code = this.problem?.code || '';
      if (code === 'CONFIG_ALREADY_GENERATED') {
        return {
          title: this.$t('This VPN was already set up once'),
          body: this.$t('The provider only hands over a VPN config a single time, and this one has already been issued. Your receipt below has everything they need to re-issue it.'),
        };
      }
      if (this.problem?.status === 404 || /not found/i.test(this.problem?.error || '')) {
        return {
          title: this.$t("We can't find this order"),
          body: this.$t("The provider has no record of this payment reference. If the sats did leave your wallet, your receipt below is the proof."),
        };
      }
      return {
        title: this.$t("This order didn't go through"),
        body: this.problem?.error || this.$t('The provider could not complete it. Your receipt below has everything they need.'),
      };
    },

    priceUsd() {
      return this.invoice?.priceUsd ?? null;
    },

    discountPct() {
      const o = this.invoice?.originalPriceUsd;
      const p = this.invoice?.priceUsd;
      if (!o || !p || o <= p) return null;
      return Math.round((1 - p / o) * 100);
    },

    qrOptions() {
      const dark = this.$q.dark.isActive;
      return {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 6,
        color: { dark: dark ? '#f8fafc' : '#0f172a', light: dark ? '#0b0f17' : '#ffffff' },
      };
    },

    /** Wallets that can pay right now: connected + balance covers price.
     *  Active wallet floated to top so the default pick is the obvious one. */
    payableWallets() {
      const price = this.priceSats || 0;
      const out = [];
      for (const w of this.walletStore.wallets || []) {
        // Store purchases are Lightning invoices; Arkade's Lightning rail is
        // out of service (Boltz retired) and would fail after the order is
        // marked attempted.
        if (w.type === 'arkade') continue;
        const connected = !!this.walletStore.connectionStates?.[w.id]?.connected;
        const balance = this.walletStore.balances?.[w.id] || 0;
        if (!connected) continue;
        if (balance < price) continue;
        out.push({ id: w.id, name: w.name || this.$t('Wallet'), type: w.type, balance });
      }
      const activeId = this.walletStore.activeWalletId;
      out.sort((a, b) => (b.id === activeId ? 1 : 0) - (a.id === activeId ? 1 : 0));
      return out;
    },

    selectedWalletLabel() {
      const w = this.payableWallets.find((x) => x.id === this.selectedWalletId);
      if (!w) return this.$t('Pick a wallet');
      return `${w.name} · ${this.formatSats(w.balance)} ${this.$t('sats')}`;
    },

    canPay() {
      return !!this.invoice && this.payableWallets.length > 0 && !!this.selectedWalletId;
    },

    /** Show "Check again" (re-poll, never re-pay) instead of "Pay" once the
     *  invoice is paid, or when there is no internal wallet to pay from (the
     *  user pays externally and re-checks). */
    showCheckAgain() {
      return this.paid || this.payableWallets.length === 0;
    },

    actionBarVisible() {
      if (this.step === 'paying' || this.step === 'problem') return true;
      return this.step === 'preparing' && !!this.prepareError;
    },

    payLabel() {
      if (!this.priceSats) return this.$t('Pay');
      return this.$t('Pay · {sats} sats', { sats: this.formatSats(this.priceSats) });
    },

    truncatedInvoice() {
      const inv = this.invoice?.paymentRequest;
      if (!inv) return '';
      if (inv.length <= INVOICE_TRUNCATE_HEAD + INVOICE_TRUNCATE_TAIL + 1) return inv;
      return `${inv.slice(0, INVOICE_TRUNCATE_HEAD)}…${inv.slice(-INVOICE_TRUNCATE_TAIL)}`;
    },
  },

  watch: {
    open(isOpen) {
      if (isOpen) this.resetForNewSession();
    },
  },

  beforeUnmount() {
    this.activationController?.abort();
    clearTimeout(this.invoiceCopiedTimer);
    clearTimeout(this.receiptCopiedTimer);
  },

  methods: {
    formatSats(n) {
      if (n == null || !Number.isFinite(n)) return '';
      try { return new Intl.NumberFormat(this.$i18n?.locale || undefined).format(n); }
      catch { return String(n); }
    },

    formatUsd(n) {
      if (n == null || !Number.isFinite(n)) return '';
      try {
        return new Intl.NumberFormat(this.$i18n?.locale || undefined, { style: 'currency', currency: 'USD' }).format(n);
      } catch { return `$${n}`; }
    },

    decodeSats(pr) {
      try {
        const clean = String(pr || '').replace(/^lightning:/i, '');
        return new Invoice({ pr: clean }).satoshi || 0;
      } catch { return 0; }
    },

    resetForNewSession() {
      // A poll from a previous session may still be in flight; stop it before
      // this one starts, or its result would land on the wrong order.
      this.activationController?.abort();
      this.activationController = null;
      this.step = 'preparing';
      this.invoice = null;
      this.orderId = null;
      this.priceSats = null;
      this.prepareError = null;
      this.payError = null;
      this.problem = null;
      this.selectedWalletId = this.walletStore.activeWalletId || null;
      this.walletMenuOpen = false;
      this.actionInflight = false;
      this.showExternalPay = false;
      this.qrExpanded = false;
      this.invoiceCopied = false;
      this.receiptCopied = false;
      this.waitingExternal = false;
      this.paid = false;
      this.prepare();
    },

    onShow() {
      // resetForNewSession already ran via the `open` watcher; if the sheet
      // was mounted-open, ensure we have an invoice in flight.
      if (this.step === 'preparing' && !this.invoice && !this.prepareError) this.prepare();
    },

    onHide() {
      this.activationController?.abort();
      this.activationController = null;
      clearTimeout(this.invoiceCopiedTimer);
      clearTimeout(this.receiptCopiedTimer);
      // An invoice that was never paid is not an order — drop it so the ledger
      // stays a list of real commitments. A paid one is left exactly where it
      // is; that is the whole point.
      if (this.orderId && !this.paid) this.ordersStore.discardUnpaid(this.orderId);
      // Tell the shop when the user walks away from something still owed, so
      // it can point them at Your products rather than letting it go quiet.
      if (this.paid && this.order?.state === ORDER_STATE.PAID) {
        this.$emit('backgrounded', this.order);
      }
    },

    async prepare() {
      if (!this.descriptor?.createInvoice) {
        this.prepareError = this.$t('Something went wrong. Please try again.');
        return;
      }
      this.step = 'preparing';
      this.prepareError = null;
      try {
        const inv = await this.descriptor.createInvoice();
        if (!inv?.paymentRequest || (!inv?.paymentHash && !inv?.checkoutId)) {
          throw new Error('no invoice');
        }
        this.invoice = inv;
        this.priceSats = this.decodeSats(inv.paymentRequest);

        // Write the order BEFORE anything payable is shown. From here on there
        // is no state the app can reach in which a payment exists without a
        // record of how to redeem it.
        const fields = this.descriptor.orderFields ? this.descriptor.orderFields(inv) : {};
        const created = this.ordersStore.createOrder({
          kind: this.descriptor.kind,
          title: this.descriptor.title,
          meta: this.descriptor.meta,
          paymentHash: inv.paymentHash || null,
          checkoutId: inv.checkoutId || null,
          paymentRequest: inv.paymentRequest,
          expiresAt: inv.expiresAt || null,
          priceUsd: inv.priceUsd ?? null,
          priceSats: this.priceSats || null,
          ...fields,
        });
        this.orderId = created.id;

        this.step = 'paying';
        // Auto-offer external pay only when no internal wallet can cover it.
        if (this.payableWallets.length === 0) {
          this.showExternalPay = true;
          this.startExternalWait();
        }
      } catch (err) {
        this.prepareError = this.friendlyPrepareError(err);
      }
    },

    /**
     * Turn a create-invoice failure into something a person can act on.
     *
     * The provider's own strings are written for developers ("Access denied",
     * "bundleName does not match slug pricing") and would only make a user
     * wonder what they did wrong. Nothing has been charged at this point, so
     * the useful information is always "what now", not "what broke".
     */
    friendlyPrepareError(err) {
      const code = err?.code || '';
      const status = err?.status;
      if (['unparseable_bundle', 'bundle_slug_mismatch', 'invalid_slug'].includes(code)) {
        return this.$t("This plan isn't available right now. Pick another one.");
      }
      if (this.descriptor?.kind === ORDER_KIND.VPN_EXTEND && status === 404) {
        return this.$t('This VPN has already ended, so it cannot be extended. Buy a new one instead.');
      }
      if (this.descriptor?.kind === ORDER_KIND.ESIM_TOPUP && status && status < 500) {
        return this.$t("This eSIM can't take a top-up. Buy a new one instead.");
      }
      return this.$t("Couldn't reach the store. Check your connection and try again.");
    },

    async copyInvoice() {
      const inv = this.invoice?.paymentRequest;
      if (!inv) return;
      try {
        await navigator.clipboard.writeText(inv);
        this.invoiceCopied = true;
        clearTimeout(this.invoiceCopiedTimer);
        this.invoiceCopiedTimer = setTimeout(() => { this.invoiceCopied = false; }, 1400);
      } catch { /* clipboard denied — QR still works */ }
    },

    async copyReceipt() {
      if (!this.order) return;
      try {
        await writeClipboardCrossPlatform(orderReceiptText(this.order));
        this.receiptCopied = true;
        clearTimeout(this.receiptCopiedTimer);
        this.receiptCopiedTimer = setTimeout(() => { this.receiptCopied = false; }, 1600);
      } catch { /* clipboard denied — the receipt is still on screen to read */ }
    },

    toggleExternalPay() {
      this.showExternalPay = !this.showExternalPay;
      if (this.showExternalPay && !this.waitingExternal && this.step === 'paying') {
        this.startExternalWait();
      } else if (!this.showExternalPay && this.waitingExternal) {
        // Collapsing while a background poll runs: stop it so we don't keep
        // hitting the API for a hidden section.
        this.activationController?.abort();
        this.activationController = null;
        this.waitingExternal = false;
      }
    },

    startExternalWait() {
      this.waitingExternal = true;
      this.runRedeem({ background: true });
    },

    async onPay() {
      if (!this.canPay) return;
      const wallet = this.walletStore.wallets.find((w) => w.id === this.selectedWalletId);
      const provider = this.walletStore.providers?.[this.selectedWalletId];
      if (!wallet || !provider) {
        this.payError = this.$t("That wallet isn't ready. Pick another or pay from another wallet.");
        return;
      }

      this.actionInflight = true;
      this.payError = null;

      // Belt and braces against a double charge: if a previous attempt errored,
      // ask the provider whether that one actually settled before sending
      // anything else. A wallet can report failure on a payment that landed.
      if (this.order?.paymentAttempted) {
        if (await this.probeSettled()) return;
      }

      // Record the attempt BEFORE handing the invoice to the wallet. From this
      // moment the order can no longer be discarded, so dismissing the sheet
      // mid-send, or the app dying mid-send, cannot delete the keys that would
      // redeem a payment we are about to lose sight of.
      this.ordersStore.markPaymentAttempted(this.orderId);

      try {
        const pr = this.invoice.paymentRequest;
        // Mirror the wallet store's cross-wallet transfer branching:
        // NWC takes a bare string; Spark / LNbits take an object.
        if (wallet.type === 'nwc') await provider.sendPayment(pr);
        else await provider.payInvoice({ invoice: pr });
      } catch (err) {
        // The wallet threw. Usually nothing was sent, but an errored-yet-settled
        // timeout is possible — probe settlement before offering a retry, so we
        // never re-pay a settled invoice and never falsely report failure on a
        // payment that landed. Either way the order stays in the ledger.
        if (await this.probeSettled()) return; // moved on; payment had landed
        const msg = err?.message || '';
        this.payError = msg
          ? this.$t('Payment didn’t go through: {msg}', { msg })
          : this.$t('Payment didn’t go through. Try again.');
        this.actionInflight = false;
        return;
      }

      // Payment is on the wire. Record it before fulfilment is even attempted:
      // a crash from here on leaves a recoverable order, not a hole.
      this.ordersStore.markPaid(this.orderId, {
        walletId: wallet.id,
        walletName: wallet.name || '',
        priceSats: this.priceSats,
      });
      this.paid = true;
      this.actionInflight = false;
      this.runRedeem({ background: false });
    },

    /**
     * Single short settlement check (no re-pay). Used before a retry and after
     * a payInvoice error to catch the errored-yet-settled case. Returns true
     * (and moves the sheet on) if the order actually completed.
     */
    async probeSettled() {
      if (!this.order) return false;
      let res = null;
      try {
        res = await redeemOrder(
          { ...this.order, state: ORDER_STATE.PAID },
          { maxMs: PROBE_ATTEMPT_MS },
        );
      } catch {
        res = null;
      }
      if (res?.ok && res.patch) {
        this.ordersStore.markPaid(this.orderId, {
          walletId: this.selectedWalletId,
          priceSats: this.priceSats,
        });
        this.ordersStore.patchOrder(this.orderId, res.patch);
        this.paid = true;
        this.actionInflight = false;
        this.$emit('purchased', this.order);
        this.step = 'success';
        return true;
      }
      return false;
    },

    /** Re-poll fulfilment without re-paying (used after a slow confirmation,
     *  for both internal-paid and external-pay flows). */
    reCheck() {
      this.payError = null;
      this.runRedeem({ background: false });
    },

    /**
     * Redeem the order: poll the provider until the product is handed over.
     * In `background` mode (external pay) we stay on the paying step until it
     * lands; otherwise we show the activating step.
     *
     * Three outcomes, all of them a place the user can act from:
     *   delivered  -> success
     *   not yet    -> back to paying, with "Check again" and the receipt
     *   terminal   -> the problem step, with the receipt and what to do
     */
    async runRedeem({ background = false } = {}) {
      if (!this.order) return;
      if (!background) this.step = 'activating';
      this.actionInflight = background ? this.actionInflight : true;
      // One controller per attempt; closing the sheet aborts it.
      this.activationController?.abort();
      this.activationController = new AbortController();
      const signal = this.activationController.signal;
      const idAtStart = this.orderId;

      let res = null;
      try {
        res = await redeemOrder(this.order, { signal, maxMs: REDEEM_ATTEMPT_MS });
      } catch (err) {
        if (err?.name === 'AbortError') return; // sheet closed — order stays put
        res = { ok: false, error: err?.message || '' };
      }

      // The sheet may have been reset onto a different order while we waited.
      // The ledger still gets its answer; only the UI is skipped.
      const sameOrder = this.orderId === idAtStart;
      if (sameOrder) this.actionInflight = false;

      if (res?.ok && res.patch) {
        // An externally paid invoice never went through markPaid, so stamp the
        // payment time here rather than leaving the receipt without one.
        const patch = this.ordersStore.orderById(idAtStart)?.paidAt
          ? res.patch
          : { ...res.patch, paidAt: Date.now() };
        this.ordersStore.patchOrder(idAtStart, patch);
        if (!sameOrder) return;
        this.paid = true;
        this.waitingExternal = false;
        this.$emit('purchased', this.order);
        this.step = 'success';
        return;
      }

      if (res?.fatal) {
        if (res.patch) this.ordersStore.patchOrder(idAtStart, res.patch);
        this.ordersStore.markFailed(idAtStart, { error: res.error, code: res.code });
        if (!sameOrder) return;
        this.problem = { error: res.error, code: res.code, status: res.status };
        this.waitingExternal = false;
        this.step = 'problem';
        return;
      }

      if (!sameOrder) return;

      // Not settled yet. Don't strand on a spinner: come back to a screen with
      // a receipt and a button. When already paid the calm note carries the
      // state; the red banner is only for the not-yet-paid (external) case.
      this.ordersStore.patchOrder(this.orderId, {
        attempts: (this.order.attempts || 0) + 1,
        lastTriedAt: Date.now(),
      });
      this.step = 'paying';
      this.waitingExternal = false;
      if (!this.paid) {
        this.payError = this.$t('Still waiting for the payment. It will complete as soon as it settles.');
      }
    },
  },
};
</script>

<style scoped>
.shop-sheet {
  width: 100%;
  max-width: 520px;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  overflow: hidden;
  /* var(--safe-bottom), not a bare env(): Android WebViews report
     env(safe-area-inset-bottom) as 0 even with a nav bar, and boot/safe-area.js
     patches the variable to the real inset. */
  padding-bottom: max(16px, var(--safe-bottom, 16px));
  display: flex;
  flex-direction: column;
  max-height: 92vh;
  max-height: 92dvh;
  position: relative;
}

/* Top-of-sheet brand tint, matching the marketplace sheet. */
.shop-sheet::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 220px;
  background: linear-gradient(to bottom, rgba(21, 222, 114, 0.16) 0%, rgba(21, 222, 114, 0.08) 50%, transparent 100%);
  pointer-events: none;
  z-index: 0;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
}
body.body--dark .shop-sheet::before {
  background: linear-gradient(to bottom, rgba(21, 222, 114, 0.26) 0%, rgba(21, 222, 114, 0.12) 50%, transparent 100%);
}
.shop-sheet > * { position: relative; z-index: 1; }

.sheet-handle { display: flex; justify-content: center; padding: 8px 0 4px; flex-shrink: 0; }
.sheet-handle-bar-light, .sheet-handle-bar-dark { width: 36px; height: 4px; border-radius: 999px; display: block; }
.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark { background: rgba(255, 255, 255, 0.22); }

.sheet-header { display: flex; align-items: center; padding: 4px 18px 8px; gap: 8px; flex-shrink: 0; }
.sheet-title { flex: 1 1 auto; font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 600; letter-spacing: -0.005em; }
.sheet-close-btn { flex: 0 0 auto; }

.sheet-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }

.step-body { display: flex; flex-direction: column; gap: 14px; padding: 6px 18px 18px; }
.step-body--centered { justify-content: center; align-items: stretch; min-height: 220px; }

.centered-stage { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px 16px; text-align: center; }
.centered-title { font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 600; letter-spacing: -0.005em; }
.centered-caption { font-family: 'Manrope', sans-serif; font-size: 13px; line-height: 1.45; max-width: 300px; }
.success-check { color: #15a35b; }
body.body--dark .success-check { color: #2bd17f; }
.error-icon { color: #b45309; }
body.body--dark .error-icon { color: #fbbf24; }

/* Summary card */
.summary-card { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; border-radius: 16px; }
.summary-card-light { background: rgba(15, 23, 42, 0.04); box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.06); }
.summary-card-dark { background: rgba(255, 255, 255, 0.04); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
.summary-handle { display: flex; align-items: center; gap: 8px; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; letter-spacing: -0.005em; }
.summary-check { color: #15a35b; flex-shrink: 0; }
.summary-handle-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.summary-meta { font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 500; }
.summary-price { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.summary-price-amount { font-family: 'Manrope', sans-serif; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.summary-price-unit { font-size: 13px; font-weight: 500; }
.summary-price-fiat { font-size: 13px; font-weight: 500; margin-left: 2px; }
.summary-discount { font-size: 12px; font-weight: 600; color: #0e7b3f; background: rgba(21, 222, 114, 0.12); padding: 2px 8px; border-radius: 999px; }
body.body--dark .summary-discount { color: #6ee7a8; background: rgba(21, 222, 114, 0.16); }

/* Pay source */
.pay-source { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-family: 'Manrope', sans-serif; }
.pay-source-label { font-size: 12.5px; font-weight: 600; letter-spacing: -0.005em; }
.pay-source-pill { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 7px 12px; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.pay-source-pill-light { background: rgba(15, 23, 42, 0.05); color: #0f172a; }
.pay-source-pill-dark { background: rgba(255, 255, 255, 0.06); color: #f8fafc; }
.pay-source-pill:active { transform: scale(0.98); }
.pay-source-static { font-size: 13px; font-weight: 500; }
.wallet-menu-list { padding: 4px; min-width: 200px; }
.wallet-menu-list-light { background: #ffffff; }
.wallet-menu-list-dark { background: #1e293b; color: #f8fafc; }

/* Errors */
.pay-error { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 12px; font-family: 'Manrope', sans-serif; font-size: 13px; line-height: 1.4; }
.pay-error-light { background: rgba(239, 68, 68, 0.08); color: #b91c1c; }
.pay-error-dark { background: rgba(239, 68, 68, 0.14); color: #fca5a5; }

/* Paid, awaiting confirmation (calm green, not an error). */
.paid-note { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 12px; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 500; }
.paid-note-light { background: rgba(21, 222, 114, 0.10); color: #0e7b3f; }
.paid-note-dark { background: rgba(21, 222, 114, 0.16); color: #6ee7a8; }

/* "You can close this" reassurance on the activating step. */
.safe-note { display: flex; align-items: flex-start; gap: 8px; padding: 11px 13px; border-radius: 12px; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 500; line-height: 1.45; }
.safe-note-light { background: rgba(15, 23, 42, 0.045); color: #475569; }
.safe-note-dark { background: rgba(255, 255, 255, 0.05); color: #cbd5e1; }
.safe-note :deep(svg) { flex-shrink: 0; margin-top: 1px; }

/* Help row on the problem step */
.help-row { display: flex; align-items: center; gap: 8px; }
.help-row-label { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 600; }

/* External pay */
.external-pay { display: flex; flex-direction: column; gap: 10px; margin-top: 2px; }
.external-pay-toggle { all: unset; display: inline-flex; align-items: center; min-height: 44px; gap: 6px; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 600; letter-spacing: -0.005em; cursor: pointer; align-self: flex-start; -webkit-tap-highlight-color: transparent; }
.invoice-row-wrap { display: flex; align-items: stretch; gap: 8px; }
.invoice-row { flex: 1 1 auto; display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 0; border-radius: 12px; font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace; font-size: 12.5px; cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: left; }
.invoice-row-light { background: rgba(15, 23, 42, 0.05); color: #334155; }
.invoice-row-dark { background: rgba(255, 255, 255, 0.06); color: #cbd5e1; }
.invoice-row-text { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.invoice-row-icon { flex-shrink: 0; opacity: 0.7; }
.qr-icon-btn { border: 0; border-radius: 12px; width: 42px; flex: 0 0 42px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.qr-icon-btn-light { background: rgba(15, 23, 42, 0.05); color: #0f172a; }
.qr-icon-btn-dark { background: rgba(255, 255, 255, 0.06); color: #f8fafc; }
.qr-stage { display: flex; justify-content: center; padding: 10px 0 2px; }
.qr-canvas { width: min(100%, 240px) !important; height: auto !important; border-radius: 12px; }
.external-waiting { display: inline-flex; align-items: center; gap: 8px; font-family: 'Manrope', sans-serif; font-size: 12.5px; }

/* Sticky action bar */
.sheet-actions { flex-shrink: 0; padding: 12px 18px 6px; border-top: 1px solid transparent; }
.sheet-actions-light { border-top-color: rgba(15, 23, 42, 0.06); }
.sheet-actions-dark { border-top-color: rgba(255, 255, 255, 0.06); }
.primary-cta { width: 100%; height: 48px; border-radius: 16px; border: 0; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: filter 0.18s ease, transform 0.1s ease, opacity 0.18s ease; }
.primary-cta:disabled { opacity: 0.45; cursor: default; }
.primary-cta:not(:disabled):hover { filter: brightness(1.05); }
.primary-cta:not(:disabled):active { transform: scale(0.98); }

/* Theme text pairs (scoped per component, per the app convention). */
.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
