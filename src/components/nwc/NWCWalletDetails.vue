<!--
  NWCWalletDetails: an NWC wallet's details in Settings, the same facts the
  connect step showed: its Lightning address, its spending limit, what this
  connection may do, and whether the wallet answered when last asked.
  Styled through the wallet detail panel's own tokens (--detail-*).
-->
<template>
  <section class="nwc-details" :aria-label="$t('Nostr Wallet Connect')">
    <div v-if="address || limit" class="nwc-details__group">
      <div v-if="address" class="nwc-details__row">
        <span class="nwc-details__label">{{ $t('Address') }}</span>
        <span class="nwc-details__value">{{ address }}</span>
        <button type="button" class="nwc-details__icon" :aria-label="$t('Copy address')" @click="$emit('copy-address', address)">
          <Icon icon="tabler:copy" width="17" height="17" aria-hidden="true" />
        </button>
      </div>
      <div v-if="limit" class="nwc-details__row">
        <span class="nwc-details__label">{{ $t('Spending limit') }}<small v-if="renewsText">{{ renewsText }}</small></span>
        <span class="nwc-details__value">{{ $t('{amount} left', { amount: amountText(limit.remainingSats) }) }}</span>
      </div>
    </div>

    <p class="nwc-details__heading">{{ $t('This connection can') }}</p>
    <NWCCapabilities :capabilities="capabilities" />

    <p class="nwc-details__heading">{{ $t('Connection') }}</p>
    <div class="nwc-details__group">
      <div class="nwc-details__row">
        <Icon icon="tabler:wifi" width="17" height="17" class="nwc-details__lead" aria-hidden="true" />
        <span class="nwc-details__label">{{ relay || $t('Relay') }}</span>
        <span class="nwc-details__value nwc-details__status" :class="`is-${statusTone}`">{{ statusText }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted } from 'vue';
import NWCCapabilities from './NWCCapabilities.vue';
import { capabilitiesOf, relayHost } from '../../utils/nwcWallet.js';
import { formatAmount } from '../../utils/amountFormatting.js';
import { useWalletStore } from '../../stores/wallet';

const props = defineProps({
  wallet: { type: Object, required: true },
  /** store.nwcLimitFor(): the spending limit the wallet shares, or null. */
  limit: { type: Object, default: null },
  /** store.nwcStatus: 'answering' | 'no-answer' | 'relay', or '' while not asked yet. */
  status: { type: String, default: '' },
});
defineEmits(['copy-address']);

const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const store = useWalletStore();

const capabilities = computed(() => capabilitiesOf(props.wallet));
const address = computed(() => props.wallet.metadata?.lud16 || '');
const relay = computed(() => relayHost(props.wallet.nwcUrl));

const statusText = computed(() => ({
  answering: t('Answering'),
  'no-answer': t('No reply'),
  relay: t('Not reachable'),
}[props.status] || t('Checking…')));
const statusTone = computed(() => ({ answering: 'good', 'no-answer': 'warn', relay: 'warn' }[props.status] || 'neutral'));

const renewsText = computed(() => {
  const at = props.limit?.renewsAt;
  if (!at) return '';
  return t('Resets {date}', { date: new Date(at).toLocaleDateString(proxy.$i18n.locale, { day: 'numeric', month: 'short' }) });
});

// Not asked this session yet (a wallet that is not the active one): ask now,
// so the status says what the wallet answers rather than "Checking…".
onMounted(() => {
  if (!props.status) store.connectWallet(props.wallet.id).catch(() => {});
});

function amountText(sats) {
  return store.balanceHidden ? '••••' : formatAmount(sats, store.useBip177Format);
}
</script>

<style scoped>
.nwc-details {
  margin-top: 20px;
}
.nwc-details__group {
  border: 1px solid var(--detail-line);
  border-radius: 16px;
  background: var(--detail-surface);
  overflow: hidden;
}
.nwc-details__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 10px 8px 10px 16px;
}
.nwc-details__row + .nwc-details__row {
  border-top: 1px solid var(--detail-line);
}
.nwc-details__lead {
  flex-shrink: 0;
  color: var(--detail-secondary);
}
.nwc-details__label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font: 600 .9375rem 'Manrope', sans-serif;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.nwc-details__label small {
  font-size: .8125rem;
  font-weight: 500;
  color: var(--detail-secondary);
}
.nwc-details__value {
  min-width: 0;
  max-width: 60%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font: 500 .9375rem 'Manrope', sans-serif;
  color: var(--detail-secondary);
  padding-right: 8px;
  font-variant-numeric: tabular-nums;
}
.nwc-details__status.is-good { color: var(--brand-accent-text); font-weight: 600; }
.nwc-details__status.is-warn { color: #8A5A00; font-weight: 600; }
:global(body.body--dark) .nwc-details__status.is-warn { color: #F5C451; }
.nwc-details__icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: none;
  color: var(--detail-secondary);
  cursor: pointer;
}
.nwc-details__icon:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: -2px;
}
.nwc-details__heading {
  margin: 22px 4px 9px;
  font: 700 .6875rem 'Manrope', sans-serif;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--detail-secondary);
}
</style>
