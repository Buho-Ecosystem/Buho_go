<template>
  <div class="wallet-switcher">
    <!-- Current Wallet Display -->
    <div
      class="current-wallet"
      :class="$q.dark.isActive ? 'current-wallet-dark' : 'current-wallet-light'"
      @click="showSwitcher = true"
    >
      <div class="wallet-info">
        <div class="wallet-avatar">
          <div class="avatar-bg" :class="getWalletAvatarClass(activeWallet)">
            <q-icon name="las la-wallet" size="20px"/>
          </div>
          <div v-if="connectionStates[activeWallet?.id]?.connected" class="connection-indicator connected"></div>
          <div v-else class="connection-indicator disconnected"></div>
        </div>
        <div class="wallet-details">
          <div class="wallet-name" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
            {{ activeWallet?.name || $t('No Wallet') }}
          </div>
          <div class="wallet-balance" :class="$q.dark.isActive ? 'balance-text-dark' : 'balance-text-light'">
            {{ formatBalance(balances[activeWallet?.id] || 0) }}
          </div>
        </div>
      </div>
      <q-icon
        name="las la-chevron-down"
        class="expand-icon"
        :class="{
          'rotated': showSwitcher,
          'expand-icon-dark': $q.dark.isActive,
          'expand-icon-light': !$q.dark.isActive
        }"
      />
    </div>

    <!-- Wallet Switcher Dropdown -->
    <q-slide-transition>
      <div v-show="showSwitcher" class="switcher-dropdown">
        <div class="dropdown-content" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
          <!-- Wallet List -->
          <div class="wallet-list">
            <div
              v-for="wallet in sortedWallets"
              :key="wallet.id"
              class="wallet-option"
              :class="{
                'active': wallet.id === activeWalletId,
                'disconnected': !connectionStates[wallet.id]?.connected,
                'wallet-option-dark': $q.dark.isActive,
                'wallet-option-light': !$q.dark.isActive
              }"
              @click="handleWalletSwitch(wallet.id)"
            >
              <div class="option-avatar">
                <div class="avatar-bg" :class="getWalletAvatarClass(wallet)">
                  <q-icon name="las la-wallet" size="16px"/>
                </div>
                <div
                  v-if="connectionStates[wallet.id]?.connected"
                  class="connection-indicator connected"
                ></div>
                <div
                  v-else
                  class="connection-indicator disconnected"
                ></div>
              </div>

              <div class="option-details">
                <div class="option-name" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                  {{ wallet.name }}
                  <q-icon
                    v-if="wallet.isDefault"
                    name="las la-star"
                    class="default-icon"
                  />
                </div>
                <div class="option-balance" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ formatBalance(balances[wallet.id] || 0) }}
                </div>
                <div v-if="connectionStates[wallet.id]?.error" class="option-error">
                  {{ $t('Connection failed') }}
                </div>
              </div>

              <div class="option-actions">
                <q-icon
                  v-if="wallet.id === activeWalletId"
                  name="las la-check"
                  class="active-icon"
                />
                <q-btn
                  v-if="!connectionStates[wallet.id]?.connected"
                  flat
                  dense
                  round
                  icon="las la-sync-alt"
                  @click.stop="reconnectWallet(wallet.id)"
                  class="reconnect-btn"
                  :class="$q.dark.isActive ? 'reconnect-btn-dark' : 'reconnect-btn-light'"
                  size="sm"
                />
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="switcher-actions" :class="$q.dark.isActive ? 'actions-dark' : 'actions-light'">
            <q-btn
              flat
              no-caps
              class="action-btn add-wallet-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="$emit('add-wallet')"
            >
              <q-icon name="las la-plus" class="q-mr-sm"/>
              {{ $t('Add Wallet') }}
            </q-btn>

            <q-btn
              flat
              no-caps
              class="action-btn manage-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="$emit('manage-wallets')"
            >
              <q-icon name="las la-cog" class="q-mr-sm"/>
              {{ $t('Manage') }}
            </q-btn>
          </div>
        </div>
      </div>
    </q-slide-transition>

    <!-- Click Outside Overlay -->
    <div
      v-if="showSwitcher"
      class="switcher-overlay"
      @click="showSwitcher = false"
    ></div>
  </div>
