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
        <div class="kiosk-logo">
          <img src="/buho_logo.svg" alt="Buho" class="kiosk-logo-img" />
        </div>
        <button :aria-label="$t('Owner settings')" class="kiosk-lock-btn" @click.stop="openUnlock">
          <q-icon name="lock" size="18px" />
        </button>
      </header>

      <div v-if="storageProblem || merchant.storageError" class="pos-notice" role="alert">
        {{ $t('Register data could not be saved. Keep this screen open and try again.') }}<button @click="retryStorage">{{ $t('Try again') }}</button>
      </div>
      <button v-if="parkedLine && state === 'input'" class="pos-parked-line" @click="showParkedSheet = true">
        <q-icon name="schedule" size="18px" />
        <span>{{ parkedLine }}</span>
        <q-icon name="chevron_right" size="18px" />
      </button>
      <!-- ═══ Paid ═══ -->
      <div v-if="state === 'success'" class="pos-state-center">
        <div class="pos-paid-ring"><q-icon name="check" size="36px" /></div>
        <span class="pos-state-title mt-4">{{ $t('Bitcoin received') }}</span>
        <div class="pos-amount-pill mt-2">{{ paymentAmount }}</div>
        <small v-if="paymentShowsFiat" class="pos-state-sub">{{ displaySats(activeOrder.totalSats) }}</small>
        <button class="pos-text-btn" @click="showCurrentReceipt = true">{{ $t('Receipt') }}</button>
        <p v-if="activeOrder?.duplicatePayment" role="alert">
          {{ $t('More than one payment arrived for this sale. Ask the owner to review it.') }}
        </p>
        <button class="pos-primary-btn mt-8" @click.stop="resetToInput">{{ $t('kiosk.newCharge') }}</button>
      </div>

      <!-- ═══ QR ═══ -->
      <div v-else-if="state === 'payment'" class="pos-state-center pos-pay">
        <template v-if="!cardPinActive">
          <p class="pos-qr-label">{{ $t('kiosk.waitingForPayment') }}</p>
          <div class="pos-qr-amount-lg">{{ paymentAmount }}</div>
          <small v-if="paymentShowsFiat" class="pos-state-sub">{{ displaySats(activeOrder.totalSats) }}</small>
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
        <button
          v-if="cardPinActive"
          class="pos-text-btn pos-card-other"
          :disabled="cardPinChecking"
          @click.stop="cancelCardPin"
        >
          {{ $t('Pay another way') }}
        </button>

        <!-- A card in play takes the QR's place: read, confirmed, paying. -->
        <div v-else-if="cardBusy" class="pos-card-stage">
          <CardFace :reading="card.phase.value === 'loading'" :host="card.host.value" />
          <template v-if="card.phase.value === 'review'">
            <button class="pos-primary-btn pos-card-confirm" @click.stop="confirmHeldCard">
              {{ $t('Charge card') }}
            </button>
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
          <p class="pos-qr-hint">{{ $t('Scan with your wallet') }}</p>
          <!-- A card that did not pay: why, in one line, with the QR still
               here so the sale can finish another way. -->
          <div v-if="cardProblem" class="pos-card-problem" role="alert">
            <q-icon name="error_outline" size="18px" />
            <span>
              <b>{{ cardProblem }}</b>
              {{ $t('Scan the code to pay instead.') }}
            </span>
          </div>
          <div v-else-if="nfcReady" class="pos-card-lane">
            <span class="pos-card-wave">
              <svg
                class="pos-contactless"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M7.5 9.2a4.2 4.2 0 0 1 0 5.6" />
                <path d="M11 6.6a8 8 0 0 1 0 10.8" />
                <path d="M14.5 4a11.8 11.8 0 0 1 0 16" />
              </svg>
            </span>
            <span class="pos-card-lane-text">
              <b>{{ $t('Hold a Bitcoin Card here') }}</b>
              <span>{{ $t('Against the back of this phone') }}</span>
            </span>
          </div>
        </template>

        <template v-if="paymentProblem">
          <p role="status">{{ paymentProblem }}</p>
          <button class="pos-text-btn" @click="payments.reconnect()">{{ $t('Check payment again') }}</button>
        </template>
        <p v-else-if="!cardBusy && !cardPinActive" class="pos-auto-hint">
          {{ $t('This screen updates when the payment arrives.') }}
        </p>
        <div v-if="!cardBusy && !cardPinActive" class="pos-payment-actions">
          <button class="pos-outline-btn" @click.stop="resetToInput">{{ $t('Next customer') }}</button>
        </div>
      </div>

      <div v-else-if="state === 'loading'" class="pos-state-center" role="status">
        <q-spinner size="28px" />
        <span class="pos-state-sub">{{ $t('Opening your register…') }}</span>
      </div>

      <!-- ═══ Processing ═══ -->
      <div v-else-if="state === 'processing'" class="pos-state-center" role="status">
        <div class="pos-processing-wrap">
          <div class="pos-processing-ring pos-ring-1"></div>
          <div class="pos-processing-ring pos-ring-2"></div>
          <div class="pos-processing-core"><q-icon name="receipt_long" size="26px" /></div>
        </div>
        <span class="pos-state-title mt-6">{{ $t('kiosk.creatingInvoice') }}</span>
      </div>

      <!-- What stopped the payment, and the one safe way on. -->
      <div v-else-if="state === 'interrupted'" class="pos-state-center" role="status">
        <q-icon :name="interruption.icon" size="36px" />
        <h1 class="pos-state-title">{{ interruption.title }}</h1>
        <p class="pos-state-sub">{{ interruption.text }}</p>
        <button v-if="interruption.retry" class="pos-primary-btn" @click="retryCharge">{{ interruption.retry }}</button>
        <button v-if="interruption.check" class="pos-primary-btn" @click="payments.reconnect()">
          {{ $t('Check payment again') }}
        </button>
        <button class="pos-text-btn" @click="resetToInput">{{ $t('Next customer') }}</button>
      </div>

      <!-- ═══ Tipping ═══ -->
      <div v-else-if="state === 'tipping'" class="tip-screen" :class="{ 'tip-ready': tipInteractive }">
        <div class="tip-header">
          <span class="tip-prompt">{{ extrasTitle }}</span>
          <div class="tip-subtotal-pill">
            <span class="tip-subtotal-label">{{ $t('kiosk.subtotal') }}</span>
            <span class="tip-subtotal-val">{{ displaySats(baseAmountSats) }}</span>
          </div>
        </div>
        <div class="tip-body">
          <div v-if="offersTip" class="tip-options">
            <button
              v-for="tip in tipOptions"
              :key="tip.percent"
              class="tip-opt"
              :class="{ 'tip-opt-on': selectedTipPercent === tip.percent }"
              :disabled="!tipInteractive"
              @click.stop="
                selectedTipPercent = tip.percent;
                useRoundUp = false;
              "
            >
              <span class="tip-opt-pct">{{ tip.percent }}%</span>
              <span class="tip-opt-amt">+{{ displaySats(tip.amount) }}</span>
            </button>
          </div>
          <button
            v-if="offersRoundUp"
            class="tip-roundup"
            :class="{ 'tip-roundup-on': useRoundUp }"
            :disabled="!tipInteractive"
            @click.stop="
              useRoundUp = !useRoundUp;
              selectedTipPercent = 0;
            "
          >
            <div class="tip-roundup-icon"><q-icon name="keyboard_double_arrow_up" size="16px" /></div>
            <span class="tip-roundup-label">{{ $t('kiosk.roundUpTo', { amount: displaySats(roundUpValue) }) }}</span>
            <span class="tip-roundup-val">+{{ displaySats(roundUpValue - totalBeforeRoundUp) }}</span>
          </button>
          <button
            class="tip-skip"
            :disabled="!tipInteractive"
            @click.stop="
              selectedTipPercent = 0;
              useRoundUp = false;
              confirmTip();
            "
          >
            {{ extrasSkipLabel }}
          </button>
        </div>
        <div class="tip-footer">
          <div class="tip-breakdown">
            <div class="tip-break-row">
              <span>{{ $t('kiosk.subtotal') }}</span>
              <span>{{ displaySats(baseAmountSats) }}</span>
            </div>
            <div v-if="selectedTipAmount > 0 || useRoundUp" class="tip-break-row tip-break-tip">
              <span>{{ extraLabel }}</span>
              <span class="tip-break-val">+{{ displaySats(finalAmountSats - baseAmountSats) }}</span>
            </div>
            <div class="tip-break-divider"></div>
            <div class="tip-break-row tip-break-total">
              <span>{{ $t('kiosk.total') }}</span>
              <span>{{ displaySats(invoiceData?.amountSats ?? finalAmountSats) }}</span>
            </div>
          </div>
          <button class="pos-primary-btn" :disabled="!tipInteractive" @click.stop="confirmTip">
            <span>{{ $t('Confirm') }}</span>
            <q-icon name="arrow_forward" size="18px" />
          </button>
          <button class="pos-secondary-btn" @click.stop="leaveTip">{{ $t('Back') }}</button>
        </div>
      </div>

      <template v-else>
        <!-- Search takes the switch's place while it is open, as a search
             field does in a navigation bar. -->
        <form
          v-if="entryMode === 'products' && productSearchOpen"
          class="pos-entry-controls pos-product-search"
          role="search"
          @submit.prevent="closeSearchKeyboard"
        >
          <input
            ref="productSearchInput"
            v-model="productSearch"
            :placeholder="$t('Search products')"
            :aria-label="$t('Search products')"
            type="search"
            enterkeyhint="search"
          />
          <button type="button" @click="closeProductSearch">{{ $t('Cancel') }}</button>
        </form>
        <div v-else class="pos-entry-controls">
          <div class="pos-entry-switch" role="group" :aria-label="$t('Sale entry')">
            <button
              :aria-pressed="entryMode === 'amount'"
              :class="{ active: entryMode === 'amount' }"
              @click="setEntryMode('amount')"
            >
              {{ $t('Amount') }}
            </button>
            <button
              :aria-pressed="entryMode === 'products'"
              :class="{ active: entryMode === 'products' }"
              @click="setEntryMode('products')"
            >
              {{ $t('Products') }}
            </button>
          </div>
          <button
            v-if="entryMode === 'products'"
            class="pos-icon-btn"
            :aria-label="$t('Search products')"
            @click="openProductSearch"
          >
            <q-icon name="search" size="22px" />
          </button>
        </div>
        <button v-if="draft.items.length" class="pos-cart-summary" @click="showCartSheet = true">
          <span>
            {{ itemCount }} {{ itemCount === 1 ? $t('kiosk.item') : $t('kiosk.items') }} · {{ basketDisplay }}
          </span>
          <q-icon name="chevron_right" size="18px" />
        </button>
        <div v-if="card.phase.value === 'ready'" class="pos-card-held" role="status">
          {{ $t('Card held · enter the amount') }}
        </div>
        <div v-if="priceMissing" class="pos-card-held pos-price-wait" role="status">
          {{ $t('Waiting for the Bitcoin price to charge in {currency}', { currency: fiatCurrency }) }}
        </div>
        <div v-if="!walletReady" class="pos-connection" role="status">
          <span>
            {{
              connectionChecking ? $t('Connecting your receiving wallet…') : $t('Your receiving wallet is unavailable.')
            }}
          </span>
          <button :disabled="connectionChecking" @click="connectWallet">{{ $t('Try again') }}</button>
        </div>
        <AmountKeypad
          v-if="entryMode === 'amount'"
          presentation="kiosk"
          :model-value="draft.amountRaw"
          :fiat="isFiatMode"
          :fiat-code="fiatCurrency"
          :fiat-rate="fiatRate"
          :exact-sats="draft.exactSats"
          :bip177="store.useBip177Format !== false"
          :locale="$i18n.locale"
          :disabled="busy"
          @update:model-value="editAmount"
          @swap-unit="swapAmount"
          @swap-unavailable="explainMissingRate"
        >
          <template #actions>
            <div class="pos-actions">
              <button
                class="pos-add-btn"
                :disabled="amountSats <= 0 || priceMissing || busy"
                :aria-label="$t('Add amount to basket')"
                @click="addToAccumulated"
              >
                <q-icon name="add" size="22px" />
              </button>
              <button
                class="pos-primary-btn pos-charge-btn"
                :class="{ 'pos-btn-disabled': !canCharge }"
                :disabled="!canCharge"
                @click="proceedToTipOrCharge"
              >
                <q-icon name="receipt_long" size="20px" />
                <span>{{ chargeLabel }}</span>
              </button>
            </div>
          </template>
        </AmountKeypad>
        <template v-else>
          <KioskProducts
            ref="productList"
            :products="merchant.products"
            :categories="merchant.categories"
            :quantities="quantities"
            :format-price="productPrice"
            :search="productSearch"
            :category="productCategory"
            :disabled="busy"
            :empty-action-label="$t('Enter an amount')"
            @add="addProduct"
            @update:category="productCategory = $event"
            @clear-filters="
              productSearch = '';
              productCategory = '';
            "
            @manage="setEntryMode('amount')"
          />
          <div class="pos-products-actions">
            <button
              class="pos-primary-btn"
              :class="{ 'pos-btn-disabled': !canCharge }"
              :disabled="!canCharge"
              @click="proceedToTipOrCharge"
            >
              <q-icon name="receipt_long" size="20px" />{{ chargeLabel }}
            </button>
          </div>
        </template>
      </template>

      <q-dialog v-model="showCartSheet" position="bottom">
        <q-card class="pos-cart-sheet pos-basket-sheet">
          <div class="pos-sheet-header">
            <strong>{{ $t('Basket') }}</strong>
            <button class="pos-icon-btn" :aria-label="$t('Close')" @click="showCartSheet = false">
              <q-icon name="close" size="22px" />
            </button>
          </div>
          <div class="pos-basket-items">
            <div v-for="item in draft.items" :key="item.id" class="pos-basket-row">
              <span class="pos-basket-name">
                {{ item.name }}<small v-if="item.qty > 1">{{ $t('{price} each', { price: unitPrice(item) }) }}</small>
              </span>
              <div class="pos-quantity">
                <button :aria-label="$t('Remove one {name}', { name: item.name })" @click="changeQuantity(item, -1)">
                  <q-icon name="remove" />
                </button>
                <span>{{ item.qty }}</span>
                <button :aria-label="$t('Add one {name}', { name: item.name })" @click="changeQuantity(item, 1)">
                  <q-icon name="add" />
                </button>
              </div>
              <span class="pos-basket-line">{{ itemPrice(item) }}</span>
            </div>
            <!-- A typed amount not yet added is charged too, so it is listed. -->
            <div v-if="typedAmountLine" class="pos-basket-row">
              <span class="pos-basket-name">{{ $t('Amount') }}</span>
              <span class="pos-basket-line">{{ typedAmountLine }}</span>
            </div>
          </div>
          <div class="pos-sheet-total">
            <!-- A tip or round-up is asked after Charge, so then this is the subtotal. -->
            <span>{{ offersTip || offersRoundUp ? $t('kiosk.subtotal') : $t('kiosk.total') }}</span>
            <strong>{{ chargeTotalLabel }}</strong>
          </div>
          <button
            class="pos-primary-btn"
            :class="{ 'pos-btn-disabled': !canCharge }"
            :disabled="!canCharge"
            @click="chargeFromBasket"
          >
            {{ chargeLabel }}
          </button>
          <div class="pos-basket-options">
            <button class="pos-text-btn" :disabled="!hasDraft" @click="saveBasket">{{ $t('Save for later') }}</button>
            <button class="pos-text-btn pos-cancel-btn" :disabled="!hasDraft" @click="clearAll">
              {{ $t('Clear basket') }}
            </button>
          </div>
        </q-card>
      </q-dialog>
      <!-- Saved baskets and waiting payments: everything set aside, in one place. -->
      <q-dialog v-model="showParkedSheet" position="bottom">
        <q-card class="pos-cart-sheet pos-basket-sheet">
          <div class="pos-sheet-header">
            <strong>{{ parkedTitle }}</strong>
            <button class="pos-icon-btn" :aria-label="$t('Close')" @click="showParkedSheet = false">
              <q-icon name="close" />
            </button>
          </div>
          <div class="pos-basket-items">
            <template v-if="merchant.savedBaskets.length">
              <h2 v-if="pendingOrders.length" class="pos-sheet-section">{{ $t('Saved baskets') }}</h2>
              <button
                v-for="basket in merchant.savedBaskets"
                :key="basket.id"
                class="pos-saved-row"
                :disabled="basketHasItems"
                @click="resumeBasket(basket.id)"
              >
                <span>
                  {{ basket.name }}<small>{{ count(basketItemCount(basket), '1 item', '{n} items') }}</small>
                </span>
                <q-icon name="chevron_right" />
              </button>
            </template>
            <template v-if="pendingOrders.length">
              <h2 v-if="merchant.savedBaskets.length" class="pos-sheet-section">{{ $t('Waiting payments') }}</h2>
              <p v-if="pendingOrders.some(order => order.status === 'expired')" class="pos-sheet-note">
                {{ $t('An expired code is still checked for {minutes} minutes.', { minutes: lateMinutes }) }}
              </p>
              <button
                v-for="order in pendingOrders"
                :key="order.id"
                class="pos-saved-row"
                :disabled="basketHasItems"
                @click="resumeOrder(order.id)"
              >
                <span>
                  {{ saleTitle(order) }}<small>
                    {{ orderAmount(order) }} · {{ $t(order.status === 'expired' ? 'Expired' : 'Waiting') }}
                  </small>
                </span>
                <q-icon name="chevron_right" />
              </button>
            </template>
            <p v-if="basketHasItems">{{ $t('Save or clear this basket before opening another.') }}</p>
          </div>
        </q-card>
      </q-dialog>

      <q-dialog v-model="showCurrentReceipt" position="bottom">
        <q-card v-if="activeOrder?.status === 'paid'" class="pos-cart-sheet pos-basket-sheet pos-current-receipt">
          <div class="pos-sheet-header">
            <strong>{{ $t('Receipt') }}</strong>
            <button class="pos-icon-btn" :aria-label="$t('Close')" @click="showCurrentReceipt = false">
              <q-icon name="close" />
            </button>
          </div>
          <KioskReceipt :sale="activeOrder" :format-currency="money" :format-sats="displaySats" />
          <div class="pos-receipt-actions">
            <button class="pos-secondary-btn" @click="shareCurrentReceipt">{{ $t('Share receipt') }}</button>
            <button v-if="canPrintReceipt" class="pos-secondary-btn" @click="printCurrentReceipt">
              {{ $t('Print receipt') }}
            </button>
          </div>
        </q-card>
      </q-dialog>
      <!-- ═══ Unlock ═══
           The lock goes straight to the PIN, as Guided Access does: the right
           PIN ends the register (owner area), Resume goes back to it. -->
      <q-dialog v-model="showUnlockDialog" persistent @hide="resetUnlock">
        <div class="kiosk-dialog">
          <div class="kiosk-dialog-body">
            <KioskPinPad
              ref="unlockPinRef"
              :title="$t('kiosk.enterPin')"
              :subtitle="$t('Only the owner can leave the register.')"
              :error-message="unlockError"
              @complete="handleUnlockPin"
            />
            <button class="pos-text-btn" @click="recoverOwner">{{ $t('Forgot PIN?') }}</button>
            <button class="pos-text-btn" @click="showUnlockDialog = false">{{ $t('Resume') }}</button>
          </div>
        </div>
      </q-dialog>
    </div>
  </q-page>
