<!--
  NWCWalletFound: the connection answered, so before anything is saved the
  person sees what they connected: the wallet's own name (editable), its
  balance and Lightning address when shared, what this connection may do,
  and its spending limit. Then one button adds it.
-->
<template>
  <FormSheetStep
    :title="title"
    :subtitle="relay ? $t('Connected through {relay}', { relay }) : ''"
    :badge="limited ? 'warn' : 'good'"
    back
    @back="$emit('back')"
  >
    <template #icon>
      <NWCMark />
    </template>

    <div class="iform-group">
      <div class="iform-row">
        <label class="iform-label" :for="inputId">{{ $t('Name') }}</label>
        <div class="nwc-found__field">
          <input
            :id="inputId"
            ref="input"
            :value="name"
            class="nwc-found__input"
            maxlength="40"
            autocomplete="off"
            :placeholder="title"
            @input="$emit('update:name', $event.target.value)"
            @keyup.enter="$emit('add')"
          >
          <button v-if="name" type="button" class="nwc-found__clear" :aria-label="$t('Clear')" @click="clear">
            <Icon icon="tabler:x" width="11" height="11" />
          </button>
        </div>
      </div>
      <div class="iform-line">
        <span class="iform-line-label">{{ $t('Balance') }}</span>
        <span class="iform-line-value">{{ balanceText }}</span>
      </div>
      <div v-if="probe.lud16" class="iform-line">
        <span class="iform-line-label">{{ $t('Address') }}</span>
        <span class="iform-line-value">{{ probe.lud16 }}</span>
      </div>
    </div>

    <p class="iform-seclabel nwc-found__label">{{ $t('This connection can') }}</p>
    <NWCCapabilities :capabilities="capabilities" />

    <div v-if="probe.limit" class="iform-group nwc-found__limit">
      <div class="iform-line">
        <span class="iform-line-tile" aria-hidden="true"><Icon icon="tabler:gauge" width="16" height="16" /></span>
        <span class="iform-line-label">{{ $t('Spending limit') }}<small v-if="renewsText">{{ renewsText }}</small></span>
        <span class="iform-line-value">{{ $t('{amount} left', { amount: amountText(probe.limit.remainingSats) }) }}</span>
      </div>
    </div>

    <p v-if="note" class="iform-foot">{{ note }}</p>

    <template #footer>
      <q-btn
        class="iform-connect full-width"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        :loading="busy"
        no-caps
        unelevated
        @click="$emit('add')"
      >{{ $t('Add wallet') }}</q-btn>
    </template>
  </FormSheetStep>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';
import NWCMark from './NWCMark.vue';
import NWCCapabilities from './NWCCapabilities.vue';
import { formatAmount } from '../../utils/amountFormatting.js';
import { nwcCapabilities, suggestedWalletName } from '../../utils/nwcWallet.js';
import { useWalletStore } from '../../stores/wallet';

export default {
  name: 'NWCWalletFound',
  components: { FormSheetStep, NWCMark, NWCCapabilities },
  props: {
    /** services/nwcProbe probeNwcConnection() result. */
    probe: { type: Object, required: true },
    name: { type: String, default: '' },
    relay: { type: String, default: '' },
    busy: { type: Boolean, default: false },
  },
  emits: ['update:name', 'add', 'back'],
  setup() {
    return { wallet: useWalletStore() };
  },
  computed: {
    inputId() { return `nwc-name-${this.$.uid}`; },
    title() { return suggestedWalletName(this.probe, this.$t('Lightning wallet')); },
    capabilities() { return nwcCapabilities(this.probe.methods); },
    /** A connection that cannot both send and receive is still added, with the gap said. */
    limited() { return !this.capabilities.send || !this.capabilities.receive; },
    balanceText() {
      if (this.probe.balanceSats === null || this.probe.balanceSats === undefined) return this.$t('Not shared');
      return this.amountText(this.probe.balanceSats);
    },
    renewsText() {
      const at = this.probe.limit?.renewsAt;
      if (!at) return '';
      const day = new Date(at).toLocaleDateString(this.$i18n.locale, { day: 'numeric', month: 'short' });
      return this.$t('Resets {date}', { date: day });
    },
    /** One line about what is missing, and where to change it. */
    note() {
      const wallet = this.title;
      if (this.probe.network && this.probe.network !== 'mainnet') {
        return this.$t('This wallet runs on {network}, not on Bitcoin mainnet.', { network: this.probe.network });
      }
      if (!this.capabilities.send && !this.capabilities.receive) return this.$t('This connection can neither send nor receive. Change it in {wallet}.', { wallet });
      if (!this.capabilities.send) return this.$t('Sending is off for this connection. Turn it on in {wallet} to pay from BuhoGO.', { wallet });
      if (!this.capabilities.receive) return this.$t('Receiving is off for this connection. Turn it on in {wallet} to get paid here.', { wallet });
      return '';
    },
  },
  methods: {
    amountText(sats) {
      if (this.wallet.balanceHidden) return '••••';
      return formatAmount(sats, this.wallet.useBip177Format);
    },
    clear() {
      this.$emit('update:name', '');
      this.$refs.input?.focus();
    },
  },
};
</script>

<style scoped>
.nwc-found__field {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}
.nwc-found__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  padding: 0;
  font: 500 15px/1.4 'Manrope', sans-serif;
  color: var(--text-primary);
}
.nwc-found__input::placeholder {
  color: var(--text-muted);
}
.nwc-found__clear {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--text-muted);
  color: var(--bg-card);
  opacity: 0.7;
  cursor: pointer;
}
.nwc-found__label {
  display: block;
  margin: 22px 4px 9px;
}
.nwc-found__limit {
  margin-top: 12px;
}
</style>
