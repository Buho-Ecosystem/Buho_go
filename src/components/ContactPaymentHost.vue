<template>
  <!-- Only the existing payment pipeline is mounted. The originating route
       stays mounted, with its scroll position and draft, behind the dialog. -->
  <Wallet
    v-if="flow.intent"
    :key="flow.intent.id"
    payment-only
    :payment-intent="flow.intent"
  />
</template>

<script setup>
import { defineAsyncComponent, getCurrentInstance, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useQuasar } from 'quasar'
import { loadContactPaymentPipeline } from './contactPaymentPipeline.js'
import { usePaymentFlowStore } from '../stores/paymentFlow.js'
import { useIdentityStore } from '../stores/identity.js'
import { useWalletStore } from '../stores/wallet.js'

const props = defineProps({ suspended: { type: Boolean, default: false } })
const $q = useQuasar()
// vue-i18n runs in legacy mode, so useI18n() throws; use the instance's $t.
const { proxy } = getCurrentInstance()
const flow = usePaymentFlowStore()
const route = useRoute()
const identity = useIdentityStore()
const wallets = useWalletStore()
let invalidatedIntentId = null

function invalidateContext() {
  const id = flow.intent?.id
  if (id == null) return
  invalidatedIntentId = id
  flow.cancel(id)
}

// The pipeline is the wallet page, fetched apart from the layout this host
// lives in (contactPaymentPipeline.js). Where it cannot be fetched (the web
// app, offline, before Home was ever opened) the tap is given back with a
// reason, never held as a payment nobody can see.
const Wallet = defineAsyncComponent({
  loader: loadContactPaymentPipeline,
  onError(error, _retry, fail) {
    invalidateContext()
    $q.notify({ type: 'negative', message: proxy.$t('Check your connection and try again.'), timeout: 3500 })
    fail(error)
  },
})

// Preparing another person's payment after leaving its context is never an
// acceptable late result. A committed send remains bound to its paying wallet
// and must finish through the existing confirmation/success lifecycle.
watch(() => route.fullPath, invalidateContext, { flush: 'sync' })
watch(() => identity.nostrPubkeyHex, invalidateContext, { flush: 'sync' })
watch(() => props.suspended || wallets.kioskEnabled, blocked => {
  if (blocked) invalidateContext()
}, { immediate: true, flush: 'sync' })
watch(() => flow.intent?.id, (id, previousId) => {
  if (id !== previousId) invalidatedIntentId = null
  if (props.suspended || wallets.kioskEnabled) invalidateContext()
}, { flush: 'sync' })
// A committed debit must settle. If it fails and becomes editable again,
// discard the old context instead of offering a retry under a new identity,
// route or lock session. Success and Save to Contacts keep their lifecycle.
watch(() => flow.stage, () => {
  if (invalidatedIntentId != null && invalidatedIntentId === flow.intent?.id && !flow.committed) {
    flow.cancel(invalidatedIntentId)
  }
}, { flush: 'sync' })
</script>
