<template>
  <div class="wallet-switcher">
    <!-- Current Wallet Display -->
    <div class="current-wallet" @click="showSwitcher = true">
      <div class="wallet-info">
        <div class="wallet-avatar">
          <div class="avatar-bg" :class="getWalletAvatarClass(activeWallet)">
            <q-icon name="las la-wallet" size="20px"/>
          </div>
          <div v-if="connectionStates[activeWallet?.id]?.connected" class="connection-indicator connected"></div>
          <div v-else class="connection-indicator disconnected"></div>
        </div>
        <div class="wallet-details">
          <div class="wallet-name">{{ activeWallet?.name || 'No Wallet' }}</div>
          <div class="wallet-balance">{{ formatBalance(balances[activeWallet?.id] || 0) }}</div>
        </div>
      </div>
      <q-icon name="las la-chevron-down" class="expand-icon" :class="{ 'rotated': showSwitcher }"/>
    </div>

    <!-- Wallet Switcher Dropdown -->
    <q-slide-transition>
      <div v-show="showSwitcher" class="switcher-dropdown">
        <div class="dropdown-content">
          <!-- Wallet List -->
          <div class="wallet-list">
            <div 
              v-for="wallet in sortedWallets" 
              :key="wallet.id"
              class="wallet-option"
              :class="{ 
                'active': wallet.id === activeWalletId,
                'disconnected': !connectionStates[wallet.id]?.connected 
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
                <div class="option-name">
                  {{ wallet.name }}
                  <q-icon 
                    v-if="wallet.isDefault" 
                    name="las la-star" 
                    class="default-icon"
                  />
                </div>
                <div class="option-balance">{{ formatBalance(balances[wallet.id] || 0) }}</div>
                <div v-if="connectionStates[wallet.id]?.error" class="option-error">
                  Connection failed
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
                  size="sm"
                />
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="switcher-actions">
            <q-btn
              flat
              no-caps
              class="action-btn add-wallet-btn"
              @click="$emit('add-wallet')"
            >
              <q-icon name="las la-plus" class="q-mr-sm"/>
              Add Wallet
            </q-btn>
            
            <q-btn
              flat
              no-caps
              class="action-btn manage-btn"
              @click="$emit('manage-wallets')"
            >
              <q-icon name="las la-cog" class="q-mr-sm"/>
              Manage
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
import { useWalletStore } from '../stores/wallet'
import { mapState, mapActions } from 'pinia'

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
          message: `Switched to ${this.wallets.find(w => w.id === walletId)?.name}`,
          position: 'top'
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: 'Failed to switch wallet: ' + error.message,
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
          message: 'Wallet reconnected successfully',
          position: 'top'
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: 'Failed to reconnect: ' + error.message,
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
  background: white;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.current-wallet:hover {
  background: #f9fafb;
  border-color: #d1d5db;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
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
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.avatar-default { background: #6b7280; }
.avatar-green { background: linear-gradient(135deg, #059573, #047857); }
.avatar-blue { background: linear-gradient(135deg, #3b82f6, #2563eb); }
.avatar-purple { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }
.avatar-orange { background: linear-gradient(135deg, #f59e0b, #d97706); }
.avatar-red { background: linear-gradient(135deg, #ef4444, #dc2626); }

.connection-indicator {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid white;
}

.connection-indicator.connected {
  background: #10b981;
}

.connection-indicator.disconnected {
  background: #ef4444;
}

.wallet-details {
  flex: 1;
  min-width: 0;
}

.wallet-name {
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wallet-balance {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.expand-icon {
  color: #9ca3af;
  transition: transform 0.2s ease;
  font-size: 16px;
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
  background: white;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  border: 1px solid #e5e7eb;
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
  border-bottom: 1px solid #f3f4f6;
}

.wallet-option:last-child {
  border-bottom: none;
}

.wallet-option:hover {
  background: #f9fafb;
}

.wallet-option.active {
  background: rgba(5, 149, 115, 0.05);
  border-left: 3px solid #059573;
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
  border-radius: 8px;
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
  font-size: 0.9375rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.125rem;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.default-icon {
  color: #f59e0b;
  font-size: 12px;
  flex-shrink: 0;
}

.option-balance {
  font-size: 0.8125rem;
  color: #6b7280;
  font-weight: 500;
}

.option-error {
  font-size: 0.75rem;
  color: #ef4444;
  font-weight: 500;
}

.option-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.active-icon {
  color: #059573;
  font-size: 18px;
}

.reconnect-btn {
  color: #6b7280;
  width: 28px;
  height: 28px;
}

.reconnect-btn:hover {
  color: #059573;
  background: rgba(5, 149, 115, 0.1);
}

/* Switcher Actions */
.switcher-actions {
  background: #f8f9fa;
  border-top: 1px solid #e5e7eb;
  padding: 0.75rem;
  display: flex;
  gap: 0.5rem;
}

.action-btn {
  flex: 1;
  height: 40px;
  border-radius: 8px;
  font-weight: 500;
  color: #6b7280;
  transition: all 0.2s ease;
}

.add-wallet-btn:hover {
  background: rgba(5, 149, 115, 0.1);
  color: #059573;
}

.manage-btn:hover {
  background: rgba(107, 114, 128, 0.1);
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
    font-size: 0.9375rem;
  }
  
  .wallet-balance {
    font-size: 0.8125rem;
  }
  
  .wallet-option {
    padding: 0.625rem 0.875rem;
  }
  
  .option-name {
    font-size: 0.875rem;
  }
  
  .option-balance {
    font-size: 0.75rem;
  }
  
  .switcher-actions {
    padding: 0.625rem;
  }
  
  .action-btn {
    height: 36px;
    font-size: 0.875rem;
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
  border-radius: 8px;
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