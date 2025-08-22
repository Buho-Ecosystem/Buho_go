<template>
  <q-page>
    <!-- Header -->
    <q-toolbar class="settings-header">
      <q-btn flat round dense icon="las la-arrow-left" class="q-mr-sm" @click="$router.back()"/>
      <div class="logo-container">
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="32" viewBox="0 0 30 32" fill="none">
          <path d="M0 13.4423C0 6.01833 6.01833 0 13.4423 0V18.5577C13.4423 25.9817 7.42399 32 0 32V13.4423Z"
                fill="#059573"/>
          <path
            d="M15.3906 7.30444C15.3906 3.27031 18.6609 0 22.6951 0C26.7292 0 29.9995 3.27031 29.9995 7.30444V7.72091C29.9995 11.755 26.7292 15.0253 22.6951 15.0253C18.6609 15.0253 15.3906 11.755 15.3906 7.72091V7.30444Z"
            fill="#78D53C"/>
          <path
            d="M15.3906 24.281C15.3906 20.2469 18.6609 16.9766 22.6951 16.9766C26.7292 16.9766 29.9995 20.2469 29.9995 24.281V24.6975C29.9995 28.7316 26.7292 32.0019 22.6951 32.0019C18.6609 32.0019 15.3906 28.7316 15.3906 24.6975V24.281Z"
            fill="#43B65B"/>
        </svg>
        <div class="title">BuhoGO</div>
      </div>
      <q-space/>
    </q-toolbar>

    <!-- Settings Content -->
    <div class="settings-content">
      <!-- Wallet Management Card -->
      <q-card class="settings-card no-shadow" bordered @click="handleWalletClick">
        <q-card-section class="settings-card-content">
          <div class="settings-item">
            <div class="settings-item-icon wallet-icon">
              <q-icon name="las la-wallet"/>
            </div>
            <div class="settings-item-text">
              <div class="settings-item-title">Manage Wallets</div>
              <div class="settings-item-subtitle">
                {{ walletState.connectedWallets.length }}
                {{ walletState.connectedWallets.length === 1 ? 'wallet' : 'wallets' }} connected
              </div>
            </div>
          </div>
          <q-icon name="las la-chevron-right" size="xs" class="settings-item-arrow"/>
        </q-card-section>
      </q-card>

      <!-- Preferences Section -->
      <div class="settings-section">
        <h3 class="settings-section-title">Preferences</h3>

        <!-- Currency Settings -->
        <q-card class="settings-card no-shadow" bordered @click="showCurrencyDialog = true">
          <q-card-section class="settings-card-content">
            <div class="settings-item">
              <div class="settings-item-icon currency-icon">
                <q-icon name="las la-dollar-sign"/>
              </div>
              <div class="settings-item-text">
                <div class="settings-item-title">Currency</div>
                <div class="settings-item-subtitle">{{ walletState.preferredFiatCurrency }}</div>
              </div>
            </div>
            <q-icon name="las la-chevron-right" size="xs" class="settings-item-arrow"/>
          </q-card-section>
        </q-card>

        <!-- Notifications Settings -->
        <q-card class="settings-card no-shadow" bordered @click="showNotificationsDialog = true">
          <q-card-section class="settings-card-content">
            <div class="settings-item">
              <div class="settings-item-icon notifications-icon">
                <q-icon name="las la-bell"/>
              </div>
              <div class="settings-item-text">
                <div class="settings-item-title">Notifications</div>
                <div class="settings-item-subtitle">Payment alerts</div>
              </div>
            </div>
            <q-icon name="las la-chevron-right" size="xs" class="settings-item-arrow"/>
          </q-card-section>
        </q-card>

        <!-- Security Settings -->
        <q-card class="settings-card no-shadow" bordered @click="showSecurityDialog = true">
          <q-card-section class="settings-card-content">
            <div class="settings-item">
              <div class="settings-item-icon security-icon">
                <q-icon name="las la-shield-alt"/>
              </div>
              <div class="settings-item-text">
                <div class="settings-item-title">Security</div>
                <div class="settings-item-subtitle">PIN protection</div>
              </div>
            </div>
            <q-icon name="las la-chevron-right" size="xs" class="settings-item-arrow"/>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Disconnect Button -->
    <div class="disconnect-container">
      <q-btn outline color="negative" no-caps class="disconnect-btn" @click="confirmDisconnect">
        <q-icon name="las la-trash-alt" class="q-mr-xs"/>
        Disconnect All Wallets
      </q-btn>
    </div>

    <!-- Settings Dialogs -->
    <!-- Currency Dialog -->
    <q-dialog v-model="showCurrencyDialog">
      <q-card class="settings-dialog">
        <q-card-section class="dialog-header">
          <div class="text-h6">Currency Settings</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="currency-options">
            <q-item
              v-for="currency in ['USD', 'EUR', 'GBP', 'JPY']"
              :key="currency"
              clickable
              v-ripple
              :active="walletState.preferredFiatCurrency === currency"
              @click="setPreferredCurrency(currency)"
              class="currency-item"
            >
              <q-item-section>
                <q-item-label>{{ currency }}</q-item-label>
                <q-item-label caption>{{ getCurrencySymbol(currency) }}1 =
                  {{ walletState.exchangeRates[currency.toLowerCase()] }} sats
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon name="las la-check" v-if="walletState.preferredFiatCurrency === currency"/>
              </q-item-section>
            </q-item>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Notifications Dialog -->
    <q-dialog v-model="showNotificationsDialog">
      <q-card class="settings-dialog">
        <q-card-section class="dialog-header">
          <div class="text-h6">Notification Settings</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="notification-options">
            <q-item>
              <q-item-section>
                <q-item-label>Payment Notifications</q-item-label>
                <q-item-label caption>Receive alerts for incoming and outgoing payments</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-toggle v-model="notificationsEnabled" @update:model-value="handleNotificationsToggle"/>
              </q-item-section>
            </q-item>

            <div v-if="!hasNotificationPermission" class="permission-warning q-mt-md">
              <q-banner dense class="bg-warning text-white">
                <template v-slot:avatar>
                  <q-icon name="las la-exclamation-triangle"/>
                </template>
                Notifications are disabled. Please enable them in your browser settings.
                <template v-slot:action>
                  <q-btn flat color="white" label="Enable" @click="requestNotificationPermission"/>
                </template>
              </q-banner>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Security Dialog -->
    <q-dialog v-model="showSecurityDialog">
      <q-card class="settings-dialog">
        <q-card-section class="dialog-header">
          <div class="text-h6">Security Settings</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="security-options">
            <q-item>
              <q-item-section>
                <q-item-label>PIN Protection</q-item-label>
                <q-item-label caption>Require PIN for transactions</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-toggle v-model="pinEnabled" @update:model-value="handlePinToggle"/>
              </q-item-section>
            </q-item>

            <!-- PIN Setup/Change Form -->
            <div v-if="pinEnabled" class="pin-form q-mt-md">
              <q-input
                v-if="!hasPin"
                v-model="newPin"
                type="password"
                label="Set PIN"
                :rules="[val => val.length >= 4 || 'PIN must be at least 4 digits']"
                mask="####"
                class="q-mb-sm"
              />
              <q-input
                v-else
                v-model="currentPin"
                type="password"
                label="Current PIN"
                :rules="[val => val.length >= 4 || 'PIN must be at least 4 digits']"
                mask="####"
                class="q-mb-sm"
              />
              <q-input
                v-if="hasPin"
                v-model="newPin"
                type="password"
                label="New PIN"
                :rules="[val => val.length >= 4 || 'PIN must be at least 4 digits']"
                mask="####"
                class="q-mb-sm"
              />
              <q-btn
                color="primary"
                label="Save PIN"
                class="full-width"
                :disable="!isPinValid"
                @click="savePin"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Wallets Dialog -->
    <q-dialog v-model="showWalletsSheet">
      <q-card class="settings-dialog">
        <q-card-section class="dialog-header">
          <div class="text-h6">Manage Wallets</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="wallets-list">
            <template v-if="walletState.connectedWallets.length === 0">
              <div class="no-wallets">No wallets connected yet</div>
            </template>

            <template v-else>
              <q-card
                v-for="wallet in walletState.connectedWallets"
                :key="wallet.id"
                class="wallet-card no-shadow"
                bordered
              >
                <q-card-section class="wallet-card-content">
                  <div class="wallet-info">
                    <div class="wallet-icon">
                      <q-icon name="las la-wallet"/>
                    </div>
                    <div class="wallet-details">
                      <div class="wallet-name">
                        <q-input
                          v-model="wallet.name"
                          dense
                          borderless
                          @blur="updateWalletName(wallet)"
                          class="wallet-name-input"
                        />
                      </div>
                      <div class="wallet-balance">{{ formatBalance(wallet.balance) }}</div>
                    </div>
                  </div>
                  <div class="wallet-actions">
                    <q-btn
                      flat
                      dense
                      :color="walletState.activeWalletId === wallet.id ? 'primary' : 'grey'"
                      :icon="walletState.activeWalletId === wallet.id ? 'las la-check-circle' : 'las la-circle'"
                      @click="switchActiveWallet(wallet.id)"
                      class="q-mr-sm"
                    />
                    <q-btn
                      flat
                      dense
                      color="negative"
                      icon="las la-trash-alt"
                      @click="confirmDeleteWallet(wallet.id)"
                    />
                  </div>
                </q-card-section>
              </q-card>
            </template>
          </div>

          <q-btn class="connect-wallet-btn" outline no-caps @click="connectNewWallet">
            <q-icon name="las la-plus" class="q-mr-xs"/>
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

          // Update balances for all connected wallets
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
                // Keep the existing balance if we can't update it
                wallet.balance = wallet.balance || 0;
              }
            }
          }

          // Save the updated state
          localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
        } catch (error) {
          console.error('Failed to load wallet state:', error);
          // Reset to default state if there's an error
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
      console.log(this.walletState)
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
    viewWalletDetails(walletId) {
      // Implement wallet details view logic
      console.log('Viewing wallet details:', walletId)
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
          // Clear localStorage
          localStorage.removeItem('buhoGO_wallet_state');

          // Reset wallet state
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

          // Navigate to home page
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
      console.log('Wallet management clicked');
      this.showWalletsSheet = true;
    },
    updateWalletName(wallet) {
      // Save the updated wallet state
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
    },
    switchActiveWallet(walletId) {
      this.walletState.activeWalletId = walletId;
      // Save the updated wallet state
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

      // Refresh the wallet state to update balances
      this.loadWalletState();
    },
    confirmDeleteWallet(walletId) {
      this.$q.dialog({
        title: 'Delete Wallet',
        message: 'Are you sure you want to delete this wallet?',
        cancel: true,
        persistent: true
      }).onOk(() => {
        // Remove the wallet from the list
        this.walletState.connectedWallets = this.walletState.connectedWallets.filter(
          wallet => wallet.id !== walletId
        );

        // If the deleted wallet was active, set a new active wallet
        if (this.walletState.activeWalletId === walletId) {
          this.walletState.activeWalletId = this.walletState.connectedWallets[0]?.id || null;
        }

        // Save the updated wallet state
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
        // Setting PIN for the first time
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
        // Changing existing PIN
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
    verifyPin(pin) {
      const pinState = localStorage.getItem('buhoGO_pin_state');
      if (!pinState) return false;

      const { pin: savedPin } = JSON.parse(pinState);
      return pin === savedPin;
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
          // Register service worker for notifications
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
          // You might want to unregister the service worker here
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
    },
    // Helper method to send notifications
    async sendNotification(title, body, url = '/') {
      if (!this.notificationsEnabled || !this.hasNotificationPermission) return;

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          registration.showNotification(title, {
            body,
            icon: '/icons/icon-192x192.png',
            badge: '/icons/badge-72x72.png',
            vibrate: [100, 50, 100],
            data: { url }
          });
        }
      } catch (error) {
        console.error('Error sending notification:', error);
      }
    }
  }
}
</script>

