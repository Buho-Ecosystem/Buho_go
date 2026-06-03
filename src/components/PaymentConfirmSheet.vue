<!--
  PaymentConfirmSheet
  Single shared confirm-and-send sheet used everywhere a user reviews a
  payment before it goes out: scanner-driven LNURL/Lightning Address /
  invoice flows from Wallet.vue, and (next) the contact-driven flow from
  PaymentModal.

  Responsibilities — strictly presentational:
    - Renders the Compose stage (recipient hero, amount stage, quick chips,
      optional comment) with proper handling for fixed / range / free
      amount modes.
    - Renders the Confirm stage (recipient summary, amount hero, slide-to-
      send for ≥ 20k sats).
    - Validates the entered amount against the supplied constraints before
      emitting `confirm`.

  It does NOT route to Spark / LNbits / NWC, fetch LNURL data, or talk to
  fiat-rate services beyond the small util import — the parent owns the
  send pipeline and the source of truth for the payment payload.
-->
<template>
  <q-dialog
    v-model="show"
    position="bottom"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="sheet-card" :class="$q.dark.isActive ? 'sheet-card-dark' : 'sheet-card-light'">
      <div class="grab-bar"></div>

      <header class="top-row">
        <q-btn flat round dense @click="onTopAction" class="top-btn">
          <Icon icon="tabler:x" width="20" height="20" />
        </q-btn>
        <div class="top-title">{{ topTitle }}</div>
        <div class="top-spacer"></div>
      </header>

      <!--
        One confirm-and-send screen. The amount is editable for free/range and
        locked for fixed (so a fixed-amount invoice / LNURL lands here directly,
        with nothing to tap before the slide/Send), and the commit gesture lives
        on the same screen. Each piece of info (recipient, payment type, amount,
        fee) is shown exactly once.
      -->
      <div class="stage stage-compose">
          <!-- Recipient hero -->
          <section class="recipient">
            <div
              class="recipient-avatar"
              :class="{ 'has-logo': showRecipientLogo }"
              :style="showRecipientLogo ? null : { background: recipientColor }"
            >
              <img
                v-if="showRecipientLogo"
                :src="recipientLogo"
                :alt="recipientName"
                class="recipient-logo"
                @error="logoFailed = true"
              />
              <span v-else>{{ recipientInitial }}</span>
            </div>
            <div class="recipient-meta">
              <div class="recipient-name-row">
                <div class="recipient-name">{{ recipientName }}</div>
                <!-- Countdown chip — present for time-bounded merchant QRs.
                     Flips to an urgent red state once the remaining time
                     drops below the supplied threshold (defaults to 20s),
                     same behavior as the original SA-retail flow. -->
                <div
                  v-if="countdownSeconds > 0"
                  class="countdown-chip"
                  :class="{ 'countdown-chip--urgent': countdownIsUrgent }"
                >
                  <Icon icon="tabler:clock" width="11" height="11" />
                  <span>{{ formattedCountdown }}</span>
                </div>
              </div>
              <BrantaVerifiedBadge
                v-if="recipientVerification"
                :verify-url="recipientVerification.verifyUrl"
              />
              <div v-if="recipientLnService" class="ln-service-hint">
                <Icon icon="tabler:device-mobile" width="13" height="13" />
                <span>{{ recipientLnService.hint }}</span>
              </div>
            </div>
          </section>

          <!-- Wallet capability hint (e.g. Bitcoin/Spark needs Spark wallet). -->
          <div v-if="!walletCanPay && walletHint" class="wallet-hint">
            <Icon icon="tabler:info-circle" width="14" height="14" />
            <span>{{ walletHint }}</span>
          </div>

          <!-- Stale-rates warning. Surfaced for merchant payments where
               the displayed sats / fiat amount was computed against a
               cached rate that's now older than the freshness window. -->
          <div v-if="payment?.ratesStale" class="wallet-hint">
            <Icon icon="tabler:alert-triangle" width="14" height="14" />
            <span>{{ $t('Exchange rates may be outdated') }}</span>
          </div>

          <!-- Payment indicator. Shows the payment description (or a
               payment-type fallback) and, when there is a destination,
               doubles as the tap-to-reveal raw-address control for manual
               verification. This replaces the old "via X" line that used
               to sit in the recipient hero and duplicated this row. Applies
               to every payment, Branta-verified or not. -->
          <div v-if="payment?.description || recipientAddress" class="payment-indicator">
            <button
              type="button"
              class="payment-indicator-row"
              :class="{ 'payment-indicator-row--static': !recipientAddress }"
              @click="showAddress = !showAddress"
            >
              <Icon icon="tabler:file-description" width="14" height="14" class="payment-indicator-icon" />
              <span class="payment-indicator-label">{{ paymentLabel }}</span>
              <Icon
                v-if="recipientAddress"
                icon="tabler:chevron-down"
                width="14"
                height="14"
                class="payment-indicator-chev"
                :class="{ flipped: showAddress }"
              />
            </button>
            <transition name="fade-collapse">
              <div v-if="showAddress && recipientAddress" class="payment-indicator-address">
                {{ recipientAddress }}
              </div>
            </transition>
          </div>

          <!-- Optional rail line, only when the parent overrides it (LNURL-
               Withdraw → "Lightning · Withdrawal"). Normal sends already show
               the payment type in the indicator above, so it's never repeated. -->
          <div v-if="payment?.recipient?.viaOverride" class="amount-confirm-via">
            {{ payment.recipient.viaOverride }}
          </div>

          <!-- Amount — locked, range, or free depending on mode. -->
          <section class="amount-stage" :class="{ 'amount-stage--locked': amountMode === 'fixed' }">
            <input
              v-model="displayAmount"
              @input="onAmountChange"
              @focus="onAmountFocus"
              @blur="onAmountBlur"
              type="text"
              inputmode="decimal"
              class="amount-input"
              :class="{ 'amount-input--invalid': amountInvalidReason }"
              :placeholder="amountPlaceholder"
              :readonly="amountMode === 'fixed'"
              :tabindex="amountMode === 'fixed' ? -1 : undefined"
              autofocus
            />
            <button
              type="button"
              class="unit-pill"
              :disabled="amountMode === 'fixed'"
              @click="toggleCurrency"
            >
              <span>{{ unitPillLabel }}</span>
              <Icon v-if="amountMode !== 'fixed'" icon="tabler:arrows-up-down" width="11" height="11" />
              <Icon v-else icon="tabler:lock" width="11" height="11" />
            </button>
            <div class="fiat-shadow">{{ fiatEquivalent || ' ' }}</div>
            <!-- Secondary ZAR line for SA-retail merchants when the
                 user's preferred fiat isn't ZAR. The merchant QR carries
                 a ZAR amount that we want to remain visible alongside
                 the user's chosen display currency. -->
            <div v-if="zarSecondary" class="zar-secondary">
              R{{ zarSecondary }} ZAR
            </div>
          </section>

          <!-- Range hint -->
          <div v-if="amountMode === 'range'" class="range-hint">
            {{ rangeHintText }}
          </div>

          <!-- Inline validation -->
          <div v-if="amountInvalidReason" class="amount-error">
            <Icon icon="tabler:alert-circle" width="13" height="13" />
            <span>{{ amountInvalidReason }}</span>
          </div>

          <!-- Quick chips — only meaningful for free / range modes. -->
          <div v-if="quickAmounts.length" class="quick-row">
            <button
              v-for="q in quickAmounts"
              :key="q.value"
              type="button"
              class="quick-chip"
              :class="{ active: isQuickActive(q) }"
              @click="pickQuickAmount(q)"
            >
              {{ q.label }}
            </button>
          </div>

          <!-- Comment -->
          <div v-if="payment?.commentAllowed" class="note-row">
            <Icon icon="tabler:message-circle" width="14" height="14" class="note-icon" />
            <input
              v-model="comment"
              type="text"
              :placeholder="$t('Add a note')"
              class="note-input"
              :maxlength="payment?.commentMaxLength || 100"
            />
          </div>

          <!-- Fee row: surfaced when the parent supplies an estimate or a
               static label (e.g. "Free (Spark transfer)"). NWC/LNbits
               can't pre-estimate fees, so the parent simply omits this
               object on those paths and we show nothing. -->
          <div v-if="feeRowVisible" class="fee-row">
            <span class="fee-row-label">{{ $t('Network fee') }}</span>
            <span class="fee-row-value">
              <q-spinner-dots v-if="payment?.feeEstimate?.isEstimating" size="14px" />
              <span v-else>{{ feeRowValueText }}</span>
            </span>
          </div>

          <!-- Action: slide-to-send for ≥ 20k sats, a tap button otherwise.
               This is the single commit gesture — no separate confirm screen,
               so a fixed-amount destination (locked input above) lands here
               with nothing extra to tap. -->
          <div class="cta-row confirm-cta">
            <SlideToSend
              v-if="requiresSlide"
              ref="slideRef"
              :label="slideLabel"
              :loading="isSending"
              :disabled="!canSubmit"
              @complete="emitConfirm"
            />
            <button
              v-else
              type="button"
              class="primary-cta"
              :disabled="!canSubmit || isSending"
              @click="emitConfirm"
            >
              <q-spinner-dots v-if="isSending" class="q-mr-sm" />
              <span>{{ primaryCtaLabel }}</span>
            </button>
            <!-- Status line during send takes priority over the generic fees
                 footnote, which only shows when no fee data is displayed. -->
            <div v-if="isSending && statusMessage" class="fee-footnote status-line">
              {{ statusMessage }}
            </div>
            <div v-else-if="!feeRowVisible && verb === 'send'" class="fee-footnote">
              {{ $t('Network fees apply') }}
            </div>
          </div>
        </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { useWalletStore } from '../stores/wallet'
