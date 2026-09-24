<template>
  <!--
    Get or change a username: `name@mybuho.de`, paid per year.

    One sheet, one money tap. Type a name, read one result line, choose how
    many years, tap "Get it for …". Paying from another wallet shows the
    payment code in the same sheet and watches for the payment by asking the
    name server, so it finishes by itself. Every end state has a way out and
    the name is only written into the profile after the name server confirms
    it points at this identity's key (services/usernameClaim.js).
  -->
  <q-dialog
    v-model="open"
    position="bottom"
    :persistent="step === 'activating'"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card class="claim-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true"><span></span></div>

      <div class="sheet-header">
        <div class="sheet-title">{{ headerTitle }}</div>
        <q-btn
          flat
          round
          class="sheet-close"
          :aria-label="$t('Close')"
          :disable="step === 'activating'"
          @click="open = false"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <template v-if="pricingOpen">
        <button type="button" class="pricing-dismiss" :aria-label="$t('Close')" @click="pricingOpen = false"></button>
        <section class="pricing-popover" role="dialog" :aria-label="$t('Prices')">
          <header class="pricing-head">
            <strong>{{ $t('Prices') }}</strong>
            <small>{{ $t('Per year') }}</small>
          </header>
          <table class="pricing-table">
            <tbody>
              <tr v-for="tier in pricingRows" :key="tier.id">
                <th scope="row">{{ tier.label }}</th>
                <td>{{ formatSats(tier.priceSats) }} {{ $t('sats') }}</td>
              </tr>
            </tbody>
          </table>
          <p class="pricing-note">
            {{ $t('Prices are per year. Pay for up to 10 years at once. Shorter names are rarer, so they cost more.') }}
          </p>
        </section>
      </template>

      <div class="sheet-scroll">
        <!-- ───────── Choosing ───────── -->
        <section v-if="step === 'browse'" class="step-body">
          <header class="claim-hero">
            <div class="claim-hero-address" :class="{ 'claim-hero-address--placeholder': !nameInput }">
              <span class="claim-hero-name">{{ nameInput || $t('name') }}</span><span class="claim-hero-domain">@{{ domain }}</span>
            </div>
            <div class="claim-status" :class="`claim-status--${statusTone}`" aria-live="polite">
              <q-spinner v-if="lookup.status === 'checking'" size="13px" />
              <Icon v-else-if="statusIcon" :icon="statusIcon" width="14" height="14" />
              <span>{{ statusText }}</span>
            </div>
          </header>

          <label class="claim-field">
            <span class="sr-only">{{ $t('Username') }}</span>
            <span class="claim-input-wrap" :class="{ 'claim-input-wrap--error': hasLocalError }">
              <input
                ref="nameInputEl"
                v-model="nameInput"
                type="text"
                class="claim-input"
                :placeholder="$t('name')"
                spellcheck="false"
                autocomplete="off"
                autocapitalize="none"
                maxlength="63"
                :readonly="external.open"
                @input="onNameInput"
              />
              <span class="claim-input-domain" aria-hidden="true">@{{ domain }}</span>
            </span>
          </label>

          <!-- Taken: up to two available names built from the display name. -->
          <div v-if="lookup.status === 'taken' && suggestions.length" class="claim-suggestions">
            <button
              v-for="suggestion in suggestions"
              :key="suggestion"
              type="button"
              class="claim-suggestion"
              @click="pickSuggestion(suggestion)"
            >
              {{ suggestion }}@{{ domain }}
            </button>
          </div>

          <!-- Available: how long, what it costs, until when, paid from where. -->
          <template v-if="lookup.status === 'available'">
            <div class="claim-years" role="group" :aria-label="$t('Years')">
              <span class="claim-years-label">{{ $t('Years') }}</span>
              <span class="claim-years-stepper">
                <button
                  type="button"
                  class="claim-years-btn"
                  :disabled="years <= 1 || external.open || busy"
                  :aria-label="$t('Fewer years')"
                  @click="stepYears(-1)"
                >
                  <Icon icon="tabler:minus" width="16" height="16" />
                </button>
                <span class="claim-years-value" aria-live="polite">{{ yearsLabel }}</span>
                <button
                  type="button"
                  class="claim-years-btn"
                  :disabled="years >= maxYears || external.open || busy"
                  :aria-label="$t('More years')"
                  @click="stepYears(1)"
                >
                  <Icon icon="tabler:plus" width="16" height="16" />
                </button>
              </span>
            </div>
            <p class="claim-summary">{{ summaryLine }}</p>

            <div v-if="payableWallets.length && !external.open" class="claim-wallet">
              <span class="claim-wallet-label">{{ $t('Pay with') }}</span>
              <button
                v-if="payableWallets.length > 1"
                type="button"
                class="claim-wallet-pill"
                @click="walletMenuOpen = true"
              >
                <span>{{ selectedWalletLabel }}</span>
                <Icon icon="tabler:chevron-down" width="14" height="14" />
                <q-menu v-model="walletMenuOpen" anchor="bottom right" self="top right" :offset="[0, 6]">
                  <q-list class="claim-wallet-menu">
                    <q-item
                      v-for="wallet in payableWallets"
                      :key="wallet.id"
                      v-close-popup
                      clickable
                      @click="selectedWalletId = wallet.id"
                    >
                      <q-item-section>
                        <q-item-label>{{ wallet.name }}</q-item-label>
                        <q-item-label caption>{{ formatSats(wallet.balance) }} {{ $t('sats') }}</q-item-label>
                      </q-item-section>
                      <q-item-section v-if="wallet.id === selectedWalletId" side>
                        <Icon icon="tabler:check" width="16" height="16" />
                      </q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </button>
              <span v-else class="claim-wallet-static">{{ selectedWalletLabel }}</span>
            </div>

            <p v-if="hasName && currentAddress" class="claim-note">
              {{ $t('{name} keeps working until its paid time ends.', { name: currentAddress }) }}
            </p>
          </template>

          <!-- Paying from another wallet: the code, and the sheet watching for it. -->
          <div v-if="external.open && invoice" class="claim-external">
            <vue-qrcode :value="invoice.invoice.toUpperCase()" :options="qrOptions" class="claim-qr" />
            <button type="button" class="claim-code" :aria-label="$t('Copy payment code')" @click="copyInvoice">
              <span class="claim-code-text">{{ truncatedInvoice }}</span>
              <Icon :icon="external.copied ? 'tabler:copy-check' : 'tabler:copy'" width="15" height="15" />
            </button>
            <div class="claim-waiting">
              <q-spinner size="14px" />
              <span>{{ $t('Waiting for the payment') }}</span>
            </div>
          </div>

          <div v-if="notice" class="claim-notice" role="alert">
            <Icon icon="tabler:alert-circle" width="16" height="16" />
            <span>{{ notice }}</span>
          </div>

          <button type="button" class="claim-prices-link" @click="pricingOpen = true">{{ $t('Prices') }}</button>
        </section>

        <!-- ───────── After the tap ───────── -->
        <section v-else class="step-body step-body--centered">
          <div class="claim-end">
            <q-spinner v-if="step === 'activating'" size="36px" class="claim-end-spinner" />
            <Icon v-else :icon="endIcon" width="48" height="48" :class="`claim-end-mark claim-end-mark--${step}`" />
            <div class="claim-end-title">{{ endTitle }}</div>
            <div v-if="endCaption" class="claim-end-caption">{{ endCaption }}</div>
          </div>
        </section>
      </div>

      <div v-if="step !== 'activating'" class="sheet-actions">
        <template v-if="step === 'browse'">
          <button
            v-if="primaryAction === 'use'"
            type="button"
            class="primary-cta"
            :disabled="busy"
            @click="useOwnedName"
          >
            {{ $t('Use this name') }}
          </button>
          <button
            v-else-if="primaryAction === 'get'"
            type="button"
            class="primary-cta"
            :disabled="busy"
            @click="getWithWallet"
          >
            <q-spinner v-if="busy" size="18px" />
            <span v-else>{{ $t('Get it for {sats} sats', { sats: formatSats(totalSats) }) }}</span>
          </button>
          <button
            v-else-if="primaryAction === 'external'"
            type="button"
            class="primary-cta"
            :disabled="busy"
            @click="openExternal"
          >
            <q-spinner v-if="busy" size="18px" />
            <span v-else>{{ $t('Pay from another wallet') }}</span>
          </button>
          <button v-else-if="!external.open" type="button" class="primary-cta" disabled>
            {{ $t('Get username') }}
          </button>

          <button v-if="secondaryAction === 'external'" type="button" class="below-link" :disabled="busy" @click="openExternal">
            {{ $t('Pay from another wallet') }}
          </button>
          <button v-else-if="secondaryAction === 'back'" type="button" class="below-link" @click="closeExternal">
            {{ payableWallets.length ? $t('Pay with {wallet} instead', { wallet: selectedWalletName }) : $t('Change name or years') }}
          </button>
        </template>
        <button v-else type="button" class="primary-cta" @click="finishAndClose">{{ $t('Done') }}</button>
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
import { useTransactionMetadataStore } from '../stores/transactionMetadata';
import {
  NIP05_DOMAIN,
  NIP05_MAX_YEARS,
  NIP05_PRICE_TIERS,
  clampYears,
  deriveNameSlug,
  expiresAtFor,
  isFreeShapeHandle,
  isLikelyAvailableLocalPart,
  lookupOwner,
  nip05AddressFor,
  normaliseUsernameInput,
  requestPaidHandle,
  searchHandle,
  suggestUsernames,
  waitForActivation,
} from '../services/nip05';
import {
  CLAIM_STATUS,
  adoptOwnedUsername,
  holdClaimInView,
  settlePendingClaim,
} from '../services/usernameClaim';
import { invoiceAmountMsat } from '../utils/addressUtils';
import { fiatRatesService } from '../utils/fiatRates';
import { formatCalendarDate } from '../utils/timeFormatting';

