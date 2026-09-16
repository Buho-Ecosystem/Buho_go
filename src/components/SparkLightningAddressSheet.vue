<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    transition-show="slide-up"
    transition-hide="slide-down"
    @update:model-value="$emit('update:modelValue', $event)"
    @show="onOpen"
  >
    <q-card class="lnaddr-sheet" :class="$q.dark.isActive ? 'lnaddr-dark' : 'lnaddr-light'">
      <div class="lnaddr-grabber" aria-hidden="true"><div class="lnaddr-grabber-bar"></div></div>

      <div class="lnaddr-header">
        <q-btn
          flat round dense
          class="glass-back-btn"
          :aria-label="$t('Back')"
          @click="onBack"
        >
          <Icon icon="tabler:chevron-left" width="20" height="20" />
        </q-btn>
        <div class="lnaddr-title">{{ $t('Lightning Address') }}</div>
        <div class="lnaddr-header-spacer" aria-hidden="true"></div>
      </div>

      <!-- Loading current state -->
      <div v-if="phase === 'loading'" class="lnaddr-body lnaddr-center">
        <q-spinner size="28px" />
      </div>

      <!-- Address held: show + copy + change -->
      <template v-else-if="phase === 'view'">
        <div class="lnaddr-body">
          <div class="lnaddr-icon-tile">
            <Icon icon="tabler:at" width="26" height="26" />
          </div>
          <div class="lnaddr-address">{{ address }}</div>
          <div class="lnaddr-caption">
            {{ $t('Payments sent to this address arrive in this wallet. It stays yours after reinstalling or restoring from your recovery phrase.') }}
          </div>
        </div>

        <div class="lnaddr-cta-row">
          <q-btn
            unelevated no-caps
            class="lnaddr-cta-primary"
            :label="$t('Copy address')"
            @click="copyAddress"
          />
          <q-btn
            flat no-caps
            class="lnaddr-cta-secondary"
            :label="$t('Change address')"
            @click="enterChange"
          />
        </div>
      </template>

      <!-- Pick a new name (also the first claim when none exists yet) -->
      <template v-else>
        <div class="lnaddr-body">
          <div class="lnaddr-icon-tile">
            <Icon icon="tabler:at" width="26" height="26" />
          </div>
          <div class="lnaddr-caption lnaddr-caption-lead">
            <template v-if="address">
              {{ $t('Pick a new name. Your current name stays reserved for this wallet.') }}
            </template>
            <template v-else>
              {{ $t('Pick a name. Payments sent to it arrive in this wallet.') }}
            </template>
          </div>

          <div class="lnaddr-field" :class="{ 'lnaddr-field-focus': fieldFocused }">
            <input
              ref="usernameInput"
              v-model="username"
              class="lnaddr-input"
              type="text"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              inputmode="text"
              :placeholder="$t('name')"
              maxlength="32"
              @focus="fieldFocused = true"
              @blur="fieldFocused = false"
            />
            <span class="lnaddr-suffix">{{ domainSuffix }}</span>
          </div>

          <div class="lnaddr-status" :class="statusClass">
            <q-spinner v-if="availability === 'checking'" size="12px" class="q-mr-xs" />
            <Icon v-else-if="availability === 'available'" icon="tabler:circle-check" width="14" height="14" class="q-mr-xs" />
            <Icon v-else-if="availability === 'taken' || availability === 'invalid'" icon="tabler:circle-x" width="14" height="14" class="q-mr-xs" />
            <span>{{ statusText }}</span>
          </div>
        </div>

        <div class="lnaddr-cta-row">
          <q-btn
            unelevated no-caps
            class="lnaddr-cta-primary"
            :label="address ? $t('Use this name') : $t('Claim address')"
            :disable="availability !== 'available'"
            :loading="busy"
            @click="submitUsername"
          />
        </div>
      </template>
    </q-card>
  </q-dialog>
</template>

<script>
/**
 * Bottom sheet for a Spark wallet's Lightning address (user@<domain>).
 * Wallets receive a random address automatically at creation; this sheet
 * shows it and lets the user replace it.
 *
 * There is deliberately no remove action - the rule is that every wallet
 * holds an address. Changing is a single register call: the server keys a
 * registration by (domain, pubkey), so claiming a new name atomically
 * replaces the old one AND reserves the old name to this wallet, which can
 * therefore take it back later. A failed change leaves the current address
 * untouched - nothing to roll back.
 *
 * The server is the authority on username rules; the client pre-validates
 * lowercase a-z0-9 (3-32 chars) and surfaces the server's verdict through
 * a debounced availability check.
 */
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { BREEZ_LNURL_DOMAIN } from '../config/breez';

const USERNAME_RE = /^[a-z0-9]{3,32}$/;

