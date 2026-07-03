<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :persistent="step === 'activating'"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card
      class="shop-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Drag handle -->
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <!-- Header -->
      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ headerTitle }}
        </div>
        <q-btn
          flat round dense
          :aria-label="$t('Close')"
          class="sheet-close-btn"
          :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          :disable="step === 'activating'"
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
            <span>{{ $t('Paid. Confirming with the provider…') }}</span>
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

          <!-- External pay: collapsed unless no wallet can cover. Keeps the
               purchase alive from another wallet without stranding the user. -->
          <div class="external-pay">
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
        <section v-else-if="step === 'activating'" class="step-body step-body--centered">
          <div class="centered-stage">
            <q-spinner color="grey" size="36px" />
            <div class="centered-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ activatingTitle }}
            </div>
            <div class="centered-caption" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('This is usually quick.') }}
            </div>
          </div>
        </section>

        <!-- ─────────── STEP: success ─────────── -->
        <section v-else-if="step === 'success'" class="step-body">
          <SuccessEsim v-if="receipt && receipt.kind === 'esim'" :receipt="receipt" @done="open = false" />
          <SuccessVpn v-else-if="receipt && receipt.kind === 'vpn'" :receipt="receipt" @done="open = false" />
        </section>
      </div>

      <!-- Sticky action bar. Hidden on success (the success body owns its
           own single primary action). -->
      <div
        v-if="step === 'paying'"
        class="sheet-actions"
        :class="$q.dark.isActive ? 'sheet-actions-dark' : 'sheet-actions-light'"
      >
        <!-- Paid, or external-only (no internal wallet): re-poll, never re-pay. -->
        <button
          v-if="showCheckAgain"
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          @click="reCheck"
        >
          <span>{{ $t('Check again') }}</span>
        </button>
        <button
          v-else
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :disabled="!canPay || actionInflight"
          @click="onPay"
        >
          <q-spinner v-if="actionInflight" size="18px" />
          <span>{{ payLabel }}</span>
        </button>
      </div>

      <!-- Prepare-error retry bar -->
      <div
        v-else-if="step === 'preparing' && prepareError"
        class="sheet-actions"
        :class="$q.dark.isActive ? 'sheet-actions-dark' : 'sheet-actions-light'"
      >
        <button
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          @click="prepare"
        >
          <span>{{ $t('Try again') }}</span>
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
import SuccessEsim from './SuccessEsim.vue';
import SuccessVpn from './SuccessVpn.vue';

const INVOICE_TRUNCATE_HEAD = 16;
const INVOICE_TRUNCATE_TAIL = 8;

/**
 * Generic purchase sheet for the nadanada shop. Product-agnostic: it is
 * driven entirely by a `descriptor` so eSIM and VPN share one payment
 * surface (the affiliate, fees, and earnings are invisible — there is only
 * a single all-in sats price).
 *
 * Descriptor contract:
 *   {
 *     kind: 'esim' | 'vpn',
 *     title: string,          // summary line 1, e.g. "🇯🇵 Japan"
 *     meta: string,           // summary line 2, e.g. "5 GB · 30 days"
 *     createInvoice: async () => ({
 *       paymentRequest, paymentHash, priceUsd?, originalPriceUsd?, ctx?
 *     }),
 *     fulfill: async ({ paymentHash, signal, ctx }) => ({ ok, receipt }),
 *       // receipt is the persisted record + what the success body renders;
 *       // it MUST carry `kind`.
 *   }
 *
 * Reuses the proven internal-payment pattern from Nip05MarketplaceSheet:
 * `payableWallets` (connected + can cover, active first), the pay branching
 * (nwc -> sendPayment, else payInvoice), and an Abortable activation poll.
 */
