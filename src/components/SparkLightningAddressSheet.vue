<template>
  <q-dialog
    :model-value="modelValue" position="bottom" transition-show="slide-up" transition-hide="slide-down"
    :persistent="busy" @update:model-value="close" @show="onOpen"
  >
    <q-card class="lnaddr-sheet" :class="$q.dark.isActive ? 'lnaddr-dark' : 'lnaddr-light'" :aria-busy="busy || phase === 'loading'">
      <div class="lnaddr-grabber" aria-hidden="true"><div class="lnaddr-grabber-bar"></div></div>
      <header class="lnaddr-header">
        <q-btn flat round dense class="glass-back-btn" :disable="busy" :aria-label="$t('Back')" @click="onBack">
          <Icon icon="tabler:chevron-left" width="20" height="20" />
        </q-btn>
        <h2 class="lnaddr-title">{{ phase === 'review' ? $t('Review address') : $t('Lightning Address') }}</h2>
        <div class="lnaddr-header-spacer" aria-hidden="true"></div>
      </header>

      <div v-if="phase === 'loading'" class="lnaddr-body lnaddr-center" role="status">
        <q-spinner size="28px" aria-hidden="true" /><span>{{ $t('Checking current address…') }}</span>
      </div>
      <template v-else-if="phase === 'error'">
        <div class="lnaddr-body"><p class="lnaddr-caption" role="alert">{{ error }}</p></div>
        <div class="lnaddr-cta-row"><q-btn unelevated no-caps class="lnaddr-cta-primary" :label="$t('Check address')" @click="loadAddress" /></div>
      </template>
      <template v-else-if="phase === 'view'">
        <div class="lnaddr-body">
          <div class="lnaddr-icon-tile"><Icon icon="tabler:at" width="26" height="26" /></div>
          <div class="lnaddr-address">{{ address }}</div>
          <p v-if="updated" class="lnaddr-caption" role="status">{{ $t('Address updated. Share this address and update any saved payout details.') }}</p>
          <p v-else class="lnaddr-caption">{{ $t('Payments sent to this address arrive in this wallet. It stays yours after reinstalling or restoring from your recovery phrase.') }}</p>
        </div>
        <div class="lnaddr-cta-row">
          <q-btn unelevated no-caps class="lnaddr-cta-primary" :label="$t('Copy address')" @click="copyAddress" />
          <q-btn flat no-caps class="lnaddr-cta-secondary" :label="$t('Change address')" @click="enterChange" />
        </div>
      </template>
      <template v-else-if="phase === 'review'">
        <div class="lnaddr-body">
          <div class="lnaddr-icon-tile"><Icon icon="tabler:at" width="26" height="26" /></div>
          <p class="lnaddr-caption">{{ $t('New receiving address') }}</p>
          <div class="lnaddr-address">{{ proposedAddress }}</div>
          <div v-if="address" class="lnaddr-consequence">
            <p>{{ $t('{address} will stop receiving payments. Its name stays reserved for this wallet.', { address }) }}</p>
            <p>{{ $t('Update saved contacts, shared QR codes and automatic payouts to use the new address.') }}</p>
          </div>
          <p v-else class="lnaddr-caption">{{ $t('Payments sent to it arrive in this wallet.') }}</p>
          <p v-if="error" class="lnaddr-error" role="alert">{{ error }}</p>
        </div>
        <div class="lnaddr-cta-row">
          <q-btn unelevated no-caps class="lnaddr-cta-primary" :label="busy ? $t('Updating address…') : address ? $t('Change address') : $t('Claim address')" :loading="busy" @click="submitUsername" />
          <q-btn flat no-caps class="lnaddr-cta-secondary" :label="$t('Cancel')" :disable="busy" @click="onBack" />
        </div>
      </template>
      <form v-else @submit.prevent="reviewUsername">
        <div class="lnaddr-body">
          <div class="lnaddr-icon-tile"><Icon icon="tabler:at" width="26" height="26" /></div>
          <p class="lnaddr-caption lnaddr-caption-lead">{{ $t('Pick a name. Payments sent to it arrive in this wallet.') }}</p>
          <label for="lnaddr-username" class="lnaddr-label">{{ $t('Address name') }}</label>
          <div class="lnaddr-field" :class="{ 'lnaddr-field-focus': fieldFocused }">
            <input id="lnaddr-username" ref="usernameInput" v-model="username" class="lnaddr-input" type="text"
              autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text"
              :placeholder="$t('name')" maxlength="32" aria-describedby="lnaddr-status" :aria-invalid="availability === 'invalid' || availability === 'taken'"
              @focus="fieldFocused = true" @blur="fieldFocused = false" />
            <span class="lnaddr-suffix">{{ domainSuffix }}</span>
          </div>
          <div id="lnaddr-status" class="lnaddr-status" :class="statusClass" role="status" aria-live="polite">
            <q-spinner v-if="availability === 'checking'" size="12px" class="q-mr-xs" aria-hidden="true" />
            <span>{{ statusText }}</span>
          </div>
          <q-btn v-if="availability === 'error'" flat no-caps :label="$t('Check availability')" @click="scheduleAvailabilityCheck" />
          <p v-if="error" class="lnaddr-error" role="alert">{{ error }}</p>
        </div>
        <div class="lnaddr-cta-row"><q-btn type="submit" unelevated no-caps class="lnaddr-cta-primary" :label="$t('Review address')" :disable="availability !== 'available'" /></div>
      </form>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { BREEZ_LNURL_DOMAIN } from '../config/breez';