const SEARCH_DEBOUNCE_MS = 350;
/** One uninterrupted wait for an in-app payment before "Almost ready". */
const ACTIVATION_WAIT_MS = 90_000;
/** Re-ask the server after the payment until the name points somewhere. */
const SETTLE_INTERVAL_MS = 2_000;
/**
 * A payment code is reused for the same name and years for this long, then
 * replaced. LNbits codes last an hour; this stays well inside that.
 */
const INVOICE_FRESH_MS = 50 * 60 * 1000;
/** Keep a fee reserve so a wallet that "has exactly enough" is not offered. */
const FEE_RESERVE_RATIO = 0.01;
const FEE_RESERVE_MIN_SATS = 10;

const delay = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new DOMException('Aborted', 'AbortError'));
  }, { once: true });
});

export default {
  name: 'Nip05MarketplaceSheet',

  components: { Icon, VueQrcode },

  props: {
    modelValue: { type: Boolean, default: false },
    /** True when the person already has a username and is changing it. */
    hasName: { type: Boolean, default: false },
  },

  emits: ['update:modelValue', 'purchased'],

  setup() {
    return {
      identity: useIdentityStore(),
      profile: useProfileStore(),
      walletStore: useWalletStore(),
      txMetadata: useTransactionMetadataStore(),
    };
  },

  data() {
    return {
      /** 'browse' | 'activating' | 'success' | 'later' | 'failed' */
      step: 'browse',
      nameInput: '',
      years: 1,
      /**
       * The server's answer for the typed name:
       * status 'idle' | 'checking' | 'available' | 'taken' | 'mine' |
       *        'unavailable' | 'invalid' | 'offline' | 'error'
       */
      lookup: { name: '', status: 'idle', pricePerYear: null },
      suggestions: [],
      /** The payment code in use: { handle, years, invoice, paymentHash, addressId, rotationSecret, amountSats, requestedAt } */
      invoice: null,
      external: { open: false, copied: false },
      selectedWalletId: null,
      walletMenuOpen: false,
      pricingOpen: false,
      busy: false,
      notice: '',
      /** The name the end states talk about. */
      resultHandle: '',
      lookupSeq: 0,
      debounceTimer: null,
      copyTimer: null,
      watchController: null,
      releaseClaimView: null,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(value) { this.$emit('update:modelValue', value); },
    },

    domain() { return NIP05_DOMAIN; },
    maxYears() { return NIP05_MAX_YEARS; },

    headerTitle() {
      if (this.step !== 'browse') return this.$t('Username');
      return this.hasName ? this.$t('Change username') : this.$t('Choose a username');
    },

    currentAddress() {
      return nip05AddressFor(this.profile.username) || '';
    },

    pricingRows() {
      const labels = {
        'two-to-three': this.$t('2–3 characters'),
        four: this.$t('4 characters'),
        'five-to-six': this.$t('5–6 characters'),
        'seven-plus': this.$t('7+ characters'),
      };
      return NIP05_PRICE_TIERS.map((tier) => ({ ...tier, label: labels[tier.id] || tier.id }));
    },

    localValidation() {
      return isLikelyAvailableLocalPart(this.nameInput);
    },

    hasLocalError() {
      return !!this.nameInput && !this.localValidation.ok;
    },

    statusText() {
      if (!this.nameInput) return this.$t('Type a name to check it.');
      switch (this.lookup.status) {
        case 'checking': return this.$t('Checking…');
        case 'invalid': return this.localErrorMessage;
        case 'offline': return this.$t("You're offline");
        case 'error': return this.$t("Couldn't check. Try again.");
        case 'taken': return this.$t('Taken');
        case 'mine': return this.$t('Already yours');
        case 'unavailable': return this.$t('Not available');
        case 'available':
          return this.$t('Available · {sats} sats a year', { sats: this.formatSats(this.lookup.pricePerYear) });
        default: return this.$t('Type a name to check it.');
      }
    },

    statusTone() {
      if (!this.nameInput) return 'muted';
      if (['available', 'mine'].includes(this.lookup.status)) return 'ok';
      if (['taken', 'unavailable', 'invalid', 'error', 'offline'].includes(this.lookup.status)) return 'warn';
      return 'muted';
    },

    statusIcon() {
      if (!this.nameInput) return '';
      return {
        available: 'tabler:circle-check',
        mine: 'tabler:circle-check',
        taken: 'tabler:circle-x',
        unavailable: 'tabler:circle-x',
        invalid: 'tabler:alert-circle',
        error: 'tabler:cloud-off',
        offline: 'tabler:cloud-off',
      }[this.lookup.status] || '';
    },

    localErrorMessage() {
      switch (this.localValidation.reason) {
        case 'too-short': return this.$t('At least 2 characters');
        case 'too-long': return this.$t('Too long');
        default: return this.$t('Use a to z, 0 to 9, dot, hyphen or underscore');
      }
    },

    totalSats() {
      return (Number(this.lookup.pricePerYear) || 0) * this.years;
    },

    yearsLabel() {
      return this.years === 1 ? this.$t('1 year') : this.$t('{n} years', { n: this.years });
    },

    /** "2 years, until 24 Sep 2028 · 2,000 sats · about €2.00" */
    summaryLine() {
      const until = formatCalendarDate(expiresAtFor(Date.now(), this.years), this.$i18n.locale);
      const fiat = this.fiatFor(this.totalSats);
      const total = fiat
        ? this.$t('{sats} sats · about {fiat}', { sats: this.formatSats(this.totalSats), fiat })
        : this.$t('{sats} sats', { sats: this.formatSats(this.totalSats) });
      return this.$t('{years}, until {date} · {total}', { years: this.yearsLabel, date: until, total });
    },

    /**
     * Wallets that can pay the total right now: connected, and holding the
     * total plus a fee reserve. The active wallet comes first.
     */
    payableWallets() {
      const total = this.totalSats;
      if (!total) return [];
      const reserve = Math.max(FEE_RESERVE_MIN_SATS, Math.ceil(total * FEE_RESERVE_RATIO));
      const activeId = this.walletStore.activeWalletId;
      return (this.walletStore.wallets || [])
        .filter((wallet) => this.walletStore.connectionStates?.[wallet.id]?.connected)
        .map((wallet) => ({
          id: wallet.id,
          name: wallet.name || this.$t('Wallet'),
          type: wallet.type,
          balance: this.walletStore.balances?.[wallet.id] || 0,
        }))
        .filter((wallet) => wallet.balance >= total + reserve)
        .sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId));
    },

    selectedWallet() {
      return this.payableWallets.find((wallet) => wallet.id === this.selectedWalletId)
        || this.payableWallets[0]
        || null;
    },

    selectedWalletName() {
      return this.selectedWallet?.name || '';
    },

    selectedWalletLabel() {
      const wallet = this.selectedWallet;
      return wallet ? `${wallet.name} · ${this.formatSats(wallet.balance)} ${this.$t('sats')}` : '';
    },

    /** 'use' | 'get' | 'external' | '' (disabled) */
    primaryAction() {
      if (this.external.open) return '';
      if (this.lookup.status === 'mine' && this.lookup.name === this.nameInput) return 'use';
      if (this.lookup.status !== 'available' || this.lookup.name !== this.nameInput) return '';
      return this.payableWallets.length ? 'get' : 'external';
    },

    /** 'external' | 'back' | '' */
    secondaryAction() {
      if (this.external.open) return 'back';
      return this.primaryAction === 'get' ? 'external' : '';
    },

    truncatedInvoice() {
      const code = this.invoice?.invoice || '';
      return code.length > 30 ? `${code.slice(0, 18)}…${code.slice(-8)}` : code;
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

    resultAddress() {
      return nip05AddressFor(this.resultHandle) || '';
    },

    endIcon() {
      return {
        success: 'tabler:circle-check',
        later: 'tabler:clock',
        failed: 'tabler:alert-circle',
      }[this.step] || 'tabler:circle-check';
    },

    endTitle() {
      switch (this.step) {
        case 'activating': return this.$t('Making it yours');
        case 'success': return this.$t('{name} is yours', { name: this.resultAddress });
        case 'later': return this.$t('Almost ready');
        case 'failed': return this.$t("We couldn't finish {name}", { name: this.resultAddress });
        default: return '';
      }
    },

    endCaption() {
      switch (this.step) {
        case 'activating': return this.$t('Usually a few seconds.');
        case 'success': return this.$t("It's on your card now.");
        case 'later': return this.$t('Your payment went through. {name} will be ready in a moment.', { name: this.resultAddress });
        case 'failed': return this.$t('Someone took this name a moment earlier.');
        default: return '';
      }
    },
  },

  watch: {
    /**
     * Reset the moment the sheet is asked to open, before it renders:
     * resetting when the opening animation ends would wipe anything typed
     * during it. The dialog stays mounted between opens.
     */
    modelValue: {
      immediate: true,
      handler(isOpen) {
        if (isOpen) this.onOpen();
      },
    },
  },

  beforeUnmount() {
    this.onHide();
  },

  methods: {
    // ── Lifecycle ─────────────────────────────────────────────────────────

    onOpen() {
      this.releaseClaimView?.();
      this.releaseClaimView = holdClaimInView();
      this.resetForNewSession();

      // A purchase paid earlier and not finished yet: finish it here.
      const claim = this.identity.pendingNip05Claim;
      if (claim?.failedAt) {
        this.resultHandle = claim.handle;
        this.step = 'failed';
        return;
      }
      if (claim?.paidAt) {
        this.resultHandle = claim.handle;
        this.step = 'activating';
        this.finishAfterPayment();
      }
    },

    /** Once the sheet is up, the keyboard rises with it. */
    onShow() {
      if (this.step === 'browse') this.$refs.nameInputEl?.focus();
    },

    onHide() {
      clearTimeout(this.debounceTimer);
      clearTimeout(this.copyTimer);
      this.stopWatching();
      this.releaseClaimView?.();
      this.releaseClaimView = null;
      this.pricingOpen = false;
    },

    resetForNewSession() {
      this.stopWatching();
      clearTimeout(this.debounceTimer);
      this.lookupSeq += 1; // any answer still in flight belongs to the last session
      Object.assign(this, {
        step: 'browse',
        years: 1,
        lookup: { name: '', status: 'idle', pricePerYear: null },
        suggestions: [],
        invoice: null,
        external: { open: false, copied: false },
        selectedWalletId: this.walletStore.activeWalletId || null,
        walletMenuOpen: false,
        pricingOpen: false,
        busy: false,
        notice: '',
        resultHandle: '',
      });
      // First username: start from the person's own name. Changing one:
      // start empty, the current name is on the card already.
      this.nameInput = this.hasName ? '' : deriveNameSlug({ name: this.profile.displayName });
      if (this.nameInput) this.runLookup(this.nameInput);
    },

    finishAndClose() {
      if (this.step === 'failed') this.identity.clearPendingNip05Claim();
      this.open = false;
    },

    // ── Choosing a name ───────────────────────────────────────────────────

    onNameInput() {
      const cleaned = normaliseUsernameInput(this.nameInput);
      if (cleaned !== this.nameInput) this.nameInput = cleaned;
      this.notice = '';
      this.suggestions = [];
      this.invoice = null;
      clearTimeout(this.debounceTimer);
      if (!this.nameInput) {
        this.lookup = { name: '', status: 'idle', pricePerYear: null };
        return;
      }
      if (!this.localValidation.ok) {
        this.lookup = { name: this.nameInput, status: 'invalid', pricePerYear: null };
        return;
      }
      this.lookup = { name: this.nameInput, status: 'checking', pricePerYear: null };
      this.debounceTimer = setTimeout(() => this.runLookup(this.nameInput), SEARCH_DEBOUNCE_MS);
    },

    async runLookup(name) {
      const seq = ++this.lookupSeq;
      const stillCurrent = () => seq === this.lookupSeq && name === this.nameInput;
      if (!isLikelyAvailableLocalPart(name).ok) {
        this.lookup = { name, status: 'invalid', pricePerYear: null };
        return;
      }
      if (isFreeShapeHandle(name)) {
        this.lookup = { name, status: 'unavailable', pricePerYear: null };
        return;
      }
      this.lookup = { name, status: 'checking', pricePerYear: null };
      try {
        const result = await searchHandle({ query: name });
        if (!stillCurrent()) return;
        if (result.available) {
          const price = Number(result.priceSats) || 0;
          this.lookup = { name, status: price > 0 ? 'available' : 'unavailable', pricePerYear: price || null };
          return;
        }
        // Taken: it may be this person's own name (switching back, or a
        // name bought on another phone).
        const owner = await lookupOwner(name);
        if (!stillCurrent()) return;
        if (owner && owner === this.identity.nostrPubkeyHex) {
          this.lookup = { name, status: 'mine', pricePerYear: null };
          return;
        }
        this.lookup = { name, status: 'taken', pricePerYear: null };
        this.loadSuggestions(name, seq);
      } catch {
        if (!stillCurrent()) return;
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        this.lookup = { name, status: offline ? 'offline' : 'error', pricePerYear: null };
      }
    },

    /** Up to two available alternatives built from the display name. */
    async loadSuggestions(takenName, seq) {
      const candidates = suggestUsernames(this.profile.displayName, takenName);
      if (!candidates.length) return;
      const answers = await Promise.allSettled(
        candidates.map((candidate) => searchHandle({ query: candidate })),
      );
      if (seq !== this.lookupSeq) return;
      this.suggestions = candidates
        .filter((_, i) => answers[i].status === 'fulfilled'
          && answers[i].value.available
          && Number(answers[i].value.priceSats) > 0)
        .slice(0, 2);
    },

    pickSuggestion(name) {
      this.nameInput = name;
      this.suggestions = [];
      this.notice = '';
      this.invoice = null;
      this.runLookup(name);
    },

    stepYears(delta) {
      this.years = clampYears(this.years + delta);
      this.notice = '';
    },

    // ── Paying ────────────────────────────────────────────────────────────

    /**
     * A payment code for the typed name and years, with the price checked
     * twice: the name is re-checked right before (so a name taken a moment
     * ago never gets paid for), and the amount inside the code must be the
     * total the sheet showed. Remembered as the pending claim, so closing
     * the sheet or the app never loses it.
     *
     * @returns {Promise<object|null>} the invoice, or null when it stopped
     *   with a message on screen
     */
    async prepareInvoice() {
      const name = this.nameInput;
      const { years } = this;
      const fresh = this.invoice
        && this.invoice.handle === name
        && this.invoice.years === years
        && Date.now() - this.invoice.requestedAt < INVOICE_FRESH_MS;
      if (fresh) return this.invoice;

      const check = await searchHandle({ query: name });
      if (!check.available) {
        this.lookup = { name, status: 'taken', pricePerYear: null };
        this.notice = this.$t('That name was just taken. Pick another.');
        return null;
      }
      if (Number(check.priceSats) !== Number(this.lookup.pricePerYear)) {
        this.lookup = { name, status: 'available', pricePerYear: Number(check.priceSats) || null };
        this.notice = this.$t('The price changed. Check the new total.');
        return null;
      }

      const request = await requestPaidHandle({
        localPart: name,
        pubkeyHex: this.identity.nostrPubkeyHex,
        years,
      });
      const chargedSats = (invoiceAmountMsat(request.invoice) ?? -1000) / 1000;
      if (chargedSats !== this.totalSats) {
        this.notice = this.$t('The price changed. Check the new total.');
        this.runLookup(name);
        return null;
      }

      this.invoice = { ...request, years, amountSats: this.totalSats, requestedAt: Date.now() };
      this.identity.setPendingNip05Claim({
        handle: request.handle,
        paymentHash: request.paymentHash,
        invoice: request.invoice,
        addressId: request.addressId,
        rotationSecret: request.rotationSecret,
        years,
        amountSats: this.totalSats,
      });
      return this.invoice;
    },

    async getWithWallet() {
      const wallet = this.selectedWallet;
      if (!wallet || this.busy) return;
      const provider = this.walletStore.providers?.[wallet.id];
      if (!provider) {
        this.notice = this.$t("That wallet isn't ready. Pick another or pay from another wallet.");
        return;
      }

      this.busy = true;
      this.notice = '';
      let invoice = null;
      try {
        invoice = await this.prepareInvoice();
      } catch (err) {
        console.warn('[username] could not start the payment:', err);
        this.notice = err?.status === 409 || err?.status === 400
          ? this.$t('That name was just taken. Pick another.')
          : this.$t("Couldn't start the payment. Try again.");
      }
      if (!invoice) {
        this.busy = false;
        return;
      }

      try {
        // NWC takes the bare code; Spark and LNbits take an object.
        if (wallet.type === 'nwc') await provider.sendPayment(invoice.invoice);
        else await provider.payInvoice({ invoice: invoice.invoice });
      } catch (err) {
        console.warn('[username] payment failed:', err);
        this.notice = this.$t("Payment didn't go through. Try again or pay from another wallet.");
        this.busy = false;
        return;
      }

      this.identity.updatePendingNip05Claim({ paidAt: Date.now() });
      this.labelPayment(wallet.id, invoice);
      this.busy = false;
      this.resultHandle = invoice.handle;
      this.step = 'activating';
      this.finishAfterPayment();
    },

    /** Name the payment in history instead of the server's invoice text. */
    labelPayment(walletId, invoice) {
      this.txMetadata.enqueuePendingContactLink({
        amountSats: invoice.amountSats,
        walletId,
        label: this.$t('Username {name}', { name: nip05AddressFor(invoice.handle) }),
        source: 'username',
        perPayment: true,
      }).catch((err) => console.warn('[username] could not label the payment:', err));
    },

    async openExternal() {
      if (this.busy) return;
      this.busy = true;
      this.notice = '';
      try {
        const invoice = await this.prepareInvoice();
        if (!invoice) return;
        this.external = { open: true, copied: false };
        this.watchExternalPayment();
      } catch (err) {
        console.warn('[username] could not create the payment code:', err);
        this.notice = this.$t("Couldn't start the payment. Try again.");
      } finally {
        this.busy = false;
      }
    },

    closeExternal() {
      this.stopWatching();
      this.external = { open: false, copied: false };
    },

    /**
     * Watch the shown payment code by asking the name server, which works
     * for any wallet. A code about to go stale is replaced in place, so a
     * person who takes their time still pays a live one.
     */
    async watchExternalPayment() {
      this.stopWatching();
      const controller = new AbortController();
      this.watchController = controller;
      try {
        while (!controller.signal.aborted && this.external.open) {
          const invoice = this.invoice;
          const remaining = INVOICE_FRESH_MS - (Date.now() - invoice.requestedAt);
          const { paid } = await waitForActivation({
            paymentHash: invoice.paymentHash,
            signal: controller.signal,
            maxMs: Math.max(0, remaining),
          });
          if (paid) {
            this.identity.updatePendingNip05Claim({ paidAt: Date.now() });
            this.external = { open: false, copied: false };
            this.resultHandle = invoice.handle;
            this.step = 'activating';
            this.finishAfterPayment();
            return;
          }
          // The code is getting old: get a fresh one for the same name.
          this.invoice = null;
          const renewed = await this.prepareInvoice().catch(() => null);
          if (!renewed) {
            this.closeExternal();
            if (!this.notice) this.notice = this.$t("Couldn't start the payment. Try again.");
            return;
          }
        }
      } catch (err) {
        if (err?.name !== 'AbortError') console.warn('[username] watching the payment failed:', err);
      }
    },

    stopWatching() {
      this.watchController?.abort();
      this.watchController = null;
    },

    /**
     * After a payment: ask until the name points at this key (success),
     * at someone else's (failed), or the wait runs out (later). The
     * background upkeep finishes a "later" on its own.
     */
    async finishAfterPayment() {
      this.stopWatching();
      const controller = new AbortController();
      this.watchController = controller;
      const startedAt = Date.now();
      try {
        while (Date.now() - startedAt < ACTIVATION_WAIT_MS) {
          const result = await settlePendingClaim({ identity: this.identity, profile: this.profile });
          if (controller.signal.aborted) return;
          if (result.status === CLAIM_STATUS.DONE) {
            this.step = 'success';
            this.$emit('purchased', { handle: result.handle });
            return;
          }
          if (result.status === CLAIM_STATUS.FAILED) {
            this.step = 'failed';
            return;
          }
          await delay(SETTLE_INTERVAL_MS, controller.signal);
        }
        this.step = 'later';
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.warn('[username] finishing the purchase failed:', err);
          this.step = 'later';
        }
      }
    },

    /** "Already yours": no payment, the name goes straight on the profile. */
    useOwnedName() {
      const handle = this.nameInput;
      adoptOwnedUsername({
        identity: this.identity,
        profile: this.profile,
        handle,
        expiresAt: this.identity.usernameExpiresAt(handle),
      });
      this.resultHandle = handle;
      this.step = 'success';
      this.$emit('purchased', { handle });
    },

    // ── Helpers ───────────────────────────────────────────────────────────

    async copyInvoice() {
      const code = this.invoice?.invoice;
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        return; // the QR code is still there to scan
      }
      this.external = { ...this.external, copied: true };
      clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => { this.external = { ...this.external, copied: false }; }, 1600);
    },

    formatSats(value) {
      if (value == null || !Number.isFinite(Number(value))) return '';
      try {
        return new Intl.NumberFormat(this.$i18n?.locale || undefined).format(Number(value));
      } catch {
        return String(value);
      }
    },

    /** The total in the person's own currency, or '' without a rate. */
    fiatFor(sats) {
      const currency = this.walletStore.preferredFiatCurrency || 'USD';
      const fiat = fiatRatesService.convertSatsToFiatSync(sats, currency);
      return fiat ? fiatRatesService.formatFiatAmount(fiat, currency) : '';
    },
  },
};
</script>

