<template>
  <q-page :class="$q.dark.isActive ? 'wallet-page-dark' : 'wallet-page-light'">
    <!-- Header -->
    <q-toolbar>

      <q-avatar square size="30px">
        <img src="buho_logo.svg" alt="Logo" class="app-logo">
      </q-avatar>

      <!-- Pending Bitcoin Deposits Chip (in header) -->
      <transition name="btc-banner-fade">
        <q-chip
          v-if="isSparkWallet && pendingBitcoinDeposits.length > 0"
          clickable
          dense
          :ripple="false"
          class="btc-chip"
          :class="$q.dark.isActive ? 'btc-chip-dark' : 'btc-chip-light'"
          @click="openReceiveModalBitcoin"
        >
          <Icon icon="tabler:currency-bitcoin" width="20" height="20" class="q-mr-xs" />
          {{ pendingBitcoinDeposits.some(d => d.confirmed) ? $t('Ready to claim') : $t('Incoming') }}
        </q-chip>
      </transition>

      <q-space/>
      <q-btn
        flat
        round
        dense
        class="float-right q-mr-sm"
        :class="$q.dark.isActive ? 'modern-menu-btn-dark' : 'modern-menu-btn-light'"
        @click="$router.push('/settings')"
        aria-label="Settings"
      >
        <Icon icon="tabler:settings" width="18" height="18" />
      </q-btn>
      <q-btn
        flat
        round
        class="float-right"
        :class="$q.dark.isActive ? 'dark-mode-btn-dark' : 'dark-mode-btn-light'"
        @click="showAddressBookQuick = true"
        padding="sm sm"
        style="border-radius: 12px"
        aria-label="Address Book"
      >
        <Icon icon="tabler:address-book" width="18" height="18" />
      </q-btn>
    </q-toolbar>

    <!-- Backup Reminder Banner -->
    <BackupBanner
      :visible="walletStore.shouldPromptBackup && walletStore.isActiveWalletSpark"
      @backup="goToBackup"
      @dismiss="walletStore.dismissBackupPrompt()"
    />

    <!-- Skeleton Loading State -->
    <div v-if="showLoadingScreen" class="main-content">
      <!-- Wallet Chip skeleton -->
      <q-skeleton type="QChip" width="90px" height="28px" animation="wave" style="margin-bottom: 1rem; border-radius: 20px;" />

      <!-- Balance Section skeleton -->
      <div class="balance-section">
        <div class="balance-container" style="padding: 1rem;">
          <div class="balance-amount" style="margin-bottom: 1rem; display: flex; justify-content: center;">
            <q-skeleton type="text" width="220px" height="40px" animation="wave" style="border-radius: 8px;" />
          </div>
          <div style="display: flex; justify-content: center;">
            <q-skeleton type="text" width="100px" height="16px" animation="wave" style="border-radius: 6px;" />
          </div>
        </div>
      </div>

      <!-- Transaction History Button skeleton -->
      <div class="transaction-icon-section">
        <q-skeleton type="circle" size="48px" animation="wave" />
      </div>
    </div>

    <!-- Main Content -->
    <div v-else class="main-content">
      <!-- Spark Tab Bar: [Business | Personal | Wallet icon] -->
      <div v-if="showSparkTabs" class="spark-tabs-wrap">
        <div class="spark-tabs" :class="$q.dark.isActive ? 'spark-tabs-dark' : 'spark-tabs-light'">
          <div class="spark-tabs-slider" :class="{ 'spark-tabs-slider--right': isPersonalActive }"></div>
          <button
            class="spark-tab"
            :class="{ 'spark-tab--active': !isPersonalActive }"
            :disabled="sparkTabSwitching"
            @click="switchSparkTab(sparkWalletPair[0]?.id)"
          >
            <Icon icon="tabler:building-store" width="14" height="14" />
            <span>{{ sparkWalletPair[0]?.name }}</span>
          </button>
          <div class="spark-tab-divider"></div>
          <button class="spark-tab spark-tab-center" @click="openWalletManagement">
            <Icon icon="tabler:wallet" width="16" height="16" />
          </button>
          <div class="spark-tab-divider"></div>
          <button
            class="spark-tab"
            :class="{ 'spark-tab--active': isPersonalActive }"
            :disabled="sparkTabSwitching"
            @click="switchSparkTab(sparkWalletPair[1]?.id)"
          >
            <Icon icon="tabler:user" width="14" height="14" />
            <span>{{ sparkWalletPair[1]?.name }}</span>
          </button>
        </div>
      </div>

      <!-- Non-Spark: Original chip -->
      <q-chip
        v-else-if="activeWallet"
        clickable
        outline
        :ripple="false"
        class="wallet-chip"
        :class="$q.dark.isActive ? 'wallet-chip-dark' : 'wallet-chip-light'"
        @click="openWalletManagement"
      >
        <!-- NWC Logo -->
        <svg v-if="activeWallet.type === 'nwc'" width="12" height="12" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg" class="wallet-chip-icon">
          <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="currentColor"/>
          <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="currentColor"/>
        </svg>
        <!-- LNBits Logo -->
        <svg v-else-if="activeWallet.type === 'lnbits'" width="10" height="12" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg" class="wallet-chip-icon">
          <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="currentColor"/>
        </svg>
        <!-- Default wallet icon -->
        <Icon v-else icon="tabler:wallet" width="12" height="12" class="wallet-chip-icon" />
        {{ walletDisplayName }}
        <Icon v-if="isAutoTransferActive" icon="tabler:send" width="10" height="10" class="aw-indicator-icon" />
      </q-chip>

      <!-- Balance Display -->
      <div class="balance-section">
        <div class="balance-container" @click="toggleCurrency" :class="{ 'switching': isSwitchingCurrency }">
          <div class="balance-amount">
            <div class="amount-display">
              <NumberFlow
                :value="balanceNumericValue"
                :format="balanceNumberFormat"
                :prefix="balancePrefix"
                :suffix="balanceSuffix"
                class="amount-number"
                :class="$q.dark.isActive ? 'amount-number-dark' : 'amount-number-light'"
                :spin-timing="{ duration: 750, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }"
                :transform-timing="{ duration: 750, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }"
              />
            </div>
          </div>
          <transition name="secondary-fade" mode="out-in">
            <div :key="currentDisplayMode" class="balance-secondary"
                 :class="$q.dark.isActive ? 'balance-secondary-dark' : 'balance-secondary-light'">
              <span v-if="secondaryValue" class="secondary-amount-display">
                <span class="secondary-value">{{ secondaryValue }}</span>
              </span>
              <span v-else class="loading-secondary">&nbsp;</span>
            </div>
          </transition>
        </div>
      </div>

      <!-- Transaction History Icon -->
      <div class="transaction-icon-section">
        <q-btn
          flat
          round
          size="md"
          @click="$router.push('/transactions')"
          :class="[$q.dark.isActive ? 'transaction-history-btn-dark' : 'transaction-history-btn-light', { 'pulse': shouldPulse }]"
          aria-label="Transaction History"
        >
          <Icon icon="tabler:history" width="20" height="20" />
        </q-btn>
      </div>
    </div>

    <!-- Bottom Action Buttons -->
    <div class="bottom-actions">
      <div class="action-buttons">
        <q-btn
          :class="$q.dark.isActive ? 'action-btn receive-btn-dark' : 'action-btn receive-btn-light'"
          @click="showReceiveModal = true"
          no-caps
          unelevated
          aria-label="Receive payment"
        >
          <Icon icon="tabler:arrow-down" width="24" height="24" />
          <div class="btn-text">{{ $t('Receive') }}</div>
        </q-btn>
        <q-btn
          :class="$q.dark.isActive ? 'action-btn send-btn-dark' : 'action-btn send-btn-light'"
          @click="showSendModal = true"
          no-caps
          unelevated
          aria-label="Send payment"
        >
          <Icon icon="tabler:arrow-up" width="24" height="24" />
          <div class="btn-text">{{ $t('Send') }}</div>
        </q-btn>
      </div>
    </div>

    <!-- Receive Modal -->
    <ReceiveModal
      ref="receiveModal"
      v-model="showReceiveModal"
      @bitcoin-deposits-updated="handleBitcoinDepositsUpdated"
      @scan-withdraw="handleScanWithdraw"
    />

    <!-- Send Modal -->
    <SendModal
      v-model="showSendModal"
      @payment-detected="onPaymentDetected"
    />

    <!-- One-time PIN Migration Dialog (for existing users updating from PIN to device key) -->
    <q-dialog v-model="showMigrationDialog" persistent :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'" style="max-width: 400px;">
        <q-card-section>
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Security Upgrade') }}
          </div>
        </q-card-section>
        <q-card-section>
          <p :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'" style="font-size: 14px; margin-bottom: 16px;">
            {{ $t('We\'ve replaced the in-app PIN with biometric security. Enter your PIN one last time to complete the upgrade.') }}
          </p>
          <q-input
            v-model="migrationPin"
            type="password"
            :placeholder="$t('Your 6-digit PIN')"
            maxlength="6"
            mask="######"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            borderless
            input-class="q-px-md text-center"
            dense
            autofocus
            :error="!!migrationError"
            :error-message="migrationError"
            @keyup.enter="handleMigration"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            flat
            no-caps
            :label="$t('Unlock')"
            :loading="isMigrating"
            :disable="!migrationPin || migrationPin.length < 6"
            @click="handleMigration"
            class="dialog_add_btn_dark"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Wallet Switcher Dialog -->
    <q-dialog v-model="showWalletSwitcher" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="wallet-switcher-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="switcher-header">
          <div class="switcher-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Switch Wallet') }}
          </div>
          <q-btn flat round dense v-close-popup
                 :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
        </q-card-section>

        <q-card-section class="switcher-content">
          <div class="wallet-switch-list">
            <template
              v-for="wallet in storeWallets"
              :key="wallet.id"
            >
            <div
              class="wallet-switch-card"
              :class="{
                'wallet-switch-card-active': wallet.id === storeActiveWalletId,
                'wallet-switch-card-dark': $q.dark.isActive,
                'wallet-switch-card-light': !$q.dark.isActive
              }"
              @click="switchToWallet(wallet.id)"
            >
              <!-- Avatar -->
              <div class="switch-avatar">
                <div class="switch-avatar-circle switch-avatar-black">
                  <!-- Spark Logo -->
                  <svg v-if="wallet.type === 'spark'" width="20" height="19" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="white"/>
                  </svg>
                  <!-- NWC Logo -->
                  <svg v-else-if="wallet.type === 'nwc'" width="20" height="20" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="url(#nwc_switch_grad)"/>
                    <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="#897FFF"/>
                    <defs>
                      <linearGradient id="nwc_switch_grad" x1="123.989" y1="10.4384" x2="123.989" y2="249.939" gradientUnits="userSpaceOnUse">
                        <stop stop-color="#FFCA4A"/>
                        <stop offset="1" stop-color="#F7931A"/>
                      </linearGradient>
                    </defs>
                  </svg>
                  <!-- LNBits Logo -->
                  <svg v-else-if="wallet.type === 'lnbits'" width="18" height="20" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
                  </svg>
                  <!-- Default wallet icon -->
                  <Icon v-else icon="tabler:wallet" width="20" height="20" />
                </div>
                <div
                  class="switch-status-dot"
                  :class="storeConnectionStates[wallet.id]?.connected ? 'status-connected' : 'status-disconnected'"
                ></div>
              </div>

              <!-- Details -->
              <div class="switch-details">
                <div class="switch-name" :class="$q.dark.isActive ? 'switch-name-dark' : 'switch-name-light'">
                  {{ wallet.name }}
                </div>
                <div class="switch-meta-row">
                  <div class="switch-type-badge" :class="getWalletTypeBadgeClass(wallet.type)">
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
                    <Icon v-else icon="tabler:wallet" width="9" height="9" />
                    <span>{{ getWalletTypeLabel(wallet.type) }}</span>
                  </div>
                  <div v-if="wallet.id === storeActiveWalletId" class="switch-tag tag-active">{{ $t('Active') }}</div>
                </div>
                <div class="switch-balance" :class="$q.dark.isActive ? 'switch-balance-dark' : 'switch-balance-light'">
                  <q-skeleton v-if="refreshingWalletIds[wallet.id]" type="text" width="80px" height="14px" />
                  <template v-else>{{ formatBalance(storeBalances[wallet.id] || 0) }}</template>
                </div>
              </div>

              <!-- Check Icon -->
              <Icon
                v-if="wallet.id === storeActiveWalletId"
                icon="tabler:circle-check"
                width="20"
                height="20"
                class="switch-check-icon"
              />
            </div>

            </template>
          </div>
        </q-card-section>

        <q-card-section class="switcher-footer" :class="$q.dark.isActive ? 'switcher-footer-dark' : 'switcher-footer-light'">
          <!-- Transfer Funds Button (only show if 2+ wallets) -->
          <q-btn
            v-if="storeWallets.length >= 2"
            flat
            no-caps
            class="transfer-funds-btn"
            :class="$q.dark.isActive ? 'transfer-btn-dark' : 'transfer-btn-light'"
            @click="openTransferModal"
          >
            <Icon icon="tabler:arrows-exchange" width="20" height="20" class="q-mr-sm" />
            {{ $t('Transfer Funds') }}
          </q-btn>
          <q-btn
            flat
            no-caps
            class="manage-wallets-btn"
            :class="$q.dark.isActive ? 'manage-btn-dark' : 'manage-btn-light'"
            @click="goToSettings"
          >
            <Icon icon="tabler:settings" width="20" height="20" class="q-mr-sm" />
            {{ $t('Manage Wallets') }}
          </q-btn>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Internal Transfer Modal -->
    <InternalTransferModal
      v-model="showTransferModal"
      @transfer-complete="onTransferComplete"
    />

    <!-- Address Book Quick Modal -->
    <AddressBookQuickModal
      v-model="showAddressBookQuick"
      @pay-contact="handlePayContact"
      @open-batch-send="showBatchSend = true"
    />

    <!-- Batch Send Modal -->
    <BatchSendModal
      v-model="showBatchSend"
      @batch-completed="handleBatchCompleted"
    />

    <!-- Contact Payment Modal -->
    <PaymentModal
      v-model="showContactPayment"
      :contact="selectedPayContact"
      @payment-sent="handleContactPaymentSent"
      @bitcoin-payment-requested="handleBitcoinPaymentFromContact"
    />

    <!-- Payment Confirmation Dialog -->
    <q-dialog v-model="showPaymentConfirmation" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'" style="width: 500px; max-width: 95vw;">
        <q-card-section :class="$q.dark.isActive ? 'dialog_header_dark' : 'dialog_header_light'">
          <div :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ pendingPayment?.type === 'lnurl_withdraw' ? $t('Redeem Sats') : pendingPayment?.bitcoinAddress ? $t('Send Bitcoin') : $t('Confirm Payment') }}
          </div>
          <q-btn flat round dense v-close-popup
                 :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'">
            <Icon icon="tabler:x" width="20" height="20" />
          </q-btn>
        </q-card-section>

        <!-- Bitcoin Withdrawal UI -->
        <q-card-section v-if="pendingPayment?.bitcoinAddress" class="bitcoin-withdraw-section">
          <L1BitcoinWithdraw
            :destination-address="pendingPayment.bitcoinAddress"
            :available-balance="walletState.balance"
            @withdrawal-complete="handleBitcoinWithdrawalComplete"
            @withdrawal-error="handleBitcoinWithdrawalError"
          />
        </q-card-section>

        <!-- LNURL-Withdraw UI -->
        <q-card-section v-else-if="pendingPayment?.type === 'lnurl_withdraw'" class="payment-content">
          <div class="payment-info">
            <div class="payment-amount">
              <div class="amount-display" :class="$q.dark.isActive ? 'amount_display_dark' : 'amount_display_light'">
                {{ withdrawAmountDisplay }}
              </div>
              <div class="amount-fiat" :class="$q.dark.isActive ? 'amount_fiat_dark' : 'amount_fiat_light'"
                   style="cursor: pointer;" @click="toggleWithdrawDenomination">
                <span v-if="withdrawSecondaryDisplay">{{ withdrawSecondaryDisplay }} <Icon icon="tabler:refresh" width="12" height="12" :class="{ 'denomination-spin': denominationSpinning }" /></span>
              </div>
            </div>

            <div class="payment-details" :class="$q.dark.isActive ? 'payment_details_dark' : 'payment_details_light'">
              <div class="detail-item" v-if="pendingPayment.defaultDescription">
                <span class="detail-label" :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{ $t('Description') }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{ pendingPayment.defaultDescription }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label" :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{ $t('Type') }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{ $t('Withdrawal') }}</span>
              </div>
              <div class="detail-item" v-if="!pendingPayment.isFixedAmount">
                <span class="detail-label" :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{ $t('Redeemable') }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'" style="cursor: pointer;" @click="toggleWithdrawDenomination">
                  {{ withdrawRedeemableRange }} <Icon icon="tabler:refresh" width="12" height="12" :class="{ 'denomination-spin': denominationSpinning }" />
                </span>
              </div>
            </div>

            <!-- Amount input for variable-amount withdraw -->
            <div v-if="needsWithdrawAmountInput" class="amount-input-section">
              <q-input
                v-model="paymentAmount"
                outlined
                :label="withdrawDenomination === 'fiat' ? withdrawFiatCurrency : $t('Amount')"
                type="number"
                :class="$q.dark.isActive ? 'amount_input_dark' : 'amount_input_light'"
                :rules="[val => validateWithdrawAmount(val)]"
                :disable="lnurlWithdrawStatus !== 'idle'"
              >
                <template v-slot:append>
                  <Icon icon="tabler:refresh" width="18" height="18"
                    :class="{ 'denomination-spin': denominationSpinning }"
                    class="denomination-toggle-icon"
                    @click="toggleWithdrawDenomination"
                  />
                </template>
              </q-input>
            </div>

            <!-- Status display during processing -->
            <div v-if="lnurlWithdrawStatus !== 'idle'" class="withdraw-status-section q-mt-md" style="text-align: center;">
              <q-spinner-dots v-if="lnurlWithdrawStatus !== 'error' && lnurlWithdrawStatus !== 'confirmed'" size="24px" class="q-mr-sm" />
              <Icon v-else-if="lnurlWithdrawStatus === 'error'" icon="tabler:alert-circle" width="24" height="24" style="color: var(--q-negative);" class="q-mr-sm" />
              <span :class="lnurlWithdrawStatus === 'error' ? 'text-negative' : ($q.dark.isActive ? 'text-grey-4' : 'text-grey-7')">
                {{ withdrawStatusMessage }}
              </span>
            </div>
          </div>
        </q-card-section>

        <!-- Regular Payment Confirmation -->
        <q-card-section class="payment-content" v-else-if="pendingPayment">
          <div class="payment-info">
            <!-- SA Retailer Merchant Info -->
            <div v-if="pendingPayment.merchant" class="merchant-info">
              <div class="merchant-info-left">
                <img :src="pendingPayment.merchant.logo" :alt="pendingPayment.merchant.displayName" class="merchant-logo" />
                <div class="merchant-text">
                  <div class="merchant-name">{{ pendingPayment.merchant.displayName }}</div>
                  <div v-if="pendingPayment.zarAmount" class="merchant-zar">R{{ pendingPayment.zarAmount }}</div>
                </div>
              </div>
              <div v-if="merchantCountdown > 0" class="merchant-countdown" :class="merchantCountdown <= 20 ? 'countdown-urgent' : ''">
                <Icon icon="tabler:clock" width="14" height="14" />
                {{ Math.floor(merchantCountdown / 60) }}:{{ String(merchantCountdown % 60).padStart(2, '0') }}
              </div>
            </div>

            <div class="payment-amount">
              <div class="amount-display" :class="$q.dark.isActive ? 'amount_display_dark' : 'amount_display_light'">
                {{ formatPaymentAmount() }}
              </div>
              <div class="amount-fiat" :class="$q.dark.isActive ? 'amount_fiat_dark' : 'amount_fiat_light'"
                   :style="needsAmountInput ? 'cursor: pointer;' : ''" @click="needsAmountInput ? toggleSendDenomination() : null">
                <span v-if="paymentFiatValue">{{ paymentFiatValue }} <q-icon v-if="needsAmountInput" name="las la-sync" size="12px" :class="{ 'denomination-spin': denominationSpinning }" /></span>
                <span v-else-if="pendingPayment && (pendingPayment.amount > 0 || paymentAmount)"
                      class="loading-fiat">{{ $t('Loading...') }}</span>
              </div>
              <!-- Show ZAR equivalent if user's preferred currency is not ZAR -->
              <div v-if="pendingPayment.zarAmount && walletState.preferredFiatCurrency !== 'ZAR'"
                   class="amount-zar-secondary" :class="$q.dark.isActive ? 'amount_fiat_dark' : 'amount_fiat_light'">
                R{{ pendingPayment.zarAmount }} ZAR
              </div>
            </div>

            <!-- Rate staleness warning -->
            <div v-if="pendingPayment.merchant && ratesStale" class="rate-warning">
              <Icon icon="tabler:alert-triangle" width="14" height="14" />
              {{ $t('Exchange rates may be outdated') }}
            </div>

            <div class="payment-details" :class="$q.dark.isActive ? 'payment_details_dark' : 'payment_details_light'">
              <!-- Recipient (Lightning Address or Spark Address) - hide raw address for merchant payments -->
              <div class="detail-item" v-if="(pendingPayment.lightningAddress || pendingPayment.sparkAddress) && !pendingPayment.merchant">
                <span class="detail-label" :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{
                    $t('To')
                  }}:</span>
                <span class="detail-value recipient-address" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{
                    pendingPayment.lightningAddress || pendingPayment.sparkAddress
                  }}</span>
              </div>
              <!-- Show merchant name as recipient for SA retail payments -->
              <div class="detail-item" v-else-if="pendingPayment.merchant">
                <span class="detail-label" :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{
                    $t('To')
                  }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{
                    pendingPayment.merchant.displayName
                  }}</span>
              </div>
              <div class="detail-item" v-if="pendingPayment.description">
                <span class="detail-label" :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{
                    $t('Description')
                  }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{
                    pendingPayment.description
                  }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label"
                      :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{ $t('Type') }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{
                    getPaymentTypeLabel()
                  }}</span>
              </div>
              <!-- Fee estimate for Spark Lightning payments -->
              <div class="detail-item" v-if="showFeeEstimate">
                <span class="detail-label"
                      :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{ $t('Est. Fee') }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">
                  <span v-if="isEstimatingFee" class="fee-loading">{{ $t('Estimating...') }}</span>
                  <span v-else-if="estimatedFee !== null">{{ formatAmountInline(estimatedFee) }}</span>
                  <span v-else-if="pendingPayment.sparkAddress" class="fee-free">{{ $t('Free (Spark transfer)') }}</span>
                </span>
              </div>
              <!-- Amount range for variable-amount payments -->
              <div class="detail-item" v-if="payAmountRange">
                <span class="detail-label" :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{ $t('Amount range') }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{ payAmountRange }}</span>
              </div>
            </div>

            <!-- Amount input for LNURL/Lightning Address -->
            <div v-if="needsAmountInput" class="amount-input-section">
              <q-input
                v-model="paymentAmount"
                outlined
                :label="sendDenomination === 'fiat' ? preferredFiatCurrency : $t('Amount')"
                type="number"
                :class="$q.dark.isActive ? 'amount_input_dark' : 'amount_input_light'"
                :rules="[validatePaymentAmount]"
              >
                <template v-slot:append>
                  <Icon icon="tabler:refresh" width="18" height="18"
                    :class="{ 'denomination-spin': denominationSpinning }"
                    class="denomination-toggle-icon"
                    @click="toggleSendDenomination"
                  />
                </template>
              </q-input>

              <q-input
                v-if="pendingPayment.commentAllowed > 0"
                v-model="paymentComment"
                outlined
                :label="$t('Comment (optional)')"
                :maxlength="pendingPayment.commentAllowed"
                :class="$q.dark.isActive ? 'comment_input_dark' : 'comment_input_light'"
              />
            </div>
          </div>
        </q-card-section>

        <q-card-actions v-if="pendingPayment?.type !== 'lnurl_withdraw' || lnurlWithdrawStatus === 'idle'" align="right" class="payment-actions"
                        :class="$q.dark.isActive ? 'payment_actions_dark' : 'payment_actions_light'">
          <q-btn flat :label="$t('Cancel')" v-close-popup no-caps
                 :class="$q.dark.isActive ? 'cancel_btn_dark' : 'cancel_btn_light'"
                 @click="pendingPayment?.type === 'lnurl_withdraw' ? resetWithdrawState() : null"/>
          <q-btn
            v-if="pendingPayment?.type === 'lnurl_withdraw'"
            flat
            :label="$t('Redeem')"
            no-caps
            @click="executeWithdraw"
            :disable="!canConfirmWithdraw"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          />
          <q-btn
            v-else
            flat
            :label="$t('Send Payment')"
            no-caps
            @click="confirmPayment"
            :loading="isSendingPayment"
            :disable="!canConfirmPayment"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- LNURL-Withdraw Success Screen -->
    <PaymentConfirmation
      v-model="showWithdrawSuccess"
      :amount="withdrawConfirmedAmount"
      :fiat-amount="withdrawConfirmedFiat"
      label="Sats Received"
      :auto-close-delay="5"
      @closed="onWithdrawSuccessClosed"
    />

    <!-- Save Contact Dialog -->
    <q-dialog v-model="showSaveContactDialog" persistent class="save-contact-dialog">
      <q-card class="save-contact-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="save-contact-header" :class="$q.dark.isActive ? 'dialog_header_dark' : 'dialog_header_light'">
          <div :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Save to Contacts?') }}
          </div>
          <q-btn
            flat
            round
            dense
            @click="closeSaveContactDialog"
            :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          >
            <Icon icon="tabler:x" width="20" height="20" />
          </q-btn>
        </q-card-section>

        <q-card-section class="save-contact-content">
          <div class="save-contact-address" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            <Icon
              :icon="saveContactData.addressType === 'spark' ? 'tabler:flame' : 'tabler:bolt'"
              width="16" height="16"
              :style="{ color: saveContactData.addressType === 'spark' ? '#4caf50' : '#ffc107' }"
              class="q-mr-xs"
            />
            <span class="address-preview">{{ truncateAddress(saveContactData.address) }}</span>
          </div>

          <q-input
            v-model="saveContactData.name"
            outlined
            :label="$t('Name')"
            :placeholder="$t('Enter a name for this contact')"
            class="q-mt-md"
            :class="$q.dark.isActive ? 'save-input-dark' : 'save-input-light'"
            autofocus
          />

          <q-input
            v-model="saveContactData.notes"
            outlined
            :label="$t('Notes')"
            :placeholder="$t('Optional notes')"
            type="textarea"
            rows="2"
            class="q-mt-sm"
            :class="$q.dark.isActive ? 'save-input-dark' : 'save-input-light'"
            maxlength="200"
          />
        </q-card-section>

        <q-card-actions align="right" class="save-contact-actions" :class="$q.dark.isActive ? 'actions-dark' : 'actions-light'">
          <q-btn
            flat
            :label="$t('Skip')"
            @click="closeSaveContactDialog"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          />
          <q-btn
            flat
            :label="$t('Save')"
            @click="saveRecipientAsContact"
            class="save-btn"
            :disable="!saveContactData.name?.trim()"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { NostrWebLNProvider } from "@getalby/sdk";
