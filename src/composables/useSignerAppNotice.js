import { computed, ref } from 'vue'
import { DM_ERROR } from '../services/dm/errors.js'
import { useIdentityStore } from '../stores/identity.js'
import { useMessagesStore } from '../stores/messages.js'
import { useChatRuntime } from './useChatRuntime.js'

/** What received messages wait for, as the notice's state. */
const HOLD_STATE = Object.freeze({
  [DM_ERROR.SIGNER_DENIED]: 'approval',
  [DM_ERROR.SIGNER_UNAVAILABLE]: 'away',
  [DM_ERROR.SIGNER_UNSUPPORTED]: 'unsupported',
})

/**
 * The chat's notice for an identity that signs in another app
 * (components/chat/SignerAppNotice.vue): null when there is nothing to say,
 * else 'off' (messages not turned on yet) or why messages wait.
 *
 * @returns {{ state: import('vue').ComputedRef<string | null>, kind: import('vue').ComputedRef<string>,
 *   busy: import('vue').Ref<boolean>, turnOn: () => Promise<void>, retry: () => void }}
 */
export function useSignerAppNotice() {
  const identity = useIdentityStore()
  const messages = useMessagesStore()
  const runtime = useChatRuntime()
  const busy = ref(false)

  const kind = computed(() => identity.identityCapabilities.kind)
  const state = computed(() => {
    if (!runtime.available.value || !identity.identityCapabilities.needsApproval) return null
    if (messages.scope !== runtime.me.value) return null
    if (!messages.signerAppMessages) return 'off'
    return HOLD_STATE[messages.signerHold] ?? null
  })

  async function turnOn() {
    if (busy.value) return
    busy.value = true
    try {
      await runtime.turnOnMessages()
    } finally {
      busy.value = false
    }
  }

  return { state, kind, busy, turnOn, retry: () => runtime.retrySigner() }
}