import { mapState } from 'pinia'
import { fiatRatesService } from '../utils/fiatRates.js'
import { formatAmount } from '../utils/amountFormatting.js'
import { FIAT_SYMBOLS } from '../utils/fiatCurrencies.js'
import SlideToSend from './SlideToSend.vue'
import BrantaVerifiedBadge from './BrantaVerifiedBadge.vue'

const SLIDE_THRESHOLD_SATS = 20000

export default {
  name: 'PaymentConfirmSheet',
  components: { SlideToSend, BrantaVerifiedBadge },
  props: {
    modelValue: { type: Boolean, default: false },
    /**
     * Normalized payment payload. See file header for the full schema.
     * The component is presentational — the parent owns this object.
     */
    payment: { type: Object, default: null },
    walletCanPay: { type: Boolean, default: true },
    walletHint: { type: String, default: '' },
    isSending: { type: Boolean, default: false },
    /**
     * Verb mode. 'send' is the default outgoing-payment vocabulary;
     * 'redeem' switches every label to its incoming-withdrawal twin
     * ("Redeem from", "Slide to redeem", etc.) so LNURL-Withdraw can
     * use the same sheet without leaking send-specific copy.
     */
    verb: {
      type: String,
      default: 'send',
      validator: (v) => ['send', 'redeem'].includes(v)
    },
    /**
     * Optional status text shown alongside the spinner while
     * `isSending` is true. Useful for multi-stage operations like
     * LNURL-Withdraw ("Generating invoice…" → "Awaiting confirmation…")
     * where a bare spinner would hide what's actually happening.
     */
    statusMessage: { type: String, default: '' }
  },
  emits: ['update:modelValue', 'confirm', 'cancel'],
  data() {
    return {
      showAddress: false,
      displayAmount: '',
      currentCurrency: 'sats',
      isAmountFocused: false,
      comment: '',
      fiatRates: {},
      logoFailed: false
    }
  },
  computed: {
    ...mapState(useWalletStore, ['preferredFiatCurrency', 'denominationCurrency', 'useBip177Format']),

    show: {
      get() { return this.modelValue },
      set(v) { this.$emit('update:modelValue', v) }
    },

    // ───── Recipient ─────
    recipientName() {
      return this.payment?.recipient?.name || this.$t('Recipient')
    },
    recipientColor() {
      return this.payment?.recipient?.color || '#3B82F6'
    },
    recipientLogo() {
      return this.payment?.recipient?.logoUrl || ''
    },
    // Render the logo image only when we have a URL that has not failed to
    // load; otherwise the avatar falls back to the colored initial rather
    // than a broken-image glyph (this is a verified-merchant trust surface).
    showRecipientLogo() {
      return !!this.recipientLogo && !this.logoFailed
    },
    recipientInitial() {
      const explicit = this.payment?.recipient?.initial
      if (explicit) return explicit
      const name = this.payment?.recipient?.name
      return name ? name.charAt(0).toUpperCase() : '?'
    },
    recipientAddress() {
      return this.payment?.recipient?.address || ''
    },
    recipientAddressType() {
      return this.payment?.recipient?.addressType || 'lightning'
    },
    // Branta merchant verification, present only when the parent's adapter
    // attached it after a positive lookup. Absent on every unverified
    // payment, so the badge simply never renders in the common case.
    recipientVerification() {
      return this.payment?.recipient?.verification || null
    },

    // Fiat-payout service context (Tando, Bitzed, …), attached by the
    // parent adapter when the destination is a recognized phone-payout
    // Lightning Address. Absent on every normal payment, so the hint
    // simply never renders in the common case.
    recipientLnService() {
      return this.payment?.recipient?.lnService || null
    },

    // Label for the payment-indicator row: the human description when the
    // invoice / LNURL carried one, otherwise a payment-type fallback so the
    // row (and the address-reveal it hosts) is always present.
    paymentLabel() {
      if (this.payment?.description) return this.payment.description
      const labels = {
        lightning: this.$t('Lightning payment'),
        invoice: this.$t('Lightning payment'),
        spark: this.$t('Spark payment'),
        bitcoin: this.$t('Bitcoin payment'),
        lnurl: this.$t('LNURL payment'),
      }
      return labels[this.recipientAddressType] || this.$t('Payment')
    },

    // ───── Amount mode ─────
    amountMode() {
      return this.payment?.amount?.mode || 'free'
    },
    fixedSats() {
      return this.payment?.amount?.fixedSats || 0
    },
    minSats() {
      return this.payment?.amount?.minSats || 0
    },
    maxSats() {
      return this.payment?.amount?.maxSats || 0
    },

    fiatCurrencyCode() {
      return (this.preferredFiatCurrency || 'USD').toUpperCase()
    },
    fiatSymbol() {
      return FIAT_SYMBOLS[this.fiatCurrencyCode] || (this.fiatCurrencyCode + ' ')
    },
    unitPillLabel() {
      if (this.currentCurrency === 'sats') return 'sats'
      if (this.currentCurrency === 'btc') return 'BTC'
      return this.fiatCurrencyCode
    },

    // The numeric amount in sats derived from the input + currency mode.
    amountInSats() {
      if (this.amountMode === 'fixed') return this.fixedSats
      const n = parseFloat(this.displayAmount)
      if (!isFinite(n) || n <= 0) return 0
      if (this.currentCurrency === 'sats') return Math.floor(n)
      if (this.currentCurrency === 'btc')  return Math.floor(n * 100000000)
      const rate = this.fiatRates[this.fiatCurrencyCode]
      if (!rate) return 0
      return Math.floor((n / rate) * 100000000)
    },

    amountPlaceholder() {
      if (this.currentCurrency === 'sats') return '0'
      if (this.currentCurrency === 'btc')  return '0.00000000'
      return '0.00'
    },

    // Inline validation against fixed/range constraints. The keys are
    // registered in the en-US locale (see i18n/en-US/index.js); without
    // registration vue-i18n skips placeholder substitution and the user
    // sees a literal "{n}" in the UI.
    amountInvalidReason() {
      if (!this.displayAmount || this.amountMode === 'fixed') return ''
      const sats = this.amountInSats
      if (sats <= 0) return ''
      if (this.amountMode === 'range') {
        if (sats < this.minSats) return this.$t('Minimum is {n} sats', { n: this.minSats.toLocaleString() })
        if (sats > this.maxSats) return this.$t('Maximum is {n} sats', { n: this.maxSats.toLocaleString() })
      }
      return ''
    },

    isAmountAcceptable() {
      const sats = this.amountInSats
      if (sats <= 0) return false
      if (this.amountInvalidReason) return false
      return true
    },

    canSubmit() {
      return this.walletCanPay && this.isAmountAcceptable
    },

    rangeHintText() {
      if (this.amountMode !== 'range') return ''
      return `${this.$t('Min')} ${this.minSats.toLocaleString()} · ${this.$t('Max')} ${this.maxSats.toLocaleString()} sats`
    },

    // ───── Countdown (merchant-bounded payments) ─────
    countdownSeconds() {
      const s = this.payment?.countdown?.seconds
      return typeof s === 'number' && s > 0 ? Math.floor(s) : 0
    },

    countdownIsUrgent() {
      const threshold = this.payment?.countdown?.urgentBelow ?? 20
      return this.countdownSeconds > 0 && this.countdownSeconds <= threshold
    },

    formattedCountdown() {
      const s = this.countdownSeconds
      const m = Math.floor(s / 60)
      const r = s % 60
      return `${m}:${String(r).padStart(2, '0')}`
    },

    // ───── ZAR secondary (SA-retail merchant payments) ─────
    // The merchant QR carries a ZAR amount that we want visible alongside
    // whatever currency the user has set as their preferred display, so
    // they can sanity-check the conversion. We hide it when ZAR *is* the
    // user's preferred currency (in that case it's the primary line).
    zarSecondary() {
      const z = this.payment?.zarAmount
      if (!z) return ''
      if (this.fiatCurrencyCode === 'ZAR') return ''
      return z
    },

    // ───── Fee estimate ─────
    feeRowVisible() {
      const fe = this.payment?.feeEstimate
      if (!fe) return false
      if (fe.isEstimating) return true
      if (fe.label) return true
      return typeof fe.sats === 'number'
    },

    feeRowValueText() {
      const fe = this.payment?.feeEstimate
      if (!fe) return ''
      if (fe.label) return fe.label
      if (typeof fe.sats !== 'number') return ''
      if (fe.sats === 0) return this.$t('Free')
      return `${fe.sats.toLocaleString()} sats`
    },

    // Quick chips: only when the user is free to choose. For range mode
    // we filter to chips that fit the constraints so we never offer an
    // amount that would fail validation.
    quickAmounts() {
      if (this.amountMode === 'fixed') return []
      const baseSats = [1000, 5000, 10000, 21000]
      if (this.currentCurrency === 'sats') {
        const chips = baseSats.map(v => ({ value: v, label: this.formatChipLabel(v, 'sats') }))
        if (this.amountMode === 'range') {
          return chips.filter(c => c.value >= this.minSats && c.value <= this.maxSats)
        }
        return chips
      }
      if (this.currentCurrency === 'btc') return []
      const sym = this.fiatSymbol.trim()
      const chips = [1, 5, 10, 20].map(v => ({ value: v, label: `${sym}${v}` }))
      // No range filtering on fiat chips — sats conversion drift makes a
      // perfect filter unreliable; we let inline validation catch out-of-
      // range picks if the user taps one.
      return chips
    },

    requiresSlide() {
      return this.amountInSats >= SLIDE_THRESHOLD_SATS
    },

    fiatEquivalent() {
      const sats = this.amountInSats
      if (!sats || !this.fiatRates) return ''
      try {
        const currency = this.fiatCurrencyCode
        if (this.currentCurrency === currency.toLowerCase()) {
          return `≈ ${formatAmount(sats, this.useBip177Format)}`
        }
        const fiatValue = fiatRatesService.convertSatsToFiatSync(sats, currency)
        if (fiatValue === null) return ''
        const symbol = FIAT_SYMBOLS[currency] || currency + ' '
        return `≈ ${symbol}${fiatValue.toFixed(2)}`
      } catch {
        return ''
      }
    },

    formattedConfirmAmount() {
      const sats = this.amountInSats
      if (!sats) return ''
      // Always render the confirm-stage hero in sats-or-fiat-friendly form,
      // not BTC, since confirm is about reading at a glance.
      if (this.currentCurrency === 'sats' || this.currentCurrency === 'btc') {
        return `${sats.toLocaleString()} sats`
      }
      const n = parseFloat(this.displayAmount)
      if (isFinite(n) && n > 0) return `${this.fiatSymbol}${n.toFixed(2)}`
      return `${sats.toLocaleString()} sats`
    },

    // ───── Verb-aware copy ─────
    // Centralized so the rest of the template stays oblivious to the
    // send/redeem distinction. New verbs (e.g. 'pay-request') would land
    // here and ripple out cleanly.
    isRedeem() { return this.verb === 'redeem' },

    topTitle() {
      return this.isRedeem ? this.$t('Redeem from') : this.$t('Send to')
    },

    confirmSendLabel() {
      const verb = this.isRedeem ? this.$t('Redeem') : this.$t('Send')
      return `${verb} ${this.formattedConfirmAmount}`
    },

    slideLabel() {
      const phrase = this.isRedeem ? this.$t('Slide to redeem') : this.$t('Slide to send')
      return `${phrase} ${this.formattedConfirmAmount}`
    },

    primaryCtaLabel() {
      if (this.isSending) {
        return this.isRedeem ? this.$t('Redeeming...') : this.$t('Sending...')
      }
      // No valid amount entered yet (free/range): prompt to enter one.
      if (!this.isAmountAcceptable && this.amountMode !== 'fixed') {
        return this.$t('Enter amount')
      }
      return this.confirmSendLabel
    }
  },
  watch: {
    /**
     * Reset only on the open transition. We deliberately do NOT watch
     * `payment` deeply: the parent rebuilds that object whenever any of
     * its dependencies change (merchant countdown ticking each second,
     * fee estimate resolving, etc.), and a deep watcher would wipe the
     * user's typed amount on every tick. Internal state is fresh per
     * open, which is the only meaningful identity for "this sheet is
     * showing a new payment".
     */
    show(v) {
      if (v) {
        this.resetForFreshOpen()
        this.loadFiatRates()
      }
    },
    // A new/changed logo URL (e.g. a Branta verification arriving async
    // after the sheet opened) gets a fresh chance to load.
    recipientLogo() {
      this.logoFailed = false
    }
  },
  methods: {
    async loadFiatRates() {
      try {
        await fiatRatesService.ensureRatesLoaded()
        this.fiatRates = await fiatRatesService.getRates()
      } catch (e) {
        console.error('Could not load fiat rates:', e)
      }
    },

    resetForFreshOpen() {
      this.showAddress = false
      this.comment = ''
      this.logoFailed = false
      this.currentCurrency = (this.denominationCurrency || 'sats')
      // For fixed mode, prefill the visible input so users can read the
      // amount they're about to send. The `readonly` flag on the input
      // keeps it un-editable.
      if (this.amountMode === 'fixed') {
        this.displayAmount = String(this.fixedSats)
        this.currentCurrency = 'sats'
      } else {
        this.displayAmount = ''
      }
    },

    onTopAction() {
      this.show = false
      this.$emit('cancel')
    },

    onAmountChange() { /* reactive — kept for symmetry with focus/blur */ },
    onAmountFocus()  { this.isAmountFocused = true },
    onAmountBlur() {
      this.isAmountFocused = false
      // Light formatting on blur — same UX as PaymentModal.
      const n = parseFloat(this.displayAmount)
      if (!isFinite(n)) return
      if (this.currentCurrency === 'sats') this.displayAmount = String(Math.floor(n))
      else if (this.currentCurrency === 'btc') this.displayAmount = n.toFixed(8)
      else this.displayAmount = n.toFixed(2)
    },

    toggleCurrency() {
      if (this.amountMode === 'fixed') return
      const order = ['sats', this.fiatCurrencyCode.toLowerCase()]
      const i = order.indexOf(this.currentCurrency)
      this.currentCurrency = order[(i + 1) % order.length]
      // Clear the input so the user re-enters in the new unit — converting
      // mid-stream produces awkward rounded values that look broken.
      this.displayAmount = ''
    },

    pickQuickAmount(q) {
      if (this.amountMode === 'fixed') return
      this.displayAmount = String(q.value)
    },

    isQuickActive(q) {
      return parseFloat(this.displayAmount) === q.value
    },

    formatChipLabel(value, unit) {
      if (unit === 'sats') {
        if (value >= 1000) return `${value / 1000}k`
        return String(value)
      }
      return String(value)
    },

    emitConfirm() {
      if (!this.walletCanPay || !this.isAmountAcceptable) {
        this.$refs.slideRef?.reset()
        return
      }
      this.$emit('confirm', {
        amountSats: this.amountInSats,
        comment: this.comment || ''
      })
    },

    /**
     * Public API — the parent calls this on send-failure so the slide
     * thumb returns to the start and the confirm button re-enables.
     */
    resetSlide() {
      this.$refs.slideRef?.reset()
    }
  }
}
</script>

