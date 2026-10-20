<template>
  <q-page class="kiosk-page">
    <div class="kiosk-shell" :class="$q.dark.isActive ? 'kiosk-dark' : 'kiosk-light'">

      <!-- Header -->
      <header class="kiosk-header">
        <div class="kiosk-header-left">
          <div class="kiosk-wallet-badge">
            <q-icon name="point_of_sale" size="13px" />
            <span>{{ kioskWalletName }}</span>
          </div>
        </div>
        <div class="kiosk-logo" @click="handleScreenTap">
          <img src="/buho_logo.svg" alt="Buho" class="kiosk-logo-img" />
        </div>
        <button class="kiosk-lock-btn" @click.stop="showUnlockDialog = true">
          <q-icon name="lock" size="18px" />
        </button>
      </header>

      <!-- Parked sales, said in words: one quiet line, one tap to the list.
           It takes the parked sale the moment it is parked (it pops). -->
      <button
        v-if="parkedCount && (state === 'input' || state === 'payment')"
        class="pos-parked-line"
        :class="{ 'pos-parked-line--pop': parkPop }"
        @click.stop="showParkedSheet = true"
      >
        <q-icon name="pause_circle" size="16px" />
        <span>{{ parkedCount === 1 ? $t('1 parked sale') : $t('{n} parked sales', { n: parkedCount }) }}</span>
        <q-icon name="chevron_right" size="16px" class="pos-parked-line-chevron" />
      </button>

      <!-- ═══ Paid ═══ -->
      <div v-if="state === 'success'" class="pos-state-center">
        <div class="pos-paid-ring"><q-icon name="check" size="36px" /></div>
        <span class="pos-state-title mt-4">{{ $t('kiosk.paymentReceived') }}</span>
        <div class="pos-amount-pill mt-2">{{ displaySats(invoiceData?.amountSats ?? finalAmountSats) }}</div>
        <span v-if="paidByCard" class="pos-paid-method">{{ $t('Paid by card') }}</span>
        <button class="pos-primary-btn mt-8" @click.stop="resetToInput">{{ $t('kiosk.newCharge') }}</button>
      </div>

      <!-- ═══ QR ═══ -->
      <div v-else-if="state === 'payment'" class="pos-state-center pos-pay">
        <template v-if="!cardPinActive">
          <p class="pos-qr-label">{{ $t('kiosk.waitingForPayment') }}</p>
          <div class="pos-qr-amount-lg">{{ displaySats(invoiceData?.amountSats ?? finalAmountSats) }}</div>
        </template>

        <!-- The card's PIN, asked on this screen. Mounted for the whole sale
             so a card can be authorized the moment it is read; it draws
             nothing until a PIN is needed. -->
        <WithdrawAuthorization
          ref="cardAuthorization"
          :prompt="$t('Enter your card PIN')"
          @update:active="cardPinActive = $event"
          @update:checking="cardPinChecking = $event"
        />
        <button v-if="cardPinActive" class="pos-text-btn pos-card-other" :disabled="cardPinChecking" @click.stop="cancelCardPin">{{ $t('Pay another way') }}</button>

        <!-- A card in play takes the QR's place: read, confirmed, paying. -->
        <div v-else-if="cardBusy" class="pos-card-stage">
          <CardFace :reading="card.phase.value === 'loading'" :host="card.host.value" />
          <template v-if="card.phase.value === 'review'">
            <button class="pos-primary-btn pos-card-confirm" @click.stop="confirmHeldCard">{{ $t('Charge card') }}</button>
            <button class="pos-text-btn" @click.stop="card.reset()">{{ $t('Pay another way') }}</button>
          </template>
          <div v-else class="pos-card-status" role="status">
            <q-spinner size="16px" />
            <span>{{ card.phase.value === 'loading' ? $t('Reading card…') : $t('Paying…') }}</span>
          </div>
        </div>

        <template v-else>
          <div class="pos-qr-area">
            <div class="pos-qr-card animate-pop">
              <q-spinner v-if="!invoiceData" size="36px" color="grey-6" />
              <img v-else :src="qrDataUrl" alt="QR" class="pos-qr-img" />
            </div>
          </div>
          <p class="pos-qr-hint">{{ $t('Scan with any Bitcoin wallet') }}</p>
          <!-- A card that did not pay: why, in one line, with the QR still
               here so the sale can finish another way. -->
          <div v-if="cardProblem" class="pos-card-problem" role="alert">
            <q-icon name="error_outline" size="18px" />
            <span><b>{{ cardProblem }}</b> {{ $t('Scan the code to pay instead.') }}</span>
          </div>
          <div v-else-if="nfcReady" class="pos-card-lane">
            <span class="pos-card-wave"><svg class="pos-contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M7.5 9.2a4.2 4.2 0 0 1 0 5.6" /><path d="M11 6.6a8 8 0 0 1 0 10.8" /><path d="M14.5 4a11.8 11.8 0 0 1 0 16" /></svg></span>
            <span class="pos-card-lane-text"><b>{{ $t('Hold a Bolt Card here') }}</b><span>{{ $t('Against the back of this phone') }}</span></span>
          </div>
        </template>

        <p v-if="paymentProblem" role="status">{{ paymentProblem }}</p>
        <button v-if="retryStatus" class="pos-text-btn" @click="startPolling">{{ $t('Check payment again') }}</button>
        <div v-if="!cardBusy && !cardPinActive" class="pos-payment-actions">
          <button class="pos-outline-btn" @click.stop="parkInvoice"><q-icon name="pause_circle" size="18px" />{{ $t('kiosk.park') }}</button>
          <button class="pos-outline-btn pos-cancel-btn" @click.stop="cancelPayment">{{ $t('Cancel') }}</button>
        </div>
      </div>

      <!-- ═══ Processing ═══ -->
      <div v-else-if="state === 'processing'" class="pos-state-center">
        <div class="pos-processing-wrap"><div class="pos-processing-ring pos-ring-1"></div><div class="pos-processing-ring pos-ring-2"></div><div class="pos-processing-core"><q-icon name="bolt" size="26px" /></div></div>
        <span class="pos-state-title mt-6">{{ $t('kiosk.creatingInvoice') || 'Creating Invoice' }}</span>
        <span class="pos-state-sub">{{ $t('kiosk.generatingInvoice') || 'Generating payment invoice...' }}</span>
      </div>

      <!-- ═══ Tipping ═══ -->
      <div v-else-if="state === 'tipping'" class="tip-screen" :class="{ 'tip-ready': tipInteractive }">
        <div class="tip-header">
          <span class="tip-prompt">{{ extrasTitle }}</span>
          <div class="tip-subtotal-pill"><span class="tip-subtotal-label">{{ $t('kiosk.subtotal') || 'Subtotal' }}</span><span class="tip-subtotal-val">{{ displaySats(baseAmountSats) }}</span></div>
        </div>
        <div class="tip-body">
          <div v-if="offersTip" class="tip-options">
            <button v-for="tip in tipOptions" :key="tip.percent" class="tip-opt" :class="{ 'tip-opt-on': selectedTipPercent === tip.percent }" :disabled="!tipInteractive" @click.stop="selectedTipPercent = tip.percent; useRoundUp = false">
              <span class="tip-opt-pct">{{ tip.percent }}%</span><span class="tip-opt-amt">+{{ displaySats(tip.amount) }}</span>
            </button>
          </div>
          <button v-if="offersRoundUp" class="tip-roundup" :class="{ 'tip-roundup-on': useRoundUp }" :disabled="!tipInteractive" @click.stop="useRoundUp = !useRoundUp; selectedTipPercent = 0">
            <div class="tip-roundup-icon"><q-icon name="keyboard_double_arrow_up" size="16px" /></div>
            <span class="tip-roundup-label">{{ $t('kiosk.roundUpTo', { amount: displaySats(roundUpValue) }) }}</span><span class="tip-roundup-val">+{{ displaySats(roundUpValue - totalBeforeRoundUp) }}</span>
          </button>
          <button class="tip-skip" :disabled="!tipInteractive" @click.stop="selectedTipPercent = 0; useRoundUp = false; confirmTip()">{{ extrasSkipLabel }}</button>
        </div>
        <div class="tip-footer">
          <div class="tip-breakdown">
            <div class="tip-break-row"><span>{{ $t('kiosk.subtotal') || 'Subtotal' }}</span><span>{{ displaySats(baseAmountSats) }}</span></div>
            <div v-if="selectedTipAmount > 0 || useRoundUp" class="tip-break-row tip-break-tip"><span>{{ extraLabel }}</span><span class="tip-break-val">+{{ displaySats(finalAmountSats - baseAmountSats) }}</span></div>
            <div class="tip-break-divider"></div>
            <div class="tip-break-row tip-break-total"><span>{{ $t('kiosk.total') }}</span><span>{{ displaySats(invoiceData?.amountSats ?? finalAmountSats) }}</span></div>
          </div>
          <button class="pos-primary-btn" :disabled="!tipInteractive" @click.stop="confirmTip"><span>{{ $t('Confirm') }}</span><q-icon name="arrow_forward" size="18px" /></button>
          <button class="pos-secondary-btn" @click.stop="state = 'input'">{{ $t('Back') }}</button>
        </div>
      </div>

      <!-- ═══ Entry (Numpad) ═══ -->
      <template v-else>
        <div v-if="accumulatedItems.length > 0" class="pos-cart-summary" @click.stop="showCartSheet = true">
          <span class="pos-cart-count">{{ accumulatedItems.length }} {{ accumulatedItems.length === 1 ? $t('kiosk.item') : $t('kiosk.items') }}  ·  {{ displaySats(accumulatedSats) }}</span>
          <button class="pos-cart-x" @click.stop.prevent="clearAll"><q-icon name="close" size="14px" /></button>
        </div>
        <div v-if="card.phase.value === 'ready'" class="pos-card-held" role="status"><svg class="pos-contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M7.5 9.2a4.2 4.2 0 0 1 0 5.6" /><path d="M11 6.6a8 8 0 0 1 0 10.8" /><path d="M14.5 4a11.8 11.8 0 0 1 0 16" /></svg><span>{{ $t('Card held · enter the amount') }}</span></div>
        <div class="pos-top">
          <div class="pos-amount-area">
            <div class="pos-amount-row"><span class="pos-currency-sym">{{ isFiatMode ? fiatSymbol : '' }}</span><span class="pos-amount-value" :class="{ 'pos-amount-sm': formattedDisplay.length > 7 }" :style="amountFontStyle">{{ formattedDisplay }}</span><span v-if="!isFiatMode" class="pos-currency-suffix">sats</span></div>
          </div>
        </div>
        <div class="pos-bottom">
          <div class="pos-keypad">
            <button v-for="n in ['1','2','3','4','5','6','7','8','9']" :key="n" class="pos-key pos-key-num" @click.stop="handleNumpad(n)">{{ n }}</button>
            <button v-if="isFiatMode" class="pos-key pos-key-num" @click.stop="handleNumpad('.')">.</button>
            <button v-else class="pos-key pos-key-num" @click.stop="handleNumpad('000')">000</button>
            <button class="pos-key pos-key-num" @click.stop="handleNumpad('0')">0</button>
            <button class="pos-key pos-key-action" @click.stop="handleNumpad('delete')"><q-icon name="backspace" size="22px" /></button>
          </div>
          <div class="pos-actions">
            <button class="pos-add-btn" :class="{ 'pos-btn-disabled': amountSats <= 0 }" :disabled="amountSats <= 0" @click.stop="addToAccumulated"><q-icon name="add" size="22px" /></button>
            <button class="pos-primary-btn pos-charge-btn" :class="{ 'pos-btn-disabled': !walletReady || totalSatsForCharge <= 0 }" :disabled="!walletReady || totalSatsForCharge <= 0" @click.stop="proceedToTipOrCharge"><q-icon name="receipt_long" size="20px" /><span v-if="!walletReady">{{ $t('kiosk.connecting') || 'Connecting...' }}</span><span v-else-if="totalSatsForCharge > 0">{{ $t('kiosk.charge') }} {{ displaySats(totalSatsForCharge) }}</span><span v-else>{{ $t('kiosk.enterAmount') }}</span></button>
          </div>
        </div>
      </template>

      <!-- ═══ Cart Sheet ═══ -->
      <q-dialog v-model="showCartSheet" position="bottom">
        <q-card class="pos-cart-sheet" :class="$q.dark.isActive ? 'pos-cart-sheet-dark' : 'pos-cart-sheet-light'">
          <q-card-section>
            <div class="pos-sheet-header">
              <span class="pos-sheet-title">{{ accumulatedItems.length }} {{ accumulatedItems.length === 1 ? $t('kiosk.item') : $t('kiosk.items') }}</span>
              <span class="pos-sheet-total">{{ displaySats(accumulatedSats) }}</span>
            </div>
            <div v-for="(item, idx) in accumulatedItems" :key="idx" class="pos-sheet-row">
              <span>{{ displaySats(item) }}</span>
              <button class="pos-sheet-remove" @click.stop="removeAccumulatedItem(idx)"><q-icon name="remove_circle_outline" size="18px" /></button>
            </div>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- ═══ Parked sales ═══ -->
      <q-dialog v-model="showParkedSheet" position="bottom">
        <q-card class="pos-cart-sheet pos-parked-sheet" :class="$q.dark.isActive ? 'pos-cart-sheet-dark' : 'pos-cart-sheet-light'">
          <q-card-section>
            <div class="pos-sheet-header">
              <span class="pos-sheet-title">{{ $t('Parked sales') }}</span>
              <span class="pos-parked-note">{{ $t('Still watched for payment') }}</span>
            </div>
            <p v-if="!canResume" class="pos-parked-hint">{{ $t('Finish or clear the current sale to open a parked one.') }}</p>
            <div v-for="sale in parkedList" :key="sale.id" class="pos-parked-row" :class="{ 'pos-parked-row--expired': sale.status === 'expired' }">
              <button
                class="pos-parked-open"
                :disabled="!canResume || sale.status === 'expired'"
                @click.stop="resumeParked(sale.id)"
              >
                <span class="pos-parked-amount">{{ displaySats(sale.invoiceData.amountSats) }}</span>
                <span class="pos-parked-meta">{{ parkedMeta(sale) }}</span>
              </button>
              <span class="pos-parked-status" :class="`pos-parked-status--${sale.status}`">{{ sale.status === 'expired' ? $t('Expired') : $t('Waiting') }}</span>
              <button class="pos-sheet-remove" :aria-label="$t('Remove')" @click.stop="removeParked(sale)"><q-icon name="remove_circle_outline" size="20px" /></button>
            </div>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- ═══ Unlock ═══ -->
      <q-dialog v-model="showUnlockDialog" persistent @hide="resetUnlock">
        <div class="kiosk-dialog">
          <transition name="kiosk-fade" mode="out-in">
            <div v-if="!showPinStep" key="explain" class="kiosk-dialog-body">
              <div class="kiosk-dialog-icon">
                <q-icon name="shield" size="28px" />
              </div>
              <h3 class="kiosk-dialog-title">{{ $t('kiosk.ownerAreaTitle') }}</h3>
              <p class="kiosk-dialog-desc">{{ $t('kiosk.ownerAreaDescLong') }}</p>

              <div class="kiosk-unlock-features">
                <div class="kiosk-unlock-feature">
                  <div class="kiosk-unlock-feature-icon"><q-icon name="lock" size="16px" /></div>
                  <span>{{ $t('kiosk.ownerHintProtected') }}</span>
                </div>
                <div class="kiosk-unlock-feature">
                  <div class="kiosk-unlock-feature-icon"><q-icon name="pin" size="16px" /></div>
                  <span>{{ $t('kiosk.ownerHintPin') }}</span>
                </div>
              </div>

              <button class="pos-primary-btn kiosk-dialog-btn" @click="showPinStep = true">{{ $t('kiosk.continueToPin') }}</button>
              <button class="pos-text-btn" @click="showUnlockDialog = false">{{ $t('kiosk.backToPos') }}</button>
            </div>
            <div v-else key="pin" class="kiosk-dialog-body">
              <KioskPinPad ref="unlockPinRef" :title="$t('kiosk.enterPin')" :error-message="unlockError" @complete="handleUnlockPin" />
              <button class="pos-text-btn" @click="showPinStep = false">{{ $t('Back') }}</button>
            </div>
          </transition>
        </div>
      </q-dialog>
    </div>
  </q-page>
