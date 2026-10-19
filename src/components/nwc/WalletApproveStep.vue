<!--
  WalletApproveStep: connect a wallet by approving BuhoGO on the wallet's
  own page (Alby Hub, Coinos). Says before leaving where the person goes
  and that they come back, then waits there with a way to cancel. The
  connection's secret is made in BuhoGO and never shown.

    ready    which Hub (Alby Hub only), then Open
    waiting  approval pending; finishes by itself
    expired  took too long; start again
-->
<template>
  <FormSheetStep
    :title="brand"
    :subtitle="subtitle"
    :back="state !== 'waiting'"
    :skip-label="state === 'waiting' ? $t('Cancel') : ''"
    @back="$emit('back')"
    @skip="$emit('cancel')"
  >
    <template #icon>
      <ConnectWalletMark :wallet="wallet" :size="30" />
    </template>

    <template v-if="state === 'waiting'">
      <div class="iform-group">
        <div class="iform-line approve-wait" role="status">
          <q-spinner size="18px" class="approve-wait__spinner" />
          <span class="iform-line-label">{{ $t('Waiting for approval in {wallet}…', { wallet: brand }) }}</span>
        </div>
      </div>
      <p class="iform-foot">{{ $t('BuhoGO finishes the connection as soon as your approval arrives.') }}</p>
    </template>

    <template v-else-if="state === 'ready' && wallet === 'albyhub'">
      <p class="iform-seclabel approve-label">{{ $t('Your Hub') }}</p>
      <div class="iform-group" role="radiogroup" :aria-label="$t('Your Hub')">
        <button
          type="button"
          class="iform-line"
          role="radio"
          :aria-checked="hubChoice === 'cloud'"
          @click="$emit('update:hubChoice', 'cloud')"
        >
          <span class="iform-line-label">Alby Cloud<small>my.albyhub.com</small></span>
          <Icon v-if="hubChoice === 'cloud'" icon="tabler:check" width="18" height="18" class="approve-check" :aria-hidden="true" />
        </button>
        <button
          type="button"
          class="iform-line"
          role="radio"
          :aria-checked="hubChoice === 'own'"
          @click="chooseOwn"
        >
          <span class="iform-line-label">{{ $t('My own Hub') }}<small>{{ $t('At home or on a server') }}</small></span>
          <Icon v-if="hubChoice === 'own'" icon="tabler:check" width="18" height="18" class="approve-check" :aria-hidden="true" />
        </button>
        <div v-if="hubChoice === 'own'" class="iform-row">
          <label class="iform-label" :for="inputId">{{ $t('Address') }}</label>
          <input
            :id="inputId"
            ref="address"
            :value="hubAddress"
            class="approve-input"
            type="url"
            inputmode="url"
            autocomplete="url"
            autocapitalize="off"
            spellcheck="false"
            placeholder="https://hub.example.com"
            :aria-invalid="!!error"
            :aria-describedby="error ? errorId : undefined"
            @input="$emit('update:hubAddress', $event.target.value)"
            @keyup.enter="$emit('open')"
          >
        </div>
      </div>
      <p v-if="error" :id="errorId" class="approve-error" role="alert">{{ error }}</p>
      <p v-else class="iform-foot">{{ $t('Your Hub opens so you can approve BuhoGO. Nothing to copy.') }}</p>
    </template>

    <template v-else-if="state === 'ready'">
      <p class="iform-foot approve-alone">{{ $t('Coinos opens so you can approve BuhoGO. Sign in if it asks. Nothing to copy.') }}</p>
    </template>

    <template #footer>
      <q-btn
        class="iform-connect full-width"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        :disable="state === 'ready' && wallet === 'albyhub' && hubChoice === 'own' && !hubAddress.trim()"
        no-caps
        unelevated
        @click="state === 'expired' ? $emit('restart') : $emit('open')"
      >
        {{ primaryLabel }}
      </q-btn>
      <button v-if="wallet === 'albyhub' && state === 'ready'" type="button" class="iform-secondary" @click="$emit('scan')">
        {{ $t('Scan a code from your Hub') }}
      </button>
    </template>
  </FormSheetStep>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';
import ConnectWalletMark from './ConnectWalletMark.vue';

const BRANDS = { albyhub: 'Alby Hub', coinos: 'Coinos' };

export default {
  name: 'WalletApproveStep',
  components: { FormSheetStep, ConnectWalletMark },
  props: {
    /** 'albyhub' | 'coinos' */
    wallet: { type: String, required: true },
    /** 'ready' | 'waiting' | 'expired' */
    state: { type: String, default: 'ready' },
    /** Alby Hub only: 'cloud' | 'own' */
    hubChoice: { type: String, default: 'cloud' },
    hubAddress: { type: String, default: '' },
    error: { type: String, default: '' },
  },
  emits: ['open', 'cancel', 'restart', 'scan', 'back', 'update:hubChoice', 'update:hubAddress'],
  computed: {
    brand() { return BRANDS[this.wallet] || this.wallet; },
    subtitle() {
      if (this.state === 'waiting') return this.$t('{wallet} is open. Approve BuhoGO there.', { wallet: this.brand });
      if (this.state === 'expired') return this.$t('The approval took too long. Start again to get a new request.');
      return this.$t('Approve BuhoGO in {wallet}, then come back here.', { wallet: this.brand });
    },
    primaryLabel() {
      if (this.state === 'expired') return this.$t('Start again');
      if (this.state === 'waiting') return this.$t('Open {wallet} again', { wallet: this.brand });
      return this.$t('Open {wallet}', { wallet: this.brand });
    },
    inputId() { return `hub-address-${this.$.uid}`; },
    errorId() { return `hub-address-error-${this.$.uid}`; },
  },
  methods: {
    chooseOwn() {
      this.$emit('update:hubChoice', 'own');
      this.$nextTick(() => this.$refs.address?.focus());
    },
  },
};
</script>

<style scoped>
.approve-label {
  margin: 0 4px 8px;
}
.approve-check {
  flex-shrink: 0;
  color: var(--brand-accent-text);
}
.approve-input {
  width: 100%;
  min-height: 30px;
  border: 0;
  outline: none;
  background: none;
  padding: 0;
  font: 500 15px/1.4 'Manrope', sans-serif;
  color: var(--text-primary);
}
.approve-input::placeholder {
  color: var(--text-muted);
}
.approve-error {
  margin: 10px 4px 0;
  font: 500 13px/1.45 'Manrope', sans-serif;
  color: var(--color-negative);
}
.approve-wait__spinner {
  flex-shrink: 0;
  color: var(--brand-accent-text);
}
.approve-wait .iform-line-label {
  white-space: normal;
}
.approve-alone {
  text-align: center;
  margin-top: 0;
}
</style>
