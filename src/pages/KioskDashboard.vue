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
          <button v-if="parkedInvoice" class="kiosk-park-btn" @click.stop="resumeParked">
            <q-icon name="pause_circle" size="15px" />
            <span>1</span>
          </button>
        </div>
        <div class="kiosk-logo" @click="handleScreenTap">
          <img src="/buho_logo.svg" alt="Buho" class="kiosk-logo-img" />
        </div>
        <button class="kiosk-lock-btn" @click.stop="showUnlockDialog = true">
          <q-icon name="lock" size="18px" />
        </button>
      </header>

      <!-- ═══ Paid ═══ -->
      <div v-if="state === 'success'" class="pos-state-center">
        <div class="pos-paid-ring"><q-icon name="check" size="36px" /></div>
        <span class="pos-state-title mt-4">{{ $t('kiosk.paymentReceived') }}</span>
        <div class="pos-amount-pill mt-2">{{ displaySats(finalAmountSats) }}</div>
        <button class="pos-primary-btn mt-8" @click.stop="resetToInput">{{ $t('kiosk.newCharge') }}</button>
      </div>

      <!-- ═══ QR ═══ -->
      <div v-else-if="state === 'payment'" class="pos-state-center">
        <p class="pos-qr-label">{{ $t('kiosk.waitingForPayment') }}</p>
        <div class="pos-qr-amount-lg">{{ displaySats(finalAmountSats) }}</div>
        <div class="pos-qr-area">
          <div class="pos-qr-card animate-pop">
            <q-spinner v-if="!invoiceData" size="36px" color="grey-6" />
            <img v-else :src="qrDataUrl" alt="QR" class="pos-qr-img" />
          </div>
        </div>
        <div class="pos-payment-actions">
          <button class="pos-text-btn" @click.stop="parkInvoice">{{ $t('kiosk.park') || 'Park' }}</button>
          <button class="pos-text-btn pos-cancel-btn" @click.stop="cancelPayment">{{ $t('Cancel') }}</button>
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
          <span class="tip-prompt">{{ $t('kiosk.addTip') }}</span>
          <div class="tip-subtotal-pill"><span class="tip-subtotal-label">{{ $t('kiosk.subtotal') || 'Subtotal' }}</span><span class="tip-subtotal-val">{{ displaySats(baseAmountSats) }}</span></div>
        </div>
        <div class="tip-body">
          <div class="tip-options">
            <button v-for="tip in tipOptions" :key="tip.percent" class="tip-opt" :class="{ 'tip-opt-on': selectedTipPercent === tip.percent }" :disabled="!tipInteractive" @click.stop="selectedTipPercent = tip.percent; useRoundUp = false">
              <span class="tip-opt-pct">{{ tip.percent }}%</span><span class="tip-opt-amt">+{{ displaySats(tip.amount) }}</span>
            </button>
          </div>
          <button v-if="roundUpValue && roundUpValue > totalBeforeRoundUp" class="tip-roundup" :class="{ 'tip-roundup-on': useRoundUp }" :disabled="!tipInteractive" @click.stop="useRoundUp = !useRoundUp; selectedTipPercent = 0">
            <div class="tip-roundup-icon"><q-icon name="keyboard_double_arrow_up" size="16px" /></div>
            <span class="tip-roundup-label">{{ $t('kiosk.roundUp') }}</span><span class="tip-roundup-val">{{ displaySats(roundUpValue) }}</span>
          </button>
          <button class="tip-skip" :disabled="!tipInteractive" @click.stop="selectedTipPercent = 0; useRoundUp = false; confirmTip()">{{ $t('kiosk.noTip') }}</button>
        </div>
        <div class="tip-footer">
          <div class="tip-breakdown">
            <div class="tip-break-row"><span>{{ $t('kiosk.subtotal') || 'Subtotal' }}</span><span>{{ displaySats(baseAmountSats) }}</span></div>
            <div v-if="selectedTipAmount > 0 || useRoundUp" class="tip-break-row tip-break-tip"><span>{{ $t('kiosk.tipLabel') || 'Tip' }}</span><span class="tip-break-val">+{{ displaySats(finalAmountSats - baseAmountSats) }}</span></div>
            <div class="tip-break-divider"></div>
            <div class="tip-break-row tip-break-total"><span>{{ $t('kiosk.total') }}</span><span>{{ displaySats(finalAmountSats) }}</span></div>
          </div>
          <button class="pos-primary-btn" :disabled="!tipInteractive" @click.stop="confirmTip"><span>{{ $t('Confirm') }}</span><q-icon name="arrow_forward" size="18px" /></button>
          <button class="pos-text-btn" @click.stop="state = 'input'">{{ $t('Back') }}</button>
        </div>
      </div>

      <!-- ═══ Entry (Numpad) ═══ -->
      <template v-else>
        <div v-if="accumulatedItems.length > 0" class="pos-cart-summary" @click.stop="showCartSheet = true">
          <span class="pos-cart-count">{{ accumulatedItems.length }} {{ accumulatedItems.length === 1 ? $t('kiosk.item') : $t('kiosk.items') }}  ·  {{ displaySats(accumulatedSats) }}</span>
          <button class="pos-cart-x" @click.stop.prevent="clearAll"><q-icon name="close" size="14px" /></button>
        </div>
        <div class="pos-top">
          <div class="pos-amount-area">
            <div class="pos-amount-row"><span class="pos-currency-sym">{{ isFiatMode ? fiatSymbol : '' }}</span><span class="pos-amount-value" :class="{ 'pos-amount-sm': formattedDisplay.length > 7 }">{{ formattedDisplay }}</span><span v-if="!isFiatMode" class="pos-currency-suffix">sats</span></div>
          </div>
        </div>
        <div class="pos-bottom">
          <div class="pos-keypad">
            <button v-for="n in ['1','2','3','4','5','6','7','8','9']" :key="n" class="pos-key pos-key-num" @click.stop="handleNumpad(n)">{{ n }}</button>
            <button v-if="isFiatMode" class="pos-key pos-key-num" @click.stop="handleNumpad('.')">.</button>
            <button v-else class="pos-key" disabled style="visibility:hidden" />
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
import { defineComponent, ref, computed, onMounted, onUnmounted, getCurrentInstance } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { useWalletStore } from 'stores/wallet'
import KioskPinPad from 'components/KioskPinPad.vue'
import QRCode from 'qrcode'