<style scoped>
/* Dialog Styles */
.settings-dialog {
  width: 100%;
  max-width: 500px;
  border-radius: 1rem;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
}

.dialog-content {
  padding: 1rem;
  max-height: 80vh;
  overflow-y: auto;
}

.currency-options,
.notification-options,
.security-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.currency-item {
  border-radius: 0.5rem;
  margin-bottom: 0.5rem;
  border: 1px solid rgba(229, 231, 235, 0.5);
}

.currency-item.active {
  background-color: rgba(16, 185, 129, 0.05);
  border-color: rgba(16, 185, 129, 0.3);
}

/* Settings Content Styles */
.settings-content {
  padding: 1rem;
  padding-top: 0.5rem;
  padding-bottom: 5rem; /* Add padding to prevent content from being hidden behind fixed button */
}

.settings-section {
  margin-top: 2rem;
}

.settings-section-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: #1f2937;
}

.settings-card {
  margin-bottom: 1rem;
  border-radius: 0.75rem;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s;
}

.settings-card:hover {
  transform: translateY(-2px);
}

.settings-card-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
}

.settings-item {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.settings-item-icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(5, 149, 115, 0.1);
  color: #059573;
}

.settings-item-text {
  flex: 1;
}

.settings-item-title {
  font-weight: 500;
  color: #1f2937;
}

