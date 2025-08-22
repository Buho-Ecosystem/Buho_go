<template>
  <q-page class="settings-page">
    <!-- Header -->
    <div class="settings-header">
      <q-btn 
        flat 
        round 
        dense 
        icon="las la-arrow-left" 
        @click="$router.back()"
        class="back-btn"
      />
      <div class="header-content">
        <div class="logo-container">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="26" viewBox="0 0 30 32" fill="none" class="logo">
            <path d="M0 13.4423C0 6.01833 6.01833 0 13.4423 0V18.5577C13.4423 25.9817 7.42399 32 0 32V13.4423Z" fill="#059573"/>
            <path d="M15.3906 7.30444C15.3906 3.27031 18.6609 0 22.6951 0C26.7292 0 29.9995 3.27031 29.9995 7.30444V7.72091C29.9995 11.755 26.7292 15.0253 22.6951 15.0253C18.6609 15.0253 15.3906 11.755 15.3906 7.72091V7.30444Z" fill="#78D53C"/>
            <path d="M15.3906 24.281C15.3906 20.2469 18.6609 16.9766 22.6951 16.9766C26.7292 16.9766 29.9995 20.2469 29.9995 24.281V24.6975C29.9995 28.7316 26.7292 32.0019 22.6951 32.0019C18.6609 32.0019 15.3906 28.7316 15.3906 24.6975V24.281Z" fill="#43B65B"/>
          </svg>
          <div class="title">BuhoGO</div>
        </div>
      </div>
      <div class="header-spacer"></div>
    </div>

    <!-- Settings Content -->
    <div class="settings-content">
      <!-- Wallet Management -->
      <div class="settings-section">
        <div class="section-card" @click="handleWalletClick">
          <div class="card-icon wallet-icon">
            <q-icon name="las la-wallet" size="24px"/>
          </div>
          <div class="card-content">
            <div class="card-title">Manage Wallets</div>
            <div class="card-subtitle">
              {{ walletState.connectedWallets.length }} 
              {{ walletState.connectedWallets.length === 1 ? 'wallet' : 'wallets' }} connected
            </div>
          </div>
          <q-icon name="las la-chevron-right" size="20px" class="chevron-icon"/>
        </div>
      </div>

      <!-- Preferences -->
      <div class="settings-section">
        <div class="section-title">Preferences</div>
        
        <div class="section-card" @click="showCurrencyDialog = true">
          <div class="card-icon currency-icon">
            <q-icon name="las la-dollar-sign" size="24px"/>
          </div>
          <div class="card-content">
            <div class="card-title">Currency</div>
            <div class="card-subtitle">{{ walletState.preferredFiatCurrency }}</div>
          </div>
          <q-icon name="las la-chevron-right" size="20px" class="chevron-icon"/>
        </div>

        <div class="section-card disabled-card">
          <div class="card-icon notifications-icon">
            <q-icon name="las la-bell" size="24px"/>
          </div>
          <div class="card-content">
            <div class="card-title">Notifications</div>
            <div class="card-subtitle">Coming soon</div>
          </div>
          <div class="coming-soon-badge">Soon</div>
        </div>

        <div class="section-card disabled-card">
          <div class="card-icon security-icon-disabled">
            <q-icon name="las la-shield-alt" size="24px"/>
          </div>
          <div class="card-content">
            <div class="card-title">Security</div>
            <div class="card-subtitle">Coming soon</div>
          </div>
          <div class="coming-soon-badge">Soon</div>
        </div>
      </div>
    </div>

    <!-- Disconnect Button -->
    <div class="disconnect-section">
      <div class="disconnect-container">
        <div class="disconnect-warning">
          <q-icon name="las la-exclamation-triangle" class="warning-icon"/>
          <div class="warning-content">
            <div class="warning-title">Danger Zone</div>
            <div class="warning-subtitle">This action cannot be undone</div>
          </div>
        </div>
        <q-btn
          flat
          no-caps
          class="disconnect-btn"
          @click="confirmDisconnect"
        >
          <q-icon name="las la-sign-out-alt" class="disconnect-icon"/>
          <span class="disconnect-text">Disconnect All Wallets</span>
        </q-btn>
      </div>
    </div>

    <!-- Currency Dialog -->
    <q-dialog v-model="showCurrencyDialog" class="settings-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="dialog-title">Currency Settings</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="currency-list">
            <div 
              v-for="currency in ['USD', 'EUR', 'GBP', 'JPY']"
              :key="currency"
              class="currency-item"
              :class="{ active: walletState.preferredFiatCurrency === currency }"
              @click="setPreferredCurrency(currency)"
            >
              <div class="currency-info">
                <div class="currency-code">{{ currency }}</div>
                <div class="currency-rate">
                  {{ getCurrencySymbol(currency) }}1 = {{ walletState.exchangeRates[currency.toLowerCase()] }} sats
                </div>
              </div>
              <q-icon 
                name="las la-check" 
                v-if="walletState.preferredFiatCurrency === currency"
                class="check-icon"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Notifications Dialog -->
    <q-dialog v-model="showNotificationsDialog" class="settings-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="dialog-title">Notification Settings</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="notification-item">
            <div class="notification-info">
              <div class="notification-title">Payment Notifications</div>
              <div class="notification-subtitle">Receive alerts for incoming and outgoing payments</div>
            </div>
            <q-toggle 
              v-model="notificationsEnabled" 
              @update:model-value="handleNotificationsToggle"
              color="primary"
            />
          </div>

          <div v-if="!hasNotificationPermission" class="permission-warning">
            <div class="warning-content">
              <q-icon name="las la-exclamation-triangle" class="warning-icon"/>
              <div class="warning-text">
                <div class="warning-title">Notifications Disabled</div>
                <div class="warning-subtitle">Enable notifications in your browser settings</div>
              </div>
              <q-btn 
                flat 
                color="primary" 
                label="Enable" 
                @click="requestNotificationPermission"
                class="enable-btn"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Security Dialog -->
    <q-dialog v-model="showSecurityDialog" class="settings-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="dialog-title">Security Settings</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="security-item">
            <div class="security-info">
              <div class="security-title">PIN Protection</div>
              <div class="security-subtitle">Require PIN for transactions</div>
            </div>
            <q-toggle 
              v-model="pinEnabled" 
              @update:model-value="handlePinToggle"
              color="primary"
            />
          </div>

          <div v-if="pinEnabled" class="pin-form">
            <q-input
              v-if="!hasPin"
              v-model="newPin"
              type="password"
              label="Set PIN"
              outlined
              :rules="[val => val.length >= 4 || 'PIN must be at least 4 digits']"
              mask="####"
              class="pin-input"
            />
            <q-input
              v-else
              v-model="currentPin"
              type="password"
              label="Current PIN"
              outlined
              :rules="[val => val.length >= 4 || 'PIN must be at least 4 digits']"
              mask="####"
              class="pin-input"
            />
            <q-input
              v-if="hasPin"
              v-model="newPin"
              type="password"
              label="New PIN"
              outlined
              :rules="[val => val.length >= 4 || 'PIN must be at least 4 digits']"
              mask="####"
              class="pin-input"
            />
            <q-btn
              color="primary"
              label="Save PIN"
              class="save-pin-btn"
              :disable="!isPinValid"
              @click="savePin"
              unelevated
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Wallets Dialog -->
    <q-dialog v-model="showWalletsSheet" class="settings-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="dialog-title">Manage Wallets</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="wallets-list">
            <div v-if="walletState.connectedWallets.length === 0" class="no-wallets">
              <q-icon name="las la-wallet" size="48px" class="no-wallets-icon"/>
              <div class="no-wallets-text">No wallets connected yet</div>
            </div>

            <div 
              v-for="wallet in walletState.connectedWallets"
              :key="wallet.id"
              class="wallet-item"
            >
              <div class="wallet-icon">
                <q-icon name="las la-wallet" size="24px"/>
              </div>
              <div class="wallet-info">
                <q-input
                  v-model="wallet.name"
                  dense
                  borderless
                  @blur="updateWalletName(wallet)"
                  class="wallet-name-input"
                />
                <div class="wallet-balance">{{ formatBalance(wallet.balance) }}</div>
              </div>
              <div class="wallet-actions">
                <q-btn
                  flat
                  dense
                  :color="walletState.activeWalletId === wallet.id ? 'primary' : 'grey'"
                  :icon="walletState.activeWalletId === wallet.id ? 'las la-check-circle' : 'las la-circle'"
                  @click="switchActiveWallet(wallet.id)"
                  class="active-btn"
                />
                <q-btn
                  flat
                  dense
                  color="negative"
                  icon="las la-trash-alt"
                  @click="confirmDeleteWallet(wallet.id)"
                  class="delete-btn"
                />
              </div>
            </div>
          </div>

          <q-btn 
            class="connect-wallet-btn" 
            outline 
            color="primary"
            no-caps 
            @click="connectNewWallet"
            unelevated
          >
            <q-icon name="las la-plus" class="q-mr-sm"/>
            Connect a Wallet
          </q-btn>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import {webln} from "@getalby/sdk";