</template>

<script>
import {useWalletStore} from '../stores/wallet'
import {mapState, mapActions} from 'pinia'

export default {
  name: 'WalletSwitcher',
  emits: ['add-wallet', 'manage-wallets'],
  data() {
    return {
      showSwitcher: false,
      isReconnecting: {}
    }
  },
  computed: {
    ...mapState(useWalletStore, [
      'wallets',
      'activeWalletId',
      'activeWallet',
      'balances',
      'connectionStates',
      'sortedWallets',
      'denominationCurrency',
      'exchangeRates',
      'preferredFiatCurrency'
    ])
  },
  methods: {
    ...mapActions(useWalletStore, [
      'switchActiveWallet',
      'connectWallet',
      'refreshWalletData'
    ]),

    async handleWalletSwitch(walletId) {
      if (walletId === this.activeWalletId) {
        this.showSwitcher = false
        return
      }

      try {
        await this.switchActiveWallet(walletId)
        this.showSwitcher = false

        this.$q.notify({
          type: 'positive',
          message: this.$t('Switched to {name}', {name: this.wallets.find(w => w.id === walletId)?.name}),
          position: 'top'
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to switch wallet: ') + error.message,
          position: 'top'
        })
      }
    },

    async reconnectWallet(walletId) {
      if (this.isReconnecting[walletId]) return

      this.isReconnecting[walletId] = true

      try {
        await this.connectWallet(walletId)
        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet reconnected successfully'),
          position: 'top'
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to reconnect: ') + error.message,
          position: 'top'
        })
      } finally {
        this.isReconnecting[walletId] = false
      }
    },

    getWalletAvatarClass(wallet) {
      if (!wallet) return 'avatar-default'

      // Generate consistent color based on wallet ID
      const colors = ['avatar-green', 'avatar-blue', 'avatar-purple', 'avatar-orange', 'avatar-red']
      const index = wallet.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length
      return colors[index]
    },

    formatBalance(balance) {
      switch (this.denominationCurrency) {
        case 'btc':
          return (balance / 100000000).toFixed(8) + ' BTC'
        case 'usd':
          const usdValue = (balance / 100000000) * (this.exchangeRates.usd || 65000)
          return '$' + usdValue.toFixed(2)
        case 'sats':
        default:
          return balance.toLocaleString() + ' sats'
      }
    }
  }
}
</script>

<style scoped>
.wallet-switcher {
  position: relative;
  z-index: 1000;
}

/* Current Wallet Display */
.current-wallet {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-radius: 24px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid;
}

.current-wallet-dark {
  background: #0C0C0C;
  border-color: #2A342A;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.current-wallet-light {
  background: #FFF;
  border-color: #E5E7EB;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.current-wallet-dark:hover {
  background: #171717;
  border-color: #15DE72;
  transform: translateY(-1px);
}

.current-wallet-light:hover {
  background: #F9FAFB;
  border-color: #15DE72;
  transform: translateY(-1px);
}

.wallet-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
}

.wallet-avatar {
  position: relative;
}