import {LightningPaymentService, resolveLUD17URL} from '../utils/lightning.js';
import {Invoice} from '@getalby/lightning-tools';
import {fiatRatesService} from '../utils/fiatRates.js';
import {formatMainBalance as formatMainBalanceUtil, formatAmount} from '../utils/amountFormatting.js';
import NumberFlow from '@number-flow/vue';
import {createPaymentMonitor, PaymentStatus, checkNWCPaymentStatus} from '../utils/paymentMonitor.js';
import PaymentConfirmation from '../components/PaymentConfirmation.vue';
import {useWalletStore} from '../stores/wallet';
import {useAddressBookStore} from '../stores/addressBook';
import ReceiveModal from '../components/ReceiveModal.vue';
import SendModal from '../components/SendModal.vue';
import L1BitcoinWithdraw from '../components/L1BitcoinWithdraw.vue';
import InternalTransferModal from '../components/InternalTransferModal.vue';
import AddressBookQuickModal from '../components/AddressBookQuickModal.vue';
import PaymentModal from '../components/PaymentModal.vue';
import BatchSendModal from '../components/BatchSendModal.vue';
import BackupBanner from '../components/BackupBanner.vue';
import {useAutoWithdrawStore} from '../stores/autoWithdraw';
import {SA_RETAIL_SOURCE, parseZARFromMetadata} from '../utils/merchantQR.js';
import {EventBus} from '../utils/eventBus';

