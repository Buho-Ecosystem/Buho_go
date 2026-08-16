<template>
  <q-dialog
    v-model="show"
    persistent
    maximized
    transition-show="fade"
    transition-hide="fade"
    class="payment-confirmation"
  >
    <div class="confirmation-backdrop" :class="$q.dark.isActive ? 'backdrop-dark' : 'backdrop-light'">
      <div class="confirmation-content">
        <!--
          Success animation. The shared SuccessCheckmark primitive
          owns the visual; we just gate it on the local
          `showAnimation` flag so the entrance is synced with the
          rest of this surface's fade-in sequence.
        -->
        <SuccessCheckmark :animate="showAnimation" :accent="accentColor" />

        <!-- Amount Display. The amount + fiat lines are hidden when we
             can't determine the paid amount (zero-amount invoice paid via
             the Spark event path, which carries no amount info). The
             "Payment Received" label still shows so the user gets clear
             confirmation. -->
        <div class="amount-section" :class="{ 'fade-in': showAmount }">
          <div class="amount-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
            {{ label || $t('Payment Received') }}
          </div>
          <div v-if="amount > 0" class="amount-value" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">
            {{ formatAmount(amount) }}
          </div>
          <div v-if="amount > 0 && fiatAmount" class="fiat-value" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ fiatAmount }}
          </div>
          <!--
            Recipient line. Renders just below the amount because it's
            context for the *amount*, not a footer afterthought. Used by
            the send-success flow; receive/withdraw don't pass it.
          -->
          <div
            v-if="recipient"
            class="recipient-line"
            :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
          >
            {{ recipientPrefix }}{{ recipient }}
          </div>
        </div>

        <!--
          LUD-21 delivery status — a fiat-payout send (ChapSmart/Tando/Bitzed)
          confirms, live, that the local currency actually landed on the
          recipient's mobile-money account, with the receipt id + verified name.
        -->
        <div
          v-if="deliveryStatus"
          class="delivery-status"
          :class="[$q.dark.isActive ? 'delivery-status--dark' : 'delivery-status--light', { 'fade-in': showAmount }]"
        >
          <template v-if="deliveryStatus.delivered">
            <Icon icon="tabler:circle-check-filled" width="18" height="18" class="delivery-status-ok" />
            <div class="delivery-status-text">
              <div class="delivery-status-title">{{ $t('Delivered') }}</div>
              <div v-if="deliveryStatus.recipient || deliveryStatus.receipt" class="delivery-status-sub">
                <span v-if="deliveryStatus.recipient">{{ deliveryStatus.recipient }}</span>
                <span v-if="deliveryStatus.recipient && deliveryStatus.receipt"> · </span>
                <span v-if="deliveryStatus.receipt">{{ $t('Receipt') }} {{ deliveryStatus.receipt }}</span>
              </div>
            </div>
          </template>
          <template v-else-if="!deliveryStatus.done">
            <q-spinner size="16px" :color="$q.dark.isActive ? 'grey-5' : 'grey-7'" />
            <div class="delivery-status-text">
              <div class="delivery-status-title">{{ $t('Confirming delivery…') }}</div>
            </div>
          </template>
          <template v-else>
            <Icon icon="tabler:clock" width="18" height="18" class="delivery-status-pending" />
            <div class="delivery-status-text">
              <div class="delivery-status-title">{{ $t('Delivery in progress') }}</div>
              <div class="delivery-status-sub">{{ $t('It can take a moment to reach the recipient') }}</div>
            </div>
          </template>
        </div>

        <!--
          LUD-09 successAction — the recipient's post-payment message. Shown as
          a distinct card (not the faint footer `description`) because it can
          carry a link to open or a one-time secret to copy. Its presence also
          suppresses auto-close (see `keepsOpen`) so the user has time to read
          or act on it.
        -->
        <div
          v-if="successAction"
          class="success-action-area"
          :class="{ 'fade-in': showAmount }"
        >
          <div
            class="success-action-card"
            :class="$q.dark.isActive ? 'sa-card-dark' : 'sa-card-light'"
          >
            <!-- A `url` action without a description is a bare call to action,
                 so it skips the generic caption. -->
            <div
              v-if="successAction.tag !== 'url' || successAction.description"
              class="success-action-label"
              :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
            >
              {{ $t('Message from recipient') }}
            </div>

            <!-- message: plain text -->
            <div
              v-if="successAction.tag === 'message'"
              class="success-action-text"
              :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'"
            >
              {{ successAction.message }}
            </div>

            <!-- url: the recipient's note, then the destination itself on the
                 pill so the payer sees where the tap leads before taking it.
                 openInAppBrowser opens a new tab on web and an in-app view
                 (Custom Tab / SFSafariViewController) on native. -->
            <template v-else-if="successAction.tag === 'url'">
              <div
                v-if="successAction.description"
                class="success-action-text"
                :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'"
              >
                {{ successAction.description }}
              </div>
              <button
                type="button"
                class="success-action-open"
                :class="$q.dark.isActive ? 'sa-open-dark' : 'sa-open-light'"
                @click="openSuccessActionUrl"
              >
                <span class="success-action-open-label">{{ successActionUrlLabel }}</span>
                <Icon icon="tabler:external-link" width="16" height="16" class="success-action-open-icon" />
              </button>
            </template>

            <!-- aes: decrypted secret (tap to copy), or a graceful failure note -->
            <template v-else-if="successAction.tag === 'aes'">
              <div
                v-if="successAction.description"
                class="success-action-text"
                :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'"
              >
                {{ successAction.description }}
              </div>
              <div v-if="successAction.decryptError" class="success-action-error">
                {{ $t('Could not decrypt the message') }}
              </div>
              <button
                v-else
                type="button"
                class="success-action-secret"
                :class="$q.dark.isActive ? 'sa-secret-dark' : 'sa-secret-light'"
                @click="copySecret"
              >
                <span class="success-action-secret-text">{{ successAction.secret }}</span>
                <Icon icon="tabler:copy" width="16" height="16" />
              </button>
            </template>
          </div>
        </div>

        <!--
          Save-to-Contacts opt-in. Fades in with the countdown block so
          the celebration peak (checkmark + amount) isn't competing for
          attention. Tapping it dismisses the modal and emits up to the
          parent, which opens the save-contact dialog.
        -->
        <div
          v-if="showSaveContact"
          class="save-contact-area"
          :class="{ 'fade-in': showCountdown }"
        >
          <q-btn
            outline
            no-caps
            rounded
            class="save-contact-btn"
            :class="$q.dark.isActive ? 'save-contact-btn-dark' : 'save-contact-btn-light'"
            @click="onSaveContactClicked"
          >
            <Icon icon="tabler:user-plus" width="16" height="16" class="q-mr-xs" />
            {{ saveContactLabel || $t('Save to Contacts') }}
          </q-btn>
        </div>
      </div>

      <!-- Bottom area: countdown + description -->
      <div class="bottom-area">
        <div class="countdown-section" :class="{ 'fade-in': showCountdown }">
          <!--
            Countdown text is suppressed when the modal is in
            "decision-pending" mode (save-contact button visible).
            There's no countdown to surface — the modal stays open until
            the user picks one of the two actions.
          -->
          <div
            v-if="!keepsOpen"
            class="countdown-text"
            :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
          >
            {{ $t('Closing in {seconds}s...', { seconds: countdown }) }}
          </div>
          <q-btn
            flat
            no-caps
            class="close-now-btn"
            :class="$q.dark.isActive ? 'close-btn-dark' : 'close-btn-light'"
            @click="closeNow"
          >
            {{ closeLabelText }}
          </q-btn>
        </div>

        <div
          v-if="description"
          class="description-section"
          :class="[{ 'fade-in': showCountdown }, $q.dark.isActive ? 'desc-dark' : 'desc-light']"
        >
          {{ description }}
        </div>
      </div>

      <!-- Confetti particles (disabled for now — keep for future use)
      <div class="confetti-container" v-if="showConfetti">
        <div v-for="i in 24" :key="i" class="confetti" :style="getConfettiStyle(i)"></div>
      </div>
      -->

    </div>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { formatAmount as formatAmountUtil } from '../utils/amountFormatting.js';
