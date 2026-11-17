<template>
  <SendModal v-model="open" @payment-detected="review" @open-batch-send="explainSinglePayment" />
</template>

<script setup>
import { ref, watch, getCurrentInstance } from 'vue'
import { useQuasar } from 'quasar'
import SendModal from '../SendModal.vue'
import { usePaymentFlowStore } from '../../stores/paymentFlow.js'
import { useWalletStore } from '../../stores/wallet.js'

const props = defineProps({ sourceWalletId: { type: String, required: true } })
const emit = defineEmits(['close'])
const open = ref(true), flow = usePaymentFlowStore(), wallets = useWalletStore(), $q = useQuasar()
const { proxy } = getCurrentInstance()
const types = { spark_address: 'spark', arkade_address: 'arkade', bitcoin_address: 'bitcoin', lightning_address: 'lightning', lnurl: 'lnurl', lightning_invoice: 'invoice', nostr_identifier: 'nostr' }
function review(payment) {
  if (wallets.isKioskRestricted || !wallets.wallets.some(wallet => wallet.id === props.sourceWalletId)) return
  const addressType = types[payment.type]
  if (!addressType) { explainSinglePayment(); return }
  const id = flow.begin({ address: payment.data, addressType, walletId: props.sourceWalletId, name: payment.contactName || '', context: 'kiosk-withdraw', paymentData: payment })
  if (id !== false) open.value = false
}
function explainSinglePayment() { $q.notify({ message: proxy.$t('Choose one invoice or address to withdraw to.'), timeout: 3500 }) }
watch(open, value => { if (!value) emit('close') })
</script>
