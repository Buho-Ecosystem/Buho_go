<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :persistent="step !== 'browse'"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card
      class="market-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Drag handle -->
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <!-- Header: title (step-aware) + close -->
      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ headerTitle }}
        </div>
        <q-btn
          flat
          round
          dense
          :aria-label="$t('Close')"
          class="sheet-close-btn"
          :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          :disable="step === 'activating'"
          @click="open = false"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <!-- Scrollable body. Each step renders into the same shell so the
           sheet height feels intentional rather than jumping. -->
      <div class="sheet-scroll">
        <!-- ─────────── STEP: browse ─────────── -->
        <section v-if="step === 'browse'" class="step-body">
          <!-- Hero zone — editorial composition. The live name itself is
               the focal point in large display type; status + price sit
               quietly beneath as metadata. The benefit footnote at the
               bottom states the use case without leaning on marketing
               headline patterns. -->
          <header class="mkt-hero">
            <div
              class="mkt-hero-address"
              :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
            >
              <span
                class="mkt-hero-name"
                :class="{ 'mkt-hero-name--placeholder': isPlaceholderName }"
              >{{ previewName }}</span><span
                class="mkt-hero-suffix"
                :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
              >@{{ domain }}</span>
            </div>
            <div
              class="mkt-hero-status"
              :class="statusToneClass"
              aria-live="polite"
            >
              <q-spinner v-if="searchInflight" size="13px" />
              <Icon v-else-if="statusIcon" :icon="statusIcon" width="14" height="14" />
              <span>{{ statusText }}</span>
            </div>
            <p
              class="mkt-hero-footnote"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            >
              {{ $t('Used to find you across apps, and to pay you inside BuhoGO.') }}
            </p>
          </header>

          <!-- Name input. Functional affordance below the preview. -->
          <label class="field">
            <div
              class="name-input-wrap"
              :class="[
                $q.dark.isActive ? 'field-input-wrap-dark' : 'field-input-wrap-light',
                { 'field-input-wrap--error': hasLocalError },
              ]"
            >
              <input
                ref="nameInputEl"
                v-model="nameInput"
                type="text"
                :placeholder="$t('your-name')"
                spellcheck="false"
                autocomplete="off"
                autocapitalize="none"
                maxlength="63"
                class="field-input name-input"
                :class="$q.dark.isActive ? 'field-input-dark' : 'field-input-light'"
                @input="onNameInput"
              />
              <span
                class="name-suffix"
                :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
              >@{{ domain }}</span>
            </div>
          </label>

          <!-- Free-fallback chip — appears when the typed name is taken
               and the server has a `.NNNNNN` suggestion ready. One tap
               and the user grabs that free variant instead. -->
          <button
            v-if="freeFallbackHandle"
            type="button"
            class="free-chip"
            :class="$q.dark.isActive ? 'free-chip-dark' : 'free-chip-light'"
            @click="adoptFreeFallback"
          >
            <Icon icon="tabler:sparkles" width="14" height="14" />
            <span>{{ $t('Take {handle} for free', { handle: freeFallbackHandle }) }}</span>
          </button>
        </section>

        <!-- ─────────── STEP: paying ─────────── -->
        <section v-else-if="step === 'paying'" class="step-body">
          <!-- Summary card -->
          <div
            class="summary-card"
            :class="$q.dark.isActive ? 'summary-card-dark' : 'summary-card-light'"
          >
            <div class="summary-handle">
              <Icon icon="tabler:rosette-discount-check" width="18" height="18" class="summary-check" />
              <span class="summary-handle-text">{{ invoice?.handle }}@{{ domain }}</span>
            </div>
            <div class="summary-price">
              <span class="summary-price-amount">{{ formatSats(priceSats) }}</span>
              <span class="summary-price-unit" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
                {{ $t('sats') }}
              </span>
            </div>
          </div>

          <!-- Pay source picker. Compact: single row when one ready
               wallet, dropdown when more. Picking here only scopes the
               payment — the global active wallet is left alone, so no
               background re-init or NWC handshake is triggered. -->
          <div class="pay-source">
            <span
              class="pay-source-label"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            >
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
              <Icon icon="tabler:chevron-down" width="14" height="14" class="pay-source-chev" />
              <q-menu v-model="walletMenuOpen" anchor="bottom right" self="top right" :offset="[0, 6]">
                <q-list class="wallet-menu-list" :class="$q.dark.isActive ? 'wallet-menu-list-dark' : 'wallet-menu-list-light'">
                  <q-item
                    v-for="w in payableWallets"
                    :key="w.id"
                    clickable
                    v-close-popup
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
              v-else-if="payableWallets.length === 1"
              class="pay-source-static"
              :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
            >
              {{ payableWallets[0].name }}
              <span class="pay-source-balance" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
                · {{ formatSats(payableWallets[0].balance) }} {{ $t('sats') }}
              </span>
            </span>
            <span
              v-else
              class="pay-source-static"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
            >
              {{ $t('No wallet can cover this. Pay externally below.') }}
            </span>
          </div>

          <!-- Pay error banner (inline, replaces nothing) -->
          <div
            v-if="payError"
            class="pay-error"
            :class="$q.dark.isActive ? 'pay-error-dark' : 'pay-error-light'"
            role="alert"
          >
            <Icon icon="tabler:alert-circle" width="16" height="16" />
            <span>{{ payError }}</span>
          </div>

          <!-- External-pay disclosure: collapsed by default. Compact row
               with truncated bolt11, QR-expand affordance, and tap-to-
               copy. Power users / shared devices can scan from another
               wallet here. -->
          <div class="external-pay">
            <button
              type="button"
              class="external-pay-toggle"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
              @click="showExternalPay = !showExternalPay"
            >
              <Icon
                :icon="showExternalPay ? 'tabler:chevron-up' : 'tabler:chevron-down'"
                width="14"
                height="14"
              />
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
                <span class="invoice-row-text">
                  {{ truncatedInvoice }}
                </span>
                <Icon
                  :icon="invoiceCopied ? 'tabler:check' : 'tabler:copy'"
                  width="14"
                  height="14"
                  class="invoice-row-icon"
                />
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
              <vue-qrcode
                v-if="invoice?.invoice"
                :value="invoice.invoice.toUpperCase()"
                :options="qrOptions"
                class="qr-canvas"
              />
            </div>
          </div>
        </section>

        <!-- ─────────── STEP: activating ─────────── -->
        <section v-else-if="step === 'activating'" class="step-body step-body--centered">
          <div class="centered-stage">
            <q-spinner color="grey" size="36px" />
            <div class="centered-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Activating your handle…') }}
            </div>
            <div class="centered-caption" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('Waiting for the payment to settle. This is usually quick.') }}
            </div>
          </div>
        </section>

        <!-- ─────────── STEP: success ─────────── -->
        <section v-else-if="step === 'success'" class="step-body step-body--centered">
          <div class="centered-stage">
            <div class="success-check">
              <Icon icon="tabler:rosette-discount-check" width="48" height="48" />
            </div>
            <div class="centered-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Yours.') }}
            </div>
            <div class="centered-address" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ purchasedAddress }}
            </div>
            <!-- Renewal feature disabled — extension doesn't enforce
                 expiry. When the upstream gains a renewal endpoint,
                 uncomment this paragraph and the computeds it relies on.
            <p
              v-if="ownershipLine"
              class="centered-caption"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
            >
              {{ ownershipLine }}
            </p>
            -->
          </div>
        </section>
      </div>

      <!-- Sticky action bar. The label + handler change per step. -->
      <div
        class="sheet-actions"
        :class="$q.dark.isActive ? 'sheet-actions-dark' : 'sheet-actions-light'"
      >
        <!-- browse: Continue -->
        <button
          v-if="step === 'browse'"
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :disabled="!canContinue || actionInflight"
          @click="onContinue"
        >
          <q-spinner v-if="actionInflight" size="18px" />
          <span>{{ continueLabel }}</span>
        </button>

        <!-- paying: Pay -->
        <button
          v-if="step === 'paying'"
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :disabled="!canPay || actionInflight"
          @click="onPay"
        >
          <q-spinner v-if="actionInflight" size="18px" />
          <span>{{ payLabel }}</span>
        </button>

        <!-- success: Done -->
        <button
          v-if="step === 'success'"
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          @click="open = false"
        >
          <span>{{ $t('Done') }}</span>
        </button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { useIdentityStore } from '../stores/identity';
