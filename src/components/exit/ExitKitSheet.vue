<template>
  <q-dialog v-model="open" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'" @hide="$emit('hide')">
    <q-card class="identity-surface exit-kit-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-grab" aria-hidden="true"><span></span></div>
      <div class="sheet-head">
        <div class="sheet-title">{{ $t('Emergency exit kit') }}</div>
        <q-btn flat round class="sheet-close" :aria-label="$t('Close')" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>
      <div class="sheet-body exit-kit-body">
        <IdentityGroup v-for="entry in sparkWallets" :key="entry.id" :title="entry.name || $t('Bitcoin')">
          <IdentityRow
            :label="stateLabel(entry)"
            :caption="stateCaption(entry)"
            :icon="stateIcon(entry)"
            :tone="stateTone(entry)"
            :interactive="false"
            :chevron="false"
            wrap
          />
          <IdentityRow
            v-if="copiesText(entry)"
            :label="$t('Copies')"
            :caption="copiesText(entry)"
            :interactive="false"
            :chevron="false"
            wrap
          />
          <IdentityRow
            v-if="needsDriveCopy(entry)"
            :label="$t('Add a copy to Google Drive')"
            :caption="hasDriveCopy(entry) ? $t('The Google Drive copy is older than the kit.') : $t('So the kit survives a lost phone')"
            icon="tabler:cloud-upload"
            wrap
            @click="$emit('cloud')"
          />
          <IdentityRow
            :label="$t('Share exit kit')"
            :caption="hasKit(entry) ? '' : $t('No kit saved yet')"
            icon="tabler:share"
            :interactive="hasKit(entry)"
            :chevron="false"
            @click="share(entry)"
          />
          <IdentityRow
            :label="refreshing(entry) ? $t('Refreshing') : $t('Refresh kit')"
            :caption="connected(entry) ? '' : $t('Switch to this wallet on the home screen to connect it.')"
            icon="tabler:refresh"
            :interactive="connected(entry) && !refreshing(entry)"
            :chevron="false"
            wrap
            @click="refresh(entry)"
          />
          <IdentityRow
            :label="$t('Emergency exit')"
            :caption="$t('Move this wallet\'s money to plain Bitcoin without Spark\'s help.')"
            icon="tabler:lifebuoy"
            tone="accent"
            wrap
            @click="openExit(entry)"
          />
        </IdentityGroup>
        <p class="exit-kit-footer">{{ $t('The kit is what lets this wallet\'s money move to plain Bitcoin without Spark. It refreshes after each payment, is encrypted, and travels with the Google Drive backup. Recovery words alone cannot do this.') }}</p>
        <button type="button" class="btn-quiet" @click="$emit('how')">{{ $t('How the emergency exit works') }}</button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import IdentityGroup from '../identity/IdentityGroup.vue';
import IdentityRow from '../identity/IdentityRow.vue';
import { useWalletStore } from '../../stores/wallet';
import { useExitKitStore } from '../../stores/exitKit';
import { exitKitService } from '../../services/exitKit.js';
import { kitState, kitCopies } from '../../utils/exitKit.js';
import { formatSats, relativeDay } from '../../composables/useExitFormat.js';
import { WALLET_TYPES } from '../../providers/WalletFactory';
import { isCloudBackupPlatform } from '../../services/cloudStorage.js';

/**
 * The receipt: per Spark wallet, when the kit was last checked, what could
 * leave, where copies live, and the door to the exit itself. Opened from
 * Settings → Advanced; it changes nothing on its own.
 */