import { useWalletStore } from '../stores/wallet';
import { copySensitive } from '../utils/sensitiveClipboard.js';
import SuccessCheckmark from './SuccessCheckmark.vue';
import { openInAppBrowser } from '../utils/inAppBrowser.js';
import { formatSuccessActionUrl } from '../utils/successAction.js';

export default {
  name: 'PaymentConfirmation',
  components: { Icon, SuccessCheckmark },
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    amount: {
      type: Number,
      default: 0
    },
    fiatAmount: {
      type: String,
      default: ''
    },
    description: {
      type: String,
      default: ''
    },
    label: {
      type: String,
      default: ''
    },
    autoCloseDelay: {
      type: Number,
      default: 5
    },
    accentColor: {
      type: String,
      default: 'green'
    },
    /**
     * Counterparty for this transaction (display string, e.g. a
     * Lightning address, contact name, or truncated address). Renders
     * as "To {recipient}" by default. The send flow passes this; the
     * receive and withdraw flows leave it empty.
     */
    recipient: {
      type: String,
      default: ''
    },
    /**
     * Prefix shown before `recipient`. Defaults to "To " (with trailing
     * space) but callers can override (e.g. "From " for an inbound
     * variant later, or '' to render the recipient bare).
     */
    recipientPrefix: {
      type: String,
      default: 'To '
    },
    /**
     * Promote the modal to a "decision-pending" surface: shows a "Save
     * to Contacts" button below the amount, disables auto-close, hides
     * the countdown text, and relabels the close action to a neutral
     * "Done" (since there's no "now" to act on without a timer).
     *
     * The button click is forwarded via `save-contact-clicked` so the
     * parent can run the actual save flow. If the user dismisses the
     * modal without tapping the button, they've opted out — no dialog
     * should pop afterwards.
     */
    showSaveContact: {
      type: Boolean,
      default: false
    },
    /** Override the save-button label if a host wants different copy. */
    saveContactLabel: {
      type: String,
      default: ''
    },
    /**
     * Override the close-button label. Defaults to "Close Now" when
     * auto-close is running and "Done" when the modal is persistent
     * (showSaveContact = true). Callers rarely need to set this.
     */
    closeLabel: {
      type: String,
      default: ''
    },
    /**
     * LUD-09 successAction returned by the recipient, already resolved for
     * display: { tag:'message', message }, { tag:'url', description, url }, or
     * { tag:'aes', description, secret, decryptError }. When present the modal
     * stays open (no auto-close) so the user can read or act on it.
     */
    successAction: {
      type: Object,
      default: null
    },
    /**
     * LUD-21 delivery status for a fiat-payout send, updated live as we poll
     * the provider's verify URL: { settled, delivered, receipt, recipient,
     * amount, done }. `done` marks the poll terminal. null on ordinary sends.
     */
    deliveryStatus: {
      type: Object,
      default: null
    }
  },
  emits: ['update:modelValue', 'closed', 'save-contact-clicked'],
  setup() {
    const walletStore = useWalletStore();
    return {
      walletStore
    };
  },
  data() {
    return {
      showAnimation: false,
      showAmount: false,
      showCountdown: false,
      showConfetti: false,
      countdown: 5,
      countdownInterval: null,
      animationTimeout: null
    }
  },
  computed: {
    show: {
      get() {
        return this.modelValue
      },
      set(value) {
        this.$emit('update:modelValue', value)
      }
    },
    /**
     * Whether the modal should stay open instead of auto-closing. Both the
     * save-contact decision and a LUD-09 message need the user to read or act,
     * so either one suppresses the countdown.
     */
    keepsOpen() {
      // A pending delivery keeps the screen open so the user can watch it land;
      // once terminal it no longer holds the screen (the receipt/save decision may).
      const deliveryPending = !!this.deliveryStatus && !this.deliveryStatus.done
      return this.showSaveContact || !!this.successAction || deliveryPending
    },
    /**
     * Close-button copy. "Close Now" reads right with a visible
     * countdown ("close it sooner than the timer"); when the timer is
     * suppressed (decision-pending mode) there is no "now" to refer
     * to, so we use "Done" instead. Callers can override with
     * `closeLabel`.
     */
    closeLabelText() {
      if (this.closeLabel) return this.closeLabel
      return this.keepsOpen
        ? this.$t('Done')
        : this.$t('Close Now')
    },
    /**
     * The destination of a LUD-09 `url` action, shortened for the pill. Shown
     * instead of a generic "Open link" so the payer reads the host before
     * tapping — the link may point anywhere, not just at the paid service.
     */
    successActionUrlLabel() {
      return formatSuccessActionUrl(this.successAction?.url)
    }
  },
  watch: {
    modelValue(newVal) {
      if (newVal) {
        this.startAnimationSequence()
      } else {
        this.cleanup()
      }
    },
    // Auto-close is decided once (700ms into the entry animation) based on
    // keepsOpen. But keepsOpen has live inputs — most notably a pending LUD-21
    // delivery poll — so when the hold is released mid-view (delivery confirms,
    // or a message/save state clears) the initial decision is stale. Re-sync the
    // countdown here so a resolved screen actually auto-closes instead of
    // freezing on "Closing in 5s...".
    keepsOpen(holdOpen) {
      if (!this.modelValue || !this.showCountdown) return
      if (holdOpen) {
        this.clearCountdown()
      } else {
        this.countdown = this.autoCloseDelay
        this.startCountdown()
      }
    }
  },
  beforeUnmount() {
    this.cleanup()
  },
  methods: {
    startAnimationSequence() {
      this.countdown = this.autoCloseDelay
      this.showAnimation = false
      this.showAmount = false
      this.showCountdown = false
      this.showConfetti = false

      setTimeout(() => {
        this.showAnimation = true
        // this.showConfetti = true // confetti disabled for now
      }, 80)

      setTimeout(() => {
        this.showAmount = true
      }, 380)

      setTimeout(() => {
        this.showCountdown = true
        // Auto-close is suppressed when the modal is in decision-pending
        // mode — the user needs to actively pick Save or Done, and an
        // expiring timer would pressure that choice.
        if (!this.keepsOpen) {
          this.startCountdown()
        }
      }, 700)
    },

    startCountdown() {
      this.clearCountdown()
      this.countdownInterval = setInterval(() => {
        this.countdown--
        if (this.countdown <= 0) {
          this.closeNow()
        }
      }, 1000)
    },

    clearCountdown() {
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval)
        this.countdownInterval = null
      }
    },

    closeNow() {
      this.cleanup()
      this.show = false
      this.$emit('closed')
    },

    /**
     * User opted in to saving the recipient. Dismiss the modal first so
     * the parent's save-contact dialog opens onto a clean stack — no
     * stacked modals, no lingering checkmark. Parent listens on
     * `save-contact-clicked` to drive the dialog.
     */
    onSaveContactClicked() {
      this.cleanup()
      this.show = false
      this.$emit('save-contact-clicked')
      // We deliberately do NOT emit 'closed' here. The parent treats
      // 'closed' as "user dismissed without saving"; the save click is
      // a separate, explicit signal.
    },

    cleanup() {
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval)
        this.countdownInterval = null
      }
      if (this.animationTimeout) {
        clearTimeout(this.animationTimeout)
        this.animationTimeout = null
      }
    },

    formatAmount(sats) {
      if (!sats) return formatAmountUtil(0, this.walletStore.useBip177Format);
      return formatAmountUtil(sats, this.walletStore.useBip177Format);
    },

    /**
     * Copy a decrypted `aes` secret. Uses the sensitive-clipboard helper so the
     * value is wiped after a short window — it's proof-of-payment material the
     * user can also re-copy later from Transaction Details.
     */
    /**
     * Open a LUD-09 `url` successAction (a receipt, a group invite, a download).
     * Scheme-validated upstream to http(s); the destination is on the button the
     * user tapped, so nothing opens that they haven't read. New tab on web,
     * in-app view on native.
     */
    openSuccessActionUrl() {
      const url = this.successAction?.url;
      if (url) openInAppBrowser(url);
    },

    async copySecret() {
      const secret = this.successAction?.secret;
      if (!secret) return;
      try {
        await copySensitive(secret);
        this.$q.notify({ type: 'positive', message: this.$t('Copied') });
      } catch (err) {
        console.error('[PaymentConfirmation] copy failed:', err);
        this.$q.notify({ type: 'negative', message: this.$t("Couldn't copy") });
      }
    },

    getConfettiStyle(index) {
      const greenColors = ['#34C759', '#FFD43B', '#3B82F6', '#8B5CF6', '#F59E0B']
      const orangeColors = ['#F7931A', '#FFD43B', '#34C759', '#FF9500', '#FFCC00']
      const colors = this.accentColor === 'orange' ? orangeColors : greenColors
      const color = colors[index % colors.length]
      const left = Math.random() * 100
      const animDuration = 1.4 + Math.random() * 0.6
      const animDelay = Math.random() * 0.3
      const size = 6 + Math.random() * 5

      return {
        left: `${left}%`,
        backgroundColor: color,
        width: `${size}px`,
        height: `${size}px`,
        animationDuration: `${animDuration}s`,
        animationDelay: `${animDelay}s`
      }
    }
  }
}
</script>