export default {
  name: 'SettingsPage',
  data() {
    return {
      walletState: {
        balance: 0,
        connectedWallets: [],
        activeWalletId: null,
        currency: 'sats',
        currencies: ['sats', 'btc', 'usd'],
        exchangeRates: {
          usd: 65000,
          eur: 60000,
          gbp: 52000,
          jpy: 9800000
        },
        preferredFiatCurrency: 'USD',
        denominationCurrency: 'sats'
      },
      showWalletsSheet: false,
      showCurrencyDialog: false,
      showNotificationsDialog: false,
      showSecurityDialog: false,
      notificationsEnabled: true,
      hasNotificationPermission: false,
      pinEnabled: false,
      hasPin: false,
      currentPin: '',
      newPin: '',
    }
  },
  computed: {
    isPinValid() {
      if (!this.hasPin) {
        return this.newPin.length >= 4;
      }
      return this.currentPin.length >= 4 && this.newPin.length >= 4;
    }
  },
  created() {
    this.loadWalletState();
    this.loadPinState();
    this.checkNotificationPermission();
  },
  methods: {
    async loadWalletState() {
      const savedState = localStorage.getItem('buhoGO_wallet_state');
      if (savedState) {
        try {
          const parsedState = JSON.parse(savedState);
          this.walletState = parsedState;

          for (const wallet of this.walletState.connectedWallets) {
            if (wallet.type === 'nwc' && wallet.nwcString) {
              try {
                const nwc = new webln.NostrWebLNProvider({
                  nostrWalletConnectUrl: wallet.nwcString,
                });
                
                await Promise.race([
                  nwc.enable(),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Connection timeout')), 8000)
                  )
                ]);
                
                const balance = await Promise.race([
                  nwc.getBalance(),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Balance request timeout')), 6000)
                  )
                ]);
                
                wallet.balance = balance.balance;
              } catch (error) {
                console.error(`Failed to update balance for wallet ${wallet.id}:`, error);
                wallet.balance = wallet.balance || 0;
              }
            }
          }

          localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
        } catch (error) {
          console.error('Failed to load wallet state:', error);
          this.walletState = {
            balance: 0,
            connectedWallets: [],
            activeWalletId: null,
            currency: 'sats',
            currencies: ['sats', 'btc', 'usd'],
            exchangeRates: {
              usd: 65000,
              eur: 60000,
              gbp: 52000,
              jpy: 9800000
            },
            preferredFiatCurrency: 'USD',
            denominationCurrency: 'sats'
          };
        }
      }
    },

    setPreferredCurrency(currency) {
      this.walletState.preferredFiatCurrency = currency;
      this.showCurrencyDialog = false;
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
    },

    getCurrencySymbol(currency) {
      const symbols = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        JPY: '¥'
      }
      return symbols[currency] || currency
    },

    formatBalance(balance) {
      switch (this.walletState.currency) {
        case 'btc':
          return (balance / 100000000).toFixed(8) + ' BTC'
        case 'usd':
          const usdValue = (balance / 100000000) * (this.walletState.exchangeRates.usd || 65000)
          return '$' + usdValue.toFixed(2)
        case 'sats':
        default:
          return balance.toLocaleString() + ' sats'
      }
    },

    connectNewWallet() {
      this.$router.push('/');
    },

    async confirmDisconnect() {
      this.$q.dialog({
        title: 'Disconnect Wallets',
        message: 'Are you sure you want to disconnect all wallets?',
        cancel: true,
        persistent: true
      }).onOk(async () => {
        try {
          localStorage.removeItem('buhoGO_wallet_state');

          this.walletState = {
            balance: 0,
            connectedWallets: [],
            activeWalletId: null,
            currency: 'sats',
            currencies: ['sats', 'btc', 'usd'],
            exchangeRates: {
              usd: 65000,
              eur: 60000,
              gbp: 52000,
              jpy: 9800000
            },
            preferredFiatCurrency: 'USD',
            denominationCurrency: 'sats'
          };

          this.$q.notify({
            type: 'positive',
            message: 'All wallets disconnected successfully',
            position: 'top'
          });

          this.$router.push('/');
        } catch (error) {
          console.error('Error disconnecting wallets:', error);
          this.$q.notify({
            type: 'negative',
            message: 'Failed to disconnect wallets',
            position: 'top'
          });
        }
      });
    },

    handleWalletClick() {
      this.showWalletsSheet = true;
    },

    updateWalletName(wallet) {
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
    },

    switchActiveWallet(walletId) {
      this.walletState.activeWalletId = walletId;
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
      this.loadWalletState();
    },

    confirmDeleteWallet(walletId) {
      this.$q.dialog({
        title: 'Delete Wallet',
        message: 'Are you sure you want to delete this wallet?',
        cancel: true,
        persistent: true
      }).onOk(() => {
        this.walletState.connectedWallets = this.walletState.connectedWallets.filter(
          wallet => wallet.id !== walletId
        );

        if (this.walletState.activeWalletId === walletId) {
          this.walletState.activeWalletId = this.walletState.connectedWallets[0]?.id || null;
        }

        localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

        this.$q.notify({
          type: 'positive',
          message: 'Wallet deleted successfully',
          position: 'top'
        });
      });
    },

    loadPinState() {
      const pinState = localStorage.getItem('buhoGO_pin_state');
      if (pinState) {
        const { enabled, pin } = JSON.parse(pinState);
        this.pinEnabled = enabled;
        this.hasPin = !!pin;
      }
    },

    handlePinToggle(enabled) {
      if (enabled && !this.hasPin) {
        this.newPin = '';
      } else if (!enabled) {
        this.$q.dialog({
          title: 'Disable PIN Protection',
          message: 'Are you sure you want to disable PIN protection?',
          cancel: true,
          persistent: true
        }).onOk(() => {
          localStorage.removeItem('buhoGO_pin_state');
          this.hasPin = false;
          this.currentPin = '';
          this.newPin = '';
        }).onCancel(() => {
          this.pinEnabled = true;
        });
      }
    },

    savePin() {
      if (!this.hasPin) {
        localStorage.setItem('buhoGO_pin_state', JSON.stringify({
          enabled: true,
          pin: this.newPin
        }));
        this.hasPin = true;
        this.newPin = '';
        this.$q.notify({
          type: 'positive',
          message: 'PIN set successfully',
          position: 'top'
        });
      } else {
        const pinState = JSON.parse(localStorage.getItem('buhoGO_pin_state'));
        if (pinState.pin !== this.currentPin) {
          this.$q.notify({
            type: 'negative',
            message: 'Current PIN is incorrect',
            position: 'top'
          });
          return;
        }

        localStorage.setItem('buhoGO_pin_state', JSON.stringify({
          enabled: true,
          pin: this.newPin
        }));
        this.currentPin = '';
        this.newPin = '';
        this.$q.notify({
          type: 'positive',
          message: 'PIN changed successfully',
          position: 'top'
        });
      }
    },

    async checkNotificationPermission() {
      if ('Notification' in window) {
        this.hasNotificationPermission = Notification.permission === 'granted';
        this.notificationsEnabled = this.hasNotificationPermission;
      }
    },

    async requestNotificationPermission() {
      try {
        const permission = await Notification.requestPermission();
        this.hasNotificationPermission = permission === 'granted';
        this.notificationsEnabled = this.hasNotificationPermission;

        if (this.hasNotificationPermission) {
          if ('serviceWorker' in navigator) {
            try {
              const registration = await navigator.serviceWorker.register('/service-worker.js');
              console.log('Service Worker registered:', registration);
            } catch (error) {
              console.error('Service Worker registration failed:', error);
            }
          }
        }
      } catch (error) {
        console.error('Error requesting notification permission:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to enable notifications',
          position: 'top'
        });
      }
    },

    handleNotificationsToggle(enabled) {
      if (enabled && !this.hasNotificationPermission) {
        this.requestNotificationPermission();
      } else if (!enabled) {
        this.$q.dialog({
          title: 'Disable Notifications',
          message: 'Are you sure you want to disable notifications?',
          cancel: true,
          persistent: true
        }).onOk(() => {
          this.notificationsEnabled = false;
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
              registrations.forEach(registration => {
                registration.unregister();
              });
            });
          }
        }).onCancel(() => {
          this.notificationsEnabled = true;
        });
      }
    }
  }
}
</script>