export default defineComponent({
  name: 'KioskDashboard',
  components: { KioskPinPad },

  setup() {
    const router = useRouter()
    const $q = useQuasar()
    const store = useWalletStore()
    const { proxy } = getCurrentInstance()
    const t = (key) => proxy.$t(key)

    const state = ref('input')
    const walletReady = ref(false)
    const rawInput = ref('0')
    const accumulatedItems = ref([])
    const accumulatedSats = computed(() => accumulatedItems.value.reduce((s, v) => s + v, 0))
    const selectedTipPercent = ref(0)
    const useRoundUp = ref(false)
    const baseAmountSats = ref(0)
    const tipInteractive = ref(false)
    const invoiceData = ref(null)
    const qrDataUrl = ref('')
    let pollTimer = null
    let successTimer = null
    const showCartSheet = ref(false)
    const parkedInvoice = ref(null)
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
    const fiatSymbol = computed(() => {
      const s = { EUR: '\u20AC', USD: '$', GBP: '\u00A3', CHF: 'CHF', CZK: 'K\u010D', JPY: '\u00A5', CAD: 'CA$', AUD: 'A$', BRL: 'R$', MXN: 'MX$', SEK: 'kr', NOK: 'kr', DKK: 'kr', PLN: 'z\u0142' }
      return s[store.preferredFiatCurrency] || store.preferredFiatCurrency
    })
    const formattedDisplay = computed(() => {
      if (rawInput.value === '0') return '0'
      if (isFiatMode.value) return rawInput.value
      return (parseInt(rawInput.value) || 0).toLocaleString()
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
    const roundUpValue = computed(() => {
      if (!store.kioskRoundUpEnabled) return null
      const amtSats = totalBeforeRoundUp.value
      if (amtSats <= 0) return null

      if (isFiatMode.value && fiatRate.value > 0) {
        // Round to next whole fiat unit (1 EUR, 1 USD, etc.)
        const fiat = (amtSats / 100_000_000) * fiatRate.value
        const nextFiat = Math.ceil(fiat)
        if (nextFiat <= fiat) return null // already whole number
        const nextSats = Math.round((nextFiat / fiatRate.value) * 100_000_000)
        return nextSats > amtSats ? nextSats : null
      } else {
        // Round to next 1000 sats
        const next = Math.ceil(amtSats / 1000) * 1000
        return next > amtSats ? next : null
      }
    })
    const finalAmountSats = computed(() => (useRoundUp.value && roundUpValue.value) ? roundUpValue.value : totalBeforeRoundUp.value)

    function handleNumpad(btn) {
      if (btn === 'delete') { rawInput.value = rawInput.value.length <= 1 ? '0' : rawInput.value.slice(0, -1); return }
      if (btn === '.') { if (!isFiatMode.value || rawInput.value.includes('.')) return; rawInput.value += '.'; return }
      if (rawInput.value === '0') { rawInput.value = btn; return }
      if (rawInput.value.length > 12) return
      if (isFiatMode.value && rawInput.value.includes('.')) { const d = rawInput.value.split('.')[1]; if (d && d.length >= 2) return }
      rawInput.value += btn
    }
    function addToAccumulated() { if (amountSats.value <= 0) return; accumulatedItems.value.push(amountSats.value); rawInput.value = '0' }
    function removeAccumulatedItem(idx) {
      accumulatedItems.value.splice(idx, 1)
      if (accumulatedItems.value.length === 0) showCartSheet.value = false
    }
    function clearAll() { rawInput.value = '0'; accumulatedItems.value = [] }

    function proceedToTipOrCharge() {
      if (totalSatsForCharge.value <= 0) return
      baseAmountSats.value = totalSatsForCharge.value
      selectedTipPercent.value = 0; useRoundUp.value = false
      if (store.kioskTipEnabled) { tipInteractive.value = false; state.value = 'tipping'; setTimeout(() => { tipInteractive.value = true }, 300) }
      else createCharge()
    }
    function confirmTip() { createCharge() }

    async function createCharge() {
      state.value = 'processing'; invoiceData.value = null; qrDataUrl.value = ''
      try {
        const provider = store.providers[store.kioskWalletId]
        if (!provider) throw new Error('Wallet not connected')
        const result = await provider.createInvoice({ amount: finalAmountSats.value, description: 'Kiosk Payment' })
        invoiceData.value = result
        qrDataUrl.value = await QRCode.toDataURL(result.paymentRequest, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
        state.value = 'payment'; startPolling()
      } catch (err) { console.error('[kiosk] charge error:', err); $q.notify({ message: err.message || 'Failed to create invoice', color: 'negative' }); state.value = 'input' }
    }
    function startPolling() {
      clearPolling(); const ib = store.balances[store.kioskWalletId] || 0
      pollTimer = setInterval(async () => { try { const p = store.providers[store.kioskWalletId]; if (!p) return; const b = await p.getBalance(); if (b > ib) { store.balances[store.kioskWalletId] = b; clearPolling(); showSuccess() } } catch (e) {} }, 2000)
    }
    function clearPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }
    function cancelPayment() { clearPolling(); parkedInvoice.value = null; state.value = 'input' }

    function parkInvoice() {
      parkedInvoice.value = {
        invoiceData: invoiceData.value,
        qrDataUrl: qrDataUrl.value,
        finalAmountSats: finalAmountSats.value,
        baseAmountSats: baseAmountSats.value,
        accumulatedItems: [...accumulatedItems.value]
      }
      clearPolling()
      rawInput.value = '0'
      accumulatedItems.value = []
      baseAmountSats.value = 0
      selectedTipPercent.value = 0
      useRoundUp.value = false
      invoiceData.value = null
      qrDataUrl.value = ''
      state.value = 'input'
    }

    function resumeParked() {
      if (!parkedInvoice.value) return
      invoiceData.value = parkedInvoice.value.invoiceData
      qrDataUrl.value = parkedInvoice.value.qrDataUrl
      baseAmountSats.value = parkedInvoice.value.baseAmountSats
      accumulatedItems.value = parkedInvoice.value.accumulatedItems
      parkedInvoice.value = null
      state.value = 'payment'
      startPolling()
    }
    function showSuccess() {
      state.value = 'success'
      clearTimeout(successTimer)
      successTimer = setTimeout(resetToInput, 7000)
    }

    function resetToInput() {
      clearTimeout(successTimer)
      rawInput.value = '0'
      accumulatedItems.value = []
      baseAmountSats.value = 0
      selectedTipPercent.value = 0
      useRoundUp.value = false
      invoiceData.value = null
      qrDataUrl.value = ''
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

      // Connect only the kiosk wallet
      const walletId = store.kioskWalletId
      if (walletId && !store.providers[walletId]) {
        try {
          const wallet = store.wallets.find(w => w.id === walletId)
          if (wallet) {
            await store.connectWallet(walletId)
          }
        } catch (err) {
          console.error('[kiosk] Failed to connect wallet:', err.message)
        }
      }

      walletReady.value = !!store.providers[store.kioskWalletId]
    })
    onUnmounted(() => { clearPolling(); clearTimeout(tapTimer); clearTimeout(successTimer) })

    return {
      state, walletReady, rawInput, formattedDisplay, amountSats, isFiatMode, fiatSymbol, kioskWalletName,
      accumulatedItems, accumulatedSats, totalSatsForCharge,
      handleNumpad, addToAccumulated, removeAccumulatedItem, clearAll, proceedToTipOrCharge,
      tipOptions, selectedTipPercent, selectedTipAmount, tipInteractive,
      totalBeforeRoundUp, roundUpValue, useRoundUp, finalAmountSats,
      baseAmountSats, formatSats, displaySats, createCharge, confirmTip,
      invoiceData, qrDataUrl, cancelPayment, parkInvoice, resumeParked, parkedInvoice, resetToInput,
      showCartSheet, showUnlockDialog, showPinStep, unlockPinRef, unlockError,
      handleUnlockPin, resetUnlock, handleScreenTap, store
    }
  }
})
</script>

<style scoped>
.kiosk-page { min-height: 100vh; display: flex; justify-content: center; }
.kiosk-shell { width: 100%; max-width: 448px; height: 100vh; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
.kiosk-dark { background: #0f0f14; color: #e8eaed; }
.kiosk-light { background: #fafafa; color: #1a1a1a; }

/* Header */
.kiosk-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; flex-shrink: 0; position: relative; }
.kiosk-logo { position: absolute; left: 50%; transform: translateX(-50%); display: flex; align-items: center; }
.kiosk-wallet-badge { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; font-family: 'Manrope', sans-serif; padding: 5px 10px; border-radius: 8px; background: rgba(255,255,255,0.05); color: #9ca3af; letter-spacing: 0.2px; }
.kiosk-light .kiosk-wallet-badge { background: #f0f0f0; color: #6b7280; }
.kiosk-logo-img { height: 26px; width: auto; }
.kiosk-lock-btn { width: 34px; height: 34px; border-radius: 10px; border: none; background: rgba(255,255,255,0.05); color: #6b7280; display: flex; align-items: center; justify-content: center; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.kiosk-lock-btn:active { transform: scale(0.94); }
.kiosk-light .kiosk-lock-btn { background: #f0f0f0; }

/* State center */
.pos-state-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 20px; padding-bottom: max(24px, env(safe-area-inset-bottom)); text-align: center; }
.pos-state-title { font-size: 1rem; font-weight: 700; font-family: 'Manrope', sans-serif; }
.pos-state-sub { font-size: 0.75rem; color: #6b7280; margin-top: 4px; }
.mt-2 { margin-top: 0.5rem; } .mt-4 { margin-top: 1rem; } .mt-6 { margin-top: 1.5rem; } .mt-8 { margin-top: 2rem; }

/* Primary btn */
.pos-primary-btn { width: 100%; height: 56px; display: flex; align-items: center; justify-content: center; gap: 8px; border: none; border-radius: 14px; cursor: pointer; font-family: 'Manrope', sans-serif; font-size: 0.9375rem; font-weight: 700; background: #1a1a1a; color: #fff; box-shadow: 0 6px 20px -4px rgba(0,0,0,0.25); transition: transform 0.08s ease, box-shadow 0.08s ease; -webkit-tap-highlight-color: transparent; }
.pos-primary-btn:active { transform: scale(0.97); box-shadow: 0 2px 8px -2px rgba(0,0,0,0.2); }
.kiosk-light .pos-primary-btn { background: #1a1a1a; }
.pos-btn-disabled { background: #2a2a2a !important; color: #555 !important; box-shadow: none !important; cursor: default; }
.pos-btn-disabled:active { transform: none !important; }
.kiosk-light .pos-btn-disabled { background: #e5e5e5 !important; color: #aaa !important; }

/* Text btn */
.pos-text-btn { background: none; border: none; color: #6b7280; font-size: 14px; font-family: 'Manrope', sans-serif; font-weight: 500; cursor: pointer; padding: 12px 16px; margin-top: 4px; -webkit-tap-highlight-color: transparent; }
.pos-text-btn:active { opacity: 0.6; }
.pos-cancel-btn { color: #ef4444; }

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
.pos-cart-sheet-light { background: #FFF !important; border: 1px solid #F3F3F3 !important; border-bottom: none !important; color: #1F2937; }
.pos-sheet-header { display: flex; justify-content: space-between; font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 15px; padding-bottom: 12px; border-bottom: 1px solid #2A342A; margin-bottom: 8px; }
.pos-cart-sheet-light .pos-sheet-header { border-color: #F3F3F3; }
.pos-sheet-total { color: #059573; }
.pos-sheet-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-family: 'Manrope', sans-serif; font-size: 14px; }
.pos-sheet-remove { background: none; border: none; cursor: pointer; padding: 4px; -webkit-tap-highlight-color: transparent; }
.pos-cart-sheet-dark .pos-sheet-remove { color: rgba(255, 255, 255, 0.4); }
.pos-cart-sheet-light .pos-sheet-remove { color: #9CA3AF; }
.pos-sheet-remove:active { color: #ef4444; }

/* Park button in header */
.kiosk-header-left { display: flex; align-items: center; gap: 6px; }
.kiosk-park-btn {
  height: 30px; padding: 0 10px; border-radius: 8px; border: none;
  background: rgba(247,147,26,0.1); color: #F7931A;
  display: flex; align-items: center; justify-content: center; gap: 4px;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 700;
}
.kiosk-park-btn:active { transform: scale(0.94); }

/* Payment screen actions */
.pos-payment-actions { display: flex; gap: 16px; align-items: center; justify-content: center; }

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
.kiosk-light .pos-key-num { background: #f1f5f9; border-color: #eef2f6; }
.kiosk-light .pos-key-num:active { background: #e2e8f0; }
.pos-key-action { background: transparent; color: #6b7280; }
.pos-key-action:active { color: inherit; transform: scale(0.94); }

/* Actions */
.pos-actions { display: flex; gap: 10px; padding-bottom: max(16px, env(safe-area-inset-bottom)); }
.pos-add-btn { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; flex-shrink: 0; background: rgba(5,149,115,0.08); color: #059573; border: 1.5px solid rgba(5,149,115,0.25); border-radius: 14px; cursor: pointer; transition: transform 0.08s ease, background 0.08s ease; -webkit-tap-highlight-color: transparent; }
.pos-add-btn:active:not(:disabled) { transform: scale(0.94); background: rgba(5,149,115,0.15); }
.kiosk-light .pos-add-btn { background: rgba(5,149,115,0.05); }
.pos-charge-btn { flex: 1; }

/* Tipping */
.tip-screen { flex: 1; display: flex; flex-direction: column; justify-content: space-between; padding: 1.5rem 1.25rem; padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px)); opacity: 0; transition: opacity 0.3s ease; }
.tip-screen.tip-ready { opacity: 1; }
.tip-header { text-align: center; flex-shrink: 0; padding-bottom: 0.75rem; }
.tip-prompt { display: block; font-size: 1.25rem; font-weight: 700; font-family: 'Manrope', sans-serif; line-height: 1.3; margin-bottom: 1rem; }
.tip-subtotal-pill { display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.05); border-radius: 10px; padding: 8px 16px; }
.kiosk-light .tip-subtotal-pill { background: #f1f5f9; }
.tip-subtotal-label { font-size: 0.8125rem; font-weight: 600; color: #9ca3af; }
.tip-subtotal-val { font-size: 1.125rem; font-weight: 800; letter-spacing: -0.01em; }
.tip-body { display: flex; flex-direction: column; gap: 12px; flex: 1; justify-content: center; min-height: 0; padding: 1rem 0; }
.tip-options { display: flex; gap: 10px; }
.tip-opt { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 72px; padding: 16px 8px; border-radius: 16px; border: 2px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); transition: all 0.18s ease; cursor: pointer; -webkit-tap-highlight-color: transparent; font-family: 'Manrope', sans-serif; }
.tip-opt:active { transform: scale(0.96); }
.kiosk-light .tip-opt { background: #f8fafc; border-color: #e2e8f0; }
.tip-opt-pct { font-size: 1.25rem; font-weight: 800; color: #e8eaed; }
.kiosk-light .tip-opt-pct { color: #1a1a1a; }
.tip-opt-amt { font-size: 0.8125rem; font-weight: 600; color: #9ca3af; }
.tip-opt-on { background: rgba(5,149,115,0.07) !important; border-color: #059573 !important; box-shadow: 0 0 0 1px rgba(5,149,115,0.15); }
.tip-opt-on .tip-opt-pct { color: #059573; }
.tip-opt-on .tip-opt-amt { color: #059573; }

.tip-roundup { display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 14px 16px; border-radius: 16px; background: rgba(255,255,255,0.03); border: 2px solid rgba(255,255,255,0.08); transition: all 0.18s ease; cursor: pointer; -webkit-tap-highlight-color: transparent; font-family: 'Manrope', sans-serif; }
.tip-roundup:active { transform: scale(0.97); }
.kiosk-light .tip-roundup { background: #f8fafc; border-color: #e2e8f0; }
.kiosk-light .tip-roundup-val { color: #1a1a1a; }
.kiosk-light .tip-roundup-label { color: #6b7280; }
.tip-roundup-icon { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; background: rgba(255,255,255,0.06); color: #6b7280; flex-shrink: 0; }
.kiosk-light .tip-roundup-icon { background: #e2e8f0; }
.tip-roundup-label { font-size: 0.875rem; font-weight: 600; color: #9ca3af; flex: 1; }
.tip-roundup-val { font-size: 1rem; font-weight: 700; color: #d1d5db; }
.tip-roundup-on { background: rgba(5,149,115,0.06) !important; border-color: #059573 !important; }
.tip-roundup-on .tip-roundup-icon { background: rgba(5,149,115,0.15); color: #059573; }
.tip-roundup-on .tip-roundup-label { color: #059573; }
.tip-roundup-on .tip-roundup-val { color: #059573; }

.tip-skip { padding: 14px; background: transparent; border: none; font-size: 0.875rem; font-weight: 500; color: #6b7280; text-align: center; text-decoration: underline; text-decoration-color: rgba(107,114,128,0.3); text-underline-offset: 3px; cursor: pointer; -webkit-tap-highlight-color: transparent; font-family: 'Manrope', sans-serif; }
.tip-skip:active { color: inherit; }

.tip-footer { flex-shrink: 0; }
.tip-breakdown { background: rgba(255,255,255,0.04); border-radius: 14px; padding: 12px 16px; margin-bottom: 14px; }
.kiosk-light .tip-breakdown { background: #f8fafc; }
.tip-break-row { display: flex; justify-content: space-between; font-size: 0.875rem; font-weight: 500; color: #9ca3af; padding: 4px 0; font-family: 'Manrope', sans-serif; }
.tip-break-tip { color: #d1d5db; }
.tip-break-val { color: #059573; font-weight: 700; }
.tip-break-divider { height: 1px; background: rgba(255,255,255,0.06); margin: 6px 0; }
.kiosk-light .tip-break-divider { background: #e2e8f0; }
.tip-break-total { font-weight: 800; font-size: 1.0625rem; color: #e8eaed; padding-top: 6px; }
.kiosk-light .tip-break-total { color: #1a1a1a; }

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