import { useProfileStore } from '../stores/profile';
import { useWalletStore } from '../stores/wallet';
import {
  NIP05_DOMAIN,
  deriveNameSlug,
  isLikelyAvailableLocalPart,
  searchHandle,
  registerFreeHandle,
  registerExactFreeHandle,
  requestPaidHandle,
  waitForActivation,
} from '../services/nip05';

const SEARCH_DEBOUNCE_MS = 350;
const SUCCESS_AUTO_CLOSE_MS = 2500;
const INVOICE_TRUNCATE_HEAD = 16;
const INVOICE_TRUNCATE_TAIL = 8;

export default {
  name: 'Nip05MarketplaceSheet',

  components: { Icon, VueQrcode },

  props: {
    modelValue: { type: Boolean, default: false },
  },

  emits: ['update:modelValue', 'purchased'],

  setup() {
    const identity = useIdentityStore();
    const profile = useProfileStore();
    const walletStore = useWalletStore();
    return { identity, profile, walletStore };
  },

  data() {
    return {
      // Step machine — single source of truth for the visible content,
      // sticky-bar handler, and persistent-close behaviour. See computeds
      // headerTitle / continueLabel / payLabel for the per-step labels.
      step: 'browse',

      // ── browse step ──
      nameInput: '',
      // The search runs against this debounced value, not `nameInput`,
      // so we don't fire one request per keystroke.
      nameInputDebounced: '',
      searchInflight: false,
      searchResult: null,           // { available, priceSats, freeIdentifierNumber, ... }
      searchError: null,            // 'network' | 'server' | null
      lastSearchAt: 0,

      // ── paying step ──
      invoice: null,                // { handle, invoice, paymentHash, addressId, rotationSecret }
      // Whether the next-step purchase is a free `.NNNNNN` handle (skips
      // the invoice flow entirely) or a paid premium name.
      pendingIsFree: false,
      selectedWalletId: null,
      walletMenuOpen: false,
      payError: null,
      showExternalPay: false,
      qrExpanded: false,
      invoiceCopied: false,

      // ── activating + success ──
      purchasedAddress: '',
      // Renewal feature disabled — extension doesn't enforce expiry.
      // purchasedExpiresAt: null,

      // ── lifecycle ──
      // True whenever an async action is in flight from the sticky CTA
      // (search-then-create, pay-then-poll, etc.). Disables the button so
      // the user can't double-tap their way into a duplicate registration.
      actionInflight: false,

      // The poll abort handle so closing the sheet during activation can
      // stop the network traffic and any unhandled rejections.
      activationController: null,

      // Debounce + auto-close timers (cleared on hide).
      debounceTimer: null,
      successTimer: null,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    domain() { return NIP05_DOMAIN; },

    headerTitle() {
      switch (this.step) {
        case 'paying':     return this.$t('Confirm purchase');
        case 'activating': return this.$t('Activating');
        case 'success':    return this.$t('Success');
        default:           return this.$t('Choose a name');
      }
    },

    // QR rendering options. Cohesive with ProfileShareSheet's profile QR
    // so the visual language across our QR surfaces matches.
    qrOptions() {
      const dark = this.$q.dark.isActive;
      return {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 6,
        color: {
          dark: dark ? '#f8fafc' : '#0f172a',
          light: dark ? '#0b0f17' : '#ffffff',
        },
      };
    },

    /** Result of the client-side shape check on the current input. */
    localValidation() {
      return isLikelyAvailableLocalPart(this.nameInput);
    },

    hasLocalError() {
      if (!this.nameInput) return false;
      return !this.localValidation.ok;
    },

    /**
     * The "live status" tone under the input — drives icon + colour.
     * Order matters: local input errors take priority over server results
     * so the user sees a fixable hint before any network noise.
     */
    statusToneClass() {
      if (this.searchInflight) return 'status-row--muted';
      if (this.hasLocalError) return 'status-row--warn';
      if (!this.nameInput) return 'status-row--muted';
      if (this.searchError) return 'status-row--warn';
      if (!this.searchResult) return 'status-row--muted';
      return this.searchResult.available ? 'status-row--ok' : 'status-row--warn';
    },

    /** Live `<name>@mybuho.de` preview — the user's typed input or a
     *  faded placeholder while the field is empty. */
    previewName() {
      return this.nameInput.trim().toLowerCase() || this.$t('your-name');
    },

    /** True iff the preview is showing the placeholder text rather than
     *  what the user actually typed. Drives the muted weight on the
     *  hero name so the placeholder doesn't compete with real input. */
    isPlaceholderName() {
      return !this.nameInput.trim();
    },

    /** Icon shown in the preview card's tinted chip. Switches between
     *  states (sparkle when empty, check when available, alert when
     *  taken/error) so the chip visually carries the result alongside
     *  the status pill below. */
    previewIcon() {
      if (this.searchInflight) return 'tabler:loader-2';
      if (this.hasLocalError) return 'tabler:alert-triangle';
      if (!this.nameInput) return 'tabler:sparkles';
      if (this.searchError) return 'tabler:cloud-off';
      if (!this.searchResult) return 'tabler:sparkles';
      return this.searchResult.available
        ? 'tabler:rosette-discount-check-filled'
        : 'tabler:x';
    },

    previewIconToneClass() {
      if (this.searchInflight) return 'preview-icon--muted';
      if (this.hasLocalError || this.searchError) return 'preview-icon--warn';
      if (!this.nameInput || !this.searchResult) return 'preview-icon--muted';
      return this.searchResult.available
        ? 'preview-icon--ok'
        : 'preview-icon--warn';
    },

    statusIcon() {
      if (this.searchInflight) return '';
      if (this.hasLocalError) return 'tabler:alert-circle';
      if (!this.nameInput) return 'tabler:circle-dashed';
      if (this.searchError) return 'tabler:cloud-off';
      if (!this.searchResult) return 'tabler:circle-dashed';
      return this.searchResult.available ? 'tabler:circle-check' : 'tabler:circle-x';
    },

    statusText() {
      if (this.searchInflight) return this.$t('Checking…');
      if (!this.nameInput) return this.$t('Type a name to check availability.');
      if (this.hasLocalError) return this.localErrorMessage;
      if (this.searchError) return this.$t("Couldn't reach the name server. Try again.");
      if (!this.searchResult) return this.$t('Type a name to check availability.');
      if (!this.searchResult.available) return this.$t('Taken. Pick another name.');
      const price = this.searchResult.priceSats;
      if (!price) return this.$t('Available.');
      return this.$t('Available · {sats} sats', { sats: this.formatSats(price) });
    },

    localErrorMessage() {
      switch (this.localValidation.reason) {
        case 'too-short':     return this.$t('At least 2 characters.');
        case 'too-long':      return this.$t('Too long. Keep it under 64 characters.');
        case 'invalid-chars': return this.$t('Letters, numbers, dot, hyphen and underscore only.');
        default:              return this.$t('Pick a valid name.');
      }
    },

    /**
     * When the typed name is taken and the server included a `.NNNNNN`
     * suggestion, surface it as a one-tap free fallback. Returns the full
     * local part the user would adopt (e.g. `satoshi.482913`) or null.
     */
    freeFallbackHandle() {
      const r = this.searchResult;
      if (!r || r.available) return null;
      if (!r.freeIdentifierNumber) return null;
      const base = this.nameInput.trim().toLowerCase();
      if (!base) return null;
      return `${base}.${r.freeIdentifierNumber}`;
    },

    canContinue() {
      if (!this.nameInput || this.hasLocalError) return false;
      if (this.searchInflight) return false;
      if (!this.searchResult) return false;
      return this.searchResult.available;
    },

    continueLabel() {
      if (!this.searchResult || !this.searchResult.available) return this.$t('Continue');
      const price = this.searchResult.priceSats;
      if (!price) return this.$t('Add free name');
      return this.$t('Buy · {sats} sats', { sats: this.formatSats(price) });
    },

    priceSats() {
      return this.searchResult?.priceSats ?? null;
    },

    /**
     * Wallets that can actually pay this invoice right now. A wallet is
     * "payable" iff:
     *   - it has a connected provider (no NWC handshake needed)
     *   - it has enough balance to cover the price + a tiny fee buffer
     * This is what makes "smart switching" safe — we never offer a wallet
     * whose activation might fail in the background.
     */
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
      // The current active wallet floats to the top so the default pick
      // matches the user's expectation when they tap "Pay" without
      // touching the picker.
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
      if (!this.invoice) return false;
      if (this.payableWallets.length === 0) return false;
      if (!this.selectedWalletId) return false;
      return true;
    },

    payLabel() {
      const price = this.priceSats;
      if (!price) return this.$t('Pay');
      return this.$t('Pay · {sats} sats', { sats: this.formatSats(price) });
    },

    truncatedInvoice() {
      const inv = this.invoice?.invoice;
      if (!inv) return '';
      if (inv.length <= INVOICE_TRUNCATE_HEAD + INVOICE_TRUNCATE_TAIL + 1) return inv;
      return `${inv.slice(0, INVOICE_TRUNCATE_HEAD)}…${inv.slice(-INVOICE_TRUNCATE_TAIL)}`;
    },

    /* Renewal feature disabled — extension doesn't enforce expiry.
    ownershipLine() {
      if (!Number.isFinite(this.purchasedExpiresAt)) return '';
      const date = this.formatLongDate(this.purchasedExpiresAt);
      if (!date) return '';
      return this.$t("Yours for one year. Renew before {date} to keep it.", { date });
    },
    */
  },

  watch: {
    /**
     * Reset everything when the parent toggles the sheet open. We reset
     * here instead of in `mounted()` because the sheet is kept mounted
     * across opens by Quasar — without this, a second-time-open would
     * land on whatever state the previous flow last touched.
     */
    open(isOpen) {
      if (isOpen) this.resetForNewSession();
    },
  },

  beforeUnmount() {
    this.clearTimers();
    this.activationController?.abort();
  },

  methods: {
    formatSats(n) {
      if (n == null || !Number.isFinite(n)) return '';
      try {
        return new Intl.NumberFormat(this.$i18n?.locale || undefined).format(n);
      } catch {
        return String(n);
      }
    },

    /* Renewal feature disabled — extension doesn't enforce expiry.
    formatLongDate(ms) {
      if (!Number.isFinite(ms)) return '';
      try {
        return new Intl.DateTimeFormat(this.$i18n?.locale || undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).format(new Date(ms));
      } catch {
        return new Date(ms).toDateString();
      }
    },
    */

    onShow() {
      this.resetForNewSession();
      // Focus the input once the slide-in finishes so the keyboard rises
      // alongside the sheet rather than fighting the transition.
      this.$nextTick(() => {
        setTimeout(() => this.$refs.nameInputEl?.focus(), 80);
      });
    },

    onHide() {
      this.clearTimers();
      this.activationController?.abort();
      this.activationController = null;
    },

    resetForNewSession() {
      this.step = 'browse';
      this.searchInflight = false;
      this.searchResult = null;
      this.searchError = null;
      this.invoice = null;
      this.pendingIsFree = false;
      this.payError = null;
      this.showExternalPay = false;
      this.qrExpanded = false;
      this.invoiceCopied = false;
      this.actionInflight = false;
      this.purchasedAddress = '';
      this.walletMenuOpen = false;
      this.selectedWalletId = this.walletStore.activeWalletId || null;
      // Pre-fill the name input with a slugified guess from the profile name
      // so the user can hit Continue immediately if they like it. When there's
      // no real name yet, `deriveNameSlug` returns '' and we leave the field
      // blank — the memorable free-handle fallback is intentionally NOT
      // suggested here, since this picker is for a self-chosen (premium) name.
      this.nameInput = deriveNameSlug({
        name: this.profile.displayName || this.profile.name,
      });
      this.nameInputDebounced = this.nameInput;
      if (this.nameInput && this.localValidation.ok) {
        // Kick off the first search so the CTA can light up without
        // requiring the user to bump the field.
        this.runSearch(this.nameInput);
      }
    },

    clearTimers() {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      if (this.successTimer) {
        clearTimeout(this.successTimer);
        this.successTimer = null;
      }
    },

    onNameInput() {
      // Always reset the previous search context — the result no longer
      // matches what's in the input.
      this.searchResult = null;
      this.searchError = null;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      const value = this.nameInput.trim().toLowerCase();
      if (!value || !this.localValidation.ok) return;
      this.debounceTimer = setTimeout(() => this.runSearch(value), SEARCH_DEBOUNCE_MS);
    },

    async runSearch(query) {
      const stamp = ++this.lastSearchAt;
      this.searchInflight = true;
      this.searchError = null;
      try {
        const res = await searchHandle({ query });
        // A later keystroke already raced past this one — drop the result.
        if (stamp !== this.lastSearchAt) return;
        this.searchResult = res;
      } catch {
        if (stamp !== this.lastSearchAt) return;
        this.searchError = 'network';
      } finally {
        if (stamp === this.lastSearchAt) this.searchInflight = false;
      }
    },

    adoptFreeFallback() {
      const handle = this.freeFallbackHandle;
      if (!handle) return;
      // Fill the input with the free variant. The user can still edit
      // before tapping Continue — but the common case is one tap.
      this.nameInput = handle;
      this.nameInputDebounced = handle;
      // Drop the previous "taken" result and surface a synthetic
      // "available — free" so the CTA enables without a server round-trip.
      this.searchResult = {
        identifier: handle,
        available: true,
        priceSats: null,
        currency: null,
        freeIdentifierNumber: null,
        raw: {},
      };
    },

    async onContinue() {
      if (!this.canContinue) return;
      const pubkeyHex = this.identity.nostrPubkeyHex;
      if (!pubkeyHex) {
        // Should be impossible (the marketplace is only reachable from a
        // bootstrapped profile), but defend against it so a corrupted
        // boot order doesn't silently mis-bind a handle to no key.
        this.payError = this.$t('Identity not ready. Try again in a moment.');
        return;
      }

      this.actionInflight = true;
      try {
        const wantsFree = !this.searchResult?.priceSats;
        if (wantsFree) {
          // Free path: register straight away, skip paying entirely.
          // Some users land here from the "Take <name>.NNNNNN for free"
          // chip; others typed a `.NNNNNN` shape themselves and the
          // server confirmed availability with no price.
          const localPart = this.nameInput.trim().toLowerCase();
          let result;
          try {
            // Two free shapes converge here:
            //   1. The user adopted the "<base>.NNNNNN" fallback chip, so
            //      the exact suffix matters — preserve it.
            //   2. The user typed a base name that came back priceless
            //      (rare; would only happen if the server returns a
            //      no-charge tier for something base-shaped). Defer to
            //      `registerFreeHandle` so a fresh suffix is generated.
            if (/\.\d{6}$/.test(localPart)) {
              result = await registerExactFreeHandle({ localPart, pubkeyHex });
            } else {
              result = await registerFreeHandle({ baseSlug: localPart, pubkeyHex });
            }
          } catch {
            this.payError = this.$t("That name couldn't be created. Try a different one.");
            return;
          }
          this.commitPurchase({
            handle: result.handle,
            rotationSecret: result.rotationSecret,
            addressId: result.addressId,
            isFree: true,
            // Renewal feature disabled — extension doesn't enforce expiry.
            // expiresAt: result.expiresAt,
          });
          return;
        }

        // Paid path: ask the extension for an invoice.
        const localPart = this.nameInput.trim().toLowerCase();
        try {
          this.invoice = await requestPaidHandle({ localPart, pubkeyHex });
        } catch (err) {
          if (err?.status === 409 || err?.status === 400) {
            this.payError = this.$t('That name was just taken. Pick another.');
          } else {
            this.payError = this.$t("Couldn't create the invoice. Try again.");
          }
          return;
        }
        this.pendingIsFree = false;
        this.payError = null;
        this.step = 'paying';
      } finally {
        this.actionInflight = false;
      }
    },

    async copyInvoice() {
      const inv = this.invoice?.invoice;
      if (!inv) return;
      try {
        await navigator.clipboard.writeText(inv);
        this.invoiceCopied = true;
        setTimeout(() => { this.invoiceCopied = false; }, 1400);
      } catch {
        // Clipboard denied — fall back silently; the QR is still usable.
      }
    },

    async onPay() {
      if (!this.canPay) return;
      const wallet = this.walletStore.wallets.find((w) => w.id === this.selectedWalletId);
      const provider = this.walletStore.providers?.[this.selectedWalletId];
      if (!wallet || !provider) {
        this.payError = this.$t("Selected wallet isn't ready. Pick another or pay externally.");
        return;
      }

      this.actionInflight = true;
      this.payError = null;
      try {
        const invoiceStr = this.invoice.invoice;
        // Same shape branching the wallet store uses for cross-wallet
        // transfers: NWC providers take a bare string; Spark / LNbits
        // take an object. Mirroring `wallet.js:2223-2228`.
        if (wallet.type === 'nwc') {
          await provider.sendPayment(invoiceStr);
        } else {
          await provider.payInvoice({ invoice: invoiceStr });
        }
      } catch (err) {
        const msg = err?.message || '';
        this.payError = msg
          ? this.$t('Payment failed: {msg}', { msg })
          : this.$t('Payment failed. Try again or pay externally.');
        this.actionInflight = false;
        return;
      }

      // Payment is on the wire; switch to the activating step and let
      // the poller confirm server-side activation. We surface the
      // success state from there.
      this.step = 'activating';
      this.actionInflight = false;
      this.runActivationPoll();
    },

    async runActivationPoll() {
      this.activationController = new AbortController();
      let paid = false;
      try {
        const r = await waitForActivation({
          paymentHash: this.invoice.paymentHash,
          signal: this.activationController.signal,
        });
        paid = r.paid;
      } catch (err) {
        if (err?.name === 'AbortError') return; // sheet closed
      }

      if (!paid) {
        // Polling cap hit without confirmation. The payment may still
        // settle — the server-side webhook activates whenever the
        // invoice actually pays — but we shouldn't leave the user
        // staring at a spinner. Drop back to paying with a hint.
        this.step = 'paying';
        this.payError = this.$t('Still waiting for the payment. The name will activate as soon as it settles.');
        return;
      }

      this.commitPurchase({
        handle: this.invoice.handle,
        rotationSecret: this.invoice.rotationSecret,
        addressId: this.invoice.addressId,
        isFree: false,
        // Renewal feature disabled — extension doesn't enforce expiry.
        // expiresAt: this.invoice.expiresAt,
      });
    },

    /**
     * Persist the purchased handle, promote it to active so the user
     * immediately sees their choice as their primary, and surface the
     * success state. Emits `purchased` so the editor can refresh its
     * Identity section without polling the store.
     */
    commitPurchase({ handle, rotationSecret, addressId, isFree /* , expiresAt */ }) {
      this.identity.addNip05Handle({ handle, rotationSecret, addressId, isFree /* , expiresAt */ });
      this.identity.setActiveNip05(handle);
      this.profile.adoptNip05(this.identity.nip05Address);
      this.purchasedAddress = this.identity.nip05Address || `${handle}@${this.domain}`;
      // Renewal feature disabled — extension doesn't enforce expiry.
      // this.purchasedExpiresAt = Number.isFinite(expiresAt) ? expiresAt : null;
      this.$emit('purchased', { handle, isFree: !!isFree });
      this.step = 'success';
      this.successTimer = setTimeout(() => { this.open = false; }, SUCCESS_AUTO_CLOSE_MS);
    },
  },
};
</script>

