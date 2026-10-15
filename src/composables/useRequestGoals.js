import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { deriveRequestStates, useMessagesStore } from '../stores/messages.js'
import { useChatRuntime } from './useChatRuntime.js'
import { requestGoalProgress } from '../services/dm/requestGoals.js'

/** Reactive owner views; every status comes from the existing chat ledger. */
export function useRequestGoals() {
  const messages = useMessagesStore()
  const runtime = useChatRuntime()
  const now = ref(Math.floor(Date.now() / 1000))
  let timer
  const ready = computed(
    () => runtime.available.value && messages.scope === runtime.me.value
  )
  const goals = computed(() => {
    if (!ready.value) return []
    const byId = new Map(),
      states = new Map()
    for (const thread of Object.values(messages.threads)) {
      for (const message of thread.messages) byId.set(message.id, message)
      for (const [id, state] of deriveRequestStates(
        thread.messages,
        now.value,
        messages.ownPayments
      ))
        states.set(id, state)
    }
    return messages.requestGoalsSorted.map((goal) =>
      requestGoalProgress(goal, {
        messageFor: (share) => byId.get(share.requestId),
        stateFor: (id) => states.get(id),
        settlementFor: (id) =>
          messages.settlement(id) ? { verified: true } : null
      })
    )
  })
  onMounted(() => {
    void runtime.settleClaims().catch(() => {})
    timer = setInterval(() => {
      now.value = Math.floor(Date.now() / 1000)
    }, 30_000)
  })
  onBeforeUnmount(() => clearInterval(timer))
  return {
    goals,
    ready,
    goalFor: (id) => goals.value.find((goal) => goal.id === id),
    runtime,
    messages
  }
}