<style scoped>
/* ─── Surface ─── */
.sheet-card {
  width: 100%;
  max-width: 520px;
  max-height: 92vh;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: 'Manrope', sans-serif;
  padding-bottom: max(1rem, var(--safe-bottom, 0px));
}

.sheet-card-dark { box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.55); }
.sheet-card-light {
  border-top: 1px solid var(--border-card);
  box-shadow: 0 -20px 50px rgba(40, 34, 20, 0.12);
}

.grab-bar {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--text-muted);
  opacity: 0.45;
  margin: 8px auto 4px;
  flex-shrink: 0;
}

/* ─── Top row ─── */
.top-row {
  display: flex;
  align-items: center;
  padding: 4px 12px 8px;
  flex-shrink: 0;
}
.top-btn { width: 36px; height: 36px; color: var(--text-secondary); }
.top-title {
  flex: 1;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.005em;
}
.top-spacer { width: 36px; }

/* ─── Stages ─── */
.stage {
  display: flex;
  flex-direction: column;
  padding: 8px 20px 12px;
  gap: 14px;
  overflow-y: auto;
}
/* ─── Recipient ─── */
.recipient {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  background: var(--bg-input);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-card);
}

.recipient-avatar {
  width: 56px;
  height: 56px;
  min-width: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.18);
  flex-shrink: 0;
  overflow: hidden;
}
.recipient-avatar.has-logo { background: #fff; }
.recipient-logo { width: 100%; height: 100%; object-fit: cover; }

.recipient-meta { flex: 1; min-width: 0; }

.recipient-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.recipient-name {
  flex: 1;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Fiat-payout service hint (Tando, Bitzed, …): a quiet line under the
   phone number reminding the user the money lands as local currency. */
.ln-service-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--text-secondary);
}

