<template>
  <q-dialog
    class="address-request-dialog"
    no-route-dismiss
    :model-value="visible"
    :position="$q.screen.lt.sm ? 'bottom' : 'standard'"
    :persistent="state.stage === 'submitting'"
    aria-labelledby="address-request-title"
    @update:model-value="onDismiss"
    @show="state.presented = true"
    @hide="state.presented = false"
  >
    <q-card class="address-request-sheet" :class="{ 'address-request-sheet--dark': $q.dark.isActive }">
      <div class="address-request-grab" aria-hidden="true"></div>
      <div class="address-request-header">
        <h2 id="address-request-title">{{ t(title) }}</h2>
        <q-btn v-if="state.stage !== 'submitting'" flat round icon="close" :aria-label="t('Close')" @click="store.close()" />
      </div>

      <div class="address-request-body" aria-live="polite" aria-atomic="true">
        <template v-if="state.stage === 'resolving' || state.stage === 'waiting'">
          <q-spinner size="32px" aria-hidden="true" />
          <p>{{ t('Opening address request…') }}</p>
        </template>
        <template v-else-if="state.stage === 'review'">
          <p class="address-request-domain" dir="ltr">{{ state.request.domain }}</p>
          <p class="address-request-description">{{ state.request.description }}</p>
          <div class="address-request-address">
            <span>{{ t('Your Lightning address') }}</span>
            <strong dir="ltr">{{ state.snapshot.address }}</strong>
          </div>
          <p class="address-request-help">{{ t('This lets the service send you payments.') }}</p>
        </template>
        <template v-else-if="state.stage === 'submitting'">
          <q-spinner size="32px" aria-hidden="true" />
          <p>{{ t('Sharing with {domain}…', { domain: state.request.domain }) }}</p>
        </template>
        <template v-else-if="state.stage === 'confirmed'">
          <q-icon name="check_circle" size="44px" class="address-request-success" aria-hidden="true" />
          <p>{{ t('Your address was shared with {domain}.', { domain: state.request.domain }) }}</p>
        </template>
        <p v-else role="status">{{ t(message) }}</p>
      </div>

      <div class="address-request-actions">
        <template v-if="state.stage === 'review'">
          <q-btn unelevated no-caps class="address-request-primary" :label="t('Share address')" @click="approve" />
          <q-btn flat no-caps :label="t('Cancel')" @click="store.close()" />
        </template>
        <template v-else-if="state.stage === 'needsAddress'">
          <q-btn unelevated no-caps class="address-request-primary" :label="t('Set up your address')" @click="setupAddress" />
          <q-btn flat no-caps :label="t('Cancel')" @click="store.close()" />
        </template>
        <template v-else-if="state.stage === 'changed'">
          <q-btn unelevated no-caps class="address-request-primary" :label="t('Review address')" @click="store.review()" />
          <q-btn flat no-caps :label="t('Cancel')" @click="store.close()" />
        </template>
        <template v-else-if="state.stage === 'error' && state.error === 'ADDRESS_REQUEST_UNREACHABLE'">
          <q-btn unelevated no-caps class="address-request-primary" :label="t('Try again')" @click="store.retry()" />
          <q-btn flat no-caps :label="t('Cancel')" @click="store.close()" />
        </template>
        <q-btn v-else-if="state.stage !== 'submitting'" flat no-caps :label="t(state.stage === 'resolving' ? 'Cancel' : 'Done')" @click="store.close()" />
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { useAddressRequestStore } from '../stores/addressRequest.js';
import { useIdentityStore } from '../stores/identity.js';
import { useProfileStore } from '../stores/profile.js';
import { useWalletStore } from '../stores/wallet.js';
import { useUpdateStore } from '../stores/update.js';

const props = defineProps({ suspended: Boolean });
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const store = useAddressRequestStore();
const state = store.state;
const identity = useIdentityStore();
const profile = useProfileStore();
const wallet = useWalletStore();
const update = useUpdateStore();
const route = useRoute();
const router = useRouter();
const foreground = ref(document.visibilityState !== 'hidden');
const otherDialog = ref(true);
let observer, listener, disposed = false;

function checkDialogs() {
  otherDialog.value = document.body.classList.contains('barcode-scanner-active')
    || !!document.querySelector('.q-dialog:not(.address-request-dialog), .scanner-overlay');
}
const available = computed(() => !props.suspended && foreground.value && !otherDialog.value
  && !update.sheetOpen && !(wallet.kioskEnabled && !wallet.kioskOwnerAccess));
