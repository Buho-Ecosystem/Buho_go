<!--
  NWCDuplicateStep: the connection leads to a wallet that is already here.
  Matched by the wallet behind it (its key or its Lightning address), not
  by the connection text, which differs per connection. A second
  connection to the same wallet can be wanted (different limits), so
  "Add anyway" stays possible; the very same connection again cannot.
-->
<template>
  <FormSheetStep
    :title="$t('Already added')"
    :subtitle="$t('This is the same wallet as {wallet}.', { wallet: existing.name })"
    badge="warn"
    back
    @back="$emit('back')"
  >
    <template #icon>
      <NWCMark />
    </template>

    <div v-if="existing.metadata?.lud16" class="iform-group">
      <div class="iform-line">
        <span class="iform-line-label">{{ $t('Address') }}</span>
        <span class="iform-line-value">{{ existing.metadata.lud16 }}</span>
      </div>
    </div>
    <p class="iform-foot">{{ sameConnection ? $t('This exact connection is already in BuhoGO.') : $t('A second connection to the same wallet is possible, for example with another spending limit.') }}</p>

    <template #footer>
      <q-btn
        class="iform-connect full-width"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        no-caps
        unelevated
        @click="$emit('open')"
      >{{ $t('Open {wallet}', { wallet: existing.name }) }}</q-btn>
      <button v-if="!sameConnection" type="button" class="iform-secondary" @click="$emit('add-anyway')">{{ $t('Add anyway') }}</button>
    </template>
  </FormSheetStep>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';
import NWCMark from './NWCMark.vue';

export default {
  name: 'NWCDuplicateStep',
  components: { FormSheetStep, NWCMark },
  props: {
    /** The wallet already in BuhoGO. */
    existing: { type: Object, required: true },
    /** The very same connection, not only the same wallet. */
    sameConnection: { type: Boolean, default: false },
  },
  emits: ['open', 'add-anyway', 'back'],
};
</script>