</template>

<script>
import { defineComponent, ref, computed, onMounted, onUnmounted, getCurrentInstance, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar, copyToClipboard } from 'quasar'
import { useWalletStore } from '../stores/wallet.js'
import { useKioskMerchantStore } from '../stores/kioskMerchant.js'
import { useKioskPayments } from '../composables/useKioskPayments.js'
import { roundUpTargetSats } from '../utils/roundUp.js'
import {
  cloneKiosk,
  buildSaleSnapshot,
  priceBasket,
  newKioskId,
  kioskDraftHasValue,
  formatKioskMoney,
  kioskCountLabel,
  kioskReceiptText,
  kioskSaleTitle,
  KIOSK_LATE_PAYMENT_GRACE_MS
} from '../utils/kioskMerchant.js'
import { keypadSats } from '../utils/amountKeypad.js'
import { freshRate } from '../utils/fiatCurrencies.js'
import { formatAmount } from '../utils/amountFormatting.js'
import { kioskWalletBlocker } from '../utils/walletCapabilities.js'
import KioskPinPad from '../components/KioskPinPad.vue'
import AmountKeypad from '../components/AmountKeypad.vue'
import KioskProducts from '../components/kiosk/KioskProducts.vue'
import KioskReceipt from '../components/kiosk/KioskReceipt.vue'
import { shareContent } from '../utils/share.js'
import QRCode from 'qrcode'
import WithdrawAuthorization from '../components/WithdrawAuthorization.vue'
import CardFace from '../components/CardFace.vue'
import { CARD_NOT_PAID, useKioskCardPayment } from '../composables/useKioskCardPayment.js'
import { isNfcAvailable } from '../utils/nfc.js'
import { haptics } from '../utils/haptics.js'
import { safeWithdrawError } from '../services/lnurlWithdraw.js'

