<template>
  <div class="backup-coverage" :class="{ 'is-interactive': interactive }" :role="interactive ? 'tablist' : undefined" :aria-label="$t('Backups')">
    <component :is="interactive ? 'button' : 'div'" v-for="item in items" :key="item.id"
      :type="interactive ? 'button' : undefined" class="backup-coverage-item"
      :class="{ 'is-selected': selected === item.id }"
      :role="interactive ? 'tab' : undefined" :id="interactive ? `backup-tab-${item.id}` : undefined"
      :aria-selected="interactive ? selected === item.id : undefined" :aria-controls="interactive ? `backup-panel-${item.id}` : undefined"
      :tabindex="interactive ? (selected === item.id ? 0 : -1) : undefined"
      @click="interactive && $emit('select', item.id)" @keydown="onKeydown($event, item.id)">
      <BackupSubjectIcon :kind="item.id" :size="22" />
      <span class="backup-coverage-copy">
        <strong>{{ $t(item.label) }}</strong>
        <span class="backup-coverage-state">
          <Icon v-if="item.done" icon="tabler:check" width="14" height="14" aria-hidden="true" />
          {{ $t(item.state) }}
        </span>
      </span>
    </component>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { useIdentityStore } from '../stores/identity';
import { walletBackupGroups } from '../utils/backupStatus.js';
import BackupSubjectIcon from './BackupSubjectIcon.vue';
const props = defineProps({ selected: { type: String, default: '' }, interactive: Boolean });
const emit = defineEmits(['select']);
function onKeydown(event, id) {
  if (!props.interactive || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'wallet' : event.key === 'End' ? 'identity' : id === 'wallet' ? 'identity' : 'wallet';
  emit('select', next);
  event.currentTarget.parentElement.querySelector(`#backup-tab-${next}`)?.focus();
}
const wallet = useWalletStore();
const identity = useIdentityStore();
const items = computed(() => {
  const groups = walletBackupGroups(wallet.wallets, wallet.hasBackedUp);
  const walletDone = groups.length > 0 && groups.every(group => group.saved);
  return [
    { id: 'wallet', label: 'Bitcoin', done: walletDone, state: !groups.length ? (wallet.wallets.length ? 'Provider recovery' : 'Not set up') : walletDone ? 'Words checked' : 'Not checked yet' },
    { id: 'identity', label: 'Identity', done: identity.backupConfirmed, state: !identity.bootstrapped ? 'Not set up' : identity.backupConfirmed ? 'Words checked' : 'Not checked yet' },
  ];
});
</script>

<style scoped>
.backup-coverage { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 20px 0 28px; }
.backup-coverage-item { display: flex; align-items: flex-start; gap: 9px; min-width: 0; padding: 6px 0; color: var(--text-secondary); }
.backup-coverage-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.backup-coverage-item strong { font-size: 14px; line-height: 1.4; font-weight: 600; color: var(--text-primary); }
.backup-coverage-item.is-selected > .backup-subject-icon { color: var(--brand-accent-text); }
.backup-coverage-state { display: flex; align-items: baseline; gap: 4px; font-size: 12px; line-height: 1.4; color: var(--text-secondary); }
.backup-coverage-state svg { color: var(--brand-accent-text); flex-shrink: 0; align-self: center; }
.backup-coverage.is-interactive { gap: 4px; padding: 4px; background: var(--bg-input); border-radius: 16px; }
.is-interactive .backup-coverage-item { align-items: center; justify-content: center; min-height: 64px; padding: 10px 8px; font: inherit; border: 0; border-radius: 12px; background: transparent; cursor: pointer; }
.is-interactive .backup-coverage-item.is-selected { background: var(--bg-card); box-shadow: 0 2px 6px #00000012; }
.is-interactive .backup-coverage-item.is-selected strong { font-weight: 750; }
.is-interactive .backup-coverage-item:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: 2px; }
</style>