<style scoped>
.market-sheet {
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
  max-height: 90vh;
  max-height: 90dvh;
}

.sheet-handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
  flex-shrink: 0;
}

.sheet-handle-bar-light,
.sheet-handle-bar-dark {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  display: block;
}

.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark  { background: rgba(255, 255, 255, 0.22); }

.sheet-header {
  display: flex;
  align-items: center;
  padding: 4px 18px 8px;
  gap: 8px;
  flex-shrink: 0;
}

.sheet-title {
  flex: 1 1 auto;
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.sheet-close-btn { flex: 0 0 auto; }

.sheet-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

/* ---------- Top-of-sheet tinted hero zone ----------
   Same gradient-overlay pattern as the editor sheet: a soft brand-
   green wash painted via ::before on the sheet card, fading from the
   top. The header + marketplace hero block both sit on the tint so
   the whole top of the sheet reads as one continuous hero zone (no
   more thin banner strip). */
.market-sheet {
  position: relative;
}

.market-sheet::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 280px;
  background: linear-gradient(
    to bottom,
    rgba(21, 222, 114, 0.18) 0%,
    rgba(21, 222, 114, 0.10) 50%,
    transparent 100%
  );
  pointer-events: none;
  z-index: 0;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
}

body.body--dark .market-sheet::before {
  background: linear-gradient(
    to bottom,
    rgba(21, 222, 114, 0.28) 0%,
    rgba(21, 222, 114, 0.14) 50%,
    transparent 100%
  );
}