/* Countdown chip — neutral grey for the standing time, flips to a soft
   red wash once the remaining time crosses the urgent threshold so users
   notice without us shouting. */
.countdown-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  background: rgba(120, 120, 120, 0.14);
  color: var(--text-secondary);
  box-shadow: inset 0 0 0 1px rgba(120, 120, 120, 0.22);
}

.countdown-chip--urgent {
  background: rgba(239, 68, 68, 0.14);
  color: #DC2626;
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.30);
  animation: countdown-pulse 1s ease-in-out infinite;
}

.body--dark .countdown-chip--urgent {
  color: #FCA5A5;
}

@keyframes countdown-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}

/* The recipient hero is identity-only now (logo, name, verified badge).
   The "via X" line and inline address reveal moved to the payment
   indicator below the hero. */
.fade-collapse-enter-active, .fade-collapse-leave-active {
  transition: opacity 0.16s ease, max-height 0.2s ease;
  overflow: hidden;
  max-height: 80px;
}
.fade-collapse-enter-from, .fade-collapse-leave-to { opacity: 0; max-height: 0; }

/* ─── Wallet hint ─── */
.wallet-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: 12.5px;
  line-height: 1.4;
  background: rgba(245, 158, 11, 0.10);
  color: #B45309;
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.22);
}
.body--dark .wallet-hint {
  background: rgba(245, 158, 11, 0.12);
  color: #F59E0B;
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.28);
}