.settings-item-subtitle {
  font-size: 0.875rem;
  color: #6b7280;
}

.settings-item-arrow {
  color: #9ca3af;
}

/* Disconnect Button Styles */
.disconnect-container {
  padding: 1rem;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background-color: white;
  border-top: 1px solid rgba(229, 231, 235, 0.5);
  z-index: 1000;
}

.disconnect-btn {
  width: 100%;
}

/* Wallet List Styles */
.wallets-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.no-wallets {
  text-align: center;
  padding: 2rem;
  color: #6b7280;
}

.wallet-card {
  border-radius: 0.75rem;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s;
}

.wallet-card:hover {
  transform: translateY(-2px);
}

.wallet-card-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
}

.wallet-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.wallet-icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(5, 149, 115, 0.1);
  color: #059573;
}

.wallet-details {
  flex: 1;
}

.wallet-name {
  font-weight: 500;
  color: #1f2937;
}

.wallet-balance {
  font-size: 0.875rem;
  color: #6b7280;
}

.wallet-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.wallet-name-input {
  font-weight: 500;
  color: #1f2937;
}

.wallet-name-input :deep(.q-field__control) {
  min-height: 0;
}

.wallet-name-input :deep(.q-field__native) {
  padding: 0;
}

.connect-wallet-btn {
  width: 100%;
  margin-top: 1rem;
}

.settings-header {
  padding: 0.5rem 1rem;
  background-color: white;
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
}

.settings-header .logo-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.settings-header .logo {
  width: 24px;
  height: 24px;
}

.settings-header .title {
  font-size: 1.25rem;
  font-weight: 700;
  background: linear-gradient(135deg, #059573, #047857);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
}
</style>
