<!--
  PaymentConfirmSheet
  Single shared confirm-and-send sheet used everywhere a user reviews a
  payment before it goes out: scanner-driven LNURL/Lightning Address /
  invoice flows from Wallet.vue, and (next) the contact-driven flow from
  PaymentModal.

  Responsibilities — strictly presentational:
    - One screen: recipient hero, amount (editable for free/range, locked for
      fixed), optional comment, fee. The Branta verification seal sits in the
      top-right corner when the parent attached a verified result.
    - The commit control morphs into the filling ProgressCta on submit:
      slide-to-confirm above the high-value threshold, a tap button below it.
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
        <q-btn flat round dense @click="onTopAction" class="top-btn glass-back-btn" :aria-label="$t('Back')">
          <Icon icon="tabler:chevron-left" width="20" height="20" />
        </q-btn>
        <div class="top-title">{{ topTitle }}</div>
        <!-- Verification sits in the top-right corner (Blitz-style): a single
             tappable seal, not an inline pill under the recipient name. -->
        <div class="top-action">
          <BrantaVerifiedBadge
            v-if="recipientVerification"
            :verify-url="recipientVerification.verifyUrl"
            icon-only
          />
        </div>
      </header>

      <!--
        One confirm-and-send screen. The amount is editable for free/range and
        locked for fixed (so a fixed-amount invoice / LNURL lands here directly,
        with nothing to tap before the slide/Send), and the commit gesture lives
        on the same screen. Each piece of info (recipient, payment type, amount,
        fee) is shown exactly once.
      -->
      <div class="stage stage-compose">
          <!-- Amount leads: the recipient was chosen on the screen before,
               so the number is this screen's job and takes the stage.
               Locked, range, or free depending on mode. -->
          <section class="amount-stage" :class="{ 'amount-stage--locked': amountMode === 'fixed' }">
            <input
              v-model="displayAmount"
              @input="onAmountChange"
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
            <!-- One helper row in the banking manner: limits on the left,
                 the conversion on the right. Either side may be empty. -->
            <div v-if="limitsHelperText || fiatEquivalent" class="amount-helper">
              <span>{{ limitsHelperText }}</span>
              <span class="amount-helper-convert">{{ fiatEquivalent }}</span>
            </div>
            <!-- Secondary ZAR line for SA-retail merchants when the
                 user's preferred fiat isn't ZAR. The merchant QR carries
                 a ZAR amount that we want to remain visible alongside
                 the user's chosen display currency. -->
            <div v-if="zarSecondary" class="zar-secondary">
              R{{ zarSecondary }} ZAR
            </div>
          </section>

          <!-- Inline validation -->
          <div v-if="amountInvalidReason" class="amount-error">
            <Icon icon="tabler:alert-circle" width="13" height="13" />
            <span>{{ amountInvalidReason }}</span>
          </div>

          <!-- The recipient cell: who (avatar + name), where (one quiet
               identifier line), and everything else behind the info glyph.
               No ambiguous chevron and no verification marks the app
               cannot honestly make. -->
          <section class="recipient-cell">
            <div
              class="recipient-avatar"
              :class="{
                'has-logo': showRecipientLogo,
                'recipient-avatar--silhouette': isSilhouetteRecipient
              }"
              :style="showRecipientLogo
                ? (recipientLogoBg ? { background: recipientLogoBg } : null)
                : (isSilhouetteRecipient ? null : { background: recipientColor })"
            >
              <img
                v-if="showRecipientLogo"
                :src="recipientLogo"
                :alt="recipientName"
                class="recipient-logo"
                :class="{ 'recipient-logo--contain': recipientLogoContain }"
                :style="recipientLogoContain && recipientLogoInset
                  ? { padding: recipientLogoInset }
                  : null"
                @error="logoFailed = true"
              />
              <!-- Picture-less contact: the app-wide filled-bust
                   silhouette, never a colored initial. -->
              <svg
                v-else-if="isSilhouetteRecipient"
                class="recipient-glyph"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 12.3a4.05 4.05 0 1 0 0-8.1 4.05 4.05 0 0 0 0 8.1Zm0 2.2c-4.3 0-7.6 2.6-8.1 6.3h16.2c-.5-3.7-3.8-6.3-8.1-6.3Z" />
              </svg>
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
              <div v-if="recipientAddress" class="recipient-addr">{{ recipientAddress }}</div>
            </div>
            <button
              v-if="addressNeedsDetails"
              type="button"
              class="recipient-info"
              :aria-label="$t('Details')"
              :aria-expanded="showAddress ? 'true' : 'false'"
              @click="showAddress = !showAddress"
            >
              <Icon icon="tabler:info-circle" width="17" height="17" />
            </button>
          </section>

          <!-- The labeled detail panel behind the info glyph, with copy
               for manual verification against another surface. Only for
               destinations the cell's line cannot show whole. -->
          <transition name="fade-collapse">
            <div v-if="showAddress && addressNeedsDetails" class="recipient-details">
              <div class="recipient-details-copy">
                <div class="recipient-details-label">{{ $t('Address') }}</div>
                <div class="recipient-details-value">{{ recipientAddress }}</div>
              </div>
              <button
                type="button"
                class="recipient-details-copy-btn"
                :aria-label="$t('Copy')"
                @click="copyAddress"
              >
                <Icon :icon="addressCopied ? 'tabler:check' : 'tabler:copy'" width="14" height="14" />
              </button>
            </div>
          </transition>

          <!-- Rare context keeps its quiet lines under the cell: the
               fiat-payout delivery hint, the hosting-wallet name, the
               invoice's own description, the redeem rail override. -->
          <div v-if="recipientLnService" class="ln-service-hint">
            <Icon icon="tabler:device-mobile" width="13" height="13" />
            <span>{{ recipientLnService.hint }}</span>
          </div>
          <div v-else-if="recipientWalletBrand" class="wallet-brand-hint">
            <Icon icon="tabler:wallet" width="13" height="13" />
            <span>{{ recipientWalletBrand }}</span>
          </div>
          <div v-if="payment?.description" class="payment-desc">
            <Icon icon="tabler:file-description" width="14" height="14" />
            <span>{{ payment.description }}</span>
          </div>
          <div v-if="payment?.recipient?.viaOverride" class="amount-confirm-via">
            {{ payment.recipient.viaOverride }}
          </div>

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

          <!-- Comment: sits directly under the amount block, in the slot
               the preset chips used to hold, so it stays visible above the
               CTA even with the keyboard up. -->
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

          <!-- Flow-specific extras (e.g. the on-chain fee panel: balance
               row, speed cards, fee breakdown). Slot content renders
               inside the stage so it inherits the sheet's rhythm; when
               present it owns fee display, so the generic footnote below
               stays out of the way. -->
          <slot name="extras" />

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

        </div>

        <!-- Commit control — pinned OUTSIDE the scroll region so the commit
             affordance (and its footnote) is always on screen, whatever the
             middle band holds. Idle: slide-to-confirm above the threshold, a
             tap button below it. Once committed (either way) it morphs into
             the filling ProgressCta — trickle while in flight, then 100% +
             check on success — bridging cleanly into the confirmation screen
             with no separate confirm step and no blank in between. -->
        <div class="cta-row confirm-cta">
            <transition name="cta-swap" mode="out-in">
              <ProgressCta
                v-if="isSending || isComplete"
                key="progress"
                :label="sendingLabel"
                :done="isComplete"
                :tall="requiresSlide"
              />
              <SlideToSend
                v-else-if="requiresSlide"
                key="slide"
                ref="slideRef"
                :label="slideLabel"
                :disabled="!canSubmit"
                @complete="emitConfirm"
              />
              <button
                v-else
                key="button"
                type="button"
                class="primary-cta"
                :disabled="!canSubmit"
                @click="emitConfirm"
              >
                {{ primaryCtaLabel }}
              </button>
            </transition>

            <!-- Status line during send takes priority over the generic fees
                 footnote, which only shows when no fee data is displayed. -->
            <div v-if="isSending && statusMessage" class="fee-footnote status-line">
              {{ statusMessage }}
            </div>
            <div v-else-if="!isSending && !isComplete && !feeRowVisible && !hasExtras && verb === 'send'" class="fee-footnote">
              {{ $t('Network fees apply') }}
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
import ProgressCta from './ProgressCta.vue'

