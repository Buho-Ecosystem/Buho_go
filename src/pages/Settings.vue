<template>
  <q-page class="settings-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <!-- Header -->
    <div class="settings-header" :class="$q.dark.isActive ? 'header-dark' : 'header-light'">
      <q-btn
        flat
        round
        dense
        @click="$router.back()"
        class="back-btn"
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
      <div class="header-content">
        <div class="logo-container">

      <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
        {{ $t('Settings') }}
      </div>
        </div>
      </div>
      <div class="header-spacer"></div>
    </div>

    <!-- Settings Content -->
    <div class="settings-content">
      <!-- Wallet Management -->
      <div class="settings-section">
        <div
          class="section-card"
          :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
          @click="showWalletsDialog = true"
        >
          <div class="card-icon wallet-icon">
            <q-icon name="las la-wallet" size="22px"/>
          </div>
          <div class="card-content">
            <div class="card-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
              {{ $t('Manage Wallets') }}
            </div>
            <div class="card-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ wallets.length }}
              {{ wallets.length === 1 ? $t('wallet') : $t('wallets') }} {{ $t('connected') }}
            </div>
          </div>
          <q-icon name="las la-chevron-right" size="18px" class="chevron-icon"
                  :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"/>
        </div>

        <!-- Address Book -->
        <div
          class="section-card"
          :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
          @click="$router.push('/address-book')"
        >
          <div class="card-icon address-book-icon">
            <q-icon name="las la-address-book" size="22px"/>
          </div>
          <div class="card-content">
            <div class="card-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
              {{ $t('Address Book') }}
            </div>
            <div class="card-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ $t('Save Lightning Addresses') }}
            </div>
          </div>
          <q-icon name="las la-chevron-right" size="18px" class="chevron-icon"
                  :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"/>
        </div>
      </div>

      <!-- Preferences -->
      <div class="settings-section">
        <div class="section-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
          {{ $t('Preferences') }}
        </div>

        <div
          class="section-card"
          :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
          @click="openCurrencyDialog"
        >
          <div class="card-icon currency-icon">
            <q-icon name="las la-dollar-sign" size="22px"/>
          </div>
          <div class="card-content">
            <div class="card-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
              {{ $t('Currency') }}
            </div>
            <div class="card-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ preferredFiatCurrency }}
            </div>
          </div>
          <q-icon name="las la-chevron-right" size="18px" class="chevron-icon"
                  :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"/>
        </div>

        <div
          class="section-card"
          :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
          @click="showLanguageDialog = true"
        >
          <div class="card-icon language-icon">
            <q-icon name="las la-language" size="22px"/>
          </div>
          <div class="card-content">
            <div class="card-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
              {{ $t('Language') }}
            </div>
            <div class="card-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ getCurrentLanguageLabel() }}
            </div>
          </div>
          <q-icon name="las la-chevron-right" size="18px" class="chevron-icon"
                  :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"/>
        </div>

        <div
          class="section-card"
          :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
          @click="showMempoolDialog = true"
        >
          <div class="card-icon mempool-icon">
            <q-icon name="las la-server" size="22px"/>
          </div>
          <div class="card-content">
            <div class="card-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
              {{ $t('Mempool API') }}
            </div>
            <div class="card-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ customMempoolUrl ? $t('Custom URL') : $t('Default (mempool.space)') }}
            </div>
          </div>
          <q-icon name="las la-chevron-right" size="18px" class="chevron-icon"
                  :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"/>
        </div>

        <div class="section-card disabled-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
          <div class="card-icon notifications-icon">
            <q-icon name="las la-bell" size="22px"/>
          </div>
          <div class="card-content">
            <div class="card-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
              {{ $t('Notifications') }}
            </div>
            <div class="card-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ $t('Live Information') }}
            </div>
          </div>
          <div class="coming-soon-badge">{{ $t('Coming Soon') }}</div>
        </div>

        <div class="section-card disabled-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
          <div class="card-icon security-icon-disabled">
            <q-icon name="las la-shield-alt" size="22px"/>
          </div>
          <div class="card-content">
            <div class="card-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
              {{ $t('Security') }}
            </div>
            <div class="card-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ $t('PIN Protection') }}
            </div>
          </div>
          <div class="coming-soon-badge">{{ $t('Coming Soon') }}</div>
        </div>

    <!-- Disconnect Button -->
    <div class="disconnect-section" :class="$q.dark.isActive ? 'footer-dark' : 'footer-light'">
      <div class="disconnect-container">
        <q-btn
          flat
          no-caps
          class="disconnect-btn"
          :class="$q.dark.isActive ? 'disconnect-btn-dark' : 'disconnect-btn-light'"
          @click="confirmDisconnect"
        >
          <q-icon name="las la-sign-out-alt" class="disconnect-icon"/>
          <span class="disconnect-text">{{ $t('Disconnect All Wallets') }}</span>
        </q-btn>
      </div>
    </div>

      </div>
    </div>

    <!-- Language Dialog -->
    <q-dialog v-model="showLanguageDialog" :class="$q.dark.isActive ? 'dailog_dark' : 'dailog_light'">
      <q-card class="dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Language Settings') }}
          </div>
          <q-btn
            flat
            round
            dense
            icon="las la-times"
            v-close-popup
            class="close-btn"
            :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
          />
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="language-list">
            <div
              v-for="language in localeOptions"
              :key="language.value"
              class="language-item"
              :class="{
                'active': $i18n.locale === language.value,
                'language-item-dark': $q.dark.isActive,
                'language-item-light': !$q.dark.isActive
              }"
              @click="setLanguage(language.value)"
            >
              <div class="language-info">
                <div class="language-name" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                  {{ language.label }}
                </div>
                <div class="language-code" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ language.value }}
                </div>
              </div>
              <q-icon
                name="las la-check"
                v-if="$i18n.locale === language.value"
                class="check-icon"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Currency Dialog -->
    <q-dialog v-model="showCurrencyDialog" :class="$q.dark.isActive ? 'dailog_dark' : 'dailog_light'">
      <q-card class="dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Currency Settings') }}
          </div>
          <q-btn
            flat
            round
            dense
            icon="las la-times"
            v-close-popup
            class="close-btn"
            :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
          />
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="currency-list">
            <div
              v-for="currency in ['USD', 'EUR', 'GBP', 'JPY', 'CHF']"
              :key="currency"
              class="currency-item"
              :class="{
                'active': preferredFiatCurrency === currency,
                'currency-item-dark': $q.dark.isActive,
                'currency-item-light': !$q.dark.isActive
              }"
              @click="setPreferredCurrency(currency)"
            >
              <div class="currency-info">
                <div class="currency-code" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                  {{ currency }}
                </div>
                <div class="currency-rate" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ getCurrencySymbol(currency) }}1 = {{ exchangeRates[currency.toLowerCase()] }} sats
                </div>
              </div>
              <q-icon
                name="las la-check"
                v-if="preferredFiatCurrency === currency"
                class="check-icon"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Enhanced Wallets Management Dialog -->
    <q-dialog v-model="showWalletsDialog" :class="$q.dark.isActive ? 'dailog_dark' : 'dailog_light'">
      <q-card class="dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Manage Wallets') }}
          </div>
          <q-btn
            flat
            round
            dense
            icon="las la-times"
            v-close-popup
            class="close-btn"
            :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
          />
        </q-card-section>

        <q-card-section class="dialog-content">
          <!-- Wallet Statistics -->
          <div class="wallet-stats" :class="$q.dark.isActive ? 'stats-dark' : 'stats-light'" v-if="wallets.length > 0">
            <div class="stat-item">
              <div class="stat-value" :class="$q.dark.isActive ? 'balance_dark' : 'balance_light'">
                {{ wallets.length }}
              </div>
              <div class="stat-label" :class="$q.dark.isActive ? 'sats' : 'sats-light'">
                {{ $t('Connected') }}
              </div>
            </div>
            <div class="stat-divider" :class="$q.dark.isActive ? 'divider-dark' : 'divider-light'"></div>
            <div class="stat-item">
              <div class="stat-value" :class="$q.dark.isActive ? 'balance_dark' : 'balance_light'">
                {{ formatBalance(totalBalance) }}
              </div>
              <div class="stat-label" :class="$q.dark.isActive ? 'sats' : 'sats-light'">
                {{ $t('Total Balance') }}
              </div>
            </div>
            <div class="stat-divider" :class="$q.dark.isActive ? 'divider-dark' : 'divider-light'"></div>
            <div class="stat-item">
              <div class="stat-value" :class="$q.dark.isActive ? 'balance_dark' : 'balance_light'">
                {{ connectedWallets.length }}
              </div>
              <div class="stat-label" :class="$q.dark.isActive ? 'sats' : 'sats-light'">
                {{ $t('Online') }}
              </div>
            </div>
          </div>

          <div class="wallets-list">
            <div v-if="wallets.length === 0" class="no-wallets">
              <q-icon name="las la-wallet" size="48px" class="no-wallets-icon"
                      :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-4'"/>
              <div class="no-wallets-text" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
                {{ $t('No wallets connected yet') }}
              </div>
            </div>

            <div
              v-for="wallet in sortedWallets"
              :key="wallet.id"
              class="wallet-item"
              :class="{
                'active-wallet': wallet.id === activeWalletId,
                'disconnected': !connectionStates[wallet.id]?.connected,
                'wallet-item-dark': $q.dark.isActive,
                'wallet-item-light': !$q.dark.isActive
              }"
            >
              <div class="wallet-icon-container">
                <div class="wallet-icon" :class="getWalletAvatarClass(wallet)">
                  <q-icon name="las la-wallet" size="24px"/>
                </div>
                <div
                  v-if="connectionStates[wallet.id]?.connected"
                  class="connection-status connected"
                ></div>
                <div
                  v-else
                  class="connection-status disconnected"
                ></div>
              </div>

              <div class="wallet-info">

                <q-input
                  v-model="wallet.name"
                  dense
                  out
                  borderless
                  input-class="q-px-md q-mb-sm"
                  :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
                />
                <div class="wallet-name-container">
                  <div class="wallet-badges">
                    <div v-if="wallet.isDefault" class="default-badge">{{ $t('Default') }}</div>
                    <div v-if="wallet.id === activeWalletId" class="active-badge">{{ $t('Active') }}</div>
                  </div>
                </div>
                <div class="wallet-balance" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ formatBalance(balances[wallet.id] || 0) }}
                </div>
                <div v-if="connectionStates[wallet.id]?.error" class="wallet-error">
                  {{ connectionStates[wallet.id].error }}
                </div>
              </div>

              <div class="wallet-actions">
                <q-btn
                  v-if="!connectionStates[wallet.id]?.connected"
                  flat
                  dense
                  color="#15DE72"
                  icon="las la-sync-alt"
                  @click="reconnectWallet(wallet.id)"
                  :loading="isReconnecting[wallet.id]"
                  class="action-btn reconnect-btn"
                >
                  <q-tooltip>{{ $t('Reconnect wallet') }}</q-tooltip>
                </q-btn>

                <q-btn
                  v-if="wallet.id !== activeWalletId"
                  flat
                  dense
                  color="#15DE72"
                  icon="las la-exchange-alt"
                  @click="handleSwitchWallet(wallet.id)"
                  class="action-btn switch-btn"
                >
                  <q-tooltip>{{ $t('Switch to this wallet') }}</q-tooltip>
                </q-btn>

                <q-btn
                  flat
                  dense
                  color="#EF4444"
                  icon="las la-trash-alt"
                  @click="confirmRemoveWallet(wallet.id)"
                  class="action-btn delete-btn"
                >
                  <q-tooltip>{{ $t('Remove wallet') }}</q-tooltip>
                </q-btn>
              </div>
            </div>
          </div>

          <q-btn
            class="connect-wallet-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            no-caps
            @click="showAddWalletDialog = true"
            unelevated
          >
            <q-icon name="las la-plus" class="q-mr-sm"/>
            {{ $t('Connect a Wallet') }}
          </q-btn>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Add Wallet Dialog -->
    <q-dialog v-model="showAddWalletDialog" :class="$q.dark.isActive ? 'dailog_dark' : 'dailog_light'">
      <q-card class="add-wallet-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Add New Wallet') }}
          </div>
          <q-btn
            flat
            round
            dense
            icon="las la-times"
            v-close-popup
            class="close-btn"
            :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
          />
        </q-card-section>

        <q-card-section class="dialog-content">

          <q-item dense style="padding: 0px">
            <q-item-section>
              <q-item-label>{{ $t('Wallet Name') }}</q-item-label>
              <q-item-label class="q-mt-sm">
                <q-input
                  v-model="newWalletName"
                  :placeholder="$t('Enter a name for your wallet')"
                  :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
                  :rules="[val => !!val || $t('Wallet name is required')]"
                  borderless
                  input-class="q-px-md"
                  hide-bottom-space
                  dense
                />
              </q-item-label>
            </q-item-section>
          </q-item>

          <q-item style="padding: 0px" class="q-mt-sm">
            <q-item-section>
              <q-item-label>{{ $t('NWC Connection String') }}</q-item-label>
              <q-item-label class="q-mt-sm">
                <q-input
                  v-model="newWalletNwc"
                  :placeholder="$t('nostr+walletconnect://...')"
                  :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
                  :rules="[validateNwcString]"
                  hide-bottom-space
                  input-class="q-px-md"
                  borderless
                  dense
                />
              </q-item-label>
            </q-item-section>
          </q-item>

          <div class="input-help">
            <q-icon name="las la-info-circle" class="help-icon"/>
            <span :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ $t('Get your NWC string from your Lightning wallet\'s settings') }}
            </span>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="dialog-actions">
          <q-btn
            flat
            :label="$t('Cancel')"
            v-close-popup
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          />
          <q-btn
            flat
            :label="$t('Add Wallet')"
            @click="addNewWallet"
            :loading="isAddingWallet"
            :disable="!isValidNewWallet"
            class="continue-action-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            no-caps
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Mempool API Dialog -->
    <q-dialog v-model="showMempoolDialog" :class="$q.dark.isActive ? 'dailog_dark' : 'dailog_light'">
      <q-card class="dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Mempool API Settings') }}
          </div>
          <q-btn
            flat
            round
            dense
            icon="las la-times"
            v-close-popup
            class="close-btn"
            :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
          />
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="mempool-info" :class="$q.dark.isActive ? 'info-dark' : 'info-light'">
            <q-icon name="las la-info-circle" class="info-icon"/>
            <div class="info-text" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ $t('Configure a custom Mempool API URL for enhanced privacy or to use your own instance.') }}
            </div>
          </div>

          <q-input
            v-model="tempMempoolUrl"
            :placeholder="$t('https://your-mempool-instance.com/api/v1')"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            borderless
            input-class="q-px-md"
            class="q-mb-sm"
            dense
            clearable
          />

          <div class="url-examples" :class="$q.dark.isActive ? 'examples-dark' : 'examples-light'">
            <div class="example-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
              {{ $t('Examples:') }}
            </div>
            <div class="example-item" @click="tempMempoolUrl = 'https://mempool.space/api/v1'">
              <span class="example-url">https://mempool.space/api/v1</span>
              <span class="example-desc">{{ $t('(Default)') }}</span>
            </div>
            <div class="example-item" @click="tempMempoolUrl = 'https://mempool.emzy.de/api/v1'">
              <span class="example-url">https://mempool.emzy.de/api/v1</span>
              <span class="example-desc">{{ $t('(Alternative)') }}</span>
            </div>
          </div>

          <div class="rate-status" v-if="fiatRateAge !== null"
               :class="$q.dark.isActive ? 'status-dark' : 'status-light'">
            <q-icon :name="fiatRatesStale ? 'las la-exclamation-triangle' : 'las la-check-circle'"
                    :class="fiatRatesStale ? 'text-orange' : 'text-green'"/>
            <span :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ $t('Last updated') }}: {{ fiatRateAge }} {{ $t('minutes ago') }}
            </span>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="dialog-actions">
          <q-btn
            flat
            :label="$t('Reset to Default')"
            @click="resetMempoolUrl"
            no-caps
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          />
          <q-btn
            flat
            :label="$t('Test & Save')"
            @click="saveMempoolUrl"
            :loading="isTestingUrl"
            :disable="!isMempoolUrlValid"
            class="continue-action-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            no-caps
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import {useWalletStore} from '../stores/wallet'
import {mapState, mapActions} from 'pinia'
import {fiatRatesService} from '../utils/fiatRates.js'

