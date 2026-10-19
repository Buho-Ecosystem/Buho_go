<!--
  PairingReturnStep: a Hub sent the person back, but this BuhoGO is not the
  one waiting for it. On an Android browser that usually means the app
  asked and the browser caught the return: hand it to the app. Anywhere
  else the request is gone (expired, or started on another device), so
  the way on is to start again.
-->
<template>
  <FormSheetStep
    :title="handOff ? $t('Finish in the BuhoGO app') : $t('Nothing is waiting for this approval')"
    :subtitle="handOff
      ? $t('You approved BuhoGO. The app that asked finishes the connection.')
      : $t('It may have expired, or it was started on another device. Start again from here.')"
    :badge="handOff ? 'good' : 'warn'"
    back
    @back="$emit('back')"
  >
    <template #icon>
      <Icon icon="tabler:plug-connected" width="26" height="26" />
    </template>

    <template #footer>
      <q-btn
        class="iform-connect full-width"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        no-caps
        unelevated
        @click="handOff ? $emit('hand-off') : $emit('restart')"
      >
        {{ handOff ? $t('Open BuhoGO') : $t('Connect a wallet') }}
      </q-btn>
    </template>
  </FormSheetStep>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';

export default {
  name: 'PairingReturnStep',
  components: { FormSheetStep },
  props: {
    /** An Android browser, where an intent link can open the app. */
    handOff: { type: Boolean, default: false },
  },
  emits: ['hand-off', 'restart', 'back'],
};
</script>