export default defineComponent({
  name: 'KioskDashboard',
  components: { KioskPinPad, AmountKeypad, KioskProducts, KioskReceipt, WithdrawAuthorization, CardFace },
  setup() {
    const router = useRouter(),
      store = useWalletStore(),
      merchant = useKioskMerchantStore(),
      $q = useQuasar()
    const { proxy } = getCurrentInstance()
    const t = (key, values) => proxy.$t(key, values)
    const payments = useKioskPayments({ merchant, walletStore: store })
    const { activeOrder, activeInvoice: invoiceData, pendingOrders } = payments
    const initialized = ref(false),
      busy = ref(false),
      walletReady = ref(false),
      storageProblem = ref(false),
      connectionChecking = ref(false)
    const draft = ref(cloneKiosk(merchant.draft)),
      entryMode = computed(() => merchant.entryMode)
    let draftSave = Promise.resolve(),
      draftRevision = 0,
      swappingRaw = null
    const localStage = ref('input'),
      now = ref(Date.now()),
      qrDataUrl = ref('')
    const productSearchOpen = ref(false),
      productSearch = ref(''),
      productCategory = ref(''),
      productSearchInput = ref(null),
      productList = ref(null)
    let browsing = null
    const showCurrentReceipt = ref(false)
    const showCartSheet = ref(false),
      showParkedSheet = ref(false)
    const showUnlockDialog = ref(false),
      unlockPinRef = ref(null),
      unlockError = ref('')
    const cardAuthorization = ref(null),
      cardPinActive = ref(false),
      cardPinChecking = ref(false),
      cardProblem = ref(''),
      nfcReady = ref(false)
    const selectedTipPercent = ref(0),
      useRoundUp = ref(false),
      baseAmountSats = ref(0),
      tipInteractive = ref(true)
    const quotedItems = ref([]),
      quotedRate = ref(0)
    const fiatCurrency = computed(
      () => merchant.catalogCurrency || (store.preferredFiatCurrency || 'USD').toUpperCase()
    )
    const isFiatMode = computed(() => draft.value.amountUnit === 'fiat')
    const fiatRate = computed(() =>
      freshRate(store.exchangeRates, store.exchangeRateTimes, fiatCurrency.value, now.value)
    )
    const hasDraft = computed(() => kioskDraftHasValue(draft.value))
    const basketHasItems = computed(() => !!draft.value.items.length)
    const amountSats = computed(
      () => draft.value.exactSats ?? keypadSats(draft.value.amountRaw, { fiat: isFiatMode.value, rate: fiatRate.value })
    )
    const priceMissing = computed(
      () =>
        !(fiatRate.value > 0) &&
        (draft.value.items.some(item => item.unit === 'fiat') ||
          (isFiatMode.value && Number(draft.value.amountRaw) > 0 && draft.value.exactSats == null))
    )
    const basketQuote = computed(() => {
      try {
        return priceBasket(draft.value.items, { currency: fiatCurrency.value, rate: fiatRate.value })
      } catch {
        return null
      }
    })
    const chargeItems = computed(() => {
      const item = amountItem()
      return [...draft.value.items, ...(item ? [item] : [])]
    })
    const chargeQuote = computed(() => {
      try {
        return priceBasket(chargeItems.value, { currency: fiatCurrency.value, rate: fiatRate.value })
      } catch {
        return null
      }
    })
    const totalSatsForCharge = computed(() => chargeQuote.value?.baseSats || 0)
    const itemCount = computed(() => draft.value.items.reduce((sum, item) => sum + item.qty, 0))
    const quantities = computed(() =>
      Object.fromEntries(
        merchant.products.map(product => [
          product.id,
          draft.value.items.filter(item => item.productId === product.id).reduce((sum, item) => sum + item.qty, 0)
        ])
      )
    )
    const canCharge = computed(
      () =>
        initialized.value &&
        !busy.value &&
        !storageProblem.value &&
        !merchant.storageError &&
        walletReady.value &&
        !priceMissing.value &&
        totalSatsForCharge.value > 0
    )
    const quotedLabel = quote =>
      quote?.subtotalMinor > 0 && (isFiatMode.value || entryMode.value === 'products')
        ? formatKioskMoney(quote.subtotalMinor, quote.currency, proxy.$i18n.locale)
        : displaySats(quote?.baseSats || 0)
    const chargeLabel = computed(() =>
      !walletReady.value
        ? t('kiosk.connecting')
        : totalSatsForCharge.value > 0
          ? `${t('kiosk.charge')} ${quotedLabel(chargeQuote.value)}`
          : t('kiosk.enterAmount')
    )
    const paymentShowsFiat = computed(
      () => activeOrder.value?.totalMinor > 0 && activeOrder.value.items.some(item => item.unit === 'fiat')
    )
    const paymentAmount = computed(() =>
      paymentShowsFiat.value
        ? formatKioskMoney(activeOrder.value.totalMinor, activeOrder.value.currency, proxy.$i18n.locale)
        : displaySats(invoiceData.value?.amountSats || finalAmountSats.value)
    )
    const kioskWalletName = computed(() => store.kioskWallet?.name || t('Register'))
    const state = computed(() => {
      if (!initialized.value) return 'loading'
      if (activeOrder.value)
        return { paid: 'success', waiting: 'payment', preparing: 'processing' }[payments.status.value] || 'interrupted'
      return localStage.value
    })
    const paymentProblem = computed(() => {
      const code = payments.problem.value?.code
      if (code === 'KIOSK_STORAGE_FAILED')
        return t('Register data could not be saved. Keep this screen open and try again.')
      if (code === 'KIOSK_WALLET_UNAVAILABLE') return t('Ask the owner to check the receiving wallet.')
      if (code) return t('No payment confirmed yet. Check your connection and try again.')
      return ''
    })
    // A payment that stopped: what happened, and the one safe way on.
    const interruption = computed(() => {
      const status = payments.status.value
      const expired = { icon: 'schedule', title: t('Payment request expired') }
      if (status === 'not-charged')
        return {
          icon: 'info_outline',
          title: t('Nothing was charged'),
          text: t('The payment request could not be created.'),
          retry: t('Try again')
        }
      if (status === 'unpaid')
        return { ...expired, text: t('No payment arrived for this code.'), retry: t('Create a new payment request') }
      if (status === 'expired' && !paymentProblem.value)
        return {
          ...expired,
          text: t('This code has expired. We still check it for late payments.'),
          retry: t('Create a new payment request')
        }
      if (status === 'expired') return { ...expired, text: paymentProblem.value, check: true }
      return {
        icon: 'help_outline',
        title: t('Payment not confirmed'),
        text:
          paymentProblem.value || t('We are checking the original payment. Do not ask the customer to pay again yet.'),
        check: true
      }
    })
    const cardSale = computed(() => (state.value === 'payment' && !paymentProblem.value ? invoiceData.value : null))
    const card = useKioskCardPayment({
      sale: cardSale,
      authorize: (...args) => cardAuthorization.value.submit(...args),
      checkPayment: () => payments.checkNow(),
      onError(error) {
        if (cardTry) cardTry.failed = true
        cardProblem.value = cardProblemText(error)
        void haptics.error()
      }
    })
    // How a sale was paid, as far as the register saw it: a card went to the
    // request that settled and no card error followed (Bitcoin Card), no card
    // went to it (QR code), or a card failed on it (unknown, no method).
    let cardTry = null
    watch(
      () => card.phase.value,
      phase => {
        if (phase === 'submitting') cardTry = { hash: invoiceData.value?.paymentHash || null, failed: false }
      }
    )
    const cardBusy = computed(() => ['loading', 'review', 'submitting', 'waiting'].includes(card.phase.value))
    function cardProblemText(error) {
      if (error?.code === 'CARD_BLOCKED') return t('Card locked after too many wrong PINs.')
      if (error?.code === CARD_NOT_PAID) return t('No payment came from the card.')
      if (/payment limits/i.test(error?.message || '')) return t("This card can't pay this amount.")
      return t(safeWithdrawError(String(error?.message || '')))
    }
    function confirmHeldCard() {
      if (invoiceData.value) void card.confirm({ amountSats: invoiceData.value.amountSats })
    }
    function cancelCardPin() {
      if (!cardPinChecking.value) cardAuthorization.value?.cancel()
    }
    function showError(error) {
      if (error?.code === 'KIOSK_STORAGE_FAILED') storageProblem.value = true
      $q.notify({
        type: 'negative',
        message:
          error?.code === 'KIOSK_STORAGE_FAILED'
            ? t('Register data could not be saved. Keep this screen open and try again.')
            : t('This action could not be completed. Try again.'),
        timeout: 5000
      })
    }
    function saveDraft(next) {
      draft.value = next
      const revision = ++draftRevision
      draftSave = merchant
        .saveDraft(cloneKiosk(next))
        .then(() => {
          if (revision === draftRevision) storageProblem.value = false
          return true
        })
        .catch(error => {
          showError(error)
          return false
        })
      return draftSave
    }
    function syncDraft() {
      draft.value = cloneKiosk(merchant.draft)
      swappingRaw = null
    }
    function editAmount(value) {
      if (swappingRaw === value) {
        swappingRaw = null
        return
      }
      void saveDraft({ ...draft.value, amountRaw: value, exactSats: null })
    }
    function swapAmount(value) {
      swappingRaw = value.value
      void saveDraft({
        ...draft.value,
        amountRaw: value.value,
        amountUnit: value.fiat ? 'fiat' : 'sats',
        exactSats: value.sats
      })
      void Promise.resolve(store.setKioskDisplayCurrency(value.fiat ? 'fiat' : 'sats')).catch(showError)
    }
    function explainMissingRate() {
      $q.notify({
        message: t('A recent Bitcoin price is needed to switch this amount. Your amount is kept.'),
        timeout: 4000
      })
    }
    function amountItem() {
      if (!(amountSats.value > 0) && !(isFiatMode.value && Number(draft.value.amountRaw) > 0)) return null
      // Entered sats retain their exact identity even when displayed as fiat.
      return draft.value.exactSats != null || !isFiatMode.value
        ? {
            id: newKioskId('item'),
            name: t('Amount'),
            qty: 1,
            unit: 'sats',
            unitSats: amountSats.value,
            currency: fiatCurrency.value
          }
        : {
            id: newKioskId('item'),
            name: t('Amount'),
            qty: 1,
            unit: 'fiat',
            priceMinor: Math.round(Number(draft.value.amountRaw) * 100),
            currency: fiatCurrency.value
          }
    }
    function addToAccumulated() {
      const item = amountItem()
      if (!item || priceMissing.value) return
      void saveDraft({ ...draft.value, items: [...draft.value.items, item], amountRaw: '', exactSats: null })
    }
    function addProduct(product) {
      const items = cloneKiosk(draft.value.items)
      const old = items.find(
        item => item.productId === product.id && item.priceMinor === product.priceMinor && item.name === product.name
      )
      if (old) old.qty++
      else items.push({ ...product, id: newKioskId('item'), productId: product.id, unit: 'fiat', qty: 1 })
      void saveDraft({ ...draft.value, items })
    }
    function changeQuantity(item, delta) {
      void saveDraft({
        ...draft.value,
        items: draft.value.items
          .filter(value => value.id !== item.id || item.qty + delta > 0)
          .map(value => (value.id === item.id ? { ...value, qty: value.qty + delta } : value))
      })
    }
    function leaveTip() {
      localStage.value = 'input'
    }
    async function chargeFromBasket() {
      showCartSheet.value = false
      await proceedToTipOrCharge()
    }
    function basketItemCount(basket) {
      return basket.draft.items.reduce((sum, item) => sum + item.qty, 0) || (kioskDraftHasValue(basket.draft) ? 1 : 0)
    }
    function saleTitle(order) {
      return kioskSaleTitle(order, t)
    }
    function orderAmount(order) {
      return order.totalMinor != null && order.items.some(item => item.unit === 'fiat')
        ? formatKioskMoney(order.totalMinor, order.currency, proxy.$i18n.locale)
        : displaySats(order.totalSats)
    }
    // Saved baskets and waiting payments, one line for both.
    const parkedLine = computed(() =>
      [
        merchant.savedBaskets.length && count(merchant.savedBaskets.length, '1 saved basket', '{n} saved baskets'),
        pendingOrders.value.length && count(pendingOrders.value.length, '1 waiting payment', '{n} waiting payments')
      ]
        .filter(Boolean)
        .join(' · ')
    )
    const parkedTitle = computed(() =>
      merchant.savedBaskets.length && pendingOrders.value.length
        ? t('Saved and waiting')
        : t(merchant.savedBaskets.length ? 'Saved baskets' : 'Waiting payments')
    )
    function clearAll() {
      $q.dialog({
        title: t('Clear basket?'),
        message: t('This removes the items and entered amount from this basket.'),
        cancel: true,
        ok: { label: t('Clear basket'), color: 'negative' }
      }).onOk(async () => {
        try {
          await draftSave
          await merchant.clearDraft()
          syncDraft()
          showCartSheet.value = false
        } catch (error) {
          showError(error)
        }
      })
    }
    async function saveBasket() {
      try {
        if (!(await draftSave)) return
        await merchant.saveBasket(`${t('Basket')} ${merchant.savedBaskets.length + 1}`)
        syncDraft()
        showCartSheet.value = false
      } catch (error) {
        showError(error)
      }
    }
    /** A typed amount alone is not a basket: opening a saved one replaces it, as a new number replaces one on a calculator. */
    async function dropTypedAmount() {
      if (!(await draftSave) || basketHasItems.value) return false
      if (hasDraft.value) {
        await merchant.clearDraft()
        syncDraft()
      }
      return true
    }
    async function resumeBasket(id) {
      try {
        if (!(await dropTypedAmount())) return
        await merchant.resumeBasket(id)
        syncDraft()
        showParkedSheet.value = false
      } catch (error) {
        showError(error)
      }
    }
    async function resumeOrder(id) {
      try {
        if (!(await dropTypedAmount())) return
        await payments.resume(id)
        showParkedSheet.value = false
      } catch (error) {
        showError(error)
      }
    }
    async function setEntryMode(mode) {
      try {
        if (mode === 'products' && entryMode.value !== 'products') {
          const item = amountItem()
          // A typed amount becomes a visible basket row when the keypad leaves.
          if (
            item &&
            !(await saveDraft({ ...draft.value, items: [...draft.value.items, item], amountRaw: '', exactSats: null }))
          )
            return
        }
        await merchant.setEntryMode(mode)
      } catch (error) {
        showError(error)
      }
    }
    function productPrice(product) {
      return formatKioskMoney(product.priceMinor, product.currency, proxy.$i18n.locale)
    }
    function unitPrice(item) {
      return item.unit === 'sats'
        ? displaySats(item.unitSats)
        : formatKioskMoney(item.priceMinor, item.currency, proxy.$i18n.locale)
    }
    function itemPrice(item) {
      return item.unit === 'sats'
        ? displaySats(item.unitSats * item.qty)
        : formatKioskMoney(item.priceMinor * item.qty, item.currency, proxy.$i18n.locale)
    }
    const basketDisplay = computed(() =>
      basketQuote.value
        ? quotedLabel(basketQuote.value)
        : draft.value.items.every(item => item.unit === 'fiat')
          ? formatKioskMoney(
              draft.value.items.reduce((sum, item) => sum + item.priceMinor * item.qty, 0),
              fiatCurrency.value,
              proxy.$i18n.locale
            )
          : t('Price unavailable')
    )
    const typedAmountLine = computed(() => {
      const item = amountItem()
      if (!item) return ''
      return item.unit === 'sats'
        ? displaySats(item.unitSats)
        : formatKioskMoney(item.priceMinor, item.currency, proxy.$i18n.locale)
    })
    // What Charge takes: the basket and a typed amount not yet added.
    const chargeTotalLabel = computed(() =>
      chargeQuote.value ? quotedLabel(chargeQuote.value) : basketDisplay.value
    )
    function displaySats(sats) {
      return formatAmount(sats || 0, store.useBip177Format !== false)
    }
    const tipOptions = computed(() =>
      store.kioskTipValues.map(percent => ({ percent, amount: Math.round((baseAmountSats.value * percent) / 100) }))
    )
    const selectedTipAmount = computed(() => Math.round((baseAmountSats.value * selectedTipPercent.value) / 100))
    const totalBeforeRoundUp = computed(() => baseAmountSats.value + selectedTipAmount.value)
    const roundUpValue = computed(() =>
      roundUpTargetSats({ amountSats: totalBeforeRoundUp.value, isFiat: isFiatMode.value, rate: quotedRate.value })
    )
    const finalAmountSats = computed(() =>
      useRoundUp.value && roundUpValue.value ? roundUpValue.value : totalBeforeRoundUp.value
    )
    const offersTip = computed(() => store.kioskTipEnabled && tipOptions.value.length > 0)
    const offersRoundUp = computed(() => store.kioskRoundUpEnabled && !!roundUpValue.value)
    const extrasTitle = computed(() => t(offersTip.value ? 'kiosk.addTip' : 'kiosk.roundUpPrompt'))
    const extrasSkipLabel = computed(() => t(offersTip.value ? 'kiosk.noTip' : 'kiosk.exactAmount'))
    const extraLabel = computed(() =>
      t(useRoundUp.value && !selectedTipPercent.value ? 'kiosk.roundUp' : 'kiosk.tipLabel')
    )
    async function proceedToTipOrCharge() {
      if (!canCharge.value) return
      busy.value = true
      try {
        if (!(await draftSave)) return
        quotedItems.value = cloneKiosk(chargeItems.value)
        quotedRate.value = fiatRate.value
        baseAmountSats.value = priceBasket(quotedItems.value, {
          currency: fiatCurrency.value,
          rate: quotedRate.value
        }).baseSats
        selectedTipPercent.value = 0
        useRoundUp.value = false
        if (offersTip.value || offersRoundUp.value) localStage.value = 'tipping'
        else await createCharge()
      } catch (error) {
        showError(error)
      } finally {
        busy.value = false
      }
    }
    async function createCharge() {
      tipInteractive.value = false
      try {
        const snapshot = buildSaleSnapshot({
          items: quotedItems.value,
          currency: fiatCurrency.value,
          rate: quotedRate.value,
          walletId: store.kioskWalletId,
          walletName: kioskWalletName.value,
          tipSats: selectedTipAmount.value,
          roundUpSats: finalAmountSats.value - totalBeforeRoundUp.value,
          tipPercent: selectedTipPercent.value || null
        })
        await payments.createCharge(snapshot)
        localStage.value = 'input'
        if (!activeOrder.value && payments.problem.value) $q.notify({ type: 'negative', message: paymentProblem.value })
      } catch (error) {
        showError(error)
      } finally {
        tipInteractive.value = true
      }
    }
    const confirmTip = () => createCharge()
    // A new request for the same sale. Only an expired code that is still
    // checked may yet be paid, so only that one asks first.
    function retryCharge() {
      const order = activeOrder.value
      if (!order) return
      const again = () => payments.createCharge(cloneKiosk(order))
      // A code that was shown may still be paid: a check can be out of date.
      if (['expired', 'unpaid'].includes(payments.status.value))
        $q.dialog({
          title: t('Create a new payment request?'),
          message: t('The old code may still be paid. Check with the customer before continuing.'),
          cancel: true,
          ok: { label: t('Create request') }
        }).onOk(again)
      else if (payments.status.value === 'not-charged') void again()
    }
    async function resetToInput() {
      try {
        await draftSave
        await payments.nextCustomer()
        syncDraft()
        localStage.value = 'input'
        card.reset()
        cardTry = null
        cardProblem.value = ''
        useRoundUp.value = false
        selectedTipPercent.value = 0
      } catch (error) {
        showError(error)
      }
    }
    async function retryStorage() {
      try {
        if (merchant.storageError === 'KIOSK_STORAGE_CONFLICT') {
          const local = cloneKiosk(draft.value)
          await merchant.reload()
          if (kioskDraftHasValue(local) && JSON.stringify(local) !== JSON.stringify(merchant.draft))
            await merchant.saveRecoveredBasket(local, t('Recovered basket'))
          syncDraft()
          storageProblem.value = false
        } else if (!(await saveDraft(cloneKiosk(draft.value)))) return
        await payments.checkNow()
      } catch (error) {
        showError(error)
      }
    }
    // After a few wrong PINs the next try waits; the pad says how long.
    function pinWait() {
      const ms = store.kioskPinRetryIn()
      if (!ms) return ''
      return count(
        Math.ceil(ms / 60000),
        'Too many tries. Try again in 1 minute.',
        'Too many tries. Try again in {n} minutes.'
      )
    }
    function openUnlock() {
      showUnlockDialog.value = true
      unlockError.value = pinWait()
    }
    async function handleUnlockPin(pin) {
      if (store.unlockToOwnerMode(pin)) {
        showUnlockDialog.value = false
        await router.push('/kiosk-mode')
      } else {
        unlockError.value = pinWait() || t('kiosk.incorrectPin')
        unlockPinRef.value?.fail()
      }
    }
    function resetUnlock() {
      unlockError.value = ''
      unlockPinRef.value?.reset()
    }
    async function recoverOwner() {
      try {
        if (await store.recoverKioskOwnerAccess()) {
          showUnlockDialog.value = false
          await router.push('/kiosk-mode')
        } else
          unlockError.value = t(
            'Owner verification is unavailable here. Use the register PIN or verify on your device.'
          )
      } catch {
        unlockError.value = t('Owner verification was not completed.')
      }
    }
    async function openProductSearch() {
      browsing = { category: productCategory.value, scroll: productList.value?.getScrollPosition() || 0 }
      productSearchOpen.value = true
      await nextTick()
      productSearchInput.value?.focus()
    }
    async function closeProductSearch() {
      productSearchOpen.value = false
      productSearch.value = ''
      if (browsing) {
        productCategory.value = browsing.category
        await nextTick()
        const list = productList.value?.$el?.querySelector('.kiosk-products__list')
        if (list) list.scrollTop = browsing.scroll
      }
    }
    function closeSearchKeyboard() {
      productSearchInput.value?.blur()
      productList.value?.focusList()
    }
    watch(
      () => invoiceData.value?.paymentRequest,
      async request => {
        qrDataUrl.value = ''
        if (!request) return
        const url = await QRCode.toDataURL(request, { width: 320, margin: 2, errorCorrectionLevel: 'M' })
        if (invoiceData.value?.paymentRequest === request) qrDataUrl.value = url
      }
    )
    watch(
      () => payments.status.value,
      value => {
        if (value !== 'paid') return
        void haptics.success()
        const order = activeOrder.value
        const paidHash = order?.attempts.find(a => a.status === 'paid')?.paymentHash
        const method = cardTry?.hash !== paidHash ? 'qr' : cardTry.failed ? null : 'card'
        cardTry = null
        if (order && method) void merchant.setSaleMethod(order.id, method).catch(() => {})
      }
    )
    watch(
      () => store.pendingDeepLink,
      payment => {
        if (payment?.target !== 'kiosk') return
        store.pendingDeepLink = null
        if (!store.isKioskRestricted || state.value === 'success') return
        if (card.accept(payment) && state.value === 'input' && totalSatsForCharge.value > 0) void proceedToTipOrCharge()
      },
      { immediate: true }
    )
    let priceTimer
    async function connectWallet() {
      if (connectionChecking.value) return
      const walletId = store.kioskWalletId
      walletReady.value = false
      connectionChecking.value = true
      try {
        if (kioskWalletBlocker(store.kioskWallet)) return
        await store.ensureWalletConnectedForTransfer(walletId)
        if (walletId === store.kioskWalletId && store.isKioskRestricted) walletReady.value = true
      } catch {
        walletReady.value = false
      } finally {
        connectionChecking.value = false
      }
    }
    function refreshPrice() {
      now.value = Date.now()
      if (isFiatMode.value || merchant.products.length || draft.value.items.some(item => item.unit === 'fiat'))
        void store.loadExchangeRates().catch(() => {})
    }
    function onVisible() {
      if (document.visibilityState === 'visible') {
        refreshPrice()
        if (!walletReady.value) void connectWallet()
      }
    }
    onMounted(async () => {
      await payments.ready
      if (!store.kioskEnabled || store.kioskOwnerAccess) {
        await router.replace('/kiosk-mode')
        return
      }
      syncDraft()
      initialized.value = true
      refreshPrice()
      priceTimer = setInterval(refreshPrice, 60000)
      document.addEventListener('visibilitychange', onVisible)
      void connectWallet()
      isNfcAvailable()
        .then(value => {
          nfcReady.value = value
        })
        .catch(() => {})
    })
    watch(
      () => [store.kioskWalletId, store.kioskOwnerAccess, store.kioskEnabled],
      () => {
        card.reset()
        walletReady.value = false
      },
      { flush: 'sync' }
    )
    const onOnline = () => {
      if (!walletReady.value) void connectWallet()
    }
    onMounted(() => window.addEventListener('online', onOnline))
    onUnmounted(() => window.removeEventListener('online', onOnline))
    onUnmounted(() => {
      clearInterval(priceTimer)
      document.removeEventListener('visibilitychange', onVisible)
      cardAuthorization.value?.cancel()
    })
    const canPrintReceipt = !$q.platform?.is?.capacitor
    function printCurrentReceipt() {
      if (!canPrintReceipt || activeOrder.value?.status !== 'paid') return
      document.body.dataset.kioskPrint = 'true'
      try {
        window.print()
      } finally {
        delete document.body.dataset.kioskPrint
      }
    }
    const money = (minor, currency) => formatKioskMoney(minor, currency, proxy.$i18n.locale)
    const count = (n, one, many) => kioskCountLabel(t, n, one, many, proxy.$i18n.locale)
    // The receipt on screen is what the customer sees; sharing hands them the same lines as text.
    async function shareCurrentReceipt() {
      if (activeOrder.value?.status !== 'paid') return
      const order = cloneKiosk(activeOrder.value)
      const paidAt = new Date(order.paidAt || order.createdAt)
      const date = Number.isNaN(paidAt.getTime())
        ? ''
        : new Intl.DateTimeFormat(proxy.$i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(paidAt)
      const text = kioskReceiptText(order, { t, money, bitcoin: displaySats, date })
      const result = await shareContent({ title: t('Receipt'), text })
      if (result.success || result.reason === 'cancelled') return
      try {
        await copyToClipboard(text)
        $q.notify({ message: t('Receipt copied'), timeout: 2000 })
      } catch (error) {
        showError(error)
      }
    }
    return {
      paymentAmount,
      paymentShowsFiat,
      canPrintReceipt,
      printCurrentReceipt,
      showCurrentReceipt,
      money,
      shareCurrentReceipt,
      count,
      connectWallet,
      connectionChecking,
      store,
      merchant,
      payments,
      draft,
      entryMode,
      state,
      busy,
      activeOrder,
      invoiceData,
      pendingOrders,
      storageProblem,
      retryStorage,
      qrDataUrl,
      hasDraft,
      basketHasItems,
      itemCount,
      quantities,
      basketDisplay,
      chargeLabel,
      canCharge,
      walletReady,
      priceMissing,
      fiatCurrency,
      fiatRate,
      isFiatMode,
      amountSats,
      totalSatsForCharge,
      kioskWalletName,
      productSearchOpen,
      productSearch,
      productCategory,
      productSearchInput,
      productList,
      showCartSheet,
      showParkedSheet,
      parkedLine,
      parkedTitle,
      lateMinutes: KIOSK_LATE_PAYMENT_GRACE_MS / 60000,
      basketItemCount,
      saleTitle,
      orderAmount,
      unitPrice,
      typedAmountLine,
      chargeTotalLabel,
      chargeFromBasket,
      leaveTip,
      interruption,
      retryCharge,
      showUnlockDialog,
      openUnlock,
      unlockPinRef,
      unlockError,
      paymentProblem,
      card,
      cardAuthorization,
      cardPinActive,
      cardPinChecking,
      cardProblem,
      cardBusy,
      nfcReady,
      selectedTipPercent,
      useRoundUp,
      baseAmountSats,
      tipInteractive,
      tipOptions,
      selectedTipAmount,
      totalBeforeRoundUp,
      roundUpValue,
      finalAmountSats,
      offersTip,
      offersRoundUp,
      extrasTitle,
      extrasSkipLabel,
      extraLabel,
      displaySats,
      productPrice,
      itemPrice,
      editAmount,
      swapAmount,
      explainMissingRate,
      addToAccumulated,
      addProduct,
      changeQuantity,
      clearAll,
      saveBasket,
      resumeBasket,
      resumeOrder,
      setEntryMode,
      openProductSearch,
      closeProductSearch,
      closeSearchKeyboard,
      proceedToTipOrCharge,
      createCharge,
      confirmTip,
      resetToInput,
      handleUnlockPin,
      resetUnlock,
      recoverOwner,
      confirmHeldCard,
      cancelCardPin
    }
  }
})
</script>

<style scoped>
.pos-connection {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 4px 16px;
  font-size: 13px;
  color: var(--text-secondary);
}
.pos-connection button {
  min-height: 44px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  flex: none;
}
.pos-current-receipt {
  height: 85dvh;
}
.pos-current-receipt :deep(.kiosk-receipt) {
  height: auto;
  flex: 1 1 0;
  min-height: 0;
}
.pos-receipt-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 10px;
}
.pos-receipt-actions .pos-secondary-btn {
  flex: 1 1 0;
  min-width: 0;
  margin: 0;
  color: var(--text-primary);
  border-color: var(--border-card);
  font-weight: 650;
}
.pos-entry-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px 8px;
  flex: none;
}
.pos-entry-switch {
  display: flex;
  flex: 1;
  gap: 3px;
  padding: 3px;
  border-radius: 12px;
  background: var(--bg-input);
}
.pos-entry-switch button {
  flex: 1;
  min-height: 44px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-secondary);
  font:
    650 14px 'Manrope',
    sans-serif;
}
.pos-entry-switch button.active {
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 1px 4px #0001;
}
.pos-icon-btn {
  width: 44px;
  min-height: 44px;
  flex: none;
  border: 0;
  border-radius: 12px;
  color: var(--text-secondary);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.pos-product-search {
  gap: 8px;
}
.pos-product-search input {
  width: 0;
  flex: 1;
  min-height: 44px;
  border: 1px solid var(--border-card);
  border-radius: 12px;
  background: var(--bg-input);
  color: var(--text-primary);
  padding: 8px 12px;
  font:
    16px 'Manrope',
    sans-serif;
}
.pos-product-search button {
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--brand-accent-text);
  font:
    500 16px 'Manrope',
    sans-serif;
}
.pos-products-actions {
  padding: 12px 16px calc(16px + var(--safe-bottom, 16px));
}
.pos-notice {
  padding: 12px 16px;
  color: var(--text-primary);
  background: var(--bg-input);
  font-size: 14px;
}
.pos-notice button {
  display: block;
  min-height: 44px;
  background: transparent;
  color: inherit;
  border: 0;
  text-decoration: underline;
}
.pos-cart-sheet.pos-basket-sheet {
  box-sizing: border-box;
  overflow: hidden;
  width: 100%;
  max-height: 85dvh;
  display: flex;
  flex-direction: column;
  padding: 16px 20px calc(16px + var(--safe-bottom, 16px));
  gap: 12px;
  color: var(--text-primary);
  background: var(--bg-card);
}
.pos-basket-items {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.pos-basket-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-card);
}
.pos-basket-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.pos-basket-line {
  flex: none;
  min-width: 72px;
  text-align: right;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.pos-saved-row > span {
  min-width: 0;
}
.pos-sheet-section {
  margin: 14px 0 2px;
  color: var(--text-secondary);
  font:
    650 13px/1.4 'Manrope',
    sans-serif;
}
.pos-sheet-note {
  margin: 2px 0 6px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.45;
}
.pos-basket-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.pos-basket-options .pos-text-btn {
  min-height: 44px;
  margin: 0;
  padding: 10px 12px;
}
.pos-basket-options .pos-text-btn:disabled {
  opacity: 0.45;
}
.pos-basket-options .pos-cancel-btn {
  color: var(--color-negative);
}
.pos-basket-row small,
.pos-saved-row small {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
  margin-top: 3px;
}
.pos-quantity {
  display: flex;
  align-items: center;
  flex: none;
}
.pos-quantity button {
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 12px;
  background: var(--bg-input);
  color: var(--text-primary);
}
.pos-quantity span {
  min-width: 30px;
  text-align: center;
}
.pos-saved-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 64px;
  padding: 12px;
  text-align: left;
  border: 0;
  border-bottom: 1px solid var(--border-card);
  color: var(--text-primary);
  background: transparent;
}
.kiosk-shell > :deep(.amount-keypad) {
  width: auto;
  margin: 0 16px;
  min-height: 360px;
}
.kiosk-lock-btn {
  min-width: 44px;
  min-height: 44px;
}
.pos-state-center {
  min-height: 0;
  overflow-y: auto;
}
.pos-state-sub {
  font-size: 14px;
  line-height: 1.5;
}
button:disabled {
  cursor: default;
  opacity: 0.5;
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 2px;
}
@media (max-height: 560px) {
  .kiosk-shell {
    overflow-y: auto;
  }
}
/* padding-top: 0 cancels the global `.q-page { padding-top: var(--safe-top) }`
   in app.css. The kiosk shell is exactly one viewport tall, so inheriting that
   pad would make the page 100dvh + --safe-top — it scrolls, and the charge
   button at the bottom of the shell is pushed behind the system nav bar. The
   status-bar inset is taken by .kiosk-header instead (same pattern as
   .shop-page / .shop-header in ShopPage.vue). */
