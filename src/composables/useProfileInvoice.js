import { ref, shallowRef, onScopeDispose } from 'vue';
import { requestProfileInvoice } from '../services/publicProfileInvoice.js';

/** Owns request lifetime so changed input or a different profile cannot reuse a stale invoice. */
export function useProfileInvoice(request = requestProfileInvoice) {
  const invoice = shallowRef(null);
  const error = shallowRef(null);
  const loading = ref(false);
  let active = null;

  function invalidate() {
    active?.abort();
    active = null;
    invoice.value = null;
    error.value = null;
    loading.value = false;
  }

  async function create(input) {
    if (loading.value) return;
    invalidate();
    const controller = new AbortController();
    active = controller;
    loading.value = true;
    try {
      const result = await request({ ...input, signal: controller.signal });
      if (active === controller) invoice.value = result;
    } catch (cause) {
      if (active === controller) error.value = cause;
    } finally {
      if (active === controller) {
        active = null;
        loading.value = false;
      }
    }
  }

  onScopeDispose(invalidate);
  return { invoice, error, loading, create, invalidate };
}
