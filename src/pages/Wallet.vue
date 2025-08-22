<template>
  <q-page class="wallet-page">
    <!-- Header -->
    <div class="wallet-header">
      <div class="header-content">
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
        <q-btn flat round dense icon="las la-cog" @click="$router.push('/settings')" class="settings-btn"/>
      </div>
    </div>

    <!-- Balance Display -->
    <div class="balance-section">
      <div class="balance-container">
        <div class="balance-amount">
          <span class="amount-number">{{ formatMainBalance(walletState.balance) }}</span>
          <span class="amount-unit">sats</span>
        </div>
        <div class="balance-fiat">{{ getFiatValue(walletState.balance) }}</div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="action-section">
      <div class="action-buttons">
        <q-btn
          class="action-btn receive-btn"
          @click="showReceiveDialog = true"
          no-caps
          unelevated
        >
          <q-icon name="las la-arrow-down" size="24px"/>
          <div class="btn-text">Receive</div>
        </q-btn>
        <q-btn
          class="action-btn send-btn"
          @click="showSendDialog = true"
          no-caps
          unelevated
        >
          <q-icon name="las la-arrow-up" size="24px"/>
          <div class="btn-text">Send</div>
        </q-btn>
      </div>
    </div>

    <!-- Recent Transactions -->
    <div class="transactions-section" v-if="recentTransactions.length > 0">
      <div class="section-header">
        <h3 class="section-title">Recent Activity</h3>
        <q-btn
          flat
          no-caps
          color="primary"
          @click="$router.push('/transactions')"
          class="view-all-btn"
        >
          View All
          <q-icon name="las la-chevron-right" size="16px" class="q-ml-xs"/>
        </q-btn>
      </div>

      <div class="transaction-list">
        <div
          v-for="(tx, index) in recentTransactions.slice(0, 4)"
          :key="tx.id"
          class="transaction-item"
          @click="viewTransactionDetail(tx)"
        >
          <div class="transaction-icon">
            <div class="tx-icon-container" :class="getTransactionIconClass(tx)">
              <q-icon :name="getTransactionIcon(tx)" size="20px"/>
            </div>
          </div>

          <div class="transaction-info">
            <div class="transaction-main">
              <div class="transaction-type">{{ getTransactionTypeText(tx) }}</div>
              <div class="transaction-time">{{ formatTransactionTime(tx.settled_at) }}</div>
            </div>
            <div class="transaction-description" v-if="tx.description && tx.description !== 'Lightning transaction'">
              {{ tx.description }}
            </div>
            <div class="nostr-info" v-if="tx.senderNpub && nostrProfiles[tx.senderNpub]">
              <q-avatar size="16px" class="sender-avatar">
                <img 
                  v-if="nostrProfiles[tx.senderNpub].picture" 
                  :src="nostrProfiles[tx.senderNpub].picture"
                  :alt="getSenderDisplayName(tx.senderNpub)"
                />
                <q-icon v-else name="las la-user" size="10px"/>
              </q-avatar>
              <span class="sender-name">{{ getSenderDisplayName(tx.senderNpub) }}</span>
            </div>
          </div>

          <div class="transaction-amount">
            <div class="amount-sats" :class="getAmountClass(tx)">
              {{ getFormattedAmount(tx) }}
            </div>
            <div class="amount-fiat">{{ getFiatAmount(tx) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div class="empty-transactions" v-else>
      <div class="empty-content">
        <div class="empty-icon">
          <q-icon name="las la-receipt" size="3rem" color="grey-4"/>
        </div>
        <div class="empty-title">No transactions yet</div>
        <div class="empty-subtitle">Your transaction history will appear here</div>
      </div>
    </div>

    <!-- Send Dialog -->
    <q-dialog v-model="showSendDialog" class="send-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="text-h6">Send Lightning Payment</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="send-form">
            <div class="input-section">
              <q-input
                v-model="sendForm.invoice"
                outlined
                label="Lightning Invoice, LNURL, or Lightning Address"
                placeholder="Paste invoice, LNURL, or enter lightning address"
                type="textarea"
                rows="3"
                class="q-mb-md payment-input"
                @input="handlePaymentInput"
              />
              
              <div class="input-actions">
                <q-btn
                  flat
                  dense
                  color="primary"
                  icon="las la-qrcode"
                  label="Scan QR"
                  @click="showQRScanner = true"
                  class="scan-btn"
                />
                <q-btn
                  flat
                  dense
                  color="primary"
                  icon="las la-paste"
                  label="Paste"
                  @click="pasteFromClipboard"
                  class="paste-btn"
                />
              </div>
            </div>

            <!-- Payment Type Indicator -->
            <div class="payment-type" v-if="paymentType">
              <div class="type-indicator" :class="getPaymentTypeClass()">
                <q-icon :name="getPaymentTypeIcon()" class="q-mr-xs"/>
                {{ getPaymentTypeLabel() }}
              </div>
            </div>

            <!-- LNURL Amount Input -->
            <div class="amount-section" v-if="paymentType === 'lnurl' && lnurlData">
              <q-input
                v-model="sendForm.customAmount"
                outlined
                label="Amount (sats)"
                type="number"
                class="q-mb-md amount-input"
                :rules="[
                  val => val >= lnurlData.minSendable/1000 || `Minimum: ${lnurlData.minSendable/1000} sats`,
                  val => val <= lnurlData.maxSendable/1000 || `Maximum: ${lnurlData.maxSendable/1000} sats`
                ]"
                :hint="`Min: ${lnurlData.minSendable/1000} sats, Max: ${lnurlData.maxSendable/1000} sats`"
              />
              
              <q-input
                v-model="sendForm.comment"
                outlined
                label="Comment (optional)"
                class="q-mb-md"
                :maxlength="lnurlData.commentAllowed || 0"
                :disable="!lnurlData.commentAllowed"
                :hint="lnurlData.commentAllowed ? `Max ${lnurlData.commentAllowed} characters` : 'Comments not supported'"
              />
            </div>
          </div>

          <!-- Invoice Details -->
          <div class="invoice-details-section" v-if="sendForm.decodedInvoice">
            <div class="invoice-details">
              <div class="details-header">
                <q-icon name="las la-receipt" class="q-mr-sm"/>
                Invoice Details
              </div>
              <div class="detail-row">
                <span class="detail-label">Amount:</span>
                <span class="detail-value">{{ formatBalance(sendForm.decodedInvoice.amount) }}</span>
              </div>
              <div class="detail-row" v-if="sendForm.decodedInvoice.description">
                <span class="detail-label">Description:</span>
                <span class="detail-value">{{ sendForm.decodedInvoice.description }}</span>
              </div>
              <div class="detail-row" v-if="sendForm.decodedInvoice.expiry">
                <span class="detail-label">Expires:</span>
                <span class="detail-value">{{ formatExpiry(sendForm.decodedInvoice.expiry) }}</span>
              </div>
            </div>
          </div>

          <!-- Payment Actions -->
          <div class="payment-actions">
            <q-btn
              color="primary"
              :label="getPaymentButtonLabel()"
              :loading="isSending"
              :disable="!canSendPayment()"
              @click="sendPayment"
              class="full-width send-payment-btn"
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Receive Dialog -->
    <q-dialog v-model="showReceiveDialog" class="receive-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="text-h6">Receive Lightning Payment</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="payment-method-tabs">
            <q-tabs
              v-model="receiveMethod"
              dense
              class="receive-tabs"
              indicator-color="primary"
              active-color="primary"
              align="justify"
            >
              <q-tab name="invoice" label="Invoice" />
              <q-tab name="address" label="Address" />
            </q-tabs>
          </div>

          <q-tab-panels v-model="receiveMethod" animated class="receive-panels">
            <!-- Invoice Tab -->
            <q-tab-panel name="invoice" class="q-pa-none">
              <div class="invoice-form">
                <q-input
                  v-model="receiveForm.amount"
                  outlined
                  label="Amount (sats)"
                  type="number"
                  class="q-mb-md amount-input"
                  :rules="[val => val > 0 || 'Amount must be greater than 0']"
                />

                <q-input
                  v-model="receiveForm.description"
                  outlined
                  label="Description (optional)"
                  class="q-mb-md"
                  maxlength="100"
                />

                <q-btn
                  color="primary"
                  label="Create Invoice"
                  :loading="isCreatingInvoice"
                  @click="createInvoice"
                  class="full-width create-invoice-btn"
                  :disable="!receiveForm.amount || receiveForm.amount <= 0"
                />
              </div>
            </q-tab-panel>

            <!-- Lightning Address Tab -->
            <q-tab-panel name="address" class="q-pa-none">
              <div class="address-form">
                <div class="address-info">
                  <div class="address-icon">
                    <q-icon name="las la-at" size="2rem" color="primary"/>
                  </div>
                  <div class="address-text">
                    <div class="address-title">Lightning Address</div>
                    <div class="address-subtitle">Share your Lightning address to receive payments</div>
                  </div>
                </div>

                <q-input
                  v-model="lightningAddress"
                  readonly
                  outlined
                  label="Your Lightning Address"
                  class="q-mb-md address-input"
                />

                <div class="address-actions">
                  <q-btn
                    outline
                    color="primary"
                    icon="las la-copy"
                    label="Copy Address"
                    @click="copyLightningAddress"
                    class="copy-address-btn"
                  />
                  <q-btn
                    outline
                    color="primary"
                    icon="las la-qrcode"
                    label="Show QR"
                    @click="showAddressQR = true"
                    class="qr-address-btn"
                  />
                </div>
              </div>
            </q-tab-panel>
          </q-tab-panels>

          <div class="invoice-result" v-if="generatedInvoice">
            <div class="qr-code-container">
              <vue-qrcode
                :value="generatedInvoice.payment_request"
                :options="{ width: 200 }"
                class="qr-code"
              />
            </div>
            <div class="invoice-details">
              <div class="invoice-amount">{{ formatBalance(generatedInvoice.amount || receiveForm.amount) }}</div>
              <div class="invoice-description" v-if="receiveForm.description">{{ receiveForm.description }}</div>
            </div>
            <q-input
              v-model="generatedInvoice.payment_request"
              readonly
              outlined
              type="textarea"
              rows="3"
              class="invoice-text"
            />
            <div class="invoice-actions">
              <q-btn
                outline
                color="primary"
                label="Copy Invoice"
                icon="las la-copy"
                @click="copyInvoice"
                class="copy-btn"
              />
              <q-btn
                flat
                color="primary"
                label="Share"
                icon="las la-share-alt"
                @click="shareInvoice"
                class="share-btn"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- QR Scanner Dialog -->
    <q-dialog v-model="showQRScanner" class="qr-scanner-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="text-h6">Scan Lightning Invoice</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="qr-scanner-container">
            <qrcode-capture @detect="handleQRScan"/>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { webln } from "@getalby/sdk";
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { QrcodeCapture } from 'vue-qrcode-reader';

export default {
  name: 'WalletPage',
  components: {
    VueQrcode,
    QrcodeCapture
  },
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
      recentTransactions: [],
      nostrProfiles: {},
      showSendDialog: false,
      showReceiveDialog: false,
      showQRScanner: false,
      isSending: false,
      isCreatingInvoice: false,
      receiveMethod: 'invoice',
      paymentType: null,
      lnurlData: null,
      lightningAddress: '',
      showAddressQR: false,
      sendForm: {
        invoice: '',
        decodedInvoice: null,
        customAmount: '',
        comment: ''
      },
      receiveForm: {
        amount: '',
        description: ''
      },
      generatedInvoice: null,
      refreshInterval: null
    }
  },
  async created() {
    await this.loadWalletState();
    await this.loadTransactions();
    await this.loadNostrProfiles();
    this.startPeriodicRefresh();
  },
  beforeUnmount() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  },
  watch: {
    'sendForm.invoice': {
      handler: 'decodeInvoice',
      immediate: false
    }
  },
  methods: {
    async loadWalletState() {
      const savedState = localStorage.getItem('buhoGO_wallet_state');
      if (savedState) {
        try {
          this.walletState = JSON.parse(savedState);
          await this.updateWalletBalance();
        } catch (error) {
          console.error('Failed to load wallet state:', error);
        }
      } else {
        this.$router.push('/');
      }
    },

    async updateWalletBalance() {
      const activeWallet = this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      );

      if (activeWallet && activeWallet.nwcString) {
        try {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          const balance = await nwc.getBalance();
          this.walletState.balance = balance.balance;
          activeWallet.balance = balance.balance;

          localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
        } catch (error) {
          console.error('Failed to update balance:', error);
        }
      }
    },

    async loadTransactions() {
      const activeWallet = this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      );

      if (activeWallet && activeWallet.nwcString) {
        try {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          const transactionsResponse = await nwc.listTransactions({ limit: 10, offset: 0 });

          if (transactionsResponse && transactionsResponse.transactions) {
            this.recentTransactions = transactionsResponse.transactions.map(tx => ({
              ...tx,
              id: tx.id || tx.payment_hash || `tx-${Date.now()}-${Math.random()}`,
              type: tx.type || (tx.amount > 0 ? 'incoming' : 'outgoing'),
              description: tx.description || tx.memo || 'Lightning transaction',
              settled_at: tx.settled_at || tx.created_at || Math.floor(Date.now() / 1000)
            }));

            // Sort by date (newest first)
            this.recentTransactions.sort((a, b) => b.settled_at - a.settled_at);

            await this.processZapTransactions();
          }
        } catch (error) {
          console.error('Failed to load transactions:', error);
        }
      }
    },

    async processZapTransactions() {
      for (const tx of this.recentTransactions) {
        if (this.isZapTransaction(tx)) {
          const npub = this.extractNpubFromZap(tx);
          if (npub) {
            tx.senderNpub = npub;
            await this.fetchNostrProfile(npub);
          }
        }
      }
    },

    isZapTransaction(tx) {
      return tx.description && (
        tx.description.toLowerCase().includes('zap') ||
        tx.description.includes('⚡') ||
        tx.type === 'incoming' && tx.description.match(/npub1[a-zA-Z0-9]{58}/)
      );
    },

    extractNpubFromZap(tx) {
      const npubMatch = tx.description.match(/npub1[a-zA-Z0-9]{58}/);
      return npubMatch ? npubMatch[0] : null;
    },

    async fetchNostrProfile(npub) {
      if (this.nostrProfiles[npub]) return;

      try {
        const profile = {
          name: npub.substring(0, 12) + '...',
          displayName: 'Nostr User',
          picture: `https://api.dicebear.com/7.x/identicon/svg?seed=${npub}`,
          about: '',
          nip05: ''
        };

        this.nostrProfiles[npub] = profile;
        this.saveNostrProfiles();
      } catch (error) {
        console.error('Error fetching nostr profile:', error);
      }
    },

    loadNostrProfiles() {
      const saved = localStorage.getItem('buhoGO_nostr_profiles');
      if (saved) {
        try {
          this.nostrProfiles = JSON.parse(saved);
        } catch (error) {
          console.error('Error loading nostr profiles:', error);
        }
      }
    },

    saveNostrProfiles() {
      localStorage.setItem('buhoGO_nostr_profiles', JSON.stringify(this.nostrProfiles));
    },

    getSenderDisplayName(npub) {
      const profile = this.nostrProfiles[npub];
      return profile ? (profile.displayName || profile.name) : npub.substring(0, 12) + '...';
    },

    startPeriodicRefresh() {
      this.refreshInterval = setInterval(async () => {
        await this.updateWalletBalance();
        await this.loadTransactions();
      }, 30000);
    },

    formatMainBalance(balance) {
      return balance.toLocaleString();
    },

    formatBalance(balance) {
      return balance.toLocaleString() + ' sats';
    },

    getFiatValue(balance) {
      const btcAmount = balance / 100000000;
      const currency = this.walletState.preferredFiatCurrency || 'USD';
      const rate = this.walletState.exchangeRates[currency.toLowerCase()] || 65000;
      const fiatValue = btcAmount * rate;
      
      const symbols = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        JPY: '¥'
      };
      
      const symbol = symbols[currency] || currency;
      return symbol + fiatValue.toFixed(2);
    },

    getTransactionTypeText(tx) {
      if (tx.senderNpub && this.nostrProfiles[tx.senderNpub]) {
        return `Zap from ${this.getSenderDisplayName(tx.senderNpub)}`;
      }
      return tx.type === 'incoming' ? 'Received' : 'Sent';
    },

    getTransactionIconClass(tx) {
      if (tx.senderNpub) return 'tx-icon-zap';
      return tx.type === 'incoming' ? 'tx-icon-received' : 'tx-icon-sent';
    },

    getTransactionIcon(tx) {
      if (tx.senderNpub) return 'las la-bolt';
      return tx.type === 'incoming' ? 'las la-arrow-down' : 'las la-arrow-up';
    },

    getAmountClass(tx) {
      return tx.type === 'incoming' ? 'amount-positive' : 'amount-negative';
    },

    getFormattedAmount(tx) {
      const prefix = tx.type === 'incoming' ? '+' : '-';
      return prefix + ' ' + Math.abs(tx.amount).toLocaleString() + ' sats';
    },

    getFiatAmount(tx) {
      const btcAmount = Math.abs(tx.amount) / 100000000;
      const currency = this.walletState.preferredFiatCurrency || 'USD';
      const rate = this.walletState.exchangeRates[currency.toLowerCase()] || 65000;
      const fiatValue = btcAmount * rate;
      
      const symbols = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        JPY: '¥'
      };
      
      const symbol = symbols[currency] || currency;
      return symbol + fiatValue.toFixed(2);
    },

    formatTransactionTime(timestamp) {
      const date = new Date(timestamp * 1000);
      const now = new Date();
      const diffInHours = (now - date) / (1000 * 60 * 60);
      const diffInDays = Math.floor(diffInHours / 24);
      const diffInMonths = Math.floor(diffInDays / 30);

      if (diffInHours < 1) {
        const diffInMinutes = Math.floor((now - date) / (1000 * 60));
        return `${diffInMinutes} minutes ago`;
      } else if (diffInHours < 24) {
        return `${Math.floor(diffInHours)} hours ago`;
      } else if (diffInDays < 30) {
        return `${diffInDays} days ago`;
      } else if (diffInMonths === 1) {
        return 'a month ago';
      } else {
        return `${diffInMonths} months ago`;
      }
    },

    viewTransactionDetail(tx) {
      this.$router.push(`/transaction/${tx.id}`);
    },

    async handlePaymentInput() {
      this.paymentType = null;
      this.lnurlData = null;
      this.sendForm.decodedInvoice = null;

      if (!this.sendForm.invoice.trim()) return;

      const input = this.sendForm.invoice.trim();

      // Check for Lightning Address
      if (input.includes('@') && !input.startsWith('lnurl') && !input.startsWith('lightning:')) {
        this.paymentType = 'address';
        await this.handleLightningAddress(input);
        return;
      }

      // Check for LNURL
      if (input.toLowerCase().startsWith('lnurl') || input.toLowerCase().startsWith('lightning:lnurl')) {
        this.paymentType = 'lnurl';
        await this.handleLNURL(input);
        return;
      }

      // Check for Lightning Invoice
      if (input.toLowerCase().startsWith('lnbc') || input.toLowerCase().startsWith('lightning:lnbc')) {
        this.paymentType = 'invoice';
        await this.decodeInvoice();
        return;
      }
    },

    async handleLightningAddress(address) {
      try {
        // Convert lightning address to LNURL
        const [username, domain] = address.split('@');
        const lnurlResponse = await fetch(`https://${domain}/.well-known/lnurlp/${username}`);
        const lnurlData = await lnurlResponse.json();
        
        if (lnurlData.tag === 'payRequest') {
          this.lnurlData = lnurlData;
          this.sendForm.customAmount = '';
        }
      } catch (error) {
        console.error('Error handling lightning address:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Invalid lightning address',
          position: 'top'
        });
      }
    },

    async handleLNURL(lnurl) {
      try {
        // Decode LNURL and fetch data
        // This is a simplified implementation - you'd need proper LNURL decoding
        const response = await fetch(lnurl);
        const lnurlData = await response.json();
        
        if (lnurlData.tag === 'payRequest') {
          this.lnurlData = lnurlData;
          this.sendForm.customAmount = '';
        }
      } catch (error) {
        console.error('Error handling LNURL:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Invalid LNURL',
          position: 'top'
        });
      }
    },

    getPaymentTypeClass() {
      const classes = {
        'invoice': 'type-invoice',
        'lnurl': 'type-lnurl',
        'address': 'type-address'
      };
      return classes[this.paymentType] || '';
    },

    getPaymentTypeIcon() {
      const icons = {
        'invoice': 'las la-receipt',
        'lnurl': 'las la-link',
        'address': 'las la-at'
      };
      return icons[this.paymentType] || 'las la-bolt';
    },

    getPaymentTypeLabel() {
      const labels = {
        'invoice': 'Lightning Invoice',
        'lnurl': 'LNURL Payment',
        'address': 'Lightning Address'
      };
      return labels[this.paymentType] || 'Lightning Payment';
    },

    getPaymentButtonLabel() {
      if (this.paymentType === 'lnurl') return 'Send LNURL Payment';
      if (this.paymentType === 'address') return 'Send to Address';
      return 'Send Payment';
    },

    canSendPayment() {
      if (!this.sendForm.invoice.trim()) return false;
      
      if (this.paymentType === 'lnurl') {
        return this.sendForm.customAmount && 
               this.sendForm.customAmount >= (this.lnurlData?.minSendable || 0) / 1000 &&
               this.sendForm.customAmount <= (this.lnurlData?.maxSendable || 0) / 1000;
      }
      
      return this.sendForm.decodedInvoice || this.paymentType === 'address';
    },

    async pasteFromClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        this.sendForm.invoice = text;
        await this.handlePaymentInput();
      } catch (error) {
        console.error('Failed to paste from clipboard:', error);
      }
    },

    formatExpiry(expiry) {
      const expiryDate = new Date(expiry * 1000);
      const now = new Date();
      const diffMinutes = Math.floor((expiryDate - now) / (1000 * 60));
      
      if (diffMinutes < 0) return 'Expired';
      if (diffMinutes < 60) return `${diffMinutes} minutes`;
      if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)} hours`;
      return `${Math.floor(diffMinutes / 1440)} days`;
    },

    async decodeInvoice() {
      if (!this.sendForm.invoice) {
        this.sendForm.decodedInvoice = null;
        return;
      }

      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (activeWallet) {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          const decoded = await nwc.decodeInvoice(this.sendForm.invoice);
          this.sendForm.decodedInvoice = decoded;
        }
      } catch (error) {
        console.error('Failed to decode invoice:', error);
        this.sendForm.decodedInvoice = null;
      }
    },

    async sendPayment() {
      if (!this.canSendPayment()) return;

      this.isSending = true;
      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (activeWallet) {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          
          let result;
          
          if (this.paymentType === 'lnurl' && this.lnurlData) {
            // Handle LNURL payment
            const lnurlPayResponse = await fetch(this.lnurlData.callback + 
              `?amount=${this.sendForm.customAmount * 1000}` +
              (this.sendForm.comment ? `&comment=${encodeURIComponent(this.sendForm.comment)}` : ''));
            const lnurlPayData = await lnurlPayResponse.json();
            
            if (lnurlPayData.pr) {
              result = await nwc.sendPayment(lnurlPayData.pr);
            } else {
              throw new Error(lnurlPayData.reason || 'LNURL payment failed');
            }
          } else {
            // Handle regular invoice payment
            result = await nwc.sendPayment(this.sendForm.invoice);
          }

          this.$q.notify({
            type: 'positive',
            message: 'Payment sent successfully!',
            position: 'top'
          });

          this.showSendDialog = false;
          this.sendForm.invoice = '';
          this.sendForm.decodedInvoice = null;
          this.sendForm.customAmount = '';
          this.sendForm.comment = '';
          this.paymentType = null;
          this.lnurlData = null;

          await this.updateWalletBalance();
          await this.loadTransactions();
        }
      } catch (error) {
        console.error('Payment failed:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Payment failed: ' + error.message,
          position: 'top'
        });
      } finally {
        this.isSending = false;
      }
    },

    async createInvoice() {
      if (!this.receiveForm.amount) return;

      this.isCreatingInvoice = true;
      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (activeWallet) {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          const invoice = await nwc.makeInvoice({
            amount: parseInt(this.receiveForm.amount),
            description: this.receiveForm.description || 'BuhoGO Invoice'
          });

          this.generatedInvoice = invoice;
        }
      } catch (error) {
        console.error('Failed to create invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to create invoice: ' + error.message,
          position: 'top'
        });
      } finally {
        this.isCreatingInvoice = false;
      }
    },

    async copyLightningAddress() {
      try {
        await navigator.clipboard.writeText(this.lightningAddress);
        this.$q.notify({
          type: 'positive',
          message: 'Lightning address copied to clipboard!',
          position: 'top'
        });
      } catch (error) {
        console.error('Failed to copy lightning address:', error);
      }
    },

    async copyInvoice() {
      try {
        await navigator.clipboard.writeText(this.generatedInvoice.payment_request);
        this.$q.notify({
          type: 'positive',
          message: 'Invoice copied to clipboard!',
          position: 'top'
        });
      } catch (error) {
        console.error('Failed to copy invoice:', error);
      }
    },

    async shareInvoice() {
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Lightning Invoice',
            text: `Payment request for ${this.formatBalance(this.receiveForm.amount)}`,
            url: `lightning:${this.generatedInvoice.payment_request}`
          });
        } catch (error) {
          console.error('Failed to share invoice:', error);
        }
      } else {
        this.copyInvoice();
      }
    },

    handleQRScan(result) {
      this.sendForm.invoice = result;
      this.showQRScanner = false;
      this.handlePaymentInput();
    }
  }
}
</script>

<style scoped>
.wallet-page {
  background: #f8f9fa;
  min-height: 100vh;
}

/* Header */
.wallet-header {
  background: white;
  padding: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.title {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, #10b981, #059669);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.settings-btn {
  color: #6b7280;
}

/* Balance Section */
.balance-section {
  background: white;
  padding: 3rem 1rem;
  text-align: center;
}

.balance-container {
  max-width: 400px;
  margin: 0 auto;
}

.balance-amount {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.amount-number {
  font-size: 3.5rem;
  font-weight: 700;
  color: #1f2937;
  line-height: 1;
}

.amount-unit {
  font-size: 1.5rem;
  color: #6b7280;
  font-weight: 500;
}

.balance-fiat {
  font-size: 1.25rem;
  color: #6b7280;
}

/* Action Section */
.action-section {
  background: white;
  padding: 2rem 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.action-buttons {
  display: flex;
  gap: 1rem;
  max-width: 400px;
  margin: 0 auto;
}

.action-btn {
  flex: 1;
  height: 80px;
  border-radius: 16px;
  background: linear-gradient(135deg, #059573, #047857);
  color: white;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.2);
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: linear-gradient(135deg, #047857, #065f46);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(5, 149, 115, 0.3);
}

.btn-text {
  font-size: 1.125rem;
}

/* Transactions Section */
.transactions-section {
  background: white;
  padding: 1rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding: 0 0.5rem;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.view-all-btn {
  font-weight: 500;
  text-transform: none;
  color: #10b981;
}

.transaction-list {
  display: flex;
  flex-direction: column;
}

.transaction-item {
  display: flex;
  align-items: center;
  padding: 1rem 0.5rem;
  cursor: pointer;
  transition: background-color 0.2s;
  border-radius: 8px;
}

.transaction-item:hover {
  background: #f9fafb;
}

.transaction-icon {
  margin-right: 1rem;
}

.tx-icon-container {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.tx-icon-received {
  background: #059573;
}

.tx-icon-sent {
  background: #6b7280;
}

.tx-icon-zap {
  background: #059573;
}

.transaction-info {
  flex: 1;
  min-width: 0;
}

.transaction-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.transaction-type {
  font-weight: 500;
  color: #1f2937;
  margin-bottom: 0.25rem;
  font-size: 1rem;
}

.transaction-time {
  color: #6b7280;
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
}

.transaction-description {
  color: #6b7280;
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 0.25rem;
}

.nostr-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #059573;
  font-size: 0.75rem;
  font-weight: 500;
}

.sender-avatar {
  border: 1px solid rgba(5, 149, 115, 0.3);
}

.sender-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.transaction-amount {
  text-align: right;
  min-width: 100px;
}

.amount-sats {
  font-weight: 600;
  font-size: 1rem;
  margin-bottom: 0.25rem;
}

.amount-positive {
  color: #059573;
}

.amount-negative {
  color: #6b7280;
}

.amount-fiat {
  color: #6b7280;
  font-size: 0.875rem;
}

/* Empty State */
.empty-transactions {
  background: white;
  padding: 3rem 1rem;
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  max-width: 300px;
  margin: 0 auto;
}

.empty-icon {
  margin-bottom: 1rem;
}

.empty-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 0.5rem;
}

.empty-subtitle {
  color: #6b7280;
  font-size: 0.875rem;
}

/* Dialog Styles */
.dialog-card {
  width: 100%;
  max-width: 500px;
  border-radius: 16px;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #e5e7eb;
  background: rgba(5, 149, 115, 0.05);
}

.dialog-content {
  padding: 1rem;
}

/* Payment Method Tabs */
.payment-method-tabs {
  margin-bottom: 1.5rem;
}

.receive-tabs {
  background: #f9fafb;
  border-radius: 8px;
  padding: 0.25rem;
}

.receive-tabs :deep(.q-tab) {
  border-radius: 6px;
  font-weight: 500;
}

.receive-tabs :deep(.q-tab--active) {
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.receive-panels {
  background: transparent;
}

/* Send Form Styles */
.send-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.input-section {
  position: relative;
}

.payment-input {
  margin-bottom: 0.5rem;
}

.input-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
}

.scan-btn,
.paste-btn {
  font-size: 0.875rem;
}

/* Payment Type Indicator */
.payment-type {
  margin-bottom: 1rem;
}

.type-indicator {
  display: flex;
  align-items: center;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
}

.type-invoice {
  background: rgba(5, 149, 115, 0.1);
  color: #059573;
}

.type-lnurl {
  background: rgba(120, 213, 60, 0.1);
  color: #78D53C;
}

.type-address {
  background: rgba(107, 114, 128, 0.1);
  color: #6b7280;
}

/* Amount Section */
.amount-section {
  padding: 1rem;
  background: #f9fafb;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.amount-input {
  margin-bottom: 1rem;
}

/* Invoice Details Section */
.invoice-details-section {
  margin-bottom: 1rem;
}

.invoice-details {
  background: #f9fafb;
  border-radius: 8px;
  padding: 1rem;
}

.details-header {
  display: flex;
  align-items: center;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 1rem;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.detail-row:last-child {
  margin-bottom: 0;
}

.detail-label {
  font-weight: 500;
  color: #6b7280;
}

.detail-value {
  font-weight: 600;
  color: #1f2937;
}

/* Address Form Styles */
.address-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.address-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: #f9fafb;
  border-radius: 8px;
}

.address-icon {
  width: 48px;
  height: 48px;
  background: rgba(5, 149, 115, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.address-text {
  flex: 1;
}

.address-title {
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.address-subtitle {
  color: #6b7280;
  font-size: 0.875rem;
}

.address-input {
  font-family: monospace;
}

.address-actions {
  display: flex;
  gap: 1rem;
}

.copy-address-btn,
.qr-address-btn {
  flex: 1;
}

/* Invoice Result Styles */
.invoice-result {
  margin-top: 1rem;
  text-align: center;
}

.qr-code-container {
  margin-bottom: 1rem;
  padding: 1rem;
  background: white;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.qr-code {
  border-radius: 8px;
  overflow: hidden;
}

.invoice-details {
  margin-bottom: 1rem;
  padding: 1rem;
  background: #f9fafb;
  border-radius: 8px;
}

.invoice-amount {
  font-size: 1.5rem;
  font-weight: 700;
  color: #059573;
  margin-bottom: 0.5rem;
}

.invoice-description {
  color: #6b7280;
  font-size: 0.875rem;
}

.invoice-text {
  margin-bottom: 1rem;
  font-family: monospace;
  font-size: 0.75rem;
}

.invoice-actions {
  display: flex;
  gap: 1rem;
}

.copy-btn,
.share-btn {
  flex: 1;
}

/* Payment Actions */
.payment-actions {
  margin-top: 1rem;
}

.send-payment-btn,
.create-invoice-btn {
  background: linear-gradient(135deg, #059573, #047857);
  border-radius: 12px;
  padding: 0.75rem;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(5, 149, 115, 0.2);
  transition: all 0.2s ease;
}

.send-payment-btn:hover,
.create-invoice-btn:hover {
  background: linear-gradient(135deg, #047857, #065f46);
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.3);
}

.qr-scanner-container {
  height: 300px;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid #e5e7eb;
}

/* Responsive Design */
@media (max-width: 480px) {
  .amount-number {
    font-size: 2.5rem;
  }
  
  .amount-unit {
    font-size: 1.25rem;
  }
  
  .balance-fiat {
    font-size: 1.125rem;
  }
  
  .action-btn {
    height: 70px;
  }
  
  .btn-text {
    font-size: 1rem;
  }
  
  .transaction-item {
    padding: 0.75rem 0.25rem;
  }
  
  .transaction-main {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
  
  .address-actions {
    flex-direction: column;
  }
  
  .invoice-actions {
    flex-direction: column;
  }
}
</style>