.kiosk-page {
  min-height: 100dvh;
  padding-top: 0;
  display: flex;
  justify-content: center;
}
.kiosk-shell {
  width: 100%;
  max-width: 448px;
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.kiosk-dark {
  background: #0f0f14;
  color: #e8eaed;
}
.kiosk-light {
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* Header */
.kiosk-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(14px + var(--safe-top, 0px)) 16px 14px;
  flex-shrink: 0;
  position: relative;
}
.kiosk-header-left {
  min-width: 0;
  max-width: calc(50% - 30px);
}
.kiosk-wallet-badge span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kiosk-wallet-badge .q-icon {
  flex: none;
}
.kiosk-logo {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
}
.kiosk-wallet-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  font-family: 'Manrope', sans-serif;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #9ca3af;
  letter-spacing: 0.2px;
}
.kiosk-light .kiosk-wallet-badge {
  background: var(--bg-input);
  color: var(--text-secondary);
}
.kiosk-logo-img {
  height: 26px;
  width: auto;
}
.kiosk-lock-btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: none;
  background: rgba(255, 255, 255, 0.05);
  color: #6b7280;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.kiosk-lock-btn:active {
  transform: scale(0.94);
}
.kiosk-light .kiosk-lock-btn {
  background: var(--bg-input);
}