export default {
  name: 'WalletPage',
  components: {
    ReceiveModal,
    SendModal,
    L1BitcoinWithdraw,
    InternalTransferModal,
    AddressBookQuickModal,
    PaymentModal,
    BatchSendModal,
    PaymentConfirmation,
    NumberFlow,
    BackupBanner
  },
  setup() {
    const walletStore = useWalletStore();
    const addressBookStore = useAddressBookStore();
    return { walletStore, addressBookStore };
  },
  data() {
    return {
      // Spark tab switching
      sparkTabSwitching: false,

      // Wallet switcher: per-wallet balance loading
      refreshingWalletIds: {},

      // PIN migration (one-time, for existing users)
      showMigrationDialog: false,
      migrationPin: '',
      migrationError: '',
      isMigrating: false,

      walletState: {
        balance: 312,
        connectedWallets: [],
        activeWalletId: null,
        currency: 'sats',
        currencies: ['sats', 'btc', 'usd'],
        exchangeRates: {},
        lastRateUpdate: null,
        preferredFiatCurrency: 'USD',
        denominationCurrency: 'bitcoin',
        displayMode: 'bitcoin'
      },
      recentTransactions: [],
      showReceiveModal: false,
      showSendModal: false,
      showPaymentConfirmation: false,
      pendingPayment: null,
      merchantCountdown: 0,
      merchantCountdownTimer: null,
      paymentAmount: '',
      paymentComment: '',
      sendDenomination: 'sats', // 'sats' or 'fiat' — for LNURL/Lightning Address send flow
      slidePosition: 0,
      slideConfirmed: false,
      isSliding: false,
      slideStartX: 0,
      maxSlideDistance: 0,
      parsedInvoice: null,
      lightningAddress: '',
      refreshInterval: null,
      pulseInterval: null,
      showLoadingScreen: true,
      currentDisplayMode: 'bitcoin',
      isSwitchingCurrency: false,
      shouldPulse: false,
      paymentData: null,
      isSendingPayment: false,
      fiatRatesLoaded: false,
      secondaryValue: '',
      paymentFiatValue: '',
      showWalletSwitcher: false,
      // Fee estimation for Spark Lightning payments
      estimatedFee: null,
      isEstimatingFee: false,
      // Save-to-contacts after payment
      showSaveContactDialog: false,
      saveContactData: {
        address: '',
        addressType: 'lightning',
        name: '',
        notes: ''
      },
      // L1 Bitcoin pending deposits
      pendingBitcoinDeposits: [],
      bitcoinDepositPollingInterval: null,
      // Internal transfer modal
      showTransferModal: false,
      // Address Book Quick Modal
      showAddressBookQuick: false,
      // Batch Send Modal
      showBatchSend: false,
      // Contact Payment Modal
      showContactPayment: false,
      selectedPayContact: null,
      // LNURL-Withdraw state
      withdrawDenomination: 'sats', // 'sats' or 'fiat'
      denominationSpinning: false,
      lnurlWithdrawStatus: 'idle',
      lnurlWithdrawError: null,
      lnurlWithdrawInvoice: null,
      withdrawPaymentMonitor: null,
      withdrawSparkUnsubscribe: null,
      showWithdrawSuccess: false,
      withdrawConfirmedAmount: 0,
      withdrawConfirmedFiat: ''
    };
  },
  computed: {
    activeWallet() {
      return this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      ) || null;
    },
    walletDisplayName() {
      if (!this.activeWallet) return '';
      return this.activeWallet.name;
    },
    isSparkWallet() {
      return this.walletStore.isActiveWalletSpark;
    },
    sparkWalletPair() {
      return this.walletStore.sparkWallets.sort(
        (a, b) => (a.connectionData?.accountNumber || 0) - (b.connectionData?.accountNumber || 0)
      );
    },
    showSparkTabs() {
      return this.walletStore.isActiveWalletSpark && this.sparkWalletPair.length === 2;
    },
    isPersonalActive() {
      const active = this.walletStore.activeWallet;
      return active?.type === 'spark' && active?.connectionData?.accountNumber === 2;
    },
    isAutoTransferActive() {
      if (!this.activeWallet) return false;
      const awStore = useAutoWithdrawStore();
      const config = awStore.getConfig(this.activeWallet.id);
      return config?.enabled === true;
    },
    autoWithdrawResult() {
      const awStore = useAutoWithdrawStore()
      return awStore.lastResult
    },
    ratesStale() {
      return fiatRatesService.areRatesStale();
    },
    needsAmountInput() {
      if (!this.pendingPayment) return false;

      // LNURL-withdraw has its own amount handling
      if (this.pendingPayment.type === 'lnurl_withdraw') return false;

      // Spark addresses always need amount input (no embedded amount)
      if (this.pendingPayment.type === 'spark_address' || this.pendingPayment.sparkAddress) {
        return true;
      }

      // Lightning Address always needs amount input (no embedded amount in address)
      if (this.pendingPayment.type === 'lightning_address' || this.pendingPayment.lightningAddress) {
        // Use isFixedAmount flag if available (from NWC processing)
        if (this.pendingPayment.isFixedAmount !== undefined) {
          return !this.pendingPayment.isFixedAmount;
        }
        // For Spark wallet (no LNURL info fetched yet), always require amount
        if (!this.pendingPayment.minSendable && !this.pendingPayment.maxSendable) {
          return true;
        }
        // Check if min equals max (fixed amount from LNURL info)
        return this.pendingPayment.minSendable !== this.pendingPayment.maxSendable;
      }

      // Check for LNURL payments
      if (this.pendingPayment.type === 'lnurl' || this.pendingPayment.type === 'lnurl_pay') {
        if (this.pendingPayment.isFixedAmount !== undefined) {
          return !this.pendingPayment.isFixedAmount;
        }
        return this.pendingPayment.minSendable !== this.pendingPayment.maxSendable;
      }

      // Zero-amount invoices need amount input
      return (this.pendingPayment.type === 'lightning_invoice' && this.pendingPayment.amount === 0) ||
             (this.pendingPayment.type === 'invoice' && this.pendingPayment.amount === 0);
    },
    sendAmountSats() {
      if (!this.needsAmountInput) return 0;
      const val = parseFloat(this.paymentAmount);
      if (!val || val <= 0) return 0;
      if (this.sendDenomination === 'fiat') {
        return fiatRatesService.convertFiatToSatsSync(val, this.preferredFiatCurrency) || 0;
      }
      return Math.floor(val);
    },
    canConfirmPayment() {
      if (!this.pendingPayment) return false;
      if (this.needsAmountInput) {
        const sats = this.sendAmountSats;
        return sats > 0 && this.validatePaymentAmount(this.paymentAmount) === true;
      }
      return true;
    },
    // Show fee estimate row only when we have actual fee data to display
    // - Spark wallet: Show when we have an estimate OR it's a free Spark transfer
    // - NWC/LNBits: Never show (no fee estimation available)
    showFeeEstimate() {
      if (!this.pendingPayment) return false;
      if (!this.walletStore.isActiveWalletSpark) return false;

      // Show "Free" for Spark-to-Spark transfers
      if (this.pendingPayment.sparkAddress) return true;

      // Show when estimating or when we have an actual estimate
      // Don't show empty row when fee is null (e.g., LNURL before invoice is fetched)
      return this.isEstimatingFee || this.estimatedFee !== null;
    },
    // Computed properties from Pinia store for wallet switcher
    storeWallets() {
      return this.walletStore.wallets || [];
    },
    storeActiveWalletId() {
      return this.walletStore.activeWalletId;
    },
    storeBalances() {
      return this.walletStore.balances || {};
    },

    balanceNumericValue() {
      const balance = this.walletState.balance || 0;
      if (this.currentDisplayMode === 'fiat') {
        const btcAmount = balance / 100000000;
        const rate = this.walletState.exchangeRates?.[this.walletState.preferredFiatCurrency?.toLowerCase()];
        if (!rate) return 0;
        return btcAmount * rate;
      }
      // BIP-177: display sats as whole integers (1 bitcoin = 1 sat)
      return balance;
    },

    balanceNumberFormat() {
      if (this.currentDisplayMode === 'fiat') {
        return { minimumFractionDigits: 2, maximumFractionDigits: 2 };
      }
      // Both BIP-177 and legacy: whole integers with thousands grouping
      return { useGrouping: true, maximumFractionDigits: 0 };
    },

    balancePrefix() {
      if (this.currentDisplayMode === 'fiat') {
        const symbols = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', CHF: 'CHF ', AUD: 'A$', JPY: '¥' };
        return symbols[this.walletState.preferredFiatCurrency] || '';
      }
      if (this.walletStore.useBip177Format) return '₿';
      return '';
    },

    balanceSuffix() {
      if (this.currentDisplayMode === 'fiat') return '';
      if (this.walletStore.useBip177Format) return '';
      return ' sats';
    },
    storeConnectionStates() {
      return this.walletStore.connectionStates || {};
    },
    needsWithdrawAmountInput() {
      if (!this.pendingPayment || this.pendingPayment.type !== 'lnurl_withdraw') return false;
      return !this.pendingPayment.isFixedAmount;
    },
    preferredFiatCurrency() {
      return (this.walletState.preferredFiatCurrency || 'USD').toUpperCase();
    },
    withdrawFiatCurrency() {
      return this.preferredFiatCurrency;
    },
    withdrawAmountSats() {
      if (!this.pendingPayment || this.pendingPayment.type !== 'lnurl_withdraw') return 0;
      if (this.pendingPayment.isFixedAmount) return this.pendingPayment.fixedAmountSats;
      const val = parseFloat(this.paymentAmount);
      if (!val || val <= 0) return 0;
      if (this.withdrawDenomination === 'fiat') {
        return fiatRatesService.convertFiatToSatsSync(val, this.withdrawFiatCurrency) || 0;
      }
      return Math.floor(val);
    },
    withdrawAmountDisplay() {
      if (!this.pendingPayment) return '';
      if (this.pendingPayment.isFixedAmount) {
        if (this.withdrawDenomination === 'fiat') {
          const fiat = fiatRatesService.convertSatsToFiatSync(this.pendingPayment.fixedAmountSats, this.withdrawFiatCurrency);
          return fiat !== null ? fiatRatesService.formatFiatAmount(fiat, this.withdrawFiatCurrency) : this.formatAmountInline(this.pendingPayment.fixedAmountSats);
        }
        return this.formatAmountInline(this.pendingPayment.fixedAmountSats);
      }
      if (!this.paymentAmount) return this.$t('Enter amount');
      if (this.withdrawDenomination === 'fiat') {
        const val = parseFloat(this.paymentAmount);
        return val > 0 ? fiatRatesService.formatFiatAmount(val, this.withdrawFiatCurrency) : this.$t('Enter amount');
      }
      return this.formatAmountInline(parseInt(this.paymentAmount));
    },
    withdrawSecondaryDisplay() {
      const sats = this.withdrawAmountSats;
      if (!sats) return '';
      if (this.withdrawDenomination === 'fiat') {
        return '≈ ' + this.formatAmountInline(sats);
      }
      const fiat = fiatRatesService.convertSatsToFiatSync(sats, this.withdrawFiatCurrency);
      if (fiat === null) return '';
      return '≈ ' + fiatRatesService.formatFiatAmount(fiat, this.withdrawFiatCurrency);
    },
    withdrawRedeemableRange() {
      if (!this.pendingPayment) return '';
      if (this.withdrawDenomination === 'fiat') {
        const minFiat = fiatRatesService.convertSatsToFiatSync(this.pendingPayment.minSats, this.withdrawFiatCurrency);
        const maxFiat = fiatRatesService.convertSatsToFiatSync(this.pendingPayment.maxSats, this.withdrawFiatCurrency);
        if (minFiat !== null && maxFiat !== null) {
          return `${fiatRatesService.formatFiatAmount(minFiat, this.withdrawFiatCurrency)} - ${fiatRatesService.formatFiatAmount(maxFiat, this.withdrawFiatCurrency)}`;
        }
      }
      return `${this.pendingPayment.minSats} - ${this.pendingPayment.maxSats} sats`;
    },
    payAmountRange() {
      if (!this.pendingPayment || !this.needsAmountInput) return '';
      const minSats = this.pendingPayment.minSats || (this.pendingPayment.minSendable ? Math.ceil(this.pendingPayment.minSendable / 1000) : 0);
      const maxSats = this.pendingPayment.maxSats || (this.pendingPayment.maxSendable ? Math.floor(this.pendingPayment.maxSendable / 1000) : 0);
      if (!minSats || !maxSats || minSats === maxSats) return '';
      if (this.sendDenomination === 'fiat') {
        const currency = this.preferredFiatCurrency;
        const minFiat = fiatRatesService.convertSatsToFiatSync(minSats, currency);
        const maxFiat = fiatRatesService.convertSatsToFiatSync(maxSats, currency);
        if (minFiat !== null && maxFiat !== null) {
          return `${fiatRatesService.formatFiatAmount(minFiat, currency)} - ${fiatRatesService.formatFiatAmount(maxFiat, currency)}`;
        }
      }
      return `${minSats} - ${maxSats} sats`;
    },
    canConfirmWithdraw() {
      if (!this.pendingPayment || this.pendingPayment.type !== 'lnurl_withdraw') return false;
      if (this.lnurlWithdrawStatus !== 'idle') return false;
      if (this.pendingPayment.isFixedAmount) return true;
      const sats = this.withdrawAmountSats;
      return sats >= this.pendingPayment.minSats && sats <= this.pendingPayment.maxSats;
    },
    withdrawStatusMessage() {
      const messages = {
        'idle': '',
        'creating': this.$t('Preparing...'),
        'submitting': this.$t('Requesting funds...'),
        'monitoring': this.$t('Receiving sats...'),
        'confirmed': this.$t('Sats received!'),
        'error': this.lnurlWithdrawError || this.$t('Redeem failed')
      };
      return messages[this.lnurlWithdrawStatus] || '';
    }
  },
  async created() {
    // Safety timeout: force-hide loading screen after 15s to prevent permanent black screen
    setTimeout(() => {
      this.showLoadingScreen = false;
    }, 15000);
    this.initializeWallet();
    // Check for Bitcoin withdrawal from contacts
    this.handleBitcoinWithdrawalFromQuery();
    // Check if existing Spark wallets need one-time PIN migration
    this.$watch(() => this.walletStore.needsPinMigration, (needs) => {
      if (needs) this.showMigrationDialog = true;
    }, { immediate: true });
    // Listen for deep link events (Android intent filters: lightning:, bitcoin:, lnurlp://, lnurlw://)
    this._deepLinkHandler = (paymentData) => this.onPaymentDetected(paymentData);
    EventBus.on('deep-link', this._deepLinkHandler);
  },
  beforeUnmount() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
    }
    if (this.qrScanner) {
      this.qrScanner.destroy();
    }
    // Stop L1 Bitcoin deposit polling
    this.stopBitcoinDepositPolling();
    // Stop withdraw monitor if active
    this.stopWithdrawMonitor();
    // Stop merchant countdown if active
    this.stopMerchantCountdown();
    // Clean up deep link listener
    if (this._deepLinkHandler) {
      EventBus.off('deep-link', this._deepLinkHandler);
    }
  },
  watch: {
    'walletState.balance': {
      handler() {
        this.updateSecondaryValue();
      },
      immediate: true
    },

    currentDisplayMode: {
      handler: 'updateSecondaryValue',
      immediate: true
    },

    showPaymentConfirmation(open) {
      if (open && this.pendingPayment?.merchant) {
        this.startMerchantCountdown();
      } else {
        this.stopMerchantCountdown();
      }
      if (!open) {
        this.sendDenomination = 'sats';
      }
    },

    pendingPayment: {
      handler: 'updatePaymentFiatValue',
      immediate: true,
      deep: true
    },

    paymentAmount: {
      handler: 'updatePaymentFiatValue',
      immediate: true
    },

    autoWithdrawResult(result) {
      if (!result) return
      const awStore = useAutoWithdrawStore()
      if (result.type === 'success') {
        this.$q.notify({
          type: 'positive',
          message: this.$t('Auto-transfer complete'),
          caption: `${result.amount.toLocaleString()} sats → ${result.destination}`,
          icon: 'send',
          timeout: 4000
        })
      } else if (result.type === 'error') {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Auto-transfer failed'),
          caption: result.message,
          icon: 'error',
          timeout: 5000
        })
      }
      awStore.lastResult = null
    }
  },
  methods: {
    goToBackup() {
      this.$router.push('/settings?section=backup');
    },

    async openWalletManagement() {
      if (this.showWalletSwitcher) return; // Prevent double-open
      this.showWalletSwitcher = true;

      // Refresh balances for all wallets — track loading state per wallet
      const wallets = this.walletStore.wallets;
      for (const w of wallets) {
        // Show skeleton for wallets without a cached balance
        if (this.walletStore.balances[w.id] === undefined) {
          this.refreshingWalletIds = { ...this.refreshingWalletIds, [w.id]: true };
        }
      }

      await Promise.allSettled(
        wallets.map(async (w) => {
          try {
            await this.walletStore.refreshWalletData(w.id);
          } catch { /* ignore */ }
          this.refreshingWalletIds = { ...this.refreshingWalletIds, [w.id]: false };
        })
      );
    },

    /**
     * Handle pay contact from AddressBookQuickModal
     */
    handlePayContact(contact) {
      this.showAddressBookQuick = false;

      // Bitcoin contacts need L1 withdrawal flow
      if (contact.addressType === 'bitcoin') {
        const address = contact.address || contact.lightningAddress;
        this.pendingPayment = {
          bitcoinAddress: address,
          contactName: contact.name
        };
        this.showPaymentConfirmation = true;
        return;
      }

      // Lightning and Spark contacts use PaymentModal
      this.selectedPayContact = contact;
      this.showContactPayment = true;
    },

    /**
     * Handle successful contact payment
     */
    handleContactPaymentSent() {
      this.selectedPayContact = null;
      this.$q.notify({
        type: 'positive',
        message: this.$t('Payment sent'),
        timeout: 2000
      });
      // Refresh balance for active wallet
      if (this.walletStore.activeWalletId) {
        this.walletStore.refreshWalletData(this.walletStore.activeWalletId);
      }
    },

    /**
     * Handle Bitcoin payment request from contact modal
     */
    handleBitcoinPaymentFromContact(paymentData) {
      this.showContactPayment = false;
      this.selectedPayContact = null;
      // Navigate to Bitcoin withdrawal
      const address = paymentData.address || paymentData.contact?.address;
      this.pendingPayment = {
        bitcoinAddress: address,
        contactName: paymentData.contact?.name
      };
      this.showPaymentConfirmation = true;
    },

    /**
     * Handle batch send completion
     */
    handleBatchCompleted(results) {
      const succeeded = results.filter(r => r.status === 'success').length;
      const failed = results.filter(r => r.status === 'failed' || r.status === 'skipped').length;

      this.$q.notify({
        type: failed === 0 ? 'positive' : 'warning',
        message: failed === 0
          ? this.$t('{count} payments sent', { count: succeeded })
          : this.$t('{sent} sent, {failed} failed', { sent: succeeded, failed }),
        timeout: 3000
      });
    },

    // ==========================================
    // L1 Bitcoin Deposit Methods
    // ==========================================

    /**
     * Open receive modal with Bitcoin tab selected
     */
    openReceiveModalBitcoin() {
      this.showReceiveModal = true;
      // The ReceiveModal will receive this via a prop or event
      this.$nextTick(() => {
        // Emit event to set bitcoin mode
        this.$refs.receiveModal?.setReceiveMode?.('bitcoin');
      });
    },

    /**
     * Check for pending Bitcoin deposits (for banner display)
     */
    async checkPendingBitcoinDeposits() {
      if (!this.isSparkWallet) return;

      try {
        const provider = await this.walletStore.ensureSparkConnected();
        if (!provider?.getPendingDeposits) return;

        const newDeposits = await provider.getPendingDeposits();

        // Detect changes and show notifications
        this.detectDepositChanges(newDeposits);

        this.pendingBitcoinDeposits = newDeposits;
      } catch (error) {
        // Silently ignore - wallet may be locked
      }
    },

    /**
     * Detect deposit changes and trigger notifications
     */
    detectDepositChanges(newDeposits) {
      const previousTxIds = new Set(this.pendingBitcoinDeposits.map(d => d.txId));
      const previousConfirmed = new Map(this.pendingBitcoinDeposits.map(d => [d.txId, d.confirmed]));

      for (const deposit of newDeposits) {
        // New deposit detected (not seen before)
        if (!previousTxIds.has(deposit.txId)) {
          this.notifyNewDeposit(deposit);
        }
        // Deposit became claimable (was not confirmed, now is)
        else if (deposit.confirmed && !previousConfirmed.get(deposit.txId)) {
          this.notifyDepositReady(deposit);
        }
      }
    },

    /**
     * Show notification for new deposit detected
     */
    notifyNewDeposit(deposit) {
      this.$q.notify({
        type: 'info',
        icon: 'currency_bitcoin',
        message: this.$t('Bitcoin detected'),
        caption: `${deposit.amount.toLocaleString()} sats ${this.$t('confirming')}`,
        position: 'top',
        timeout: 5000,
        actions: [{
          label: this.$t('View'),
          color: 'white',
          handler: () => this.openReceiveModalBitcoin()
        }]
      });
    },

    /**
     * Show notification when deposit is ready to claim
     */
    notifyDepositReady(deposit) {
      this.$q.notify({
        type: 'positive',
        icon: 'check_circle',
        message: this.$t('Ready to claim'),
        caption: `${deposit.amount.toLocaleString()} sats`,
        position: 'top',
        timeout: 8000,
        actions: [{
          label: this.$t('Claim'),
          color: 'white',
          handler: () => this.openReceiveModalBitcoin()
        }]
      });
    },

    /**
     * Start polling for pending Bitcoin deposits
     */
    startBitcoinDepositPolling() {
      if (!this.isSparkWallet) return;

      // Initial check
      this.checkPendingBitcoinDeposits();

      // Poll every 5 minutes
      this.bitcoinDepositPollingInterval = setInterval(() => {
        this.checkPendingBitcoinDeposits();
      }, 300000);
    },

    /**
     * Stop Bitcoin deposit polling
     */
    stopBitcoinDepositPolling() {
      if (this.bitcoinDepositPollingInterval) {
        clearInterval(this.bitcoinDepositPollingInterval);
        this.bitcoinDepositPollingInterval = null;
      }
    },

    /**
     * Handle deposits updated from ReceiveModal
     */
    handleBitcoinDepositsUpdated(deposits) {
      this.pendingBitcoinDeposits = deposits;
    },

    /**
     * Handle successful Bitcoin withdrawal
     */
    handleBitcoinWithdrawalComplete(result) {
      this.showPaymentConfirmation = false;
      this.pendingPayment = null;

      this.$q.notify({
        type: 'positive',
        message: this.$t('Bitcoin withdrawal initiated'),
        caption: this.$t('Your withdrawal is being processed'),

        timeout: 4000,
      });

      // Refresh balance
      this.updateWalletBalance();
    },

    /**
     * Handle Bitcoin withdrawal error
     */
    handleBitcoinWithdrawalError(error) {
      // Error notification is already shown by the component
      console.error('Bitcoin withdrawal error:', error);
    },

    /**
     * Handle Bitcoin withdrawal request from query params (from contacts)
     */
    handleBitcoinWithdrawalFromQuery() {
      const query = this.$route.query;
      if (query.action === 'bitcoin_withdrawal' && query.address) {
        // Wait for wallet to be loaded
        this.$nextTick(() => {
          setTimeout(() => {
            // Set up pending payment for Bitcoin withdrawal
            this.pendingPayment = {
              type: 'bitcoin_address',
              bitcoinAddress: query.address,
              contactName: query.contactName || null
            };
            this.showPaymentConfirmation = true;

            // Clear query params
            this.$router.replace({ query: {} });
          }, 500);
        });
      }
    },

    async switchSparkTab(walletId) {
      if (walletId === this.storeActiveWalletId || this.sparkTabSwitching) return;
      this.sparkTabSwitching = true;

      try {
        await this.walletStore.switchActiveWallet(walletId);
        this.walletState.activeWalletId = walletId;
        this.walletState.balance = this.storeBalances[walletId] || 0;
        localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
        this.updateWalletBalance();
      } catch (error) {
        console.error('Error switching Spark tab:', error);
        this.$q.notify({ type: 'negative', message: this.$t('Couldn\'t switch wallet') });
      } finally {
        this.sparkTabSwitching = false;
      }
    },

    async switchToWallet(walletId) {
      if (walletId === this.storeActiveWalletId) {
        this.showWalletSwitcher = false;
        return;
      }

      try {
        // Use the wallet store to switch - this keeps Settings in sync
        await this.walletStore.switchActiveWallet(walletId);

        // Also update local walletState to stay in sync
        this.walletState.activeWalletId = walletId;

        // Get the new active wallet's balance from the store
        this.walletState.balance = this.storeBalances[walletId] || 0;

        // Save state to localStorage
        localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

        this.showWalletSwitcher = false;

        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet switched'),

        });

        // Check if Spark wallet needs PIN unlock
        await this.checkSparkWalletUnlock();

        // Refresh balance in background (only if provider is available)
        this.updateWalletBalance();
      } catch (error) {
        console.error('Error switching wallet:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t switch wallet'),

        });
      }
    },

    goToSettings() {
      this.showWalletSwitcher = false;
      this.$router.push('/settings?section=wallets');
    },

    // ==========================================
    // Internal Transfer Methods
    // ==========================================

    /**
     * Open the internal transfer modal
     */
    openTransferModal() {
      this.showWalletSwitcher = false;
      this.showTransferModal = true;
    },

    /**
     * Handle successful internal transfer
     */
    onTransferComplete(result) {
      this.$q.notify({
        type: 'positive',
        message: this.$t('Transfer complete'),
        caption: `${result.amount.toLocaleString()} sats`,
        timeout: 4000,
      });

      // Refresh wallet balance
      this.updateWalletBalance();
    },

    getWalletColorClass(wallet) {
      const colors = ['wallet-green', 'wallet-blue', 'wallet-purple', 'wallet-orange', 'wallet-red'];
      const index = wallet.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
      return colors[index];
    },
    getWalletIcon(type) {
      switch (type) {
        case 'spark': return 'tabler:flame';
        case 'lnbits': return 'tabler:server';
        default: return 'tabler:wallet';
      }
    },
    getWalletBadgeIcon(type) {
      switch (type) {
        case 'spark': return 'tabler:flame';
        case 'lnbits': return 'tabler:server';
        default: return 'tabler:plug';
      }
    },
    getWalletTypeLabel(type) {
      switch (type) {
        case 'spark': return 'Spark';
        case 'lnbits': return 'LNBits';
        default: return 'NWC';
      }
    },
    getWalletTypeBadgeClass(type) {
      switch (type) {
        case 'spark': return 'type-spark';
        case 'lnbits': return 'type-lnbits';
        default: return 'type-nwc';
      }
    },
    async initializeWallet() {
      try {
        await this.loadWalletState();

        // Initialize wallet store
        await this.walletStore.initialize();

        // Start L1 Bitcoin deposit polling for banner (after wallet store is ready)
        this.startBitcoinDepositPolling();

        await this.loadFiatRates();
        await this.loadTransactions();
        await this.loadNostrProfiles();

        this.startPeriodicRefresh();
        this.startPulseAnimation();

        this.showLoadingScreen = false;

        // Check if Spark wallet needs unlocking
        await this.checkSparkWalletUnlock();
      } catch (error) {
        console.error('Error initializing wallet:', error);
        this.showLoadingScreen = false;
      }
    },

    async checkSparkWalletUnlock() {
      // Skip if migration is pending — the migration dialog handles connection
      if (this.walletStore.needsPinMigration) return;

      // Auto-connect Spark wallet if not already connected
      if (this.walletStore.isActiveWalletSpark) {
        const provider = this.walletStore.getActiveProvider();
        if (!provider) {
          try {
            await this.walletStore.connectAllSparkWallets();
            await this.updateWalletBalance();
            this.checkPendingBitcoinDeposits();
          } catch (error) {
            console.warn('Spark auto-connect failed:', error.message);
          }
        }
      }
    },

    async handleMigration() {
      if (!this.migrationPin || this.migrationPin.length < 6) return;

      this.isMigrating = true;
      this.migrationError = '';

      try {
        await this.walletStore.migrateSparkWallets(this.migrationPin);
        this.showMigrationDialog = false;
        this.migrationPin = '';

        await this.updateWalletBalance();
        this.checkPendingBitcoinDeposits();

        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet unlocked — upgrade complete'),
        });
      } catch (error) {
        console.error('Migration failed:', error);
        this.migrationError = this.$t('Incorrect PIN. Please try again.');
        this.migrationPin = '';
      } finally {
        this.isMigrating = false;
      }
    },

    async loadWalletState() {
      const savedState = localStorage.getItem('buhoGO_wallet_state');
      if (savedState) {
        try {
          const parsedState = JSON.parse(savedState);
          this.walletState = {...this.walletState, ...parsedState};
          await this.updateWalletBalance();
        } catch (error) {
          console.error('Failed to load wallet state:', error);
        }
      } else {
        this.walletState.balance = 312;
      }
    },

    async updateWalletBalance() {
      try {
        if (this.showLoadingScreen) {
          // still initializing
        }

        const awStore = useAutoWithdrawStore();
        const activeWalletId = this.walletStore.activeWalletId;

        // Check if active wallet is Spark
        if (this.walletStore.isActiveWalletSpark) {
          // Try to get connected provider, auto-reconnects if session PIN available
          try {
            const provider = await this.walletStore.ensureSparkConnected();
            const balanceResult = await provider.getBalance();
            this.walletState.balance = balanceResult.balance;
            localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

            // Auto-withdraw check
            if (balanceResult.balance > 0 && activeWalletId) {
              awStore.checkAndExecute(activeWalletId, balanceResult.balance, this.walletStore);
            }
          } catch (err) {
            // Silently fail for background refresh - user will see locked state
            // Don't spam console with expected "PIN required" messages
            if (!err.message?.includes('PIN')) {
              console.warn('Balance refresh skipped:', err.message);
            }
          }
          return;
        }

        // Check if active wallet is LNBits
        if (this.walletStore.isActiveWalletLNBits) {
          try {
            const provider = this.walletStore.getActiveProvider();
            if (provider) {
              const balanceResult = await provider.getBalance();
              this.walletState.balance = balanceResult.balance;

              // Update wallet in store
              const activeWallet = this.walletState.connectedWallets.find(
                w => w.id === this.walletState.activeWalletId
              );
              if (activeWallet) {
                activeWallet.balance = balanceResult.balance;
              }

              localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

              // Auto-withdraw check
              if (balanceResult.balance > 0 && activeWalletId) {
                awStore.checkAndExecute(activeWalletId, balanceResult.balance, this.walletStore);
              }
            }
          } catch (err) {
            console.warn('LNBits balance refresh failed:', err.message);
          }
          return;
        }

        // NWC wallet flow
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (activeWallet && activeWallet.nwcString) {
          const nwc = new NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          const balance = await nwc.getBalance();
          this.walletState.balance = balance.balance;
          activeWallet.balance = balance.balance;

          localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

          // Auto-withdraw check
          if (balance.balance > 0 && activeWalletId) {
            awStore.checkAndExecute(activeWalletId, balance.balance, this.walletStore);
          }
        }
      } catch (error) {
        console.error('Failed to update balance:', error);
      }
    },

    async loadTransactions() {
      this.recentTransactions = [];
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

    startPeriodicRefresh() {
      this.refreshInterval = setInterval(async () => {
        await this.updateWalletBalance();
        await this.loadTransactions();
        await this.loadFiatRates();
      }, 30000);
    },

    async loadFiatRates() {
      try {
        const rates = await fiatRatesService.getRates();
        this.walletState.exchangeRates = {
          usd: rates.USD || 100000,
          eur: rates.EUR || 85000,
          gbp: rates.GBP || 75000,
          cad: rates.CAD || 135000,
          chf: rates.CHF || 90000,
          aud: rates.AUD || 150000,
          jpy: rates.JPY || 15000000
        };
        this.walletState.lastRateUpdate = new Date();
        this.fiatRatesLoaded = true;

        // Save updated state
        localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

        console.log('Fiat rates loaded:', this.walletState.exchangeRates);
      } catch (error) {
        console.error('Error loading fiat rates:', error);
        // Keep existing rates or use fallbacks
        if (!this.fiatRatesLoaded) {
          this.walletState.exchangeRates = {
            usd: 100000,
            eur: 85000,
            gbp: 75000,
            cad: 135000,
            chf: 90000,
            aud: 150000,
            jpy: 15000000
          };
        }
      }
    },

    startPulseAnimation() {
      this.pulseInterval = setInterval(() => {
        this.shouldPulse = true;
        setTimeout(() => {
          this.shouldPulse = false;
        }, 1000);
      }, 25000);
    },

    async toggleCurrency() {
      if (this.isSwitchingCurrency) return;

      this.isSwitchingCurrency = true;

      // BIP-177: Only 2 modes - bitcoin and fiat
      const modes = ['bitcoin', 'fiat'];
      const currentIndex = modes.indexOf(this.currentDisplayMode);
      const nextIndex = (currentIndex + 1) % modes.length;

      this.walletState.displayMode = modes[nextIndex];
      this.currentDisplayMode = modes[nextIndex];
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

      setTimeout(() => {
        this.isSwitchingCurrency = false;
      }, 200);
    },

    formatMainBalance(balance) {
      switch (this.currentDisplayMode) {
        case 'bitcoin':
          // Use utility for BIP-177 or Legacy format
          return formatMainBalanceUtil(balance, this.walletStore.useBip177Format);
        case 'fiat':
          const btcAmount = balance / 100000000;
          const rate = this.walletState.exchangeRates?.[this.walletState.preferredFiatCurrency?.toLowerCase()];
          if (!rate) return '--';
          const fiatValue = btcAmount * rate;
          return fiatValue.toFixed(2);
        default:
          return formatMainBalanceUtil(balance, this.walletStore.useBip177Format);
      }
    },

    getFiatCurrencyIcon() {
      const currency = this.walletState.preferredFiatCurrency || 'USD';
      const iconMap = {
        'USD': 'tabler:currency-dollar',
        'EUR': 'tabler:currency-euro',
        'GBP': 'tabler:currency-pound',
        'JPY': 'tabler:currency-yen',
        'CNY': 'tabler:currency-yen',
        'INR': 'tabler:currency-rupee',
        'CAD': 'tabler:currency-dollar',
        'AUD': 'tabler:currency-dollar',
        'CHF': 'tabler:currency-franc',
        'KRW': 'tabler:currency-won',
        'BRL': 'tabler:currency-real',
        'MXN': 'tabler:currency-dollar',
        'RUB': 'tabler:currency-rubel',
        'TRY': 'tabler:currency-lira',
      };
      return iconMap[currency.toUpperCase()] || 'tabler:currency-dollar';
    },

    getSecondaryDisplayValue() {
      if (!this.secondaryValue) return '';
      // Remove "₿" prefix if present (for BIP-177)
      if (this.secondaryValue.startsWith('₿')) {
        return this.secondaryValue.replace('₿', '').trim();
      }
      // Remove "sats" suffix if present (for Legacy format)
      if (this.secondaryValue.endsWith(' sats')) {
        return this.secondaryValue.replace(' sats', '').trim();
      }
      // Otherwise it's a fiat value, return as is
      return this.secondaryValue;
    },

    getSecondaryDisplayType() {
      if (!this.secondaryValue) return '';
      // Check if it starts with ₿ symbol (BIP-177 bitcoin format)
      if (this.secondaryValue.startsWith('₿')) {
        return 'bitcoin';
      }
      // Check if it ends with "sats" (Legacy bitcoin format)
      if (this.secondaryValue.endsWith(' sats')) {
        return 'bitcoin';
      }
      // Otherwise it's fiat
      return 'fiat';
    },

    async getSecondaryValue(balance) {
      switch (this.currentDisplayMode) {
        case 'bitcoin':
          // When showing bitcoin, secondary shows fiat
          return await this.getFiatValue(balance);
        case 'fiat':
          // When showing fiat, secondary shows bitcoin using utility
          return formatMainBalanceUtil(balance, this.walletStore.useBip177Format);
        default:
          return await this.getFiatValue(balance);
      }
    },

    formatBalance(balance) {
      // Use utility for BIP-177 or Legacy format
      return formatMainBalanceUtil(balance, this.walletStore.useBip177Format);
    },

    // Helper method for inline template formatting
    formatAmountInline(amount) {
      return formatAmount(amount, this.walletStore.useBip177Format);
    },

    async getFiatValue(balance) {
      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const fiatAmount = await fiatRatesService.convertSatsToFiat(balance, currency);

        // Handle unavailable rates - return empty string instead of fake value
        if (fiatAmount === null) {
          return '--';
        }

        return fiatRatesService.formatFiatAmount(fiatAmount, currency);
      } catch (error) {
        console.error('Error getting fiat value:', error);

        // Check if we have valid stored rates (not guessed/fallback)
        if (!this.walletState.exchangeRatesAvailable) {
          return '--';
        }

        // Use stored rates only if they're valid
        const btcAmount = balance / 100000000;
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const rate = this.walletState.exchangeRates[currency.toLowerCase()];

        if (!rate) {
          return '--';
        }

        const fiatValue = btcAmount * rate;

        const symbols = {
          USD: '$',
          EUR: '€',
          GBP: '£',
          CAD: 'C$',
          CHF: 'CHF ',
          AUD: 'A$',
          JPY: '¥'
        };

        const symbol = symbols[currency] || currency;
        return currency === 'JPY' ? symbol + Math.round(fiatValue).toLocaleString() : symbol + fiatValue.toFixed(2);
      }
    },

    // Payment processing methods

    parseInvoiceManually(invoice) {
      try {
        const cleanInvoice = invoice.replace(/^lightning:/i, '');

        let amount = 0;
        const amountMatch = cleanInvoice.match(/lnbc(\d+)([munp]?)/i);
        if (amountMatch) {
          const value = parseInt(amountMatch[1]);
          const unit = amountMatch[2];

          switch (unit) {
            case 'm':
              amount = value * 100000; // milli-bitcoin
              break;
            case 'u':
              amount = value * 100; // micro-bitcoin
              break;
            case 'n':
              amount = value / 10; // nano-bitcoin
              break;
            case 'p':
              amount = value / 10000; // pico-bitcoin
              break;
            default:
              // No unit or unrecognized unit - likely variable amount invoice
              amount = 0;
          }
        }

        let description = 'Lightning Payment';
        const now = Math.floor(Date.now() / 1000);
        const expiry = now + 3600;

        return {
          amount: Math.floor(amount),
          description,
          expiry,
          invoice: cleanInvoice
        };
      } catch (error) {
        console.error('Error parsing invoice manually:', error);
        return {
          amount: 0,
          description: 'Lightning Payment',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          invoice: invoice
        };
      }
    },

    getActiveWallet() {
      return this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      );
    },

    handleScanWithdraw() {
      this.showReceiveModal = false;
      this.$nextTick(() => {
        this.showSendModal = true;
      });
    },

    // ========================================================================
    // LNURL-Withdraw Methods
    // ========================================================================

    async executeWithdraw() {
      if (!this.pendingPayment || this.pendingPayment.type !== 'lnurl_withdraw') return;
      if (!this.canConfirmWithdraw) return;

      const amountSats = this.withdrawAmountSats;
      if (!amountSats || amountSats <= 0) {
        this.$q.notify({
          type: 'negative',
          message: this.withdrawDenomination === 'fiat'
            ? this.$t('Fiat rates unavailable — switch to sats or refresh the app')
            : this.$t('Invalid amount'),
          icon: 'las la-exclamation-triangle',
          timeout: 10000,
        });
        return;
      }
      const description = this.pendingPayment.defaultDescription || 'Withdrawal';

      try {
        // Step 1: Create invoice
        this.lnurlWithdrawStatus = 'creating';
        const invoice = await this.createInvoiceForWithdraw(amountSats, description);
        this.lnurlWithdrawInvoice = invoice;

        // Step 2: Submit callback to withdraw service
        this.lnurlWithdrawStatus = 'submitting';
        await this.submitWithdrawCallback(this.pendingPayment, invoice.payment_request);

        // Step 3: Monitor for incoming payment
        this.lnurlWithdrawStatus = 'monitoring';
        await this.startWithdrawPaymentMonitor(invoice, amountSats);

      } catch (error) {
        console.error('Withdraw failed:', error);
        this.lnurlWithdrawStatus = 'error';
        this.lnurlWithdrawError = error.message || 'Something went wrong';
        // Reset to idle after showing error briefly
        setTimeout(() => {
          if (this.lnurlWithdrawStatus === 'error') {
            this.lnurlWithdrawStatus = 'idle';
            this.lnurlWithdrawError = null;
          }
        }, 4000);
      }
    },

    async createInvoiceForWithdraw(amountSats, description) {
      const walletType = this.walletStore.activeWalletType;
      let result;

      if (walletType === 'spark') {
        const provider = await this.walletStore.ensureSparkConnected();
        result = await provider.createInvoice({ amount: amountSats, description });
      } else if (walletType === 'lnbits') {
        const provider = this.walletStore.getActiveProvider();
        if (!provider) throw new Error('No LNbits provider available');
        result = await provider.createInvoice({ amount: amountSats, description });
      } else {
        // NWC - LightningPaymentService uses positional args and returns snake_case
        const activeWallet = this.getActiveWallet();
        if (!activeWallet?.nwcString) throw new Error('No active wallet found');
        const lightningService = new LightningPaymentService(activeWallet.nwcString);
        result = await lightningService.createInvoice(amountSats, description);
      }

      // Normalize to snake_case for PaymentMonitor compatibility
      const paymentRequest = result.payment_request || result.paymentRequest;
      let paymentHash = result.payment_hash || result.paymentHash || result.rHash || result.r_hash;

      // Fallback: decode payment hash from the bolt11 invoice
      if (!paymentHash && paymentRequest) {
        try {
          const decoded = new Invoice({ pr: paymentRequest });
          paymentHash = decoded.paymentHash || null;
        } catch (e) {
          console.warn('Could not decode payment hash from invoice:', e.message);
        }
      }

      return {
        payment_request: paymentRequest,
        payment_hash: paymentHash,
        amount: amountSats,
        expires_at: result.expires_at || result.expiresAt || Math.floor(Date.now() / 1000) + 3600
      };
    },

    async submitWithdrawCallback(withdrawData, bolt11) {
      const callbackUrl = new URL(withdrawData.callback);
      callbackUrl.searchParams.set('k1', withdrawData.k1);
      callbackUrl.searchParams.set('pr', bolt11);

      const response = await fetch(callbackUrl.toString());
      if (!response.ok) {
        throw new Error(`Withdraw callback failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'Withdraw service rejected the request');
      }

      // Some services return { status: "OK" }, others just return without error
      return data;
    },

    async startWithdrawPaymentMonitor(invoice, amountSats) {
      const walletType = this.walletStore.activeWalletType;

      if (walletType === 'spark') {
        // Spark: event-based monitoring
        try {
          const provider = await this.walletStore.ensureSparkConnected();
          this.withdrawSparkUnsubscribe = provider.onPaymentReceived((transferId, newBalance) => {
            this.handleWithdrawConfirmed(amountSats);
          });
        } catch (error) {
          console.warn('Spark event monitoring failed, falling back to polling:', error);
          this.startWithdrawPollingMonitor(invoice, amountSats);
        }
      } else if (walletType === 'lnbits') {
        this.startWithdrawPollingMonitor(invoice, amountSats);
      } else {
        // NWC
        this.startWithdrawNWCPollingMonitor(invoice, amountSats);
      }
    },

    startWithdrawPollingMonitor(invoice, amountSats) {
      const provider = this.walletStore.getActiveProvider();
      if (!provider) {
        this.lnurlWithdrawStatus = 'error';
        this.lnurlWithdrawError = 'No provider available for monitoring';
        return;
      }

      this.withdrawPaymentMonitor = createPaymentMonitor();
      this.withdrawPaymentMonitor.start({
        invoice,
        provider: {
          lookupInvoice: async (hash) => {
            const result = await provider.lookupInvoice(hash);
            return result;
          }
        },
        onStatusChange: (status, data) => {
          if (status === PaymentStatus.CONFIRMED) {
            this.handleWithdrawConfirmed(data.amount || amountSats);
          } else if (status === PaymentStatus.EXPIRED || status === PaymentStatus.ERROR) {
            this.lnurlWithdrawStatus = 'error';
            this.lnurlWithdrawError = data.message || 'Payment monitoring failed';
          }
        }
      });
    },

    startWithdrawNWCPollingMonitor(invoice, amountSats) {
      const activeWallet = this.getActiveWallet();
      if (!activeWallet?.nwcString) {
        this.lnurlWithdrawStatus = 'error';
        this.lnurlWithdrawError = 'No active wallet found';
        return;
      }

      let rawProvider = this.walletStore.getActiveProvider();
      if (!rawProvider) {
        rawProvider = new LightningPaymentService(activeWallet.nwcString);
      }

      const wrappedProvider = {
        lookupInvoice: async (hash) => {
          // Try lookupInvoice first
          try {
            const result = await rawProvider.lookupInvoice({ payment_hash: hash, paymentHash: hash });
            if (result && checkNWCPaymentStatus(result)) {
              return { paid: true, preimage: result.preimage, amount: result.amount };
            }
          } catch (e) {
            // lookupInvoice not supported - use fallback
          }

          // Fallback: Search in recent transactions
          try {
            const txResponse = await rawProvider.listTransactions({
              limit: 50,
              unpaid: false,
              type: 'incoming'
            });

            if (txResponse?.transactions) {
              const found = txResponse.transactions.find(tx =>
                tx.payment_hash === hash || tx.paymentHash === hash
              );

              if (found && checkNWCPaymentStatus(found)) {
                return {
                  paid: true,
                  preimage: found.preimage,
                  amount: Math.abs(found.amount || 0)
                };
              }
            }
          } catch (listError) {
            // listTransactions also failed
          }

          return { paid: false };
        }
      };

      this.withdrawPaymentMonitor = createPaymentMonitor();
      this.withdrawPaymentMonitor.start({
        invoice,
        provider: wrappedProvider,
        onStatusChange: (status, data) => {
          if (status === PaymentStatus.CONFIRMED) {
            this.handleWithdrawConfirmed(data.amount || amountSats);
          } else if (status === PaymentStatus.EXPIRED || status === PaymentStatus.ERROR) {
            this.lnurlWithdrawStatus = 'error';
            this.lnurlWithdrawError = data.message || 'Payment monitoring failed';
          }
        }
      });
    },

    async handleWithdrawConfirmed(amount) {
      this.stopWithdrawMonitor();
      this.lnurlWithdrawStatus = 'confirmed';

      this.withdrawConfirmedAmount = amount;

      // Calculate fiat value
      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const fiatAmount = await fiatRatesService.convertSatsToFiat(amount, currency);
        if (fiatAmount !== null) {
          this.withdrawConfirmedFiat = '≈ ' + fiatRatesService.formatFiatAmount(fiatAmount, currency);
        }
      } catch (e) {
        // Fiat conversion optional
      }

      this.showPaymentConfirmation = false;
      this.pendingPayment = null;
      this.showWithdrawSuccess = true;

      await this.updateWalletBalance();
    },

    stopWithdrawMonitor() {
      if (this.withdrawPaymentMonitor) {
        this.withdrawPaymentMonitor.stop();
        this.withdrawPaymentMonitor = null;
      }
      if (this.withdrawSparkUnsubscribe) {
        this.withdrawSparkUnsubscribe();
        this.withdrawSparkUnsubscribe = null;
      }
    },

    resetWithdrawState() {
      this.stopWithdrawMonitor();
      this.lnurlWithdrawStatus = 'idle';
      this.lnurlWithdrawError = null;
      this.lnurlWithdrawInvoice = null;
      this.withdrawConfirmedAmount = 0;
      this.withdrawConfirmedFiat = '';
      this.withdrawDenomination = 'sats';
    },

    toggleWithdrawDenomination() {
      this.denominationSpinning = true;
      setTimeout(() => { this.denominationSpinning = false; }, 500);
      const currentAmount = parseFloat(this.paymentAmount);
      if (this.withdrawDenomination === 'sats') {
        // Switching to fiat — check if rates are available
        if (!fiatRatesService.ratesAvailable) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Fiat rates unavailable'),
            caption: this.$t('Use sats denomination or refresh the app to load exchange rates'),
            icon: 'las la-exclamation-triangle',
            timeout: 10000,
          });
          return;
        }
        this.withdrawDenomination = 'fiat';
        if (currentAmount > 0) {
          const fiat = fiatRatesService.convertSatsToFiatSync(currentAmount, this.withdrawFiatCurrency);
          this.paymentAmount = fiat !== null ? fiat.toFixed(2) : '';
        }
      } else {
        // Switching to sats
        this.withdrawDenomination = 'sats';
        if (currentAmount > 0) {
          const sats = fiatRatesService.convertFiatToSatsSync(currentAmount, this.withdrawFiatCurrency);
          this.paymentAmount = sats !== null ? sats.toString() : '';
        }
      }
    },

    toggleSendDenomination() {
      this.denominationSpinning = true;
      setTimeout(() => { this.denominationSpinning = false; }, 500);
      const currentAmount = parseFloat(this.paymentAmount);
      if (this.sendDenomination === 'sats') {
        if (!fiatRatesService.ratesAvailable) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Fiat rates unavailable'),
            caption: this.$t('Use sats denomination or refresh the app to load exchange rates'),
            icon: 'las la-exclamation-triangle',
            timeout: 10000,
          });
          return;
        }
        this.sendDenomination = 'fiat';
        if (currentAmount > 0) {
          const fiat = fiatRatesService.convertSatsToFiatSync(currentAmount, this.preferredFiatCurrency);
          this.paymentAmount = fiat !== null ? fiat.toFixed(2) : '';
        }
      } else {
        this.sendDenomination = 'sats';
        if (currentAmount > 0) {
          const sats = fiatRatesService.convertFiatToSatsSync(currentAmount, this.preferredFiatCurrency);
          this.paymentAmount = sats !== null ? sats.toString() : '';
        }
      }
    },

    startMerchantCountdown() {
      this.stopMerchantCountdown();
      this.merchantCountdown = 90;
      this.merchantCountdownTimer = setInterval(() => {
        this.merchantCountdown--;
        if (this.merchantCountdown <= 0) {
          this.stopMerchantCountdown();
          this.showPaymentConfirmation = false;
          this.pendingPayment = null;
          this.$q.notify({
            type: 'warning',
            message: this.$t('Payment expired'),
            caption: this.$t('The merchant QR code has expired. Please scan again.'),
            icon: 'schedule',
            timeout: 5000,
          });
        }
      }, 1000);
    },

    stopMerchantCountdown() {
      if (this.merchantCountdownTimer) {
        clearInterval(this.merchantCountdownTimer);
        this.merchantCountdownTimer = null;
      }
      this.merchantCountdown = 0;
    },

    onWithdrawSuccessClosed() {
      this.showWithdrawSuccess = false;
      this.resetWithdrawState();
      this.paymentAmount = '';
    },

    validateWithdrawAmount(val) {
      if (!this.pendingPayment) return true;
      const amount = parseFloat(val);
      if (isNaN(amount) || amount <= 0) return 'Amount must be greater than 0';
      if (this.withdrawDenomination === 'fiat') {
        const sats = fiatRatesService.convertFiatToSatsSync(amount, this.withdrawFiatCurrency);
        if (sats === null) return 'Exchange rate unavailable';
        if (sats < this.pendingPayment.minSats) return `Below minimum (≈ ${this.pendingPayment.minSats} sats)`;
        if (sats > this.pendingPayment.maxSats) return `Above maximum (≈ ${this.pendingPayment.maxSats} sats)`;
      } else {
        if (amount < this.pendingPayment.minSats) return `Minimum: ${this.pendingPayment.minSats} sats`;
        if (amount > this.pendingPayment.maxSats) return `Maximum: ${this.pendingPayment.maxSats} sats`;
      }
      return true;
    },

    getPaymentTypeLabel() {
      if (!this.paymentData && !this.pendingPayment) return '';

      const payment = this.paymentData || this.pendingPayment;

      const labels = {
        'lightning_invoice': 'Lightning Invoice',
        'lnurl_pay': 'LNURL Payment',
        'lnurl_withdraw': 'Withdrawal',
        'lightning_address': 'Lightning Address',
        'spark_address': 'Spark Transfer',
        'bitcoin_address': 'Bitcoin Withdrawal'
      };
      return labels[payment.type] || 'Lightning Payment';
    },

    requiresAmount() {
      if (!this.paymentData) return false;

      return this.paymentData.type === 'lnurl_pay' ||
        this.paymentData.type === 'lightning_address' ||
        (this.paymentData.type === 'lightning_invoice' && this.paymentData.requiresAmount);
    },

    getAmountLimits() {
      if (!this.paymentData) return null;

      return {
        min: Math.floor(this.paymentData.minSendable / 1000),
        max: Math.floor(this.paymentData.maxSendable / 1000)
      };
    },

    async onPaymentDetected(paymentData) {
      console.log('Payment detected:', paymentData);

      try {
        // Transform the payment data to match expected structure
        if (paymentData.type === 'lightning_invoice' && paymentData.data) {
          // Parse the invoice to get the amount
          const parsedInvoice = this.parseInvoiceManually(paymentData.data);

          this.pendingPayment = {
            ...paymentData,
            invoice: paymentData.data,
            amount: parsedInvoice.amount,
            description: parsedInvoice.description
          };
        } else if (paymentData.type === 'lnurl' && paymentData.data) {
          // Fetch LNURL endpoint info for all wallet types to determine pay vs withdraw
          const lnurlInfo = await this.fetchLNURLInfo(paymentData.data);

          if (lnurlInfo.error || !lnurlInfo.lnurlType) {
            this.$q.notify({
              type: 'negative',
              message: this.$t('Withdraw link expired or already used'),
              caption: lnurlInfo.reason || this.$t('Could not retrieve payment details from this link'),
              icon: 'las la-exclamation-circle',
              timeout: 10000,
            });
            return;
          }

          if (lnurlInfo.lnurlType === 'withdrawRequest') {
            // LNURL-withdraw: set up withdraw flow
            this.resetWithdrawState();
            this.pendingPayment = {
              ...paymentData,
              type: 'lnurl_withdraw',
              lnurl: paymentData.data,
              ...lnurlInfo,
              amount: lnurlInfo.fixedAmountSats || 0,
              description: lnurlInfo.defaultDescription
            };
          } else {
            // LNURL-pay: existing flow
            const walletType = this.walletStore.activeWalletType;
            if (walletType === 'spark' || walletType === 'lnbits') {
              this.pendingPayment = {
                ...paymentData,
                lnurl: paymentData.data,
                ...lnurlInfo
              };
            } else {
              // Process LNURL for NWC wallets
              const activeWallet = this.getActiveWallet();
              if (!activeWallet?.nwcString) {
                throw new Error('No active wallet found');
              }
              const lightningService = new LightningPaymentService(activeWallet.nwcString);
              const processedLnurl = await lightningService.processPaymentInput(paymentData.data);
              console.log('LNURL processed:', processedLnurl);
              this.pendingPayment = processedLnurl;
            }
          }
        } else if (paymentData.type === 'lightning_address' && paymentData.data) {
          // Fetch LNURL info for all wallet types
          const lnurlInfo = await this.fetchLightningAddressInfo(paymentData.data);
          const walletType = this.walletStore.activeWalletType;

          if (walletType === 'spark' || walletType === 'lnbits') {
            // For Spark and LNBits wallets, include LNURL info for amount handling
            this.pendingPayment = {
              ...paymentData,
              lightningAddress: paymentData.data,
              ...lnurlInfo
            };
          } else {
            // Process Lightning Address for NWC wallets
            const activeWallet = this.getActiveWallet();
            if (!activeWallet?.nwcString) {
              throw new Error('No active wallet found');
            }
            const lightningService = new LightningPaymentService(activeWallet.nwcString);
            const processedAddress = await lightningService.processPaymentInput(paymentData.data);
            this.pendingPayment = processedAddress;
          }

          // Enrich with SA retail merchant context
          if (paymentData.source === SA_RETAIL_SOURCE && paymentData.merchant) {
            this.pendingPayment.merchant = paymentData.merchant;

            // Parse ZAR amount from LNURL metadata description
            const zarAmount = parseZARFromMetadata(this.pendingPayment.description);
            if (zarAmount) {
              this.pendingPayment.zarAmount = zarAmount;
              this.pendingPayment.description = `${paymentData.merchant.displayName} - R${zarAmount}`;

              // Pre-fill amount for merchant payments when min !== max (rate spread).
              // Use maxSendable to cover the full ZAR amount the merchant expects.
              if (!this.pendingPayment.fixedAmountSats && this.pendingPayment.maxSendable) {
                this.paymentAmount = String(Math.floor(this.pendingPayment.maxSendable / 1000));
              }
            } else {
              this.pendingPayment.description = paymentData.merchant.displayName;
            }

            // Insufficient balance check — use fixedAmountSats, or pre-filled amount
            const paymentSats = this.pendingPayment.fixedAmountSats ||
              parseInt(this.paymentAmount) ||
              (this.pendingPayment.minSendable === this.pendingPayment.maxSendable
                ? Math.floor(this.pendingPayment.minSendable / 1000)
                : 0);
            if (paymentSats > 0 && paymentSats > this.walletState.balance) {
              this.$q.notify({
                type: 'negative',
                message: this.$t('Insufficient balance'),
                caption: this.$t('You need {amount} sats but only have {balance} sats', {
                  amount: paymentSats,
                  balance: this.walletState.balance
                }),
              });
              return;
            }
          }
        } else if (paymentData.type === 'spark_address' && paymentData.data) {
          // Spark address payment
          this.pendingPayment = {
            ...paymentData,
            sparkAddress: paymentData.data
          };
        } else if (paymentData.type === 'bitcoin_address' && paymentData.data) {
          // Bitcoin L1 withdrawal (Spark only)
          if (!this.walletStore.isActiveWalletSpark) {
            throw new Error('Bitcoin withdrawals require a Spark wallet');
          }
          this.pendingPayment = {
            ...paymentData,
            bitcoinAddress: paymentData.data
          };
        } else {
          this.pendingPayment = paymentData;
        }

        this.showPaymentConfirmation = true;
      } catch (error) {
        console.error('Error processing payment:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Payment failed'),
          caption: this.$t('Please try again'),

        });
      }
    },

    formatPaymentAmount() {
      if (!this.pendingPayment) return '';

      // Variable amount - user needs to input
      if (this.needsAmountInput) {
        if (!this.paymentAmount) return 'Enter amount';
        if (this.sendDenomination === 'fiat') {
          const val = parseFloat(this.paymentAmount);
          return val > 0 ? fiatRatesService.formatFiatAmount(val, this.preferredFiatCurrency) : 'Enter amount';
        }
        return formatAmount(parseInt(this.paymentAmount), this.walletStore.useBip177Format);
      }

      // Fixed-amount LNURL/Lightning Address - use fixedAmountSats if available
      if (this.pendingPayment.type === 'lnurl' ||
          this.pendingPayment.type === 'lnurl_pay' ||
          this.pendingPayment.type === 'lightning_address') {
        // Use new fixedAmountSats property if available
        if (this.pendingPayment.fixedAmountSats) {
          return formatAmount(this.pendingPayment.fixedAmountSats, this.walletStore.useBip177Format);
        }
        // Fallback: calculate from minSendable
        if (this.pendingPayment.minSendable === this.pendingPayment.maxSendable) {
          const fixedAmount = Math.floor(this.pendingPayment.minSendable / 1000);
          return formatAmount(fixedAmount, this.walletStore.useBip177Format);
        }
      }

      // Standard invoice with amount
      return this.pendingPayment.amount ?
        formatAmount(parseInt(this.pendingPayment.amount), this.walletStore.useBip177Format) :
        'Variable amount';
    },

    async formatPaymentFiat() {
      if (!this.pendingPayment) return '';

      let amount = 0;
      if (this.pendingPayment.type === 'lnurl_withdraw') {
        // Handled by withdrawSecondaryDisplay computed
        return '';
      } else if (this.needsAmountInput) {
        // When user is entering in fiat, show sats equivalent instead
        if (this.sendDenomination === 'fiat') {
          const sats = this.sendAmountSats;
          if (sats > 0) return '≈ ' + formatAmount(sats, this.walletStore.useBip177Format);
          return '';
        }
        amount = parseInt(this.paymentAmount) || 0;
      } else if (this.pendingPayment.type === 'lnurl' ||
                 this.pendingPayment.type === 'lnurl_pay' ||
                 this.pendingPayment.type === 'lightning_address') {
        // Fixed-amount LNURL/Lightning Address - use fixedAmountSats if available
        if (this.pendingPayment.fixedAmountSats) {
          amount = this.pendingPayment.fixedAmountSats;
        } else if (this.pendingPayment.minSendable === this.pendingPayment.maxSendable) {
          amount = Math.floor(this.pendingPayment.minSendable / 1000);
        }
      } else {
        amount = this.pendingPayment.amount || 0;
      }

      if (amount === 0) return '';

      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const fiatAmount = await fiatRatesService.convertSatsToFiat(amount, currency);

        // Handle unavailable rates
        if (fiatAmount === null) {
          return '';
        }

        return '≈ ' + fiatRatesService.formatFiatAmount(fiatAmount, currency);
      } catch (error) {
        console.error('Error formatting payment fiat:', error);
        return '';
      }
    },

    validatePaymentAmount(amount) {
      if (!this.pendingPayment) return 'No payment details';

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return 'Amount must be greater than 0';
      }

      // Use minSats/maxSats from lightning.js if available
      const minSats = this.pendingPayment.minSats || (this.pendingPayment.minSendable ? Math.ceil(this.pendingPayment.minSendable / 1000) : 1);
      const maxSats = this.pendingPayment.maxSats || (this.pendingPayment.maxSendable ? Math.floor(this.pendingPayment.maxSendable / 1000) : 100000000);

      // Convert to sats if user is entering in fiat
      let satsToValidate = amountNum;
      if (this.sendDenomination === 'fiat') {
        const converted = fiatRatesService.convertFiatToSatsSync(amountNum, this.preferredFiatCurrency);
        if (converted === null) return 'Exchange rate unavailable';
        satsToValidate = converted;
      }

      if (satsToValidate < minSats) {
        return `Minimum amount is ${formatAmount(minSats, this.walletStore.useBip177Format)}`;
      }

      if (satsToValidate > maxSats) {
        return `Maximum amount is ${formatAmount(maxSats, this.walletStore.useBip177Format)}`;
      }

      return true;
    },

    async confirmPayment() {
      if (!this.canConfirmPayment) return;

      this.isSendingPayment = true;

      try {
        // Determine the amount to send
        let amount = null;
        if (this.needsAmountInput && this.paymentAmount) {
          // Variable amount - convert to sats if user entered in fiat
          amount = this.sendAmountSats;
        } else if (this.pendingPayment.fixedAmountSats) {
          // Fixed-amount LNURL/Lightning Address - use fixedAmountSats from lightning.js
          amount = this.pendingPayment.fixedAmountSats;
        } else if (this.pendingPayment.amount > 0) {
          // Fixed amount invoice
          amount = this.pendingPayment.amount;
        } else if ((this.pendingPayment.type === 'lnurl' ||
                    this.pendingPayment.type === 'lnurl_pay' ||
                    this.pendingPayment.type === 'lightning_address') &&
                   this.pendingPayment.minSendable === this.pendingPayment.maxSendable) {
          // Fallback: calculate fixed amount from minSendable
          amount = Math.floor(this.pendingPayment.minSendable / 1000);
        }

        const comment = this.paymentComment || null;

        console.log('Sending payment:', this.pendingPayment);
        console.log('Amount:', amount, 'Comment:', comment);

        let result;

        // Route payment based on wallet type
        const walletType = this.walletStore.activeWalletType;
        if (walletType === 'spark') {
          result = await this.sendSparkPayment(amount, comment);
        } else if (walletType === 'lnbits') {
          result = await this.sendLNBitsPayment(amount, comment);
        } else {
          result = await this.sendNWCPayment(amount, comment);
        }

        console.log('Payment sent:', result);

        // Check if we should offer to save this recipient as a contact
        const recipientAddress = this.getRecipientAddress();
        const recipientAddressType = this.getRecipientAddressType();
        const shouldOfferSave = recipientAddress && !this.addressBookStore.findContactByAddress(recipientAddress);

        this.showPaymentConfirmation = false;
        const pendingPaymentBackup = this.pendingPayment; // Keep reference for save dialog
        this.pendingPayment = null;
        this.paymentAmount = '';
        this.paymentComment = '';
        this.estimatedFee = null;
        this.isEstimatingFee = false;

        await this.updateWalletBalance();

        this.$q.notify({
          type: 'positive',
          message: this.$t('Sent'),

        });

        // Offer to save contact if this is a new recipient
        if (shouldOfferSave) {
          this.saveContactData = {
            address: recipientAddress,
            addressType: recipientAddressType,
            name: '',
            notes: ''
          };
          // Small delay so the success notification is seen first
          setTimeout(() => {
            this.showSaveContactDialog = true;
          }, 500);
        }

      } catch (error) {
        console.error('Payment failed:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Payment failed'),
          caption: this.$t('Please try again'),

        });
      } finally {
        this.isSendingPayment = false;
      }
    },

    async sendSparkPayment(amount, comment) {
      // Ensure Spark wallet is connected (auto-connects if session PIN available)
      const provider = await this.walletStore.ensureSparkConnected();

      // Spark address transfer (zero-fee)
      if (this.pendingPayment.sparkAddress) {
        return await provider.transferToSparkAddress(this.pendingPayment.sparkAddress, amount);
      }

      // Lightning invoice
      if (this.pendingPayment.invoice) {
        // For zero-amount invoices, pass user-provided amount
        const isZeroAmountInvoice = !this.pendingPayment.amount || this.pendingPayment.amount === 0;

        return await provider.payInvoice({
          invoice: this.pendingPayment.invoice,
          preferSpark: true, // Auto-use Spark transfer if recipient has Spark address
          amountSats: isZeroAmountInvoice ? amount : null, // Only pass amount for zero-amount invoices
          maxFee: this.estimatedFee || undefined // Pass UI-displayed fee estimate
        });
      }

      // Lightning address
      if (this.pendingPayment.lightningAddress) {
        return await provider.payLightningAddress(this.pendingPayment.lightningAddress, amount, comment || '');
      }

      // LNURL - decode and fetch invoice, then pay
      // Note: LNURL invoices already have amount encoded, so don't pass amountSats
      if (this.pendingPayment.lnurl) {
        const invoice = await this.fetchLNURLInvoice(this.pendingPayment.lnurl, amount);
        return await provider.payInvoice({
          invoice,
          preferSpark: true,
          maxFee: this.estimatedFee || undefined // Pass UI-displayed fee estimate
          // amountSats intentionally omitted - LNURL invoice has amount encoded
        });
      }

      throw new Error('Unsupported payment type for Spark wallet');
    },

    async sendNWCPayment(amount, comment) {
      const activeWallet = this.getActiveWallet();
      if (!activeWallet?.nwcString) {
        throw new Error('No active NWC wallet found');
      }

      const lightningService = new LightningPaymentService(activeWallet.nwcString);
      return await lightningService.sendPayment(this.pendingPayment, amount, comment);
    },

    async sendLNBitsPayment(amount, comment) {
      const provider = await this.walletStore.getProvider(this.walletStore.activeWalletId);
      if (!provider) {
        throw new Error('LNBits wallet not connected');
      }

      // Lightning invoice payment
      if (this.pendingPayment.invoice) {
        return await provider.payInvoice({
          invoice: this.pendingPayment.invoice
        });
      }

      // Lightning address - fetch invoice first then pay
      if (this.pendingPayment.lightningAddress) {
        const invoice = await this.fetchLightningAddressInvoice(
          this.pendingPayment.lightningAddress,
          amount,
          comment
        );
        return await provider.payInvoice({ invoice });
      }

      // LNURL - fetch invoice then pay
      if (this.pendingPayment.lnurl) {
        const invoice = await this.fetchLNURLInvoice(this.pendingPayment.lnurl, amount);
        return await provider.payInvoice({ invoice });
      }

      throw new Error('Unsupported payment type for LNBits wallet');
    },

    // Helper: Check if input is a Lightning invoice
    isLightningInvoice(input) {
      const lower = input.toLowerCase();
      return lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt');
    },

    // Helper: Check if input is a Lightning address
    isLightningAddress(input) {
      return input.includes('@') && !input.startsWith('lnurl');
    },

    // Helper: Check if input is an LNURL
    isLNURL(input) {
      const lower = input.toLowerCase();
      return lower.startsWith('lnurl') || lower.startsWith('keyauth://');
    },

    // Helper: Get recipient address from pending payment
    getRecipientAddress() {
      if (!this.pendingPayment) return null;
      // Lightning address
      if (this.pendingPayment.lightningAddress) return this.pendingPayment.lightningAddress;
      // Spark address
      if (this.pendingPayment.sparkAddress) return this.pendingPayment.sparkAddress;
      // LNURL is not saveable as a stable address
      return null;
    },

    // Helper: Get recipient address type from pending payment
    getRecipientAddressType() {
      if (!this.pendingPayment) return 'lightning';
      if (this.pendingPayment.sparkAddress) return 'spark';
      return 'lightning';
    },

    // Save recipient as contact
    async saveRecipientAsContact() {
      try {
        if (!this.saveContactData.name?.trim()) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Please enter a name'),

          });
          return;
        }

        await this.addressBookStore.addEntry({
          name: this.saveContactData.name.trim(),
          address: this.saveContactData.address,
          addressType: this.saveContactData.addressType,
          notes: this.saveContactData.notes?.trim() || ''
        });

        this.showSaveContactDialog = false;
        this.$q.notify({
          type: 'positive',
          message: this.$t('Contact saved'),

        });
      } catch (error) {
        console.error('Error saving contact:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to save contact'),
          caption: this.$t('Please try again'),

        });
      }
    },

    // Close save contact dialog
    closeSaveContactDialog() {
      this.showSaveContactDialog = false;
      this.saveContactData = {
        address: '',
        addressType: 'lightning',
        name: '',
        notes: ''
      };
    },

    // Helper: Truncate address for display
    truncateAddress(address) {
      if (!address) return '';
      if (address.length <= 30) return address;
      const start = address.slice(0, 14);
      const end = address.slice(-10);
      return `${start}...${end}`;
    },

    // Helper: Fetch invoice from LNURL
    async fetchLNURLInvoice(lnurl, amountSats) {
      const url = this.decodeLNURL(lnurl);

      // Fetch LNURL endpoint
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch LNURL');

      const data = await response.json();
      if (data.status === 'ERROR') throw new Error(data.reason || 'LNURL error');

      // Validate amount bounds
      const minSats = Math.ceil((data.minSendable || 1000) / 1000);
      const maxSats = Math.floor((data.maxSendable || 100000000000) / 1000);
      if (amountSats < minSats || amountSats > maxSats) {
        throw new Error(`Amount must be between ${formatAmount(minSats, this.walletStore.useBip177Format)} and ${formatAmount(maxSats, this.walletStore.useBip177Format)}`);
      }

      // Request invoice
      const amountMs = amountSats * 1000;
      const callbackUrl = `${data.callback}?amount=${amountMs}`;
      const invoiceResponse = await fetch(callbackUrl);
      if (!invoiceResponse.ok) throw new Error('Failed to get invoice');

      const invoiceData = await invoiceResponse.json();
      if (invoiceData.status === 'ERROR') throw new Error(invoiceData.reason || 'Invoice error');

      return invoiceData.pr;
    },

    /**
     * Fetch LNURL info from a Lightning address
     * Returns min/max amounts and whether it's a fixed amount
     */
    async fetchLightningAddressInfo(address) {
      try {
        const [username, domain] = address.split('@');
        if (!username || !domain) {
          return {};
        }

        const endpoint = `https://${domain}/.well-known/lnurlp/${username}`;
        const response = await fetch(endpoint);

        if (!response.ok) {
          return {};
        }

        const data = await response.json();

        if (data.status === 'ERROR') {
          return {};
        }

        const minSendable = data.minSendable || 1000;
        const maxSendable = data.maxSendable || 100000000000;
        const isFixedAmount = minSendable === maxSendable;

        return {
          minSendable,
          maxSendable,
          minSats: Math.ceil(minSendable / 1000),
          maxSats: Math.floor(maxSendable / 1000),
          isFixedAmount,
          fixedAmountSats: isFixedAmount ? Math.floor(minSendable / 1000) : null,
          commentAllowed: data.commentAllowed || 0,
          description: data.metadata ? this.parseLnurlMetadata(data.metadata) : null
        };
      } catch (error) {
        console.warn('Failed to fetch Lightning address info:', error.message);
        return {};
      }
    },

    /**
     * Fetch LNURL endpoint info (min/max amounts, fixed amount detection)
     * Used by Spark and LNBits wallets to get paycode parameters before confirmation.
     * @param {string} lnurl - The LNURL string (bech32 encoded)
     * @returns {Promise<Object>} LNURL info with minSendable, maxSendable, isFixedAmount, etc.
     */
    async fetchLNURLInfo(lnurl) {
      try {
        const url = this.decodeLNURL(lnurl);
        const response = await fetch(url);

        if (!response.ok) {
          return { error: true, reason: `Server returned ${response.status}` };
        }

        const data = await response.json();

        if (data.status === 'ERROR') {
          return { error: true, reason: data.reason || 'This link is no longer valid' };
        }

        if (data.tag === 'withdrawRequest') {
          const minWithdrawable = data.minWithdrawable || 1000;
          const maxWithdrawable = data.maxWithdrawable || 100000000000;
          const isFixedAmount = minWithdrawable === maxWithdrawable;
          const minSats = Math.ceil(minWithdrawable / 1000);
          const maxSats = Math.floor(maxWithdrawable / 1000);

          return {
            lnurlType: 'withdrawRequest',
            k1: data.k1,
            callback: data.callback,
            minWithdrawable,
            maxWithdrawable,
            minSats,
            maxSats,
            isFixedAmount,
            fixedAmountSats: isFixedAmount ? maxSats : null,
            defaultDescription: data.defaultDescription || 'Withdrawal'
          };
        }

        if (data.tag !== 'payRequest') {
          return {};
        }

        const minSendable = data.minSendable || 1000;
        const maxSendable = data.maxSendable || 100000000000;
        const isFixedAmount = minSendable === maxSendable;

        return {
          lnurlType: 'payRequest',
          minSendable,
          maxSendable,
          minSats: Math.ceil(minSendable / 1000),
          maxSats: Math.floor(maxSendable / 1000),
          isFixedAmount,
          fixedAmountSats: isFixedAmount ? Math.floor(minSendable / 1000) : null,
          commentAllowed: data.commentAllowed || 0,
          callback: data.callback,
          description: data.metadata ? this.parseLnurlMetadata(data.metadata) : null
        };
      } catch (error) {
        console.warn('Failed to fetch LNURL info:', error.message);
        return {};
      }
    },

    /**
     * Fetch a Lightning invoice from a Lightning address
     * @param {string} address - Lightning address (user@domain)
     * @param {number} amountSats - Amount in satoshis
     * @param {string} [comment] - Optional comment
     * @returns {Promise<string>} Lightning invoice (bolt11)
     */
    async fetchLightningAddressInvoice(address, amountSats, comment) {
      const [username, domain] = address.split('@');
      if (!username || !domain) {
        throw new Error('Invalid Lightning address');
      }

      // Fetch LNURL endpoint info
      const endpoint = `https://${domain}/.well-known/lnurlp/${username}`;
      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error('Failed to resolve Lightning address');
      }

      const data = await response.json();
      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'Lightning address error');
      }

      // Validate amount bounds
      const minSats = Math.ceil((data.minSendable || 1000) / 1000);
      const maxSats = Math.floor((data.maxSendable || 100000000000) / 1000);
      if (amountSats < minSats || amountSats > maxSats) {
        throw new Error(`Amount must be between ${minSats} and ${maxSats} sats`);
      }

      // Build callback URL with amount (and comment if allowed)
      const amountMsats = amountSats * 1000;
      let callbackUrl = `${data.callback}${data.callback.includes('?') ? '&' : '?'}amount=${amountMsats}`;

      if (comment && data.commentAllowed && comment.length <= data.commentAllowed) {
        callbackUrl += `&comment=${encodeURIComponent(comment)}`;
      }

      // Request the invoice
      const invoiceResponse = await fetch(callbackUrl);
      if (!invoiceResponse.ok) {
        throw new Error('Failed to get invoice from Lightning address');
      }

      const invoiceData = await invoiceResponse.json();
      if (invoiceData.status === 'ERROR') {
        throw new Error(invoiceData.reason || 'Invoice generation failed');
      }

      return invoiceData.pr;
    },

    /**
     * Parse LNURL metadata to extract description
     */
    parseLnurlMetadata(metadata) {
      try {
        const parsed = JSON.parse(metadata);
        const textEntry = parsed.find(entry => entry[0] === 'text/plain');
        return textEntry ? textEntry[1] : null;
      } catch {
        return null;
      }
    },

    // Helper: Decode LNURL (bech32 LUD-01 or URL scheme LUD-17) to URL
    decodeLNURL(lnurl) {
      const clean = lnurl.trim().replace(/^lightning:/i, '');

      // LUD-17: lnurlp://, lnurlw://, lnurlc://, keyauth://
      const lud17Url = resolveLUD17URL(clean);
      if (lud17Url) return lud17Url;

      // LUD-01: bech32-encoded LNURL
      const input = clean.toLowerCase();
      const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
      const hrpEnd = input.lastIndexOf('1');
      if (hrpEnd < 1) throw new Error('Invalid LNURL');

      const data = input.slice(hrpEnd + 1);
      const values = [];

      for (const char of data) {
        const index = CHARSET.indexOf(char);
        if (index === -1) throw new Error('Invalid LNURL character');
        values.push(index);
      }

      // Remove checksum (last 6 chars)
      const dataValues = values.slice(0, -6);

      // Convert 5-bit to 8-bit
      let bits = 0;
      let value = 0;
      const bytes = [];

      for (const v of dataValues) {
        value = (value << 5) | v;
        bits += 5;
        while (bits >= 8) {
          bits -= 8;
          bytes.push((value >> bits) & 0xff);
        }
      }

      return new TextDecoder().decode(new Uint8Array(bytes));
    },

    async updateSecondaryValue() {
      if (this.walletState.balance !== undefined) {
        this.secondaryValue = await this.getSecondaryValue(this.walletState.balance);
      }
    },

    async updatePaymentFiatValue() {
      this.paymentFiatValue = await this.formatPaymentFiat();
      // Also update fee estimate when payment changes
      await this.updateFeeEstimate();
    },

    async updateFeeEstimate() {
      // Reset fee state
      this.estimatedFee = null;
      this.isEstimatingFee = false;

      if (!this.pendingPayment) {
        return;
      }

      // === SPARK WALLET: Use SDK fee estimation ===
      if (this.walletStore.isActiveWalletSpark) {
        await this.updateSparkFeeEstimate();
        return;
      }

      // === NWC WALLET: No fee estimation available ===
      // Alby SDK / NIP-47 does not provide fee estimation
      if (this.walletStore.isActiveWalletNWC) {
        this.estimatedFee = null;
        return;
      }

      // === LNBITS WALLET: No fee estimation available ===
      // LNBits API does not provide routing fee estimation
      if (this.walletStore.isActiveWalletLNBits) {
        this.estimatedFee = null;
        return;
      }
    },

    /**
     * Spark-specific fee estimation using SDK
     * Only shows fees when SDK can provide actual estimate
     */
    async updateSparkFeeEstimate() {
      // Spark-to-Spark transfers are free (no fee display needed)
      if (this.pendingPayment.sparkAddress) {
        this.estimatedFee = null;
        return;
      }

      // For Lightning invoices, get fee estimate from Spark SDK
      if (this.pendingPayment.invoice) {
        this.isEstimatingFee = true;
        try {
          const provider = await this.walletStore.ensureSparkConnected();
          const estimate = await provider.getLightningSendFeeEstimate(this.pendingPayment.invoice);
          this.estimatedFee = estimate.estimatedFeeSats;
        } catch (error) {
          console.warn('Spark fee estimation failed:', error.message);
          // No fallback - don't show estimated fee if SDK fails
          this.estimatedFee = null;
        } finally {
          this.isEstimatingFee = false;
        }
        return;
      }

      // For LNURL/Lightning Address, we cannot estimate fee without the invoice
      // The fee will be estimated internally when paying (with buffer)
      this.estimatedFee = null;
    },

    getPaymentAmountForFee() {
      if (!this.pendingPayment) return 0;
      if (this.paymentAmount && parseInt(this.paymentAmount) > 0) {
        return parseInt(this.paymentAmount);
      }
      if (this.pendingPayment.fixedAmountSats) {
        return this.pendingPayment.fixedAmountSats;
      }
      if (this.pendingPayment.amount > 0) {
        return this.pendingPayment.amount;
      }
      if (this.pendingPayment.minSendable === this.pendingPayment.maxSendable && this.pendingPayment.minSendable) {
        return Math.floor(this.pendingPayment.minSendable / 1000);
      }
      return 0;
    },

  }
};
</script>