<style scoped>
.claim-sheet {
  position: relative;
  width: 100%;
  max-width: 520px;
  border-radius: 22px 22px 0 0 !important;
  overflow: hidden;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  /* A steady height while the result line changes, so the button stays
     where the thumb is instead of jumping with every keystroke. */
  min-height: min(560px, 92vh);
  min-height: min(560px, 92dvh);
  max-height: 92vh;
  max-height: 92dvh;
  font-family: 'Manrope', sans-serif;
  color: var(--text-primary);
}

/* The brand wash at the top of the sheet, as before. */
.claim-sheet::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 260px;
  background: linear-gradient(to bottom, rgba(21, 222, 114, 0.16) 0%, rgba(21, 222, 114, 0.08) 50%, transparent 100%);
  pointer-events: none;
}
body.body--dark .claim-sheet::before {
  background: linear-gradient(to bottom, rgba(21, 222, 114, 0.26) 0%, rgba(21, 222, 114, 0.12) 50%, transparent 100%);
}
.claim-sheet > * { position: relative; z-index: 1; }

.sheet-handle { display: flex; justify-content: center; padding: 8px 0 4px; flex-shrink: 0; }
.sheet-handle span { width: 36px; height: 4px; border-radius: 999px; background: var(--border-card); display: block; }

