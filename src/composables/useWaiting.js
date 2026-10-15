import { computed } from 'vue'
import { useRequestsToPay } from './useRequests.js'
import { useWithdrawVouchersStore } from '../stores/withdrawVouchers.js'

/** What waits for the user on Home: contacts' open requests and vouchers that still hold money. */
export function useWaiting() {
  const requests = useRequestsToPay()
  const vouchersStore = useWithdrawVouchersStore()
  const vouchers = computed(() => vouchersStore.active)
  const hasAny = computed(() => requests.value.length > 0 || vouchers.value.length > 0)
  return { requests, vouchers, hasAny }
}