.market-sheet > * {
  position: relative;
  z-index: 1;
}

/* ---------- Editorial hero ----------
   The live `<name>@mybuho.de` is the focal point in display type.
   Status + price sit quietly underneath as metadata, then a single
   benefit footnote states the use case. No badges, no glow, no
   marketing headline — the name is the headline. */

.mkt-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 14px 8px 16px;
}

.mkt-hero-address {
  font-family: 'Manrope', sans-serif;
  /* Large enough to feel like product display type, not a form field.
     `clamp` lets it scale gracefully on narrow phones without losing
     legibility on tablet. */
  font-size: clamp(24px, 6vw, 30px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 100%;
  word-break: break-word;
}

.mkt-hero-name {
  /* Solid weight by default; muted when showing the placeholder so the
     empty state reads as "preview, not real input." */
  transition: opacity 0.15s ease;
}

.mkt-hero-name--placeholder {
  opacity: 0.5;
  font-weight: 600;
  font-style: italic;
}

.mkt-hero-suffix {
  font-weight: 600;
  letter-spacing: -0.005em;
}

/* Status sits on its own line below the name, restrained to a small
   pill. Tone classes flow through from the rest of the sheet. */
.mkt-hero-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.mkt-hero-status.status-row--ok    { background: rgba(21, 222, 114, 0.14); color: #0e7b3f; }
.mkt-hero-status.status-row--warn  { background: rgba(245, 158, 11, 0.14); color: #b45309; }
.mkt-hero-status.status-row--muted { background: rgba(15, 23, 42, 0.05); color: #64748b; }

body.body--dark .mkt-hero-status.status-row--ok    { color: #6ee7a8; }
body.body--dark .mkt-hero-status.status-row--warn  { color: #fbbf24; }
body.body--dark .mkt-hero-status.status-row--muted { background: rgba(255, 255, 255, 0.06); color: #94a3b8; }

/* Benefit footnote — single calm sentence stating what the name does.
   No headline above it; the name itself does that work. Reads as a
   caption rather than a marketing line. */
.mkt-hero-footnote {
  margin: 4px 0 0 0;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.45;
  letter-spacing: -0.003em;
  max-width: 320px;
}

.preview-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Smaller chip now that the hero illustration above carries the
     "what's the state of this name" visual. Here it's just a quick
     glanceable tone marker. */
  width: 32px;
  height: 32px;
  border-radius: 10px;
  flex-shrink: 0;
}

.preview-icon--ok    { background: rgba(21, 222, 114, 0.14); color: #15a35b; }
.preview-icon--warn  { background: rgba(245, 158, 11, 0.14); color: #b45309; }
.preview-icon--muted { background: rgba(15, 23, 42, 0.06); color: #64748b; }

body.body--dark .preview-icon--ok    { color: #2bd17f; }
body.body--dark .preview-icon--warn  { color: #fbbf24; }
body.body--dark .preview-icon--muted { background: rgba(255, 255, 255, 0.06); color: #94a3b8; }

.preview-address {
  font-family: 'Manrope', sans-serif;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.2;
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 100%;
  word-break: break-word;
}

.preview-name {
  /* No fade-on-empty here; the muted preview-icon and status pill
     already signal the empty state, and a third tone would dilute
     the lockstep. */
}

.preview-suffix {
  font-weight: 600;
  letter-spacing: -0.005em;
}

/* The status pill below the preview address. Picks up the same tone
   classes the inline status row uses elsewhere so colour-coding stays
   consistent across the sheet. */
.preview-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.preview-status.status-row--ok    { background: rgba(21, 222, 114, 0.14); color: #0e7b3f; }
.preview-status.status-row--warn  { background: rgba(245, 158, 11, 0.14); color: #b45309; }
.preview-status.status-row--muted { background: rgba(15, 23, 42, 0.05); color: #64748b; }

body.body--dark .preview-status.status-row--ok    { color: #6ee7a8; }
body.body--dark .preview-status.status-row--warn  { color: #fbbf24; }
body.body--dark .preview-status.status-row--muted { background: rgba(255, 255, 255, 0.06); color: #94a3b8; }

.preview-status-text {
  min-width: 0;
  word-break: break-word;
}

.step-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 6px 18px 18px;
}

.step-body--centered {
  justify-content: center;
  align-items: stretch;
  min-height: 220px;
}

.step-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  line-height: 1.45;
  margin: 0 0 2px 0;
}

/* ---------- Name input ---------- */

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.name-input-wrap {
  display: flex;
  align-items: center;
  border-radius: 12px;
  border: 1px solid transparent;
  transition: border-color 0.18s ease, background-color 0.18s ease;
  padding-right: 12px;
}

.field-input-wrap-light {
  background: rgba(15, 23, 42, 0.04);
  border-color: rgba(15, 23, 42, 0.08);
}

.field-input-wrap-light:focus-within {
  background: #ffffff;
  border-color: rgba(15, 23, 42, 0.32);
}

.field-input-wrap-dark {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.06);
}

.field-input-wrap-dark:focus-within {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.28);
}

.field-input-wrap--error { border-color: #ef4444 !important; }

.name-input {
  flex: 1 1 auto;
  width: 100%;
  border: 0;
  outline: none;
  padding: 12px 0 12px 14px;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.005em;
}

.field-input-light { color: #0f172a; }
.field-input-dark  { color: #f8fafc; }

.name-suffix {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
}

/* ---------- Status row ---------- */

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.35;
  min-height: 22px;
}

.status-text {
  min-width: 0;
  word-break: break-word;
}

.status-row--ok    { color: #15a35b; }
.status-row--warn  { color: #b45309; }
.status-row--muted { color: #64748b; }

body.body--dark .status-row--muted { color: #94a3b8; }
body.body--dark .status-row--warn  { color: #fbbf24; }

/* ---------- Free fallback chip ---------- */

.free-chip {
  align-self: flex-start;
  border: 0;
  border-radius: 999px;
  padding: 8px 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease;
}

.free-chip:active { transform: scale(0.98); }

.free-chip-light {
  background: rgba(21, 222, 114, 0.10);
  color: #0e7b3f;
}

.free-chip-dark {
  background: rgba(21, 222, 114, 0.16);
  color: #6ee7a8;
}

/* ---------- Summary card (paying step) ---------- */

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 16px;
}

.summary-card-light {
  background: rgba(15, 23, 42, 0.04);
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.06);
}

.summary-card-dark {
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.summary-handle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.summary-check { color: #15a35b; flex-shrink: 0; }

.summary-handle-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-price {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.summary-price-amount {
  font-family: 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.summary-price-unit {
  font-size: 13px;
  font-weight: 500;
}

/* ---------- Pay source picker ---------- */

.pay-source {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-family: 'Manrope', sans-serif;
}

.pay-source-label {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.pay-source-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 999px;
  padding: 7px 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  position: relative;
}

.pay-source-pill-light {
  background: rgba(15, 23, 42, 0.05);
  color: #0f172a;
}

.pay-source-pill-dark {
  background: rgba(255, 255, 255, 0.06);
  color: #f8fafc;
}

.pay-source-pill:active { transform: scale(0.98); }

.pay-source-static {
  font-size: 13px;
  font-weight: 500;
}

.pay-source-balance {
  font-weight: 500;
}

.wallet-menu-list { padding: 4px; min-width: 200px; }
.wallet-menu-list-light { background: #ffffff; }
.wallet-menu-list-dark  { background: #1e293b; color: #f8fafc; }

/* ---------- Pay error ---------- */

.pay-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.4;
}

.pay-error-light {
  background: rgba(239, 68, 68, 0.08);
  color: #b91c1c;
}

.pay-error-dark {
  background: rgba(239, 68, 68, 0.14);
  color: #fca5a5;
}

/* ---------- External pay ---------- */

.external-pay {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}

.external-pay-toggle {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  align-self: flex-start;
  -webkit-tap-highlight-color: transparent;
}

.invoice-row-wrap {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

.invoice-row {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 0;
  border-radius: 12px;
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 12.5px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  text-align: left;
}

.invoice-row-light {
  background: rgba(15, 23, 42, 0.05);
  color: #334155;
}

.invoice-row-dark {
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
}

.invoice-row-text {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.invoice-row-icon { flex-shrink: 0; opacity: 0.7; }

.qr-icon-btn {
  border: 0;
  border-radius: 12px;
  width: 42px;
  flex: 0 0 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.qr-icon-btn-light {
  background: rgba(15, 23, 42, 0.05);
  color: #0f172a;
}

.qr-icon-btn-dark {
  background: rgba(255, 255, 255, 0.06);
  color: #f8fafc;
}

.qr-stage {
  display: flex;
  justify-content: center;
  padding: 10px 0 2px;
}

.qr-canvas {
  width: min(100%, 240px) !important;
  height: auto !important;
  border-radius: 12px;
}

/* ---------- Centered stages (activating + success) ---------- */

.centered-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 16px;
  text-align: center;
}

.centered-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.centered-caption {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.45;
  max-width: 280px;
}

.centered-address {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.success-check { color: #15a35b; }

/* ---------- Sticky bottom action bar ---------- */

.sheet-actions {
  flex-shrink: 0;
  padding: 12px 18px 6px;
  border-top: 1px solid transparent;
}

.sheet-actions-light { border-top-color: rgba(15, 23, 42, 0.06); }
.sheet-actions-dark  { border-top-color: rgba(255, 255, 255, 0.06); }

.primary-cta {
  width: 100%;
  height: 48px;
  border-radius: 16px;
  border: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: filter 0.18s ease, transform 0.1s ease, opacity 0.18s ease;
}

.primary-cta:disabled { opacity: 0.45; cursor: default; }
.primary-cta:not(:disabled):hover { filter: brightness(1.05); }
.primary-cta:not(:disabled):active { transform: scale(0.98); }
</style>