export default {
  name: 'ExitKitSheet',
  components: { Icon, IdentityGroup, IdentityRow },
  props: { modelValue: { type: Boolean, required: true } },
  emits: ['update:modelValue', 'how', 'cloud', 'hide'],
  setup() {
    return { wallet: useWalletStore(), kits: useExitKitStore(), cloudAvailable: isCloudBackupPlatform() };
  },
  computed: {
    open: {
      get() { return this.modelValue; },
      set(value) { this.$emit('update:modelValue', value); },
    },
    sparkWallets() {
      return this.wallet.wallets.filter(w => w.type === WALLET_TYPES.SPARK);
    },
  },
  methods: {
    meta(entry) { return this.kits.kitFor(entry.id); },
    hasKit(entry) { return !!this.meta(entry)?.exportedAt; },
    connected(entry) { return !!this.wallet.getSparkProvider(entry.id)?.isConnected; },
    refreshing(entry) { return this.kits.isRefreshing(entry.id); },
    day(timestamp) { return relativeDay(timestamp, (key, params) => this.$t(key, params), this.$i18n.locale); },
    stateLabel(entry) {
      const meta = this.meta(entry);
      switch (kitState(meta)) {
        case 'failed': return this.$t('Exit kit needs a refresh');
        case 'checked':
        case 'saved': {
          const at = meta.checkedAt || meta.exportedAt;
          const day = this.day(at);
          return day === this.$t('today') ? this.$t('Checked today') : this.$t('Checked {date}', { date: day });
        }
        default: return this.$t('Exit kit not checked yet');
      }
    },
    stateCaption(entry) {
      const meta = this.meta(entry);
      const state = kitState(meta);
      if (state === 'failed') {
        const reason = meta.lastError ? ` (${String(meta.lastError).slice(0, 80)})` : '';
        return this.$t('Could not refresh since {date}. Payments after that date are not covered yet.', { date: this.day(meta.failedSince) }) + reason;
      }
      if (state === 'checked') return this.$t('{amount} sats could leave without Spark', { amount: formatSats(meta.recoverableSat, this.$i18n.locale) });
      if (state === 'none' && !this.connected(entry)) return this.$t('Switch to this wallet on the home screen to connect it.');
      return '';
    },
    hasDriveCopy(entry) { return !!this.meta(entry)?.driveAt; },
    needsDriveCopy(entry) {
      const meta = this.meta(entry);
      return this.cloudAvailable && !!meta?.exportedAt && (!meta.driveAt || meta.driveAt < meta.exportedAt);
    },
    stateIcon(entry) { return kitState(this.meta(entry)) === 'failed' ? 'tabler:alert-triangle' : 'tabler:shield-check'; },
    stateTone(entry) {
      const state = kitState(this.meta(entry));
      return state === 'failed' ? 'warn' : state === 'checked' ? 'accent' : 'neutral';
    },
    copiesText(entry) {
      const meta = this.meta(entry);
      const copies = kitCopies(meta);
      if (!copies.length) return '';
      if (copies.length === 1 && copies[0] === 'phone') return this.$t('This phone only');
      const labels = {
        phone: this.$t('This phone'),
        drive: this.$t('Google Drive {date}', { date: this.day(meta.driveAt) }),
        file: this.$t('Shared file {date}', { date: this.day(meta.sharedAt) }),
      };
      return copies.map(copy => labels[copy]).join(' \u00b7 ');
    },
    async share(entry) {
      try {
        const result = await exitKitService().share(entry.id);
        if (result?.saved) this.$q.notify({ type: 'positive', message: this.$t('Kit shared') });
      } catch (error) {
        this.$q.notify({ type: 'negative', message: this.$t('Could not share the kit') });
      }
    },
    async refresh(entry) {
      const result = await exitKitService().refresh(entry.id, { force: true, reason: 'manual' });
      this.$q.notify(result.ok
        ? { type: 'positive', message: this.$t('Kit refreshed') }
        : { type: 'negative', message: this.$t('Could not refresh the kit') });
    },
    openExit(entry) {
      this.open = false;
      this.$router.push(`/security/exit/${entry.id}`);
    },
  },
};
</script>

<style scoped>
.exit-kit-body { display: flex; flex-direction: column; gap: 16px; }
.exit-kit-footer { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
</style>
