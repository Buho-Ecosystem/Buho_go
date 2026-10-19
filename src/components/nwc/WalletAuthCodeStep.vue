<!--
  WalletAuthCodeStep: BuhoGO shows a connection request (NWC-08) and a
  wallet app approves it, by scanning the code or, on this phone, by
  opening it. The request carries only BuhoGO's public key, so the code
  can be shown and copied freely. The step waits for the wallet's answer,
  stays still while it does, and offers a new code once it expires.
-->
<template>
  <FormSheetStep
    :title="$t('Let your wallet scan this')"
    :subtitle="expired ? $t('This code has expired.') : $t('Then approve BuhoGO in your wallet app.')"
    back
    @back="$emit('back')"
  >
    <template #icon>
      <Icon icon="tabler:qrcode" width="26" height="26" />
    </template>

    <div v-if="!expired" class="code-card">
      <vue-qrcode v-if="uri" :value="uri" :options="qrOptions" class="code-card__qr" :aria-label="$t('Connection request code')" role="img" />
      <div v-else class="code-card__qr" aria-hidden="true"></div>
    </div>

    <div v-if="!expired" class="iform-group code-actions">
      <div class="code-actions__pair">
        <button type="button" class="iform-line code-actions__action" @click="$emit('copy')">
          <span class="iform-line-tile" aria-hidden="true"><Icon :icon="copied ? 'tabler:check' : 'tabler:copy'" width="16" height="16" /></span>
          {{ copied ? $t('Copied') : $t('Copy') }}
        </button>
        <button type="button" class="iform-line code-actions__action" @click="$emit('open')">
          <span class="iform-line-tile" aria-hidden="true"><Icon icon="tabler:external-link" width="16" height="16" /></span>
          {{ $t('Open wallet') }}
        </button>
      </div>
      <div class="iform-line code-wait" role="status">
        <q-spinner size="18px" class="code-wait__spinner" />
        <span class="iform-line-label">{{ $t('Waiting for approval…') }}</span>
      </div>
    </div>

    <p class="iform-foot">{{ $t('Works with wallet apps that accept connection requests, such as Alby Go and Blitz Wallet.') }}</p>

    <template #footer>
      <q-btn
        v-if="expired"
        class="iform-connect full-width"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        no-caps
        unelevated
        @click="$emit('restart')"
      >
        {{ $t('Show a new code') }}
      </q-btn>
    </template>
  </FormSheetStep>
</template>

<script>
import VueQrcode from '@chenfengyuan/vue-qrcode';
import FormSheetStep from '../sheets/FormSheetStep.vue';
import { getQrOptions } from '../../utils/qrConfig';

export default {
  name: 'WalletAuthCodeStep',
  components: { FormSheetStep, VueQrcode },
  props: {
    /** The nostr+walletauth:// request. */
    uri: { type: String, default: '' },
    expired: { type: Boolean, default: false },
    copied: { type: Boolean, default: false },
  },
  emits: ['copy', 'open', 'restart', 'back'],
  computed: {
    qrOptions() { return getQrOptions({ width: 220, errorCorrectionLevel: 'M' }); },
  },
};
</script>

<style scoped>
.code-card {
  display: grid;
  place-items: center;
  padding: 16px;
  margin: 0 auto 14px;
  width: fit-content;
  border-radius: 20px;
  background: #fff;
  border: 1px solid var(--border-card);
}
.code-card__qr {
  display: block;
  width: 220px !important;
  height: 220px !important;
}
.code-actions__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.code-actions__action {
  justify-content: center;
  color: var(--brand-accent-text);
}
.code-actions__action + .code-actions__action {
  border-top: 0;
  border-left: 1px solid var(--border-card);
}
.code-wait {
  border-top: 1px solid var(--border-card);
}
.code-wait__spinner {
  flex-shrink: 0;
  color: var(--brand-accent-text);
}
</style>