const USERNAME_RE = /^[a-z0-9]{3,32}$/;

export default {
  name: 'SparkLightningAddressSheet',
  components: { Icon },
  props: { modelValue: { type: Boolean, default: false }, walletId: { type: String, required: true } },
  emits: ['update:modelValue', 'changed'],
  data() {
    return { phase: 'loading', address: null, username: '', availability: 'idle', busy: false,
      fieldFocused: false, error: '', updated: false, checkTimer: null, checkSeq: 0, loadSeq: 0 };
  },
  computed: {
    domainSuffix() { return '@' + (BREEZ_LNURL_DOMAIN || 'breez.tips'); },
    proposedAddress() { return this.username + this.domainSuffix; },
    statusClass() {
      return this.availability === 'available' ? 'lnaddr-status-ok'
        : ['taken', 'invalid', 'error'].includes(this.availability) ? 'lnaddr-status-bad' : '';
    },
    statusText() {
      const messages = { checking: 'Checking availability', available: 'Available', taken: 'Taken. Try another name.',
        invalid: 'Use 3 to 32 lowercase letters or numbers', error: 'Could not check right now. Try again.', current: 'This is your current address.' };
      return messages[this.availability] ? this.$t(messages[this.availability]) : ' ';
    },
  },
  watch: {
    username(next) {
      const cleaned = String(next || '').toLowerCase();
      if (cleaned !== next) { this.invalidateCheck(); this.username = cleaned; return; }
      this.error = '';
      this.scheduleAvailabilityCheck();
    },
    modelValue(visible) { if (!visible) { this.invalidateCheck(); this.loadSeq += 1; } },
    walletId() { if (this.modelValue) this.onOpen(); },
  },
  beforeUnmount() { this.invalidateCheck(); this.loadSeq += 1; },
  methods: {
    invalidateCheck() { clearTimeout(this.checkTimer); this.checkSeq += 1; },
    close(value) { if (!this.busy) this.$emit('update:modelValue', value); },
    async onOpen() {
      this.invalidateCheck(); this.username = ''; this.availability = 'idle'; this.updated = false;
      await this.loadAddress();
    },
    async loadAddress() {
      const seq = ++this.loadSeq;
      this.phase = 'loading'; this.error = '';
      try {
        const info = await useWalletStore().refreshSparkLightningAddress(this.walletId);
        if (seq !== this.loadSeq) return;
        this.address = info?.lightningAddress || null;
        this.phase = this.username && this.proposedAddress !== this.address ? 'change' : this.address ? 'view' : 'change';
        if (this.phase === 'change') {
          this.scheduleAvailabilityCheck();
          this.$nextTick(() => this.$refs.usernameInput?.focus());
        }
      } catch {
        if (seq !== this.loadSeq) return;
        this.address = null; this.phase = 'error';
        this.error = this.$t('Could not verify the current address. Check your connection and try again.');
      }
    },
    onBack() {
      if (this.busy) return;
      this.invalidateCheck(); this.error = '';
      if (this.phase === 'review') { this.phase = 'change'; this.scheduleAvailabilityCheck(); return; }
      if (this.phase === 'change' && this.address) { this.phase = 'view'; return; }
      this.close(false);
    },
    enterChange() {
      this.phase = 'change'; this.username = ''; this.availability = 'idle'; this.error = '';
      this.$nextTick(() => this.$refs.usernameInput?.focus());
    },
    scheduleAvailabilityCheck() {
      this.invalidateCheck();
      const name = this.username;
      if (!name) { this.availability = 'idle'; return; }
      if (!USERNAME_RE.test(name)) { this.availability = 'invalid'; return; }
      if (this.proposedAddress === this.address) { this.availability = 'current'; return; }
      this.availability = 'checking';
      const seq = this.checkSeq;
      const walletId = this.walletId;
      this.checkTimer = setTimeout(async () => {
        try {
          const provider = useWalletStore().providers[walletId];
          const free = await provider.checkLightningAddressAvailable(name);
          if (seq !== this.checkSeq) return;
          this.availability = free ? 'available' : 'taken';
        } catch {
          if (seq === this.checkSeq) this.availability = 'error';
        }
      }, 400);
    },
    reviewUsername() {
      if (this.availability !== 'available' || this.busy) return;
      this.invalidateCheck(); this.error = ''; this.phase = 'review';
    },
    async submitUsername() {
      if (this.phase !== 'review' || this.busy) return;
      this.busy = true; this.error = '';
      const walletId = this.walletId;
      const seq = this.loadSeq;
      try {
        const info = await useWalletStore().renameSparkLightningAddress(walletId, this.username, { expectedAddress: this.address });
        if (seq !== this.loadSeq) return;
        this.address = info.lightningAddress; this.phase = 'view'; this.updated = true;
        this.$emit('changed', this.address);
      } catch (failure) {
        if (seq !== this.loadSeq) return;
        const messages = {
          LN_ADDRESS_UNCONFIRMED: 'The change could not be confirmed. Check the current address before sharing it or trying again.',
          LN_ADDRESS_RATE_LIMITED: 'Too many address changes. Wait before trying again.',
          LN_ADDRESS_TAKEN: 'Taken. Try another name.',
          LN_ADDRESS_BUSY: 'An address change is already in progress. Check the current address in a moment.',
          LN_ADDRESS_CHANGED: 'The current address changed. Check it and review your change again.',
        };
        this.error = this.$t(messages[failure?.code] || 'Could not update the address. Check the current address before trying again.');
        this.phase = 'error'; this.address = null;
      } finally { this.busy = false; }
    },
    async copyAddress() {
      if (!this.address) return;
      try {
        await navigator.clipboard.writeText(this.address);
        this.$q.notify({ type: 'positive', message: this.$t('Lightning address copied') });
      } catch { this.$q.notify({ type: 'negative', message: this.$t('Failed to copy') }); }
    },
  },
};
</script>