</template>

<script>
import { defineComponent, ref, computed, onMounted, onUnmounted, getCurrentInstance, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWalletStore } from 'stores/wallet'
import { roundUpTargetSats } from 'src/utils/roundUp'
import { useTransactionMetadataStore } from 'stores/transactionMetadata'
import KioskPinPad from 'components/KioskPinPad.vue'
import QRCode from 'qrcode'
import WithdrawAuthorization from '../components/WithdrawAuthorization.vue'
import CardFace from '../components/CardFace.vue'
import { useKioskCardPayment } from '../composables/useKioskCardPayment.js'
import { useKioskParkedSales, MAX_PARKED } from '../composables/useKioskParkedSales.js'
import { isNfcAvailable } from '../utils/nfc.js'
import { haptics } from '../utils/haptics.js'
import { useQuasar } from 'quasar'
import { createPaymentMonitor, PaymentStatus } from '../utils/paymentMonitor.js'
import { safeWithdrawError } from '../services/lnurlWithdraw.js'
import { fiatSymbol as fiatSymbolFor } from 'src/utils/fiatCurrencies'
import { kioskWalletBlocker, KIOSK_BLOCKER } from '../utils/walletCapabilities.js'
import { NWC_ERROR, nwcError } from '../utils/nwcErrors.js'