/* State center */
.pos-state-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: safe center;
  padding: 24px 20px;
  padding-bottom: max(24px, var(--safe-bottom, 16px));
  text-align: center;
}
.pos-state-title {
  font-size: 1rem;
  font-weight: 700;
  font-family: 'Manrope', sans-serif;
}
.pos-state-sub {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 4px;
}
.mt-2 {
  margin-top: 0.5rem;
}
.mt-4 {
  margin-top: 1rem;
}
.mt-6 {
  margin-top: 1.5rem;
}
.mt-8 {
  margin-top: 2rem;
}

/* Primary btn */
.pos-primary-btn {
  width: 100%;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: 14px;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 0.9375rem;
  font-weight: 700;
  background: #1a1a1a;
  color: #fff;
  box-shadow: 0 6px 20px -4px rgba(0, 0, 0, 0.25);
  transition:
    transform 0.08s ease,
    box-shadow 0.08s ease;
  -webkit-tap-highlight-color: transparent;
}
.pos-primary-btn:active {
  transform: scale(0.97);
  box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.2);
}
.kiosk-light .pos-primary-btn {
  background: #1a1a1a;
}
.pos-btn-disabled {
  background: #2a2a2a !important;
  color: #555 !important;
  box-shadow: none !important;
  cursor: default;
}
.pos-btn-disabled:active {
  transform: none !important;
}
.kiosk-light .pos-btn-disabled {
  background: var(--border-card) !important;
  color: var(--text-muted) !important;
}

