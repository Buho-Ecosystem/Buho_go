import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { deriveRequestStates, useMessagesStore } from '../stores/messages.js'
import { useChatRuntime } from './useChatRuntime.js'
import { MESSAGE_TYPE } from '../services/dm/protocol.js'
import {
  chatRequestGoal,
  requestGoalProgress,
  requestIdsOf
} from '../services/dm/requestGoals.js'

const isReady = (messages, runtime) =>
  runtime.available.value && messages.scope === runtime.me.value

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** The longest Home's list goes without reading the clock (a timer cannot wait 30 days). */
const MAX_CLOCK_WAIT_MS = 60_000

/**
 * The Requests page model, derived from the chat ledger: what the user asked
 * for (goals and requests sent from a chat) and what contacts ask of them.
 */
export function useRequests() {
  const messages = useMessagesStore()
  const runtime = useChatRuntime()
  const now = ref(nowSeconds())
  let timer
  const ready = computed(() => isReady(messages, runtime))
  const ledger = computed(() => {
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
    return { byId, states }
  })
  const progress = (goal) =>
    requestGoalProgress(goal, {
      messageFor: (share) => ledger.value.byId.get(share.requestId),
      stateFor: (id) => ledger.value.states.get(id),
      settlementFor: (id) =>
        messages.settlement(id) ? { verified: true } : null
    })
  const goals = computed(() =>
    ready.value ? messages.requestGoalsSorted.map(progress) : []
  )
  /** Everything the user asked for, newest first, including chat requests outside any goal. */
  const outgoing = computed(() => {
    if (!ready.value) return []
    const inGoals = new Set(
      goals.value.flatMap((goal) => goal.shares.flatMap(requestIdsOf))
    )
    const fromChats = [...ledger.value.byId.values()]
      .filter(
        (message) =>
          message.type === MESSAGE_TYPE.REQUEST &&
          message.outgoing &&
          !inGoals.has(message.id)
      )
      .map((message) => progress(chatRequestGoal(message)))
    return [...goals.value, ...fromChats].sort(
      (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)
    )
  })
  const toPay = computed(() => (ready.value ? messages.requestsToPay(now.value) : []))
  onMounted(() => {
    void runtime.settleClaims().catch(() => {})
    timer = setInterval(() => {
      now.value = nowSeconds()
    }, 30_000)
  })
  onBeforeUnmount(() => clearInterval(timer))
  return {
    goals,
    outgoing,
    toPay,
    ready,
    goalFor: (id) => goals.value.find((goal) => goal.id === id),
    runtime,
    messages
  }
}

/**
 * Requests waiting for the user that should catch their eye; muted chats stay
 * quiet. The clock moves when the next request expires, so an expired request
 * leaves the list on time instead of failing on Pay.
 */
export function useRequestsToPay() {
  const messages = useMessagesStore()
  const runtime = useChatRuntime()
  const now = ref(nowSeconds())
  const requests = computed(() =>
    isReady(messages, runtime)
      ? messages
          .requestsToPay(now.value)
          .filter((message) => !messages.threads[message.partner]?.muted)
      : []
  )
  let timer
  watch(
    requests,
    (list) => {
      clearTimeout(timer)
      if (!list.length) return
      // Expired once the clock passes validUntil; the 250 ms make sure it has.
      const nextExpiryMs =
        (Math.min(...list.map((message) => message.request.validUntil)) + 1) * 1000 + 250
      const wait = Math.min(Math.max(nextExpiryMs - Date.now(), 0), MAX_CLOCK_WAIT_MS)
      timer = setTimeout(() => {
        now.value = nowSeconds()
      }, wait)
    },
    { immediate: true }
  )
  onBeforeUnmount(() => clearTimeout(timer))
  return requests
}
