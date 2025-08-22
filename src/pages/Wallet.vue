<template>
  <q-page class="wallet-dashboard-page">
    <!-- Header -->
    <q-toolbar class="">
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
      <q-btn round flat icon="las la-cog" class="settings-btn" @click="$router.push('/settings')"/>
    </q-toolbar>

    <!-- Wallet Card -->
    <div class="wallet-card-container">
      <q-card class="wallet-card">
        <q-card-section class="wallet-card-content">
          <div class="wallet-info">
            <p class="text-caption text-white text-opacity-80">Current Balance</p>
            <h2 class="balance">
              <q-skeleton v-if="isLoading" type="text" width="150px"/>
              <template v-else>{{ formatBalance(walletState.balance) }}</template>
            </h2>
          </div>
          <p class="wallet-name">
            <q-skeleton v-if="isLoading" type="text" width="100px"/>
            <template v-else>{{ activeWallet?.name || 'Your Wallet' }}</template>
          </p>

          <div class="wallet-actions">
            <q-btn flat round dense color="white" icon="las la-ellipsis-h" @click="showWalletInfo = !showWalletInfo"/>
          </div>

          <!-- Wallet Info Popup -->
          <div class="wallet-info-popup" v-if="showWalletInfo">
            <div class="q-mt-sm row">
              <div class="col-12">
                <div class="text-subtitle2 text-white">Wallet Details
                  <q-btn flat round dense color="white" class="float-right" icon="las la-times" size="sm"
                         @click="showWalletInfo = false"/>
                </div>
              </div>
            </div>

            <div class="wallet-info-content q-mt-sm">
              <q-item dense class="wallet-info-item">
                <q-item-section class="text-caption text-white text-opacity-70">Status:</q-item-section>
                <div class="wallet-status">
                  <q-skeleton v-if="isLoading" type="text" width="60px"/>
                  <template v-else>
                    <q-icon name="las la-check-circle" size="xs" color="green-4" v-if="isActiveWallet"/>
                    <q-icon name="las la-circle" size="xs" color="grey-5" v-else/>
                    <span :class="isActiveWallet ? 'text-green-4' : 'text-grey-5'">
                      {{ isActiveWallet ? 'Active' : 'Inactive' }}
                    </span>
                  </template>
                </div>
              </q-item>

              <div class="wallet-info-item">
                <span class="text-caption text-white text-opacity-70">Connected Since:</span>
                <span class="text-caption text-white">
                  <q-skeleton v-if="isLoading" type="text" width="80px"/>
                  <template v-else>{{ formatDate() }}</template>
                </span>
              </div>
            </div>

            <div class="wallet-info-footer" v-if="!isActiveWallet">
              <q-btn class="activate-btn" label="Activate This Wallet" @click="activateWallet"/>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Transaction History -->
    <div class="transaction-history">
      <div v-if="transactionError && !isLoading" class="error-banner q-pa-md">
        <q-banner dense class="bg-warning text-white">
          <template v-slot:avatar>
            <q-icon name="las la-exclamation-triangle"/>
          </template>
          {{ transactionError }}
          <template v-slot:action>
            <q-btn flat color="white" label="Retry" @click="loadWalletState" size="sm"/>
          </template>
        </q-banner>
      </div>
      
      <div v-if="isLoading" class="q-pa-md">
        <q-item v-for="i in 3" :key="i" class="transaction-item">
          <q-item-section avatar>
            <q-skeleton type="QAvatar"/>
          </q-item-section>

          <q-item-section>
            <q-item-label>
              <q-skeleton type="text"/>
            </q-item-label>
            <q-item-label caption>
              <q-skeleton type="text" width="65%"/>
            </q-item-label>
          </q-item-section>

          <q-item-section side>
            <q-item-label>
              <q-skeleton type="text" width="80px"/>
            </q-item-label>
          </q-item-section>
        </q-item>
      </div>
      <div v-else-if="transactions.length === 0" class="no-transactions">
        <div class="text-center q-pa-lg">
          <q-icon name="las la-receipt" size="3rem" color="grey-5" class="q-mb-md"/>
          <div class="text-h6 text-grey-7 q-mb-sm">No transactions yet</div>
          <div class="text-caption text-grey-6">
            {{ transactionError ? 'Unable to load transactions' : 'Your transactions will appear here' }}
          </div>
          <q-btn v-if="transactionError" flat color="primary" label="Try Again" @click="loadWalletState" class="q-mt-md"/>
        </div>
      </div>
      <q-scroll-area v-else class="transaction-scroll-area q-pb-xl">
        <q-list>
          <q-item v-for="tx in transactions" :key="tx.id" clickable v-ripple @click="viewTransaction(tx.id)"
                  class="transaction-item">
            <q-item-section side>
              <q-avatar :color="tx.type === 'incoming' ? 'green-1' : 'grey-3'" text-color="grey-9"
                        class="">
                <q-icon :name="tx.type === 'incoming' ? 'las la-arrow-down' : 'las la-arrow-up'"
                        :color="tx.type === 'incoming' ? 'green-8' : 'grey-7'"/>
              </q-avatar>
            </q-item-section>

            <q-item-section>
              <q-item-label>{{ tx.description }}</q-item-label>
              <q-item-label caption>{{ formatTransactionDate(tx.settled_at) }}</q-item-label>
            </q-item-section>

            <q-item-section side>
              <q-item-label :class="tx.type === 'incoming' ? 'text-green-8' : 'text-grey-8'" class="text-weight-medium">
                {{ tx.type === 'incoming' ? '+' : '-' }} {{ formatBalance(tx.amount) }}
              </q-item-label>
              <q-icon name="las la-chevron-right" size="xs" color="grey-5"/>
            </q-item-section>
          </q-item>
        </q-list>

        <div class="fixed fixed-bottom bg-white">
          <q-btn flat class=" view-all-btn" no-caps label="View All Transactions"
                 @click="$router.push('/transaction-history')"/>
        </div>
      </q-scroll-area>

    </div>

    <!-- Bottom Action Buttons -->
    <div class="bottom-actions">
      <q-btn class="action-btn receive-btn" no-caps @click="openPaymentSheet('receive')">
        <div class="btn-content">
          <div class="icon-container">
            <div class="icon-glow"></div>
            <div class="icon-bg">
              <q-icon name="las la-arrow-down" size="md"/>
            </div>
          </div>
          <span>Receive</span>
        </div>
      </q-btn>

      <q-btn class="action-btn send-btn" no-caps @click="openPaymentSheet('send')">
        <div class="btn-content">
          <div class="icon-container">
            <div class="icon-glow"></div>
            <div class="icon-bg">
              <q-icon name="las la-arrow-up" size="md"/>
            </div>
          </div>
          <span>Send</span>
        </div>
      </q-btn>
    </div>

    <!-- Payment Dialogs -->
    <!-- Receive Payment Dialog -->
    <q-dialog v-model="paymentSheetOpen" v-if="paymentMode === 'receive'">
      <q-card class="payment-dialog">
        <q-card-section class="dialog-header">
          <div class="text-h6">{{ paymentSheetTitle }}</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div v-if="paymentStep === 0" class="payment-step">
            <div class="form-group">
              <div class="form-label-row">
                <label>Amount</label>
                <q-btn flat dense size="sm" class="currency-toggle" @click="toggleCurrency">
                  {{ currencySymbol }} {{ walletState.denominationCurrency.toUpperCase() }}
                </q-btn>
              </div>
              <q-input
                v-model.number="amount"
                type="number"
                dense
                outlined
                :prefix="currencySymbol"
                placeholder="Enter amount"
              />
              <p v-if="amount && !isNaN(Number(amount))" class="fiat-conversion">
                ≈ {{ fiatSymbol }}{{ getFiatAmount() }} {{ walletState.preferredFiatCurrency }}
              </p>
            </div>

            <div class="form-group">
              <label>Description (optional)</label>
              <q-input
                v-model="description"
                outlined
                dense
                placeholder="What's this payment for?"
              />
            </div>

            <q-btn
              class="generate-btn"
              :loading="isProcessing"
              @click="generateInvoice"
              no-caps
            >
              <span v-if="!isProcessing">Generate Invoice</span>
              <template v-slot:loading>
                <q-spinner-dots class="q-mr-sm"/>
                Generating...
              </template>
            </q-btn>
          </div>

          <div v-if="paymentStep === 1" class="payment-step">
            <div class="invoice-amount">
              <div class="text-h4 text-weight-bold">{{ formatBalance(Number(amount)) }}</div>
              <div class="text-grey-7">{{ fiatSymbol }}{{ getFiatAmount() }} {{
                  walletState.preferredFiatCurrency
                }}
              </div>
              <div class="waiting-payment">
                <q-spinner-dots color="primary" size="1em"/>
                Waiting for payment...
              </div>
            </div>

            <div class="qr-container">
              <div class="qr-code">
                <vue-qrcode
                  :value="invoice"
                  :options="{
                    width: 300,
                    color: {
                      dark: $q.dark.isActive ? '#8AFF1C' : '#22c55e',
                      light: '#0000'
                    }
                  }"
                  class="full-width"
                />
              </div>
            </div>

            <div class="invoice-actions">
              <q-btn outline class="invoice-action-btn" icon="las la-share-alt" label="Share" @click="shareInvoice"/>
              <q-btn outline class="invoice-action-btn" icon="las la-copy" label="Copy" @click="copyInvoice"/>
            </div>
          </div>

          <div v-if="paymentStep === 2" class="payment-step success-step">
            <div class="success-icon">
              <q-icon name="las la-bolt" size="48px" color="green-8"/>
            </div>

            <div class="success-message">
              <h3 class="text-h5 text-green-8 text-weight-bold">Payment Received!</h3>
              <p class="text-grey-7">Payment was successfully received.</p>

              <div class="text-h5 text-weight-bold q-mb-xs">
                {{ formatBalance(Number(amount)) }}
              </div>
              <div class="text-caption text-grey-7">
                {{ fiatSymbol }}{{ getFiatAmount() }} {{ walletState.preferredFiatCurrency }}
              </div>
            </div>

            <q-btn class="success-btn" label="Done" v-close-popup/>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Send Payment Dialog -->
    <q-dialog v-model="paymentSheetOpen" v-if="paymentMode === 'send'">
      <q-card class="payment-dialog">
        <q-card-section class="dialog-header">
          <div class="text-h6">{{ paymentSheetTitle }}</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div v-if="paymentStep === 0 && !showQrScanner" class="payment-step">
            <div class="form-group">
              <div class="form-label-row">
                <label>Lightning Invoice</label>
                <q-btn flat dense size="sm" class="currency-toggle" @click="toggleCurrency">
                  {{ currencySymbol }} {{ walletState.denominationCurrency.toUpperCase() }}
                </q-btn>
              </div>
              <q-input
                v-model="invoice"
                outlined
                placeholder="Paste invoice here"
              />
              <p class="text-caption text-grey-7">Paste a Lightning invoice or scan a QR code</p>
            </div>

            <div class="invoice-actions">
              <q-btn outline class="invoice-action-btn" icon="las la-qrcode" label="Scan QR"
                     @click="showQrScanner = true"/>
              <q-btn class="primary-btn" label="Continue" :disabled="!invoice" @click="payInvoice"/>
            </div>
          </div>

          <div v-if="showQrScanner" class="payment-step">
            <div class="qr-scanner-container">
              <qrcode-capture
                @detect="handleScanInvoice"
                style="border-radius: 8px !important;"
                :capture="null"
              />
            </div>

            <q-btn outline class="full-width q-mt-md" label="Cancel Scan" @click="showQrScanner = false"/>
          </div>

          <div v-if="paymentStep === 1" class="payment-step">
            <div class="invoice-amount">
              <div class="text-h4 text-weight-bold">{{ formatBalance(paymentDetails.amount) }}</div>
              <div class="text-grey-7">{{ fiatSymbol }}{{ getFiatAmount(paymentDetails.amount) }}
                {{ walletState.preferredFiatCurrency }}
              </div>
            </div>

            <div class="payment-details">
              <div class="payment-detail-item">
                <span class="text-grey-7">Description</span>
                <span>{{ paymentDetails.description }}</span>
              </div>

              <div class="payment-detail-item">
                <span class="text-grey-7">Destination</span>
                <span class="text-caption">{{ paymentDetails.destination }}</span>
              </div>

              <div class="payment-detail-item">
                <span class="text-grey-7">Fee Estimate</span>
                <span>~1 sat</span>
              </div>
            </div>

            <q-btn
              class="pay-btn"
              :loading="isProcessing"
              @click="confirmPayment"
            >
              <template v-if="!isProcessing">
                <q-icon name="las la-bolt" class="q-mr-sm"/>
                Pay Now
              </template>
              <template v-slot:loading>
                <q-spinner-dots/>
                Processing...
              </template>
            </q-btn>
          </div>

          <div v-if="paymentStep === 2" class="payment-step success-step">
            <div class="success-icon">
              <q-icon name="las la-bolt" size="48px" color="green-8"/>
            </div>

            <div class="success-message">
              <h3 class="text-h5 text-green-8 text-weight-bold">Payment Sent!</h3>
              <p class="text-grey-7">Your payment was successful.</p>

              <div class="text-h5 text-weight-bold q-mb-xs">
                {{ formatBalance(paymentDetails.amount) }}
              </div>
              <div class="text-caption text-grey-7">
                {{ fiatSymbol }}{{ getFiatAmount(paymentDetails.amount) }}
                {{ walletState.preferredFiatCurrency }}
              </div>
            </div>

            <q-btn class="success-btn" label="Done" v-close-popup/>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import {webln, LN} from "@getalby/sdk";