<style scoped>
.payment-confirmation :deep(.q-dialog__inner) {
  padding: 0;
}

.confirmation-backdrop {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.backdrop-dark {
  background: #0C0C0C;
}

.backdrop-light {
  background: var(--bg-primary);
}

.confirmation-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rem;
  padding: 2rem;
  z-index: 10;
}

/*
  Checkmark animation, success circle, and pulse ring now live in
  `SuccessCheckmark.vue` so batch and internal-transfer surfaces can
  reuse the exact same visual moment without depending on this
  modal.
*/

/* Amount Section */
.amount-section {
  text-align: center;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.4s cubic-bezier(0.2, 0.7, 0.2, 1),
              transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.amount-section.fade-in {
  opacity: 1;
  transform: translateY(0);
}

.amount-label {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.amount-value {
  font-family: 'Manrope', sans-serif;
  font-size: 3rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.fiat-value {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 500;
  margin-top: 0.5rem;
  opacity: 0.7;
}

/*
  Recipient line. Sits just under the fiat value with restrained
  styling so the amount stays the visual anchor. Truncates with
  ellipsis on narrow viewports rather than wrapping into the layout.
*/
.recipient-line {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  margin-top: 0.75rem;
  max-width: 280px;
  margin-left: auto;
  margin-right: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
  Save-to-Contacts area. Sits between the amount block and the bottom
  countdown/close area so it reads as context for the just-sent
  amount, not as a footer afterthought.
*/
.save-contact-area {
  display: flex;
  justify-content: center;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.4s cubic-bezier(0.2, 0.7, 0.2, 1),
              transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.save-contact-area.fade-in {
  opacity: 1;
  transform: translateY(0);
}

.save-contact-btn {
  padding: 10px 22px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.save-contact-btn-dark {
  color: #FFF;
  border-color: rgba(255, 255, 255, 0.18);
}

.save-contact-btn-dark:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.28);
}

.save-contact-btn-light {
  color: var(--text-primary);
  border-color: var(--border-card);
}

.save-contact-btn-light:hover {
  background: rgba(0, 0, 0, 0.03);
}

/* Bottom area: countdown + description, anchored toward bottom */
.bottom-area {
  position: absolute;
  left: 0;
  right: 0;
  bottom: max(2rem, env(safe-area-inset-bottom, 2rem));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
  z-index: 10;
  padding: 0 1.5rem;
}

.countdown-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.4s cubic-bezier(0.2, 0.7, 0.2, 1),
              transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.countdown-section.fade-in {
  opacity: 1;
  transform: translateY(0);
}

.countdown-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
}

.close-now-btn {
  padding: 10px 28px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  transition: background-color 0.2s ease;
}

.close-btn-dark {
  background: rgba(255, 255, 255, 0.08);
  color: #FFF;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.close-btn-dark:hover {
  background: rgba(255, 255, 255, 0.12);
}

.close-btn-light {
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-primary);
  border: 1px solid var(--border-card);
}

.close-btn-light:hover {
  background: rgba(0, 0, 0, 0.08);
}

/* Description (e.g. "BuhoGO Payment") — centered footer */
.description-section {
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.4s cubic-bezier(0.2, 0.7, 0.2, 1),
              transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
  transition-delay: 0.08s;
  max-width: 320px;
  line-height: 1.4;
  word-break: break-word;
}

.description-section.fade-in {
  opacity: 1;
  transform: translateY(0);
}

.desc-dark {
  color: rgba(255, 255, 255, 0.45);
}

.desc-light {
  color: rgba(0, 0, 0, 0.45);
}

/* LUD-09 successAction card */
/* LUD-21 delivery status: a compact live confirmation row (fiat landed). */
.delivery-status {
  width: 100%;
  max-width: 340px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 14px;
  text-align: left;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.4s cubic-bezier(0.2, 0.7, 0.2, 1),
              transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.delivery-status.fade-in { opacity: 1; transform: translateY(0); }
.delivery-status--dark { background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); }
.delivery-status--light { background: rgba(0, 0, 0, 0.03); border: 1px solid var(--border-card); }
.delivery-status-ok { color: #34C759; flex-shrink: 0; }
.delivery-status-pending { color: #F59E0B; flex-shrink: 0; }
.delivery-status-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.delivery-status-title { font-family: 'Manrope', sans-serif; font-size: 14px; font-weight: 700; color: var(--text-primary); }
.delivery-status-sub {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-word;
}

.success-action-area {
  width: 100%;
  display: flex;
  justify-content: center;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.4s cubic-bezier(0.2, 0.7, 0.2, 1),
              transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.success-action-area.fade-in {
  opacity: 1;
  transform: translateY(0);
}

.success-action-card {
  width: 100%;
  max-width: 340px;
  border-radius: 16px;
  padding: 1rem 1.125rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.625rem;
  text-align: center;
}

.sa-card-dark {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.sa-card-light {
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid var(--border-card);
}

.success-action-label {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.success-action-text {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.45;
  word-break: break-word;
  max-height: 38vh;
  overflow-y: auto;
}

.success-action-error {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: #FF6B6B;
}

/* url action: a single elegant "open" pill (new tab on web, in-app on native). */
.success-action-open {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  max-width: 100%;
  padding: 0.625rem 1rem;
  border-radius: 12px;
  border: 1px solid;
  background: transparent;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  transition: filter 0.15s ease, transform 0.08s ease;
}

.success-action-open:hover { filter: brightness(1.06); }
.success-action-open:active { transform: scale(0.98); }

.sa-open-dark {
  border-color: rgba(255, 255, 255, 0.25);
  color: #FFF;
}

.sa-open-light {
  border-color: var(--border-card);
  color: var(--text-primary);
}

.success-action-open-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.success-action-open-icon {
  flex-shrink: 0;
  opacity: 0.7;
}

/* Decrypted secret: a tap-to-copy chip styled to read as "copyable value". */
.success-action-secret {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 100%;
  padding: 0.625rem 0.875rem;
  border-radius: 12px;
  border: 1px dashed;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
}

.sa-secret-dark {
  border-color: rgba(255, 255, 255, 0.25);
  color: #FFF;
}

.sa-secret-light {
  border-color: var(--border-card);
  color: var(--text-primary);
}

.success-action-secret-text {
  font-family: 'SF Mono', ui-monospace, 'Roboto Mono', monospace;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
  word-break: break-all;
  text-align: left;
}

/* Confetti */
.confetti-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
}

.confetti {
  position: absolute;
  top: -10px;
  border-radius: 2px;
  animation: confetti-fall linear forwards;
}

@keyframes confetti-fall {
  0% {
    transform: translateY(0) rotate(0deg);
    opacity: 1;
  }
  100% {
    transform: translateY(100vh) rotate(540deg);
    opacity: 0;
  }
}

/* Reduced motion: disable all entry/exit animation */
@media (prefers-reduced-motion: reduce) {
  .success-animation,
  .amount-section,
  .success-action-area,
  .countdown-section,
  .description-section {
    transition: none !important;
    animation: none !important;
    transform: none !important;
    opacity: 1 !important;
  }
  .checkmark-check {
    animation: none !important;
    stroke-dashoffset: 0 !important;
  }
  .pulse-ring-once,
  .confetti-container {
    display: none !important;
  }
}

/* Responsive */
@media (max-width: 480px) {
  .amount-value {
    font-size: 2.5rem;
  }

  .success-animation,
  .success-circle,
  .pulse-ring-once {
    width: 96px;
    height: 96px;
  }

  .checkmark {
    width: 44px;
    height: 44px;
  }
}
</style>