/* ─── Payment indicator (compose) ─── */
/* The payment description / type row. When a destination exists it is a
   button that folds out the raw address for manual verification, replacing
   the redundant "via X" line that used to live in the recipient hero. */
.payment-indicator { display: flex; flex-direction: column; }
.payment-indicator-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 10px 12px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  font-family: inherit;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease;
}
.payment-indicator-row--static { cursor: default; }
.body--light .payment-indicator-row:not(.payment-indicator-row--static):hover { background: rgba(17, 24, 39, 0.06); }
.body--dark .payment-indicator-row:not(.payment-indicator-row--static):hover { background: rgba(255, 255, 255, 0.05); }
.payment-indicator-icon { color: var(--text-muted); flex-shrink: 0; }
.payment-indicator-label {
  flex: 1;
  min-width: 0;
  text-align: left;
  word-break: break-word;
}
.payment-indicator-chev {
  color: var(--text-muted);
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform 0.18s ease;
}
.payment-indicator-chev.flipped { transform: rotate(180deg); }
.payment-indicator-address {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
  line-height: 1.5;
}

/* ─── Amount stage ─── */
.amount-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0 4px;
  gap: 10px;
}
.amount-stage--locked .amount-input { color: var(--text-primary); cursor: default; }

.amount-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 48px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  caret-color: var(--color-green);
  padding: 0;
}
.amount-input::placeholder { color: var(--text-muted); opacity: 0.45; }
.amount-input--invalid { color: #EF4444; }

.unit-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  border: none;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.unit-pill:hover:not(:disabled) { color: var(--text-primary); }
.unit-pill:disabled { cursor: default; opacity: 0.7; }
.body--light .unit-pill { background: rgba(17, 24, 39, 0.05); }

.fiat-shadow { font-size: 14px; font-weight: 500; color: var(--text-muted); min-height: 18px; }

/* ZAR secondary — sits below fiat-shadow for SA-retail merchants when
   the user's preferred fiat differs from the QR's native ZAR amount. */
.zar-secondary {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}

/* Fee row — slim, neutral, non-clickable. Same visual rhythm as the
   "Network fees apply" footnote it replaces when concrete fee data
   exists. Confirm-stage variant gets slightly more breathing room. */
.fee-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  font-size: 12.5px;
  color: var(--text-secondary);
  min-height: 32px;
}