import VueQrcode from '@chenfengyuan/vue-qrcode';
import {QrcodeStream, QrcodeDropZone, QrcodeCapture} from 'vue-qrcode-reader'

export default {
  name: 'WalletDashboardPage',
  components: {
    VueQrcode,
    QrcodeStream,
    QrcodeDropZone,
    QrcodeCapture,
  },
  data() {
    return {
      isLoading: true,
      walletState: {
        balance: 0,
        connectedWallets: [],
        activeWalletId: null,
        currency: 'sats',
        currencies: ['sats', 'btc', 'usd', 'eur', 'gbp', 'jpy', 'cad', 'chf', 'aud'],
        exchangeRates: {
          usd: 65000,
          eur: 60000,
          gbp: 52000,
          jpy: 9800000,
          cad: 0,
          chf: 0,
          aud: 0
        },
        preferredFiatCurrency: 'USD',
        denominationCurrency: 'sats'
      },
      transactions: [],
      transactionError: null,
      showWalletInfo: false,
      showHistory: true,

      // Payment sheet
      paymentSheetOpen: false,
      paymentMode: 'receive',
      paymentStep: 0,
      amount: null,
      description: '',
      invoice: '',
      isProcessing: false,
      showQrScanner: false,

      // Payment details for send mode
      paymentDetails: {
        amount: 0,
        description: '',
        destination: ''
      }
    }
  },
  computed: {
    activeWallet() {
      return this.walletState.connectedWallets.find(w => w.id === this.walletState.activeWalletId) || null
    },
    isActiveWallet() {
      return this.activeWallet !== null
    },
    paymentSheetTitle() {
      if (this.paymentMode === 'receive') {
        if (this.paymentStep === 0) return 'Receive Payment'
        if (this.paymentStep === 1) return 'Lightning Invoice'
        return 'Payment Received'
      } else {
        if (this.showQrScanner) return 'Scan QR Code'
        if (this.paymentStep === 0) return 'Send Payment'
        if (this.paymentStep === 1) return 'Confirm Payment'
        return 'Payment Sent'
      }
    },
    currencySymbol() {
      return this.getCurrencySymbol(this.walletState.denominationCurrency)
    },
    fiatSymbol() {
      return this.getCurrencySymbol(this.walletState.preferredFiatCurrency)
    }
  },
  created() {
    this.loadWalletState();
    this.loadFiatPrices();
    this.startFiatPriceInterval();
  },
  methods: {
    async fetchAndStoreFiatPrices() {
      try {
        const response = await fetch('https://mempool.space/api/v1/prices');
        const data = await response.json();
        localStorage.setItem('buhoGO_fiat_prices', JSON.stringify(data));
        this.walletState.exchangeRates = {
          usd: data.USD,
          eur: data.EUR,
          gbp: data.GBP,
          jpy: data.JPY,
          cad: data.CAD,
          chf: data.CHF,
          aud: data.AUD
        };
        // Optionally persist wallet state
        localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
      } catch (e) {
        console.error('Failed to fetch fiat prices', e);
      }
    },
    loadFiatPrices() {
      const prices = localStorage.getItem('buhoGO_fiat_prices');
      if (prices) {
        const data = JSON.parse(prices);
        this.walletState.exchangeRates = {
          usd: data.USD,
          eur: data.EUR,
          gbp: data.GBP,
          jpy: data.JPY,
          cad: data.CAD,
          chf: data.CHF,
          aud: data.AUD
        };
      }
    },
    startFiatPriceInterval() {
      this.fetchAndStoreFiatPrices();
      setInterval(() => {
        this.fetchAndStoreFiatPrices();
      }, 5 * 60 * 1000);
    },
    // Fetch historical fiat price for a transaction (for tx details)
    async fetchHistoricalFiatAmount(tx, currency = this.walletState.preferredFiatCurrency) {
      try {
        const url = `https://mempool.space/api/v1/historical-price?currency=${currency}&timestamp=${tx.settled_at}`;
        const response = await fetch(url);
        const data = await response.json();
        const priceObj = data.prices && data.prices.length > 0 ? data.prices[0] : null;
        if (priceObj && priceObj[currency]) {
          const btcAmount = tx.amount / 100000000;
          const fiatAmount = btcAmount * priceObj[currency];
          return fiatAmount.toFixed(2);
        }
      } catch (e) {
        console.error('Failed to fetch historical price', e);
      }
      return null;
    },
    async loadWalletState() {
      this.isLoading = true;
      this.transactionError = null;
      // Load wallet state from localStorage
      const savedState = localStorage.getItem('buhoGO_wallet_state')
      if (savedState) {
        try {
          const parsedState = JSON.parse(savedState)
          console.log('Loaded wallet state:', parsedState) // Debugging line
          this.walletState = parsedState

          // Get the active wallet from connectedWallets array
          const activeWallet = parsedState.connectedWallets.find(w => w.id === parsedState.activeWalletId)
          if (activeWallet) {
            try {
              const nwc = new webln.NostrWebLNProvider({
                nostrWalletConnectUrl: activeWallet.nwcString,
              });
              
              // Set a shorter timeout for enable
              await Promise.race([
                nwc.enable(),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Connection timeout')), 10000)
                )
              ]);
              
              // Get wallet info with timeout
              const info = await Promise.race([
                nwc.getInfo(),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Info request timeout')), 8000)
                )
              ]);
              console.log('NWC Info:', info);
              
              // Get balance with timeout
              const balance = await Promise.race([
                nwc.getBalance(),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Balance request timeout')), 8000)
                )
              ]);
              console.log('NWC Balance:', balance);
              this.walletState.balance = balance.balance;
              
              // Get transactions with timeout and pagination
              await this.loadTransactions(nwc);
              
            } catch (error) {
              console.error('Error loading wallet data:', error);
              this.transactionError = error.message;
              
              // Try to load cached transactions from localStorage
              const cachedTransactions = localStorage.getItem(`buhoGO_transactions_${activeWallet.id}`);
              if (cachedTransactions) {
                try {
                  this.transactions = JSON.parse(cachedTransactions);
                  console.log('Loaded cached transactions:', this.transactions.length);
                } catch (e) {
                  console.error('Failed to parse cached transactions:', e);
                }
              }
              
              // Show user-friendly error message
              this.$q.notify({
                type: 'warning',
                message: 'Connection issues detected. Using cached data.',
                caption: error.message.includes('timeout') ? 'Wallet connection is slow' : 'Please check your connection',
                position: 'top',
                timeout: 5000
              });
            }
          }
        } catch (e) {
          console.error('Failed to parse saved wallet state:', e);
          this.transactionError = 'Failed to load wallet data';
        }
      }
      this.isLoading = false;
    },
    
    async loadTransactions(nwc, limit = 50, offset = 0) {
      try {
        // Try to get transactions with pagination and timeout
        const transactionsResponse = await Promise.race([
          nwc.listTransactions({ limit, offset }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Transactions request timeout')), 15000)
          )
        ]);
        
        console.log('NWC Transactions:', transactionsResponse);
        
        if (transactionsResponse && transactionsResponse.transactions) {
          this.transactions = transactionsResponse.transactions.map(tx => ({
            ...tx,
            walletId: this.walletState.activeWalletId,
            // Ensure we have required fields
            id: tx.id || tx.payment_hash || `tx-${Date.now()}-${Math.random()}`,
            type: tx.type || (tx.amount > 0 ? 'incoming' : 'outgoing'),
            description: tx.description || tx.memo || 'Lightning transaction',
            settled_at: tx.settled_at || tx.created_at || Math.floor(Date.now() / 1000)
          }));
          
          // Cache transactions for offline use
          localStorage.setItem(
            `buhoGO_transactions_${this.walletState.activeWalletId}`, 
            JSON.stringify(this.transactions)
          );
        } else {
          throw new Error('Invalid transaction response format');
        }
      } catch (error) {
        console.error('Failed to load transactions:', error);
        throw error;
      }
    },
    generateMockTransactions() {
      // Generate mock transactions for demo
      const types = ['incoming', 'outgoing']
      const descriptions = [
        'Coffee payment',
        'Donation received',
        'Lunch with friends',
        'Online purchase',
        'Podcast support'
      ]

      const transactions = []

      for (let i = 0; i < 5; i++) {
        const type = types[Math.floor(Math.random() * types.length)]
        const description = descriptions[Math.floor(Math.random() * descriptions.length)]
        const amount = Math.floor(Math.random() * 500000) + 10000
        const daysAgo = Math.floor(Math.random() * 30) + 1

        transactions.push({
          id: `tx-${i}`,
          payment_hash: `hash-${i}-${Math.random().toString(36).substring(2, 10)}`,
          amount,
          fees_paid: type === 'outgoing' ? Math.floor(amount * 0.01) : 0,
          description,
          type,
          settled_at: Math.floor(Date.now() / 1000) - daysAgo * 86400,
          walletId: this.walletState.activeWalletId
        })
      }

      this.transactions = transactions.sort((a, b) => b.settled_at - a.settled_at)
    },
    formatBalance(amount) {
      switch (this.walletState.currency) {
        case 'btc':
          return (amount / 100000000).toFixed(8) + ' BTC'
        case 'usd':
          const usdValue = (amount / 100000000) * (this.walletState.exchangeRates.usd || 65000)
          return '$' + usdValue.toFixed(2)
        case 'sats':
        default:
          return amount.toLocaleString() + ' sats'
      }
    },
    formatTransactionDate(timestamp) {
      return new Date(timestamp * 1000).toLocaleDateString()
    },
    formatDate() {
      // Mock date - in a real app, this would be stored in the wallet data
      const mockDate = new Date()
      mockDate.setMonth(mockDate.getMonth() - 2) // Set to 2 months ago
      return mockDate.toLocaleDateString()
    },
    activateWallet() {
      // In a real app, this would switch the active wallet
      this.showWalletInfo = false

      this.$q.notify({
        type: 'positive',
        message: 'Wallet activated successfully',
        position: 'top'
      })
    },
    viewTransaction(txId) {
      // Navigate to transaction detail page
      this.$router.push(`/transaction/${txId}`)
    },
    openPaymentSheet(mode) {
      this.paymentMode = mode
      this.paymentStep = 0
      this.amount = ''
      this.description = ''
      this.invoice = ''
      this.showQrScanner = false
      this.paymentSheetOpen = true
    },
    toggleCurrency() {
      // Toggle between sats and the preferred fiat currency
      const newDenomination = this.walletState.denominationCurrency === 'sats'
        ? this.walletState.preferredFiatCurrency.toLowerCase()
        : 'sats';
      this.walletState.denominationCurrency = newDenomination;
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
      this.$q.notify({
        message: `Currency changed to ${newDenomination.toUpperCase()}`,
        position: 'top'
      });
    },
    getCurrencySymbol(currency) {
      switch (currency.toUpperCase()) {
        case 'USD':
          return '$'
        case 'EUR':
          return '€'
        case 'GBP':
          return '£'
        case 'JPY':
          return '¥'
        case 'BTC':
          return '₿'
        case 'SATS':
          return '⚡'
        default:
          return ''
      }
    },
    getFiatAmount(customAmount) {
      const amountToConvert = customAmount || Number(this.amount) || this.paymentDetails.amount

      // Convert to BTC first
      let btcAmount = amountToConvert / 100000000

      // If current denomination is not sats, convert from fiat to BTC
      if (this.walletState.denominationCurrency !== 'sats' && !customAmount) {
        const exchangeRate = this.walletState.exchangeRates[this.walletState.denominationCurrency] ||
          this.walletState.exchangeRates.usd
        btcAmount = Number(this.amount) / exchangeRate
      }

      // Convert BTC to preferred fiat
      const fiatValue = btcAmount * (
        this.walletState.exchangeRates[this.walletState.preferredFiatCurrency.toLowerCase()] ||
        this.walletState.exchangeRates.usd
      )

      return fiatValue.toFixed(2)
    },
    convertToSats(amount, fromCurrency) {
      const currency = fromCurrency.toLowerCase()
      if (currency === 'sats') return amount
      if (currency === 'btc') return amount * 100000000

      // Convert from fiat to sats
      const exchangeRate = this.walletState.exchangeRates[currency] || this.walletState.exchangeRates.usd

      return Math.round((amount * 100000000) / exchangeRate)
    },
    async generateInvoice() {
      if (!this.amount || isNaN(Number(this.amount))) {
        this.$q.notify({
          type: 'negative',
          message: 'Please enter a valid amount',
          position: 'top'
        })
        return
      }

      this.isProcessing = true

      try {
        // from activeWalletId from this.walletState get the string from connectedWallets array
        let nwcString = this.walletState.connectedWallets.find(w => w.id === this.walletState.activeWalletId).nwcString
        
        const request = await Promise.race([
          new LN(nwcString).requestPayment(this.amount, {
            description: this.description || "Lightning Payment"
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Invoice generation timeout')), 15000)
          )
        ]);

        this.invoice = request.invoice.paymentRequest;
        this.paymentStep = 1;
        
        request.onPaid(async () => {
          this.paymentStep = 2;
          this.$q.notify({
            type: 'positive',
            message: `Payment received: ${this.formatBalance(Number(this.amount))}`,
            position: 'top'
          });

          // Refresh balance and transactions
          setTimeout(() => this.loadWalletState(), 2000);
        });

      } catch (error) {
        console.error('Error generating invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: error.message.includes('timeout') ? 'Request timed out. Please try again.' : 'Failed to generate invoice. Please try again.',
          position: 'top'
        });
      } finally {
        this.isProcessing = false;
      }
    },
    async handleScanInvoice(result) {
      try {
        this.invoice = result;
        this.showQrScanner = false;

        const activeWallet = this.walletState.connectedWallets.find(w => w.id === this.walletState.activeWalletId);
        if (!activeWallet) {
          throw new Error('No active wallet found');
        }

        const nwc = new webln.NostrWebLNProvider({
          nostrWalletConnectUrl: activeWallet.nwcString,
        });
        
        await Promise.race([
          nwc.enable(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout')), 10000)
          )
        ]);

        // Decode the invoice to get details
        const decodedInvoice = await Promise.race([
          nwc.decodeInvoice(this.invoice),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Invoice decode timeout')), 8000)
          )
        ]);

        this.paymentDetails = {
          amount: decodedInvoice.amount,
          description: decodedInvoice.description || 'Payment',
          destination: decodedInvoice.destination
        };

        this.paymentStep = 1;
      } catch (error) {
        console.error('Error decoding invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: error.message.includes('timeout') ? 'Request timed out. Please try again.' : 'Invalid invoice. Please try again.',
          position: 'top'
        });
      }
    },
    async payInvoice() {
      if (!this.invoice) {
        this.$q.notify({
          type: 'negative',
          message: 'Please enter a valid invoice',
          position: 'top'
        });
        return;
      }

      this.isProcessing = true;

      try {
        const activeWallet = this.walletState.connectedWallets.find(w => w.id === this.walletState.activeWalletId);
        if (!activeWallet) {
          throw new Error('No active wallet found');
        }

        const nwc = new webln.NostrWebLNProvider({
          nostrWalletConnectUrl: activeWallet.nwcString,
        });
        
        await Promise.race([
          nwc.enable(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout')), 10000)
          )
        ]);

        // Decode invoice first to get details
        const decodedInvoice = await Promise.race([
          nwc.decodeInvoice(this.invoice),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Invoice decode timeout')), 8000)
          )
        ]);

        this.paymentDetails = {
          amount: decodedInvoice.amount,
          description: decodedInvoice.description || 'Payment',
          destination: decodedInvoice.destination
        };

        this.paymentStep = 1;
      } catch (error) {
        console.error('Error decoding invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: error.message.includes('timeout') ? 'Request timed out. Please try again.' : 'Invalid invoice. Please try again.',
          position: 'top'
        });
        this.isProcessing = false;
      }
    },
    
    async confirmPayment() {
      this.isProcessing = true;

      try {
        const activeWallet = this.walletState.connectedWallets.find(w => w.id === this.walletState.activeWalletId);
        if (!activeWallet) {
          throw new Error('No active wallet found');
        }

        const nwc = new webln.NostrWebLNProvider({
          nostrWalletConnectUrl: activeWallet.nwcString,
        });
        
        await Promise.race([
          nwc.enable(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout')), 10000)
          )
        ]);

        const result = await Promise.race([
          nwc.sendPayment(this.invoice),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Payment timeout')), 30000)
          )
        ]);
        this.paymentStep = 2;
        this.$q.notify({
          type: 'positive',
          message: 'Payment sent successfully!',
          position: 'top'
        });

        // Refresh balance and transactions
        setTimeout(() => this.loadWalletState(), 2000);
      } catch (error) {
        console.error('Error paying invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: error.message.includes('timeout') ? 'Payment timed out. Please check your wallet.' : 'Failed to send payment. Please try again.',
          position: 'top'
        });
      } finally {
        this.isProcessing = false;
      }
    },
    copyInvoice() {
      // Simulate copy to clipboard
      this.$q.notify({
        type: 'positive',
        message: 'Invoice copied to clipboard',
        position: 'top'
      })
    },
    shareInvoice() {
      // Simulate share functionality
      this.$q.notify({
        type: 'positive',
        message: 'Invoice shared',
        position: 'top'
      })
    }
  }
}
</script>