/* A secondary action that sits UNDER a full-width primary rather than beside
   a sibling. It shares the primary's width and alignment so the pair reads as
   one stack; `.pos-text-btn` is shaped for the inline Park / Cancel row and
   became a small chip marooned in the corner when it was used here. */
.pos-secondary-btn {
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid rgba(107, 114, 128, 0.3);
  border-radius: 14px;
  color: #9ca3af;
  font-family: 'Manrope', sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  margin-top: 10px;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 0.08s ease,
    background 0.12s ease,
    border-color 0.12s ease;
}
.pos-secondary-btn:active {
  transform: scale(0.98);
  background: rgba(107, 114, 128, 0.08);
  border-color: rgba(107, 114, 128, 0.45);
}
.kiosk-light .pos-secondary-btn {
  border-color: var(--border-card);
  color: var(--text-muted);
}

/* Text btn */
.pos-text-btn {
  background: transparent;
  border: 1px solid rgba(107, 114, 128, 0.45);
  border-radius: 10px;
  color: #6b7280;
  font-size: 14px;
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
  cursor: pointer;
  padding: 10px 22px;
  margin-top: 4px;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 0.08s ease,
    background 0.12s ease,
    border-color 0.12s ease;
}
.pos-text-btn:active {
  transform: scale(0.96);
  background: rgba(107, 114, 128, 0.08);
}
.kiosk-light .pos-text-btn {
  border-color: rgba(107, 114, 128, 0.5);
}
.pos-cancel-btn {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.5);
}
.pos-cancel-btn:active {
  background: rgba(239, 68, 68, 0.08);
}

