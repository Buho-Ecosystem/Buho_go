import { computed, shallowRef } from 'vue'
import { DM_ERROR, DmError } from '../services/dm/errors.js'

/**
 * The way UI code reaches the contact chat's runtime.
 *
 * `boot/dm-inbox.js` owns the runtime's life (one per identity, replaced when
 * the identity changes) and publishes the current one here. UI code never
 * holds a runtime: it calls the actions on the object `useChatRuntime()`
 * returns, and every call goes to whichever runtime is current at that moment.
 * That is the point of a facade over provide/inject: the runtime is replaced
 * on an identity switch while pages stay mounted, a plain `inject`ed value
 * would keep pointing at the disposed one, and a module-level ref also works
 * outside components (router guards, stores).
 *
 *   const chat = useChatRuntime()
 *   await chat.sendText(partner, text)
 *   chat.available.value          // false until an identity (and its runtime) exists
 *
 * Actions return promises and reject with a `DmError` (`NO_IDENTITY` when
 * there is no runtime). The synchronous ones answer harmlessly without a
 * runtime: `requestState` and `requestSettlement` give `null`.
 *
 * The runtime's own contract: services/dm/runtime.js.
 */

const current = shallowRef(null)

/** Boot only: make `runtime` (or nothing) the one the UI talks to. */
export function publishChatRuntime(runtime) {
  current.value = runtime ?? null
}

const noRuntime = () => new DmError(DM_ERROR.NO_IDENTITY, 'the chat is not available')

function forward(name) {
  return (...args) => {
    const runtime = current.value
    if (!runtime) return Promise.reject(noRuntime())
    return runtime[name](...args)
  }
}

const facade = Object.freeze({
  /** True while a runtime exists (an identity is loaded). */
  available: computed(() => current.value !== null),
  /** The pubkey the chat currently runs for, or null. */
  me: computed(() => current.value?.me ?? null),

  sendText: forward('sendText'),
  requestMoney: forward('requestMoney'),
  declineRequest: forward('declineRequest'),
  cancelRequest: forward('cancelRequest'),
  remindRequest: forward('remindRequest'),
  announcePayment: forward('announcePayment'),
  reportPayment: forward('reportPayment'),
  react: forward('react'),
  retry: forward('retry'),
  requestAddress: forward('requestAddress'),
  fetchRequestInvoice: forward('fetchRequestInvoice'),
  settleClaims: forward('settleClaims'),
  partnerReachability: forward('partnerReachability'),
  /** Signer-app identities: start receiving once the person turned messages on. */
  turnOnMessages: forward('turnOnMessages'),
  /** Signer-app identities: ask the signer app again after it refused or was away. */
  retrySigner: () => current.value?.retrySigner(),

  requestState: requestId => (current.value ? current.value.requestState(requestId) : null),
  requestSettlement: requestId => (current.value ? current.value.requestSettlement(requestId) : null),
})

export function useChatRuntime() {
  return facade
}
