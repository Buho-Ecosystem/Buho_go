<!--
  WalletSwitcherSheet: the home screen's wallet switcher, for every wallet
  type alike (Spark wallets are ordinary rows, however many there are).

  The sheet switches; Settings configures. Rows show each wallet's last
  known balance (live for Spark, which stays connected), a placeholder for
  one never loaded, and the total across wallets when there is more than
  one. Opening the sheet asks the page to refresh every row; a row pulses
  only while waiting for its first figure, the total while any row refreshes.
-->
<template>
  <q-dialog
    v-model="open"
    position="bottom"
    transition-show="slide-up"
    transition-hide="slide-down"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="wallet-switcher-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-grabber" aria-hidden="true"><div class="grabber-bar"></div></div>
      <q-card-section class="switcher-header">
        <div class="switcher-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
          {{ $t('Switch Wallet') }}
        </div>
        <!-- With several wallets, the one figure people look for first. While
             wallets refresh it pulses; built on missing figures it reads "at
             least" and is dimmed, like every other balance. -->
        <div v-if="wallets.length > 1" class="switcher-total">
          <span class="switcher-total-label">{{ $t('Total') }}</span>
          <HiddenAmount
            v-balance-updating="anyRefreshing"
            class="switcher-total-value"
            :class="{ 'balance-stale': totalInfo.outdated }"
          >{{ totalInfo.complete ? '' : '≥ ' }}{{ formatBalance(totalInfo.total) }}</HiddenAmount>
          <HiddenAmount v-if="fiatOf(totalInfo.total)" class="switcher-total-fiat" :class="{ 'balance-stale': totalInfo.outdated }">{{ totalInfo.complete ? '' : '≥ ' }}{{ fiatOf(totalInfo.total) }}</HiddenAmount>
        </div>
      </q-card-section>

      <q-card-section class="switcher-content">
        <div class="wallet-switch-list" :class="$q.dark.isActive ? 'switch-list-dark' : 'switch-list-light'">
          <div
            v-for="wallet in wallets"
            :key="wallet.id"
            class="wallet-switch-card"
            :class="{
              'wallet-switch-card-active': wallet.id === activeWalletId,
              'wallet-switch-card-dark': $q.dark.isActive,
              'wallet-switch-card-light': !$q.dark.isActive
            }"
            role="button"
            tabindex="0"
            :aria-current="wallet.id === activeWalletId ? 'true' : null"
            :data-wallet-id="wallet.id"
            @click="$emit('switch', wallet.id)"
            @keydown.enter.prevent="$emit('switch', wallet.id)"
            @keydown.space.prevent="$emit('switch', wallet.id)"
          >
            <div class="switch-avatar" aria-hidden="true">
              <div class="switch-avatar-circle switch-avatar-black" :class="{ 'switch-avatar-arkade': wallet.type === 'arkade' }">
                <WalletBrandMark :type="wallet.type" :size="20" />
              </div>
              <div class="switch-status-dot" :class="connected(wallet.id) ? 'status-connected' : 'status-disconnected'"></div>
            </div>

            <div class="switch-details">
              <div class="switch-name" :class="$q.dark.isActive ? 'switch-name-dark' : 'switch-name-light'">
                {{ wallet.name }}
                <span class="switch-sr-only">{{ connected(wallet.id) ? $t('Online') : $t('Offline') }}</span>
              </div>
              <WalletTypeChip :type="wallet.type" class="switch-type-chip" />
              <div
                v-balance-updating="isRefreshPending(wallet.id)"
                class="switch-balance"
                :class="$q.dark.isActive ? 'switch-balance-dark' : 'switch-balance-light'"
              >
                <!-- A known value (outdated ones marked), else a placeholder: never an invented 0. -->
                <span v-if="!display(wallet.id).known" class="balance-placeholder" role="img" :aria-label="$t('Balance not loaded yet')" />
                <template v-else>
                  <HiddenAmount :class="{ 'balance-stale': display(wallet.id).outdated }">{{ formatBalance(display(wallet.id).balance) }}</HiddenAmount>
                  <!-- The conversion is always in view, not only the Bitcoin figure. -->
                  <HiddenAmount v-if="fiatOf(display(wallet.id).balance)" class="switch-fiat" :class="{ 'balance-stale': display(wallet.id).outdated }">{{ fiatOf(display(wallet.id).balance) }}</HiddenAmount>
                </template>
              </div>
            </div>

            <Icon
              v-if="wallet.id === activeWalletId"
              icon="tabler:circle-check"
              width="20"
              height="20"
              class="switch-check-icon"
              :class="$q.dark.isActive ? 'check-accent-dark' : 'check-accent-light'"
              :aria-hidden="true"
            />
            <!-- What the wallet received since the user last looked at it
                 (stores/unseenReceipts). The balance already includes it. -->
            <span v-else-if="unseenOf(wallet.id)" class="switch-unseen-pill">
              <HiddenAmount aria-hidden="true">+ {{ formatBalance(unseenOf(wallet.id).sats) }}</HiddenAmount>
              <span class="switch-sr-only">{{ $t('Received {amount} since you last looked', { amount: formatBalance(unseenOf(wallet.id).sats) }) }}</span>
            </span>
          </div>
        </div>
        <!-- A restore keeps finding the phrase's other wallets for a while. -->
        <p v-if="discovering" class="switcher-discovery" role="status">
          <q-spinner size="14px" :aria-hidden="true" />
          {{ $t('Looking for more wallets from your recovery phrase') }}
        </p>
      </q-card-section>

      <q-card-section class="switcher-footer" :class="$q.dark.isActive ? 'switcher-footer-dark' : 'switcher-footer-light'">
        <q-btn
          v-if="wallets.length >= 2"
          flat
          no-caps
          class="transfer-funds-btn"
          :class="$q.dark.isActive ? 'transfer-btn-dark' : 'transfer-btn-light'"
          @click="$emit('transfer')"
        >
          <Icon icon="tabler:arrows-exchange" width="20" height="20" class="q-mr-sm" />
          {{ $t('Transfer Funds') }}
        </q-btn>
        <q-btn
          flat
          no-caps
          class="manage-wallets-btn"
          :class="$q.dark.isActive ? 'manage-btn-dark' : 'manage-btn-light'"
          @click="$emit('manage')"
        >
          <Icon icon="tabler:settings" width="20" height="20" class="q-mr-sm" />
          <!-- Short verb on purpose: the wallets are listed right above, and it
               pairs with "Transfer Funds" ("Umbuchen") without wrapping. -->
          {{ $t('Manage') }}
        </q-btn>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../../stores/wallet';
