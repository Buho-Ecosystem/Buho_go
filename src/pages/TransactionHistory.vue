<template>
  <!-- Loading Screen -->
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <q-page :class="$q.dark.isActive ? 'transaction-history-page-dark' : 'transaction-history-page-light'">
    <!-- Header -->
    <div class="" :class="$q.dark.isActive ? 'page_header_dark' : 'page_header_light'">
      <q-btn
        flat
        round
        dense
        no-caps
        @click="$router.back()"
        :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
      >
        <svg v-if="$q.dark.isActive" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"
             fill="none">
          <path
            d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z"
            fill="white"/>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z"
            fill="#6D6D6D"/>
        </svg>
      </q-btn>
      <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
        {{ $t('Transactions') }}
      </div>
      <q-btn
        flat
        round
        no-caps
        dense
        @click="$router.push('/wallet')"
        :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M15 5L5 15M5 5L15 15" :stroke="$q.dark.isActive ? 'white' : '#6D6D6D'" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </q-btn>
    </div>

    <!-- Filter Tabs -->
    <div class="filter-section">
      <q-tabs
        v-model="activeFilter"
        dense
        :class="$q.dark.isActive ? 'filter_tabs_dark' : 'filter_tabs_light'"
        indicator-color="transparent"
        align="justify"
        class="q-ma-sm"
      >
        <q-tab
          v-for="tab in filterTabs"
          :key="tab.name"
          :name="tab.name"
          no-caps
          class="q-mx-sm"
          :label="$t(tab.label)"
          :class="activeFilter === tab.name ? ($q.dark.isActive ? 'tab_active_dark' : 'tab_active_light') : ($q.dark.isActive ? 'tab_inactive_dark' : 'tab_inactive_light')"
        />
      </q-tabs>
    </div>

    <!-- Summary Stats -->
    <div class="stats-section" v-if="activeFilter !== 'all' && filteredTransactions.length > 0"
         :class="$q.dark.isActive ? 'stats_section_dark' : 'stats_section_light'">
      <div class="stats-container" :class="$q.dark.isActive ? 'stats_container_dark' : 'stats_container_light'">
        <div class="stat-item">
          <div class="stat-label" :class="$q.dark.isActive ? 'stat_label_dark' : 'stat_label_light'">{{
              $t('Received')
            }}
          </div>
          <div class="stat-value positive">
            {{ formatAmountWithSign(totalReceived, true) }}
            <div class="stat-fiat" :class="$q.dark.isActive ? 'stat_fiat_dark' : 'stat_fiat_light'">
              +{{ getFiatAmountForStats(totalReceived) }}
            </div>
          </div>
        </div>
        <div class="stat-divider" :class="$q.dark.isActive ? 'stat_divider_dark' : 'stat_divider_light'"></div>
        <div class="stat-item">
          <div class="stat-label" :class="$q.dark.isActive ? 'stat_label_dark' : 'stat_label_light'">{{
              $t('Sent')
            }}
          </div>
          <div class="stat-value negative">
            {{ formatAmountWithSign(totalSent, false) }}
            <div class="stat-fiat" :class="$q.dark.isActive ? 'stat_fiat_dark' : 'stat_fiat_light'">
              -{{ getFiatAmountForStats(totalSent) }}
            </div>
          </div>
        </div>
        <div class="stat-divider" :class="$q.dark.isActive ? 'stat_divider_dark' : 'stat_divider_light'"></div>
        <div class="stat-item">
          <div class="stat-label" :class="$q.dark.isActive ? 'stat_label_dark' : 'stat_label_light'">{{
              $t('Net')
            }}
          </div>
          <div class="stat-value" :class="netAmount >= 0 ? 'positive' : 'negative'">
            {{ formatAmountWithSign(Math.abs(netAmount), netAmount >= 0) }}
            <div class="stat-fiat" :class="$q.dark.isActive ? 'stat_fiat_dark' : 'stat_fiat_light'">
              {{ netAmount >= 0 ? '+' : '' }}{{ getFiatAmountForStats(netAmount) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Transaction List -->
    <q-scroll-area
      class="transaction-content"
      :class="$q.dark.isActive ? 'transaction_content_dark' : 'transaction_content_light'"
      v-if="!isLoading && filteredTransactions.length > 0"
    >
      <div class="transaction-groups">
        <div
          v-for="group in groupedTransactions"
          :key="group.date"
          class="transaction-group"
        >
          <!-- Group Header -->
          <div
            v-if="!group.isFlat"
            class="group-header"
            :class="$q.dark.isActive ? 'group_header_dark' : 'group_header_light'"
            @click="toggleGroup(group.date)"
          >
            <div class="group-info">
              <div class="group-date" :class="$q.dark.isActive ? 'group_date_dark' : 'group_date_light'">
                {{ group.dateLabel }}
              </div>
              <div class="group-summary" :class="$q.dark.isActive ? 'group_summary_dark' : 'group_summary_light'">
                {{ group.transactions.length }} {{ $t('transaction') }}{{ group.transactions.length !== 1 ? 's' : '' }}
              </div>
            </div>
            <div class="group-amount">
              <div class="group-total"
                   :class="[group.netAmount >= 0 ? 'positive' : 'negative', $q.dark.isActive ? 'group_total_dark' : 'group_total_light']">
                {{ formatAmountWithSign(Math.abs(group.netAmount), group.netAmount >= 0) }}
                <div class="group-fiat text-right" :class="$q.dark.isActive ? 'group_fiat_dark' : 'group_fiat_light'">
                  {{ group.netAmount >= 0 ? '+' : '' }}{{ getFiatAmountForStats(group.netAmount) }}
                </div>
              </div>
              <q-icon
                :name="group.expanded ? 'las la-chevron-up' : 'las la-chevron-down'"
                :class="$q.dark.isActive ? 'expand_icon_dark' : 'expand_icon_light'"
              />
            </div>
          </div>

          <!-- Group Transactions -->
          <q-slide-transition>
            <div v-show="group.expanded || group.isFlat" class="group-transactions"
                 :class="[{ 'flat-list': group.isFlat }, $q.dark.isActive ? 'group_transactions_dark' : 'group_transactions_light']">

              <template v-for="tx in group.transactions" :key="tx.id">
                <!-- Regular Transaction -->
                <div
                  v-if="!tx.isGroup"
                  class="transaction-card"
                  :class="$q.dark.isActive ? 'transaction_card_dark' : 'transaction_card_light'"
                  @click="viewTransaction(tx)"
                >
                <!-- Left: Avatar/Icon -->
                <div class="tx-avatar">
                  <div v-if="getContactForTransaction(tx)"
                       class="contact-avatar"
                       :style="{ backgroundColor: getContactForTransaction(tx).color }">
                    {{ getContactForTransaction(tx).name.substring(0, 2).toUpperCase() }}
                  </div>
                  <div v-else class="direction-icon" :class="tx.type">
                    <q-icon :name="getTransactionIcon(tx)" size="20px"/>
                  </div>
                </div>

                <!-- Center: Info -->
                <div class="tx-info">
                  <!-- Line 1: Time or Status (always shown) -->
                  <div class="tx-primary" :class="$q.dark.isActive ? 'tx_primary_dark' : 'tx_primary_light'">
                    <span v-if="tx.status === 'pending'">{{ $t('Sending...') }}</span>
                    <span v-else>{{ formatShortTime(tx.settled_at) }}</span>
                  </div>

                  <!-- Line 2: Contact name (if assigned) -->
                  <div v-if="getContactForTransaction(tx)"
                       class="tx-secondary"
                       :class="$q.dark.isActive ? 'tx_secondary_dark' : 'tx_secondary_light'">
                    {{ getContactForTransaction(tx).name }}
                  </div>

                  <!-- Line 3: Description (if present) -->
                  <div v-if="shouldShowDescription(tx)"
                       class="tx-description tx-description-italic"
                       :class="$q.dark.isActive ? 'tx_description_dark' : 'tx_description_light'">
                    {{ tx.description || tx.memo }}
                  </div>

                  <!-- Line 4: Tags (if present) -->
                  <div v-if="getTagsForTransaction(tx).length > 0" class="tx-tags">
                    <span v-for="tag in getTagsForTransaction(tx)" :key="tag" class="tag-pill">
                      {{ tag }}
                    </span>
                  </div>
                </div>

                <!-- Right: Amounts -->
                <div class="tx-amounts">
                  <div class="amount-sats"
                       :class="[getAmountClass(tx), $q.dark.isActive ? 'amount_sats_dark' : 'amount_sats_light']">
                    {{ getFormattedAmount(tx) }}
                  </div>
                  <div class="amount-fiat" :class="$q.dark.isActive ? 'amount_fiat_dark' : 'amount_fiat_light'">
                    {{ getFiatAmount(tx) }}
                  </div>
                </div>
                </div>

                <!-- Micropayment Group -->
                <div
                  v-if="tx.isGroup"
                  class="micropayment-group"
                  :class="$q.dark.isActive ? 'micropayment_group_dark' : 'micropayment_group_light'"
                >
                <div class="group-header-micro" @click="toggleMicropaymentGroup(tx.id)">
                  <div class="group-icon-micro">
                    <q-icon name="las la-layer-group" size="20px"/>
                  </div>
                  <div class="group-info-micro">
                    <div class="group-primary" :class="$q.dark.isActive ? 'group_primary_dark' : 'group_primary_light'">
                      {{ tx.count }} {{ tx.transactionType === 'incoming' ? 'payments from' : 'payments to' }} {{ getGroupRecipientDisplay(tx) }}
                    </div>
                    <div class="group-secondary" :class="$q.dark.isActive ? 'group_secondary_dark' : 'group_secondary_light'">
                      {{ formatRelativeTime(tx.startTime) }}
                    </div>
                  </div>
                  <div class="group-amount-micro">
                    <div class="amount-sats"
                         :class="[tx.transactionType === 'incoming' ? 'positive' : 'negative', $q.dark.isActive ? 'amount_sats_dark' : 'amount_sats_light']">
                      {{ tx.transactionType === 'incoming' ? '+' : '-' }}{{ Math.abs(tx.totalAmount).toLocaleString() }} sats
                    </div>
                    <q-icon
                      :name="expandedMicropaymentGroups.has(tx.id) ? 'las la-chevron-up' : 'las la-chevron-down'"
                      size="16px"
                      :class="$q.dark.isActive ? 'expand_icon_dark' : 'expand_icon_light'"
                    />
                  </div>
                </div>

                <!-- Expanded Group Items -->
                <q-slide-transition>
                  <div v-show="expandedMicropaymentGroups.has(tx.id)" class="group-items-micro"
                       :class="$q.dark.isActive ? 'group_items_micro_dark' : 'group_items_micro_light'">
                    <div
                      v-for="innerTx in tx.transactions"
                      :key="innerTx.id"
                      class="group-item-micro"
                      :class="$q.dark.isActive ? 'group_item_micro_dark' : 'group_item_micro_light'"
                      @click="viewTransaction(innerTx)"
                    >
                      <div class="item-time" :class="$q.dark.isActive ? 'item_time_dark' : 'item_time_light'">
                        {{ formatShortTime(innerTx.settled_at) }}
                      </div>
                      <div class="item-amount"
                           :class="[innerTx.type === 'incoming' ? 'positive' : '', $q.dark.isActive ? 'item_amount_dark' : 'item_amount_light']">
                        {{ innerTx.type === 'incoming' ? '+' : '-' }}{{ Math.abs(innerTx.amount).toLocaleString() }} sats
                      </div>
                    </div>
                  </div>
                </q-slide-transition>
                </div>
              </template>
            </div>
          </q-slide-transition>
        </div>
      </div>
    </q-scroll-area>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading-state"
         :class="$q.dark.isActive ? 'loading_state_dark' : 'loading_state_light'">
      <q-spinner-dots :color="$q.dark.isActive ? '#15DE72' : '#059573'" size="3rem"/>
      <div class="loading-text" :class="$q.dark.isActive ? 'loading_text_dark' : 'loading_text_light'">
        {{ $t('Loading transactions...') }}
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="!isLoading && filteredTransactions.length === 0" class=" full-height"
         :class="$q.dark.isActive ? 'empty_state_dark' : 'empty_state_light'">
      <div class="empty-icon">
        <q-icon name="las la-receipt" size="4rem" :color="$q.dark.isActive ? '#B0B0B0' : '#D1D5DB'"/>
      </div>
      <div class="empty-title" :class="$q.dark.isActive ? 'empty_title_dark' : 'empty_title_light'">
        {{ $t('No transactions found') }}
      </div>
      <div class="empty-subtitle" :class="$q.dark.isActive ? 'empty_subtitle_dark' : 'empty_subtitle_light'">
        {{
          activeFilter === 'all' ? $t('Your transactions will appear here') : $t('No transactions for') + ' ' + $t(activeFilter)
        }}
      </div>
      <q-btn
        :label="$t('Refresh')"
        icon="las la-sync-alt"
        @click="loadTransactions"
        :class="$q.dark.isActive ? 'btn_dark' : 'btn_light'"
        no-caps
      />
    </div>

    <!-- Floating Refresh Button -->
    <q-page-sticky position="bottom-right" :offset="[18, 18]">
      <q-btn
        fab
        icon="las la-sync-alt"
        @click="refreshTransactions"
        :loading="isRefreshing"
        :class="$q.dark.isActive ? 'refresh_fab_dark' : 'refresh_fab_light'"
      />
    </q-page-sticky>
  </q-page>
</template>

<script>
import { NostrWebLNProvider } from "@getalby/sdk";
import LoadingScreen from '../components/LoadingScreen.vue';
import { fiatRatesService } from '../utils/fiatRates.js';
import { formatAmount as formatAmountUtil, formatAmountWithPrefix } from '../utils/amountFormatting.js';
import { useWalletStore } from '../stores/wallet';
import { useAddressBookStore } from '../stores/addressBook';
import { useTransactionMetadataStore } from '../stores/transactionMetadata';
import { formatRelativeTime, formatShortTime } from '../utils/timeFormatting';
import { groupMicropayments } from '../composables/useTransactionGrouping';

export default {
  name: 'TransactionHistoryPage',
  components: {
    LoadingScreen
  },
  data() {
    return {
      isLoading: true,
      isRefreshing: false,
      activeFilter: 'week',
      transactions: [],
      walletState: {},
      walletStore: null,
      addressBookStore: null,
      metadataStore: null,
      nostrProfiles: {},
      expandedGroups: new Set(),
      expandedMicropaymentGroups: new Set(),
      showLoadingScreen: true,
      loadingText: 'Loading transactions...',
      filterTabs: [
        {name: 'all', label: 'All'},
        {name: 'today', label: 'Today'},
        {name: 'week', label: 'Week'},
        {name: 'month', label: 'Month'}
      ],
      fiatRates: {},
      loadingFiatRates: true
    }
  },
  computed: {
    filteredTransactions() {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      return this.transactions.filter(tx => {
        const txDate = new Date(tx.settled_at * 1000);

        switch (this.activeFilter) {
          case 'today':
            return txDate >= today;
          case 'week':
            return txDate >= sevenDaysAgo;
          case 'month':
            return txDate >= monthAgo;
          default:
            return true;
        }
      });
    },

    groupedTransactions() {
      // Safety check
      if (!this.filteredTransactions || this.filteredTransactions.length === 0) {
        return [{
          date: 'flat',
          dateLabel: '',
          transactions: [],
          netAmount: 0,
          expanded: true,
          isFlat: true
        }];
      }

      // Apply micropayment grouping first
      const groupedWithMicropayments = groupMicropayments(this.filteredTransactions, {
        timeWindowSeconds: 3600,
        descriptionSimilarity: 0.75,
        minGroupSize: 2,
        enabled: true
      });

      if (this.activeFilter === 'all') {
        const groups = {};

        groupedWithMicropayments.forEach(tx => {
          // Use endTime for groups, settled_at for regular transactions
          const timestamp = tx.isGroup ? tx.endTime : tx.settled_at;
          const date = new Date(timestamp * 1000);
          const groupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

          if (!groups[groupKey]) {
            groups[groupKey] = {
              date: groupKey,
              dateLabel: date.toLocaleDateString('en-US', {year: 'numeric', month: 'long'}),
              transactions: [],
              netAmount: 0,
              expanded: this.expandedGroups.has(groupKey)
            };
          }

          groups[groupKey].transactions.push(tx);

          // Calculate net amount
          if (tx.isGroup) {
            groups[groupKey].netAmount += tx.transactionType === 'incoming' ? tx.totalAmount : -tx.totalAmount;
          } else {
            groups[groupKey].netAmount += tx.type === 'incoming' ? Math.abs(tx.amount) : -Math.abs(tx.amount);
          }
        });

        return Object.values(groups)
          .sort((a, b) => b.date.localeCompare(a.date))
          .map(group => ({
            ...group,
            transactions: group.transactions.sort((a, b) => {
              const aTime = a.isGroup ? a.endTime : a.settled_at;
              const bTime = b.isGroup ? b.endTime : b.settled_at;
              return bTime - aTime;
            })
          }));
      }

      return [{
        date: 'flat',
        dateLabel: '',
        transactions: groupedWithMicropayments.sort((a, b) => {
          const aTime = a.isGroup ? a.endTime : a.settled_at;
          const bTime = b.isGroup ? b.endTime : b.settled_at;
          return bTime - aTime;
        }),
        netAmount: this.netAmount,
        expanded: true,
        isFlat: true
      }];
    },

    totalReceived() {
      return this.filteredTransactions
        .filter(tx => tx.type === 'incoming')
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    },

    totalSent() {
      return this.filteredTransactions
        .filter(tx => tx.type === 'outgoing')
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    },

    netAmount() {
      return this.totalReceived - this.totalSent;
    }
  },
  async created() {
    this.walletStore = useWalletStore();
    this.addressBookStore = useAddressBookStore();
    this.metadataStore = useTransactionMetadataStore();

    // Initialize stores
    await this.addressBookStore.initialize();
    await this.metadataStore.initialize();

    this.initializeTransactionHistory();
    this.loadFiatRates();
  },

  watch: {
    'fiatRates': {
      handler() {
        this.$forceUpdate();
      },
      deep: true
    }
  },
  methods: {
    async initializeTransactionHistory() {
      try {
        this.loadingText = 'Loading transaction history...';
        await this.loadTransactions();

        this.loadingText = 'Loading profiles...';
        this.loadNostrProfiles();

        this.loadingText = 'Ready!';
        await new Promise(resolve => setTimeout(resolve, 300));
        this.showLoadingScreen = false;
      } catch (error) {
        console.error('Error initializing transaction history:', error);
        this.showLoadingScreen = false;
      }
    },

    // New helper methods for redesigned transaction cards

    getContactForTransaction(tx) {
      if (!tx || !tx.id || !this.metadataStore || !this.addressBookStore) return null;
      try {
        const metadata = this.metadataStore.getMetadataForTransaction(tx.id);
        if (!metadata?.contactId) return null;
        return this.addressBookStore.getEntryById(metadata.contactId);
      } catch (error) {
        console.error('Error getting contact for transaction:', error);
        return null;
      }
    },

    getTagsForTransaction(tx) {
      if (!tx || !tx.id || !this.metadataStore) return [];
      try {
        return this.metadataStore.getTagsForTransaction(tx.id) || [];
      } catch (error) {
        console.error('Error getting tags for transaction:', error);
        return [];
      }
    },

    shouldShowDescription(tx) {
      if (!tx) {
        console.log('shouldShowDescription: no tx');
        return false;
      }
      const desc = tx.description || tx.memo;
      if (!desc) {
        console.log('shouldShowDescription: no description/memo for tx', tx.id);
        return false;
      }
      if (desc === 'Lightning transaction') {
        console.log('shouldShowDescription: default Lightning transaction text for tx', tx.id);
        return false;
      }
      console.log('shouldShowDescription: showing description for tx', tx.id, '-', desc);
      return true;
    },

    formatRelativeTime(timestamp) {
      if (!timestamp) return '';
      try {
        return formatRelativeTime(timestamp);
      } catch (error) {
        console.error('Error formatting relative time:', error);
        return '';
      }
    },

    formatShortTime(timestamp) {
      if (!timestamp) return '';
      try {
        return formatShortTime(timestamp);
      } catch (error) {
        console.error('Error formatting short time:', error);
        return '';
      }
    },

    toggleMicropaymentGroup(groupId) {
      if (this.expandedMicropaymentGroups.has(groupId)) {
        this.expandedMicropaymentGroups.delete(groupId);
      } else {
        this.expandedMicropaymentGroups.add(groupId);
      }
      this.$forceUpdate(); // Force re-render to show/hide expansion
    },

    getGroupRecipientDisplay(group) {
      if (!group) return 'unknown';

      try {
        let recipient = group.recipient || '';

        // If it's a hash or too long, use description instead
        if (!recipient || recipient.length > 20 || recipient.startsWith('lnbc')) {
          recipient = group.description || 'unknown';
        }

        // Truncate if still too long
        if (recipient && recipient.length > 30) {
          return recipient.substring(0, 27) + '...';
        }

        return recipient || 'unknown';
      } catch (error) {
        console.error('Error getting group recipient display:', error);
        return 'unknown';
      }
    },

    // Auto-assign contacts from address book
    async autoAssignContacts() {
      if (!this.transactions || !this.addressBookStore || !this.metadataStore) {
        return;
      }

      console.log('Auto-assigning contacts for transactions...');
      let assignedCount = 0;

      for (const tx of this.transactions) {
        try {
          // Skip if already assigned
          const existingMetadata = this.metadataStore.getMetadataForTransaction(tx.id);
          if (existingMetadata?.contactId) {
            continue;
          }

          // Try to find a matching contact
          let matchedContact = null;

          // 1. Check for Nostr zap sender
          if (tx.senderNpub) {
            // Look for contact with matching npub in notes or address
            matchedContact = this.addressBookStore.entries.find(contact =>
              contact.notes?.includes(tx.senderNpub) ||
              contact.address?.includes(tx.senderNpub)
            );
          }

          // 2. Check description/memo for Lightning address
          if (!matchedContact) {
            const desc = tx.description || tx.memo || '';
            const lightningAddressMatch = desc.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

            if (lightningAddressMatch) {
              const address = lightningAddressMatch[0].toLowerCase();
              matchedContact = this.addressBookStore.entries.find(contact =>
                contact.address?.toLowerCase() === address
              );
            }
          }

          // 3. Check payment_request for matches (first few chars)
          if (!matchedContact && tx.payment_request) {
            const invoicePrefix = tx.payment_request.substring(0, 20);
            matchedContact = this.addressBookStore.entries.find(contact =>
              contact.notes?.includes(invoicePrefix)
            );
          }

          // If we found a match, auto-assign it
          if (matchedContact) {
            await this.metadataStore.setContactForTransaction(tx.id, matchedContact.id);
            assignedCount++;
            console.log(`Auto-assigned contact "${matchedContact.name}" to transaction ${tx.id}`);
          }
        } catch (error) {
          console.error(`Error auto-assigning contact for transaction ${tx.id}:`, error);
        }
      }

      if (assignedCount > 0) {
        console.log(`Auto-assigned ${assignedCount} contacts`);
        this.$forceUpdate(); // Refresh UI to show assigned contacts
      }
    },

    async loadTransactions() {
      this.isLoading = true;
      try {
        if (this.showLoadingScreen) {
          this.loadingText = 'Connecting to wallet...';
        }

        // Load wallet state for fiat currency preference
        const savedState = localStorage.getItem('buhoGO_wallet_state');
        if (savedState) {
          this.walletState = JSON.parse(savedState);
        }

        if (this.showLoadingScreen) {
          this.loadingText = 'Fetching transactions...';
        }

        // Check wallet type and load transactions accordingly
        if (this.walletStore.isActiveWalletSpark) {
          await this.loadSparkTransactions();
        } else {
          await this.loadNWCTransactions();
        }

        this.transactions.sort((a, b) => b.settled_at - a.settled_at);

        if (this.showLoadingScreen) {
          this.loadingText = 'Processing zap transactions...';
        }

        await this.processZapTransactions();

        if (this.showLoadingScreen) {
          this.loadingText = 'Auto-assigning contacts...';
        }

        // Auto-assign contacts from address book
        await this.autoAssignContacts();

      } catch (error) {
        console.error('Error loading transactions:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t load history'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } finally {
        this.isLoading = false;
      }
    },

    async loadSparkTransactions() {
      // Check if Spark wallet needs PIN unlock
      if (this.walletStore.needsPinEntry) {
        // Redirect to wallet page to unlock
        this.$q.notify({
          type: 'warning',
          message: this.$t('Wallet locked'),
          caption: this.$t('Please unlock your Spark wallet to view transactions'),
          position: 'bottom',
          timeout: 3000,
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
        this.$router.push('/wallet');
        return;
      }

      // Ensure Spark wallet is connected (auto-connects if session PIN available)
      const provider = await this.walletStore.ensureSparkConnected();

      if (!provider) {
        throw new Error('Could not connect to Spark wallet');
      }

      const sparkTransactions = await provider.getTransactions({ limit: 500, offset: 0 });

      // Normalize Spark transactions to match expected format
      this.transactions = (sparkTransactions || []).map(tx => ({
        id: tx.id,
        type: tx.type === 'receive' ? 'incoming' : 'outgoing',
        amount: tx.amount || 0,
        description: tx.description || '',
        memo: tx.description || '',
        settled_at: tx.timestamp || Math.floor(Date.now() / 1000),
        fee: tx.fee || 0,
        status: tx.status || 'completed',
        sparkTransfer: tx.sparkTransfer || false,
        rawType: tx.rawType || null
      }));
    },

    async loadNWCTransactions() {
      const activeWallet = this.walletState.connectedWallets?.find(
        w => w.id === this.walletState.activeWalletId
      );

      if (!activeWallet?.nwcString) {
        throw new Error('No active NWC wallet found');
      }

      const nwc = new NostrWebLNProvider({
        nostrWalletConnectUrl: activeWallet.nwcString,
      });

      await nwc.enable();

      const transactionsResponse = await nwc.listTransactions({
        limit: 500,
        offset: 0
      });

      if (transactionsResponse && transactionsResponse.transactions) {
        this.transactions = transactionsResponse.transactions.map(tx => ({
          ...tx,
          id: tx.id || tx.payment_hash || `tx-${Date.now()}-${Math.random()}`,
          type: tx.type || (tx.amount > 0 ? 'incoming' : 'outgoing'),
          description: tx.description || tx.memo || '',
          settled_at: tx.settled_at || tx.created_at || Math.floor(Date.now() / 1000),
          fee: tx.fee || tx.fees_paid || 0,
          payment_request: tx.payment_request || tx.invoice || null
        }));
      }
    },

    async refreshTransactions() {
      this.isRefreshing = true;
      await this.loadTransactions();
      this.isRefreshing = false;

      this.$q.notify({
        type: 'positive',
        message: this.$t('Up to date'),
        position: 'bottom',
        actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
      });
    },

    async processZapTransactions() {
      for (const tx of this.transactions) {
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
          displayName: this.generateDisplayName(),
          picture: `https://api.dicebear.com/7.x/avataaars/svg?seed=${npub}`,
          about: 'Lightning Network enthusiast',
          nip05: '',
          lud16: `${npub.substring(0, 8)}@getalby.com`
        };

        this.nostrProfiles[npub] = profile;
        this.saveNostrProfiles();
      } catch (error) {
        console.error('Error fetching nostr profile:', error);
      }
    },

    generateDisplayName() {
      const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
      return names[Math.floor(Math.random() * names.length)];
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

    toggleGroup(dateKey) {
      if (dateKey === 'flat') return;

      if (this.expandedGroups.has(dateKey)) {
        this.expandedGroups.delete(dateKey);
      } else {
        this.expandedGroups.add(dateKey);
      }

      const group = this.groupedTransactions.find(g => g.date === dateKey);
      if (group) {
        group.expanded = this.expandedGroups.has(dateKey);
      }
    },

    getTransactionTypeText(tx) {
      if (tx.senderNpub && this.nostrProfiles[tx.senderNpub]) {
        return this.$t('Received');
      }
      return tx.type === 'incoming' ? this.$t('Received') : this.$t('Sent');
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
      return formatAmountWithPrefix(Math.abs(tx.amount), this.walletStore.useBip177Format, prefix);
    },

    formatAmount(amount) {
      return formatAmountUtil(Math.abs(amount), this.walletStore.useBip177Format);
    },

    formatAmountWithSign(amount, isPositive) {
      const sign = isPositive ? '+' : '-';
      return formatAmountWithPrefix(Math.abs(amount), this.walletStore.useBip177Format, sign);
    },

    async loadFiatRates() {
      try {
        this.loadingFiatRates = true;
        await fiatRatesService.ensureRatesLoaded();
        this.fiatRates = fiatRatesService.getRates();
      } catch (error) {
        console.error('Error loading fiat rates:', error);
      } finally {
        this.loadingFiatRates = false;
      }
    },

    getFiatAmount(tx) {
      if (this.loadingFiatRates) {
        return '...';
      }

      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const fiatValue = fiatRatesService.convertSatsToFiatSync(Math.abs(tx.amount), currency);

        // Handle unavailable rates
        if (fiatValue === null) {
          return '--';
        }

        const symbols = {
          USD: '$',
          EUR: '€',
          GBP: '£',
          CAD: 'C$',
          CHF: 'CHF',
          AUD: 'A$',
          JPY: '¥'
        };

        const symbol = symbols[currency] || currency;
        return symbol + fiatValue.toFixed(2);
      } catch (error) {
        console.error('Error converting to fiat:', error);
        return '--';
      }
    },

    getFiatAmountForStats(amount) {
      if (this.loadingFiatRates) {
        return '...';
      }

      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const fiatValue = fiatRatesService.convertSatsToFiatSync(Math.abs(amount), currency);

        // Handle unavailable rates
        if (fiatValue === null) {
          return '--';
        }

        const symbols = {
          USD: '$',
          EUR: '€',
          GBP: '£',
          CAD: 'C$',
          CHF: 'CHF',
          AUD: 'A$',
          JPY: '¥'
        };

        const symbol = symbols[currency] || currency;
        return symbol + fiatValue.toFixed(2);
      } catch (error) {
        console.error('Error converting to fiat:', error);
        return '--';
      }
    },

    formatTime(timestamp) {
      const date = new Date(timestamp * 1000);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    },

    viewTransaction(tx) {
      this.$router.push(`/transaction/${tx.id}`);
    }
  }
}
</script>

<style scoped>
/* Base Page Styles */
.transaction-history-page-dark {
  background: #171717;
  min-height: 100vh;
  font-family: Fustat, sans-serif;
}

.transaction-history-page-light {
  background: #F6F6F6;
  min-height: 100vh;
  font-family: Fustat, sans-serif;
}

/* Header Styles */
.page_header_dark {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: #0C0C0C;
  border-bottom: 1px solid #2A342A;
  position: sticky;
  top: 0;
  z-index: 100;
}

.page_header_light {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: white;
  border-bottom: 1px solid #E5E7EB;
  position: sticky;
  top: 0;
  z-index: 100;
}

.back_btn_dark,
.close_btn_dark {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease;
  color: #F6F6F6;
}

.back_btn_light,
.close_btn_light {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease;
  color: #6B7280;
}

.back_btn_dark:hover,
.close_btn_dark:hover {
  background: #2A342A;
}

.back_btn_light:hover,
.close_btn_light:hover {
  background: #F1F5F9;
}

.main_page_title_dark {
  color: #F6F6F6;
  font-size: 1.25rem;
  font-weight: 600;
  font-family: Fustat, sans-serif;
}

.main_page_title_light {
  color: #212121;
  font-size: 1.25rem;
  font-weight: 600;
  font-family: Fustat, sans-serif;
}

/* Filter Section */
.filter_section_dark {
  background: #0C0C0C;
  border-bottom: 1px solid #2A342A;
}

.filter_section_light {
  background: white;
  border-bottom: 1px solid #E5E7EB;
}

.filter_tabs_dark,
.filter_tabs_light {
  padding: 0 1rem;
}

.tab_active_dark {
  background: rgba(21, 222, 114, 0.1) !important;
  color: #15DE72 !important;
  border-radius: 12px !important;
  font-weight: 600 !important;
  font-family: Fustat, sans-serif !important;
}

.tab_active_light {
  background: rgba(5, 149, 115, 0.1) !important;
  color: #059573 !important;
  border-radius: 12px !important;
  font-weight: 600 !important;
  font-family: Fustat, sans-serif !important;
}

.tab_inactive_dark {
  color: #B0B0B0 !important;
  font-weight: 500 !important;
  font-family: Fustat, sans-serif !important;
  border-radius: 12px !important;
}

.tab_inactive_light {
  color: #6B7280 !important;
  font-weight: 500 !important;
  font-family: Fustat, sans-serif !important;
  border-radius: 12px !important;
}

/* Stats Section */
.stats_section_dark {
  background: #171717;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #2A342A;
}

.stats_section_light {
  background: #F6F6F6;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #E5E7EB;
}

.stats_container_dark {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #0C0C0C;
  border: 1px solid #2A342A;
  border-radius: 12px;
  padding: 0.75rem 1rem;
}

.stats_container_light {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  padding: 0.75rem 1rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.stat_label_dark {
  font-size: 0.6875rem;
  color: #B0B0B0;
  margin-bottom: 0.25rem;
  font-weight: 400;
  text-transform: capitalize;
  letter-spacing: 0.025em;
  font-family: Fustat, sans-serif;
}

.stat_label_light {
  font-size: 0.6875rem;
  color: #6B7280;
  margin-bottom: 0.25rem;
  font-weight: 400;
  text-transform: capitalize;
  letter-spacing: 0.025em;
  font-family: Fustat, sans-serif;
}

.stat-value {
  font-size: 0.875rem;
  font-weight: 700;
  white-space: nowrap;
  font-family: Fustat, sans-serif;
}

.stat-value.positive {
  color: #15DE72;
}

.stat-value.negative {
  color: #FF4B4B;
}

.stat-fiat {
  font-size: 0.75rem;
  font-weight: 400;
  margin-top: 0.125rem;
  opacity: 0.8;
}

.stat_fiat_dark {
  color: #B0B0B0;
}

.stat_fiat_light {
  color: #6B7280;
}

.stat_divider_dark {
  width: 1px;
  height: 24px;
  background: #2A342A;
}

.stat_divider_light {
  width: 1px;
  height: 24px;
  background: #E5E7EB;
}

/* Transaction Content */
.transaction_content_dark {
  height: calc(100vh - 200px);
  background: #171717;
}

.transaction_content_light {
  height: calc(100vh - 200px);
  background: #F6F6F6;
}

.transaction-groups {
  padding: 0.5rem;
}

.transaction-group {
  margin-bottom: 1rem;
}

/* Group Header */
.group_header_dark {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #1A1A1A;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  margin: 0 16px 8px 16px;
  font-family: Fustat, 'Inter', sans-serif;
}

.group_header_light {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #FFFFFF;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  margin: 0 16px 8px 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  font-family: Fustat, 'Inter', sans-serif;
}

.group_header_dark:hover {
  background: rgba(255, 255, 255, 0.05);
}

.group_header_light:hover {
  background: rgba(0, 0, 0, 0.02);
}

.group-info {
  flex: 1;
}

.group_date_dark {
  font-size: 15px;
  font-weight: 500;
  color: #FFFFFF;
  margin-bottom: 2px;
  font-family: Fustat, 'Inter', sans-serif;
}

.group_date_light {
  font-size: 15px;
  font-weight: 500;
  color: #000000;
  margin-bottom: 2px;
  font-family: Fustat, 'Inter', sans-serif;
}

.group_summary_dark {
  font-size: 13px;
  color: #999;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: Fustat, 'Inter', sans-serif;
}

.group_summary_light {
  font-size: 13px;
  color: #6B7280;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: Fustat, 'Inter', sans-serif;
}

.group-amount {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.group_total_dark {
  font-size: 15px;
  font-weight: 500;
  font-family: Fustat, 'Inter', sans-serif;
}

.group_total_light {
  font-size: 15px;
  font-weight: 500;
  font-family: Fustat, 'Inter', sans-serif;
}

.group-fiat {
  font-size: 13px;
  font-weight: 400;
  margin-top: 2px;
}

.group_fiat_dark {
  color: #999;
}

.group_fiat_light {
  color: #6B7280;
}

.expand_icon_dark {
  color: #B0B0B0;
  transition: transform 0.2s;
}

.expand_icon_light {
  color: #6B7280;
  transition: transform 0.2s;
}

/* Group Transactions */
.group_transactions_dark {
  background: #1A1A1A;
  border-radius: 12px;
  overflow: hidden;
  margin: 0 16px 16px 16px;
}

.group_transactions_light {
  background: #FFFFFF;
  border-radius: 12px;
  overflow: hidden;
  margin: 0 16px 16px 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.flat-list {
  border: none !important;
  border-radius: 0 !important;
  background: transparent !important;
  margin: 0 !important;
  box-shadow: none !important;
}

.transaction_item_dark {
  display: flex;
  align-items: center;
  padding: 1rem;
  cursor: pointer;
  transition: background-color 0.2s;
  border-bottom: 1px solid #2A342A;
}

.transaction_item_light {
  display: flex;
  align-items: center;
  padding: 1rem;
  cursor: pointer;
  transition: background-color 0.2s;
  border-bottom: 1px solid #F3F4F6;
}

.transaction_item_dark:hover {
  background: #171717;
}

.transaction_item_light:hover {
  background: #F9FAFB;
}

.transaction_item_dark:last-child,
.transaction_item_light:last-child {
  border-bottom: none;
}

.transaction-icon {
  margin-right: 1rem;
}

.tx-icon-container {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.tx-icon-received {
  background: linear-gradient(135deg, #15DE72, #059573);
}

.tx-icon-sent {
  background: linear-gradient(135deg, #6B7280, #4B5563);
}

.tx-icon-zap {
  background: linear-gradient(135deg, #15DE72, #43B65B);
}

.transaction-details {
  flex: 1;
  min-width: 0;
}

.transaction-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.transaction_type_dark {
  font-weight: 500;
  color: #F6F6F6;
  font-size: 0.95rem;
  font-family: Fustat, sans-serif;
}

.transaction_type_light {
  font-weight: 500;
  color: #212121;
  font-size: 0.95rem;
  font-family: Fustat, sans-serif;
}

.transaction_time_dark {
  color: #B0B0B0;
  font-size: 0.8rem;
  font-family: Fustat, sans-serif;
}

.transaction_time_light {
  color: #6B7280;
  font-size: 0.8rem;
  font-family: Fustat, sans-serif;
}

.transaction_description_dark {
  color: #B0B0B0;
  font-size: 0.8rem;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
  display: block;
  font-family: Fustat, sans-serif;
}

.transaction_description_light {
  color: #6B7280;
  font-size: 0.8rem;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
  display: block;
  font-family: Fustat, sans-serif;
}

.nostr_info_dark {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #15DE72;
  font-size: 0.7rem;
  font-weight: 500;
  font-family: Fustat, sans-serif;
}

.nostr_info_light {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #059573;
  font-size: 0.7rem;
  font-weight: 500;
  font-family: Fustat, sans-serif;
}

.sender-avatar {
  border: 1px solid rgba(21, 222, 114, 0.3);
}

.sender-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
}

.transaction-amount {
  text-align: right;
  min-width: 90px;
}

.amount_sats_dark {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.25rem;
  font-family: Fustat, sans-serif;
}

.amount_sats_light {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.25rem;
  font-family: Fustat, sans-serif;
}

.amount-positive {
  color: #15DE72;
}

.amount-negative {
  color: #FF4B4B;
}

.amount_fiat_dark {
  color: #B0B0B0;
  font-size: 0.8rem;
  font-family: Fustat, sans-serif;
}

.amount_fiat_light {
  color: #6B7280;
  font-size: 0.8rem;
  font-family: Fustat, sans-serif;
}

/* Redesigned Transaction Card - Bitcoin Design Guide Pattern */
.transaction-card,
.transaction_card_dark,
.transaction_card_light {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  min-height: 72px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  font-family: Fustat, 'Inter', sans-serif;
}

.transaction_card_dark {
  border-bottom: 1px solid #2A2A2A;
}

.transaction_card_light {
  border-bottom: 1px solid #E5E7EB;
}

/* Remove border on last transaction in grouped view */
.group_transactions_dark .transaction-card:last-child,
.group_transactions_dark .micropayment-group:last-child {
  border-bottom: none;
}

.group_transactions_light .transaction-card:last-child,
.group_transactions_light .micropayment-group:last-child {
  border-bottom: none;
}

.transaction_card_dark:hover {
  background: rgba(255, 255, 255, 0.05);
}

.transaction_card_light:hover {
  background: rgba(0, 0, 0, 0.02);
}

/* Avatar/Icon Section */
.tx-avatar {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
}

.contact-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 600;
  color: white;
  font-family: Fustat, sans-serif;
}

.direction-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  color: white;
}

.direction-icon.incoming {
  background: linear-gradient(135deg, #15DE72, #059573);
}

.direction-icon.outgoing {
  background: linear-gradient(135deg, #6B7280, #4B5563);
}

/* Info Section */
.tx-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.tx-primary,
.tx_primary_dark,
.tx_primary_light {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.4;
  font-family: Fustat, 'Inter', sans-serif;
}

.tx_primary_dark {
  color: #FFFFFF;
}

.tx_primary_light {
  color: #000000;
}

.tx-secondary,
.tx_secondary_dark,
.tx_secondary_light {
  font-size: 13px;
  line-height: 1.4;
  margin-top: 2px;
  font-family: Fustat, 'Inter', sans-serif;
}

.tx_secondary_dark {
  color: #999;
}

.tx_secondary_light {
  color: #6B7280;
}

.tx-description,
.tx_description_dark,
.tx_description_light {
  font-size: 13px;
  line-height: 1.4;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-family: Fustat, 'Inter', sans-serif;
}

.tx_description_dark {
  color: #999;
}

.tx_description_light {
  color: #6B7280;
}

.tx-description-italic {
  font-style: italic;
}

/* Tags */
.tx-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.tag-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.625rem;
  background: #78716c;
  color: white;
  border-radius: 12px;
  font-size: 0.7rem;
  font-weight: 500;
  font-family: Fustat, sans-serif;
}

/* Amount Section */
.tx-amounts {
  flex-shrink: 0;
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 90px;
}

.amount-sats,
.amount_sats_dark,
.amount_sats_light {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.4;
  font-family: Fustat, 'Inter', sans-serif;
}

.amount_sats_dark.positive,
.amount_sats_light.positive {
  color: #15DE72 !important;
}

.amount_sats_dark.negative {
  color: #FFFFFF;
}

.amount_sats_light.negative {
  color: #000000;
}

.amount-sats.positive {
  color: #15DE72 !important;
}

.amount-sats.positive::before {
  content: '+';
}

.amount-sats.negative::before {
  content: '-';
}

.amount-fiat,
.amount_fiat_dark,
.amount_fiat_light {
  font-size: 13px;
  line-height: 1.4;
  font-family: Fustat, 'Inter', sans-serif;
}

.amount_fiat_dark {
  color: #999;
}

.amount_fiat_light {
  color: #6B7280;
}

/* Micropayment Group Styles */
.micropayment-group,
.micropayment_group_dark,
.micropayment_group_light {
  cursor: pointer;
  transition: background-color 0.15s ease;
  font-family: Fustat, 'Inter', sans-serif;
}

.micropayment_group_dark {
  border-bottom: 1px solid #2A2A2A;
}

.micropayment_group_light {
  border-bottom: 1px solid #E5E7EB;
}

.group-header-micro {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  min-height: 72px;
  transition: background-color 0.15s ease;
}

.micropayment_group_dark .group-header-micro:hover {
  background: rgba(255, 255, 255, 0.05);
}

.micropayment_group_light .group-header-micro:hover {
  background: rgba(0, 0, 0, 0.02);
}

.group-icon-micro {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #8B5CF6, #6366F1);
  color: white;
  flex-shrink: 0;
}

.group-info-micro {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.group-primary,
.group_primary_dark,
.group_primary_light {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.4;
  font-family: Fustat, 'Inter', sans-serif;
}

.group_primary_dark {
  color: #FFFFFF;
}

.group_primary_light {
  color: #000000;
}

.group-secondary,
.group_secondary_dark,
.group_secondary_light {
  font-size: 13px;
  line-height: 1.4;
  font-family: Fustat, 'Inter', sans-serif;
  margin-top: 2px;
}

.group_secondary_dark {
  color: #999;
}

.group_secondary_light {
  color: #6B7280;
}

.group-amount-micro {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* Expanded Group Items */
.group-items-micro,
.group_items_micro_dark,
.group_items_micro_light {
  display: flex;
  flex-direction: column;
  font-family: Fustat, sans-serif;
}

.group_items_micro_dark {
  background: #0C0C0C;
  border-top: 1px solid #2A342A;
}

.group_items_micro_light {
  background: #FAFAFA;
  border-top: 1px solid #E5E7EB;
}

.group-item-micro,
.group_item_micro_dark,
.group_item_micro_light {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.group_item_micro_dark {
  border-bottom: 1px solid #2A342A;
}

.group_item_micro_light {
  border-bottom: 1px solid #E5E7EB;
}

.group_item_micro_dark:hover {
  background: #171717;
}

.group_item_micro_light:hover {
  background: #F5F5F5;
}

.item-time,
.item_time_dark,
.item_time_light {
  font-size: 0.85rem;
  font-family: Fustat, sans-serif;
}

.item_time_dark {
  color: #B0B0B0;
}

.item_time_light {
  color: #6B7280;
}

.item-amount,
.item_amount_dark,
.item_amount_light {
  font-size: 0.85rem;
  font-weight: 500;
  font-family: Fustat, sans-serif;
}

.item_amount_dark {
  color: #F6F6F6;
}

.item_amount_light {
  color: #212121;
}

.item-amount.positive {
  color: #15DE72 !important;
}

/* Loading and Empty States */
.loading_state_dark,
.empty_state_dark {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  padding: 2rem;
  background: #0C0C0C;
}

.loading_state_light,
.empty_state_light {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  padding: 2rem;
  background: white;
}

.loading_text_dark {
  margin-top: 1rem;
  color: #B0B0B0;
  font-size: 1rem;
  font-family: Fustat, sans-serif;
}

.loading_text_light {
  margin-top: 1rem;
  color: #6B7280;
  font-size: 1rem;
  font-family: Fustat, sans-serif;
}

.empty-icon {
  margin-bottom: 1rem;
}

.empty_title_dark {
  font-size: 1.25rem;
  font-weight: 600;
  color: #F6F6F6;
  margin-bottom: 0.5rem;
  font-family: Fustat, sans-serif;
}

.empty_title_light {
  font-size: 1.25rem;
  font-weight: 600;
  color: #212121;
  margin-bottom: 0.5rem;
  font-family: Fustat, sans-serif;
}

.empty_subtitle_dark {
  color: #B0B0B0;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
  font-family: Fustat, sans-serif;
}

.empty_subtitle_light {
  color: #6B7280;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
  font-family: Fustat, sans-serif;
}

/* Secondary Buttons */
.btn_dark {
  border-radius: 20px !important;
  border: 1px solid #2A382A !important;
  background: rgba(255, 255, 255, 0.05) !important;
  color: #FFF !important;
  font-family: Fustat, sans-serif !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}

.btn_light {
  border-radius: 20px !important;
  border: 1px solid #E8E8E8 !important;
  background: #F6F6F6 !important;
  color: #212121 !important;
  font-family: Fustat, sans-serif !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}

/* Floating Action Button */
.refresh_fab_dark {
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  box-shadow: 0 4px 12px rgba(21, 222, 114, 0.3) !important;
}

.refresh_fab_light {
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.3) !important;
}

.refresh_fab_dark:hover {
  background: linear-gradient(135deg, #059573, #047857) !important;
  box-shadow: 0 6px 16px rgba(21, 222, 114, 0.4) !important;
}

.refresh_fab_light:hover {
  background: linear-gradient(135deg, #059573, #047857) !important;
  box-shadow: 0 6px 16px rgba(5, 149, 115, 0.4) !important;
}

/* Responsive Design */
@media (max-width: 480px) {
  .transaction_description_dark,
  .transaction_description_light {
    max-width: 150px;
    font-size: 0.75rem;
  }

  .transaction-details {
    max-width: calc(100% - 140px);
  }

  .transaction-amount {
    min-width: 100px;
    flex-shrink: 0;
  }

  .stats_section_dark,
  .stats_section_light {
    padding: 0.75rem;
  }

  .stats_container_dark,
  .stats_container_light {
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
  }

  .stat_label_dark,
  .stat_label_light {
    font-size: 0.625rem;
    margin-bottom: 0.125rem;
  }

  .stat-value {
    font-size: 0.8125rem;
  }

  .transaction_item_dark,
  .transaction_item_light {
    padding: 0.75rem;
  }

  .transaction-main {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .group_header_dark,
  .group_header_light {
    padding: 0.75rem;
  }

  .tx-icon-container {
    width: 32px;
    height: 32px;
  }
}
</style>
