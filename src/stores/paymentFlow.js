/**
 * Volatile ownership of one contextual payment. No invoices, callbacks or
 * destinations are persisted. A lease bounds preparation work to the user
 * action that started it; a cancelled/superseded lease can never reopen UI.
 */
import { computed, markRaw, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'

const COMMITTED = new Set(['sending', 'complete'])
const PHASES = new Set(['preparing', 'error', 'ready', 'sending', 'complete'])

function positiveSats(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function fallbackKey(input, destination) {
  const text = value => typeof value === 'string' ? value : ''
  // Enumerate payment/preview fields: callbacks and contact objects have no
  // serializable identity. An array also avoids delimiter collisions in user
  // supplied names, notes, addresses and opaque payment contexts.
  return JSON.stringify([
    text(input.addressType) || 'lightning', destination,
    text(input.context), text(input.walletId), positiveSats(input.amountSats),
    text(input.note), text(input.payout?.code),
    typeof input.payout?.amount === 'number' && Number.isFinite(input.payout.amount) ? input.payout.amount : null,
    text(input.name), text(input.contactId), input.fixedAmount === true,
    input.repeat === true,
  ])
}

export const usePaymentFlowStore = defineStore('contextual-payment-flow', () => {
  const intent = shallowRef(null)
  const stage = ref('idle')
  let sequence = 0
  let cancellation = null

  const active = computed(() => intent.value !== null)
  const committed = computed(() => COMMITTED.has(stage.value))
  const isCurrent = id => intent.value !== null && intent.value.id === id

  /** Start synchronously, before any route, wallet connection or lookup. */
  function begin(input = {}) {
    if (committed.value) return false
    const destination = typeof input.address === 'string' ? input.address.trim() : ''
    if (!destination && typeof input.resolve !== 'function') return false
    // Repeated taps on the same action share its pending preparation.
    const key = input.key || fallbackKey(input, destination)
    if (intent.value?.key === key && stage.value === 'preparing') return intent.value.id
    cancellation?.abort()
    cancellation = new AbortController()
    const id = ++sequence
    intent.value = markRaw(Object.freeze({
      ...input,
      id,
      key,
      address: destination,
      addressType: input.addressType || 'lightning',
      name: typeof input.name === 'string' ? input.name : '',
      amountSats: positiveSats(input.amountSats),
      fixedAmount: input.fixedAmount === true,
      signal: cancellation.signal,
    }))
    // A synchronous lock/kiosk guard may reject the handoff as it is
    // assigned. Do not revive its phase or report acceptance afterward.
    if (!isCurrent(id)) return false
    stage.value = 'preparing'
    return id
  }

  function setStage(id, next) {
    if (!isCurrent(id) || !PHASES.has(next)) return false
    stage.value = next
    return true
  }

  /** Preparation can be cancelled; an already committed payment must settle. */
  function cancel(id = intent.value?.id) {
    if (!isCurrent(id) || committed.value) return false
    cancellation?.abort()
    cancellation = null
    intent.value = null
    stage.value = 'idle'
    return true
  }

  /** The existing success/save-contact flow explicitly releases ownership. */
  function finish(id) {
    if (!isCurrent(id)) return false
    cancellation?.abort()
    cancellation = null
    intent.value = null
    stage.value = 'idle'
    return true
  }

  return { intent, stage, active, committed, begin, setStage, isCurrent, cancel, finish }
})