import { useUnseenReceiptsStore } from '../../stores/unseenReceipts.js';
import { formatMainBalance } from '../../utils/amountFormatting.js';
import WalletBrandMark from '../WalletBrandMark.vue';
import WalletTypeChip from '../WalletTypeChip.vue';
import HiddenAmount from '../HiddenAmount.vue';
import balanceUpdating from '../../directives/balanceUpdating.js';

// <script setup> registers a directive by its `v`-prefixed local name.
const vBalanceUpdating = balanceUpdating;

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** walletId -> timestamp while that wallet's refresh runs (from the page). */
});
const emit = defineEmits(['update:modelValue', 'switch', 'transfer', 'manage']);

const store = useWalletStore();
const unseen = useUnseenReceiptsStore();

const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) });
const wallets = computed(() => store.wallets);
const activeWalletId = computed(() => store.activeWalletId);
const totalInfo = computed(() => store.totalBalanceInfo);
const discovering = computed(() => store.sparkDiscoveryRunning);
const anyRefreshing = computed(() => totalInfo.value.refreshing);

const connected = (walletId) => !!store.connectionStates[walletId]?.connected;
const unseenOf = (walletId) => unseen.forWallet(walletId);
const display = (walletId) => store.getDisplayBalance(walletId);
const formatBalance = (sats) => formatMainBalance(sats, store.useBip177Format);
const fiatOf = (sats) => store.fiatValueOf(sats);
/** A row pulses only while its first figure is on the way; a known one updates in place. */
const isRefreshPending = (walletId) => display(walletId).refreshing && !display(walletId).known;
</script>

<style scoped>
/* Wallet Switcher Dialog */
/* Bottom sheet: full width, rounded top, sized to its content with the
   list scrolling inside and the CTAs pinned hard at the bottom. */
.wallet-switcher-card {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  max-height: 78dvh;
  display: flex;
  flex-direction: column;
  border-radius: 24px 24px 0 0;
  overflow: hidden;
}

.wallet-switcher-card .sheet-grabber {
  display: flex;
  justify-content: center;
  padding: 10px 0 2px;
  flex-shrink: 0;
}

.wallet-switcher-card .grabber-bar {
  width: 36px;
  height: 5px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.35);
}

.switcher-header {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 0.25rem 1.25rem 0.5rem;
  flex-shrink: 0;
}

.switcher-title {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 600;
}

.switcher-content {
  flex: 1;
  min-height: 0;
  padding: 0.25rem 0.75rem 0.5rem;
  overflow-y: auto;
  scrollbar-width: none;
}

.switcher-content::-webkit-scrollbar {
  display: none;
}

/* Inset grouped list: one rounded surface, hairline separators inset past
   the leading mark, rows that highlight on press - selection is the
   trailing checkmark, the platform-native reading. */
.wallet-switch-list {
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
}