.avatar-bg {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.avatar-default {
  background: #6B7280;
}

.avatar-green {
  background: linear-gradient(135deg, #059573, #15DE72);
}

.avatar-blue {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
}

.avatar-purple {
  background: linear-gradient(135deg, #8B5CF6, #7C3AED);
}

.avatar-orange {
  background: linear-gradient(135deg, #F59E0B, #D97706);
}

.avatar-red {
  background: linear-gradient(135deg, #EF4444, #DC2626);
}

.connection-indicator {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid;
}

.connection-indicator.connected {
  background: #15DE72;
  border-color: #FFF;
}

.connection-indicator.disconnected {
  background: #EF4444;
  border-color: #FFF;
}

.wallet-details {
  flex: 1;
  min-width: 0;
}

.wallet-name {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 700;
  line-height: 100%;
  letter-spacing: -0.28px;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.balance-text-dark {
  color: var(--Shark-300, #B0B0B0);
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 400;
  line-height: 100%;
}

.balance-text-light {
  color: var(--Shark-600, #5D5D5D);
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 400;
  line-height: 100%;
}

.expand-icon {
  transition: transform 0.2s ease;
  font-size: 16px;
}

.expand-icon-dark {
  color: #B0B0B0;
}

.expand-icon-light {
  color: #6B7280;
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

/* Switcher Dropdown */
.switcher-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 0.5rem;
  z-index: 1001;
}

.dropdown-content {
  border-radius: 24px;
  overflow: hidden;
}

/* Wallet List */
.wallet-list {
  max-height: 300px;
  overflow-y: auto;
}

.wallet-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
  border-bottom: 1px solid;
}

.wallet-option-dark {
  border-bottom-color: #2A342A;
}

.wallet-option-light {
  border-bottom-color: #F3F4F6;
}

.wallet-option:last-child {
  border-bottom: none;
}

.wallet-option-dark:hover {
  background: #171717;
}

.wallet-option-light:hover {
  background: #F9FAFB;
}

.wallet-option.active {
  background: rgba(21, 222, 114, 0.1);
  border-left: 3px solid #15DE72;
}

.wallet-option.disconnected {
  opacity: 0.6;
}

.option-avatar {
  position: relative;
  flex-shrink: 0;
}

.option-avatar .avatar-bg {
  width: 32px;
  height: 32px;
  border-radius: 10px;
}

.option-avatar .connection-indicator {
  width: 10px;
  height: 10px;
  bottom: -1px;
  right: -1px;
}

.option-details {
  flex: 1;
  min-width: 0;
}

.option-name {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 700;
  line-height: 100%;
  letter-spacing: -0.28px;
  margin-bottom: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.default-icon {
  color: #F59E0B;
  font-size: 12px;
  flex-shrink: 0;
}

.option-balance {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 400;
  line-height: 100%;
}

.option-error {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 10px;
  color: #EF4444;
  font-weight: 500;
}

.option-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.active-icon {
  color: #15DE72;
  font-size: 18px;
}

.reconnect-btn {
  width: 28px;
  height: 28px;
}

.reconnect-btn-dark {
  color: #B0B0B0;
}

.reconnect-btn-light {
  color: #6B7280;
}

.reconnect-btn-dark:hover {
  color: #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.reconnect-btn-light:hover {
  color: #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

/* Switcher Actions */
.switcher-actions {
  border-top: 1px solid;
  padding: 0.75rem;
  display: flex;
  gap: 0.5rem;
}

.actions-dark {
  background: #171717;
  border-top-color: #2A342A;
}

.actions-light {
  background: #F8F9FA;
  border-top-color: #E5E7EB;
}

.action-btn {
  flex: 1;
  height: 40px;
  border-radius: 12px;
  font-family: Fustat, 'Inter', sans-serif;
  font-weight: 500;
  font-size: 12px;
  transition: all 0.2s ease;
}

.action-btn-dark {
  color: #B0B0B0;
}

.action-btn-light {
  color: #6B7280;
}

.add-wallet-btn:hover {
  background: rgba(21, 222, 114, 0.1);
  color: #15DE72;
}

.manage-btn:hover {
  background: rgba(107, 114, 128, 0.1);
}

.manage-btn.action-btn-dark:hover {
  color: #FFF;
}

.manage-btn.action-btn-light:hover {
  color: #374151;
}

/* Overlay */
.switcher-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  background: transparent;
}

/* Responsive Design */
@media (max-width: 480px) {
  .current-wallet {
    padding: 0.625rem 0.875rem;
  }

  .wallet-avatar .avatar-bg {
    width: 32px;
    height: 32px;
  }

  .wallet-name {
    font-size: 13px;
  }

  .balance-text-dark,
  .balance-text-light {
    font-size: 11px;
  }

  .wallet-option {
    padding: 0.625rem 0.875rem;
  }

  .option-name {
    font-size: 13px;
  }

  .option-balance {
    font-size: 11px;
  }

  .switcher-actions {
    padding: 0.625rem;
  }

  .action-btn {
    height: 36px;
    font-size: 11px;
  }
}

/* Loading States */
.wallet-option.loading {
  pointer-events: none;
}

.wallet-option.loading .option-avatar::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Animations */
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.connection-indicator.connecting {
  animation: pulse 1.5s ease-in-out infinite;
}
</style>