<style scoped>
.lnaddr-sheet {
  width: 100%;
  max-width: 560px;
  max-height: 92dvh;
  overflow-y: auto;
  border-radius: 20px 20px 0 0;
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}
.lnaddr-light {
  background: #ffffff;
  color: #1a1a1a;
}
.lnaddr-dark {
  background: #1e1e1e;
  color: #f0f0f0;
}

.lnaddr-grabber {
  display: flex;
  justify-content: center;
  padding-top: 8px;
}
.lnaddr-grabber-bar {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(128, 128, 128, 0.35);
}

.lnaddr-header {
  display: flex;
  align-items: center;
  padding: 8px 16px 4px;
}
.lnaddr-title {
  margin: 0;
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.2px;
}
.lnaddr-header-spacer {
  width: 44px; /* mirrors the back button so the title centers */
  flex-shrink: 0;
}

.lnaddr-body {
  padding: 20px 24px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.lnaddr-center {
  padding: 40px 24px;
  align-items: center;
}

.lnaddr-icon-tile {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}
.lnaddr-light .lnaddr-icon-tile {
  background: rgba(26, 26, 26, 0.06);
  color: #1a1a1a;
}
.lnaddr-dark .lnaddr-icon-tile {
  background: rgba(21, 222, 114, 0.12);
  color: #15de72;
}

.lnaddr-address {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
  margin-bottom: 10px;
}
.lnaddr-caption {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  opacity: 0.65;
  max-width: 300px;
}
.lnaddr-caption-lead {
  margin-bottom: 18px;
}

.lnaddr-field {
  display: flex;
  align-items: baseline;
  width: 100%;
  max-width: 320px;
  border-radius: 12px;
  padding: 12px 14px;
  transition: box-shadow 0.15s ease;
}
.lnaddr-light .lnaddr-field {
  background: rgba(26, 26, 26, 0.05);
}
.lnaddr-dark .lnaddr-field {
  background: rgba(255, 255, 255, 0.07);
}
.lnaddr-light .lnaddr-field-focus {
  box-shadow: 0 0 0 2px rgba(26, 26, 26, 0.35);
}
.lnaddr-dark .lnaddr-field-focus {
  box-shadow: 0 0 0 2px rgba(21, 222, 114, 0.5);
}
.lnaddr-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 16px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: right;
}
.lnaddr-suffix {
  font-size: 16px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  opacity: 0.55;
  white-space: nowrap;
}

