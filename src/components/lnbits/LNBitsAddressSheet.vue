<!--
  LNBitsAddressSheet: the Lightning address of an LNbits wallet, from
  Settings. The same steps as setup, in the same form sheet:

    view 'address'  — pick or create an address (LNBitsAddressStep)
    view 'paylinks' — Pay Links is off on the server (LNBitsPayLinksStep);
                      once it answers, the sheet moves to 'address' via
                      the `available` event, which the caller handles by
                      loading the addresses and switching `view`.
-->
<template>
  <q-dialog :model-value="modelValue" position="bottom" @update:model-value="$emit('update:modelValue', $event)">
    <div class="iform-sheet lnbits-address-sheet" role="dialog" aria-modal="true" :aria-label="$t('Lightning address')">
      <div class="iform-sheet-grab" aria-hidden="true"></div>
      <LNBitsPayLinksStep
        v-if="view === 'paylinks'"
        :server-url="serverUrl"
        :domain="domain"
        :check-status="checkStatus"
        :primary-label="$t('Done')"
        back
        @back="close"
        @done="close"
        @available="$emit('available')"
      />
      <LNBitsAddressStep
        v-else
        :domain="domain"
        :existing-addresses="existingAddresses"
        :default-username="defaultUsername"
        :create-address="createAddress"
        back
        @back="close"
        @confirm="onConfirm"
      />
    </div>
  </q-dialog>
</template>

<script>
import LNBitsAddressStep from './LNBitsAddressStep.vue';
import LNBitsPayLinksStep from './LNBitsPayLinksStep.vue';

export default {
  name: 'LNBitsAddressSheet',
  components: { LNBitsAddressStep, LNBitsPayLinksStep },
  props: {
    modelValue: { type: Boolean, default: false },
    view: { type: String, default: 'address', validator: (v) => ['address', 'paylinks'].includes(v) },
    serverUrl: { type: String, default: '' },
    domain: { type: String, default: '' },
    existingAddresses: { type: Array, default: () => [] },
    defaultUsername: { type: String, default: '' },
    createAddress: { type: Function, default: null },
    checkStatus: { type: Function, default: async () => 'unknown' },
  },
  emits: ['update:modelValue', 'confirm', 'available'],
  methods: {
    close() {
      this.$emit('update:modelValue', false);
    },
    onConfirm(result) {
      this.$emit('confirm', result);
      this.close();
    },
  },
};
</script>

<style scoped>
/* Quasar only makes a dialog's direct child tappable: keep it a <div>. */
.lnbits-address-sheet {
  pointer-events: all;
  height: min(720px, calc(100dvh - var(--safe-top, 0px) - 10px));
}
</style>