<style scoped>
.settings-page {
  background: #f8f9fa;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.settings-header {
  background: white;
  padding: 1rem;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.back-btn {
  color: #6b7280;
  transition: all 0.2s ease;
}

.back-btn:hover {
  color: #374151;
  background: #f3f4f6;
}

.header-content {
  flex: 1;
  display: flex;
  justify-content: center;
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo {
  filter: drop-shadow(0 2px 4px rgba(5, 149, 115, 0.15));
}

.title {
  font-size: 1.25rem;
  font-weight: 700;
  background: linear-gradient(135deg, #059573, #78D53C);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.header-spacer {
  width: 40px;
}

/* Content */
.settings-content {
  flex: 1;
  padding: 1rem;
  padding-bottom: 6rem;
}

.settings-section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #374151;
  margin-bottom: 1rem;
  padding-left: 0.5rem;
}

.section-card {
  background: white;
  border-radius: 16px;
  padding: 1rem;
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid #f3f4f6;
}

.section-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  border-color: #e5e7eb;
}

.section-card:active {
  transform: translateY(0);
}

.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.wallet-icon {
  background: linear-gradient(135deg, #059573, #43B65B);
  color: white;
}

.currency-icon {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: white;
}

.notifications-icon {
  background: linear-gradient(135deg, #F59E0B, #D97706);
  color: white;
}

.security-icon {
  background: linear-gradient(135deg, #EF4444, #DC2626);
  color: white;
}

.security-icon-disabled {
  background: linear-gradient(135deg, #9CA3AF, #6B7280);
  color: white;
}

.card-content {
  flex: 1;
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.card-subtitle {
  font-size: 0.875rem;
  color: #6b7280;
}

.chevron-icon {
  color: #9ca3af;
}

/* Coming Soon Badge */
.coming-soon-badge {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.disabled-card {
  opacity: 0.6;
  cursor: not-allowed;
}

.disabled-card:hover {
  transform: none;
  box-shadow: none;
  border-color: #f3f4f6;
}

/* Disconnect Section */
.disconnect-section {
  background: white;
  padding: 1rem;
  border-top: 1px solid #e5e7eb;
}

.disconnect-container {
  max-width: 400px;
  margin: 0 auto;
}

.disconnect-warning {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: #FEF3C7;
  border: 1px solid #F59E0B;
  border-radius: 12px;
  margin-bottom: 1rem;
}

.warning-icon {
  color: #F59E0B;
  font-size: 20px;
  flex-shrink: 0;
}

.warning-content {
  flex: 1;
}

.warning-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #92400E;
  margin-bottom: 0.125rem;
}

.warning-subtitle {
  font-size: 0.75rem;
  color: #B45309;
}

.disconnect-btn {
  width: 100%;
  height: 52px;
  border-radius: 12px;
  font-weight: 500;
  background: #FEF2F2;
  color: #DC2626;
  border: 1px solid #FECACA;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.disconnect-btn:hover {
  background: #FEE2E2;
  border-color: #FCA5A5;
  transform: translateY(-1px);
}

.disconnect-btn:active {
  background: #DC2626;
  color: white;
  border-color: #DC2626;
}

.disconnect-icon {
  font-size: 18px;
}

.disconnect-text {
  font-size: 0.9rem;
  font-weight: 500;
}

/* Dialog Styles */
.dialog-card {
  width: 100%;
  max-width: 480px;
  border-radius: 20px;
  overflow: hidden;
}

.dialog-header {
  background: #f8f9fa;
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e5e7eb;
}

.dialog-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
}

.close-btn {
  color: #6b7280;
}

.dialog-content {
  padding: 1.5rem;
}

/* Currency Dialog */
.currency-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.currency-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-radius: 12px;
  border: 2px solid #f3f4f6;
  cursor: pointer;
  transition: all 0.2s ease;
}

.currency-item:hover {
  border-color: #e5e7eb;
  background: #f9fafb;
}

.currency-item.active {
  border-color: #059573;
  background: rgba(5, 149, 115, 0.05);
}

.currency-info {
  flex: 1;
}

.currency-code {
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.currency-rate {
  font-size: 0.875rem;
  color: #6b7280;
}

.check-icon {
  color: #059573;
  font-size: 20px;
}

/* Notification Dialog */
.notification-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.notification-info {
  flex: 1;
}

.notification-title {
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.notification-subtitle {
  font-size: 0.875rem;
  color: #6b7280;
}

.permission-warning {
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 12px;
  padding: 1rem;
}

.warning-content {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.warning-icon {
  color: #f59e0b;
  font-size: 24px;
  flex-shrink: 0;
}

.warning-text {
  flex: 1;
}

.warning-title {
  font-weight: 600;
  color: #92400e;
  margin-bottom: 0.25rem;
}

.warning-subtitle {
  font-size: 0.875rem;
  color: #b45309;
}

.enable-btn {
  color: #f59e0b;
  font-weight: 500;
}

/* Security Dialog */
.security-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.security-info {
  flex: 1;
}

.security-title {
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.security-subtitle {
  font-size: 0.875rem;
  color: #6b7280;
}

.pin-form {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.pin-input {
  margin-bottom: 0.5rem;
}

.save-pin-btn {
  background: linear-gradient(135deg, #059573, #43B65B);
  color: white;
  height: 48px;
  border-radius: 12px;
  font-weight: 500;
}

/* Wallets Dialog */
.wallets-list {
  margin-bottom: 1.5rem;
}

.no-wallets {
  text-align: center;
  padding: 2rem;
  color: #9ca3af;
}

.no-wallets-icon {
  margin-bottom: 1rem;
  opacity: 0.5;
}

.no-wallets-text {
  font-size: 1rem;
  font-weight: 500;
}

.wallet-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 12px;
  margin-bottom: 0.75rem;
  border: 1px solid #e5e7eb;
}

.wallet-icon {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #059573, #43B65B);
  color: white;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.wallet-info {
  flex: 1;
}

.wallet-name-input {
  font-weight: 600;
  color: #1f2937;
}

.wallet-name-input :deep(.q-field__control) {
  min-height: 0;
  padding: 0;
}

.wallet-name-input :deep(.q-field__native) {
  padding: 0;
  font-size: 1rem;
}

.wallet-balance {
  font-size: 0.875rem;
  color: #6b7280;
  margin-top: 0.25rem;
}

.wallet-actions {
  display: flex;
  gap: 0.5rem;
}

.active-btn,
.delete-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
}

.connect-wallet-btn {
  width: 100%;
  height: 48px;
  border-radius: 12px;
  font-weight: 500;
  border-color: #059573;
  color: #059573;
  transition: all 0.2s ease;
}

.connect-wallet-btn:hover {
  background: #059573;
  color: white;
  transform: translateY(-1px);
}

/* Responsive Design */
@media (max-width: 480px) {
  .settings-content {
    padding: 0.75rem;
    padding-bottom: 5rem;
  }
  
  .section-card {
    padding: 0.75rem;
  }
  
  .card-icon {
    width: 40px;
    height: 40px;
  }
  
  .dialog-header,
  .dialog-content {
    padding: 1rem;
  }
  
  .currency-item,
  .wallet-item {
    padding: 0.75rem;
  }
  
  .pin-form {
    padding: 1rem;
  }
}
</style>