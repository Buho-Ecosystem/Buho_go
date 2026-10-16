<!--
  NWCConnectProblem: the connection was tested and something did not
  answer. It says which part (the relay, or the wallet behind it), so the
  person knows what to check, and offers Try again or Edit connection.
-->
<template>
  <FormSheetStep
    :title="kind === 'relay' ? $t('Relay not reachable') : $t('No answer from the wallet')"
    :subtitle="kind === 'relay' ? $t('The relay this connection uses did not respond.') : $t('Your internet works. The wallet behind this connection did not reply.')"
    badge="warn"
    back
    @back="$emit('edit')"
  >
    <template #icon>
      <Icon icon="tabler:plug-connected-x" width="26" height="26" />
    </template>

    <div class="iform-group">
      <div class="iform-line">
        <span class="iform-line-tile" aria-hidden="true"><Icon icon="tabler:wifi" width="16" height="16" /></span>
        <span class="iform-line-label">{{ relay || $t('Relay') }}</span>
        <span class="iform-line-value" :class="kind === 'relay' ? 'is-warn' : 'is-good'">{{ kind === 'relay' ? $t('Not reachable') : $t('Reachable') }}</span>
      </div>
      <div class="iform-line">
        <span class="iform-line-tile" aria-hidden="true"><Icon icon="tabler:wallet" width="16" height="16" /></span>
        <span class="iform-line-label">{{ $t('Wallet') }}</span>
        <span class="iform-line-value" :class="kind === 'relay' ? '' : 'is-warn'">{{ kind === 'relay' ? $t('Not asked') : $t('No reply') }}</span>
      </div>
    </div>
    <p class="iform-foot">{{ kind === 'relay' ? $t('Check your internet or VPN, then try again.') : $t('Is your node or wallet app running? Then try again.') }}</p>

    <template #footer>
      <q-btn
        class="iform-connect full-width"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        :loading="busy"
        no-caps
        unelevated
        @click="$emit('retry')"
      >{{ $t('Try again') }}</q-btn>
      <button type="button" class="iform-secondary" :disabled="busy" @click="$emit('edit')">{{ $t('Edit connection') }}</button>
    </template>
  </FormSheetStep>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';

export default {
  name: 'NWCConnectProblem',
  components: { FormSheetStep },
  props: {
    /** 'no-answer' (the wallet was silent) or 'relay' (the relay was). */
    kind: { type: String, default: 'no-answer', validator: (v) => ['no-answer', 'relay'].includes(v) },
    relay: { type: String, default: '' },
    busy: { type: Boolean, default: false },
  },
  emits: ['retry', 'edit'],
};
</script>