<style scoped>
.wallet-dashboard-page {
  min-height: 100vh;
  background-color: #f8f9fa;
  padding-bottom: 100px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background-color: white;
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo {
  width: 32px;
  height: 32px;
}

.title {
  font-size: 1.25rem;
  font-weight: 700;
  background: linear-gradient(135deg, #10b981, #059669);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
}

.settings-btn {
  background-color: rgba(243, 244, 246, 0.8);
  color: #10b981;
  border: 1px solid rgba(229, 231, 235, 0.5);
}

.wallet-card-container {
  padding-left: 1rem;
  padding-right: 1rem;
  padding-top: 10px;
  margin-bottom: 1rem;
}

.wallet-card {
  height: 170px;
  border-radius: 16px;
  overflow: hidden;
  position: relative;
  background: linear-gradient(135deg, #10b981, #059669);
}

.wallet-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image: url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM12 86c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm28-65c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm23-11c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-6 60c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm29 22c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zM32 63c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm57-13c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-9-21c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM60 91c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM35 41c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 60c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z' fill='currentColor' fill-opacity='0.1' fill-rule='evenodd'/%3E%3C/svg%3E");
  opacity: 0.5;
}

.wallet-card-content {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.wallet-info {
  margin-bottom: 1rem;
}

.balance {
  font-size: 2rem;
  font-weight: 700;
  color: white;
  margin: 0.25rem 0;
}

.wallet-name {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.8);
}

.wallet-actions {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}

.wallet-info-popup {
  position: absolute;
  inset: 0;
  background-color: rgba(17, 24, 39, 0.95);
  backdrop-filter: blur(4px);
  border-radius: 16px;
  padding-left: 1.5rem;
  padding-right: 1.5rem;
  padding-top: 6px;
  display: flex;
  flex-direction: column;
  z-index: 10;
}

.wallet-info-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.wallet-info-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.wallet-info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: rgba(255, 255, 255, 0.05);
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
}

.wallet-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.wallet-info-footer {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.activate-btn {
  width: 100%;
  background: linear-gradient(to right, #10b981, #059669);
  color: white;
  border-radius: 0.75rem;
  padding: 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.transaction-history {
  margin: 1rem;
  background-color: white;
  border-radius: 0.75rem;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  height: calc(100vh - 400px); /* Adjust based on your layout */
}

.transaction-scroll-area {
  flex: 1;
  height: 100%;
}

.no-transactions {
  padding: 2rem;
  text-align: center;
  color: #6b7280;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.transaction-item {
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
}

.transaction-icon {
  padding: 0.5rem;
}

.view-all-btn {
  width: 100%;
  color: #10b981;
  font-weight: 500;
}

.bottom-actions {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  padding: 1rem;
  background-color: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border-top: 1px solid rgba(229, 231, 235, 0.5);
  z-index: 10;
  max-width: 500px;
  margin: 0 auto;
}

.action-btn {
  padding: 1rem 0;
  border-radius: 0.75rem;
  color: white;
  position: relative;
  overflow: hidden;
}

.receive-btn {
  background: linear-gradient(to bottom right, #10b981, #059669);
  box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2), 0 2px 4px -1px rgba(16, 185, 129, 0.1);
}

.send-btn {
  background: linear-gradient(to bottom right, #10b981, #047857);
  box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2), 0 2px 4px -1px rgba(16, 185, 129, 0.1);
}

.btn-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
}

.icon-container {
  position: relative;
  width: 3rem;
  height: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.25rem;
}

.icon-glow {
  position: absolute;
  inset: 0;
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  filter: blur(8px);
  transform: scale(0.75);
  transition: transform 0.2s;
}

.action-btn:hover .icon-glow {
  transform: scale(0.9);
}

.icon-bg {
  position: relative;
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  padding: 0.75rem;
}

.action-btn::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle at center, rgba(255, 255, 255, 0.1) 0%, transparent 70%);
  opacity: 0.1;
}

/* Dialog Styles */
.payment-dialog {
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

.payment-step {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.currency-toggle {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.5rem;
  background-color: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.fiat-conversion {
  text-align: right;
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 0.25rem;
}

.generate-btn, .pay-btn {
  background: linear-gradient(to right, #10b981, #059669);
  color: white;
  border-radius: 0.75rem;
  padding: 0.75rem;
  font-weight: 500;
  box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2), 0 2px 4px -1px rgba(16, 185, 129, 0.1);
}

.invoice-amount {
  text-align: center;
  margin-bottom: 1.5rem;
}

.waiting-payment {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  font-size: 0.875rem;
  color: #6b7280;
}

.qr-container {
  display: flex;
  justify-content: center;
  margin-bottom: 1.5rem;
}

.qr-code {
  background-color: white;
  padding: 1rem;
  border-radius: 0.75rem;
  border: 2px solid rgba(16, 185, 129, 0.2);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.qr-scanner-container {
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f3f4f6;
  border-radius: 8px;
  overflow: hidden;
}

.qr-code {
  background-color: white;
  padding: 1rem;
  border-radius: 0.75rem;
  border: 2px solid rgba(16, 185, 129, 0.2);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  display: flex;
  justify-content: center;
  align-items: center;
}

.invoice-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.invoice-action-btn {
  border-radius: 0.75rem;
  border-color: rgba(16, 185, 129, 0.3);
  color: #10b981;
}

.primary-btn {
  background-color: #10b981;
  color: white;
  border-radius: 0.75rem;
}

.payment-details {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.payment-detail-item {
  display: flex;
  justify-content: space-between;
  padding: 0.75rem 0;
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
}

.success-step {
  align-items: center;
  text-align: center;
}

.success-icon {
  position: relative;
  width: 5rem;
  height: 5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.5rem;
}

.success-icon::before {
  content: "";
  position: absolute;
  inset: 0;
  background-color: rgba(16, 185, 129, 0.1);
  border-radius: 50%;
  filter: blur(1rem);
}

.success-icon::after {
  content: "";
  position: absolute;
  inset: 0.5rem;
  background-color: rgba(16, 185, 129, 0.2);
  border-radius: 50%;
}

.success-message {
  margin-bottom: 1.5rem;
}

.success-btn {
  background: linear-gradient(to right, #10b981, #059669);
  color: white;
  border-radius: 0.75rem;
  padding: 0.75rem 2rem;
  font-weight: 500;
}
</style>
