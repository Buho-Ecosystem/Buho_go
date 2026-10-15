import { computed, reactive, ref, watch } from 'vue'
import {
  allocateRequest,
  parseRequestAmount,
  REQUEST_METHOD
} from '../utils/requestAllocation.js'
import { keypadSats, satsToFiat } from '../utils/amountKeypad.js'

/** Draft-only state. Closing/back navigation never creates an obligation. */
export function useRequestAllocation(props) {
  const draft = reactive({
    method: REQUEST_METHOD.EQUAL,
    amount: props.initialSats > 0 ? String(props.initialSats) : '',
    exactSats: props.initialSats || null,
    inFiat: false,
    includeSelf: true,
    note: props.initialNote || '',
    noteOpen: Boolean(props.initialNote),
    individual: {},
    inputs: {},
    customReady: false
  })
  // Lock the rate used for entry; a background rate refresh must not change
  // an amount the person has already assigned. Adopt the first available rate.
  const rate = ref(props.fiatRate || 0)
  watch(
    () => props.fiatRate,
    (value) => {
      if (!rate.value && value > 0) rate.value = value
    }
  )
  const totalSats = computed(
    () =>
      draft.exactSats ??
      keypadSats(draft.amount, { fiat: draft.inFiat, rate: rate.value })
  )
  const allocation = computed(() =>
    allocateRequest({
      people: props.people.map((person) => ({
        pubkey: person.pubkey,
        amountSats: draft.individual[person.pubkey]
      })),
      method: draft.method,
      totalSats: totalSats.value,
      repayment: props.repayment,
      includeSelf: draft.includeSelf
    })
  )
  const inputValue = (amount) =>
    amount == null
      ? ''
      : draft.inFiat
        ? satsToFiat(amount, rate.value).toFixed(2)
        : String(amount)

  function initializeIndividual() {
    const seed = allocateRequest({
      people: props.people,
      totalSats: totalSats.value,
      repayment: props.repayment,
      includeSelf: draft.includeSelf
    })
    for (const person of props.people) {
      if (Object.hasOwn(draft.individual, person.pubkey)) continue
      const amount = draft.customReady
        ? null
        : (seed.shares.find((share) => share.pubkey === person.pubkey)
            ?.amountSats ?? null)
      draft.individual[person.pubkey] = amount
      draft.inputs[person.pubkey] = inputValue(amount)
    }
    draft.customReady = true
  }
  watch(
    () => props.people.map((person) => person.pubkey).join(':'),
    () => {
      if (draft.method === REQUEST_METHOD.AMOUNTS) initializeIndividual()
    }
  )

  function chooseMethod(method) {
    if (method === draft.method) return
    if (method === REQUEST_METHOD.AMOUNTS) initializeIndividual()
    else if (!props.repayment) {
      draft.exactSats = allocation.value.collectSats
      draft.amount = inputValue(draft.exactSats)
    }
    draft.method = method
  }
  function updateIndividual(pubkey, raw) {
    draft.inputs[pubkey] = raw
    draft.individual[pubkey] = parseRequestAmount(raw, {
      fiat: draft.inFiat,
      rate: rate.value
    })
  }
  function swapUnit() {
    if (!rate.value) return
    const exact = totalSats.value
    draft.inFiat = !draft.inFiat
    draft.exactSats = exact
    draft.amount = inputValue(exact)
    for (const [pubkey, amount] of Object.entries(draft.individual))
      draft.inputs[pubkey] = inputValue(amount)
  }
  return {
    draft,
    rate,
    totalSats,
    allocation,
    chooseMethod,
    updateIndividual,
    swapUnit,
    editTotal: () => {
      draft.exactSats = null
    },
    preserveTotal: () => {
      draft.exactSats = totalSats.value
    }
  }
}