/* Sats pill */
.pos-amount-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(5, 149, 115, 0.08);
  border: 1px solid rgba(5, 149, 115, 0.18);
  border-radius: 9999px;
  padding: 5px 14px;
  font-size: 0.875rem;
  font-weight: 700;
  color: #059573;
  letter-spacing: 0.01em;
  font-family: 'Manrope', sans-serif;
}
.kiosk-light .pos-amount-pill {
  background: rgba(5, 149, 115, 0.06);
}

/* Paid */
.pos-paid-ring {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: #059573;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: paid-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes paid-pop {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Processing */
.pos-processing-wrap {
  position: relative;
  width: 80px;
  height: 80px;
}
.pos-processing-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 3px solid rgba(5, 149, 115, 0.25);
  animation: ring-expand 2s ease-out infinite;
}
.pos-ring-2 {
  animation-delay: 0.7s;
}
.pos-processing-core {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #059573;
}
@keyframes ring-expand {
  0% {
    transform: scale(1);
    opacity: 0.7;
  }
  100% {
    transform: scale(2.2);
    opacity: 0;
  }
}

/* QR */
.pos-qr-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0 0 6px;
  font-family: 'Manrope', sans-serif;
}
.pos-qr-amount-lg {
  font-size: 2rem;
  font-weight: 800;
  font-family: 'Manrope', sans-serif;
  margin: 0 0 20px;
  letter-spacing: -0.02em;
}
.pos-qr-area {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}
.pos-qr-card {
  background: white;
  border-radius: 20px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 32px -8px rgba(0, 0, 0, 0.15);
}
.pos-qr-img {
  width: 220px;
  height: 220px;
  display: block;
  border-radius: 10px;
}
.animate-pop {
  animation: paid-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Cart summary row */
.pos-cart-summary {
  text-align: left;
  border: 0;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 4px 16px 0;
  padding: 8px 14px;
  min-height: 44px;
  border-radius: 10px;
  background: rgba(5, 149, 115, 0.06);
  border: 1px solid rgba(5, 149, 115, 0.15);
  cursor: pointer;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
  font-family: 'Manrope', sans-serif;
}
.kiosk-light .pos-cart-summary {
  background: rgba(5, 149, 115, 0.04);
}

/* Cart bottom sheet */
.pos-cart-sheet {
  width: 100%;
  border-radius: 16px 16px 0 0 !important;
  padding-bottom: var(--safe-bottom, 0px);
}
.pos-cart-sheet-dark {
  background: #0c0c0c !important;
  border: 1px solid #2a342a !important;
  border-bottom: none !important;
  color: #fff;
}
.pos-cart-sheet-light {
  background: var(--bg-card) !important;
  border: 1px solid var(--border-card) !important;
  border-bottom: none !important;
  color: var(--text-primary);
}
.pos-sheet-header {
  display: flex;
  justify-content: space-between;
  font-family: 'Manrope', sans-serif;
  font-weight: 700;
  font-size: 15px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-card);
  margin-bottom: 8px;
}
.pos-cart-sheet-light .pos-sheet-header {
  border-color: var(--border-card);
}
.pos-sheet-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 17px;
}
.pos-sheet-total span {
  color: var(--text-secondary);
  font-size: 15px;
}
.pos-sheet-total strong {
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}
.pos-cart-sheet-dark .pos-sheet-remove {
  color: rgba(255, 255, 255, 0.4);
}
.pos-cart-sheet-light .pos-sheet-remove {
  color: var(--text-muted);
}

.kiosk-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pos-parked-line {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 6px 12px 6px 10px;
  border: none;
  border-radius: 999px;
  background: rgba(247, 147, 26, 0.1);
  color: #f7931a;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
}
.kiosk-light .pos-parked-line {
  color: #8a5f00;
  background: rgba(138, 95, 0, 0.08);
}

/* Keep the next-customer action clear while the current request remains watched. */
.pos-payment-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  width: 100%;
  max-width: 340px;
  margin-top: 18px;
}
.pos-outline-btn {
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 14px;
  border: 1px solid rgba(107, 114, 128, 0.4);
  background: transparent;
  color: inherit;
  font-family: 'Manrope', sans-serif;
  font-size: 0.9375rem;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 0.08s ease,
    background 0.12s ease;
}
.pos-outline-btn:active {
  transform: scale(0.97);
  background: rgba(107, 114, 128, 0.08);
}
.kiosk-light .pos-outline-btn {
  border-color: var(--border-card);
}

/* ─── Cards ─── */
.pos-qr-hint,
.pos-auto-hint {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: -4px 0 0;
}
.pos-auto-hint {
  margin: 14px 0 0;
  text-align: center;
}
.pos-contactless {
  width: 20px;
  height: 20px;
  flex: none;
}
.pos-card-lane {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 340px;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.05);
  text-align: left;
}
.kiosk-light .pos-card-lane {
  background: var(--bg-input);
}
.pos-card-wave {
  position: relative;
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(21, 222, 114, 0.14);
  color: #15de72;
}
.kiosk-light .pos-card-wave {
  color: #059573;
  background: rgba(5, 149, 115, 0.1);
}
.pos-card-wave::before,
.pos-card-wave::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  opacity: 0;
  animation: card-ring 2.4s ease-out infinite;
}
.pos-card-wave::after {
  animation-delay: 1.2s;
}
@keyframes card-ring {
  0% {
    transform: scale(1);
    opacity: 0.5;
  }
  100% {
    transform: scale(1.7);
    opacity: 0;
  }
}
.pos-card-lane-text {
  display: flex;
  flex-direction: column;
  font-family: 'Manrope', sans-serif;
}
.pos-card-lane-text b {
  font-size: 0.875rem;
}
.pos-card-lane-text span {
  font-size: 0.75rem;
  color: #9ca3af;
}
.pos-card-problem {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  width: 100%;
  max-width: 340px;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  font-size: 0.8125rem;
  line-height: 1.45;
  text-align: left;
  font-family: 'Manrope', sans-serif;
}
.kiosk-light .pos-card-problem {
  color: #b42332;
  background: rgba(180, 35, 50, 0.07);
}
.pos-card-problem b {
  font-weight: 700;
}
.pos-card-stage {
  width: 100%;
  max-width: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  margin: 8px 0 4px;
}
.pos-card-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #9ca3af;
}
.pos-card-confirm {
  margin-top: 4px;
}
.pos-card-other {
  margin-top: 12px;
}
.pos-card-held {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(21, 222, 114, 0.12);
  color: #3fe08c;
  font-family: 'Manrope', sans-serif;
  font-size: 0.8125rem;
  font-weight: 700;
}
.kiosk-light .pos-card-held {
  background: rgba(5, 149, 115, 0.1);
  color: #046b53;
}
.pos-price-wait {
  background: rgba(245, 158, 11, 0.14);
  color: #fbbf24;
}
.kiosk-light .pos-price-wait {
  background: rgba(180, 83, 9, 0.1);
  color: #92400e;
}
.pos-pay :deep(.card-pin) {
  max-width: 340px;
}