const visible = computed(() => available.value && !['idle', 'setup'].includes(state.stage));
watch(available, value => { state.available = value; if (value) store.resume(); }, { immediate: true, flush: 'sync' });
watch(() => state.stage, () => { if (available.value) store.resume(); });
watch(() => [identity.nostrNpub, profile.lud16, wallet.preferredProfileLightningAddress], () => store.identityChanged(), { flush: 'sync' });
watch(() => [wallet.kioskEnabled, wallet.kioskOwnerAccess], () => { if (!store.allowed()) store.close(); });
watch(() => route.path, (path, previous) => {
  if (state.stage === 'setup' && previous === '/identity/profile' && path !== previous) store.resume({ fromSetup: true });
});

const title = computed(() => ({ confirmed: 'Address shared', rejected: 'Address not accepted', unknown: 'Sharing not confirmed',
  error: 'Could not open address request', changed: 'Your address changed', needsAddress: 'Set up your address' })[state.stage] || 'Share Lightning address?');
const message = computed(() => {
  if (state.stage === 'needsAddress') return 'Add a Lightning address to your profile, then return here to review the request.';
  if (state.stage === 'changed') return 'Your identity or payment address changed. Review the address again before sharing.';
  if (state.stage === 'unknown') return 'The service may have received your address. Check there before opening a new request.';
  if (state.stage === 'rejected') return 'The service did not accept this request. Open a new request from the service.';
  return ({
    ADDRESS_REQUEST_INVALID: 'This address request is incomplete or does not match the original link. Ask the service for a new one.',
    ADDRESS_REQUEST_INSECURE: 'This address request uses an insecure connection.',
    ADDRESS_REQUEST_REJECTED: 'The service did not accept this request. Open a new request from the service.',
    ADDRESS_REQUEST_ALREADY_SUBMITTED: 'This request was already submitted. Check the service before opening a new one.',
  })[state.error] || 'Could not reach the service. Check your connection and open the request again.';
});

function onDismiss(value) { if (!value && available.value && state.stage !== 'submitting') store.close(); }
function approve() { checkDialogs(); if (available.value) store.approve(); }
async function setupAddress() {
  store.setup();
  try { await router.push('/identity/profile'); } catch { state.stage = 'needsAddress'; }
}
function onVisibility() { foreground.value = document.visibilityState !== 'hidden'; }
onMounted(async () => {
  observer = new MutationObserver(checkDialogs);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  checkDialogs();
  document.addEventListener('visibilitychange', onVisibility);
  if (Capacitor.isNativePlatform()) {
    const handle = await App.addListener('appStateChange', ({ isActive }) => { foreground.value = isActive; });
    if (disposed) handle.remove(); else listener = handle;
  }
});
onUnmounted(() => {
  disposed = true;
  observer?.disconnect(); listener?.remove();
  document.removeEventListener('visibilitychange', onVisibility);
  state.available = false;
  store.close();
});
</script>

<style scoped>
.address-request-sheet { width: 100%; max-width: 460px; max-height: min(90dvh, 760px); display: flex; flex-direction: column; border-radius: 24px; background: #fff; color: #182230; padding-bottom: env(safe-area-inset-bottom, 0px); }
.address-request-sheet--dark { background: #202124; color: #f5f6f7; }
.address-request-grab { width: 36px; height: 4px; border-radius: 4px; background: currentColor; opacity: .25; margin: 12px auto 0; flex-shrink: 0; }
.address-request-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px 4px 24px; }
.address-request-header h2 { flex: 1; font: inherit; font-size: 1.25rem; font-weight: 700; line-height: 1.35; margin: 0; }
.address-request-body { padding: 16px 24px; overflow-y: auto; min-height: 0; overflow-wrap: anywhere; }
.address-request-body p { margin: 0 0 16px; font-size: 1rem; line-height: 1.5; }
.address-request-domain { font-weight: 700; unicode-bidi: isolate; }
.address-request-description { white-space: pre-wrap; }
.address-request-address { display: flex; flex-direction: column; gap: 6px; padding: 16px; border-radius: 16px; background: rgba(100, 110, 120, .12); margin-bottom: 16px; }
.address-request-address span { font-size: .875rem; }
.address-request-address strong { font-size: 1rem; line-height: 1.5; unicode-bidi: isolate; }
.address-request-body .address-request-help { margin-bottom: 0; font-size: .9375rem; }
.address-request-actions { padding: 0 24px 16px; display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
.address-request-actions :deep(.q-btn) { min-height: 48px; font-size: 1rem; border-radius: 16px; }
.address-request-primary { background: #15de72; color: #092015; }
.address-request-success { color: #168447; margin-bottom: 16px; }
.address-request-sheet--dark .address-request-success { color: #15de72; }
@media (max-width: 599px) { .address-request-sheet { border-radius: 24px 24px 0 0; } }
@media (prefers-reduced-motion: reduce) { :deep(.q-spinner) { animation: none; } }
</style>