// Below this, a tap "Send" button; above it, slide-to-confirm. Both morph into
// the same filling ProgressCta once committed.
const SLIDE_THRESHOLD_SATS = 10000

export default {
  name: 'PaymentConfirmSheet',
  components: { SlideToSend, BrantaVerifiedBadge, ProgressCta },
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
     * Flips true the moment the payment SUCCEEDS, so the CTA can snap its
     * fill to 100% + a checkmark before the success screen appears. Stays
     * false on failure (the CTA returns to idle and the slide resets).
     */
    isComplete: { type: Boolean, default: false },
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
    statusMessage: { type: String, default: '' },
    /**
     * Extra parent-owned commit condition, ANDed into the standard gates
     * (wallet capability + amount validity). Used by flows whose slot
     * content must settle before committing — e.g. the on-chain fee
     * panel: no confirmed fee quote, no send. Defaults open so ordinary
     * payments never need to pass it.
     */
    commitGate: { type: Boolean, default: true }
  },
  emits: ['update:modelValue', 'confirm', 'cancel', 'amount-changed'],
  data() {
    return {
      showAddress: false,
      addressCopied: false,
      displayAmount: '',
      currentCurrency: 'sats',
      comment: '',
      fiatRates: {},
      logoFailed: false,
      _copyTimer: null
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
    // Art without its own background plate (merchant marks from Branta, a
    // wordmark, a bare wallet logomark) is fitted whole inside the circle
    // rather than cropped edge-to-edge. App-icon art stays full-bleed.
    recipientLogoContain() {
      return this.payment?.recipient?.logoContain === true
    },
    // Optional per-logo override of the contain padding, for art whose
    // silhouette is known to clear the circle at a tighter inset (see
    // walletBrands). Empty -> the conservative default in the stylesheet.
    recipientLogoInset() {
      return this.payment?.recipient?.logoInset || ''
    },
    // Optional avatar backdrop for a logo that needs one (e.g. ZBD's white
    // wordmark, which would vanish on the default white circle). Empty -> the
    // default `.has-logo` white background.
    recipientLogoBg() {
      return this.payment?.recipient?.logoBg || ''
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
    /**
     * Whether the destination earns the info glyph and its detail panel.
     * The cell's identifier line shows about 35 mono characters before it
     * truncates on the narrowest phones; anything at or under that is
     * already fully readable in place (a Lightning address, typically),
     * and repeating it in a panel would say the same thing twice. Long
     * strings (invoices, LNURLs, on-chain addresses) truncate, so they
     * keep the panel with the full value and copy.
     */
    addressNeedsDetails() {
      return this.recipientAddress.length > 34
    },
    // Branta merchant verification, present only when the parent's adapter
    // attached it after a positive lookup. Absent on every unverified
    // payment, so the badge simply never renders in the common case.
    recipientVerification() {
      return this.payment?.recipient?.verification || null
    },

    // Picture-less matched contact → the app-wide silhouette mark. A
    // loaded logo (photo / brand / Branta) always wins over it.
    isSilhouetteRecipient() {
      return !!this.payment?.recipient?.silhouette && !this.showRecipientLogo
    },

    // Fiat-payout service context (Tando, Bitzed, …), attached by the
    // parent adapter when the destination is a recognized phone-payout
    // Lightning Address. Absent on every normal payment, so the hint
    // simply never renders in the common case.
    recipientLnService() {
      return this.payment?.recipient?.lnService || null
    },

    // Hosting consumer wallet name (Wallet of Satoshi, Phoenix, Blink, …),
    // attached by the parent adapter when the address domain matches a known
    // wallet. Absent otherwise, so the brand hint never renders in that case.
    recipientWalletBrand() {
      return this.payment?.recipient?.walletBrand || null
    },


    // LUD-21 / currency-extension (#207) payout currency, present when the
    // provider returns one (fiat-payout addresses: ChapSmart TZS, Tando KES,
    // Bitzed ZMW). Shape: { code, symbol, decimals, minSendable, maxSendable,
    // multiplier }, where multiplier is millisats per 1 unit of the currency.
    // Lets the sender denominate in the recipient's currency with the sat cost
    // derived from the callback's own multiplier — no external rate needed.
    payoutCurrency() {
      return this.payment?.payoutCurrency || null
    },
    // True while the amount is being entered in the recipient's local currency.
    isLocalDenomination() {
      return !!this.payoutCurrency && this.currentCurrency === this.payoutCurrency.code
    },
    // Single source of truth for how the amount is denominated, so every
    // consumer switches on one value instead of re-deriving from currentCurrency
    // (which now also holds a payout code like 'TZS', not just sats/btc/fiat).
    denominationMode() {
      if (this.isLocalDenomination) return 'local'
      if (this.currentCurrency === 'sats') return 'sats'
      if (this.currentCurrency === 'btc') return 'btc'
      return 'fiat'
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
      if (this.isLocalDenomination) return this.payoutCurrency.code
      if (this.currentCurrency === 'sats') return 'sats'
      if (this.currentCurrency === 'btc') return 'BTC'
      return this.fiatCurrencyCode
    },

    // The numeric amount in sats derived from the input + currency mode.
    amountInSats() {
      if (this.amountMode === 'fixed') return this.fixedSats
      const n = parseFloat(this.displayAmount)
      if (!isFinite(n) || n <= 0) return 0
      // Local payout currency: sats = localAmount × (millisats-per-unit) / 1000.
      // This is an estimate for the recipient amount; the provider fee is added
      // on top and reflected in the real invoice we fetch at send time.
      if (this.isLocalDenomination) {
        return Math.floor((n * this.payoutCurrency.multiplier) / 1000)
      }
      if (this.currentCurrency === 'sats') return Math.floor(n)
      if (this.currentCurrency === 'btc')  return Math.floor(n * 100000000)
      const rate = this.fiatRates[this.fiatCurrencyCode]
      if (!rate) return 0
      return Math.floor((n / rate) * 100000000)
    },

    amountPlaceholder() {
      if (this.isLocalDenomination) return this.payoutCurrency.decimals > 0 ? '0.00' : '0'
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
      // Local-currency mode: validate the entered LOCAL amount against the
      // provider's own min/max. Runs before the sats>0 check below so a
      // sub-1-sat entry still gets a clear "minimum" message instead of a
      // silently-disabled button. The sat estimate excludes the provider fee,
      // so the sat bounds don't line up and must not be used here.
      if (this.isLocalDenomination) {
        const n = parseFloat(this.displayAmount)
        if (!isFinite(n) || n <= 0) return ''
        const { minSendable, maxSendable, multiplier, code } = this.payoutCurrency
        // Smallest local amount worth at least 1 sat — guards the case where a
        // provider omits its local minimum (avoids a silent 0-sat dead-end).
        const effectiveMin = minSendable || Math.max(1, Math.ceil(1000 / multiplier))
        if (n < effectiveMin) return this.$t('Minimum is {n} {code}', { n: effectiveMin.toLocaleString(), code })
        if (maxSendable && n > maxSendable) return this.$t('Maximum is {n} {code}', { n: maxSendable.toLocaleString(), code })
        return ''
      }
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
      return this.walletCanPay && this.isAmountAcceptable && this.commitGate
    },

    // The left half of the amount helper row. Only range mode has bounds
    // to show; free and fixed leave the slot empty and the conversion
    // holds the row alone.
    limitsHelperText() {
      if (this.amountMode !== 'range') return ''
      if (this.isLocalDenomination) {
        const { minSendable, maxSendable, code } = this.payoutCurrency
        // Only show the bounds we actually have — never "Limits 0 – 0".
        if (!minSendable && !maxSendable) return ''
        if (minSendable && maxSendable) {
          return this.$t('Limits {min} – {max} {unit}', {
            min: minSendable.toLocaleString(),
            max: maxSendable.toLocaleString(),
            unit: code
          })
        }
        const parts = []
        if (minSendable) parts.push(`${this.$t('Min')} ${minSendable.toLocaleString()}`)
        if (maxSendable) parts.push(`${this.$t('Max')} ${maxSendable.toLocaleString()}`)
        return `${parts.join(' · ')} ${code}`
      }
      // The limits speak the denomination the user is typing in. In fiat
      // mode the min rounds UP to the cent and the max DOWN, so the row
      // never promises an amount the sat bounds would reject.
      if (this.denominationMode === 'fiat' && this.fiatRates) {
        const currency = this.fiatCurrencyCode
        const min = fiatRatesService.convertSatsToFiatSync(this.minSats, currency)
        const max = fiatRatesService.convertSatsToFiatSync(this.maxSats, currency)
        if (min !== null && max !== null) {
          const grouped = (v) => v.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })
          return this.$t('Limits {min} – {max} {unit}', {
            min: this.fiatSymbol + grouped(Math.ceil(min * 100) / 100),
            max: this.fiatSymbol + grouped(Math.floor(max * 100) / 100),
            unit: currency
          })
        }
        // Rates not loaded yet: fall through to the sat bounds below.
      }
      if (this.denominationMode === 'btc') {
        const toBtc = (sats) => (sats / 100000000).toLocaleString(undefined, { maximumFractionDigits: 8 })
        return this.$t('Limits {min} – {max} {unit}', {
          min: toBtc(this.minSats),
          max: toBtc(this.maxSats),
          unit: 'BTC'
        })
      }
      return this.$t('Limits {min} – {max} {unit}', {
        min: this.minSats.toLocaleString(),
        max: this.maxSats.toLocaleString(),
        unit: 'sats'
      })
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

    requiresSlide() {
      // Tap button up to the threshold; slide-to-confirm above it. Flows
      // can force the deliberate gesture regardless of amount (on-chain
      // sends: every transaction is irreversible, so always slide).
      return !!this.payment?.forceSlide || this.amountInSats > SLIDE_THRESHOLD_SATS
    },

    // True when the parent filled the `extras` slot (e.g. the on-chain
    // fee panel). Slot content owns its own fee display then, so the
    // generic "Network fees apply" footnote stays out of the way.
    hasExtras() {
      return !!this.$slots.extras
    },

    fiatEquivalent() {
      const sats = this.amountInSats
      if (!sats) return ''
      // Denominating in the recipient's currency → the shadow shows the sat
      // estimate for the amount (the recipient still receives the exact local
      // amount; the fee is added on top in the real invoice).
      if (this.isLocalDenomination) {
        return `≈ ${formatAmount(sats, this.useBip177Format)}`
      }
      if (!this.fiatRates) return ''
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
      // Local-currency mode: the commit label MUST read in the recipient's
      // currency (e.g. "10,000 TZS"), never the sender's global fiat symbol.
      if (this.denominationMode === 'local') {
        const n = parseFloat(this.displayAmount)
        if (!isFinite(n) || n <= 0) return `${sats.toLocaleString()} sats`
        const decimals = this.payoutCurrency.decimals || 0
        const local = n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        return `${local} ${this.payoutCurrency.code}`
      }
      // Render sats/btc as sats (confirm is about reading at a glance).
      if (this.denominationMode === 'sats' || this.denominationMode === 'btc') {
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

    // Idle tap-button label (the in-flight / done states are owned by
    // ProgressCta now, so this no longer handles the sending case).
    primaryCtaLabel() {
      // No valid amount entered yet (free/range): prompt to enter one.
      if (!this.isAmountAcceptable && this.amountMode !== 'fixed') {
        return this.$t('Enter amount')
      }
      return this.confirmSendLabel
    },

    // In-flight label shown inside the filling ProgressCta.
    sendingLabel() {
      return this.isRedeem ? this.$t('Redeeming...') : this.$t('Sending...')
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
    },
    /**
     * Live amount signal for parents whose slot content depends on the
     * entered amount (the on-chain fee panel quotes per amount). Emits
     * the normalized sat value on every change, any denomination.
     */
    amountInSats(sats) {
      this.$emit('amount-changed', sats)
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

    /** From the detail panel: copy the raw destination for cross-checking. */
    async copyAddress() {
      if (!this.recipientAddress) return
      try {
        await navigator.clipboard.writeText(this.recipientAddress)
        this.addressCopied = true
        if (this._copyTimer) clearTimeout(this._copyTimer)
        this._copyTimer = setTimeout(() => { this.addressCopied = false }, 1600)
      } catch {
        // Clipboard can be unavailable (permissions); the string stays
        // selectable in the panel, so failing quietly loses nothing.
      }
    },

    resetForFreshOpen() {
      this.showAddress = false
      this.addressCopied = false
      this.comment = ''
      this.logoFailed = false
      // Fiat-payout addresses default to the recipient's own currency (the
      // natural "send 10,000 shillings" model); everything else uses the user's
      // saved denomination preference.
      this.currentCurrency = this.payoutCurrency ? this.payoutCurrency.code : (this.denominationCurrency || 'sats')
      // For fixed mode, prefill the visible input so users can read the
      // amount they're about to send. The `readonly` flag on the input
      // keeps it un-editable.
      if (this.amountMode === 'fixed') {
        this.displayAmount = String(this.fixedSats)
        this.currentCurrency = 'sats'
      } else if (this.payment?.amount?.defaultAmount) {
        this.displayAmount = String(this.payment.amount.defaultAmount)
        this.currentCurrency = 'sats'
      } else {
        this.displayAmount = ''
      }
    },

    onTopAction() {
      this.show = false
      this.$emit('cancel')
    },

    onAmountChange() {
      // Sanitize as the user types so parseFloat can never silently truncate at
      // a grouping separator (e.g. "2,500" → 2500, or "2500,000" → 2500 → a
      // 1000x underpayment). Keep only digits and a single decimal point, and
      // drop the fractional part entirely for integer units (sats, or a
      // 0-decimal local currency like TZS).
      let v = String(this.displayAmount || '').replace(/[^0-9.]/g, '')
      const dot = v.indexOf('.')
      const integerOnly = this.currentCurrency === 'sats' ||
        (this.isLocalDenomination && this.payoutCurrency.decimals === 0)
      if (dot !== -1) {
        v = integerOnly
          ? v.slice(0, dot)
          : v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '')
      }
      if (v !== this.displayAmount) this.displayAmount = v
    },
    onAmountBlur() {
      // Light formatting on blur — same UX as PaymentModal.
      const n = parseFloat(this.displayAmount)
      if (!isFinite(n)) return
      if (this.isLocalDenomination) {
        this.displayAmount = this.payoutCurrency.decimals > 0
          ? n.toFixed(this.payoutCurrency.decimals)
          : String(Math.floor(n))
      }
      else if (this.currentCurrency === 'sats') this.displayAmount = String(Math.floor(n))
      else if (this.currentCurrency === 'btc') this.displayAmount = n.toFixed(8)
      else this.displayAmount = n.toFixed(2)
    },

    toggleCurrency() {
      if (this.amountMode === 'fixed') return
      // Fiat-payout addresses toggle between the recipient's currency and sats;
      // everything else toggles between sats and the user's global fiat.
      const order = this.payoutCurrency
        ? [this.payoutCurrency.code, 'sats']
        : ['sats', this.fiatCurrencyCode.toLowerCase()]
      const i = order.indexOf(this.currentCurrency)
      this.currentCurrency = order[(i + 1) % order.length]
      // Clear the input so the user re-enters in the new unit — converting
      // mid-stream produces awkward rounded values that look broken.
      this.displayAmount = ''
    },

    /**
     * Public (called via ref): set the amount from outside, in sats.
     * Used by slot content that owns a "Use all" affordance (on-chain
     * fee panel) — switches the denomination to sats so the written
     * value means exactly what the caller computed.
     */
    setAmountSats(sats) {
      if (this.amountMode === 'fixed') return
      this.currentCurrency = 'sats'
      this.displayAmount = String(Math.max(0, Math.floor(sats)))
    },

    emitConfirm() {
      if (!this.canSubmit) {
        this.$refs.slideRef?.reset()
        return
      }
      const payload = {
        amountSats: this.amountInSats,
        comment: this.comment || ''
      }
      // When denominating in the recipient's currency, carry the exact local
      // amount + code so the parent can request an Option-A (currency) invoice:
      // the recipient then receives exactly this amount, provider fee on top.
      // Round to the currency's decimals so the callback never receives an
      // over-precise value (the input may not have blurred before slide-to-send).
      if (this.isLocalDenomination) {
        const decimals = this.payoutCurrency.decimals || 0
        const amount = Number(parseFloat(this.displayAmount).toFixed(decimals))
        payload.payout = { code: this.payoutCurrency.code, amount }
      }
      this.$emit('confirm', payload)
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
  max-height: min(94vh, calc(100vh - var(--safe-top, 0px) - 8px));
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
.top-btn { /* size + glass come from .glass-back-btn (app.css) */ }
.top-title {
  flex: 1;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.005em;
}
/* Mirrors the left button's width so the title stays optically centered;
   holds the top-right verification seal when present. */
.top-action {
  width: 40px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

/* ─── Stages ───
   The stage is the ONLY scroll region, and with the compressed rhythm
   below it should never actually scroll in the normal states — the
   overflow is a safety net for extreme content (long memos, the
   on-chain panel on very short viewports), never the design. The
   commit control lives outside it, always on screen. */
.stage {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 6px 20px 8px;
  gap: 12px;
  overflow-y: auto;
}

@supports (height: 1dvh) {
  .sheet-card {
    max-height: min(94dvh, calc(100dvh - var(--safe-top, 0px) - 8px));
  }
}
/* ─── Recipient ───
   Borderless, airy hero (Apple/Blitz-elegant): the recipient reads as
   content, not a chunky filled card. No fill, no border, minimal padding —
   the avatar + name carry it, verification lives in the top-right corner. */
/* The recipient cell: one quiet chip row below the amount. */
.recipient-cell {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 12px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

.recipient-avatar {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  flex-shrink: 0;
  overflow: hidden;
}

/* Silhouette hero — the same grey placeholder recipe as ContactAvatar,
   so the confirm sheet and every list agree. */
.recipient-avatar--silhouette {
  background: var(--bg-input);
  color: var(--text-muted);
  text-shadow: none;
  box-shadow: none;
}

.body--dark .recipient-avatar--silhouette {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
}

.recipient-glyph {
  /* Filled marks read smaller than strokes — 52% matches the
     reference wallet's bust-to-disc ratio. */
  width: 52%;
  height: 52%;
  display: block;
}
.recipient-avatar.has-logo { background: #fff; box-shadow: inset 0 0 0 1px var(--border-card); }
.recipient-logo { width: 100%; height: 100%; object-fit: cover; }
/* Plate-less art (merchant marks, wordmarks, bare wallet logomarks): fitted
   whole rather than cropped. The inset is a percentage so it holds at every
   avatar size, and defaults deep enough (logo ≈ 0.62 of the avatar) that even
   a full-bleed square keeps its corners inside the circle. A logo whose
   silhouette is known can override it per brand via `logoInset`. */
.recipient-logo--contain { object-fit: contain; padding: 19%; }

.recipient-meta { flex: 1; min-width: 0; }

.recipient-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.recipient-name {
  flex: 1;
  font-size: 15px;
  font-weight: 650;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The one identifier line: the raw destination, quiet and single-line.
   The full string lives in the detail panel behind the info glyph. */
.recipient-addr {
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recipient-info {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 0;
  background: var(--bg-card);
  box-shadow: inset 0 0 0 1px var(--border-card);
  color: var(--text-muted);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.15s ease;
}
.recipient-info[aria-expanded="true"] { color: var(--text-primary); }

/* The labeled detail panel the info glyph opens. */
.recipient-details {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  overflow: hidden;
}
.recipient-details-copy { flex: 1; min-width: 0; }
.recipient-details-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 3px;
}
.recipient-details-value {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-primary);
  word-break: break-all;
  line-height: 1.5;
  user-select: text;
}
.recipient-details-copy-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 0;
  background: var(--bg-card);
  box-shadow: inset 0 0 0 1px var(--border-card);
  color: var(--text-secondary);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* Fiat-payout service hint (Tando, Bitzed, …): a quiet line reminding
   the user the money lands as local currency. The wallet-brand hint
   (Wallet of Satoshi, Phoenix, …) shares the look, and the invoice's
   own description joins them as a third quiet line. */
.ln-service-hint,
.wallet-brand-hint,
.payment-desc {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 0 2px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-secondary);
}
.ln-service-hint svg,
.wallet-brand-hint svg,
.payment-desc svg { flex: 0 0 auto; margin-top: 2px; color: var(--text-muted); }

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

/* ─── Amount stage ─── */
.amount-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2px 0 0;
  gap: 8px;
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

/* One helper row under the amount: limits left, conversion right. */
.amount-helper {
  width: 100%;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-top: 2px;
  min-height: 16px;
  font-size: 11.5px;
  color: var(--text-muted);
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
}
.amount-helper-convert { margin-left: auto; }

/* ZAR secondary — sits below the helper row for SA-retail merchants when
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

.amount-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: #EF4444;
}

/* ─── Note ─── */
.note-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  transition: box-shadow 0.15s ease;
}
.note-row:focus-within {
  box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.35);
}
.note-icon { color: var(--text-muted); flex-shrink: 0; }
.note-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  /* 16px on purpose: anything smaller makes iOS zoom the sheet on focus. */
  font-size: 16px;
  color: var(--text-primary);
}
.note-input::placeholder { color: var(--text-muted); }

/* ─── CTA ─── */
.cta-row { margin-top: 6px; }

/* Pinned commit footer — sibling of the scroll region, so it never
   leaves the screen. Carries the stage's horizontal padding itself. */
.confirm-cta {
  margin-top: 0;
  padding: 10px 20px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}

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

/* Idle CTA (button / slide) -> filling ProgressCta. A short cross-fade keeps
   the morph smooth when the user commits. */
.cta-swap-enter-active,
.cta-swap-leave-active { transition: opacity 0.2s ease; }
.cta-swap-enter-from,
.cta-swap-leave-to { opacity: 0; }

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
  .stage { padding: 6px 16px 8px; gap: 11px; }
  .confirm-cta { padding: 10px 16px 0; }
  .recipient-avatar { width: 44px; height: 44px; min-width: 44px; font-size: 18px; }
  .amount-input { font-size: 40px; }
  .primary-cta { height: 50px; font-size: 14.5px; }
}
</style>