.fee-row-label {
  font-weight: 500;
  letter-spacing: 0.01em;
}

.fee-row-value {
  font-weight: 600;
  color: var(--text-primary);
  display: inline-flex;
  align-items: center;
  font-variant-numeric: tabular-nums;
}

.range-hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  letter-spacing: 0.01em;
}

.amount-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: #EF4444;
}

/* ─── Quick chips ─── */
.quick-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.quick-chip {
  height: 38px;
  border-radius: var(--radius-pill);
  border: none;
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.08s ease;
}
.quick-chip:hover { color: var(--text-primary); }
.quick-chip:active { transform: scale(0.97); }
.quick-chip.active {
  background: var(--brand-accent-soft);
  color: var(--brand-accent);
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.32);
}
.body--light .quick-chip.active { box-shadow: inset 0 0 0 1px rgba(5, 149, 115, 0.28); }

/* ─── Note ─── */
.note-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
}
.note-icon { color: var(--text-muted); flex-shrink: 0; }
.note-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  color: var(--text-primary);
}
.note-input::placeholder { color: var(--text-muted); }

/* ─── CTA ─── */
.cta-row { margin-top: 6px; }
.confirm-cta { margin-top: 18px; display: flex; flex-direction: column; gap: 10px; }

.primary-cta {
  width: 100%;
  height: 52px;
  border-radius: var(--radius-pill);
  border: none;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  background: var(--gradient-green);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: filter 0.15s ease, transform 0.08s ease, opacity 0.15s ease;
}
.body--light .primary-cta { background: var(--btn-neutral-bg); color: var(--btn-neutral-fg); }
.primary-cta:hover:not(:disabled) { filter: brightness(1.05); }
.primary-cta:active:not(:disabled) { transform: scale(0.985); filter: brightness(0.95); }
.primary-cta:disabled { opacity: 0.4; cursor: not-allowed; }

.fee-footnote { text-align: center; font-size: 11px; color: var(--text-muted); }

/* Optional rail line (e.g. LNURL-Withdraw → "Lightning · Withdrawal"). */
.amount-confirm-via {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

@media (max-width: 480px) {
  .stage { padding: 8px 16px 10px; gap: 12px; }
  .recipient { padding: 12px; }
  .recipient-avatar { width: 48px; height: 48px; min-width: 48px; font-size: 19px; }
  .amount-input { font-size: 40px; }
  .primary-cta { height: 50px; font-size: 14.5px; }
}
</style>