/* Actions */
/* 48px floor clears a 3-button Android nav bar even when the WebView
   reports zero bottom inset (edge-to-edge mode). var(--safe-bottom)
   wins on devices that report a larger inset (notch landscape, etc.). */
/* Additive, not max(): with max() a 3-button nav bar (--safe-bottom ≈ 48px)
   yields exactly 48px, leaving the charge button flush against the bar. The
   calc keeps the familiar 48px on gesture nav (16 + 32px floor) and grows to a
   real gap on 3-button devices. */
.pos-actions {
  display: flex;
  gap: 10px;
  padding-bottom: calc(16px + var(--safe-bottom, 16px));
}
.pos-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  background: rgba(5, 149, 115, 0.08);
  color: #059573;
  border: 1.5px solid rgba(5, 149, 115, 0.25);
  border-radius: 14px;
  cursor: pointer;
  transition:
    transform 0.08s ease,
    background 0.08s ease;
  -webkit-tap-highlight-color: transparent;
}
.pos-add-btn:active:not(:disabled) {
  transform: scale(0.94);
  background: rgba(5, 149, 115, 0.15);
}
.kiosk-light .pos-add-btn {
  background: rgba(5, 149, 115, 0.05);
}
.pos-charge-btn {
  flex: 1;
}

/* Tipping */
.tip-screen {
  min-height: 0;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 1.5rem 1.25rem;
  padding-bottom: calc(1.5rem + var(--safe-bottom, 0px));
  opacity: 0;
  transition: opacity 0.3s ease;
}
.tip-screen.tip-ready {
  opacity: 1;
}
.tip-header {
  text-align: center;
  flex-shrink: 0;
  padding-bottom: 0.75rem;
}
.tip-prompt {
  display: block;
  font-size: 1.25rem;
  font-weight: 700;
  font-family: 'Manrope', sans-serif;
  line-height: 1.3;
  margin-bottom: 1rem;
}
.tip-subtotal-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  padding: 8px 16px;
}
.kiosk-light .tip-subtotal-pill {
  background: var(--bg-input);
}
.tip-subtotal-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #9ca3af;
}
.tip-subtotal-val {
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.tip-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  justify-content: center;
  min-height: 0;
  padding: 1rem 0;
}
.tip-options {
  display: flex;
  gap: 10px;
}
.tip-opt {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 72px;
  padding: 16px 8px;
  border-radius: 16px;
  border: 2px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  transition: all 0.18s ease;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  font-family: 'Manrope', sans-serif;
}
.tip-opt:active {
  transform: scale(0.96);
}
.kiosk-light .tip-opt {
  background: var(--bg-input);
  border-color: var(--border-card);
}
.tip-opt-pct {
  font-size: 1.25rem;
  font-weight: 800;
  color: #e8eaed;
}
.kiosk-light .tip-opt-pct {
  color: var(--text-primary);
}
.tip-opt-amt {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #9ca3af;
}
/* Active tip % — tinted-green pane matching the app-wide selection
   grammar (14% wash + 1px inset ring + saturated label). */
.tip-opt-on {
  background: rgba(21, 222, 114, 0.14) !important;
  border-color: transparent !important;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22) !important;
}
.tip-opt-on .tip-opt-pct {
  color: #15de72;
}
.tip-opt-on .tip-opt-amt {
  color: #15de72;
}
.kiosk-light .tip-opt-on {
  background: rgba(5, 149, 115, 0.1) !important;
  box-shadow: inset 0 0 0 1px rgba(5, 149, 115, 0.2) !important;
}
.kiosk-light .tip-opt-on .tip-opt-pct,
.kiosk-light .tip-opt-on .tip-opt-amt {
  color: #059573;
}

.tip-roundup {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 56px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 2px solid rgba(255, 255, 255, 0.08);
  transition: all 0.18s ease;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  font-family: 'Manrope', sans-serif;
}
.tip-roundup:active {
  transform: scale(0.97);
}
.kiosk-light .tip-roundup {
  background: var(--bg-input);
  border-color: var(--border-card);
}
.kiosk-light .tip-roundup-val {
  color: var(--text-primary);
}
.kiosk-light .tip-roundup-label {
  color: var(--text-secondary);
}
.tip-roundup-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #6b7280;
  flex-shrink: 0;
}
.kiosk-light .tip-roundup-icon {
  background: var(--border-card);
}
.tip-roundup-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #9ca3af;
  flex: 1;
}
.tip-roundup-val {
  font-size: 1rem;
  font-weight: 700;
  color: #d1d5db;
}
/* Round-up row active — same tinted-green selection grammar. */
.tip-roundup-on {
  background: rgba(21, 222, 114, 0.14) !important;
  border-color: transparent !important;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22);
}
.tip-roundup-on .tip-roundup-icon {
  background: rgba(21, 222, 114, 0.22);
  color: #15de72;
}
.tip-roundup-on .tip-roundup-label {
  color: #15de72;
}
.tip-roundup-on .tip-roundup-val {
  color: #15de72;
}
.kiosk-light .tip-roundup-on {
  background: rgba(5, 149, 115, 0.1) !important;
  box-shadow: inset 0 0 0 1px rgba(5, 149, 115, 0.2);
}
.kiosk-light .tip-roundup-on .tip-roundup-icon {
  background: rgba(5, 149, 115, 0.18);
  color: #059573;
}
.kiosk-light .tip-roundup-on .tip-roundup-label,
.kiosk-light .tip-roundup-on .tip-roundup-val {
  color: #059573;
}

.tip-skip {
  padding: 14px;
  background: transparent;
  border: none;
  font-size: 0.875rem;
  font-weight: 500;
  color: #6b7280;
  text-align: center;
  text-decoration: underline;
  text-decoration-color: rgba(107, 114, 128, 0.3);
  text-underline-offset: 3px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  font-family: 'Manrope', sans-serif;
}
.tip-skip:active {
  color: inherit;
}

.tip-footer {
  flex-shrink: 0;
}
.tip-breakdown {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 14px;
  padding: 12px 16px;
  margin-bottom: 14px;
}
.kiosk-light .tip-breakdown {
  background: var(--bg-input);
}
.tip-break-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  font-weight: 500;
  color: #9ca3af;
  padding: 4px 0;
  font-family: 'Manrope', sans-serif;
}
.tip-break-tip {
  color: #d1d5db;
}
.tip-break-val {
  color: #059573;
  font-weight: 700;
}
.tip-break-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 6px 0;
}
.kiosk-light .tip-break-divider {
  background: var(--border-card);
}
.tip-break-total {
  font-weight: 800;
  font-size: 1.0625rem;
  color: #e8eaed;
  padding-top: 6px;
}
.kiosk-light .tip-break-total {
  color: var(--text-primary);
}

/* Dialog */
.kiosk-dialog {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 32px 24px;
  width: 90vw;
  max-width: 360px;
  color: var(--text-primary);
}
.kiosk-dialog-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.kiosk-dialog .pos-text-btn {
  color: var(--text-muted);
}
/* Resume sits under the keypad: room so a near miss on 0 never resumes. */
.kiosk-dialog .pos-text-btn {
  margin-top: 20px;
}

@media (max-height: 680px) {
  .pos-add-btn {
    width: 48px;
    height: 48px;
  }
  .pos-primary-btn {
    height: 48px;
  }
  /* A small phone keeps Next customer on screen under the code. */
  .pos-qr-amount-lg {
    margin-bottom: 12px;
  }
  .pos-qr-img {
    width: 176px;
    height: 176px;
  }
  .pos-qr-area {
    margin-bottom: 10px;
  }
  .pos-card-lane,
  .pos-auto-hint {
    margin-top: 10px;
  }
  .pos-payment-actions {
    margin-top: 12px;
  }
}
.pos-state-sub,
.pos-text-btn,
.tip-skip,
.tip-opt-amt,
.tip-break-row {
  color: var(--text-secondary);
}
.tip-break-tip {
  color: var(--text-primary);
}
.pos-amount-pill,
.tip-break-val,
.kiosk-light .tip-opt-on .tip-opt-pct,
.kiosk-light .tip-opt-on .tip-opt-amt,
.kiosk-light .tip-roundup-on .tip-roundup-label,
.kiosk-light .tip-roundup-on .tip-roundup-val {
  color: var(--brand-accent-text);
}
@media (prefers-reduced-motion: reduce) {
  .kiosk-shell * {
    animation: none !important;
    transition: none !important;
  }
}
@media print {
  :global(body[data-kiosk-print] #q-app),
  :global(body[data-kiosk-print] .q-dialog__backdrop) {
    display: none !important;
  }
  :global(body[data-kiosk-print] .q-dialog),
  :global(body[data-kiosk-print] .q-dialog__inner) {
    position: static !important;
    height: auto !important;
    padding: 0 !important;
  }
  .pos-current-receipt {
    display: flex;
    height: auto;
    max-height: none;
    width: 100%;
    overflow: visible;
    box-shadow: none;
  }
  .pos-receipt-actions,
  .pos-current-receipt > .pos-sheet-header {
    display: none;
  }
}
</style>