export default {
  name: 'SparkLightningAddressSheet',
  components: { Icon },
  props: {
    modelValue: { type: Boolean, default: false },
    walletId: { type: String, required: true },
  },
  emits: ['update:modelValue', 'changed'],
  data() {
    return {
      phase: 'loading', // 'loading' | 'view' | 'change'
      address: null,
      username: '',
      availability: 'idle', // 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error'
      busy: false,
      fieldFocused: false,
      _checkTimer: null,
      _checkSeq: 0,
    };
  },
  computed: {
    domainSuffix() {
      return '@' + (BREEZ_LNURL_DOMAIN || 'breez.tips');
    },
    statusClass() {
      if (this.availability === 'available') return 'lnaddr-status-ok';
      if (this.availability === 'taken' || this.availability === 'invalid' || this.availability === 'error') return 'lnaddr-status-bad';
      return '';
    },
    statusText() {
      switch (this.availability) {
        case 'checking': return this.$t('Checking availability');
        case 'available': return this.$t('Available');
        case 'taken': return this.$t('Taken. Try another name.');
        case 'invalid': return this.$t('Use 3 to 32 lowercase letters or numbers');
        case 'error': return this.$t('Could not check right now. Try again.');
        default: return ' ';
      }
    },
  },
  watch: {
    username(next) {
      const cleaned = String(next || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleaned !== next) {
        this.username = cleaned;
        return; // watcher re-fires with the cleaned value
      }
      this.scheduleAvailabilityCheck();
    },
  },
  beforeUnmount() {
    if (this._checkTimer) clearTimeout(this._checkTimer);
  },
  methods: {
    _provider() {
      const store = useWalletStore();
      return store.providers[this.walletId] || null;
    },
    async onOpen() {
      this.phase = 'loading';
      this.username = '';
      this.availability = 'idle';
      try {
        const provider = this._provider();
        const info = provider?.getLightningAddress ? await provider.getLightningAddress() : null;
        this.address = info?.lightningAddress || null;
      } catch (e) {
        this.address = null;
      }
      // Addresses are auto-assigned, so 'view' is the normal case; the
      // change form doubles as the manual claim when auto-assign failed.
      this.phase = this.address ? 'view' : 'change';
      if (this.phase === 'change') {
        this.$nextTick(() => this.$refs.usernameInput?.focus());
      }
    },
    onBack() {
      // From the change form, back returns to the address view when there
      // is one; everywhere else the sheet closes.
      if (this.phase === 'change' && this.address) {
        this.phase = 'view';
        this.username = '';
        this.availability = 'idle';
        return;
      }
      this.$emit('update:modelValue', false);
    },
    enterChange() {
      this.phase = 'change';
      this.username = '';
      this.availability = 'idle';
      this.$nextTick(() => this.$refs.usernameInput?.focus());
    },
    scheduleAvailabilityCheck() {
      if (this._checkTimer) clearTimeout(this._checkTimer);
      const name = this.username;
      if (!name) {
        this.availability = 'idle';
        return;
      }
      if (!USERNAME_RE.test(name)) {
        this.availability = 'invalid';
        return;
      }
      this.availability = 'checking';
      const seq = ++this._checkSeq;
      this._checkTimer = setTimeout(async () => {
        try {
          const provider = this._provider();
          const free = await provider.checkLightningAddressAvailable(name);
          if (seq !== this._checkSeq) return; // stale response
          this.availability = free ? 'available' : 'taken';
        } catch (e) {
          if (seq !== this._checkSeq) return;
          this.availability = 'error';
        }
      }, 400);
    },
    async submitUsername() {
      if (this.availability !== 'available' || this.busy) return;
      const firstClaim = !this.address;
      this.busy = true;
      try {
        const provider = this._provider();
        const info = await provider.registerLightningAddress(this.username);
        const address = info?.lightningAddress || `${this.username}${this.domainSuffix}`;
        this.address = address;
        this.phase = 'view';
        const store = useWalletStore();
        await store.setSparkLightningAddress(this.walletId, address);
        this.$emit('changed', address);
        this.$q.notify({
          type: 'positive',
          message: firstClaim ? this.$t('Lightning address ready') : this.$t('Lightning address updated'),
        });
      } catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        this.$q.notify({
          type: 'negative',
          message: msg.includes('taken') || msg.includes('exists') || msg.includes('unavailable') || msg.includes('in use')
            ? this.$t('Taken. Try another name.')
            : this.$t('Could not claim the address. Try again.'),
        });
        this.scheduleAvailabilityCheck();
      } finally {
        this.busy = false;
      }
    },
    async copyAddress() {
      if (!this.address) return;
      try {
        await navigator.clipboard.writeText(this.address);
        this.$q.notify({ type: 'positive', message: this.$t('Lightning address copied') });
      } catch (e) {
        this.$q.notify({ type: 'negative', message: this.$t('Failed to copy') });
      }
    },
  },
};
</script>

<style scoped>
.lnaddr-sheet {
  width: 100%;
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
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.2px;
}
.lnaddr-header-spacer {
  width: 32px; /* mirrors the glass back button so the title centers */
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
  word-break: break-all;
  margin-bottom: 10px;
}
.lnaddr-caption {
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
  color: #15a35b;
  opacity: 1;
}
.lnaddr-dark .lnaddr-status-ok {
  color: #15de72;
}
.lnaddr-status-bad {
  color: #d84c4c;
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
  height: 40px;
  font-size: 14px;
  opacity: 0.8;
}
</style>
