<template>
  <section class="wallet-detail-panel" :class="{ 'wallet-detail-panel--dark': $q.dark.isActive }"
    @keydown.esc.stop.prevent @keyup.esc.stop.prevent="goBack">
    <header class="detail-header">
      <button ref="backButton" type="button" class="detail-icon-button" :aria-label="$t('Back')" :disabled="saving" @click="goBack">
        <Icon icon="tabler:chevron-left" width="22" height="22" :aria-hidden="true" />
      </button>
      <span>{{ $t('Wallet') }}</span>
      <span class="header-spacer" aria-hidden="true" />
    </header>

    <div class="detail-content">
      <div class="detail-identity">
        <div class="detail-avatar" :class="{ 'detail-avatar--arkade': wallet.type === 'arkade' }" aria-hidden="true"><WalletBrandMark :type="wallet.type" :size="28" /></div>
        <div class="detail-identity-copy">
          <h2>{{ wallet.name }}</h2>
          <div class="detail-status">
            <span>{{ typeLabel }}</span>
            <span aria-hidden="true">·</span>
            <span class="connection-status"><span class="connection-dot" :class="{ 'connection-dot--online': connected }" aria-hidden="true" />{{ connected ? $t('Online') : $t('Offline') }}</span>
          </div>
        </div>
        <button v-if="!editing" ref="editButton" type="button" class="detail-icon-button detail-edit" :aria-label="$t('Rename wallet')" @click="startEditing">
          <Icon icon="tabler:pencil" width="20" height="20" :aria-hidden="true" />
        </button>
      </div>

      <form v-if="editing" class="detail-rename" @submit.prevent="saveName">
        <label for="wallet-detail-name">{{ $t('Wallet Name') }}</label>
        <input id="wallet-detail-name" ref="nameInput" v-model="nameDraft" name="wallet-name" autocomplete="off"
          :maxlength="maxNameLength" enterkeyhint="done"
          :disabled="saving" :aria-invalid="!!nameError" :aria-describedby="nameError ? 'wallet-name-error' : undefined" />
        <p v-if="nameError" id="wallet-name-error" class="detail-error" role="alert">{{ nameError }}</p>
        <div class="rename-actions">
          <button type="button" class="detail-button detail-secondary" :disabled="saving" @click="cancelEditing">{{ $t('Cancel') }}</button>
          <button type="submit" class="detail-button detail-primary" :disabled="saving">
            <q-spinner v-if="saving" size="18px" :aria-hidden="true" />{{ $t('Save') }}
          </button>
        </div>
      </form>

      <div class="detail-balance-card">
        <div class="detail-balance-heading">
          <span>{{ $t('Balance') }}</span>
          <span v-if="active" class="detail-active"><Icon icon="tabler:check" width="14" height="14" :aria-hidden="true" />{{ $t('Active') }}</span>
        </div>
        <div class="detail-balance">
          <!-- Never a stand-in number or dash: a placeholder until the first figure arrives. -->
          <span v-if="!balanceKnown" v-balance-updating="balanceRefreshing" class="balance-placeholder" role="img" :aria-label="$t('Balance not loaded yet')" />
          <HiddenAmount v-else :class="{ 'balance-stale': balanceOutdated }">{{ balance }}</HiddenAmount>
        </div>
        <HiddenAmount v-if="balanceKnown && fiat" class="detail-fiat" :class="{ 'balance-stale': balanceOutdated }">{{ fiat }}</HiddenAmount>
      </div>

      <p v-if="connectionError" class="detail-error detail-connection-error" role="status">{{ connectionError }}</p>

      <!-- Spark: the wallet's own Lightning address. Each Spark wallet has one;
           it can be changed here or handed to another of your wallets. -->
      <section v-if="wallet.type === 'spark'" class="detail-group" :aria-label="$t('Lightning Address')">
        <div class="detail-group-row">
          <span class="detail-group-copy">
            <span class="detail-group-label">{{ $t('Lightning Address') }}</span>
            <span class="detail-group-value" :class="{ 'is-placeholder': !lightningAddress }">{{ lightningAddress || $t('Assigned when the wallet connects') }}</span>
          </span>
          <button v-if="lightningAddress" type="button" class="detail-icon-button" :aria-label="$t('Copy address')" @click="$emit('copy-address', lightningAddress)">
            <Icon icon="tabler:copy" width="18" height="18" :aria-hidden="true" />
          </button>
        </div>
        <button type="button" class="detail-group-action" :disabled="!connected" @click="$emit('change-address', wallet.id)">
          {{ $t('Change address') }}
        </button>
        <button v-if="canMoveAddress" type="button" class="detail-group-action" :disabled="!connected || !lightningAddress" @click="$emit('move-address', wallet.id)">
          {{ $t('Move to another wallet') }}
        </button>
        <p v-if="!connected" class="detail-group-note">{{ $t('Available once this wallet is connected.') }}</p>
        <p v-else-if="canMoveAddress && !lightningAddress" class="detail-group-note">{{ $t('This wallet has no address to move right now.') }}</p>
      </section>

      <div v-if="!active || canReconnect" class="detail-actions">
        <button v-if="!active" type="button" class="detail-button detail-primary" :disabled="switching || reconnecting || saving" @click="$emit('switch', wallet.id)">
          <q-spinner v-if="switching" size="20px" :aria-hidden="true" />
          <Icon icon="tabler:circle-check" width="20" height="20" v-else :aria-hidden="true" />
          {{ $t('Use this wallet') }}
        </button>
        <button v-if="canReconnect" type="button" class="detail-button detail-secondary" :disabled="reconnecting || switching || saving" @click="$emit('reconnect', wallet.id)">
          <q-spinner v-if="reconnecting" size="20px" :aria-hidden="true" />
          <Icon icon="tabler:refresh" width="20" height="20" v-else :aria-hidden="true" />
          {{ reconnecting ? $t('Reconnecting...') : $t('Reconnect') }}
        </button>
      </div>

      <div class="detail-danger-section">
        <button type="button" class="detail-button detail-danger" :disabled="saving || switching || reconnecting" @click="$emit('remove', wallet.id)">
          <Icon icon="tabler:trash" width="20" height="20" :aria-hidden="true" />{{ $t('Remove Wallet') }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import WalletBrandMark from '../WalletBrandMark.vue';
import HiddenAmount from '../HiddenAmount.vue';
import balanceUpdating from '../../directives/balanceUpdating.js';
import { MAX_WALLET_NAME_LENGTH, walletNameCopy } from '../../utils/walletNames.js';

const vBalanceUpdating = balanceUpdating;

const props = defineProps({
  wallet: { type: Object, required: true },
  typeLabel: { type: String, required: true },
  balance: { type: String, required: true },
  /** False until the wallet has a first balance figure. */
  balanceKnown: { type: Boolean, default: true },
  /** The figure is known to be out of date (its last refresh failed): dimmed. */
  balanceOutdated: { type: Boolean, default: false },
  /** A refresh is under way: the placeholder pulses until the first figure. */
  balanceRefreshing: { type: Boolean, default: false },
  /** The balance in the person's fiat currency ('' while no rate is known). */
  fiat: { type: String, default: '' },
  active: Boolean,
  connected: Boolean,
  switching: Boolean,
  reconnecting: Boolean,
  connectionError: { type: String, default: '' },
  renameWallet: { type: Function, required: true },
  /** Spark only: the wallet's Lightning address, when it has one. */
  lightningAddress: { type: String, default: '' },
  /** Spark only: another Spark wallet exists to hand the address to. */
  canMoveAddress: Boolean,
});
const emit = defineEmits(['back', 'switch', 'reconnect', 'remove', 'copy-address', 'change-address', 'move-address']);
// vue-i18n runs in legacy mode (src/boot/i18n.js), so useI18n() throws.
// Reach $t through the component proxy, the app's established pattern.
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const maxNameLength = MAX_WALLET_NAME_LENGTH;
const backButton = ref(null), editButton = ref(null), nameInput = ref(null);
const editing = ref(false), saving = ref(false), nameDraft = ref(''), nameError = ref('');
// Every wallet that is offline can be reconnected from here (all Spark
// wallets stay live, so none of them needs to be selected first).
const canReconnect = computed(() => !props.connected);

async function startEditing() {
  nameDraft.value = props.wallet.name;
  nameError.value = '';
  editing.value = true;
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.select();
}
async function cancelEditing() {
  editing.value = false;
  nameError.value = '';
  await nextTick();
  editButton.value?.focus();
}
async function saveName() {
  if (saving.value) return;
  const name = nameDraft.value.trim();
  if (!name) { nameError.value = walletNameCopy('empty', t); nameInput.value?.focus(); return; }
  saving.value = true;
  nameError.value = '';
  try {
    if (name !== props.wallet.name) await props.renameWallet(props.wallet.id, name);
    await cancelEditing();
  } catch (error) {
    // The store's own rules (length, unique) come back as a problem code.
    nameError.value = error?.problem ? walletNameCopy(error.problem, t) : t("Couldn't save wallet name");
    nameInput.value?.focus();
  } finally {
    saving.value = false;
  }
}
function goBack() {
  if (saving.value) return;
  if (editing.value) void cancelEditing();
  else emit('back');
}
onMounted(() => backButton.value?.focus({ preventScroll: true }));
</script>

<style scoped>
.wallet-detail-panel { --detail-surface: #fffdf8; --detail-line: #ddd8cb; --detail-secondary: #5f5b52; --detail-active: #006b50; --detail-active-bg: #e1f2e8; --detail-danger: var(--color-negative); display: flex; flex-direction: column; min-height: 0; color: var(--text-primary); background: var(--bg-card); }
.wallet-detail-panel--dark { --detail-surface: #272729; --detail-line: #444447; --detail-secondary: #b9b9c0; --detail-active: #80e8b6; --detail-active-bg: #204432; }
.detail-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; padding: 12px 16px 8px; font-size: 1rem; font-weight: 600; }
.header-spacer { width: 44px; }
.detail-icon-button { width: 44px; min-width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 50%; color: inherit; background: transparent; cursor: pointer; }
.detail-content { padding: 12px 20px max(20px, var(--safe-bottom, 0px)); overflow-y: auto; min-height: 0; }
.detail-identity { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
.detail-avatar { flex: 0 0 52px; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; border-radius: 16px; background: #252527; }
/* Arkade's purple mark needs a light tile on cream (brand rule). */
body.body--light .detail-avatar--arkade { background: var(--arkade-tile); box-shadow: inset 0 0 0 1px var(--arkade-tint-border); }
.detail-identity-copy { flex: 1; min-width: 0; }
.detail-identity h2 { margin: 0; font-size: 1.375rem; font-weight: 700; line-height: 1.3; letter-spacing: -.02em; overflow-wrap: anywhere; }
.detail-status { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--detail-secondary); font-size: .8125rem; margin-top: 5px; }
.connection-status { display: inline-flex; align-items: center; gap: 5px; }
.connection-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--detail-secondary); }
.connection-dot--online { background: var(--detail-active); }
.detail-edit { color: var(--detail-secondary); }
.detail-balance-card { padding: 16px; background: var(--detail-surface); border: 1px solid var(--detail-line); border-radius: 16px; }
.detail-balance-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; color: var(--detail-secondary); font-size: .8125rem; font-weight: 500; }
.detail-active { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 20px; color: var(--detail-active); background: var(--detail-active-bg); font-size: .75rem; font-weight: 600; }
.detail-balance { font-size: clamp(1.5rem, 7vw, 2rem); font-weight: 700; line-height: 1.3; letter-spacing: -.025em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; margin-top: 8px; }
.detail-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
.detail-button { display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 48px; border-radius: 14px; border: 1px solid transparent; padding: 12px 16px; font: 600 .9375rem/1.4 'Manrope', sans-serif; color: inherit; cursor: pointer; }
.detail-button > svg, .detail-button > .q-icon { flex-shrink: 0; }
.detail-primary { background: var(--btn-primary-bg); color: var(--btn-primary-fg); }
.detail-secondary { background: var(--detail-surface); border-color: var(--detail-line); }
.detail-danger-section { border-top: 1px solid var(--detail-line); padding-top: 16px; margin-top: 24px; }
.detail-danger { background: transparent; color: var(--detail-danger); justify-content: flex-start; font-weight: 500; }
button:focus-visible, input:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
button:disabled { opacity: .5; cursor: default; }
button:not(:disabled):active { filter: brightness(.9); }
.detail-icon-button:not(:disabled):hover, .detail-danger:not(:disabled):hover { background: #8882; }
.detail-rename { margin: -4px 0 24px; }
.detail-rename label { display: block; color: var(--detail-secondary); font-size: .8125rem; font-weight: 500; margin-bottom: 8px; }
.detail-rename input { display: block; width: 100%; min-height: 48px; padding: 10px 12px; border: 1px solid var(--detail-line); border-radius: 12px; background: var(--detail-surface); color: inherit; font: inherit; font-size: 1rem; }
.rename-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.detail-error { color: var(--detail-danger); font-size: .8125rem; line-height: 1.5; margin: 8px 0 0; overflow-wrap: anywhere; }
.detail-connection-error { margin-top: 16px; }
.detail-fiat { display: block; margin-top: 2px; color: var(--detail-secondary); font-size: .9375rem; font-variant-numeric: tabular-nums; }
.detail-group { margin-top: 20px; border: 1px solid var(--detail-line); border-radius: 16px; background: var(--detail-surface); overflow: hidden; }
.detail-group-row { display: flex; align-items: center; gap: 8px; padding: 12px 8px 12px 16px; }
.detail-group-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; }
.detail-group-label { color: var(--detail-secondary); font-size: .8125rem; font-weight: 500; }
.detail-group-value { font-family: var(--font-mono, monospace); font-size: .875rem; overflow-wrap: anywhere; }
.detail-group-value.is-placeholder { font-family: inherit; color: var(--detail-secondary); }
.detail-group-action { display: block; width: 100%; min-height: 48px; padding: 12px 16px; border: 0; border-top: 1px solid var(--detail-line); background: transparent; color: inherit; font: 500 .9375rem/1.4 'Manrope', sans-serif; text-align: start; cursor: pointer; }
.detail-group-note { margin: 0; padding: 0 16px 12px; color: var(--detail-secondary); font-size: .8125rem; line-height: 1.45; }
@media (max-width: 360px) {
  .detail-identity { display: grid; grid-template-columns: 1fr 44px; gap: 12px; }
  .detail-avatar { grid-column: 1; grid-row: 1; }
  .detail-edit { grid-column: 2; grid-row: 1; }
  .detail-identity-copy { grid-column: 1 / -1; grid-row: 2; }
}
</style>