.sheet-header { display: flex; align-items: center; gap: 8px; padding: 4px 12px 6px 18px; flex-shrink: 0; }
.sheet-title { flex: 1; font-size: 17px; font-weight: 700; letter-spacing: -0.015em; }
.sheet-close { min-width: 44px; min-height: 44px; color: var(--text-secondary); }

.sheet-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.step-body { display: flex; flex-direction: column; gap: 14px; padding: 4px 18px 16px; }
.step-body--centered { min-height: 220px; justify-content: center; }

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ── Hero: the address itself is the headline ── */
.claim-hero { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 10px 4px 4px; text-align: center; }
.claim-hero-address {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: baseline;
  max-width: 100%;
  font-size: clamp(22px, 6vw, 28px);
  letter-spacing: -0.02em;
  line-height: 1.15;
  word-break: break-word;
}
.claim-hero-name { font-weight: 600; }
.claim-hero-domain { font-weight: 800; }
.claim-hero-address--placeholder .claim-hero-name { opacity: 0.45; font-style: italic; }

.claim-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  max-width: 100%;
}
.claim-status--ok { background: rgba(21, 222, 114, 0.14); color: #0e7b3f; }
.claim-status--warn { background: rgba(245, 158, 11, 0.14); color: #b45309; }
.claim-status--muted { background: rgba(15, 23, 42, 0.05); color: #64748b; }
body.body--dark .claim-status--ok { color: #6ee7a8; }
body.body--dark .claim-status--warn { color: #fbbf24; }
body.body--dark .claim-status--muted { background: rgba(255, 255, 255, 0.06); color: #94a3b8; }

/* ── Field: the name, then the domain, as the address reads ── */
.claim-field { display: block; }
.claim-input-wrap {
  display: flex;
  align-items: center;
  border-radius: 14px;
  border: 1px solid var(--border-card);
  background: var(--bg-input);
  padding-right: 14px;
  transition: border-color 0.18s ease;
}
.claim-input-wrap:focus-within { border-color: var(--text-secondary); }
.claim-input-wrap--error { border-color: var(--color-red); }
.claim-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  padding: 13px 0 13px 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 16px; /* 16px keeps mobile browsers from zooming the page on focus */
  font-weight: 500;
  color: var(--text-primary);
}
.claim-input-domain { font-size: 15px; font-weight: 700; color: var(--text-secondary); white-space: nowrap; }

.claim-suggestions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: -4px; }
.claim-suggestion {
  min-height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

/* ── Years: a stepper, the standard control for a small bounded number ── */
.claim-years { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.claim-years-label { font-size: 14px; font-weight: 600; color: var(--text-secondary); }
.claim-years-stepper {
  display: inline-flex;
  align-items: center;
  border-radius: 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
}
.claim-years-btn {
  width: 44px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.claim-years-btn:disabled { color: var(--text-muted); cursor: default; }
.claim-years-value { min-width: 78px; text-align: center; font-size: 14.5px; font-weight: 700; }

.claim-summary { margin: -4px 0 0; font-size: 13px; line-height: 1.45; color: var(--text-secondary); }

.claim-wallet { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.claim-wallet-label { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); }
.claim-wallet-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.claim-wallet-static { font-size: 13px; font-weight: 600; }
.claim-wallet-menu { min-width: 200px; padding: 4px; }

.claim-note { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text-secondary); }

/* ── Another wallet: the code, and a quiet sign that the sheet is watching ── */
.claim-external { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.claim-qr { width: min(100%, 220px) !important; height: auto !important; border-radius: 12px; }
.claim-code {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 0;
  border-radius: 12px;
  background: var(--bg-input);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.claim-code-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.claim-waiting { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }

.claim-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.08);
  color: #b91c1c;
  font-size: 13px;
  line-height: 1.4;
}
body.body--dark .claim-notice { background: rgba(239, 68, 68, 0.14); color: #fca5a5; }

.claim-prices-link,
.below-link {
  border: 0;
  background: transparent;
  color: var(--brand-accent-text);
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
  cursor: pointer;
}
.claim-prices-link { align-self: flex-start; padding: 6px 2px; margin-top: -4px; font-size: 13px; min-height: 32px; }
.below-link { display: block; width: 100%; min-height: 44px; margin-top: 4px; font-size: 13.5px; }
.below-link:disabled { color: var(--text-muted); cursor: default; }

/* ── End states ── */
.claim-end { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 20px 12px; text-align: center; }
.claim-end-spinner { color: var(--text-muted); }
.claim-end-mark--success { color: #15a35b; }
.claim-end-mark--later { color: var(--text-muted); }
.claim-end-mark--failed { color: #b45309; }
body.body--dark .claim-end-mark--failed { color: #fbbf24; }
.claim-end-title { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; word-break: break-word; }
.claim-end-caption { font-size: 13.5px; line-height: 1.45; max-width: 300px; color: var(--text-secondary); }

/* ── Actions ── */
.sheet-actions { flex-shrink: 0; padding: 12px 18px 4px; border-top: 1px solid var(--border-card); }
.primary-cta {
  width: 100%;
  height: 50px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 16px;
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
  font-family: 'Manrope', sans-serif;
  font-size: 15.5px;
  font-weight: 650;
  cursor: pointer;
}
body.body--dark .primary-cta { background: rgba(21, 222, 114, 0.14); color: #15de72; box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22); }
.primary-cta:disabled { opacity: 0.45; cursor: default; }
.primary-cta:not(:disabled):active { transform: scale(0.98); }

/* ── Prices ── */
.pricing-dismiss { position: absolute; inset: 0; z-index: 4; border: 0; background: rgba(15, 23, 42, 0.12); cursor: default; }
body.body--dark .pricing-dismiss { background: rgba(0, 0, 0, 0.3); }
.pricing-popover {
  position: absolute;
  z-index: 5;
  top: 56px;
  right: 16px;
  width: min(310px, calc(100% - 32px));
  padding: 16px;
  border-radius: 18px;
  border: 1px solid var(--border-card);
  background: var(--bg-card);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.24);
}
.pricing-head { display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 10px; }
.pricing-head strong { font-size: 15px; font-weight: 750; }
.pricing-head small { font-size: 12px; color: var(--text-secondary); }
.pricing-table { width: 100%; border-collapse: collapse; }
.pricing-table tr { border-top: 1px solid var(--border-card); }
.pricing-table th,
.pricing-table td { padding: 10px 0; font-size: 13px; }
.pricing-table th { text-align: left; font-weight: 600; }
.pricing-table td { text-align: right; font-weight: 650; color: var(--text-secondary); white-space: nowrap; }
.pricing-note { margin: 10px 0 0; font-size: 11.5px; line-height: 1.45; color: var(--text-secondary); }
</style>