export default defineComponent({
  name: 'KioskDashboard',
  components: { KioskPinPad, WithdrawAuthorization, CardFace },

  setup() {
    const router = useRouter()
    const store = useWalletStore()
    const metadataStore = useTransactionMetadataStore()
    const { proxy } = getCurrentInstance()
    const t = (key, values) => proxy.$t(key, values)

    const state = ref('input')
    const walletReady = ref(false)
    const rawInput = ref('0')
    const accumulatedItems = ref([])
    const accumulatedSats = computed(() => accumulatedItems.value.reduce((s, v) => s + v, 0))
    const selectedTipPercent = ref(0)
    const useRoundUp = ref(false)
    const baseAmountSats = ref(0)
    // Curated point-of-sale breakdown for the CURRENT invoice, captured at
    // invoice-creation time (see captureSaleBreakdown). A plain object, not
    // derived from the live refs above, because parking or resetting the
    // register clears those before the payment settles — showSuccess()
    // reads this snapshot instead so the sale details it stamps are never
    // zeroed out from under it.
    const saleBreakdownSnapshot = ref(null)
    const tipInteractive = ref(false)
    const invoiceData = ref(null)
    const qrDataUrl = ref('')
    let paymentMonitor = null
    let visibilityHandler = null
    let saleRevision = 0
    const paymentProblem = ref('')
    const retryStatus = ref(false)
    const $q = useQuasar()
    const cardAuthorization = ref(null)
    const cardPinActive = ref(false)
    const cardPinChecking = ref(false)
    const cardProblem = ref('')
    const paidByCard = ref(false)
    const nfcReady = ref(false)
    const sale = computed(() => state.value === 'payment' && !paymentProblem.value ? invoiceData.value : null)
    const card = useKioskCardPayment({
      sale,
      authorize: (...args) => cardAuthorization.value.submit(...args),
      onError: (error) => {
        cardProblem.value = cardProblemText(error)
        void haptics.error()
      },
    })
    const cardBusy = computed(() => ['loading', 'review', 'submitting', 'waiting'].includes(card.phase.value))

    /**
     * Why a card did not pay, in the customer's words. Shown on the pay
     * screen with the QR still there: at a counter a dialog to dismiss is
     * one step too many, and the sale is not over.
     */
    function cardProblemText(error) {
      const message = String(error?.message || '')
      if (error?.code === 'CARD_BLOCKED') return t('Card locked after too many wrong PINs.')
      if (/payment limits/i.test(message)) return t("This card can't pay this amount.")
      // The request may have reached the card's service: whether it paid is
      // for the sale's own watch to tell, not for this line to guess.
      if (error?.name === 'TimeoutError' || error?.name === 'TypeError' || /did not respond|network|failed to fetch/i.test(message)) {
        return t("No answer from the card's service. If the card paid, this screen shows it.")
      }
      return t(safeWithdrawError(message))
    }
    function confirmHeldCard() {
      if (invoiceData.value) void card.confirm({ amountSats: invoiceData.value.amountSats })
    }
    function cancelCardPin() {
      if (!cardPinChecking.value) cardAuthorization.value?.cancel()
    }

    let successTimer = null
    const showCartSheet = ref(false)
    const showParkedSheet = ref(false)
    const parkPop = ref(false)
    let parkPopTimer = null
    const parked = useKioskParkedSales({
      lookup: (walletId, hash) => store.lookupInvoiceOnWallet(walletId, hash),
      onPaid: (sale) => {
        recordSale(sale.invoiceData, sale.saleBreakdown)
        void haptics.success()
        $q.notify({ type: 'positive', icon: 'check_circle', position: 'top', timeout: 4000,
          message: t('Parked sale paid'), caption: displaySats(sale.invoiceData.amountSats) })
      },
    })
    const parkedList = parked.list
    const parkedCount = parked.count
    const showUnlockDialog = ref(false)
    const showPinStep = ref(false)
    const unlockPinRef = ref(null)
    const unlockError = ref('')
    let tapCount = 0
    let tapTimer = null

    const isFiatMode = computed(() => store.kioskDisplayCurrency === 'fiat')
    const fiatRate = computed(() => {
      const currency = store.preferredFiatCurrency || 'USD'
      return store.exchangeRates[currency] || store.exchangeRates[currency.toLowerCase()] || 0
    })
    const fiatSymbol = computed(() => fiatSymbolFor(store.preferredFiatCurrency || 'USD').trim())
    const formattedDisplay = computed(() => {
      if (rawInput.value === '0') return '0'
      if (isFiatMode.value) return rawInput.value
      return (parseInt(rawInput.value) || 0).toLocaleString()
    })
    // Past ten characters the amount shrinks with its length so the
    // largest allowed entry (12 digits plus grouping) stays on screen.
    const amountFontStyle = computed(() => {
      const chars = formattedDisplay.value.length + (isFiatMode.value ? 1 : 3)
      return chars > 10 ? { fontSize: `${Math.max(1.5, (3 * 10) / chars).toFixed(2)}rem` } : null
    })
    const amountSats = computed(() => {
      const num = parseFloat(rawInput.value) || 0
      if (isFiatMode.value && fiatRate.value > 0) return Math.round((num / fiatRate.value) * 100_000_000)
      return Math.round(num)
    })
    const totalSatsForCharge = computed(() => accumulatedSats.value + amountSats.value)
    const kioskWalletName = computed(() => store.kioskWallet?.name || 'Kiosk')

    const tipOptions = computed(() => store.kioskTipValues.map(pct => ({ percent: pct, amount: Math.round(baseAmountSats.value * pct / 100) })))
    const selectedTipAmount = computed(() => selectedTipPercent.value === 0 ? 0 : Math.round(baseAmountSats.value * selectedTipPercent.value / 100))
    const totalBeforeRoundUp = computed(() => baseAmountSats.value + selectedTipAmount.value)
    /**
     * What the sale would round up to, or null when there is nothing to
     * offer. The arithmetic lives in utils/roundUp.js so it can be tested on
     * its own; the rule is the next convenient amount, with the step scaled
     * to the size of the bill.
     */
    const roundUpValue = computed(() => roundUpTargetSats({
      amountSats: totalBeforeRoundUp.value,
      isFiat: isFiatMode.value,
      rate: fiatRate.value,
    }))

    const finalAmountSats = computed(() => (useRoundUp.value && roundUpValue.value) ? roundUpValue.value : totalBeforeRoundUp.value)

    /**
     * Tipping and rounding up are two independent settings, so they are two
     * independent offers here.
     *
     * They used to be one: the extras screen was reached only when tipping
     * was on, which left a merchant who wanted rounding alone with a switch
     * that did nothing at all. Each now answers for itself, and the screen
     * shows whichever of them has something to offer.
     */
    const offersTip = computed(() => store.kioskTipEnabled && tipOptions.value.length > 0)

    // Rounding is only an offer when it would actually change the total. On a
    // sum that is already whole there is nothing to round, and a button that
    // adds zero is worse than no button.
    const offersRoundUp = computed(() => store.kioskRoundUpEnabled && !!roundUpValue.value)

    /** Whether the extras screen has any reason to exist for this sale. */
    const offersExtras = computed(() => offersTip.value || offersRoundUp.value)

    /**
     * What the screen is asking for, which decides its wording. Rounding up
     * is not a tip, and calling it one in front of a paying customer is both
     * wrong and, where tips are taxed differently, misleading.
     */
    const extrasMode = computed(() => {
      if (offersTip.value && offersRoundUp.value) return 'both'
      return offersTip.value ? 'tip' : 'roundUp'
    })

    const extrasTitle = computed(() => (
      extrasMode.value === 'roundUp' ? t('kiosk.roundUpPrompt') : t('kiosk.addTip')
    ))

    const extrasSkipLabel = computed(() => (
      extrasMode.value === 'roundUp' ? t('kiosk.exactAmount') : t('kiosk.noTip')
    ))

    /** The added amount is a tip or a rounding, never labelled as both. */
    const extraLabel = computed(() => (
      useRoundUp.value && selectedTipPercent.value === 0
        ? t('kiosk.roundUp')
        : t('kiosk.tipLabel')
    ))

    function handleNumpad(btn) {
      if (btn === 'delete') { rawInput.value = rawInput.value.length <= 1 ? '0' : rawInput.value.slice(0, -1); return }
      if (btn === '.') { if (!isFiatMode.value || rawInput.value.includes('.')) return; rawInput.value += '.'; return }
      if (rawInput.value.length >= 12) return
      if (isFiatMode.value && rawInput.value.includes('.')) { const d = rawInput.value.split('.')[1]; if (d && d.length >= 2) return }
      // Append, then collapse leading zeros so '0' + '5' becomes '5', not '05',
      // and '0' + '000' becomes '0' (still a valid zero state). Mirrors the
      // receive modal numpad's keypadTap() behaviour.
      let next = rawInput.value + btn
      while (next.length > 1 && next.startsWith('0') && !next.startsWith('0.')) {
        next = next.slice(1)
      }
      if (next.length > 12) next = next.slice(0, 12)
      rawInput.value = next
    }
    function addToAccumulated() { if (amountSats.value <= 0) return; accumulatedItems.value.push(amountSats.value); rawInput.value = '0' }
    function removeAccumulatedItem(idx) {
      accumulatedItems.value.splice(idx, 1)
      if (accumulatedItems.value.length === 0) showCartSheet.value = false
    }
    function clearAll() { rawInput.value = '0'; accumulatedItems.value = [] }

    function proceedToTipOrCharge() {
      if (state.value !== 'input' || totalSatsForCharge.value <= 0) return
      baseAmountSats.value = totalSatsForCharge.value
      selectedTipPercent.value = 0; useRoundUp.value = false
      // Either setting alone is enough to earn the screen. Reading only
      // kioskTipEnabled here is what made the round-up switch inert.
      if (offersExtras.value) {
        tipInteractive.value = false
        state.value = 'tipping'
        setTimeout(() => { tipInteractive.value = true }, 300)
      } else {
        createCharge()
      }
    }
    function confirmTip() { createCharge() }

    async function createCharge() {
      if (state.value !== 'input' && state.value !== 'tipping') return
      const revision = ++saleRevision
      const walletId = store.kioskWalletId
      const amountSats = finalAmountSats.value
      if (!walletId || !Number.isSafeInteger(amountSats) || amountSats <= 0) return
      const current = () => revision === saleRevision && walletId === store.kioskWalletId && store.kioskEnabled && !store.kioskOwnerAccess
      captureSaleBreakdown()
      cardProblem.value = ''
      state.value = 'processing'; invoiceData.value = null; qrDataUrl.value = ''
      paymentProblem.value = ''
      try {
        // A sale this wallet could never see paid is refused before a QR is
        // shown (its connection may have lost the grant since it was chosen).
        const wallet = store.wallets.find(w => w.id === walletId)
        if (kioskWalletBlocker(wallet) === KIOSK_BLOCKER.CANNOT_CONFIRM) {
          throw nwcError(NWC_ERROR.CONFIRM_NOT_ALLOWED, 'This connection cannot confirm payments')
        }
        // The store knows how each kind of wallet makes an invoice (NWC
        // included) and reconnects one whose connection went stale (hot
        // reload, wallet switch, Spark disconnect on lock), as it does for
        // every other screen that asks a wallet to receive.
        const result = await store.createInvoiceDetailsOnWallet(walletId, amountSats, 'Kiosk Payment')
        if (!current()) return
        if (!result.paymentHash) throw new Error('Invoice must have a payment_hash')
        invoiceData.value = { ...result, walletId, amountSats }
        const qr = await QRCode.toDataURL(result.paymentRequest, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
        if (!current()) return
        qrDataUrl.value = qr
        state.value = 'payment'; startPolling()
      } catch (err) {
        if (!current()) return
        card.reset()
        console.error('[kiosk] charge error:', err)
        // Unified dialog. Same modal users see across every other
        // payment failure in the app, so the kiosk operator gets a
        // familiar surface (and a "Copy details" button for support)
        // instead of a thin caption-only toast.
        store.showPaymentError(err, { context: 'kiosk', t })
        state.value = 'input'
      }
    }
    function startPolling() {
      clearPolling()
      const invoice = invoiceData.value
      if (!invoice) return
      paymentProblem.value = ''
      retryStatus.value = false
      const monitor = createPaymentMonitor({ maxAttempts: Number.MAX_SAFE_INTEGER, maxInterval: 3000, expiryBuffer: 0 })
      paymentMonitor = monitor
      let failures = 0
      monitor.start({
        invoice: { payment_hash: invoice.paymentHash, amount: invoice.amountSats, expires_at: invoice.expiresAt || invoice.expires_at },
        provider: { lookupInvoice: async hash => {
          try {
            const result = await store.lookupInvoiceOnWallet(invoice.walletId, hash)
            failures = 0
            return result
          } catch (error) {
            if (++failures >= 5 && store.wallets.find(wallet => wallet.id === invoice.walletId)?.type === 'spark') {
              failures = 0
              await store.connectSparkWallet(invoice.walletId, { forceReinit: true })
            }
            throw error
          }
        } },
        onStatusChange(status) {
          if (paymentMonitor !== monitor || invoiceData.value !== invoice) return
          if (status === PaymentStatus.CONFIRMED) { paidByCard.value = card.phase.value === 'waiting'; clearPolling(); showSuccess() }
          else if (status === PaymentStatus.EXPIRED || status === PaymentStatus.ERROR) {
            paymentProblem.value = t(status === PaymentStatus.EXPIRED ? 'Payment expired' : 'Could not check payment status. Please check again.')
            retryStatus.value = status === PaymentStatus.ERROR
          }
        },
      })
      visibilityHandler = () => { if (document.visibilityState === 'visible') monitor.checkNow() }
      document.addEventListener('visibilitychange', visibilityHandler)
      void monitor.checkNow()
    }
    function clearPolling() {
      paymentMonitor?.stop()
      paymentMonitor = null
      if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
    function cancelPayment() { saleRevision++; clearPolling(); card.reset(); cardProblem.value = ''; invoiceData.value = null; saleBreakdownSnapshot.value = null; state.value = 'input' }

    /**
     * Set the sale on screen aside, still watched, and free the register.
     * Nothing is ever dropped to make room: a full list says so instead.
     */
    function parkInvoice() {
      if (!invoiceData.value) return
      if (parked.full.value) {
        $q.notify({ type: 'warning', position: 'top', timeout: 4000, message: t('{n} sales are parked', { n: MAX_PARKED }), caption: t('Open or remove one first.') })
        return
      }
      const ok = parked.park({
        invoiceData: invoiceData.value,
        baseAmountSats: baseAmountSats.value,
        accumulatedItems: [...accumulatedItems.value],
        // Carried with the sale so a SECOND charge started while this one
        // waits can't clobber the snapshot it needs once paid.
        saleBreakdown: saleBreakdownSnapshot.value
      })
      if (!ok) return
      saleRevision++
      clearPolling()
      card.reset()
      cardProblem.value = ''
      rawInput.value = '0'
      accumulatedItems.value = []
      baseAmountSats.value = 0
      selectedTipPercent.value = 0
      useRoundUp.value = false
      invoiceData.value = null
      qrDataUrl.value = ''
      saleBreakdownSnapshot.value = null
      state.value = 'input'
      void haptics.medium()
      // The header pill takes the sale: it pops so the eye follows it there.
      parkPop.value = false
      clearTimeout(parkPopTimer)
      requestAnimationFrame(() => { parkPop.value = true; parkPopTimer = setTimeout(() => { parkPop.value = false }, 600) })
    }

    /** A parked sale opens on an empty register only: nothing on it is lost. */
    const canResume = computed(() => state.value === 'input' && rawInput.value === '0' && accumulatedItems.value.length === 0)

    async function resumeParked(id) {
      if (!canResume.value) return
      const sale = parked.take(id)
      if (!sale) return
      showParkedSheet.value = false
      saleRevision++
      const revision = saleRevision
      cardProblem.value = ''
      paymentProblem.value = ''
      invoiceData.value = sale.invoiceData
      baseAmountSats.value = sale.baseAmountSats
      accumulatedItems.value = sale.accumulatedItems || []
      saleBreakdownSnapshot.value = sale.saleBreakdown || null
      qrDataUrl.value = ''
      state.value = 'payment'
      startPolling()
      try {
        const qr = await QRCode.toDataURL(sale.invoiceData.paymentRequest, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
        if (revision === saleRevision) qrDataUrl.value = qr
      } catch (error) {
        console.error('[kiosk] QR for a parked sale:', error)
      }
    }

    /** "2 items · 4 min ago": enough to tell parked sales apart at a glance. */
    function parkedMeta(sale) {
      const minutes = Math.max(0, Math.round((Date.now() - sale.parkedAt) / 60000))
      const age = minutes < 1 ? t('just now') : t('{n} min ago', { n: minutes })
      const items = sale.accumulatedItems?.length || 0
      return items > 1 ? `${items} ${t('kiosk.items')} · ${age}` : age
    }

    /**
     * Removing stops the watch. An expired sale goes at once; one that can
     * still be paid asks first, because a payment after removal reaches the
     * wallet without the kiosk showing the sale.
     */
    function removeParked(sale) {
      if (sale.status === 'expired') { parked.remove(sale.id); if (!parkedCount.value) showParkedSheet.value = false; return }
      $q.dialog({
        title: t('Remove parked sale?'),
        message: t('If the customer still pays it, the sats reach the wallet but this kiosk will not show the sale.'),
        cancel: { label: t('Keep'), flat: true, noCaps: true },
        ok: { label: t('Remove'), flat: true, noCaps: true, color: 'negative' },
        persistent: true,
      }).onOk(() => {
        parked.remove(sale.id)
        if (!parkedCount.value) showParkedSheet.value = false
      })
    }

    /**
     * Snapshot the sale breakdown before creating this invoice, while
     * baseAmountSats/selectedTipPercent/useRoundUp/
     * accumulatedItems are all settled by this point (nothing between here
     * and a paid invoice mutates them except a park or a reset, both of
     * which now carry/clear this same snapshot). Never fabricated — a
     * non-positive total (shouldn't happen; the charge button is disabled
     * below that) leaves the snapshot cleared rather than stamping zeros.
     *
     * `discountSats` is always 0: the POS has no discount control yet, but
     * the field is reserved so Tx Details can render a Discount row the
     * day one exists without another metadata shape change.
     */
    function captureSaleBreakdown() {
      const total = finalAmountSats.value
      if (!(total > 0)) { saleBreakdownSnapshot.value = null; return }
      const hasPercentTip = !useRoundUp.value && selectedTipPercent.value > 0
      saleBreakdownSnapshot.value = {
        baseSats: baseAmountSats.value,
        tipSats: total - baseAmountSats.value,
        tipPercent: hasPercentTip ? selectedTipPercent.value : null,
        roundUp: useRoundUp.value,
        discountSats: 0,
        itemCount: accumulatedItems.value.length,
        totalSats: total
      }
    }

    /** Stamp a paid sale onto its incoming tx, and refresh the wallet. */
    function recordSale(invoice, breakdown) {
      void store.refreshBalance(invoice.walletId)
      // Stamp the sale onto the incoming tx once it surfaces in history.
      // Best-effort and non-blocking: the kiosk boots on its own path, so
      // the metadata store lazy-initializes itself, and a metadata failure
      // must never stall or break the success screen.
      try {
        metadataStore.enqueuePendingContactLink({
          label: t('Kiosk sale'),
          source: 'kiosk',
          direction: 'incoming',
          amountSats: invoice.amountSats,
          // The kiosk's destination wallet — the one whose tx list will
          // actually show the sale once it surfaces.
          walletId: invoice.walletId,
          // The curated subtotal/tip/round-up/total captured at invoice
          // creation (see captureSaleBreakdown) — null when there was
          // nothing meaningful to attach.
          saleBreakdown: breakdown,
        }).catch(() => {})
      } catch (_) { /* non-critical */ }
    }

    function showSuccess() {
      // Idempotent: overlapping poll chains or a race between the event and
      // the poll must not record the same sale twice.
      if (state.value === 'success') return
      recordSale(invoiceData.value, saleBreakdownSnapshot.value)
      state.value = 'success'
      // Felt at the counter while the goods change hands.
      void haptics.success()
      clearTimeout(successTimer)
      successTimer = setTimeout(resetToInput, 7000)
    }

    function resetToInput() {
      cancelPayment()
      paidByCard.value = false
      clearTimeout(successTimer)
      rawInput.value = '0'
      accumulatedItems.value = []
      baseAmountSats.value = 0
      selectedTipPercent.value = 0
      useRoundUp.value = false
      invoiceData.value = null
      qrDataUrl.value = ''
      saleBreakdownSnapshot.value = null
      state.value = 'input'
    }
    function formatSats(sats) { return new Intl.NumberFormat().format(sats) }

    function displaySats(sats) {
      if (isFiatMode.value && fiatRate.value > 0) {
        const fiat = (sats / 100_000_000) * fiatRate.value
        return `${fiatSymbol.value} ${fiat.toFixed(2)}`
      }
      return `${formatSats(sats)} sats`
    }

    function handleUnlockPin(pin) { if (store.unlockToOwnerMode(pin)) { showUnlockDialog.value = false; router.push('/wallet') } else { unlockError.value = t('kiosk.incorrectPin') } }
    function resetUnlock() { showPinStep.value = false; unlockError.value = ''; if (unlockPinRef.value) unlockPinRef.value.reset() }
    function handleScreenTap() { tapCount++; clearTimeout(tapTimer); tapTimer = setTimeout(() => { tapCount = 0 }, 5000); if (tapCount >= 13) { tapCount = 0; store.forceUnlockKiosk(); router.push('/wallet') } }

    watch(() => store.pendingDeepLink, payment => {
      if (payment?.target !== 'kiosk') return
      store.pendingDeepLink = null
      if (!store.kioskEnabled || store.kioskOwnerAccess || state.value === 'success') return
      if (card.phase.value === 'empty') cardProblem.value = ''
      if (card.accept(payment) && state.value === 'input' && totalSatsForCharge.value > 0) proceedToTipOrCharge()
    }, { immediate: true })

    watch(() => [store.kioskWalletId, store.kioskEnabled, store.kioskOwnerAccess], () => cancelPayment(), { flush: 'sync' })

    onMounted(async () => {
      // Load persisted state if store hasn't initialized yet
      if (!store.kioskEnabled) {
        await store.initialize()
      }

      // Redirect away if kiosk is not active
      if (!store.kioskEnabled || store.kioskOwnerAccess) {
        router.replace('/wallet')
        return
      }

      // Connect only the kiosk wallet. Use ensureWalletConnectedForTransfer
      // so a stale provider entry (where this.wallet was released) is
      // detected and reconnected — `providers[id]` alone is not a liveness
      // check for Spark.
      const walletId = store.kioskWalletId
      if (walletId) {
        try {
          await store.ensureWalletConnectedForTransfer(walletId)
        } catch (err) {
          console.error('[kiosk] Failed to connect wallet:', err.message)
        }
      }

      walletReady.value = !!store.providers[store.kioskWalletId]
    })
    isNfcAvailable().then((ok) => { nfcReady.value = ok }).catch(() => {})
    onUnmounted(() => { saleRevision++; clearPolling(); clearTimeout(tapTimer); clearTimeout(successTimer); clearTimeout(parkPopTimer) })

    return {
      state, walletReady, rawInput, formattedDisplay, amountFontStyle, amountSats, isFiatMode, fiatSymbol, kioskWalletName,
      accumulatedItems, accumulatedSats, totalSatsForCharge,
      handleNumpad, addToAccumulated, removeAccumulatedItem, clearAll, proceedToTipOrCharge,
      tipOptions, selectedTipPercent, selectedTipAmount, tipInteractive,
      totalBeforeRoundUp, roundUpValue, useRoundUp, finalAmountSats,
      offersTip, offersRoundUp, extrasTitle, extrasSkipLabel, extraLabel,
      baseAmountSats, formatSats, displaySats, createCharge, confirmTip,
      card, cardAuthorization, cardBusy, cardPinActive, cardPinChecking, cardProblem, paidByCard, nfcReady,
      confirmHeldCard, cancelCardPin, paymentProblem, retryStatus, startPolling,
      invoiceData, qrDataUrl, cancelPayment, parkInvoice, resumeParked, resetToInput,
      parkedList, parkedCount, canResume, showParkedSheet, parkPop, parkedMeta, removeParked,
      showCartSheet, showUnlockDialog, showPinStep, unlockPinRef, unlockError,
      handleUnlockPin, resetUnlock, handleScreenTap, store
    }
  }
})
</script>

<style scoped>
/* padding-top: 0 cancels the global `.q-page { padding-top: var(--safe-top) }`
   in app.css. The kiosk shell is exactly one viewport tall, so inheriting that
   pad would make the page 100dvh + --safe-top — it scrolls, and the charge
   button at the bottom of the shell is pushed behind the system nav bar. The
   status-bar inset is taken by .kiosk-header instead (same pattern as
   .shop-page / .shop-header in ShopPage.vue). */
.kiosk-page { min-height: 100dvh; padding-top: 0; display: flex; justify-content: center; }
.kiosk-shell { width: 100%; max-width: 448px; height: 100vh; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
.kiosk-dark { background: #0f0f14; color: #e8eaed; }
.kiosk-light { background: var(--bg-primary); color: var(--text-primary); }

/* Header */
.kiosk-header { display: flex; align-items: center; justify-content: space-between; padding: calc(14px + var(--safe-top, 0px)) 16px 14px; flex-shrink: 0; position: relative; }
.kiosk-logo { position: absolute; left: 50%; transform: translateX(-50%); display: flex; align-items: center; }
.kiosk-wallet-badge { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; font-family: 'Manrope', sans-serif; padding: 5px 10px; border-radius: 8px; background: rgba(255,255,255,0.05); color: #9ca3af; letter-spacing: 0.2px; }
.kiosk-light .kiosk-wallet-badge { background: var(--bg-input); color: var(--text-secondary); }
.kiosk-logo-img { height: 26px; width: auto; }
.kiosk-lock-btn { width: 34px; height: 34px; border-radius: 10px; border: none; background: rgba(255,255,255,0.05); color: #6b7280; display: flex; align-items: center; justify-content: center; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.kiosk-lock-btn:active { transform: scale(0.94); }
.kiosk-light .kiosk-lock-btn { background: var(--bg-input); }

/* State center */
.pos-state-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 20px; padding-bottom: max(24px, var(--safe-bottom, 16px)); text-align: center; }
.pos-state-title { font-size: 1rem; font-weight: 700; font-family: 'Manrope', sans-serif; }
.pos-state-sub { font-size: 0.75rem; color: #6b7280; margin-top: 4px; }
.mt-2 { margin-top: 0.5rem; } .mt-4 { margin-top: 1rem; } .mt-6 { margin-top: 1.5rem; } .mt-8 { margin-top: 2rem; }

/* Primary btn */
.pos-primary-btn { width: 100%; height: 56px; display: flex; align-items: center; justify-content: center; gap: 8px; border: none; border-radius: 14px; cursor: pointer; font-family: 'Manrope', sans-serif; font-size: 0.9375rem; font-weight: 700; background: #1a1a1a; color: #fff; box-shadow: 0 6px 20px -4px rgba(0,0,0,0.25); transition: transform 0.08s ease, box-shadow 0.08s ease; -webkit-tap-highlight-color: transparent; }
.pos-primary-btn:active { transform: scale(0.97); box-shadow: 0 2px 8px -2px rgba(0,0,0,0.2); }
.kiosk-light .pos-primary-btn { background: #1a1a1a; }
.pos-btn-disabled { background: #2a2a2a !important; color: #555 !important; box-shadow: none !important; cursor: default; }
.pos-btn-disabled:active { transform: none !important; }
.kiosk-light .pos-btn-disabled { background: var(--border-card) !important; color: var(--text-muted) !important; }

/* A secondary action that sits UNDER a full-width primary rather than beside
   a sibling. It shares the primary's width and alignment so the pair reads as
   one stack; `.pos-text-btn` is shaped for the inline Park / Cancel row and
   became a small chip marooned in the corner when it was used here. */
.pos-secondary-btn { width: 100%; height: 48px; display: flex; align-items: center; justify-content: center; background: transparent; border: 1px solid rgba(107,114,128,0.3); border-radius: 14px; color: #9ca3af; font-family: 'Manrope', sans-serif; font-size: 0.9375rem; font-weight: 600; cursor: pointer; margin-top: 10px; -webkit-tap-highlight-color: transparent; transition: transform 0.08s ease, background 0.12s ease, border-color 0.12s ease; }
.pos-secondary-btn:active { transform: scale(0.98); background: rgba(107,114,128,0.08); border-color: rgba(107,114,128,0.45); }
.kiosk-light .pos-secondary-btn { border-color: var(--border-card); color: var(--text-muted); }

/* Text btn */
.pos-text-btn { background: transparent; border: 1px solid rgba(107,114,128,0.45); border-radius: 10px; color: #6b7280; font-size: 14px; font-family: 'Manrope', sans-serif; font-weight: 600; cursor: pointer; padding: 10px 22px; margin-top: 4px; -webkit-tap-highlight-color: transparent; transition: transform 0.08s ease, background 0.12s ease, border-color 0.12s ease; }
.pos-text-btn:active { transform: scale(0.96); background: rgba(107,114,128,0.08); }
.kiosk-light .pos-text-btn { border-color: rgba(107,114,128,0.5); }
.pos-cancel-btn { color: #ef4444; border-color: rgba(239,68,68,0.5); }
.pos-cancel-btn:active { background: rgba(239,68,68,0.08); }

/* Sats pill */
.pos-amount-pill { display: inline-flex; align-items: center; gap: 4px; background: rgba(5,149,115,0.08); border: 1px solid rgba(5,149,115,0.18); border-radius: 9999px; padding: 5px 14px; font-size: 0.875rem; font-weight: 700; color: #059573; letter-spacing: 0.01em; font-family: 'Manrope', sans-serif; }
.kiosk-light .pos-amount-pill { background: rgba(5,149,115,0.06); }

/* Paid */
.pos-paid-ring { width: 80px; height: 80px; border-radius: 50%; background: #059573; color: white; display: flex; align-items: center; justify-content: center; animation: paid-pop 0.4s cubic-bezier(0.34,1.56,0.64,1); }
@keyframes paid-pop { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }

/* Processing */
.pos-processing-wrap { position: relative; width: 80px; height: 80px; }
.pos-processing-ring { position: absolute; inset: 0; border-radius: 50%; border: 3px solid rgba(5,149,115,0.25); animation: ring-expand 2s ease-out infinite; }
.pos-ring-2 { animation-delay: 0.7s; }
.pos-processing-core { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #059573; }
@keyframes ring-expand { 0% { transform: scale(1); opacity: 0.7; } 100% { transform: scale(2.2); opacity: 0; } }

/* QR */
.pos-qr-label { font-size: 0.8125rem; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 6px; font-family: 'Manrope', sans-serif; }
.pos-qr-amount-lg { font-size: 2rem; font-weight: 800; font-family: 'Manrope', sans-serif; margin: 0 0 20px; letter-spacing: -0.02em; }
.pos-qr-area { display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
.pos-qr-card { background: white; border-radius: 20px; padding: 16px; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 32px -8px rgba(0,0,0,0.15); }
.pos-qr-img { width: 220px; height: 220px; display: block; border-radius: 10px; }
.animate-pop { animation: paid-pop 0.4s cubic-bezier(0.34,1.56,0.64,1); }

/* Cart summary row */
.pos-cart-summary {
  display: flex; align-items: center; justify-content: space-between;
  margin: 4px 20px 0; padding: 8px 14px;
  border-radius: 10px; background: rgba(5,149,115,0.06);
  border: 1px solid rgba(5,149,115,0.15);
  cursor: pointer; flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
  font-family: 'Manrope', sans-serif;
}
.kiosk-light .pos-cart-summary { background: rgba(5,149,115,0.04); }
.pos-cart-count { font-size: 13px; font-weight: 600; color: #059573; }
.pos-cart-x { background: none; border: none; color: #6b7280; cursor: pointer; padding: 2px; -webkit-tap-highlight-color: transparent; }
.pos-cart-x:active { color: #ef4444; }

/* Cart bottom sheet */
.pos-cart-sheet { width: 100%; border-radius: 16px 16px 0 0 !important; }
.pos-cart-sheet-dark { background: #0C0C0C !important; border: 1px solid #2A342A !important; border-bottom: none !important; color: #FFF; }
.pos-cart-sheet-light { background: var(--bg-card) !important; border: 1px solid var(--border-card) !important; border-bottom: none !important; color: var(--text-primary); }
.pos-sheet-header { display: flex; justify-content: space-between; font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 15px; padding-bottom: 12px; border-bottom: 1px solid #2A342A; margin-bottom: 8px; }
.pos-cart-sheet-light .pos-sheet-header { border-color: var(--border-card); }
.pos-sheet-total { color: #059573; }
.pos-sheet-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-family: 'Manrope', sans-serif; font-size: 14px; }
.pos-sheet-remove { background: none; border: none; cursor: pointer; padding: 4px; -webkit-tap-highlight-color: transparent; }
.pos-cart-sheet-dark .pos-sheet-remove { color: rgba(255, 255, 255, 0.4); }
.pos-cart-sheet-light .pos-sheet-remove { color: var(--text-muted); }
.pos-sheet-remove:active { color: #ef4444; }

.kiosk-header-left { display: flex; align-items: center; gap: 6px; }

.pos-parked-line { align-self: center; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 6px 12px 6px 10px; border: none; border-radius: 999px; background: rgba(247,147,26,0.1); color: #F7931A; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; -webkit-tap-highlight-color: transparent; flex-shrink: 0; }
.kiosk-light .pos-parked-line { color: #8A5F00; background: rgba(138,95,0,0.08); }
.pos-parked-line-chevron { opacity: 0.7; margin-left: -2px; }
.pos-parked-line--pop { animation: park-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes park-pop { 0% { transform: scale(1); } 35% { transform: scale(1.12); } 100% { transform: scale(1); } }

/* Payment screen actions: two equal, labelled buttons. */
.pos-payment-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 100%; max-width: 340px; margin-top: 18px; }
.pos-outline-btn { height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 14px; border: 1px solid rgba(107,114,128,0.4); background: transparent; color: inherit; font-family: 'Manrope', sans-serif; font-size: 0.9375rem; font-weight: 700; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: transform 0.08s ease, background 0.12s ease; }
.pos-outline-btn:active { transform: scale(0.97); background: rgba(107,114,128,0.08); }
.kiosk-light .pos-outline-btn { border-color: var(--border-card); }

/* ─── Cards ─── */
.pos-qr-hint { font-size: 0.8125rem; color: #9ca3af; margin: -4px 0 0; }
.pos-contactless { width: 20px; height: 20px; flex: none; }
.pos-card-lane { display: flex; align-items: center; gap: 12px; width: 100%; max-width: 340px; margin-top: 16px; padding: 12px 14px; border-radius: 16px; background: rgba(255,255,255,0.05); text-align: left; }
.kiosk-light .pos-card-lane { background: var(--bg-input); }
.pos-card-wave { position: relative; width: 42px; height: 42px; flex: none; border-radius: 50%; display: grid; place-items: center; background: rgba(21,222,114,0.14); color: #15DE72; }
.kiosk-light .pos-card-wave { color: #059573; background: rgba(5,149,115,0.1); }
.pos-card-wave::before, .pos-card-wave::after { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid currentColor; opacity: 0; animation: card-ring 2.4s ease-out infinite; }
.pos-card-wave::after { animation-delay: 1.2s; }
@keyframes card-ring { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(1.7); opacity: 0; } }
.pos-card-lane-text { display: flex; flex-direction: column; font-family: 'Manrope', sans-serif; }
.pos-card-lane-text b { font-size: 0.875rem; }
.pos-card-lane-text span { font-size: 0.75rem; color: #9ca3af; }
.pos-card-problem { display: flex; gap: 10px; align-items: flex-start; width: 100%; max-width: 340px; margin-top: 16px; padding: 12px 14px; border-radius: 14px; background: rgba(239,68,68,0.1); color: #f87171; font-size: 0.8125rem; line-height: 1.45; text-align: left; font-family: 'Manrope', sans-serif; }
.kiosk-light .pos-card-problem { color: #B42332; background: rgba(180,35,50,0.07); }
.pos-card-problem b { font-weight: 700; }
.pos-card-stage { width: 100%; max-width: 300px; display: flex; flex-direction: column; align-items: center; gap: 18px; margin: 8px 0 4px; }
.pos-card-status { display: inline-flex; align-items: center; gap: 8px; font-family: 'Manrope', sans-serif; font-size: 0.9375rem; font-weight: 600; color: #9ca3af; }
.pos-card-confirm { margin-top: 4px; }
.pos-card-other { margin-top: 12px; }
.pos-card-held { align-self: center; display: inline-flex; align-items: center; gap: 8px; margin-top: 4px; padding: 8px 14px; border-radius: 999px; background: rgba(21,222,114,0.12); color: #3FE08C; font-family: 'Manrope', sans-serif; font-size: 0.8125rem; font-weight: 700; }
.kiosk-light .pos-card-held { background: rgba(5,149,115,0.1); color: #046B53; }
.pos-pay :deep(.card-pin) { max-width: 340px; }
.pos-paid-method { margin-top: 8px; font-size: 0.8125rem; color: #9ca3af; font-family: 'Manrope', sans-serif; }

/* ─── Parked sales ─── */
.pos-parked-note { font-size: 12px; font-weight: 500; color: #9ca3af; }
.pos-parked-hint { margin: 0 0 6px; font-size: 12.5px; color: #9ca3af; font-family: 'Manrope', sans-serif; }
.pos-parked-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
.pos-cart-sheet-light .pos-parked-row { border-color: var(--border-card); }
.pos-parked-row:last-child { border-bottom: none; }
.pos-parked-open { flex: 1; min-width: 0; min-height: 52px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; background: none; border: none; padding: 4px 0; color: inherit; text-align: left; cursor: pointer; font-family: 'Manrope', sans-serif; -webkit-tap-highlight-color: transparent; }
.pos-parked-open:disabled { cursor: default; }
.pos-parked-amount { font-size: 1.0625rem; font-weight: 800; letter-spacing: -0.01em; }
.pos-parked-meta { font-size: 12px; color: #9ca3af; }
.pos-parked-row--expired .pos-parked-amount { color: #9ca3af; text-decoration: line-through; text-decoration-color: rgba(156,163,175,0.5); }
.pos-parked-status { font-size: 11.5px; font-weight: 700; padding: 4px 9px; border-radius: 999px; font-family: 'Manrope', sans-serif; }
.pos-parked-status--waiting { background: rgba(247,147,26,0.12); color: #F7931A; }
.pos-parked-status--expired { background: rgba(156,163,175,0.14); color: #9ca3af; }

@media (prefers-reduced-motion: reduce) {
  .pos-parked-line--pop, .pos-card-wave::before, .pos-card-wave::after { animation: none; }
}

/* Amount */
.pos-top { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem 1.5rem 0.5rem; overflow: hidden; }
.pos-amount-area { text-align: center; }
.pos-amount-row { display: flex; align-items: baseline; justify-content: center; gap: 4px; margin-bottom: 8px; }
.pos-currency-sym { font-size: 1.75rem; font-weight: 600; color: #6b7280; font-family: 'Manrope', sans-serif; }
.pos-amount-value { font-size: 4rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1; font-family: 'Manrope', sans-serif; }
.pos-amount-sm { font-size: 3rem; }
.pos-currency-suffix { font-size: 1.25rem; font-weight: 600; color: #6b7280; margin-left: 6px; align-self: center; font-family: 'Manrope', sans-serif; }
.pos-fiat-hint { font-size: 0.8125rem; font-weight: 500; color: #6b7280; margin-top: 6px; font-family: 'Manrope', sans-serif; }

/* Keypad */
.pos-bottom { flex-shrink: 0; padding: 4px 20px 0; }
.pos-keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
.pos-key { height: 56px; border-radius: 14px; border: none; display: flex; align-items: center; justify-content: center; font-family: 'Manrope', sans-serif; font-size: 1.375rem; font-weight: 700; cursor: pointer; transition: transform 0.08s ease, background 0.08s ease; -webkit-tap-highlight-color: transparent; }
.pos-key-num { background: rgba(255,255,255,0.05); color: inherit; border: 1px solid rgba(255,255,255,0.04); }
.pos-key-num:active { background: rgba(255,255,255,0.1); transform: scale(0.94); }
.kiosk-light .pos-key-num { background: var(--bg-input); border-color: var(--border-card); }
.kiosk-light .pos-key-num:active { background: var(--border-card); }
.pos-key-action { background: transparent; color: #6b7280; }
.pos-key-action:active { color: inherit; transform: scale(0.94); }

/* Actions */
/* 48px floor clears a 3-button Android nav bar even when the WebView
   reports zero bottom inset (edge-to-edge mode). var(--safe-bottom)
   wins on devices that report a larger inset (notch landscape, etc.). */
/* Additive, not max(): with max() a 3-button nav bar (--safe-bottom ≈ 48px)
   yields exactly 48px, leaving the charge button flush against the bar. The
   calc keeps the familiar 48px on gesture nav (16 + 32px floor) and grows to a
   real gap on 3-button devices. */
.pos-actions { display: flex; gap: 10px; padding-bottom: calc(16px + var(--safe-bottom, 16px)); }
.pos-add-btn { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; flex-shrink: 0; background: rgba(5,149,115,0.08); color: #059573; border: 1.5px solid rgba(5,149,115,0.25); border-radius: 14px; cursor: pointer; transition: transform 0.08s ease, background 0.08s ease; -webkit-tap-highlight-color: transparent; }
.pos-add-btn:active:not(:disabled) { transform: scale(0.94); background: rgba(5,149,115,0.15); }
.kiosk-light .pos-add-btn { background: rgba(5,149,115,0.05); }
.pos-charge-btn { flex: 1; }

/* Tipping */
.tip-screen { flex: 1; display: flex; flex-direction: column; justify-content: space-between; padding: 1.5rem 1.25rem; padding-bottom: calc(1.5rem + var(--safe-bottom, 0px)); opacity: 0; transition: opacity 0.3s ease; }
.tip-screen.tip-ready { opacity: 1; }
.tip-header { text-align: center; flex-shrink: 0; padding-bottom: 0.75rem; }
.tip-prompt { display: block; font-size: 1.25rem; font-weight: 700; font-family: 'Manrope', sans-serif; line-height: 1.3; margin-bottom: 1rem; }
.tip-subtotal-pill { display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.05); border-radius: 10px; padding: 8px 16px; }
.kiosk-light .tip-subtotal-pill { background: var(--bg-input); }
.tip-subtotal-label { font-size: 0.8125rem; font-weight: 600; color: #9ca3af; }
.tip-subtotal-val { font-size: 1.125rem; font-weight: 800; letter-spacing: -0.01em; }
.tip-body { display: flex; flex-direction: column; gap: 12px; flex: 1; justify-content: center; min-height: 0; padding: 1rem 0; }
.tip-options { display: flex; gap: 10px; }
.tip-opt { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 72px; padding: 16px 8px; border-radius: 16px; border: 2px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); transition: all 0.18s ease; cursor: pointer; -webkit-tap-highlight-color: transparent; font-family: 'Manrope', sans-serif; }
.tip-opt:active { transform: scale(0.96); }
.kiosk-light .tip-opt { background: var(--bg-input); border-color: var(--border-card); }
.tip-opt-pct { font-size: 1.25rem; font-weight: 800; color: #e8eaed; }
.kiosk-light .tip-opt-pct { color: var(--text-primary); }
.tip-opt-amt { font-size: 0.8125rem; font-weight: 600; color: #9ca3af; }
/* Active tip % — tinted-green pane matching the app-wide selection
   grammar (14% wash + 1px inset ring + saturated label). */
.tip-opt-on {
  background: rgba(21, 222, 114, 0.14) !important;
  border-color: transparent !important;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22) !important;
}
.tip-opt-on .tip-opt-pct { color: #15DE72; }
.tip-opt-on .tip-opt-amt { color: #15DE72; }
.kiosk-light .tip-opt-on {
  background: rgba(5, 149, 115, 0.10) !important;
  box-shadow: inset 0 0 0 1px rgba(5, 149, 115, 0.20) !important;
}
.kiosk-light .tip-opt-on .tip-opt-pct,
.kiosk-light .tip-opt-on .tip-opt-amt { color: #059573; }

.tip-roundup { display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 14px 16px; border-radius: 16px; background: rgba(255,255,255,0.03); border: 2px solid rgba(255,255,255,0.08); transition: all 0.18s ease; cursor: pointer; -webkit-tap-highlight-color: transparent; font-family: 'Manrope', sans-serif; }
.tip-roundup:active { transform: scale(0.97); }
.kiosk-light .tip-roundup { background: var(--bg-input); border-color: var(--border-card); }
.kiosk-light .tip-roundup-val { color: var(--text-primary); }
.kiosk-light .tip-roundup-label { color: var(--text-secondary); }
.tip-roundup-icon { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; background: rgba(255,255,255,0.06); color: #6b7280; flex-shrink: 0; }
.kiosk-light .tip-roundup-icon { background: var(--border-card); }
.tip-roundup-label { font-size: 0.875rem; font-weight: 600; color: #9ca3af; flex: 1; }
.tip-roundup-val { font-size: 1rem; font-weight: 700; color: #d1d5db; }
/* Round-up row active — same tinted-green selection grammar. */
.tip-roundup-on {
  background: rgba(21, 222, 114, 0.14) !important;
  border-color: transparent !important;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22);
}
.tip-roundup-on .tip-roundup-icon { background: rgba(21, 222, 114, 0.22); color: #15DE72; }
.tip-roundup-on .tip-roundup-label { color: #15DE72; }
.tip-roundup-on .tip-roundup-val { color: #15DE72; }
.kiosk-light .tip-roundup-on {
  background: rgba(5, 149, 115, 0.10) !important;
  box-shadow: inset 0 0 0 1px rgba(5, 149, 115, 0.20);
}
.kiosk-light .tip-roundup-on .tip-roundup-icon { background: rgba(5, 149, 115, 0.18); color: #059573; }
.kiosk-light .tip-roundup-on .tip-roundup-label,
.kiosk-light .tip-roundup-on .tip-roundup-val { color: #059573; }

.tip-skip { padding: 14px; background: transparent; border: none; font-size: 0.875rem; font-weight: 500; color: #6b7280; text-align: center; text-decoration: underline; text-decoration-color: rgba(107,114,128,0.3); text-underline-offset: 3px; cursor: pointer; -webkit-tap-highlight-color: transparent; font-family: 'Manrope', sans-serif; }
.tip-skip:active { color: inherit; }

.tip-footer { flex-shrink: 0; }
.tip-breakdown { background: rgba(255,255,255,0.04); border-radius: 14px; padding: 12px 16px; margin-bottom: 14px; }
.kiosk-light .tip-breakdown { background: var(--bg-input); }
.tip-break-row { display: flex; justify-content: space-between; font-size: 0.875rem; font-weight: 500; color: #9ca3af; padding: 4px 0; font-family: 'Manrope', sans-serif; }
.tip-break-tip { color: #d1d5db; }
.tip-break-val { color: #059573; font-weight: 700; }
.tip-break-divider { height: 1px; background: rgba(255,255,255,0.06); margin: 6px 0; }
.kiosk-light .tip-break-divider { background: var(--border-card); }
.tip-break-total { font-weight: 800; font-size: 1.0625rem; color: #e8eaed; padding-top: 6px; }
.kiosk-light .tip-break-total { color: var(--text-primary); }

/* Dialog */
/* Dialog */
.kiosk-dialog { background: var(--bg-card); border-radius: var(--radius-lg); padding: 32px 24px; width: 90vw; max-width: 360px; color: var(--text-primary); }
.kiosk-dialog-body { display: flex; flex-direction: column; align-items: center; text-align: center; }
.kiosk-dialog-icon { width: 52px; height: 52px; border-radius: 14px; background: var(--bg-input); color: var(--color-green); display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
.kiosk-dialog-title { font-family: 'Manrope', sans-serif; font-size: 19px; font-weight: 800; margin: 0 0 8px; color: var(--text-primary); }
.kiosk-dialog-desc { font-size: 14px; color: var(--text-secondary); margin: 0 0 24px; line-height: 1.5; }
.kiosk-dialog .pos-text-btn { color: var(--text-muted); }
.kiosk-dialog-btn { background: var(--color-green) !important; color: white !important; }

/* Unlock features list */
.kiosk-unlock-features { width: 100%; margin-bottom: 24px; display: flex; flex-direction: column; gap: 8px; }
.kiosk-unlock-feature {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-radius: var(--radius-sm);
  background: var(--bg-input); text-align: left;
  font-family: 'Manrope', sans-serif; font-size: 0.875rem; font-weight: 500;
  color: var(--text-secondary);
}
.kiosk-unlock-feature-icon {
  width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-secondary); color: var(--text-muted);
}

/* Transitions */
.kiosk-fade-enter-active, .kiosk-fade-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.kiosk-fade-enter-from { opacity: 0; transform: translateX(12px); }
.kiosk-fade-leave-to { opacity: 0; transform: translateX(-12px); }

@media (max-height: 680px) {
  .pos-amount-value { font-size: 3rem; }
  .pos-key { height: 48px; font-size: 1.25rem; }
  .pos-add-btn { width: 48px; height: 48px; }
  .pos-primary-btn { height: 48px; }
}
</style>