export default {
  name: 'SettingsPage',
  data() {
    return {
      showWalletsDialog: false,
      showAddWalletDialog: false,
      showCurrencyDialog: false,
      showLanguageDialog: false,
      showNotificationsDialog: false,
      showSecurityDialog: false,
      showMempoolDialog: false,

      // New wallet form
      newWalletName: '',
      newWalletNwc: '',
      isAddingWallet: false,
      isReconnecting: {},

      // Settings
      notificationsEnabled: true,
      hasNotificationPermission: false,
      pinEnabled: false,
      hasPin: false,
      currentPin: '',
      newPin: '',

      // Mempool API settings
      customMempoolUrl: null,
      tempMempoolUrl: '',
      isTestingUrl: false,
      fiatRateAge: null,
      fiatRatesStale: false,

      // Language options
      localeOptions: [
        { value: 'en-US', label: 'English' },
        { value: 'de', label: 'Deutsch' },
        { value: 'es', label: 'Español' }
      ],
    }
  },
  computed: {
    ...mapState(useWalletStore, [
      'wallets',
      'activeWalletId',
      'balances',
      'connectionStates',
      'sortedWallets',
      'totalBalance',
      'connectedWallets',
      'preferredFiatCurrency',
      'exchangeRates'
    ]),

    isValidNewWallet() {
      return this.newWalletName.trim() &&
        this.newWalletNwc.trim() &&
        this.validateNwcString(this.newWalletNwc) === true
    },

    isPinValid() {
      if (!this.hasPin) {
        return this.newPin.length >= 4;
      }
      return this.currentPin.length >= 4 && this.newPin.length >= 4;
    },

    isMempoolUrlValid() {
      if (!this.tempMempoolUrl.trim()) return true; // Empty is valid (will use default)
      try {
        const url = new URL(this.tempMempoolUrl);
        return url.protocol === 'https:' || url.protocol === 'http:';
      } catch {
        return false;
      }
    }
  },
  created() {
    this.initializeStore();
    this.loadPinState();
    this.checkNotificationPermission();
    this.loadMempoolSettings();
    this.updateFiatRateStatus();
    this.loadLanguagePreference();
  },

  mounted() {
    // Update fiat rate status every minute
    this.fiatRateInterval = setInterval(() => {
      this.updateFiatRateStatus();
    }, 60000);

    // Refresh exchange rates every 5 minutes
    this.exchangeRateInterval = setInterval(() => {
      this.loadExchangeRates();
    }, 300000); // 5 minutes
  },

  beforeUnmount() {
    if (this.fiatRateInterval) {
      clearInterval(this.fiatRateInterval);
    }
    if (this.exchangeRateInterval) {
      clearInterval(this.exchangeRateInterval);
    }
  },
  methods: {
    ...mapActions(useWalletStore, [
      'initialize',
      'addWallet',
      'removeWallet',
      'updateWalletName',
      'setDefaultWallet',
      'switchActiveWallet',
      'connectWallet',
      'disconnectAll',
      'updateCurrencyPreferences',
      'loadExchangeRates'
    ]),

    async initializeStore() {
      await this.initialize()
    },

    async openCurrencyDialog() {
      // Refresh exchange rates before showing dialog
      await this.loadExchangeRates()
      this.showCurrencyDialog = true
    },

    setPreferredCurrency(currency) {
      this.updateCurrencyPreferences(currency, this.denominationCurrency)
      this.showCurrencyDialog = false
    },

    getCurrencySymbol(currency) {
      const symbols = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        JPY: '¥',
        CHF: 'CHF'
      }
      return symbols[currency] || currency
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
    },

    getWalletAvatarClass(wallet) {
      const colors = ['wallet-green', 'wallet-blue', 'wallet-purple', 'wallet-orange', 'wallet-red']
      const index = wallet.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length
      return colors[index]
    },

    validateNwcString(nwcString) {
      if (!nwcString || !nwcString.trim()) {
        return this.$t('NWC string is required')
      }

      if (!nwcString.startsWith('nostr+walletconnect://')) {
        return this.$t('Invalid NWC format. Must start with nostr+walletconnect://')
      }

      return true
    },

    async addNewWallet() {
      if (!this.isValidNewWallet) return

      this.isAddingWallet = true
      try {
        await this.addWallet({
          name: this.newWalletName.trim(),
          nwcUrl: this.newWalletNwc.trim()
        })

        this.showAddWalletDialog = false
        this.newWalletName = ''
        this.newWalletNwc = ''

        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet connected'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Connection failed'),
          caption: error.message,
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } finally {
        this.isAddingWallet = false
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
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Reconnection failed'),
          caption: error.message,
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } finally {
        this.isReconnecting[walletId] = false
      }
    },

    async handleSwitchWallet(walletId) {
      try {
        await this.switchActiveWallet(walletId)
        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet switched'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t switch wallet'),
          caption: error.message,
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      }
    },

    async confirmDisconnect() {
      this.$q.dialog({
        title: this.$t('Disconnect Wallets'),
        message: this.$t('Are you sure you want to disconnect all wallets?'),
        cancel: true,
        persistent: true
      }).onOk(async () => {
        try {
          await this.disconnectAll()

          this.$q.notify({
            type: 'positive',
            message: this.$t('All wallets disconnected'),
            position: 'bottom',
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });

          this.$router.push('/');
        } catch (error) {
          console.error('Error disconnecting wallets:', error);
          this.$q.notify({
            type: 'negative',
            message: this.$t('Couldn\'t disconnect wallets'),
            position: 'bottom',
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
        }
      });
    },

    async confirmRemoveWallet(walletId) {
      const wallet = this.wallets.find(w => w.id === walletId)
      if (!wallet) return

      this.$q.dialog({
        title: this.$t('Remove Wallet'),
        message: this.$t('Are you sure you want to remove "{name}"?', {name: wallet.name}),
        cancel: true,
        persistent: true
      }).onOk(async () => {
        try {
          await this.removeWallet(walletId)

          this.$q.notify({
            type: 'positive',
            message: this.$t('Wallet removed'),
            position: 'bottom',
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          })
        } catch (error) {
          this.$q.notify({
            type: 'negative',
            message: this.$t('Couldn\'t remove wallet'),
            caption: error.message,
            position: 'bottom',
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          })
        }
      })
    },

    loadPinState() {
      const pinState = localStorage.getItem('buhoGO_pin_state');
      if (pinState) {
        const {enabled, pin} = JSON.parse(pinState);
        this.pinEnabled = enabled;
        this.hasPin = !!pin;
      }
    },

    handlePinToggle(enabled) {
      if (enabled && !this.hasPin) {
        this.newPin = '';
      } else if (!enabled) {
        this.$q.dialog({
          title: this.$t('Disable PIN Protection'),
          message: this.$t('Are you sure you want to disable PIN protection?'),
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
          message: this.$t('PIN saved'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } else {
        const pinState = JSON.parse(localStorage.getItem('buhoGO_pin_state'));
        if (pinState.pin !== this.currentPin) {
          this.$q.notify({
            type: 'negative',
            message: this.$t('Wrong PIN'),
            position: 'bottom',
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
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
          message: this.$t('PIN updated'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
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
          message: this.$t('Notifications not available'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      }
    },

    handleNotificationsToggle(enabled) {
      if (enabled && !this.hasNotificationPermission) {
        this.requestNotificationPermission();
      } else if (!enabled) {
        this.$q.dialog({
          title: this.$t('Disable Notifications'),
          message: this.$t('Are you sure you want to disable notifications?'),
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
    },

    loadMempoolSettings() {
      this.customMempoolUrl = fiatRatesService.customApiUrl;
      this.tempMempoolUrl = this.customMempoolUrl || '';
    },

    resetMempoolUrl() {
      this.tempMempoolUrl = '';
    },

    async saveMempoolUrl() {
      this.isTestingUrl = true;

      try {
        const urlToTest = this.tempMempoolUrl.trim() || null;

        if (urlToTest) {
          // Test the URL by making a request
          const testUrl = urlToTest.endsWith('/') ? urlToTest + 'prices' : urlToTest + '/prices';
          const response = await fetch(testUrl);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();
          if (!data || !data.USD) {
            throw new Error('Invalid response format');
          }
        }

        // Save the URL
        fiatRatesService.setCustomApiUrl(urlToTest);
        this.customMempoolUrl = urlToTest;

        // Force refresh rates
        await fiatRatesService.fetchLatestRates();
        this.updateFiatRateStatus();

        this.showMempoolDialog = false;

        this.$q.notify({
          type: 'positive',
          message: urlToTest ?
            this.$t('API settings saved') :
            this.$t('Using default API'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });

      } catch (error) {
        console.error('Error testing Mempool URL:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('API connection failed'),
          caption: error.message,
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } finally {
        this.isTestingUrl = false;
      }
    },

    updateFiatRateStatus() {
      this.fiatRateAge = fiatRatesService.getRateAge();
      this.fiatRatesStale = fiatRatesService.areRatesStale();
    },

    getCurrentLanguageLabel() {
      const currentLang = this.localeOptions.find(lang => lang.value === this.$i18n.locale)
      return currentLang ? currentLang.label : 'English'
    },

    setLanguage(languageCode) {
      this.$i18n.locale = languageCode
      // Save to localStorage for persistence
      localStorage.setItem('buhoGO_language', languageCode)
      this.showLanguageDialog = false

      this.$q.notify({
        type: 'positive',
        message: this.$t('Language updated'),
        position: 'bottom',
        actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
      })
    },

    loadLanguagePreference() {
      const savedLanguage = localStorage.getItem('buhoGO_language')
      if (savedLanguage && this.localeOptions.find(lang => lang.value === savedLanguage)) {
        this.$i18n.locale = savedLanguage
      }
    }
  }
}
</script>

<style scoped>
.settings-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: Fustat, 'Inter', sans-serif;
}

.bg-dark {
  background: #0C0C0C;
  color: #FFF;
}

.bg-light {
  background: #F8F8F8;
  color: #212121;
}

/* Header */
.settings-header {
  padding: 1rem;
  border-bottom: 1px solid;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-dark {
  border-bottom-color: #2A342A;
}

.header-light {
  border-bottom-color: #E5E7EB;
}

.back-btn {
  transition: all 0.2s ease;
  width: 40px;
  height: 40px;
}

.back-btn-dark {
  color: #FFF;
}

.back-btn-light {
  color: #212121;
}

.back-btn-dark:hover {
  background: #2A342A;
}

.back-btn-light:hover {
  background: #F3F4F6;
}

.header-content {
  flex: 1;
  display: flex;
  justify-content: center;
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.logo {
  filter: drop-shadow(0 2px 4px rgba(21, 222, 114, 0.3));
}

.app-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 20px;
  font-weight: 800;
  line-height: 100%;
  background: linear-gradient(90deg, #059573 0%, #15DE72 50%, #78D53C 100%);
  background-size: 200% 200%;
  animation: gradientShift 3s ease-in-out infinite;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

@keyframes gradientShift {
  0%, 100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

.header-spacer {
  width: 40px;
}

/* Content */
.settings-content {
  flex: 1;
  padding: 0.875rem;
}

.settings-section {
  margin-bottom: 1.25rem;
}

.section-title {
  font-family: Fustat, 'Inter', sans-serif;
  margin-bottom: 0.625rem;
  padding-left: 0.375rem;
  font-size: 14px;
  font-weight: 600;
}

.section-card {
  border-radius: 18px;
  padding: 0.75rem 0.875rem;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.section-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  border-color: #15DE72;
}

.section-card:active {
  transform: translateY(0);
}

.card-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.wallet-icon {
  background: linear-gradient(135deg, #059573, #15DE72);
  color: white;
}

.currency-icon {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: white;
}

.language-icon {
  background: linear-gradient(135deg, #10B981, #059669);
  color: white;
}

.address-book-icon {
  background: linear-gradient(135deg, #8B5CF6, #7C3AED);
  color: white;
}

.mempool-icon {
  background: linear-gradient(135deg, #8B5CF6, #7C3AED);
  color: white;
}

.notifications-icon {
  background: linear-gradient(135deg, #9CA3AF, #6B7280);
  color: white;
}

.security-icon-disabled,
.address-book-icon-disabled {
  background: linear-gradient(135deg, #9CA3AF, #6B7280);
  color: white;
}

.card-content {
  flex: 1;
}

.card-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 0.125rem;
}

.card-subtitle {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 11px;
  opacity: 0.8;
}

.chevron-icon {
  font-size: 16px;
}

.chevron-icon {
  font-size: 16px;
}

/* Coming Soon Badge */
.coming-soon-badge {
  background: linear-gradient(135deg, #F59E0B, #D97706);
  color: white;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 600;
  padding: 0.25rem 0.625rem;
  border-radius: 10px;
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
  border-color: transparent;
}

/* Disconnect Section */
.disconnect-section {
  padding: 0.75rem 0.875rem 0.875rem;
  margin-top: 0.5rem;
}

.footer-dark {
  border-top-color: #2A342A;
}

.footer-light {
  border-top-color: #E5E7EB;
}

.disconnect-container {
  max-width: 400px;
  margin: 0 auto;
}

.disconnect-btn {
  width: 100%;
  height: 44px;
  border-radius: 18px;
  font-family: Fustat, 'Inter', sans-serif;
  font-weight: 500;
  font-size: 14px;
  border: 1px solid;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.disconnect-btn-dark {
  background: #2A1A1A;
  color: #EF4444;
  border-color: #4A2A2A;
}

.disconnect-btn-light {
  background: #FEF2F2;
  color: #DC2626;
  border-color: #FECACA;
}

.disconnect-btn-dark:hover {
  background: #3A2A2A;
  border-color: #EF4444;
  transform: translateY(-1px);
}

.disconnect-btn-light:hover {
  background: #FEE2E2;
  border-color: #FCA5A5;
  transform: translateY(-1px);
}

.disconnect-icon {
  font-size: 18px;
}

.disconnect-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Dialog Styles */
.dialog-card {
  width: 100%;
  max-width: 480px;
  border-radius: 24px;
  overflow: hidden;
}

.dialog-header {
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid;
}

.dialog-header {
  border-bottom-color: #2A342A;
}

.close-btn {
  width: 32px;
  height: 32px;
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
  border-radius: 16px;
  border: 2px solid;
  cursor: pointer;
  transition: all 0.2s ease;
}

.currency-item-dark {
  border-color: #2A342A;
}

.currency-item-light {
  border-color: #F3F4F6;
}

.currency-item-dark:hover {
  border-color: #15DE72;
  background: rgba(21, 222, 114, 0.05);
}

.currency-item-light:hover {
  border-color: #15DE72;
  background: rgba(21, 222, 114, 0.05);
}

.currency-item.active {
  border-color: #15DE72;
  border-width: 1px;
  background: rgba(21, 222, 114, 0.1);
}

.currency-info {
  flex: 1;
}

.currency-code {
  font-family: Fustat, 'Inter', sans-serif;
  margin-bottom: 0.25rem;
}

.currency-rate {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
}

.check-icon {
  color: #15DE72;
  font-size: 20px;
}

/* Language Dialog */
.language-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.language-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-radius: 16px;
  border: 2px solid;
  cursor: pointer;
  transition: all 0.2s ease;
}

.language-item-dark {
  border-color: #2A342A;
}

.language-item-light {
  border-color: #F3F4F6;
}

.language-item-dark:hover {
  border-color: #15DE72;
  background: rgba(21, 222, 114, 0.05);
}

.language-item-light:hover {
  border-color: #15DE72;
  background: rgba(21, 222, 114, 0.05);
}

.language-item.active {
  border-color: #15DE72;
  border-width: 1px;
  background: rgba(21, 222, 114, 0.1);
}

.language-info {
  flex: 1;
}

.language-name {
  font-family: Fustat, 'Inter', sans-serif;
  margin-bottom: 0.25rem;
}

.language-code {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
}

/* Wallet Statistics */
.wallet-stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 16px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.stats-dark {
  background: #171717;
  border: 1px solid #2A342A;
}

.stats-light {
  background: #F8F9FA;
  border: 1px solid #E5E7EB;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.stat-value {
  font-family: Fustat, 'Inter', sans-serif;
  margin-bottom: 0.25rem;
}

.stat-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 500;
  text-transform: capitalize;
  letter-spacing: 0.025em;
}

.stat-divider {
  width: 1px;
  height: 32px;
}

.divider-dark {
  background: #2A342A;
}

.divider-light {
  background: #E5E7EB;
}

/* Wallets List */
.wallets-list {
  margin-bottom: 1.5rem;
}

.no-wallets {
  text-align: center;
  padding: 2rem;
}

.no-wallets-icon {
  margin-bottom: 1rem;
  opacity: 0.5;
}

.no-wallets-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.wallet-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border-radius: 16px;
  margin-bottom: 0.75rem;
  border: 2px solid;
  transition: all 0.2s ease;
}

.wallet-item-dark {
  border-color: #2A342A;
}

.wallet-item-light {
  border-color: #E5E7EB;
}

.wallet-item.active-wallet {
  border-color: #15DE72;
  border-width: 1px;
  background: rgba(21, 222, 114, 0.05);
}

.wallet-item.disconnected {
  opacity: 0.7;
}

.wallet-icon-container {
  position: relative;
  margin-right: 1rem;
}

.wallet-icon {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.wallet-green {
  background: linear-gradient(135deg, #059573, #15DE72);
}

.wallet-blue {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
}

.wallet-purple {
  background: linear-gradient(135deg, #8B5CF6, #7C3AED);
}

.wallet-orange {
  background: linear-gradient(135deg, #F59E0B, #D97706);
}

.wallet-red {
  background: linear-gradient(135deg, #EF4444, #DC2626);
}

.connection-status {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid white;
}

.connection-status.connected {
  background: #15DE72;
}

.connection-status.disconnected {
  background: #EF4444;
}

.wallet-info {
  flex: 1;
}

.wallet-name-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.wallet-name-input :deep(.q-field__control) {
  min-height: 0;
  padding: 0;
}

.wallet-name-input :deep(.q-field__native) {
  padding: 0;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
}

.wallet-badges {
  display: flex;
  gap: 0.25rem;
}

.default-badge,
.active-badge {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 8px;
  font-weight: 600;
  padding: 0.125rem 0.375rem;
  border-radius: 6px;
  text-transform: capitalize;
  letter-spacing: 0.025em;
}

.default-badge {
  background: #FEF3C7;
  color: #92400E;
}

.active-badge {
  background: #D1FAE5;
  color: #065F46;
}

.wallet-balance {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  margin-top: 0.25rem;
}

.wallet-error {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 10px;
  color: #EF4444;
  font-weight: 500;
  margin-top: 0.25rem;
}

.wallet-actions {
  display: flex;
  gap: 0.25rem;
}

.action-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
}

.connect-wallet-btn {
  width: 100%;
  height: 48px;
  border-radius: 24px;
  font-family: Fustat, 'Inter', sans-serif;
  font-weight: 400;
  font-size: 14px;
  transition: all 0.2s ease;
}

/* Add Wallet Dialog */
.add-wallet-card {
  width: 100%;
  max-width: 400px;
  border-radius: 24px;
}

.wallet-name-input,
.nwc-input {
  margin-bottom: 1rem;
}

.wallet-name-input :deep(.q-field__control),
.nwc-input :deep(.q-field__control) {
  border-radius: 20px;
  padding: 0.75rem 1rem;
  font-family: Fustat, 'Inter', sans-serif;
}

.input-help {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  margin-top: 0.5rem;
}

.help-icon {
  color: #15DE72;
  font-size: 16px;
}

.dialog-actions {
  padding: 1rem 1.5rem 1.5rem;
  gap: 0.75rem;
}

.continue-action-btn {
  height: 40px;
  border-radius: 24px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 400;
  padding: 0 1.5rem;
}

/* Responsive Design */
@media (max-width: 480px) {
  .settings-content {
    padding: 0.75rem;
  }

  .section-card {
    padding: 0.625rem 0.75rem;
  }

  .card-icon {
    width: 36px;
    height: 36px;
  }

  .dialog-header,
  .dialog-content {
    padding: 1rem;
  }

  .currency-item,
  .wallet-item {
    padding: 0.75rem;
  }

  .app-title {
    font-size: 18px;
  }

  .wallet-icon {
    width: 40px;
    height: 40px;
  }

  .dialog-actions {
    padding: 1rem 1.25rem 1.25rem;
  }
}

/* Mempool Dialog Styles */
.mempool-info {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 12px;
  margin-bottom: 1.5rem;
}

.info-dark {
  background: #1A1A2E;
  border: 1px solid #2A342A;
}

.info-light {
  background: #F0F9FF;
  border: 1px solid #BAE6FD;
}

.info-icon {
  color: #3B82F6;
  font-size: 20px;
  margin-top: 0.125rem;
  flex-shrink: 0;
}

.info-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  line-height: 1.4;
}

.mempool-input {
  margin-bottom: 1.5rem;
}

.mempool-input :deep(.q-field__control) {
  border-radius: 20px;
  padding: 0.75rem 1rem;
  font-family: Fustat, 'Inter', sans-serif;
}

.url-examples {
  margin-bottom: 1.5rem;
}

.examples-dark {
  background: #171717;
  border: 1px solid #2A342A;
}

.examples-light {
  background: #F8F9FA;
  border: 1px solid #E5E7EB;
}

.url-examples {
  border-radius: 12px;
  padding: 1rem;
}

.example-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 0.75rem;
}

.example-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 0.5rem;
}

.example-item:last-child {
  margin-bottom: 0;
}

.example-item:hover {
  background: rgba(21, 222, 114, 0.1);
}

.example-url {
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 11px;
  color: #15DE72;
}

.example-desc {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 10px;
  opacity: 0.7;
}

.rate-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 8px;
}

.status-dark {
  background: #1A1A1A;
}

.status-light {
  background: #F3F4F6;
}

.rate-status span {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
}
</style>