.lnaddr-status {
  display: flex;
  align-items: center;
  min-height: 22px;
  margin-top: 10px;
  font-size: 12.5px;
  opacity: 0.75;
}
.lnaddr-status-ok {
  color: #187344;
  opacity: 1;
}
.lnaddr-dark .lnaddr-status-ok {
  color: #15de72;
}
.lnaddr-status-bad {
  color: #b83f3f;
  opacity: 1;
}

.lnaddr-cta-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 24px 4px;
}
.lnaddr-cta-primary {
  border-radius: 14px;
  height: 48px;
  font-size: 15px;
  font-weight: 600;
}
.lnaddr-light .lnaddr-cta-primary {
  background: #1a1a1a;
  color: #ffffff;
}
.lnaddr-dark .lnaddr-cta-primary {
  background: #15de72;
  color: #0c2417;
}
.lnaddr-cta-secondary {
  min-height: 44px;
  border-radius: 14px;
  font-size: 14px;
  opacity: 0.8;
}
.lnaddr-label { width: 100%; max-width: 320px; margin-bottom: 6px; font-size: 13px; text-align: start; }
.lnaddr-consequence { margin-top: 18px; padding: 14px 16px; border-radius: 14px; background: rgba(128, 128, 128, .1); text-align: start; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.lnaddr-consequence p { margin: 0; }
.lnaddr-consequence p + p { margin-top: 10px; }
.lnaddr-error { font-size: 13px; line-height: 1.5; margin: 12px 0 0; color: var(--color-negative); }
.lnaddr-center { gap: 12px; }
.lnaddr-suffix { flex-shrink: 0; }
.lnaddr-dark .lnaddr-status-bad { color: #ff8a8a; }
.lnaddr-header .glass-back-btn { width: 44px; height: 44px; min-height: 44px; }
</style>