.switch-list-light { background: #FFFFFF; }
.switch-list-dark  { background: #2C2C2E; }

/* Wallet row */
.wallet-switch-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  cursor: pointer;
  transition: background 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.wallet-switch-card:not(:first-child)::before {
  content: '';
  position: absolute;
  top: 0;
  left: 74px;
  right: 0;
  height: 1px;
  background: rgba(128, 128, 128, 0.18);
}

.wallet-switch-card-light:hover,
.wallet-switch-card-light:active {
  background: rgba(0, 0, 0, 0.045);
}

.wallet-switch-card-dark:hover,
.wallet-switch-card-dark:active {
  background: rgba(255, 255, 255, 0.06);
}

/* Switch Avatar */
.switch-avatar {
  position: relative;
  flex-shrink: 0;
}

.switch-avatar-circle {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.switch-avatar-black {
  background: linear-gradient(135deg, #2A2A2A, #1A1A1A);
}

/* Arkade's purple mark needs a light tile on cream (brand rule). */
body.body--light .switch-avatar-arkade {
  background: var(--arkade-tile);
  box-shadow: inset 0 0 0 1px var(--arkade-tint-border);
}

.switch-status-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid;
}

.wallet-switch-card-dark .switch-status-dot {
  border-color: #2C2C2E;
}

.wallet-switch-card-light .switch-status-dot {
  border-color: #FFF;
}

.status-connected {
  background: #15DE72;
}

.status-disconnected {
  background: #EF4444;
}

/* Switch Details */
.switch-details {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.switch-name {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.125rem;
}

.switch-name-dark {
  color: #F6F6F6;
}

.switch-name-light {
  color: #212121;
}

/* Switch Balance */
.switch-balance {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
}

.switch-balance-dark {
  color: #777;
}

.switch-balance-light {
  color: var(--text-muted);
}

/* Check Icon */
.switch-check-icon {
  flex-shrink: 0;
}

.check-accent-light { color: #1A1A1A; }
.check-accent-dark  { color: #15DE72; }

/* Switcher Footer - pinned hard at the sheet's bottom edge. */
.switcher-footer {
  flex-shrink: 0;
  padding: 0.75rem 1rem;
  padding-bottom: max(0.875rem, var(--safe-bottom, 0px));
  border-top: 1px solid;
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  gap: 10px;
}

.switcher-footer-dark {
  border-top-color: #222;
  background: #171717;
}

.switcher-footer-light {
  border-top-color: var(--border-card);
  background: var(--bg-primary);
}

/* Transfer Funds - the primary CTA: dark ink in light mode, the app's
   credit green in dark mode. */
.transfer-funds-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  border-radius: 12px;
  min-height: 48px;
  padding: 0.5rem 1rem;
  flex: 1;
  transition: all 0.15s ease;
}

.transfer-btn-dark {
  color: var(--btn-primary-fg);
  background: var(--btn-primary-bg);
}

.transfer-btn-dark:hover {
  filter: brightness(1.05);
}

.transfer-btn-light {
  color: #FFFFFF;
  background: #1A1A1A;
}

.transfer-btn-light:hover {
  background: #2A2A2A;
}

.manage-wallets-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  border-radius: 12px;
  min-height: 48px;
  padding: 0.5rem 1rem;
  flex: 1;
  transition: all 0.15s ease;
}

.manage-btn-dark {
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.08);
}

.manage-btn-light {
  color: rgba(0, 0, 0, 0.7);
  background: rgba(0, 0, 0, 0.05);
}

.manage-wallets-btn:hover {
  background: rgba(107, 114, 128, 0.1);
}

.manage-btn-dark:hover {
  color: #F6F6F6;
}

.manage-btn-light:hover {
  color: var(--text-primary);
}

/* Total across wallets, under the title. */
.switcher-total {
  display: flex;
  align-items: baseline;
  justify-content: center;
  flex-wrap: wrap;
  gap: 2px 8px;
  margin-top: 4px;
  font-family: 'Manrope', sans-serif;
}
.switcher-total-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.switcher-total-fiat {
  font-size: 13px;
  color: var(--text-secondary);
}
.switch-fiat {
  font-family: 'Manrope', sans-serif;
}
.switch-fiat::before {
  content: '·';
  margin: 0 6px;
}
.switcher-total-value {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
/* What the wallet received since the user last looked at it: the toolbar's
   money pill, on the trailing edge where the active row wears its check. */
.switch-unseen-pill {
  position: relative;
  flex-shrink: 0;
  display: inline-grid;
  place-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  background: #10b981;
  color: #07140f;
  font: 800 12px/1 'Manrope', sans-serif;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.switch-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.switch-type-chip {
  margin: 2px 0 4px;
}
.switcher-discovery {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 12px 0 0;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
