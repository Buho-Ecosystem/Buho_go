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
          <div class="avatar-circle-main" :class="getWalletAvatarClass(activeWallet)">
            <!-- Spark Logo -->
            <svg v-if="activeWallet?.type === 'spark'" width="20" height="19" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554ZM67.2944 66.062L67.2941 66.0609H67.2932L67.2924 66.0635L67.2944 66.062Z" fill="white"/>
            </svg>
            <!-- NWC Logo -->
            <svg v-else-if="activeWallet?.type === 'nwc'" width="20" height="20" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="url(#nwc_grad_main)"/>
              <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="#897FFF"/>
              <defs>
                <linearGradient id="nwc_grad_main" x1="123.989" y1="10.4384" x2="123.989" y2="249.939" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#FFCA4A"/>
                  <stop offset="1" stop-color="#F7931A"/>
                </linearGradient>
              </defs>
            </svg>
            <!-- LNBits Logo -->
            <svg v-else-if="activeWallet?.type === 'lnbits'" width="18" height="18" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
            </svg>
            <!-- Default wallet icon -->
            <q-icon v-else name="las la-wallet" size="20px"/>
          </div>
          <div
            class="status-dot-main"
            :class="connectionStates[activeWallet?.id]?.connected ? 'status-connected' : 'status-disconnected'"
          ></div>
        </div>
        <div class="wallet-details">
          <div class="wallet-name" :class="$q.dark.isActive ? 'wallet-name-dark' : 'wallet-name-light'">
            {{ activeWallet?.name || $t('No Wallet') }}
          </div>
          <div class="wallet-balance" :class="$q.dark.isActive ? 'wallet-balance-dark' : 'wallet-balance-light'">
            <template v-if="activeWallet && isSparkWalletLocked(activeWallet.id)">
              <q-icon name="las la-lock" size="11px" class="q-mr-xs"/>
              {{ formatBalanceWithLock(activeWallet.id) }}
            </template>
            <template v-else>
              {{ formatBalance(balances[activeWallet?.id] || 0) }}
            </template>
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
                'wallet-option-active': wallet.id === activeWalletId,
                'wallet-option-disconnected': !connectionStates[wallet.id]?.connected,
                'wallet-option-dark': $q.dark.isActive,
                'wallet-option-light': !$q.dark.isActive
              }"
              @click="handleWalletSwitch(wallet.id)"
            >
              <!-- Wallet Avatar -->
              <div class="option-avatar">
                <div class="avatar-circle" :class="getWalletAvatarClass(wallet)">
                  <!-- Spark Logo -->
                  <svg v-if="wallet.type === 'spark'" width="18" height="17" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554ZM67.2944 66.062L67.2941 66.0609H67.2932L67.2924 66.0635L67.2944 66.062Z" fill="white"/>
                  </svg>
                  <!-- NWC Logo -->
                  <svg v-else-if="wallet.type === 'nwc'" width="18" height="18" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="url(#nwc_grad_opt)"/>
                    <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="#897FFF"/>
                    <defs>
                      <linearGradient id="nwc_grad_opt" x1="123.989" y1="10.4384" x2="123.989" y2="249.939" gradientUnits="userSpaceOnUse">
                        <stop stop-color="#FFCA4A"/>
                        <stop offset="1" stop-color="#F7931A"/>
                      </linearGradient>
                    </defs>
                  </svg>
                  <!-- LNBits Logo -->
                  <svg v-else-if="wallet.type === 'lnbits'" width="16" height="16" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
                  </svg>
                  <!-- Default wallet icon -->
                  <q-icon v-else name="las la-wallet" size="18px"/>
                </div>
                <div
                  class="status-dot"
                  :class="connectionStates[wallet.id]?.connected ? 'status-connected' : 'status-disconnected'"
                ></div>
              </div>

              <!-- Wallet Details -->
              <div class="option-details">
                <div class="option-name-row">
                  <span class="option-name" :class="$q.dark.isActive ? 'option-name-dark' : 'option-name-light'">
                    {{ wallet.name }}
                  </span>
                </div>
                <div class="option-meta-row">
                  <div class="wallet-type-badge" :class="getTypeBadgeClass(wallet.type)">
                    <!-- Spark mini logo -->
                    <svg v-if="wallet.type === 'spark'" width="9" height="9" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="currentColor"/>
                    </svg>
                    <!-- NWC mini logo -->
                    <svg v-else-if="wallet.type === 'nwc'" width="9" height="9" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="currentColor"/>
                      <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="currentColor"/>
                    </svg>
                    <!-- LNBits mini logo -->
                    <svg v-else-if="wallet.type === 'lnbits'" width="8" height="9" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="currentColor"/>
                    </svg>
                    <q-icon v-else name="las la-wallet" size="9px" />
                    <span>{{ getTypeBadgeLabel(wallet.type) }}</span>
                  </div>
                  <div v-if="wallet.isDefault" class="wallet-tag tag-default">{{ $t('Default') }}</div>
                  <div v-if="wallet.id === activeWalletId" class="wallet-tag tag-active">{{ $t('Active') }}</div>
                </div>
                <div class="option-balance" :class="$q.dark.isActive ? 'option-balance-dark' : 'option-balance-light'">
                  <template v-if="isSparkWalletLocked(wallet.id)">
                    <q-icon name="las la-lock" size="10px" class="q-mr-xs locked-icon"/>
                    {{ formatBalanceWithLock(wallet.id) }}
                  </template>
                  <template v-else>
                    {{ formatBalance(balances[wallet.id] || 0) }}
                  </template>
                </div>
                <div v-if="connectionStates[wallet.id]?.error" class="option-error">
                  {{ $t('Connection failed') }}
                </div>
              </div>

              <!-- Wallet Actions -->
              <div class="option-actions">
                <q-icon
                  v-if="wallet.id === activeWalletId"
                  name="las la-check-circle"
                  class="active-check-icon"
                />
                <!-- Reconnect button for NWC wallets only -->
                <q-btn
                  v-if="!connectionStates[wallet.id]?.connected && wallet.type !== 'spark'"
                  flat
                  dense
                  round
                  icon="las la-sync-alt"
                  @click.stop="reconnectWallet(wallet.id)"
                  class="option-action-btn"
                  :class="$q.dark.isActive ? 'option-action-btn-dark' : 'option-action-btn-light'"
                  size="sm"
                />
                <!-- Tap to unlock hint for locked Spark wallets -->
                <q-icon
                  v-if="isSparkWalletLocked(wallet.id) && wallet.id !== activeWalletId"
                  name="las la-unlock-alt"
                  class="unlock-hint-icon"
                  :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
                  size="16px"
                >
                  <q-tooltip>{{ $t('Tap to unlock') }}</q-tooltip>
                </q-icon>
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
import {formatAmount} from '../utils/amountFormatting.js'

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
      'preferredFiatCurrency',
      'getDisplayBalance',
      'isSparkWalletLocked',
      'useBip177Format'
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
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t switch wallet'),
          caption: this.$t('Please try again'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
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
          message: this.$t('Reconnected'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Reconnection failed'),
          caption: this.$t('Please try again'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
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

    getTypeBadgeClass(type) {
      switch (type) {
        case 'spark': return 'type-spark'
        case 'lnbits': return 'type-lnbits'
        case 'nwc':
        default: return 'type-nwc'
      }
    },

    getTypeBadgeLabel(type) {
      switch (type) {
        case 'spark': return 'Spark'
        case 'lnbits': return 'LNBits'
        case 'nwc':
        default: return 'NWC'
      }
    },

    formatBalance(balance) {
      switch (this.denominationCurrency) {
        case 'btc':
          return (balance / 100000000).toFixed(8) + ' BTC'
        case 'usd':
          const usdValue = (balance / 100000000) * (this.exchangeRates.usd || 65000)
          return '$' + usdValue.toFixed(2)
        case 'sats':
        case 'bitcoin':
        default:
          return formatAmount(balance, this.useBip177Format)
      }
    },

    /**
     * Format balance for locked Spark wallets
     * Shows cached balance if available, otherwise "Locked"
     */
    formatBalanceWithLock(walletId) {
      const displayData = this.getDisplayBalance(walletId)

      if (displayData.isCached && displayData.balance > 0) {
        // Show cached balance with indicator
        return this.formatBalance(displayData.balance)
      }

      // No cached balance available
      return this.$t('Locked')
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
  padding: 0.625rem 0.875rem;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.current-wallet-dark {
  background: #1A1A1A;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
}

.current-wallet-light {
  background: #FFF;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.current-wallet-dark:hover {
  background: #222;
}

.current-wallet-light:hover {
  background: #F9FAFB;
}

.wallet-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
}

.wallet-avatar {
  position: relative;
  flex-shrink: 0;
}

.avatar-circle-main {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.avatar-default {
  background: #6B7280;
}

.avatar-green {
  background: linear-gradient(135deg, #15DE72, #059573);
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

.status-dot-main {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid;
}

.current-wallet-dark .status-dot-main {
  border-color: #1A1A1A;
}

.current-wallet-light .status-dot-main {
  border-color: #FFF;
}

.status-connected {
  background: #15DE72;
}

.status-disconnected {
  background: #EF4444;
}

.wallet-details {
  flex: 1;
  min-width: 0;
}

.wallet-name {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  margin-bottom: 0.125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wallet-name-dark {
  color: #F6F6F6;
}

.wallet-name-light {
  color: #212121;
}

.wallet-balance {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
}

.wallet-balance-dark {
  color: #777;
}

.wallet-balance-light {
  color: #9CA3AF;
}

.expand-icon {
  transition: transform 0.2s ease;
  font-size: 16px;
}

.expand-icon-dark {
  color: #666;
}

.expand-icon-light {
  color: #9CA3AF;
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
  border-radius: 16px;
  overflow: hidden;
}

/* Wallet List */
.wallet-list {
  max-height: 300px;
  overflow-y: auto;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
  padding: 0.25rem 0;
}

/* Scrollbar styling */
.wallet-list::-webkit-scrollbar {
  width: 6px;
}

.wallet-list::-webkit-scrollbar-track {
  background: transparent;
}

.wallet-list::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.4);
  border-radius: 3px;
}

.wallet-list::-webkit-scrollbar-thumb:hover {
  background: rgba(128, 128, 128, 0.6);
}

/* Wallet Option - iOS style cards */
.wallet-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  margin: 0.25rem 0.5rem;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.wallet-option-dark {
  background: transparent;
}

.wallet-option-light {
  background: transparent;
}

.wallet-option-dark:hover {
  background: #222;
}

.wallet-option-light:hover {
  background: #F3F4F6;
}

.wallet-option-active {
  box-shadow: inset 0 0 0 1px #15DE72;
  background: rgba(21, 222, 114, 0.03) !important;
}

.wallet-option-active.wallet-option-dark:hover {
  background: rgba(21, 222, 114, 0.06) !important;
}

.wallet-option-active.wallet-option-light:hover {
  background: rgba(21, 222, 114, 0.05) !important;
}

.wallet-option-disconnected {
  opacity: 0.6;
}

/* Option Avatar */
.option-avatar {
  position: relative;
  flex-shrink: 0;
}

.avatar-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.status-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid;
}

.wallet-option-dark .status-dot {
  border-color: #0C0C0C;
}

.wallet-option-light .status-dot {
  border-color: #FFF;
}

/* Option Details */
.option-details {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.option-name-row {
  margin-bottom: 0.125rem;
}

.option-name {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-name-dark {
  color: #F6F6F6;
}

.option-name-light {
  color: #212121;
}

/* Meta Row with Badges */
.option-meta-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-bottom: 0.25rem;
  flex-wrap: wrap;
}

.wallet-type-badge {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 8px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: white;
}

.type-spark {
  background: linear-gradient(135deg, #3A3A3A, #1A1A1A);
}

.type-nwc {
  background: linear-gradient(135deg, #FFCA4A, #F7931A);
}

.type-lnbits {
  background: linear-gradient(135deg, #FF1FE1, #C919B0);
}

.wallet-tag {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 8px;
  font-weight: 600;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  text-transform: capitalize;
  letter-spacing: 0.02em;
}

.tag-default {
  background: #FEF3C7;
  color: #92400E;
}

.tag-active {
  background: #D1FAE5;
  color: #065F46;
}

/* Option Balance */
.option-balance {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 11px;
  font-weight: 500;
  display: flex;
  align-items: center;
}

.option-balance-dark {
  color: #777;
}

.option-balance-light {
  color: #9CA3AF;
}

.locked-icon {
  opacity: 0.6;
}

.unlock-hint-icon {
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.wallet-option:hover .unlock-hint-icon {
  opacity: 0.8;
}

.option-error {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 10px;
  color: #EF4444;
  font-weight: 500;
  margin-top: 0.125rem;
}

/* Option Actions */
.option-actions {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-shrink: 0;
}

.active-check-icon {
  color: #15DE72;
  font-size: 20px;
}

.option-action-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.option-action-btn-dark {
  color: #666;
}

.option-action-btn-light {
  color: #9CA3AF;
}

.option-action-btn-dark:hover {
  color: #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.option-action-btn-light:hover {
  color: #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

/* Switcher Actions */
.switcher-actions {
  border-top: 1px solid;
  padding: 0.625rem 0.75rem;
  display: flex;
  gap: 0.5rem;
}

.actions-dark {
  background: #171717;
  border-top-color: #222;
}

.actions-light {
  background: #F8F9FA;
  border-top-color: #E5E7EB;
}

.action-btn {
  flex: 1;
  height: 38px;
  border-radius: 10px;
  font-family: Fustat, 'Inter', sans-serif;
  font-weight: 500;
  font-size: 12px;
  transition: all 0.15s ease;
}

.action-btn-dark {
  color: #888;
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
  color: #F6F6F6;
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
    padding: 0.5rem 0.75rem;
    border-radius: 12px;
  }

  .avatar-circle-main {
    width: 34px;
    height: 34px;
  }

  .avatar-circle-main .q-icon {
    font-size: 18px !important;
  }

  .status-dot-main {
    width: 9px;
    height: 9px;
  }

  .wallet-name {
    font-size: 13px;
  }

  .wallet-balance {
    font-size: 11px;
  }

  .dropdown-content {
    border-radius: 14px;
  }

  .wallet-option {
    padding: 0.625rem 0.75rem;
    margin: 0.125rem 0.375rem;
    border-radius: 10px;
    gap: 0.625rem;
  }

  .avatar-circle {
    width: 32px;
    height: 32px;
  }

  .avatar-circle .q-icon {
    font-size: 16px !important;
  }

  .status-dot {
    width: 8px;
    height: 8px;
  }

  .option-name {
    font-size: 13px;
  }

  .wallet-type-badge,
  .wallet-tag {
    font-size: 7px;
  }

  .option-balance {
    font-size: 10px;
  }

  .switcher-actions {
    padding: 0.5rem;
    gap: 0.375rem;
  }

  .action-btn {
    height: 34px;
    font-size: 11px;
    border-radius: 8px;
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
  border-radius: 50%;
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

.status-dot.connecting {
  animation: pulse 1.5s ease-in-out infinite;
}
</style>
