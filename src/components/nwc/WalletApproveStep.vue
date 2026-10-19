<!--
  WalletApproveStep: connect a wallet by approving BuhoGO on the wallet's
  own page. Says before leaving where the person goes and that they come
  back, then waits there with a way to cancel. The connection's secret is
  made in BuhoGO and never shown. Everything wallet-specific comes from its
  utils/connectWallets entry: where it lives (`approval.locations`, and an
  address of their own when `approval.selfHosted`), the note under it, and
  an optional second way in (`approval.scanLabel`).

    ready    where (when the wallet has a choice), then Open
    waiting  approval pending; finishes by itself
    expired  took too long; start again
-->
<template>
  <FormSheetStep
    :title="wallet.name"
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
          <span class="iform-line-label">{{ $t('Waiting for approval in {wallet}…', { wallet: wallet.name }) }}</span>
        </div>
      </div>
      <p class="iform-foot">{{ $t('BuhoGO finishes the connection as soon as your approval arrives.') }}</p>
    </template>

    <template v-else-if="state === 'ready' && hasLocations">
      <p class="iform-seclabel approve-label">{{ $t(approval.locationLabel) }}</p>
      <div class="iform-group" role="radiogroup" :aria-label="$t(approval.locationLabel)">
        <button
          v-for="place in approval.locations || []"
          :key="place.id"
          type="button"
          class="iform-line"
          role="radio"
          :aria-checked="location === place.id"
          @click="$emit('update:location', place.id)"
        >
          <span class="iform-line-label">{{ place.name }}<small>{{ hostOf(place.url) }}</small></span>
          <Icon v-if="location === place.id" icon="tabler:check" width="18" height="18" class="approve-check" :aria-hidden="true" />
        </button>
        <template v-if="approval.selfHosted">
          <button
            type="button"
            class="iform-line"
            role="radio"
            :aria-checked="location === 'own'"
            @click="chooseOwn"
          >
            <span class="iform-line-label">{{ $t(approval.ownLabel) }}<small>{{ $t(approval.ownHint) }}</small></span>
            <Icon v-if="location === 'own'" icon="tabler:check" width="18" height="18" class="approve-check" :aria-hidden="true" />
          </button>
          <div v-if="location === 'own'" class="iform-row">
            <label class="iform-label" :for="inputId">{{ $t('Address') }}</label>
            <input
              :id="inputId"
              ref="address"
              :value="ownAddress"
              class="approve-input"
              type="url"
              inputmode="url"
              autocomplete="url"
              autocapitalize="off"
              spellcheck="false"
              placeholder="https://hub.example.com"
              :aria-invalid="!!error"
              :aria-describedby="error ? errorId : undefined"
              @input="$emit('update:ownAddress', $event.target.value)"
              @keyup.enter="$emit('open')"
            >
          </div>
        </template>
      </div>
      <p v-if="error" :id="errorId" class="approve-error" role="alert">{{ error }}</p>
      <p v-else class="iform-foot">{{ $t(approval.note) }}</p>
    </template>

    <template v-else-if="state === 'ready'">
      <p class="iform-foot approve-alone">{{ $t(approval.note) }}</p>
    </template>

    <template #footer>
      <q-btn
        class="iform-connect full-width"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        :disable="state === 'ready' && location === 'own' && !ownAddress.trim()"
        no-caps
        unelevated
        @click="state === 'expired' ? $emit('restart') : $emit('open')"
      >
        {{ primaryLabel }}
      </q-btn>
      <button v-if="approval.scanLabel && state === 'ready'" type="button" class="iform-secondary" @click="$emit('scan')">
        {{ $t(approval.scanLabel) }}
      </button>
    </template>
  </FormSheetStep>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';
import ConnectWalletMark from './ConnectWalletMark.vue';

export default {
  name: 'WalletApproveStep',
  components: { FormSheetStep, ConnectWalletMark },
  props: {
    /** utils/connectWallets entry that pairs by approval. */
    wallet: { type: Object, required: true },
    /** 'ready' | 'waiting' | 'expired' */
    state: { type: String, default: 'ready' },
    /** A location id from `approval.locations`, or 'own'. */
    location: { type: String, default: '' },
    ownAddress: { type: String, default: '' },
    error: { type: String, default: '' },
  },
  emits: ['open', 'cancel', 'restart', 'scan', 'back', 'update:location', 'update:ownAddress'],
  computed: {
    approval() { return this.wallet.approval || {}; },
    hasLocations() { return !!(this.approval.locations?.length || this.approval.selfHosted); },
    subtitle() {
      const wallet = this.wallet.name;
      if (this.state === 'waiting') return this.$t('{wallet} is open. Approve BuhoGO there.', { wallet });
      if (this.state === 'expired') return this.$t('The approval took too long. Start again to get a new request.');
      return this.$t('Approve BuhoGO in {wallet}, then come back here.', { wallet });
    },
    primaryLabel() {
      const wallet = this.wallet.name;
      if (this.state === 'expired') return this.$t('Start again');
      if (this.state === 'waiting') return this.$t('Open {wallet} again', { wallet });
      return this.$t('Open {wallet}', { wallet });
    },
    inputId() { return `wallet-address-${this.$.uid}`; },
    errorId() { return `wallet-address-error-${this.$.uid}`; },
  },
  methods: {
    chooseOwn() {
      this.$emit('update:location', 'own');
      this.$nextTick(() => this.$refs.address?.focus());
    },
    hostOf(url) {
      try { return new URL(url).host; } catch { return url; }
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