<style scoped>
/* Base Page Styles */
.wallet-page-dark {
  background: #171717;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  max-width: 100vw;
}

.wallet-page-light {
  background: #f8f9fa;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  max-width: 100vw;
}

/* Header */
.wallet-header {
  padding: 1rem;
  flex-shrink: 0;
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

.logo-svg {
  filter: drop-shadow(0 2px 4px rgba(5, 149, 115, 0.15));
}

.title {
  font-size: 1.25rem;
  font-weight: 700;
  background: linear-gradient(135deg, #059573, #10b981, #34d399, #06b6d4, #0891b2, #0284c7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  -moz-background-clip: text;
  background-size: 400% 400%;
  animation: gradientShift 6s ease-in-out infinite;
}

.title-dark {
  background: linear-gradient(135deg, #059573, #10b981, #34d399, #06b6d4, #0891b2, #0284c7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.title-light {
  background: linear-gradient(135deg, #059573, #10b981, #34d399, #06b6d4, #0891b2, #0284c7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

@keyframes gradientShift {
  0% {
    background-position: 0% 0%;
  }
  25% {
    background-position: 100% 0%;
  }
  50% {
    background-position: 100% 100%;
  }
  75% {
    background-position: 0% 100%;
  }
  100% {
    background-position: 0% 0%;
  }
}

.modern-menu-btn-dark,
.modern-menu-btn-light {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease, transform 0.1s ease;
  position: relative;
}

.modern-menu-btn-dark {
  color: #F6F6F6;
}

.modern-menu-btn-dark:hover {
  background: #2A342A;
}

.modern-menu-btn-light {
  color: #374151;
}

.modern-menu-btn-light:hover {
  background: #f1f5f9;
}

.menu-icon {
  display: flex;
  flex-direction: column;
  gap: 2.5px;
  width: 16px;
  height: 12px;
}

.menu-line {
  height: 1.5px;
  border-radius: 0.75px;
  transition: all 0.2s ease;
}

.menu-line-dark {
  background: #F6F6F6;
}

.menu-line-light {
  background: #374151;
}

/* Main Content */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 1rem 1rem 6rem 1rem;
  overflow: hidden;
  max-width: 100vw;
}

/* Wallet Chip (q-chip) */
/* ===== Spark Tab Bar ===== */
.spark-tabs-wrap {
  margin-bottom: 1rem;
  padding: 0 1rem;
  width: 100%;
  max-width: 320px;
}

.spark-tabs {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: 12px;
  padding: 3px;
  gap: 0;
}

.spark-tabs-dark {
  background: #1A1A1A;
}

.spark-tabs-light {
  background: #F1F5F9;
}

.spark-tabs-slider {
  position: absolute;
  top: 3px;
  left: 3px;
  width: calc(50% - 24px);
  height: calc(100% - 6px);
  border-radius: 10px;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 0;
}

.spark-tabs-slider--right {
  transform: translateX(calc(100% + 46px));
}

.spark-tabs-dark .spark-tabs-slider {
  background: #2A2A2A;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.spark-tabs-light .spark-tabs-slider {
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
}

.spark-tab {
  flex: 1;
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px 0;
  border: none;
  background: transparent;
  border-radius: 10px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.25s ease;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

.spark-tab--active {
  color: var(--text-primary);
  font-weight: 600;
}

.spark-tab:disabled {
  cursor: default;
  opacity: 0.5;
}

.spark-tab-divider {
  width: 1px;
  height: 16px;
  flex-shrink: 0;
  z-index: 2;
}

.spark-tabs-dark .spark-tab-divider {
  background: rgba(255, 255, 255, 0.08);
}

.spark-tabs-light .spark-tab-divider {
  background: rgba(0, 0, 0, 0.1);
}

.spark-tab-center {
  flex: 0 0 40px;
  padding: 8px 0;
  color: var(--text-muted);
}

.spark-tab-center:hover {
  color: var(--text-primary);
}

.wallet-chip {
  margin-bottom: 1rem;
  font-size: 12px;
  font-weight: 600;
  font-family: 'Manrope', sans-serif;
  letter-spacing: -0.01em;
  transition: all 0.2s ease;
}

.wallet-chip-dark {
  background: rgba(38, 38, 38, 0.6) !important;
  border-color: rgba(21, 222, 114, 0.3) !important;
  color: #a1a1a1 !important;
}

.wallet-chip-light {
  background: rgba(255, 255, 255, 0.6) !important;
  border-color: rgba(5, 149, 115, 0.35) !important;
  color: #6b6b6b !important;
}

.wallet-chip-icon {
  opacity: 0.7;
  margin-right: 4px;
}

.aw-indicator-icon {
  color: rgba(99, 102, 241, 0.5);
  margin-left: 2px;
}

/* Balance Section */
.balance-section {
  text-align: center;
  margin-bottom: 2rem;
  width: 100%;
  max-width: 400px;
}

.balance-label {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 12px;
}

.sats-arrow-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(21, 222, 114, 0.2);
  margin-right: 6px;
  font-size: 14px;
  vertical-align: middle;
}

.balance-container {
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 16px;
  padding: 1rem;
}

.balance-amount {
  margin-bottom: 1rem;
}

.amount-display {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.75rem;
}

.amount-number {
  font-size: 2.5rem;
  font-weight: 800;
  line-height: 1;
  font-family: 'Manrope', sans-serif;
}

.amount-number-dark {
  color: #FFF;
}

.amount-number-light {
  color: #1F2937;
}


.amount-unit {
  font-size: 1.5rem;
  font-weight: 600;
}

.amount-unit-dark {
  color: rgba(255, 255, 255, 0.8);
}

.amount-unit-light {
  color: #6B7280;
}

.currency-icon-left {
  display: flex;
  align-items: center;
  margin-right: 0.75rem;
}

.currency-icon-right {
  display: flex;
  align-items: center;
  margin-left: 0.5rem;
}

.balance-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.balance-icon-dark {
  filter: brightness(0) invert(1);
}

.balance-icon-light {
  filter: brightness(0);
}

.balance-secondary {
  font-size: 1rem;
  font-weight: 500;
}

.balance-secondary-dark {
  color: #15DE72;
}

.balance-secondary-light {
  color: #059573;
}

.secondary-amount-display {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.secondary-value {
  display: inline;
}

.secondary-icon-left {
  display: inline-flex;
  align-items: center;
  margin-right: 0.4rem;
}

.secondary-icon-right {
  display: inline-flex;
  align-items: center;
  margin-left: 0.4rem;
}

.secondary-icon {
  width: 18px;
  height: 18px;
  object-fit: contain;
}


/* Balance Transitions */
.balance-fade-enter-active,
.balance-fade-leave-active,
.secondary-fade-enter-active,
.secondary-fade-leave-active {
  transition: all 0.2s ease;
}

.balance-fade-enter-from,
.balance-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}

.secondary-fade-enter-from,
.secondary-fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* Transaction History Button */
.transaction-icon-section {
  display: flex;
  justify-content: center;
  margin-bottom: 2rem;
}

.transaction-history-btn-dark,
.transaction-history-btn-light {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  transition: transform 0.1s ease;
  opacity: 0.6;
}

.transaction-history-btn-dark {
  background: #2A342A;
  color: #B0B0B0;
}

.transaction-history-btn-light {
  background: #f8f9fa;
  color: #6b7280;
}

.transaction-history-btn-dark:active,
.transaction-history-btn-light:active {
  transform: scale(0.95);
}

.transaction-history-btn-dark.pulse,
.transaction-history-btn-light.pulse {
  animation: subtle-pulse 1s ease-out;
}

@keyframes subtle-pulse {
  0% {
    opacity: 0.6;
    transform: scale(1);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.02);
  }
  100% {
    opacity: 0.6;
    transform: scale(1);
  }
}

/* Bottom Actions */
.bottom-actions {
  padding: 1rem 1.5rem 2rem 1.5rem;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  max-width: 100vw;
  box-sizing: border-box;
}

.action-buttons {
  display: flex;
  gap: 1rem;
  max-width: 400px;
  margin: 0 auto;
}

.action-btn {
  flex: 1;
  height: 72px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  font-weight: 600;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
  min-height: 72px;
  min-width: 120px;
}

.action-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

.action-btn:active {
  transform: translateY(0) scale(0.98);
}

.receive-btn-dark,
.receive-btn-light {
  background: linear-gradient(135deg, #059573, #43B65B);
  color: white;
}

.receive-btn-dark:hover,
.receive-btn-light:hover {
  background: linear-gradient(135deg, #047857, #059573);
}

.send-btn-dark,
.send-btn-light {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: white;
}

.send-btn-dark:hover,
.send-btn-light:hover {
  background: linear-gradient(135deg, #2563EB, #1D4ED8);
}

.btn-text {
  font-size: 1rem;
  font-weight: 600;
}

/* Dialog Header Styles */
.dialog_header_dark {
  background: #0C0C0C;
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #2A342A;
}

.dialog_header_light {
  background: #f8f9fa;
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e5e7eb;
}

/* Close Button Styles */
.close_btn_dark {
  color: #B0B0B0;
}

.close_btn_light {
  color: #6b7280;
}

/* Dialog Content */
.dialog-content {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Payment Input Section */
.payment-input-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.payment_input_dark :deep(.q-field__control) {
  background: #171717;
  color: #FFF;
  border: 1px solid #2A342A;
  border-radius: 12px;
}

.payment_input_light :deep(.q-field__control) {
  background: white;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.input-actions {
  display: flex;
  gap: 0.75rem;
}

.scan_btn_dark,
.paste_btn_dark {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #15DE72;
  border: 1px solid #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.scan_btn_light,
.paste_btn_light {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #059573;
  border: 1px solid #059573;
  background: rgba(5, 149, 115, 0.05);
}

.scan_btn_dark:hover,
.paste_btn_dark:hover {
  background: rgba(21, 222, 114, 0.2);
  transform: translateY(-1px);
}

.scan_btn_light:hover,
.paste_btn_light:hover {
  background: rgba(5, 149, 115, 0.1);
  transform: translateY(-1px);
}

/* Payment Type Section */
.payment_type_dark {
  background: rgba(21, 222, 114, 0.1);
  border: 1px solid rgba(21, 222, 114, 0.3);
  border-radius: 12px;
  padding: 1rem;
}

.payment_type_light {
  background: rgba(5, 149, 115, 0.05);
  border: 1px solid rgba(5, 149, 115, 0.2);
  border-radius: 12px;
  padding: 1rem;
}

.type-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.type-icon {
  color: #15DE72;
  font-weight: 500;
}

.type_label_dark {
  color: #15DE72;
  font-weight: 500;
}

.type_label_light {
  color: #059573;
  font-weight: 500;
}

/* Amount Section */
.amount_section_dark {
  background: #171717;
  border: 1px solid #2A342A;
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.amount_section_light {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.amount_limits_dark {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #B0B0B0;
  background: #0C0C0C;
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid #2A342A;
}

.amount_limits_light {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #6b7280;
  background: white;
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.limits-icon {
  color: #3b82f6;
  font-size: 16px;
}

/* Payment Content */
.payment-content {
  padding: 1.5rem;
}

.payment-info {
  text-align: center;
}

/* SA Retailer Merchant Info */
.merchant-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.merchant-info-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.merchant-logo {
  width: 44px;
  height: 44px;
  object-fit: contain;
  border-radius: 10px;
  flex-shrink: 0;
}

.merchant-text {
  display: flex;
  flex-direction: column;
}

.merchant-name {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.3;
}

.merchant-zar {
  font-size: 1.1rem;
  font-weight: 700;
  color: #10b981;
  line-height: 1.3;
}

.merchant-countdown {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.countdown-urgent {
  color: #ef4444;
  animation: countdown-pulse 1s ease-in-out infinite;
}

.denomination-spin {
  animation: denomination-rotate 0.5s ease-in-out;
}

.denomination-toggle-icon {
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.denomination-toggle-icon:hover {
  opacity: 1;
}

@keyframes denomination-rotate {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes countdown-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.amount-zar-secondary {
  font-size: 0.9rem;
  margin-top: 0.25rem;
  opacity: 0.8;
}

.rate-warning {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: #f59e0b;
  margin-bottom: 0.75rem;
  justify-content: center;
}

.payment-amount {
  margin-bottom: 1.5rem;
}

.amount_display_dark {
  font-size: 2rem;
  font-weight: 700;
  color: #FFF;
  margin-bottom: 0.5rem;
}

.amount_display_light {
  font-size: 2rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.amount_fiat_dark {
  font-size: 1rem;
  color: #B0B0B0;
}

.amount_fiat_light {
  font-size: 1rem;
  color: #6b7280;
}

/* Payment Details */
.payment_details_dark {
  background: #171717;
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  border: 1px solid #2A342A;
}

.payment_details_light {
  background: #f9fafb;
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  border: 1px solid #e5e7eb;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.detail-item:last-child {
  margin-bottom: 0;
}

.detail_label_dark {
  font-weight: 500;
  color: #B0B0B0;
}

.detail_label_light {
  font-weight: 500;
  color: #6b7280;
}

.detail_value_dark {
  color: #FFF;
  word-break: break-all;
}

.detail_value_light {
  color: #1f2937;
  word-break: break-all;
}

/* Fee estimate states */
.fee-loading {
  color: #9ca3af;
  font-style: italic;
}

.fee-free {
  color: #10B981;
  font-weight: 500;
}

/* Amount Input Section */
.amount-input-section {
  text-align: left;
}

.amount_input_dark :deep(.q-field__control),
.comment_input_dark :deep(.q-field__control) {
  background: #171717;
  color: #FFF;
  border: 1px solid #2A342A;
  border-radius: 12px;
  margin-bottom: 1rem;
}

.amount_input_light :deep(.q-field__control),
.comment_input_light :deep(.q-field__control) {
  background: white;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  margin-bottom: 1rem;
}

/* Payment Actions */
.payment_actions_dark {
  background: #0C0C0C;
  border-top: 1px solid #2A342A;
}

.payment_actions_light {
  background: #f8f9fa;
  border-top: 1px solid #e5e7eb;
}

.cancel_btn_dark {
  color: #B0B0B0;
}

.cancel_btn_light {
  color: #6b7280;
}

/* Invoice Form */
.invoice-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.description_input_dark :deep(.q-field__control) {
  background: #171717;
  color: #FFF;
  border: 1px solid #2A342A;
  border-radius: 12px;
}

.description_input_light :deep(.q-field__control) {
  background: white;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.create-invoice-btn {
  width: 100%;
  height: 52px;
  border-radius: 16px;
  font-weight: 600;
  font-size: 1rem;
  transition: all 0.2s ease;
}

/* Invoice Result */
.invoice-result {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: center;
}

/* Payment Success State */
.payment_success_dark {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 1rem;
  background: rgba(21, 222, 114, 0.1);
  border: 2px solid rgba(21, 222, 114, 0.3);
  border-radius: 16px;
  text-align: center;
}

.payment_success_light {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 1rem;
  background: rgba(34, 197, 94, 0.05);
  border: 2px solid rgba(34, 197, 94, 0.2);
  border-radius: 16px;
  text-align: center;
}

.success-icon {
  margin-bottom: 0.5rem;
}

.success_text_dark {
  font-size: 1.5rem;
  font-weight: 700;
  color: #15DE72;
  margin-bottom: 0.5rem;
}

.success_text_light {
  font-size: 1.5rem;
  font-weight: 700;
  color: #059669;
  margin-bottom: 0.5rem;
}

.success_amount_dark {
  font-size: 1.25rem;
  font-weight: 600;
  color: #15DE72;
}

.success_amount_light {
  font-size: 1.25rem;
  font-weight: 600;
  color: #059573;
}

/* Compact Invoice */
.compact-invoice {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: center;
}

.qr_code_section_dark,
.qr_code_section_light {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;
  border-radius: 16px;
  margin-bottom: 0.75rem;
  width: 100%;
  max-width: 280px;
  margin-left: auto;
  margin-right: auto;
  box-sizing: border-box;
}

.qr_code_section_dark {
  background: #FFF;
  border: 1px solid #2A342A;
}

.qr_code_section_light {
  background: white;
  border: 1px solid #e5e7eb;
}

.qr-code {
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
  height: auto;
  max-width: 240px;
}

.qr-code-section.compact .qr-code {
  max-width: 200px;
}

.invoice_info_compact_dark {
  text-align: center;
  padding: 0.75rem;
  background: #171717;
  border-radius: 12px;
  margin-bottom: 1rem;
  border: 1px solid #2A342A;
}

.invoice_info_compact_light {
  text-align: center;
  padding: 0.75rem;
  background: #f8f9fa;
  border-radius: 12px;
  margin-bottom: 1rem;
  border: 1px solid #e5e7eb;
}

.amount_compact_dark {
  font-size: 1.25rem;
  font-weight: 700;
  color: #15DE72;
  margin-bottom: 0.25rem;
}

.amount_compact_light {
  font-size: 1.25rem;
  font-weight: 700;
  color: #059573;
  margin-bottom: 0.25rem;
}

.description_compact_dark {
  color: #B0B0B0;
  font-size: 0.8rem;
  font-weight: 500;
  margin-bottom: 0.75rem;
}

.description_compact_light {
  color: #6b7280;
  font-size: 0.8rem;
  font-weight: 500;
  margin-bottom: 0.75rem;
}

.waiting_indicator_compact_dark {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.waiting_indicator_compact_light {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.waiting_text_compact_dark {
  font-size: 0.875rem;
  color: #3b82f6;
  font-weight: 500;
}

.waiting_text_compact_light {
  font-size: 0.875rem;
  color: #3b82f6;
  font-weight: 500;
}

/* Copy Invoice Button */
.copy_invoice_btn_compact_dark {
  width: 100%;
  height: 40px;
  border-radius: 8px;
  font-weight: 500;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  color: #15DE72;
  background: rgba(21, 222, 114, 0.1);
  border: 1px solid #15DE72;
}

.copy_invoice_btn_compact_light {
  width: 100%;
  height: 40px;
  border-radius: 8px;
  font-weight: 500;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  color: #059573;
  background: rgba(5, 149, 115, 0.05);
  border: 1px solid #059573;
}

.copy_invoice_btn_compact_dark:hover {
  background: #15DE72;
  color: #0C0C0C;
}

.copy_invoice_btn_compact_light:hover {
  background: #059573;
  color: white;
}

/* Static Invoice */
.static-invoice {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: center;
}

.amount-section {
  padding: 1rem;
}

.amount_value_dark {
  font-size: 1.5rem;
  font-weight: 700;
  color: #15DE72;
  margin-bottom: 0.5rem;
}

.amount_value_light {
  font-size: 1.5rem;
  font-weight: 700;
  color: #059573;
  margin-bottom: 0.5rem;
}

.description_text_dark {
  color: #B0B0B0;
  font-size: 0.875rem;
  font-weight: 500;
}

.description_text_light {
  color: #6b7280;
  font-size: 0.875rem;
  font-weight: 500;
}

.copy_invoice_btn_dark {
  width: 100%;
  height: 48px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #15DE72;
  border: 1px solid #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.copy_invoice_btn_light {
  width: 100%;
  height: 48px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #059573;
  border: 1px solid #059573;
  background: rgba(5, 149, 115, 0.05);
}

.copy_invoice_btn_dark:hover {
  background: #15DE72;
  color: #0C0C0C;
}

.copy_invoice_btn_light:hover {
  background: #059573;
  color: white;
}

/* QR Scanner */
.qr_scanner_container_dark {
  height: 300px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #2A342A;
  background: #171717;
  z-index: 5000;
}

.qr_scanner_container_light {
  height: 300px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  background: #f8f9fa;
  z-index: 5000;
}

/* Responsive Design */
@media (max-width: 480px) {
  .bottom-actions {
    padding: 0.75rem 1rem 1.5rem 1rem;
  }

  .action-buttons {
    gap: 0.75rem;
  }

  .action-btn {
    height: 68px;
    min-height: 68px;
    min-width: 100px;
  }

  .main-content {
    padding: 1rem 1rem 5.5rem 1rem;
  }

  .amount-number {
    font-size: 3rem;
  }

  .amount-unit {
    font-size: 1.25rem;
  }

  .dialog-content {
    padding: 1rem;
    gap: 1rem;
  }

  .create-invoice-btn {
    height: 48px;
    font-size: 0.9rem;
  }

  .amount_display_dark,
  .amount_display_light {
    font-size: 1.5rem;
  }

  .payment-content {
    padding: 1rem;
  }

  /* QR Code responsive for mobile */
  .qr_code_section_dark,
  .qr_code_section_light {
    max-width: 240px;
    padding: 0.75rem;
  }

  .qr-code {
    max-width: 200px;
  }

  .qr-code-section.compact .qr-code {
    max-width: 160px;
  }
}

/* Extra small screens (320px and below) */
@media (max-width: 360px) {
  .qr_code_section_dark,
  .qr_code_section_light {
    max-width: 200px;
    padding: 0.5rem;
  }

  .qr-code {
    max-width: 160px;
  }

  .qr-code-section.compact .qr-code {
    max-width: 140px;
  }

  .amount_compact_dark,
  .amount_compact_light {
    font-size: 1.1rem;
  }

  .compact-invoice {
    gap: 1rem;
  }
}

/* Wallet Switcher Dialog */
.wallet-switcher-card {
  width: 100%;
  max-width: 360px;
  border-radius: 20px;
  overflow: hidden;
}

.switcher-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}

.switcher-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.switcher-content {
  padding: 0.5rem;
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: none;
}

.switcher-content::-webkit-scrollbar {
  display: none;
}

.wallet-switch-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

/* Wallet Switch Card - iOS style */
.wallet-switch-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.wallet-switch-card-dark {
  background: transparent;
}

.wallet-switch-card-light {
  background: transparent;
}

.wallet-switch-card-dark:hover {
  background: #222;
}

.wallet-switch-card-light:hover {
  background: #F3F4F6;
}

.wallet-switch-card-active {
  box-shadow: inset 0 0 0 1px #15DE72;
  background: rgba(21, 222, 114, 0.03) !important;
}

.wallet-switch-card-active.wallet-switch-card-dark:hover {
  background: rgba(21, 222, 114, 0.06) !important;
}

.wallet-switch-card-active.wallet-switch-card-light:hover {
  background: rgba(21, 222, 114, 0.05) !important;
}

/* Switch Avatar */
.switch-avatar {
  position: relative;
  flex-shrink: 0;
}

.switch-avatar-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.switch-avatar-black {
  background: linear-gradient(135deg, #2A2A2A, #1A1A1A);
}

.wallet-green {
  background: linear-gradient(135deg, #15DE72, #059573);
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
  border-color: #0C0C0C;
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
  font-size: 14px;
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

/* Meta Row with Badges */
.switch-meta-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-bottom: 0.25rem;
  flex-wrap: wrap;
}

.switch-type-badge {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  font-family: 'Manrope', sans-serif;
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

.switch-tag {
  font-family: 'Manrope', sans-serif;
  font-size: 8px;
  font-weight: 600;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  text-transform: capitalize;
  letter-spacing: 0.02em;
}

.tag-active {
  background: #D1FAE5;
  color: #065F46;
}

/* Switch Balance */
.switch-balance {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
}

.switch-balance-dark {
  color: #777;
}

.switch-balance-light {
  color: #9CA3AF;
}

/* Check Icon */
.switch-check-icon {
  flex-shrink: 0;
  color: #15DE72;
}

/* Switcher Footer */
.switcher-footer {
  padding: 0.75rem 1rem;
  border-top: 1px solid;
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  gap: 8px;
}

.switcher-footer-dark {
  border-top-color: #222;
  background: #171717;
}

.switcher-footer-light {
  border-top-color: #E5E7EB;
  background: #F8F9FA;
}

/* Transfer Funds Button */
.transfer-funds-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  border-radius: 10px;
  padding: 0.5rem 1rem;
  flex: 1;
  transition: all 0.15s ease;
}

.transfer-btn-dark {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
}

.transfer-btn-dark:hover {
  background: rgba(34, 197, 94, 0.2);
}

.transfer-btn-light {
  color: #16a34a;
  background: rgba(34, 197, 94, 0.1);
}

.transfer-btn-light:hover {
  background: rgba(34, 197, 94, 0.15);
}

.manage-wallets-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  border-radius: 10px;
  padding: 0.5rem 1rem;
  flex: 1;
  transition: all 0.15s ease;
}

.manage-btn-dark {
  color: #888;
}

.manage-btn-light {
  color: #6B7280;
}

.manage-wallets-btn:hover {
  background: rgba(107, 114, 128, 0.1);
}

.manage-btn-dark:hover {
  color: #F6F6F6;
}

.manage-btn-light:hover {
  color: #374151;
}

/* Save Contact Dialog */
.save-contact-dialog :deep(.q-dialog__backdrop) {
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.save-contact-card {
  width: 100%;
  max-width: 400px;
  border-radius: 24px;
}

.save-contact-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.save-contact-content {
  padding: 1.25rem;
}

.save-contact-address {
  display: flex;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 0.75rem;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.1);
}

.address-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.save-contact-actions {
  border-top: 1px solid rgba(128, 128, 128, 0.2);
  padding: 0.75rem 1rem;
}

.save-btn {
  color: #15DE72 !important;
  font-weight: 600;
}

.save-btn:disabled {
  color: #6b7280 !important;
  opacity: 0.5;
}

/* Save input styles - dark mode */
.save-input-dark :deep(.q-field__control) {
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.save-input-dark :deep(.q-field--focused .q-field__control) {
  border-color: #15DE72 !important;
}

.save-input-dark :deep(.q-field__label) {
  color: #B0B0B0;
}

.save-input-dark :deep(.q-field--focused .q-field__label),
.save-input-dark :deep(.q-field--float .q-field__label) {
  color: #15DE72 !important;
}

.save-input-dark :deep(.q-field__native) {
  color: #FFF !important;
}

/* Save input styles - light mode */
.save-input-light :deep(.q-field__control) {
  border-color: rgba(0, 0, 0, 0.15) !important;
}

.save-input-light :deep(.q-field--focused .q-field__control) {
  border-color: #15DE72 !important;
}

.save-input-light :deep(.q-field__label) {
  color: #6B7280;
}

.save-input-light :deep(.q-field--focused .q-field__label),
.save-input-light :deep(.q-field--float .q-field__label) {
  color: #15DE72 !important;
}

.save-input-light :deep(.q-field__native) {
  color: #212121 !important;
}

/* Bitcoin Incoming Chip (q-chip) */
.btc-chip {
  margin-left: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: #F7931A !important;
}

.btc-chip-dark {
  background: rgba(247, 147, 26, 0.2) !important;
  border: 1px solid rgba(247, 147, 26, 0.4) !important;
}

.btc-chip-light {
  background: rgba(247, 147, 26, 0.12) !important;
  border: 1px solid rgba(247, 147, 26, 0.3) !important;
}

/* Animation for chip */
.btc-banner-fade-enter-active,
.btc-banner-fade-leave-active {
  transition: all 0.3s ease;
}

.btc-banner-fade-enter-from,
.btc-banner-fade-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
</style>