export default {
  name: 'PurchaseSheet',
  components: { Icon, VueQrcode, SuccessEsim, SuccessVpn },

  props: {
    modelValue: { type: Boolean, default: false },
    descriptor: { type: Object, default: null },
  },

  emits: ['update:modelValue', 'purchased'],

  setup() {
    const walletStore = useWalletStore();
    return { walletStore };
  },

  data() {
    return {
      step: 'preparing',
      invoice: null,            // { paymentRequest, paymentHash, priceUsd, originalPriceUsd, ctx }
      priceSats: null,
      prepareError: null,
      payError: null,
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
      waitingExternal: false,
      activationController: null,
      receipt: null,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    headerTitle() {
      switch (this.step) {
        case 'activating': return this.$t('Almost there');
        case 'success': return this.$t('Success');
        default: return this.$t('Confirm purchase');
      }
    },

    kindIcon() {
      return this.descriptor?.kind === 'vpn' ? 'tabler:shield-lock' : 'tabler:world';
    },

    activatingTitle() {
      return this.descriptor?.kind === 'vpn'
        ? this.$t('Building your VPN config…')
        : this.$t('Getting your eSIM ready…');
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
      this.step = 'preparing';
      this.invoice = null;
      this.priceSats = null;
      this.prepareError = null;
      this.payError = null;
      this.selectedWalletId = this.walletStore.activeWalletId || null;
      this.walletMenuOpen = false;
      this.actionInflight = false;
      this.showExternalPay = false;
      this.qrExpanded = false;
      this.invoiceCopied = false;
      this.waitingExternal = false;
      this.paid = false;
      this.receipt = null;
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
        if (!inv?.paymentRequest || !inv?.paymentHash) {
          throw new Error('no invoice');
        }
        this.invoice = inv;
        this.priceSats = this.decodeSats(inv.paymentRequest);
        this.step = 'paying';
        // Auto-offer external pay only when no internal wallet can cover it.
        if (this.payableWallets.length === 0) {
          this.showExternalPay = true;
          this.startExternalWait();
        }
      } catch (err) {
        this.prepareError = err?.message && err.message !== 'no invoice'
          ? err.message
          : this.$t("Couldn't reach the store. Check your connection and try again.");
      }
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
      this.runFulfill({ background: true });
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
      try {
        const pr = this.invoice.paymentRequest;
        // Mirror the wallet store's cross-wallet transfer branching:
        // NWC takes a bare string; Spark / LNbits take an object.
        if (wallet.type === 'nwc') await provider.sendPayment(pr);
        else await provider.payInvoice({ invoice: pr });
      } catch (err) {
        // payInvoice threw. Usually nothing was sent (no route / insufficient
        // balance), but an errored-yet-settled timeout is possible — probe
        // settlement ONCE before offering a retry, so we never re-pay a settled
        // invoice and never falsely report failure on a payment that landed.
        if (await this.probeSettled()) return; // moved to success
        const msg = err?.message || '';
        this.payError = msg
          ? this.$t('Payment didn’t go through: {msg}', { msg })
          : this.$t('Payment didn’t go through. Your balance was not charged. Try again.');
        this.actionInflight = false;
        return;
      }
      // Payment is on the wire. From here we never re-pay this invoice; if
      // confirmation is slow the user re-polls via "Check again".
      this.paid = true;
      this.actionInflight = false;
      this.runFulfill({ background: false });
    },

    /**
     * Single-shot settlement check (no re-pay). Used after a payInvoice error
     * to catch the errored-yet-settled case. Returns true (and transitions to
     * success) if the purchase actually settled, false otherwise.
     */
    async probeSettled() {
      if (!this.descriptor?.probeSettled || !this.invoice) return false;
      let res = null;
      try {
        res = await this.descriptor.probeSettled({ paymentHash: this.invoice.paymentHash });
      } catch {
        res = null;
      }
      if (res && res.ok && res.receipt) {
        this.paid = true;
        this.receipt = res.receipt;
        this.actionInflight = false;
        this.$emit('purchased', res.receipt);
        this.step = 'success';
        return true;
      }
      return false;
    },

    /** Re-poll fulfilment without re-paying (used after a slow confirmation,
     *  for both internal-paid and external-pay flows). */
    reCheck() {
      this.payError = null;
      this.runFulfill({ background: false });
    },

    /**
     * Poll the product fulfilment (eSIM provisioning / VPN config) until the
     * payment settles server-side. In `background` mode (external pay) we
     * stay on the paying step until it lands; otherwise we show the
     * activating step.
     */
    async runFulfill({ background = false } = {}) {
      if (!this.invoice) return;
      if (!background) this.step = 'activating';
      // One controller per fulfilment; closing the sheet aborts it.
      this.activationController?.abort();
      this.activationController = new AbortController();

      let res = null;
      try {
        res = await this.descriptor.fulfill({
          paymentHash: this.invoice.paymentHash,
          signal: this.activationController.signal,
          expiresAt: this.invoice.expiresAt,
          ctx: this.invoice.ctx,
        });
      } catch (err) {
        if (err?.name === 'AbortError') return; // sheet closed
      }

      if (!res || res.ok === false || !res.receipt) {
        // Cap hit without settlement. Don't strand on a spinner. When already
        // paid, the calm "confirming" note + "Check again" convey the state;
        // the red banner is only for the not-yet-paid (external) case.
        this.step = 'paying';
        this.waitingExternal = false;
        if (!this.paid) {
          this.payError = this.$t('Still waiting for the payment. It will complete as soon as it settles.');
        }
        return;
      }

      this.receipt = res.receipt;
      this.waitingExternal = false;
      this.$emit('purchased', res.receipt);
      this.step = 'success';
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
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
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
.centered-caption { font-family: 'Manrope', sans-serif; font-size: 13px; line-height: 1.45; max-width: 280px; }
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

/* External pay */
.external-pay { display: flex; flex-direction: column; gap: 10px; margin-top: 2px; }
.external-pay-toggle { all: unset; display: inline-flex; align-items: center; gap: 6px; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 600; letter-spacing: -0.005em; cursor: pointer; align-self: flex-start; -webkit-tap-highlight-color: transparent; }
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
