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

      <!-- Last transaction preview skeleton -->
      <div class="last-tx-section">
        <div class="last-tx-card-skeleton" :class="$q.dark.isActive ? 'last-tx-skeleton-dark' : 'last-tx-skeleton-light'">
          <q-skeleton type="circle" size="36px" animation="wave" />
          <div class="last-tx-card-skeleton-text">
            <q-skeleton type="text" width="60%" height="14px" animation="wave" />
            <q-skeleton type="text" width="40%" height="12px" animation="wave" />
          </div>
          <div class="last-tx-card-skeleton-amount">
            <q-skeleton type="text" width="80px" height="14px" animation="wave" />
            <q-skeleton type="text" width="56px" height="12px" animation="wave" />
          </div>
        </div>
        <q-skeleton type="text" width="72px" height="14px" animation="wave" class="history-link-skeleton" />
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
          <button class="spark-tab spark-tab-center" data-audit="wallet-switcher" @click="openWalletManagement">
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

      <!--
        Last-transaction preview + History link.

        When a last transaction is available we show it as a tappable
        card above the History link. When it's loading we show a
        skeleton card. When there is no transaction we render only the
        History link (no placeholder / empty-state copy here — the
        /transactions page handles empty state itself).

        Everything routes to /transactions; the card is just a richer,
        more informative entry point than the old round icon button.
      -->
      <div class="last-tx-section">
        <!-- Loading: skeleton -->
        <div
          v-if="isLoadingLastTransaction"
          class="last-tx-card-skeleton"
          :class="$q.dark.isActive ? 'last-tx-skeleton-dark' : 'last-tx-skeleton-light'"
        >
          <q-skeleton type="circle" size="36px" animation="wave" />
          <div class="last-tx-card-skeleton-text">
            <q-skeleton type="text" width="60%" height="14px" animation="wave" />
            <q-skeleton type="text" width="40%" height="12px" animation="wave" />
          </div>
          <div class="last-tx-card-skeleton-amount">
            <q-skeleton type="text" width="80px" height="14px" animation="wave" />
            <q-skeleton type="text" width="56px" height="12px" animation="wave" />
          </div>
        </div>

        <!-- Loaded: the most recent transaction -->
        <button
          v-else-if="lastTransaction"
          type="button"
          class="last-tx-card"
          :class="$q.dark.isActive ? 'last-tx-card-dark' : 'last-tx-card-light'"
          @click="openTransactionHistory"
          :aria-label="$t('Open transaction history')"
        >
          <span class="last-tx-icon" :class="$q.dark.isActive ? 'last-tx-icon-dark' : 'last-tx-icon-light'">
            <Icon :icon="lastTxIcon" width="18" height="18" />
          </span>
          <span class="last-tx-info">
            <span class="last-tx-title" :class="$q.dark.isActive ? 'last-tx-title-dark' : 'last-tx-title-light'">
              {{ lastTxTitle }}
            </span>
            <span class="last-tx-time" :class="$q.dark.isActive ? 'last-tx-muted-dark' : 'last-tx-muted-light'">
              {{ lastTxTimeAgo }}
            </span>
          </span>
          <span class="last-tx-amount-wrap">
            <span class="last-tx-amount" :class="$q.dark.isActive ? 'last-tx-title-dark' : 'last-tx-title-light'">
              {{ lastTxAmountDisplay }}
            </span>
            <span
              v-if="lastTxFiatDisplay"
              class="last-tx-fiat"
              :class="$q.dark.isActive ? 'last-tx-muted-dark' : 'last-tx-muted-light'"
            >
              {{ lastTxFiatDisplay }}
            </span>
          </span>
        </button>

        <!-- Always: the History link row -->
        <button
          type="button"
          class="history-link"
          data-audit="history-link"
          :class="$q.dark.isActive ? 'history-link-dark' : 'history-link-light'"
          @click="openTransactionHistory"
        >
          <Icon icon="tabler:list" width="16" height="16" />
          <span>{{ $t('History') }}</span>
        </button>
      </div>
    </div>

    <!-- Bottom Action Buttons -->
    <div class="bottom-actions">
      <div class="action-buttons">
        <q-btn
          class="action-btn action-btn-receive"
          data-audit="fab-receive"
          @click="openReceive"
          no-caps
          unelevated
          :aria-label="$t('Receive payment')"
        >
          <Icon icon="tabler:qrcode" width="20" height="20" />
          <span class="btn-text">{{ $t('Receive') }}</span>
        </q-btn>
        <q-btn
          class="action-btn action-btn-send"
          data-audit="fab-send"
          @click="openSend"
          no-caps
          unelevated
          :aria-label="$t('Send payment')"
        >
          <Icon icon="tabler:scan" width="20" height="20" />
          <span class="btn-text">{{ $t('Send') }}</span>
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

    <!-- Shared confirmation sheet — used for both send (Lightning Address /
         LNURL-Pay / invoice / Spark) and redeem (LNURL-Withdraw) flows.
         Same component, different verb. Bitcoin on-chain still uses the
         dialog below pending its own pass. -->
    <PaymentConfirmSheet
      ref="sendSheetRef"
      v-model="showSendSheet"
      :payment="paymentSheetProps"
      :wallet-can-pay="paymentSheetWalletCanPay"
      :wallet-hint="paymentSheetWalletHint"
      :is-sending="isSendingPayment"
      @confirm="onSendSheetConfirm"
      @cancel="onSendSheetCancel"
    />

    <PaymentConfirmSheet
      ref="withdrawSheetRef"
      v-model="showWithdrawSheet"
      :payment="withdrawSheetProps"
      verb="redeem"
      :is-sending="withdrawSheetIsBusy"
      :status-message="withdrawSheetStatus"
      @confirm="onWithdrawSheetConfirm"
      @cancel="onWithdrawSheetCancel"
    />

    <!-- Bitcoin on-chain — self-managing bottom sheet with its own
         priority-fee selector, custom rate input, and slide-to-send.
         Lives alongside the LN sheets so all three confirm UIs share
         the same surface language. -->
    <L1BitcoinWithdraw
      v-if="pendingPayment?.bitcoinAddress"
      v-model="showBitcoinSheet"
      :destination-address="pendingPayment.bitcoinAddress"
      :available-balance="walletState.balance"
      @withdrawal-submitted="handleBitcoinWithdrawalSubmitted"
      @withdrawal-error="handleBitcoinWithdrawalError"
    />

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
import {isLightningInvoice as isLightningInvoiceShared} from '../utils/addressUtils.js';
import {Invoice} from '@getalby/lightning-tools';
import {fiatRatesService} from '../utils/fiatRates.js';
import {formatMainBalance as formatMainBalanceUtil, formatAmount} from '../utils/amountFormatting.js';
import {haptics} from '../utils/haptics.js';
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
import PaymentConfirmSheet from '../components/PaymentConfirmSheet.vue';
import BatchSendModal from '../components/BatchSendModal.vue';
import BackupBanner from '../components/BackupBanner.vue';
import {useAutoWithdrawStore} from '../stores/autoWithdraw';
import {
  useBitcoinPreferencesStore,
  BITCOIN_DEPOSIT_POLL_MS,
  CLASSIFICATION_FRESHNESS_MS
} from '../stores/bitcoinPreferences';
import { track as telemetryTrack } from '../utils/telemetry';
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
    PaymentConfirmSheet,
    BatchSendModal,
    PaymentConfirmation,
    NumberFlow,
    BackupBanner
  },
  setup() {
    const walletStore = useWalletStore();
    const addressBookStore = useAddressBookStore();
    const bitcoinPrefsStore = useBitcoinPreferencesStore();
    return { walletStore, addressBookStore, bitcoinPrefsStore };
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
      // Last transaction preview shown above the History link.
      // `null` before the first fetch completes (we render a skeleton
      // instead while `isLoadingLastTransaction` is true). Populated
      // with the raw provider tx object; formatting happens in
      // computed properties.
      lastTransaction: null,
      isLoadingLastTransaction: true,

      showReceiveModal: false,
      showSendModal: false,
      // PaymentConfirmSheet flags. Both paths use the same shared sheet
      // component — the only difference is the `verb` prop (send vs
      // redeem) which switches all the labels, and the payload shape
      // built by the corresponding `*SheetProps` computed below.
      showSendSheet: false,
      showWithdrawSheet: false,
      // Bitcoin on-chain runs through L1BitcoinWithdraw, which owns its
      // own bottom-sheet and bundles fee-priority selection + the
      // dust/balance checks the LN paths don't need.
      showBitcoinSheet: false,
      pendingPayment: null,
      merchantCountdown: 0,
      merchantCountdownTimer: null,
      paymentAmount: '',
      paymentComment: '',
      // Currency mode for the user-entered amount when bridging into
      // confirmPayment / executeWithdraw. PaymentConfirmSheet always
      // emits in sats and the bridge handlers leave this at 'sats',
      // but the field stays so the legacy validation paths
      // (validatePaymentAmount, sendAmountSats) keep their fiat branch
      // available in case future callers feed in fiat values directly.
      sendDenomination: 'sats',
      refreshInterval: null,
      showLoadingScreen: true,
      currentDisplayMode: null, // set from store in created()
      isSwitchingCurrency: false,
      isSendingPayment: false,
      fiatRatesLoaded: false,
      secondaryValue: '',
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

    /**
     * Whether the last transaction represents an incoming payment.
     * Handles the provider's direct types ('receive' / 'send') and the
     * legacy 'incoming' / 'outgoing' shape that the rest of the app
     * also recognises, plus a defensive amount-sign fallback for any
     * future provider that forgets to set `type`.
     */
    lastTxIsIncoming() {
      const tx = this.lastTransaction;
      if (!tx) return false;
      const t = (tx.type || '').toLowerCase();
      if (t === 'receive' || t === 'received' || t === 'incoming') return true;
      if (t === 'send' || t === 'sent' || t === 'outgoing') return false;
      // Last-resort fallback — some providers encode direction in the sign.
      return Number(tx.amount) > 0;
    },

    lastTxIcon() {
      return this.lastTxIsIncoming ? 'tabler:arrow-down-left' : 'tabler:arrow-up-right';
    },

    lastTxTitle() {
      return this.lastTxIsIncoming
        ? this.$t('Payment Received')
        : this.$t('Payment Sent');
    },

    lastTxTimeAgo() {
      if (!this.lastTransaction) return '';
      // Providers variously expose timestamp / settled_at / createdTime
      // depending on the underlying SDK. Try each in order.
      const ts =
        this.lastTransaction.timestamp ??
        this.lastTransaction.settled_at ??
        this.lastTransaction.createdTime ??
        null;
      return this.formatRelativeTime(ts);
    },

    lastTxAmountDisplay() {
      if (!this.lastTransaction) return '';
      const rawAmount = Math.abs(Number(this.lastTransaction.amount) || 0);
      const sign = this.lastTxIsIncoming ? '+' : '-';
      // Use the same formatter the rest of the app uses so unit
      // (sats / BTC) and BIP-177 formatting match.
      const formatted = formatAmount(rawAmount, this.walletStore.useBip177Format);
      return `${sign}${formatted}`;
    },

    lastTxFiatDisplay() {
      if (!this.lastTransaction) return '';
      const sats = Math.abs(Number(this.lastTransaction.amount) || 0);
      if (sats === 0) return '';
      const currency = this.walletState.preferredFiatCurrency || 'USD';
      const fiat = fiatRatesService.convertSatsToFiatSync(sats, currency);
      if (fiat === null || fiat === undefined) return '';
      // "about $0.02" matches the reference mock's softer tone vs an
      // exact value, which is appropriate for a preview.
      return `${this.$t('about')} ${fiatRatesService.formatFiatAmount(fiat, currency)}`;
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

    /**
     * Adapter from the legacy `pendingPayment` shape to the
     * PaymentConfirmSheet `payment` prop shape. Centralizing the mapping
     * here keeps Wallet.vue's send-pipeline state untouched while the
     * sheet stays decoupled from any wallet/legacy specifics.
     */
    paymentSheetProps() {
      const p = this.pendingPayment;
      if (!p) return null;

      // ── Recipient ─────────────────────────────────────────────
      // Merchant payments (SA retail QR) get the merchant logo + name as
      // hero. Otherwise we use the address itself as the display name —
      // for Lightning addresses that already reads cleanly ("alice@…"),
      // and for Spark/invoice we surface a generic "Lightning Invoice"
      // label so the user knows what they're paying.
      let recipient;
      if (p.merchant) {
        recipient = {
          name: p.merchant.displayName,
          logoUrl: p.merchant.logo,
          color: '#3B82F6',
          addressType: 'lightning',
          address: ''
        };
      } else if (p.lightningAddress) {
        recipient = {
          name: p.lightningAddress,
          color: '#F59E0B',
          addressType: 'lightning',
          address: p.lightningAddress
        };
      } else if (p.sparkAddress) {
        recipient = {
          name: this.$t('Spark address'),
          color: '#6B7280',
          addressType: 'spark',
          address: p.sparkAddress
        };
      } else if (p.type === 'lnurl' || p.type === 'lnurl_pay') {
        recipient = {
          name: this.$t('LNURL payment'),
          color: '#3B82F6',
          addressType: 'lnurl',
          address: typeof p.data === 'string' ? p.data : ''
        };
      } else {
        // BOLT11 invoice or unknown — show description as the "name" if
        // we have it, otherwise fall back to a generic label.
        recipient = {
          name: p.description || this.$t('Lightning invoice'),
          color: '#F59E0B',
          addressType: 'invoice',
          address: ''
        };
      }

      // ── Amount mode ───────────────────────────────────────────
      // Source of truth precedence:
      //   1. Invoice with baked amount → fixed
      //   2. LNURL/Lightning Address with min===max (or isFixedAmount) → fixed
      //   3. LNURL/Lightning Address with bounded min/max → range
      //   4. Anything else (Spark, zero-amount invoice) → free
      let amount;
      if (p.amount > 0 && !p.lightningAddress && !this.needsAmountInput) {
        amount = { mode: 'fixed', fixedSats: p.amount };
      } else if (p.fixedAmountSats) {
        amount = { mode: 'fixed', fixedSats: p.fixedAmountSats };
      } else if (p.isFixedAmount && p.minSendable) {
        amount = { mode: 'fixed', fixedSats: Math.floor(p.minSendable / 1000) };
      } else if (p.minSendable && p.maxSendable && p.minSendable !== p.maxSendable) {
        amount = {
          mode: 'range',
          minSats: Math.ceil(p.minSendable / 1000),
          maxSats: Math.floor(p.maxSendable / 1000)
        };
      } else {
        amount = { mode: 'free' };
      }

      // ── Fee estimate ──────────────────────────────────────────
      // Only Spark wallets expose pre-call fee data. NWC/LNBits omit the
      // object entirely so the sheet renders nothing — better than
      // showing an empty "—" row that implies missing information.
      let feeEstimate = null;
      if (this.walletStore.isActiveWalletSpark) {
        if (p.sparkAddress) {
          // Spark-to-Spark transfers are free.
          feeEstimate = { sats: 0, isEstimating: false, label: this.$t('Free (Spark transfer)') };
        } else if (this.isEstimatingFee) {
          feeEstimate = { sats: null, isEstimating: true };
        } else if (this.estimatedFee !== null && this.estimatedFee !== undefined) {
          feeEstimate = { sats: this.estimatedFee, isEstimating: false };
        }
      }

      return {
        recipient,
        amount,
        description: p.description || p.defaultDescription || '',
        commentAllowed: !!p.commentAllowed,
        commentMaxLength: p.commentAllowed || 100,
        // Merchant-driven extras — countdown, ZAR fallback, stale rates.
        // The sheet hides each of these when the corresponding field is
        // absent, so we can wire them unconditionally here.
        countdown: this.merchantCountdown > 0
          ? { seconds: this.merchantCountdown, urgentBelow: 20 }
          : null,
        zarAmount: p.zarAmount || null,
        ratesStale: !!(p.merchant && this.ratesStale),
        feeEstimate
      };
    },

    paymentSheetWalletCanPay() {
      const p = this.pendingPayment;
      if (!p) return true;
      if (p.sparkAddress || p.type === 'spark_address') {
        return this.walletStore.isActiveWalletSpark;
      }
      return true;
    },

    paymentSheetWalletHint() {
      if (this.paymentSheetWalletCanPay) return '';
      return this.$t('Switch to your Spark wallet to pay this address');
    },

    /**
     * Adapter from a `pendingPayment` of type 'lnurl_withdraw' to the
     * sheet's normalized payload. Mirrors `paymentSheetProps` in shape
     * but tuned for the redeem verb: the recipient is the withdrawal
     * source (using its description as the display name), the via line
     * reads "Lightning · Withdrawal", and amount mode is fixed when the
     * source pre-committed an amount, range otherwise.
     */
    withdrawSheetProps() {
      const p = this.pendingPayment;
      if (!p || p.type !== 'lnurl_withdraw') return null;

      const sourceName = p.defaultDescription || this.$t('LNURL Withdrawal');
      const recipient = {
        name: sourceName,
        initial: '↓',
        color: '#3B82F6',
        addressType: 'lnurl',
        viaOverride: this.$t('Lightning · Withdrawal'),
        address: ''
      };

      let amount;
      if (p.isFixedAmount) {
        amount = { mode: 'fixed', fixedSats: p.fixedAmountSats };
      } else if (p.minSats && p.maxSats && p.minSats !== p.maxSats) {
        amount = { mode: 'range', minSats: p.minSats, maxSats: p.maxSats };
      } else {
        // Defensive — every spec-compliant withdraw QR carries a range
        // or a fixed amount, but if metadata is missing fall back to a
        // free input so the user isn't stuck.
        amount = { mode: 'free' };
      }

      return {
        recipient,
        amount,
        // Description already lives in the recipient name; surfacing it
        // again in the description row would be redundant.
        description: '',
        commentAllowed: false
      };
    },

    /**
     * The sheet's `isSending` is true for any non-terminal status. The
     * status copy itself comes from `withdrawStatusMessage` so the user
     * sees "Generating invoice…" → "Awaiting confirmation…" rather than
     * a bare spinner.
     */
    withdrawSheetIsBusy() {
      const s = this.lnurlWithdrawStatus;
      return s !== 'idle' && s !== 'confirmed' && s !== 'error';
    },

    withdrawSheetStatus() {
      return this.withdrawSheetIsBusy ? this.withdrawStatusMessage : '';
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
    preferredFiatCurrency() {
      return (this.walletState.preferredFiatCurrency || 'USD').toUpperCase();
    },
    /**
     * Sats amount to withdraw. Two read paths feed into this:
     *   - Fixed-amount withdraws → use the LNURL-quoted `fixedAmountSats`
     *     directly (paymentAmount isn't bound for these)
     *   - Variable-amount withdraws → the PaymentConfirmSheet writes the
     *     user-entered sats into `paymentAmount` via the bridge handler,
     *     so we just parse it here.
     */
    withdrawAmountSats() {
      if (!this.pendingPayment || this.pendingPayment.type !== 'lnurl_withdraw') return 0;
      if (this.pendingPayment.isFixedAmount) return this.pendingPayment.fixedAmountSats;
      const val = parseFloat(this.paymentAmount);
      return val > 0 ? Math.floor(val) : 0;
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
    // Restore display currency from user preference
    this.currentDisplayMode = this.walletStore.defaultDisplayCurrency || 'bitcoin';
    this.addressBookStore.initialize();
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

    /**
     * Refresh the last-transaction card whenever the active wallet
     * changes (e.g. user switches between Business and Personal via
     * the Spark tab bar, or picks a different connected wallet).
     * Flip the skeleton back on briefly so the card feels responsive
     * to the switch rather than silently swapping its contents.
     */
    'walletState.activeWalletId'(next, prev) {
      if (next === prev) return;
      this.isLoadingLastTransaction = true;
      this.lastTransaction = null;
      this.loadLastTransaction();
    },

    currentDisplayMode: {
      handler: 'updateSecondaryValue',
      immediate: true
    },

    /**
     * Merchant countdown bookkeeping — starts when a merchant payment is
     * about to be confirmed, stops on close. We watch `showSendSheet`
     * because merchant payments (SA retail QR) now route through the
     * shared confirm sheet rather than the legacy dialog.
     */
    showSendSheet(open) {
      if (open && this.pendingPayment?.merchant) {
        this.startMerchantCountdown();
      } else {
        this.stopMerchantCountdown();
      }
      if (!open) {
        this.sendDenomination = 'sats';
      }
    },

    /**
     * Bitcoin sheet cleanup. L1BitcoinWithdraw self-manages its own
     * dialog and only clears `pendingPayment` on a successful send (via
     * handleBitcoinWithdrawalComplete). When the user closes the sheet
     * without sending, this watcher catches the v-model going false and
     * drops the stale `pendingPayment` so it can't leak into the next
     * flow the user opens.
     */
    showBitcoinSheet(open) {
      if (!open && this.pendingPayment?.bitcoinAddress) {
        this.pendingPayment = null;
      }
    },

    /**
     * Re-estimate fees whenever the payment payload or the entered amount
     * changes. PaymentConfirmSheet reads `estimatedFee` / `isEstimatingFee`
     * via `paymentSheetProps.feeEstimate` and renders the row from there.
     */
    pendingPayment: {
      handler: 'updateFeeEstimate',
      immediate: true,
      deep: true
    },

    paymentAmount: {
      handler: 'updateFeeEstimate',
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
        this.showBitcoinSheet = true;
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
      const address = paymentData.address || paymentData.contact?.address;
      this.pendingPayment = {
        bitcoinAddress: address,
        contactName: paymentData.contact?.name
      };
      this.showBitcoinSheet = true;
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
     * Detect deposit changes and trigger the right notification path.
     *
     * Three transitions matter:
     *   1. Brand-new deposit appears (not seen before, any conf state).
     *   2. A previously-pending deposit just crossed the SDK's
     *      confirmation threshold (`confirmed` flipped from false → true).
     *   3. A confirmed deposit was already on the list at boot — handled
     *      separately on init (`processConfirmedDepositsForInit`) so the
     *      user sees the auto-claim sweep when they open the app after
     *      the deposit settled while offline.
     *
     * Cases 1 and 2 funnel through `handleConfirmedDeposit`, which in
     * turn delegates to the auto-claim flow when the user has it on, or
     * keeps the legacy "Ready to claim" toast when it's off.
     */
    detectDepositChanges(newDeposits) {
      const previousTxIds = new Set(this.pendingBitcoinDeposits.map(d => d.txId));
      const previousConfirmed = new Map(this.pendingBitcoinDeposits.map(d => [d.txId, d.confirmed]));

      for (const deposit of newDeposits) {
        const isNew = !previousTxIds.has(deposit.txId);

        if (isNew) {
          if (deposit.confirmed) {
            // Already-confirmed first sighting (e.g. settled while the
            // app was closed). Auto-claim sweeps it via the confirmed
            // handler — no toast.
            this.handleConfirmedDeposit(deposit);
          }
          // Brand-new unconfirmed deposit: the header "Incoming" chip
          // already calls this out + the receive sheet shows full
          // progress, so we deliberately don't fire a toast. Avoids
          // duplicate signals competing for attention.
        } else if (deposit.confirmed && !previousConfirmed.get(deposit.txId)) {
          this.handleConfirmedDeposit(deposit);
        }
      }
    },

    /**
     * Route a confirmed deposit through the auto-claim flow.
     *
     * When the user has "Add incoming Bitcoin automatically" off this
     * keeps the legacy "Ready to claim" toast as a safety net so
     * existing UX doesn't regress for people who deliberately opted
     * out. When the toggle is on, the deposit is classified by the
     * provider and the appropriate notification fires:
     *
     *   - eligible       → silent auto-claim + "Bitcoin received" toast
     *   - needs_approval → notification with [Add to wallet] / [Send back]
     *   - too_small      → notification with [Send back] / [Try anyway]
     *   - quote_failed   → fall back to "Ready to claim" so the user can
     *                       still drive the existing manual flow
     *
     * Designed to never throw — orchestration errors get logged and the
     * legacy toast is shown as the safety net.
     */
    async handleConfirmedDeposit(deposit) {
      if (!this.bitcoinPrefsStore.autoAddIncomingBitcoin) {
        this.notifyDepositReadyManual(deposit);
        return;
      }

      let classification;
      try {
        const provider = await this.walletStore.ensureSparkConnected();
        if (!provider?.classifyConfirmedDeposit) {
          this.notifyDepositReadyManual(deposit);
          return;
        }
        classification = await provider.classifyConfirmedDeposit(deposit);
      } catch (error) {
        console.warn('Auto-claim classification failed:', error?.message || error);
        this.notifyDepositReadyManual(deposit);
        return;
      }

      switch (classification.category) {
        case 'eligible':
          telemetryTrack('bitcoin.deposit.classified', {
            category: 'eligible',
            amount_sats: deposit.amount,
            fee_sats: classification.feeSats,
            fee_ratio: classification.feeRatio
          });
          await this.attemptAutoClaim(deposit, classification, { source: 'auto' });
          break;
        case 'needs_approval':
          telemetryTrack('bitcoin.deposit.classified', {
            category: 'needs_approval',
            amount_sats: deposit.amount,
            fee_sats: classification.feeSats,
            fee_ratio: classification.feeRatio
          });
          this.notifyClaimNeedsApproval(deposit, classification);
          break;
        case 'too_small':
          telemetryTrack('bitcoin.deposit.classified', {
            category: 'too_small',
            amount_sats: deposit.amount
          });
          this.notifyDepositTooSmall(deposit);
          break;
        case 'quote_failed':
        default:
          telemetryTrack('bitcoin.deposit.classified', {
            category: 'quote_failed',
            amount_sats: deposit.amount,
            error: classification.error?.message || 'unknown'
          });
          this.notifyDepositReadyManual(deposit);
          break;
      }
    },

    /**
     * Try the silent auto-claim path. Falls back to a manual prompt if
     * the SSP rejects the claim (e.g. fee changed mid-flight).
     *
     * If the captured quote is older than CLASSIFICATION_FRESHNESS_MS we
     * refetch before submitting — typical case is a `needs_approval`
     * toast the user took a while to act on. The refresh is best-effort:
     * on failure we proceed with the original quote and let the SSP
     * reject if the fee has actually drifted.
     *
     * @param {Object} deposit
     * @param {Object} classification
     * @param {{source: 'auto' | 'user_approved' | 'try_anyway'}} options
     */
    async attemptAutoClaim(deposit, classification, options = { source: 'auto' }) {
      const startedAt = Date.now();
      let workingClassification = classification;

      try {
        const provider = await this.walletStore.ensureSparkConnected();

        const ageMs = Date.now() - (workingClassification.classifiedAt || 0);
        if (ageMs > CLASSIFICATION_FRESHNESS_MS && typeof provider.refreshClassificationQuote === 'function') {
          telemetryTrack('bitcoin.deposit.quote_refreshed', {
            age_ms: ageMs,
            source: options.source
          });
          workingClassification = await provider.refreshClassificationQuote(
            deposit,
            workingClassification
          );
        }

        const result = await provider.claimDeposit(
          deposit.txId,
          workingClassification.quote,
          deposit.outputIndex || 0
        );
        const credited = Number(
          result?.amount ||
          workingClassification.quote?.creditAmountSats ||
          deposit.amount
        );

        telemetryTrack('bitcoin.deposit.claim_succeeded', {
          source: options.source,
          amount_sats: credited,
          fee_sats: workingClassification.feeSats,
          duration_ms: Date.now() - startedAt,
          processing: !!result?.processing,
          transfer_id: result?.transferId || null
        });

        this.notifyAutoClaimSucceeded(credited, workingClassification.feeSats);
        if (this.walletStore.activeWalletId) {
          this.walletStore.refreshWalletData(this.walletStore.activeWalletId);
        }
      } catch (error) {
        telemetryTrack('bitcoin.deposit.claim_failed', {
          source: options.source,
          amount_sats: deposit.amount,
          duration_ms: Date.now() - startedAt,
          error: error?.message || 'unknown'
        });
        console.warn('Auto-claim attempt failed, surfacing manual prompt:', error?.message || error);
        this.notifyDepositReadyManual(deposit);
      }
    },

    /**
     * Silent-success toast for an auto-claimed deposit. We surface the
     * fee inline (small footer) so transparency is preserved without
     * making it the headline.
     */
    notifyAutoClaimSucceeded(amountSats, feeSats) {
      const amountCopy = `${amountSats.toLocaleString()} ${this.$t('sats added to your wallet')}`;
      const feeCopy = feeSats > 0
        ? `${this.$t('Network fee')}: ${feeSats.toLocaleString()} ${this.$t('sats')}`
        : null;

      this.$q.notify({
        type: 'positive',
        icon: 'currency_bitcoin',
        message: this.$t('Bitcoin received'),
        caption: feeCopy ? `${amountCopy} · ${feeCopy}` : amountCopy,
        position: 'top',
        timeout: 5000
      });
    },

    /**
     * Approval prompt when the network fee exceeds our auto-claim
     * thresholds. Two inline actions — [Add to wallet] / [Send back] —
     * matching the design decision that we never block with a modal.
     */
    notifyClaimNeedsApproval(deposit, classification) {
      const feeCopy = `${classification.feeSats.toLocaleString()} ${this.$t('sats')} (${(classification.feeRatio * 100).toFixed(1)}%)`;

      this.$q.notify({
        type: 'warning',
        icon: 'currency_bitcoin',
        message: this.$t('Bitcoin arrived, needs your OK'),
        caption: this.$t('Network fees are higher than usual. Adding this to your wallet will cost about {fee}.', { fee: feeCopy }),
        position: 'top',
        timeout: 0,
        actions: [
          {
            label: this.$t('Add to wallet'),
            color: 'white',
            handler: () => {
              telemetryTrack('bitcoin.deposit.user_action', {
                source: 'needs_approval',
                action: 'add_to_wallet'
              });
              this.attemptAutoClaim(deposit, classification, { source: 'user_approved' });
            }
          },
          {
            label: this.$t('Send back'),
            color: 'white',
            handler: () => {
              telemetryTrack('bitcoin.deposit.user_action', {
                source: 'needs_approval',
                action: 'send_back'
              });
              this.openReceiveModalBitcoin();
            }
          }
        ]
      });
    },

    /**
     * Tiny-deposit prompt. The "Try anyway" path opens the existing
     * manual claim list so the user can review the (likely large) fee
     * before committing.
     */
    notifyDepositTooSmall(deposit) {
      this.$q.notify({
        type: 'info',
        icon: 'currency_bitcoin',
        message: this.$t('Tiny Bitcoin deposit'),
        caption: this.$t('This {amount} sats is too small to bring in. Network fees would eat most of it.', { amount: deposit.amount.toLocaleString() }),
        position: 'top',
        timeout: 0,
        actions: [
          {
            label: this.$t('Send back'),
            color: 'white',
            handler: () => {
              telemetryTrack('bitcoin.deposit.user_action', {
                source: 'too_small',
                action: 'send_back'
              });
              this.openReceiveModalBitcoin();
            }
          },
          {
            label: this.$t('Try anyway'),
            color: 'white',
            handler: () => {
              telemetryTrack('bitcoin.deposit.user_action', {
                source: 'too_small',
                action: 'try_anyway'
              });
              this.openReceiveModalBitcoin();
            }
          }
        ]
      });
    },

    /**
     * Legacy manual-claim toast. Used when auto-claim is off, when
     * classification fails, or when the optimistic claim path errors
     * out. Identical UX to the pre-auto-claim behaviour so we always
     * have a safe fallback.
     */
    notifyDepositReadyManual(deposit) {
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

      // Cadence is tuned in stores/bitcoinPreferences.js so it stays a
      // single knob rather than scattered magic numbers.
      this.bitcoinDepositPollingInterval = setInterval(() => {
        this.checkPendingBitcoinDeposits();
      }, BITCOIN_DEPOSIT_POLL_MS);
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
    /**
     * Handle a freshly-submitted Bitcoin withdrawal.
     *
     * The L1 sheet emits this once with the SSP-issued request ID and
     * closes itself. From here we:
     *   1. tear down the pending-payment context so the sheet can unmount,
     *   2. refresh the wallet balance (the SSP debits immediately even
     *      though the L1 broadcast happens later),
     *   3. show a persistent "submitted" toast and poll
     *      `getCoopExitRequest` in the background until the SSP returns
     *      the on-chain txid (or reports failure / expiry),
     *   4. swap the toast for either a tappable mempool link or a clear
     *      failure message.
     *
     * Polling lives here (not on the sheet) because the sheet's `v-if`
     * is bound to `pendingPayment`, which we clear in step 1 — moving
     * the polling onto the sheet would race the unmount.
     */
    handleBitcoinWithdrawalSubmitted({ requestId }) {
      this.showBitcoinSheet = false;
      this.pendingPayment = null;
      this.updateWalletBalance();

      this._monitorL1Withdrawal(requestId);
    },

    /**
     * Background poll for an L1 withdrawal until it reaches a terminal
     * state. Notification handles update in place: persistent "submitted"
     * → success-with-mempool-link or a clear failure message.
     */
    async _monitorL1Withdrawal(requestId) {
      const provider = this.walletStore.getActiveProvider();
      if (!provider?.waitForWithdrawalCompletion) {
        console.warn('Active provider cannot monitor L1 withdrawals');
        return;
      }

      const dismissProcessing = this.$q.notify({
        type: 'ongoing',
        message: this.$t('Bitcoin withdrawal submitted'),
        caption: this.$t('Waiting for on-chain broadcast...'),
        timeout: 0,
        spinner: true
      });

      try {
        const final = await provider.waitForWithdrawalCompletion(requestId);
        dismissProcessing();

        if (final.isFailed) {
          this.$q.notify({
            type: 'negative',
            message: this.$t('Withdrawal failed'),
            caption: this.$t('Your funds remain in your wallet.'),
            timeout: 6000
          });
          this.updateWalletBalance();
          return;
        }

        const mempoolUrl = provider.getMempoolExplorerUrl?.();
        const txId = final.txId;

        this.$q.notify({
          type: 'positive',
          message: this.$t('Bitcoin sent'),
          caption: txId ? this.$t('Tap to view transaction') : this.$t('Your withdrawal completed'),
          timeout: 6000,
          actions: (txId && mempoolUrl) ? [{
            icon: 'open_in_new',
            color: 'white',
            handler: () => window.open(`${mempoolUrl}/tx/${txId}`, '_blank')
          }] : []
        });

        this.updateWalletBalance();
      } catch (error) {
        console.warn('L1 withdrawal monitor stopped:', error.message);
        dismissProcessing();
        this.$q.notify({
          type: 'warning',
          message: this.$t('Still settling'),
          caption: this.$t('Your withdrawal is taking longer than usual. Check your activity feed.'),
          timeout: 6000
        });
      }
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
            this.showBitcoinSheet = true;

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
        await this.loadLastTransaction();
        await this.loadNostrProfiles();

        this.startPeriodicRefresh();

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
          message: this.$t('Wallet unlocked - upgrade complete'),
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

    /**
     * Refresh the active wallet's balance and the last-transaction preview.
     *
     * Called from the 30s periodic tick, after every send/receive, on wallet
     * switch, and on app start. The balance-fetch logic branches per wallet
     * type (Spark / LNBits / NWC) and each branch returns early after its
     * own fetch — so the last-transaction refresh lives in `finally` to
     * guarantee it runs for every wallet type, even when a branch throws.
     */
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
      } finally {
        // Runs for every wallet type, including the branches above that
        // `return` early after their balance fetch. Fire-and-forget — any
        // error inside is logged by loadLastTransaction itself.
        this.loadLastTransaction();
      }
    },

    /**
     * Fetch the single most recent transaction for the active wallet
     * and store it in `lastTransaction`. Best-effort: when the active
     * wallet isn't connected yet, or its provider doesn't expose
     * `getTransactions`, we silently clear to null so the UI falls
     * back to just the "History" link without an error state.
     *
     * Called from updateWalletBalance's `finally` block — so it fires on
     * the 30s periodic tick, after every send/receive, and on wallet
     * switch, for every wallet type (Spark / LNBits / NWC). Also called
     * directly from created() after initial connect.
     */
    async loadLastTransaction() {
      const walletId = this.activeWallet?.id;
      if (!walletId) {
        this.lastTransaction = null;
        this.isLoadingLastTransaction = false;
        return;
      }

      try {
        const provider = this.walletStore.providers?.[walletId];
        if (!provider || typeof provider.getTransactions !== 'function') {
          this.lastTransaction = null;
          return;
        }

        const result = await provider.getTransactions({ limit: 1, offset: 0 });
        // Providers return either an array or `{ transactions: [...] }`
        // depending on the implementation. Handle both so new providers
        // don't silently break this card.
        const txs = Array.isArray(result) ? result : (result?.transactions || []);
        this.lastTransaction = txs.length > 0 ? txs[0] : null;
      } catch (err) {
        console.warn('Failed to load last transaction:', err);
        this.lastTransaction = null;
      } finally {
        this.isLoadingLastTransaction = false;
      }
    },

    openTransactionHistory() {
      haptics.tap();
      this.$router.push('/transactions');
    },

    openReceive() {
      haptics.tap();
      this.showReceiveModal = true;
    },

    openSend() {
      haptics.tap();
      this.showSendModal = true;
    },

    /**
     * Build a best-effort relative time string without pulling in a
     * date library. Falls back to a short absolute date for anything
     * older than a week.
     */
    formatRelativeTime(timestamp) {
      if (!timestamp) return '';
      const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
      if (!Number.isFinite(ts)) return '';
      const diffMs = Date.now() - ts;
      if (diffMs < 0) return this.$t('just now');
      const minute = 60 * 1000;
      const hour = 60 * minute;
      const day = 24 * hour;
      const week = 7 * day;
      if (diffMs < minute) return this.$t('just now');
      if (diffMs < hour) {
        const n = Math.floor(diffMs / minute);
        return `${n} ${n === 1 ? this.$t('min ago') : this.$t('mins ago')}`;
      }
      if (diffMs < day) {
        const n = Math.floor(diffMs / hour);
        return `${n} ${n === 1 ? this.$t('hr ago') : this.$t('hrs ago')}`;
      }
      if (diffMs < week) {
        const n = Math.floor(diffMs / day);
        return `${n} ${n === 1 ? this.$t('day ago') : this.$t('days ago')}`;
      }
      // Older than a week: show a short absolute date, localised.
      try {
        return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      } catch {
        return '';
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

    startPeriodicRefresh() {
      this.refreshInterval = setInterval(async () => {
        // updateWalletBalance refreshes the last-tx card in its finally
        // block, so we don't call loadLastTransaction separately here.
        await this.updateWalletBalance();
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
        const cleanInvoice = invoice.replace(/^lightning:/i, '').toLowerCase();

        let amount = 0;
        const amountMatch = cleanInvoice.match(/lnbc(\d+)([munp]?)/);
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
          message: this.$t('Invalid amount'),
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
        // Spark-specific receive request ID (UUID). Required by
        // getLightningReceiveRequest() — the payment hash is NOT a valid
        // ID for that endpoint. Other backends won't populate this.
        invoice_id: result.id || null,
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
        // Spark: event-based monitoring as a wake-up signal, verified
        // against the specific invoice. The raw `onPaymentReceived`
        // callback fires for ANY incoming payment (the SDK doesn't
        // expose which invoice was settled), so without this filter an
        // unrelated wallet credit — or even a stale cached event — would
        // close the sheet before the user's withdraw actually settles.
        // We confirm via `lookupInvoice` and fall through silently if
        // the event doesn't correspond to our payment hash.
        try {
          const provider = await this.walletStore.ensureSparkConnected();
          // Prefer the Spark receive request ID for getLightningReceiveRequest;
          // fall back to the payment hash, which lookupInvoice resolves via
          // the transfer-list scan.
          const lookupKey = invoice.invoice_id || invoice.payment_hash;
          this.withdrawSparkUnsubscribe = provider.onPaymentReceived(async () => {
            if (this.lnurlWithdrawStatus !== 'monitoring') return;
            if (!lookupKey || typeof provider.lookupInvoice !== 'function') return;
            try {
              const result = await provider.lookupInvoice(lookupKey);
              if (result?.paid) {
                this.handleWithdrawConfirmed(result.amount || amountSats);
              }
            } catch (e) {
              console.warn('lookupInvoice failed during Spark withdraw monitoring:', e);
            }
          });
          // Belt-and-braces: also run polling as a safety net so that if
          // the event never fires (cold session, dropped subscription)
          // the withdraw still settles. The polling monitor filters by
          // payment_hash and stops itself once confirmed.
          this.startWithdrawPollingMonitor(invoice, amountSats);
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
      // Idempotency guard — both the Spark event listener and the
      // polling monitor can race to confirm the same payment. The
      // first one wins; subsequent calls are silently ignored so we
      // don't double-fire the success modal or thrash status.
      if (this.lnurlWithdrawStatus === 'confirmed') return;

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

      this.showWithdrawSheet = false;
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
    },

    startMerchantCountdown() {
      this.stopMerchantCountdown();
      this.merchantCountdown = 90;
      this.merchantCountdownTimer = setInterval(() => {
        this.merchantCountdown--;
        if (this.merchantCountdown <= 0) {
          this.stopMerchantCountdown();
          this.showSendSheet = false;
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
              message: this.$t('Could not process this link'),
              caption: lnurlInfo.reason || this.$t('The server did not respond or the link is no longer valid'),
              timeout: 6000,
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

        // Dispatch by payload shape:
        //   - Bitcoin on-chain → L1BitcoinWithdraw (own sheet)
        //   - LNURL-Withdraw   → PaymentConfirmSheet, verb='redeem'
        //   - Everything else  → PaymentConfirmSheet, verb='send'
        if (this.pendingPayment?.bitcoinAddress) {
          this.showBitcoinSheet = true;
        } else if (this.pendingPayment?.type === 'lnurl_withdraw') {
          this.showWithdrawSheet = true;
        } else {
          this.showSendSheet = true;
        }
      } catch (error) {
        console.error('Error processing payment:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Payment failed'),
          caption: this.$t('Please try again'),

        });
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

    /**
     * PaymentConfirmSheet → confirm handler.
     *
     * The sheet validates the entered amount against its constraints
     * before emitting, so we trust the value and just bridge it into the
     * fields that `confirmPayment` reads. On failure we reset the slide
     * thumb so the user can try again without dismissing the sheet.
     */
    async onSendSheetConfirm({ amountSats, comment }) {
      this.paymentAmount = String(amountSats);
      this.paymentComment = comment || '';
      this.sendDenomination = 'sats';

      await this.confirmPayment();

      // confirmPayment nulls pendingPayment on success and leaves it
      // in place on failure (its catch block doesn't rethrow).
      if (this.pendingPayment === null) {
        this.showSendSheet = false;
      } else {
        this.$refs.sendSheetRef?.resetSlide();
      }
    },

    onSendSheetCancel() {
      this.showSendSheet = false;
      this.pendingPayment = null;
      this.paymentAmount = '';
      this.paymentComment = '';
      this.estimatedFee = null;
      this.isEstimatingFee = false;
    },

    /**
     * PaymentConfirmSheet → confirm handler for the LNURL-Withdraw
     * (redeem) flow. The sheet has already validated the amount against
     * the withdraw source's range/fixed constraints, so we just bridge
     * it into `paymentAmount` (which executeWithdraw reads) and run the
     * existing pipeline. On failure we reset the slide and keep the
     * sheet open so the user can retry without re-entering anything.
     */
    async onWithdrawSheetConfirm({ amountSats }) {
      this.paymentAmount = String(amountSats);

      await this.executeWithdraw();

      // executeWithdraw transitions lnurlWithdrawStatus through stages.
      // 'confirmed' closes the sheet via handleWithdrawConfirmed.
      // 'error' lands here — let the user retry.
      if (this.lnurlWithdrawStatus === 'error') {
        this.$refs.withdrawSheetRef?.resetSlide();
      }
    },

    onWithdrawSheetCancel() {
      this.showWithdrawSheet = false;
      this.resetWithdrawState();
      this.pendingPayment = null;
      this.paymentAmount = '';
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

    isLightningInvoice(input) { return isLightningInvoiceShared(input); },

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
  /* Single source of truth lives in app.css → body.body--light → --bg-primary */
  background: var(--bg-primary);
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
  color: var(--text-primary);
}

.modern-menu-btn-light:hover {
  background: var(--bg-input);
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
  background: var(--text-primary);
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
  background: var(--bg-input);
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
  background: #FFFFFF;
  box-shadow: 0 1px 3px rgba(40, 34, 20, 0.08), 0 1px 2px rgba(40, 34, 20, 0.04);
  border: 1px solid var(--border-card);
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
  color: var(--text-primary);
}


.amount-unit {
  font-size: 1.5rem;
  font-weight: 600;
}

.amount-unit-dark {
  color: rgba(255, 255, 255, 0.8);
}

.amount-unit-light {
  color: var(--text-secondary);
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
  /* Fiat is a secondary readout — the primary balance below should
     carry the room. Warm muted grey sits quiet on cream, leaving
     the brand-green reserved for semantic "incoming" states in
     the tx list. */
  color: var(--text-muted);
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

/* ------------------------------------------------------------------
   Last-transaction preview + History link.
   Neutral palette only — deliberately no green accents here. The
   balance above carries the brand colour; this block stays quiet so
   the eye lands on the amount, not the last-tx direction.
------------------------------------------------------------------ */
.last-tx-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 0 1.25rem;
  margin-bottom: 1.5rem;
}

/* ── Card ──────────────────────────────────────────────────────── */
.last-tx-card {
  width: 100%;
  max-width: 440px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid;
  background: none;
  cursor: pointer;
  text-align: left;
  transition: transform 0.12s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  font-family: 'Manrope', sans-serif;
}

.last-tx-card:active {
  transform: scale(0.99);
}

.last-tx-card-light {
  background: #ffffff;
  border-color: #e2e8f0;
}

.last-tx-card-dark {
  background: var(--bg-secondary);
  border-color: var(--border-card);
}

.last-tx-icon {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.last-tx-icon-light {
  background: #f1f5f9;
  color: #475569;
}

.last-tx-icon-dark {
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
}

.last-tx-info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.last-tx-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.last-tx-title-light {
  color: #0f172a;
}

.last-tx-title-dark {
  color: #f1f5f9;
}

.last-tx-time,
.last-tx-fiat {
  font-size: 12px;
  font-weight: 400;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.last-tx-muted-light {
  color: #64748b;
}

.last-tx-muted-dark {
  color: #94a3b8;
}

.last-tx-amount-wrap {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
}

.last-tx-amount {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ── History link ─────────────────────────────────────────────── */
.history-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border: none;
  background: none;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.history-link:active {
  opacity: 0.6;
}

.history-link-light {
  color: #475569;
}

.history-link-dark {
  color: #cbd5e1;
}

/* ── Skeleton ─────────────────────────────────────────────────── */
.last-tx-card-skeleton {
  width: 100%;
  max-width: 440px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid;
}

.last-tx-skeleton-light {
  background: #ffffff;
  border-color: #e2e8f0;
}

.last-tx-skeleton-dark {
  background: var(--bg-secondary);
  border-color: var(--border-card);
}

.last-tx-card-skeleton-text {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.last-tx-card-skeleton-amount {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.history-link-skeleton {
  border-radius: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .last-tx-card,
  .history-link {
    transition: none;
  }
  .last-tx-card:active {
    transform: none;
  }
}

/* Bottom Actions
   Uses var(--safe-bottom) so the Android boot patch in
   src/boot/safe-area.js applies (env() returns 0 on Android
   WebView with a gesture bar). Floor raised to 2.25rem so the
   CTAs clear the notchless-phone edge with visual breathing room. */
.bottom-actions {
  padding: 1rem 1.5rem;
  padding-bottom: max(2.25rem, var(--safe-bottom, 2.25rem));
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

/* Twin tinted-fill buttons. Send and Receive are equal, co-primary
   actions — no outlined-vs-filled hierarchy. Each carries a soft
   wash of its brand colour with full-saturation label and icon; the
   background is atmosphere, the foreground is meaning. Sharper 18px
   radius matches the app's card language and drops the pill that
   fought the rest of the wallet UI. */
.action-btn {
  flex: 1;
  height: 56px;
  min-height: 56px;
  min-width: 120px;
  border-radius: 18px;
  padding: 0 20px;
  position: relative;
  overflow: hidden;
  transition:
    transform 0.18s cubic-bezier(0.4, 0, 0.2, 1),
    filter 0.18s ease,
    background-color 0.18s ease,
    border-color 0.18s ease;
}

/* Identical layout on both: icon + label in a single row, centered.
   Neutralises Quasar's internal content padding which otherwise
   offsets one button against the other. */
.action-btn :deep(.q-btn__content) {
  padding: 0;
  flex-direction: row;
  column-gap: 10px;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
}

/* Micro top-edge sheen — a barely-there light source. Adds form
   without introducing a new colour or animation surface. */
.action-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.05) 0%,
    rgba(255, 255, 255, 0) 40%
  );
  pointer-events: none;
}

.action-btn:hover {
  filter: brightness(1.08);
}

.action-btn:active {
  transform: scale(0.97);
  transition-duration: 0.08s;
  filter: brightness(0.92);
}

/* Receive — green tinted fill. Uses the same #15DE72 accent as the
   ReceiveModal so the button and the modal it opens feel like one
   continuous surface. */
.action-btn-receive {
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
  border: 1px solid rgba(21, 222, 114, 0.22);
}

/* Send — blue tinted fill. #3B82F6 chosen over #2563EB for the
   icon/label because it has stronger contrast on the tinted wash
   in dark mode. The shade still belongs to the brand-blue family. */
.action-btn-send {
  background: rgba(59, 130, 246, 0.14);
  color: #3B82F6;
  border: 1px solid rgba(59, 130, 246, 0.22);
}

/* Light mode: drop the green/blue tint story entirely. On cream
   the twin tinted washes read as two competing brand colors; the
   audit flagged this as the single loudest inconsistency. Both
   buttons now share one neutral "primary action" look — dark pill
   on cream — so Send and Receive feel like peer actions with equal
   visual weight. Dark mode keeps the tinted-fill language because
   coloured accents on black are the whole point of that theme. */
.body--light .action-btn-receive,
.body--light .action-btn-send {
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
  border: 1px solid var(--btn-neutral-border);
}

.btn-text {
  font-family: 'Manrope', sans-serif;
  font-size: 0.9375rem; /* 15px */
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 1;
}

@media (prefers-reduced-motion: reduce) {
  .action-btn,
  .action-btn:hover,
  .action-btn:active {
    transition: none;
    transform: none;
    filter: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .action-btn,
  .action-btn:hover,
  .action-btn:active {
    transition: none;
    transform: none;
    filter: none;
  }
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
  background: var(--bg-input);
  color: var(--text-primary);
  border: 1px solid var(--border-card);
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
  color: var(--text-secondary);
  background: var(--bg-input);
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-card);
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
  background: var(--bg-input);
  color: var(--text-primary);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  margin-bottom: 1rem;
}

/* Payment Actions */
.payment_actions_dark {
  background: #0C0C0C;
  border-top: 1px solid #2A342A;
}

.payment_actions_light {
  background: var(--bg-primary);
  border-top: 1px solid var(--border-card);
}

.cancel_btn_dark {
  color: #B0B0B0;
}

.cancel_btn_light {
  color: var(--text-secondary);
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
  background: var(--bg-input);
  color: var(--text-primary);
  border: 1px solid var(--border-card);
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
    /* Keep the narrow-viewport side padding but preserve the safe-area
       floor from the base rule. Shorthand padding was erasing the
       padding-bottom calculation on mobile, which was the biggest
       safe-area offender flagged in the audit. */
    padding-left: 1rem;
    padding-right: 1rem;
    padding-top: 0.75rem;
    padding-bottom: max(1.75rem, var(--safe-bottom, 1.75rem));
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
  color: var(--text-muted);
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
  border-top-color: var(--border-card);
  background: var(--bg-primary);
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
  color: var(--text-secondary);
}

.manage-wallets-btn:hover {
  background: rgba(107, 114, 128, 0.1);
}

.manage-btn-dark:hover {
  color: #F6F6F6;
}

.manage-btn-light:hover {
  color: var(--text-primary);
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
