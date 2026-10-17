<!--
  LNBitsWalletFound: the step after Connect. The server answered, so the
  wallet is shown by what a person recognises (its name, its balance) and
  named in one field. The wallet ID stays out: nobody needs it here.
-->
<template>
  <FormSheetStep :title="$t('Wallet found')" :subtitle="domain" badge="good" back @back="$emit('back')">
    <template #icon>
      <LNBitsMark />
    </template>

    <div class="iform-group">
      <div class="iform-row">
        <label class="iform-label" :for="inputId">{{ $t('Name') }}</label>
        <div class="wallet-found__field">
          <input
            :id="inputId"
            ref="input"
            :value="name"
            class="wallet-found__input"
            maxlength="40"
            autocomplete="off"
            :placeholder="$t('My LNbits Wallet')"
            @input="$emit('update:name', $event.target.value)"
            @keyup.enter="add"
          >
          <button v-if="name" type="button" class="wallet-found__clear" :aria-label="$t('Clear')" @click="clear">
            <Icon icon="tabler:x" width="11" height="11" />
          </button>
        </div>
      </div>
      <div class="iform-row wallet-found__balance">
        <span>{{ $t('Balance') }}</span>
        <span class="wallet-found__amount">{{ balanceText }}</span>
      </div>
    </div>

    <template #footer>
      <q-btn
        class="iform-connect full-width"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        :disable="!name.trim()"
        no-caps
        unelevated
        @click="add"
      >{{ $t('Add wallet') }}</q-btn>
    </template>
  </FormSheetStep>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';
import LNBitsMark from './LNBitsMark.vue';
import { formatAmount } from '../../utils/amountFormatting.js';
import { useWalletStore } from '../../stores/wallet';

export default {
  name: 'LNBitsWalletFound',
  components: { FormSheetStep, LNBitsMark },
  props: {
    name: { type: String, default: '' },
    domain: { type: String, required: true },
    balanceSats: { type: Number, default: 0 },
  },
  emits: ['update:name', 'back', 'add'],
  setup() {
    return { wallet: useWalletStore() };
  },
  computed: {
    inputId() { return `lnbits-name-${this.$.uid}`; },
    balanceText() {
      if (this.wallet.balanceHidden) return '••••';
      return formatAmount(this.balanceSats, this.wallet.useBip177Format);
    },
  },
  methods: {
    clear() {
      this.$emit('update:name', '');
      this.$refs.input?.focus();
    },
    add() {
      if (this.name.trim()) this.$emit('add');
    },
  },
};
</script>

<style scoped>
.wallet-found__field {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}
.wallet-found__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  padding: 0;
  font: 500 15px/1.4 'Manrope', sans-serif;
  color: var(--text-primary);
}
.wallet-found__input::placeholder {
  color: var(--text-muted);
}
.wallet-found__clear {
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
.wallet-found__balance {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font: 600 15px 'Manrope', sans-serif;
  color: var(--text-primary);
}
.wallet-found__amount {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
