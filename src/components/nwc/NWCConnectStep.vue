<!--
  NWCConnectStep: get a Nostr Wallet Connect connection in, by Paste or by
  Scan. The connection string carries a secret that can spend, so the
  field is hidden like a password, with a reveal toggle. Nothing is named
  here: Continue tests the connection first, and the wallet names itself.
-->
<template>
  <FormSheetStep :title="$t('Connect a wallet')" :subtitle="$t('With Nostr Wallet Connect.')" back @back="$emit('back')">
    <template #icon>
      <NWCMark />
    </template>

    <div class="iform-group">
      <div class="iform-row">
        <label class="iform-label" :for="inputId">{{ $t('Connection') }}</label>
        <div class="nwc-connect__field">
          <input
            :id="inputId"
            :value="modelValue"
            :type="revealed ? 'text' : 'password'"
            class="nwc-connect__input"
            :placeholder="$t('nostr+walletconnect://…')"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            :aria-invalid="!!error"
            :aria-describedby="error ? errorId : undefined"
            @input="$emit('update:modelValue', $event.target.value)"
            @keyup.enter="$emit('continue')"
          >
          <button
            v-if="modelValue"
            type="button"
            class="nwc-connect__reveal"
            :aria-label="revealed ? $t('Hide connection') : $t('Show connection')"
            :aria-pressed="revealed"
            @click="revealed = !revealed"
          >
            <Icon :icon="revealed ? 'tabler:eye-off' : 'tabler:eye'" width="18" height="18" />
          </button>
        </div>
      </div>
      <div class="nwc-connect__pair">
        <button type="button" class="iform-line nwc-connect__action" @click="$emit('paste')">
          <span class="iform-line-tile" aria-hidden="true"><Icon icon="tabler:clipboard" width="16" height="16" /></span>
          {{ $t('Paste') }}
        </button>
        <button type="button" class="iform-line nwc-connect__action" @click="$emit('scan')">
          <span class="iform-line-tile" aria-hidden="true"><Icon icon="tabler:scan" width="16" height="16" /></span>
          {{ $t('Scan') }}
        </button>
      </div>
    </div>

    <p v-if="error" :id="errorId" class="nwc-connect__error" role="alert">{{ error }}</p>
    <p v-else class="iform-foot">{{ $t('Find it in your wallet app under Connections or Apps.') }}</p>

    <template #footer>
      <q-btn
        class="iform-connect full-width"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        :loading="busy"
        :disable="!modelValue.trim()"
        no-caps
        unelevated
        @click="$emit('continue')"
      >
        {{ $t('Continue') }}
        <template #loading>
          <q-spinner size="18px" class="q-mr-sm" />
          {{ waiting ? $t('Waiting for your wallet…') : $t('Checking…') }}
        </template>
      </q-btn>
    </template>
  </FormSheetStep>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';
import NWCMark from './NWCMark.vue';

export default {
  name: 'NWCConnectStep',
  components: { FormSheetStep, NWCMark },
  props: {
    modelValue: { type: String, default: '' },
    error: { type: String, default: '' },
    /** The connection is being tested. */
    busy: { type: Boolean, default: false },
    /** The wallet did not answer at once; it may be an app waking up. */
    waiting: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'paste', 'scan', 'continue', 'back'],
  data() {
    return { revealed: false };
  },
  computed: {
    inputId() { return `nwc-connection-${this.$.uid}`; },
    errorId() { return `nwc-connection-error-${this.$.uid}`; },
  },
};
</script>

<style scoped>
.nwc-connect__field {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}
.nwc-connect__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  padding: 0;
  font: 500 15px/1.4 'Manrope', sans-serif;
  color: var(--text-primary);
  text-overflow: ellipsis;
}
.nwc-connect__input::placeholder {
  color: var(--text-muted);
}
.nwc-connect__reveal {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  margin: -4px -8px -4px 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}
.nwc-connect__reveal:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: -2px;
}
.nwc-connect__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 1px solid var(--border-card);
}
.nwc-connect__action {
  justify-content: center;
  color: var(--brand-accent-text);
}
.nwc-connect__action + .nwc-connect__action {
  border-top: 0;
  border-left: 1px solid var(--border-card);
}
.nwc-connect__error {
  margin: 10px 4px 0;
  font: 500 13px/1.45 'Manrope', sans-serif;
  color: var(--color-negative);
}
</style>
