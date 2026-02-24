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
        <q-icon name="las la-arrow-left" size="20px"/>
      </q-btn>
      <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
        {{ $t('Settings') }}
      </div>
      <div class="header-spacer"></div>
    </div>

    <!-- Settings Content -->
    <div class="settings-content">

      <!-- GENERAL Section -->
      <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
        {{ $t('General') }}
      </div>
      <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
        <q-item clickable v-ripple @click="showWalletsDialog = true">
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Manage Wallets') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ wallets.length }} {{ wallets.length === 1 ? $t('wallet') : $t('wallets') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-icon name="las la-chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'"/>
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item clickable v-ripple @click="$router.push('/address-book')">
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Address Book') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-icon name="las la-chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'"/>
          </q-item-section>
        </q-item>
      </div>

      <!-- SPARK WALLET Section (only if spark wallet exists) -->
      <template v-if="hasSparkWallet">
        <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
          {{ $t('Spark Wallet') }}
        </div>
        <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
          <q-item>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Spark Address') }}
              </q-item-label>
              <q-item-label caption class="mono-caption" :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ truncateAddress(activeSparkAddress) || $t('Not available') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side class="spark-address-actions">
              <q-btn flat round dense icon="las la-copy" @click="copySparkAddress" :class="$q.dark.isActive ? 'action-icon-dark' : 'action-icon-light'" size="sm" />
              <q-btn flat round dense icon="las la-share-alt" @click="shareSparkAddress" :class="$q.dark.isActive ? 'action-icon-dark' : 'action-icon-light'" size="sm" />
            </q-item-section>
          </q-item>
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <q-item clickable v-ripple @click="openBackupDialog">
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Backup Seed Phrase') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side class="backup-status-side">
              <span
                class="backup-status-badge"
                :class="hasBackedUp ? 'badge-verified' : 'badge-unverified'"
              >
                {{ hasBackedUp ? $t('Verified') : $t('Not verified') }}
              </span>
            </q-item-section>
          </q-item>
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <q-item clickable v-ripple @click="openViewMnemonicDialog">
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('View Seed Phrase') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-icon name="las la-chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'"/>
            </q-item-section>
          </q-item>
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <q-item clickable v-ripple @click="openChangePinDialog">
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Change PIN') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-icon name="las la-chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'"/>
            </q-item-section>
          </q-item>
        </div>
      </template>

      <!-- PREFERENCES Section -->
      <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
        {{ $t('Preferences') }}
      </div>
      <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
        <q-item clickable v-ripple @click="openCurrencyDialog">
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Currency') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="side-value" :class="$q.dark.isActive ? 'side-value-dark' : 'side-value-light'">
              {{ preferredFiatCurrency }}
            </div>
          </q-item-section>
          <q-item-section side>
            <q-icon name="las la-chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'"/>
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item clickable v-ripple @click="showLanguageDialog = true">
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Language') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="side-value" :class="$q.dark.isActive ? 'side-value-dark' : 'side-value-light'">
              {{ getCurrentLanguageLabel() }}
            </div>
          </q-item-section>
          <q-item-section side>
            <q-icon name="las la-chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'"/>
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item clickable v-ripple @click="showMempoolDialog = true">
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Exchange Rate Source') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="side-value" :class="$q.dark.isActive ? 'side-value-dark' : 'side-value-light'">
              {{ customMempoolUrl ? $t('Custom') : $t('Default') }}
            </div>
          </q-item-section>
          <q-item-section side>
            <q-icon name="las la-chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'"/>
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Amount Display Format') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ useBip177Format ? 'BIP-177 (e.g. ₿ 1,234)' : $t('Legacy (e.g. 1,234 sats)') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-toggle
              :model-value="useBip177Format"
              @update:model-value="updateAmountFormat"
              :color="$q.dark.isActive ? 'green' : 'green-7'"
            />
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Dark Mode') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ $q.dark.isActive ? $t('On') : $t('Off') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-toggle
              :model-value="$q.dark.isActive"
              @update:model-value="$q.dark.toggle()"
              :color="$q.dark.isActive ? 'green' : 'green-7'"
            />
          </q-item-section>
        </q-item>
      </div>

      <!-- DANGER ZONE -->
      <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
        {{ $t('Account') }}
      </div>
      <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
        <q-item v-if="hasSparkWallet" clickable v-ripple @click="confirmDeleteSparkWallet">
          <q-item-section>
            <q-item-label class="danger-text text-center">
              {{ $t('Delete Spark Wallet') }}
            </q-item-label>
          </q-item-section>
        </q-item>
        <q-separator v-if="hasSparkWallet" :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item clickable v-ripple @click="confirmDisconnectNwc">
          <q-item-section>
            <q-item-label class="danger-text text-center">
              {{ $t('Remove NWC Connections') }}
            </q-item-label>
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item clickable v-ripple @click="confirmDisconnectLNBits">
          <q-item-section>
            <q-item-label class="danger-text text-center">
              {{ $t('Remove LNBits Connections') }}
            </q-item-label>
          </q-item-section>
        </q-item>
      </div>

      <!-- SUPPORT Section -->
      <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
        {{ $t('Support') }}
      </div>
      <div class="settings-card support-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
        <div class="support-content">
          <div class="support-message" :class="$q.dark.isActive ? 'support-message-dark' : 'support-message-light'">
            {{ $t('Fuel BuhoGO to Fly Higher') }}
          </div>
          <div class="donation-row">
            <q-btn
              flat
              dense
              no-caps
              class="donate-btn"
              :class="$q.dark.isActive ? 'donate-btn-dark' : 'donate-btn-light'"
              :loading="donationLoading === 5000"
              @click="handleDonation(5000)"
            >
              {{ formatSats(5000) }}
            </q-btn>
            <q-btn
              unelevated
              dense
              no-caps
              class="donate-btn donate-btn-primary"
              :loading="donationLoading === 21000"
              @click="handleDonation(21000)"
            >
              {{ formatSats(21000) }}
            </q-btn>
            <q-btn
              flat
              dense
              no-caps
              class="donate-btn"
              :class="$q.dark.isActive ? 'donate-btn-dark' : 'donate-btn-light'"
              @click="showDonationDialog = true"
            >
              {{ $t('Other') }}
            </q-btn>
          </div>
        </div>
      </div>

      <!-- App Version -->
      <a
        href="https://github.com/Buho-Ecosystem/Buho_go"
        target="_blank"
        rel="noopener noreferrer"
        class="app-version"
        :class="$q.dark.isActive ? 'version-dark' : 'version-light'"
      >
        BuhoGO v{{ appVersion }}
      </a>

    </div>

    <!-- Custom Donation Dialog -->
    <q-dialog v-model="showDonationDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="donation-dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Support BuhoGO') }}
          </div>
          <q-btn flat round dense icon="las la-times" v-close-popup
                 :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"/>
        </q-card-section>
        <q-card-section class="donation-dialog-content">
          <q-input
            v-model.number="customDonationAmount"
            type="number"
            outlined
            :label="$t('Amount')"
            class="donation-input"
            :dark="$q.dark.isActive"
          />
          <q-btn
            unelevated
            no-caps
            class="send-donation-btn action-btn-green"
            :loading="donationLoading === 'custom'"
            :disable="!customDonationAmount || customDonationAmount < 1"
            @click="handleDonation(customDonationAmount)"
          >
            {{ $t('Send Donation') }}
          </q-btn>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Donation Invoice Dialog (with QR code) -->
    <q-dialog v-model="showDonationInvoiceDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="donation-invoice-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Donate') }} {{ formatSats(donationInvoiceAmount) }}
          </div>
          <q-btn flat round dense icon="las la-times" v-close-popup
                 :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"/>
        </q-card-section>
        <q-card-section class="donation-invoice-content">
          <div class="donation-qr-wrapper" @click="copyDonationInvoice">
            <vue-qrcode
              v-if="donationInvoice"
              :value="donationInvoice"
              :options="{ width: 220, margin: 0, color: { dark: '#000000', light: '#ffffff' } }"
              class="donation-qr"
            />
          </div>
          <div class="donation-qr-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ $t('Tap QR to copy invoice') }}
          </div>
          <q-btn
            unelevated
            no-caps
            class="open-wallet-btn action-btn-green"
            @click="openInWallet"
          >
            <q-icon name="las la-external-link-alt" class="q-mr-sm"/>
            {{ $t('Open in Wallet') }}
          </q-btn>
          <div class="donation-portal-section">
            <q-separator :class="$q.dark.isActive ? 'bg-grey-8' : 'bg-grey-3'" class="q-my-md"/>
            <div class="donation-portal-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t('See top donors & recent donations') }}
            </div>
            <q-btn
              flat
              no-caps
              dense
              class="donation-portal-link"
              @click="openSupportPortal"
            >
              <q-icon name="las la-heart" class="q-mr-xs"/>
              {{ $t('Donations Portal') }}
            </q-btn>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Danger Confirmation Dialog -->
    <q-dialog v-model="showDangerConfirmDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="danger-confirm-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="danger-header">
          <div class="danger-icon-wrapper">
            <q-icon name="las la-exclamation-triangle" size="32px" class="danger-icon"/>
          </div>
          <div class="danger-title">{{ dangerConfirmTitle }}</div>
          <div class="danger-message" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ dangerConfirmMessage }}
          </div>
        </q-card-section>

        <q-card-section class="danger-content">
          <div class="confirm-instruction" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ $t('Type') }} <span class="confirm-phrase">"{{ dangerConfirmPhrase }}"</span> {{ $t('to confirm') }}
          </div>
          <q-input
            v-model="dangerConfirmInput"
            outlined
            dense
            :placeholder="dangerConfirmPhrase"
            class="confirm-input"
            :dark="$q.dark.isActive"
            @keyup.enter="executeDangerAction"
          />
        </q-card-section>

        <q-card-actions class="danger-actions">
          <q-btn
            flat
            no-caps
            :label="$t('Cancel')"
            v-close-popup
            class="cancel-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          />
          <q-btn
            unelevated
            no-caps
            :label="dangerConfirmButtonText"
            :disable="dangerConfirmInput !== dangerConfirmPhrase"
            :loading="isDangerActionLoading"
            class="danger-action-btn"
            @click="executeDangerAction"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Language Dialog -->
    <q-dialog v-model="showLanguageDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
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
    <q-dialog v-model="showCurrencyDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
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
                  {{ getCurrencySymbol(currency) }}1 = {{ formatSats(exchangeRates[currency.toLowerCase()]) }}
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
    <q-dialog v-model="showWalletsDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="wallets-dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <!-- Fixed Header -->
        <q-card-section class="dialog-header wallets-dialog-header">
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

        <!-- Scrollable Content -->
        <q-card-section class="wallets-dialog-content">
          <!-- Wallet Statistics -->
          <div class="wallet-stats" :class="$q.dark.isActive ? 'stats-dark' : 'stats-light'" v-if="wallets.length > 0">
            <div class="stat-item">
              <div class="stat-value" :class="$q.dark.isActive ? 'balance_dark' : 'balance_light'">
                {{ wallets.length }}
              </div>
              <div class="stat-label" :class="$q.dark.isActive ? 'sats' : 'sats-light'">
                {{ $t('Wallets') }}
              </div>
            </div>
            <div class="stat-divider" :class="$q.dark.isActive ? 'divider-dark' : 'divider-light'"></div>
            <div class="stat-item">
              <div class="stat-value" :class="$q.dark.isActive ? 'balance_dark' : 'balance_light'">
                {{ formatBalance(totalBalance) }}
              </div>
              <div class="stat-label" :class="$q.dark.isActive ? 'sats' : 'sats-light'">
                {{ $t('Total') }}
              </div>
            </div>
            <div class="stat-divider" :class="$q.dark.isActive ? 'divider-dark' : 'divider-light'"></div>
            <div class="stat-item">
              <div class="stat-value online-value">
                {{ connectedWallets.length }}/{{ wallets.length }}
              </div>
              <div class="stat-label" :class="$q.dark.isActive ? 'sats' : 'sats-light'">
                {{ $t('Online') }}
              </div>
            </div>
          </div>

          <!-- Add Wallet Button -->
          <q-btn
            class="add-wallet-btn"
            :class="$q.dark.isActive ? 'add-wallet-btn-dark' : 'add-wallet-btn-light'"
            no-caps
            flat
            @click="showAddWalletDialog = true"
          >
            <q-icon name="las la-plus-circle" size="20px" class="q-mr-sm"/>
            {{ $t('Add Wallet') }}
          </q-btn>

          <!-- Scrollable Wallet List -->
          <div class="wallets-list-container">
            <div v-if="wallets.length === 0" class="no-wallets">
              <q-icon name="las la-wallet" size="48px" class="no-wallets-icon"
                      :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-4'"/>
              <div class="no-wallets-text" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
                {{ $t('No wallets connected yet') }}
              </div>
              <div class="no-wallets-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                {{ $t('Tap "Add Wallet" to get started') }}
              </div>
            </div>

            <div class="wallets-list-scroll">
              <div
                v-for="wallet in sortedWallets"
                :key="wallet.id"
                class="wallet-card"
                :class="{
                  'wallet-card-active': wallet.id === activeWalletId,
                  'wallet-card-disconnected': !connectionStates[wallet.id]?.connected,
                  'wallet-card-dark': $q.dark.isActive,
                  'wallet-card-light': !$q.dark.isActive
                }"
              >
                <!-- Wallet Avatar -->
                <div class="wallet-avatar">
                  <div class="wallet-avatar-circle wallet-avatar-black">
                    <!-- Spark Logo -->
                    <svg v-if="wallet.type === 'spark'" width="20" height="19" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="white"/>
                    </svg>
                    <!-- NWC Logo -->
                    <svg v-else-if="wallet.type === 'nwc'" width="20" height="20" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="url(#nwc_settings_grad)"/>
                      <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="#897FFF"/>
                      <defs>
                        <linearGradient id="nwc_settings_grad" x1="123.989" y1="10.4384" x2="123.989" y2="249.939" gradientUnits="userSpaceOnUse">
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
                    <q-icon v-else name="las la-wallet" size="20px" color="white"/>
                  </div>
                  <div
                    class="wallet-status-dot"
                    :class="connectionStates[wallet.id]?.connected ? 'status-connected' : 'status-disconnected'"
                  ></div>
                </div>

                <!-- Wallet Details -->
                <div class="wallet-details">
                  <div class="wallet-header-row">
                    <q-input
                      v-model="wallet.name"
                      dense
                      borderless
                      class="wallet-name-field"
                      :class="$q.dark.isActive ? 'wallet-name-field-dark' : 'wallet-name-field-light'"
                      input-class="wallet-name-input-inner"
                    />
                  </div>
                  <div class="wallet-meta-row">
                    <div class="wallet-type-badge" :class="getTypeBadgeClass(wallet.type)">
                      <!-- Spark mini logo -->
                      <svg v-if="wallet.type === 'spark'" width="10" height="10" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="currentColor"/>
                      </svg>
                      <!-- NWC mini logo -->
                      <svg v-else-if="wallet.type === 'nwc'" width="10" height="10" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="currentColor"/>
                        <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="currentColor"/>
                      </svg>
                      <!-- LNBits mini logo -->
                      <svg v-else-if="wallet.type === 'lnbits'" width="9" height="10" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="currentColor"/>
                      </svg>
                      <q-icon v-else name="las la-wallet" size="10px" />
                      <span>{{ getWalletTypeLabel(wallet) }}</span>
                    </div>
                    <div v-if="wallet.id === activeWalletId" class="wallet-tag tag-active">{{ $t('Active') }}</div>
                  </div>
                  <div class="wallet-balance-row" :class="$q.dark.isActive ? 'wallet-balance-dark' : 'wallet-balance-light'">
                    {{ formatBalance(balances[wallet.id] || 0) }}
                  </div>
                  <div v-if="connectionStates[wallet.id]?.error" class="wallet-error-msg">
                    {{ connectionStates[wallet.id].error }}
                  </div>
                </div>

                <!-- Wallet Actions -->
                <div class="wallet-card-actions">
                  <q-btn
                    v-if="!connectionStates[wallet.id]?.connected"
                    flat
                    round
                    dense
                    icon="las la-sync-alt"
                    @click="reconnectWallet(wallet.id)"
                    :loading="isReconnecting[wallet.id]"
                    class="wallet-action-btn"
                    :class="$q.dark.isActive ? 'wallet-action-btn-dark' : 'wallet-action-btn-light'"
                    size="sm"
                  >
                    <q-tooltip>{{ $t('Reconnect') }}</q-tooltip>
                  </q-btn>

                  <q-btn
                    v-if="wallet.id !== activeWalletId"
                    flat
                    round
                    dense
                    icon="las la-exchange-alt"
                    @click="handleSwitchWallet(wallet.id)"
                    class="wallet-action-btn"
                    :class="$q.dark.isActive ? 'wallet-action-btn-dark' : 'wallet-action-btn-light'"
                    size="sm"
                  >
                    <q-tooltip>{{ $t('Switch') }}</q-tooltip>
                  </q-btn>

                  <q-btn
                    flat
                    round
                    dense
                    icon="las la-trash-alt"
                    @click="confirmRemoveWallet(wallet.id)"
                    class="wallet-action-btn wallet-action-danger"
                    size="sm"
                  >
                    <q-tooltip>{{ $t('Remove') }}</q-tooltip>
                  </q-btn>
                </div>
              </div>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Add Wallet Dialog -->
    <q-dialog v-model="showAddWalletDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
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
          <!-- Spark Wallet Options (only show if no Spark wallet exists) -->
          <div v-if="!hasSparkWallet" class="wallet-type-section">
            <div class="section-label" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ $t('Self-Custodial Wallet') }}
            </div>

            <div
              class="wallet-type-option"
              :class="$q.dark.isActive ? 'option-dark' : 'option-light'"
              @click="navigateToCreateSpark"
            >
              <div class="option-icon spark-option-icon">
                <svg width="24" height="23" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="currentColor"/>
                </svg>
              </div>
              <div class="option-content">
                <div class="option-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                  {{ $t('Create Spark Wallet') }}
                </div>
                <div class="option-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ $t('Generate a new seed phrase') }}
                </div>
              </div>
              <q-icon name="las la-chevron-right" size="18px" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"/>
            </div>

            <div
              class="wallet-type-option"
              :class="$q.dark.isActive ? 'option-dark' : 'option-light'"
              @click="navigateToRestoreSpark"
            >
              <div class="option-icon restore-option-icon">
                <svg width="24" height="23" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="currentColor"/>
                </svg>
              </div>
              <div class="option-content">
                <div class="option-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                  {{ $t('Restore Spark Wallet') }}
                </div>
                <div class="option-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ $t('Import existing seed phrase') }}
                </div>
              </div>
              <q-icon name="las la-chevron-right" size="18px" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"/>
            </div>

            <q-separator class="q-my-md" :class="$q.dark.isActive ? 'bg-grey-8' : 'bg-grey-3'"/>
          </div>

          <!-- LNBits Wallet Section -->
          <div class="wallet-type-section q-mb-md">
            <div class="section-label" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ $t('LNBits Wallet') }}
            </div>

            <div
              class="wallet-type-option"
              :class="$q.dark.isActive ? 'option-dark' : 'option-light'"
              @click="navigateToLNBits"
            >
              <div class="option-icon lnbits-option-icon">
                <svg width="20" height="24" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
                </svg>
              </div>
              <div class="option-content">
                <div class="option-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                  {{ $t('Connect LNBits') }}
                </div>
                <div class="option-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ $t('Link via server URL and API key') }}
                </div>
              </div>
              <q-icon name="las la-chevron-right" size="18px" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"/>
            </div>

          </div>

          <!-- NWC Wallet Section -->
          <div class="wallet-type-section">
            <div class="section-label" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ $t('Custodial Wallet (NWC)') }}
            </div>

            <div
              class="wallet-type-option"
              :class="$q.dark.isActive ? 'option-dark' : 'option-light'"
              @click="navigateToNWC"
            >
              <div class="option-icon nwc-option-icon">
                <svg width="24" height="24" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="url(#nwc_add_grad)"/>
                  <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="#897FFF"/>
                  <defs>
                    <linearGradient id="nwc_add_grad" x1="123.989" y1="10.4384" x2="123.989" y2="249.939" gradientUnits="userSpaceOnUse">
                      <stop stop-color="#FFCA4A"/>
                      <stop offset="1" stop-color="#F7931A"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div class="option-content">
                <div class="option-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                  {{ $t('Connect NWC Wallet') }}
                </div>
                <div class="option-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ $t('Link via Nostr Wallet Connect') }}
                </div>
              </div>
              <q-icon name="las la-chevron-right" size="18px" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"/>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Mempool API Dialog -->
    <q-dialog v-model="showMempoolDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="dialog-card mempool-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Exchange rate source') }}
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
          <!-- Intro -->
          <div class="mempool-intro">
            <div class="mempool-intro-icon" :class="$q.dark.isActive ? 'mempool-intro-icon-dark' : 'mempool-intro-icon-light'">
              <q-icon name="las la-server" size="24px" />
            </div>
            <p class="mempool-intro-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('BuhoGO uses a Mempool server to look up Bitcoin exchange rates. The default works great — or pick your own for extra privacy.') }}
            </p>
          </div>

          <!-- URL Input -->
          <div class="mempool-input-wrap">
            <div class="mempool-input-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('Server URL') }}
            </div>
            <q-input
              v-model="tempMempoolUrl"
              :placeholder="$t('https://mempool.space/api/v1')"
              :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
              borderless
              input-class="q-px-md mempool-url-input"
              dense
              clearable
            />
          </div>

          <!-- Quick-pick servers -->
          <div class="mempool-servers">
            <div class="mempool-servers-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t('Tap to use') }}
            </div>

            <div
              class="server-card"
              :class="[
                $q.dark.isActive ? 'server-card-dark' : 'server-card-light',
                tempMempoolUrl === 'https://mempool.space/api/v1' || !tempMempoolUrl ? 'server-active' : ''
              ]"
              @click="tempMempoolUrl = 'https://mempool.space/api/v1'"
            >
              <div class="server-info">
                <span class="server-name" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">mempool.space</span>
                <span class="server-tag tag-default">{{ $t('Default') }}</span>
              </div>
              <span class="server-url" :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-5'">mempool.space/api/v1</span>
            </div>

            <div
              class="server-card"
              :class="[
                $q.dark.isActive ? 'server-card-dark' : 'server-card-light',
                tempMempoolUrl === 'https://mempool.emzy.de/api/v1' ? 'server-active' : ''
              ]"
              @click="tempMempoolUrl = 'https://mempool.emzy.de/api/v1'"
            >
              <div class="server-info">
                <span class="server-name" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">emzy.de</span>
                <span class="server-tag tag-privacy">{{ $t('Privacy') }}</span>
              </div>
              <span class="server-url" :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-5'">mempool.emzy.de/api/v1</span>
            </div>

            <div
              class="server-card"
              :class="[
                $q.dark.isActive ? 'server-card-dark' : 'server-card-light',
                tempMempoolUrl === 'https://mempool.blocktrainer.de/api/v1' ? 'server-active' : ''
              ]"
              @click="tempMempoolUrl = 'https://mempool.blocktrainer.de/api/v1'"
            >
              <div class="server-info">
                <span class="server-name" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">Blocktrainer</span>
                <span class="server-tag tag-community">{{ $t('Community') }}</span>
              </div>
              <span class="server-url" :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-5'">mempool.blocktrainer.de/api/v1</span>
            </div>
          </div>

          <!-- Rate freshness -->
          <div class="rate-status"
               :class="$q.dark.isActive ? 'status-dark' : 'status-light'">
            <q-icon
              :name="fiatRateAge === null ? 'las la-hourglass-half' : fiatRatesStale ? 'las la-exclamation-triangle' : 'las la-check-circle'"
              :class="fiatRateAge === null ? 'text-grey' : fiatRatesStale ? 'text-orange' : 'text-green'"
              size="16px"
            />
            <span :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              <template v-if="fiatRateAge === null">
                {{ $t('No exchange rates loaded yet') }}
              </template>
              <template v-else-if="fiatRateAge === 0">
                {{ $t('Exchange rates are up to date') }}
              </template>
              <template v-else-if="fiatRatesStale">
                {{ $t('Rates may be outdated — last fetched {n} min ago', { n: fiatRateAge }) }}
              </template>
              <template v-else>
                {{ $t('Rates up to date — refreshed {n} min ago', { n: fiatRateAge }) }}
              </template>
            </span>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="dialog-actions">
          <q-btn
            flat
            :label="$t('Reset')"
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

    <!-- View Mnemonic Dialog -->
    <q-dialog v-model="showViewMnemonicDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="dialog-card seed-phrase-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('View Seed Phrase') }}
          </div>
          <q-btn
            flat
            round
            dense
            icon="las la-times"
            @click="closeViewMnemonicDialog"
            class="close-btn"
            :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
          />
        </q-card-section>

        <q-card-section class="dialog-content">
          <!-- PIN Entry State -->
          <div v-if="!viewedMnemonic" class="seed-pin-entry">
            <!-- Icon Header -->
            <div class="seed-icon-header">
              <div class="seed-icon-circle" :class="$q.dark.isActive ? 'seed-icon-circle-dark' : 'seed-icon-circle-light'">
                <q-icon name="las la-key" size="32px" color="primary"/>
              </div>
            </div>

            <!-- Warning Box -->
            <div class="seed-warning-box">
              <div class="seed-warning-icon-wrap">
                <q-icon name="las la-exclamation-triangle" size="20px"/>
              </div>
              <div class="seed-warning-content">
                <div class="seed-warning-title">{{ $t('Keep it secret') }}</div>
                <div class="seed-warning-text">{{ $t('Never share your seed phrase. Anyone with it can access your funds.') }}</div>
              </div>
            </div>

            <!-- Info Box -->
            <div class="seed-info-box" :class="$q.dark.isActive ? 'seed-info-box-dark' : 'seed-info-box-light'">
              <div class="seed-info-icon-wrap">
                <q-icon name="las la-sync-alt" size="20px"/>
              </div>
              <div class="seed-info-content">
                <div class="seed-info-title" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">{{ $t('Wallet recovery') }}</div>
                <div class="seed-info-text" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">{{ $t('Use this phrase to restore your Spark wallet on another device or if you lose access.') }}</div>
              </div>
            </div>

            <!-- PIN Input -->
            <div class="seed-pin-section">
              <div class="seed-pin-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">{{ $t('Enter your PIN to continue') }}</div>
              <q-input
                v-model="sparkPinInput"
                type="password"
                :placeholder="$t('6-digit PIN')"
                maxlength="6"
                mask="######"
                :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
                borderless
                input-class="q-px-md text-center seed-pin-input"
                dense
              />
            </div>
          </div>

          <!-- Mnemonic Display State -->
          <div v-else class="mnemonic-display">
            <!-- Revealed Warning Banner -->
            <div class="seed-revealed-banner">
              <q-icon name="las la-eye" size="18px"/>
              <span>{{ $t('Your seed phrase is now visible') }}</span>
            </div>

            <!-- Mnemonic Grid -->
            <div class="mnemonic-grid">
              <div
                v-for="(word, index) in viewedMnemonic.split(' ')"
                :key="index"
                class="mnemonic-word"
                :class="$q.dark.isActive ? 'word-dark' : 'word-light'"
              >
                <span class="word-number">{{ index + 1 }}</span>
                <span class="word-text">{{ word }}</span>
              </div>
            </div>

            <!-- Bottom Warning -->
            <div class="seed-bottom-warning">
              <q-icon name="las la-shield-alt" size="16px"/>
              <span>{{ $t('Store in a safe place. Never share online.') }}</span>
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="dialog-actions">
          <q-btn
            flat
            :label="$t('Close')"
            @click="closeViewMnemonicDialog"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          />
          <q-btn
            v-if="!viewedMnemonic"
            flat
            :label="$t('View Seed Phrase')"
            @click="viewMnemonic"
            :loading="isViewingMnemonic"
            :disable="!sparkPinInput || sparkPinInput.length < 6"
            class="continue-action-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            no-caps
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Backup Seed Phrase Dialog -->
    <q-dialog v-model="showBackupDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'" persistent>
      <q-card class="dialog-card backup-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ backupStep === 'pin' ? $t('Backup Seed Phrase') : backupStep === 'show' ? $t('Your Recovery Phrase') : $t('Verify Your Backup') }}
          </div>
          <q-btn
            flat
            round
            dense
            icon="las la-times"
            @click="closeBackupDialog"
            class="close-btn"
            :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
          />
        </q-card-section>

        <q-card-section class="dialog-content">
          <!-- Step 1: PIN Entry -->
          <div v-if="backupStep === 'pin'" class="seed-pin-entry">
            <div class="seed-icon-header">
              <div class="seed-icon-circle" :class="$q.dark.isActive ? 'seed-icon-circle-dark' : 'seed-icon-circle-light'">
                <q-icon name="las la-shield-alt" size="32px" color="primary"/>
              </div>
            </div>

            <div class="seed-warning-box">
              <div class="seed-warning-icon-wrap">
                <q-icon name="las la-exclamation-triangle" size="20px"/>
              </div>
              <div class="seed-warning-content">
                <div class="seed-warning-title">{{ $t('Protect your funds') }}</div>
                <div class="seed-warning-text">{{ $t('You will see your 12-word recovery phrase and then verify it to confirm your backup.') }}</div>
              </div>
            </div>

            <div class="seed-pin-section">
              <div class="seed-pin-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">{{ $t('Enter your PIN to continue') }}</div>
              <q-input
                v-model="backupPinInput"
                type="password"
                :placeholder="$t('6-digit PIN')"
                maxlength="6"
                mask="######"
                :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
                borderless
                input-class="q-px-md text-center seed-pin-input"
                dense
              />
            </div>
          </div>

          <!-- Step 2: Show Recovery Phrase -->
          <div v-else-if="backupStep === 'show'" class="backup-show-step">
            <MnemonicDisplay
              :words="backupMnemonicWords"
              :show-warning="true"
              :show-copy="false"
            />
          </div>

          <!-- Step 3: Verify Recovery Phrase (12-word order) -->
          <div v-else-if="backupStep === 'verify'" class="backup-verify-step">
            <MnemonicOrderVerify
              ref="backupVerifyComponent"
              :mnemonic="backupMnemonicWords"
              @verify-success="onBackupVerified"
              @show-phrase="backupStep = 'show'"
            />
          </div>

          <!-- Alternative: 3-word verification (kept for future use) -->
          <!--
          <div v-else-if="backupStep === 'verify'" class="backup-verify-step">
            <MnemonicVerify
              ref="backupVerifyComponent"
              :mnemonic="backupMnemonicWords"
              @verify-success="onBackupVerified"
            />
          </div>
          -->
        </q-card-section>

        <q-card-actions v-if="backupStep !== 'verify'" align="right" class="dialog-actions">
          <q-btn
            flat
            :label="$t('Cancel')"
            @click="closeBackupDialog"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
            no-caps
          />
          <q-btn
            v-if="backupStep === 'pin'"
            flat
            :label="$t('Continue')"
            @click="startBackup"
            :loading="isLoadingBackup"
            :disable="!backupPinInput || backupPinInput.length < 6"
            class="continue-action-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            no-caps
          />
          <q-btn
            v-if="backupStep === 'show'"
            flat
            :label="$t('I\'ve saved it — Verify now')"
            @click="backupStep = 'verify'"
            class="continue-action-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            no-caps
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Change PIN Dialog -->
    <q-dialog v-model="showChangePinDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="dialog-card pin-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Update your PIN') }}
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
          <!-- Icon + intro -->
          <div class="pin-change-intro">
            <div class="pin-change-icon" :class="$q.dark.isActive ? 'pin-change-icon-dark' : 'pin-change-icon-light'">
              <q-icon name="las la-exchange-alt" size="24px" />
            </div>
            <p class="pin-change-desc" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('Your PIN keeps your wallet private. Pick something memorable that only you know.') }}
            </p>
          </div>

          <div class="pin-inputs-section">
            <div class="pin-field-group">
              <div class="pin-field-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">{{ $t('Current PIN') }}</div>
              <q-input
                v-model="sparkPinInput"
                type="password"
                :placeholder="'------'"
                maxlength="6"
                mask="######"
                :class="$q.dark.isActive ? 'pin-input-dark' : 'pin-input-light'"
                borderless
                input-class="text-center pin-input-field"
                dense
              />
            </div>

            <div class="pin-field-group">
              <div class="pin-field-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">{{ $t('New PIN') }}</div>
              <q-input
                v-model="sparkNewPin"
                type="password"
                :placeholder="'------'"
                maxlength="6"
                mask="######"
                :class="$q.dark.isActive ? 'pin-input-dark' : 'pin-input-light'"
                borderless
                input-class="text-center pin-input-field"
                dense
              />
            </div>

            <div class="pin-field-group">
              <div class="pin-field-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">{{ $t('Repeat new PIN') }}</div>
              <q-input
                v-model="sparkConfirmNewPin"
                type="password"
                :placeholder="'------'"
                maxlength="6"
                mask="######"
                :class="[
                  $q.dark.isActive ? 'pin-input-dark' : 'pin-input-light',
                  sparkConfirmNewPin.length === 6 && sparkNewPin !== sparkConfirmNewPin ? 'pin-input-error' : ''
                ]"
                borderless
                input-class="text-center pin-input-field"
                dense
                :error="sparkConfirmNewPin.length === 6 && sparkNewPin !== sparkConfirmNewPin"
                :error-message="$t('Those don\'t match — try again')"
              />
            </div>
          </div>

          <div class="pin-hint" :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-6'">
            <q-icon name="las la-info-circle" size="14px" class="q-mr-xs" />
            {{ $t('Forgot your PIN? You can restore your wallet using your recovery phrase.') }}
          </div>
        </q-card-section>

        <q-card-actions align="right" class="dialog-actions">
          <q-btn
            flat
            :label="$t('Cancel')"
            v-close-popup
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
            no-caps
          />
          <q-btn
            flat
            :label="$t('Save new PIN')"
            @click="handleChangePin"
            :loading="isChangingPin"
            :disable="!sparkPinInput || sparkPinInput.length < 6 || !sparkNewPin || sparkNewPin.length < 6 || sparkNewPin !== sparkConfirmNewPin"
            class="continue-action-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            no-caps
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Spark Reconnect PIN Dialog -->
    <q-dialog v-model="showSparkReconnectDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Unlock Wallet') }}
          </div>
          <q-btn
            flat
            round
            dense
            icon="las la-times"
            @click="closeSparkReconnectDialog"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          />
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="unlock-info">
            <div class="unlock-icon">
              <q-icon name="las la-lock" size="48px" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'" />
            </div>
            <div class="unlock-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
              {{ $t('Enter your PIN to unlock your Spark wallet') }}
            </div>
          </div>

          <q-input
            v-model="sparkReconnectPin"
            type="password"
            :label="$t('Enter PIN')"
            maxlength="6"
            mask="######"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            borderless
            input-class="q-px-md text-center"
            class="q-mt-lg"
            dense
            autofocus
            @keyup.enter="handleSparkReconnect"
          />
        </q-card-section>

        <q-card-actions align="right" class="dialog-actions">
          <q-btn
            flat
            :label="$t('Cancel')"
            @click="closeSparkReconnectDialog"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          />
          <q-btn
            flat
            :label="$t('Unlock')"
            @click="handleSparkReconnect"
            :loading="isSparkReconnecting"
            :disable="!sparkReconnectPin || sparkReconnectPin.length < 6"
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
import {formatAmount} from '../utils/amountFormatting.js'
import {shareContent} from '../utils/share.js'
import {truncateAddress} from '../utils/addressUtils.js'
import VueQrcode from '@chenfengyuan/vue-qrcode'
import MnemonicDisplay from '../components/MnemonicDisplay.vue'
import MnemonicOrderVerify from '../components/MnemonicOrderVerify.vue'
// import MnemonicVerify from '../components/MnemonicVerify.vue'
import { version } from '../../package.json'

export default {
  name: 'SettingsPage',
  components: {
    VueQrcode,
    MnemonicDisplay,
    MnemonicOrderVerify,
    // MnemonicVerify,
  },
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

      // Spark wallet settings
      showSparkSettingsDialog: false,
      showViewMnemonicDialog: false,
      showChangePinDialog: false,
      sparkPinInput: '',
      sparkNewPin: '',
      sparkConfirmNewPin: '',
      isViewingMnemonic: false,
      viewedMnemonic: '',
      isChangingPin: false,

      // Backup seed phrase dialog
      showBackupDialog: false,
      backupStep: 'pin', // 'pin' | 'show' | 'verify'
      backupPinInput: '',
      backupMnemonicWords: [],
      isLoadingBackup: false,

      // Spark reconnect dialog
      showSparkReconnectDialog: false,
      sparkReconnectWalletId: null,
      sparkReconnectPin: '',
      isSparkReconnecting: false,

      // Donation
      showDonationDialog: false,
      customDonationAmount: null,
      donationAddress: 'buhogo@timecatcher.lnbits.de',
      donationLoading: null,
      showDonationInvoiceDialog: false,
      donationInvoice: '',
      donationInvoiceAmount: 0,

      // Danger confirmation dialog
      showDangerConfirmDialog: false,
      dangerConfirmTitle: '',
      dangerConfirmMessage: '',
      dangerConfirmPhrase: 'I understand',
      dangerConfirmButtonText: '',
      dangerConfirmInput: '',
      dangerConfirmAction: null,
      isDangerActionLoading: false,

      // Wallet removal
      walletToRemove: null,
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
      'exchangeRates',
      'hasSparkWallet',
      'sparkWallet',
      'isActiveWalletSpark',
      'activeSparkAddress',
      'useBip177Format',
      'hasBackedUp'
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
    },

    appVersion() {
      return version;
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

    // Handle deep link from backup banner
    if (this.$route.query.section === 'backup' && this.hasSparkWallet) {
      this.$nextTick(() => this.openBackupDialog());
    }
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
      'disconnectNwcWallets',
      'disconnectLNBitsWallets',
      'updateCurrencyPreferences',
      'loadExchangeRates',
      'getSparkMnemonic',
      'changeSparkPin',
      'connectSparkWallet',
      'updateBip177Preference',
      'confirmBackup'
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

    updateAmountFormat(value) {
      this.updateBip177Preference(value)

      // Show confirmation
      this.$q.notify({
        type: 'positive',
        message: value
          ? this.$t('Amount format changed to BIP-177 (₿)')
          : this.$t('Amount format changed to Legacy (sats)'),
        
        timeout: 2000
      })
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
      return formatAmount(balance, this.useBip177Format)
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
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Connection failed'),
          caption: this.$t('Please check your connection and try again'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } finally {
        this.isAddingWallet = false
      }
    },

    async reconnectWallet(walletId) {
      if (this.isReconnecting[walletId]) return

      // Check if this is a Spark wallet
      const wallet = this.wallets.find(w => w.id === walletId)
      if (wallet?.type === 'spark') {
        // Show PIN dialog for Spark wallets
        this.sparkReconnectWalletId = walletId
        this.sparkReconnectPin = ''
        this.showSparkReconnectDialog = true
        return
      }

      // NWC wallet - proceed with normal reconnection
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

    /**
     * Handle Spark wallet reconnection with PIN
     */
    async handleSparkReconnect() {
      if (!this.sparkReconnectPin || this.sparkReconnectPin.length < 6) {
        this.$q.notify({
          type: 'warning',
          message: this.$t('Please enter your 6-digit PIN'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
        return
      }

      this.isSparkReconnecting = true

      try {
        await this.connectSparkWallet(this.sparkReconnectWalletId, this.sparkReconnectPin)

        this.showSparkReconnectDialog = false
        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet unlocked'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } catch (error) {
        const isInvalidPin = error.message?.toLowerCase().includes('invalid pin')
        this.$q.notify({
          type: 'negative',
          message: isInvalidPin ? this.$t('Incorrect PIN') : this.$t('Reconnection failed'),
          caption: this.$t('Please try again'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
        // Clear PIN on error
        this.sparkReconnectPin = ''
      } finally {
        this.isSparkReconnecting = false
      }
    },

    closeSparkReconnectDialog() {
      this.showSparkReconnectDialog = false
      this.sparkReconnectWalletId = null
      this.sparkReconnectPin = ''
    },

    async handleSwitchWallet(walletId) {
      try {
        await this.switchActiveWallet(walletId)
        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet switched'),
          
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

    confirmDisconnectNwc() {
      this.dangerConfirmTitle = this.$t('Remove NWC Connections');
      this.dangerConfirmMessage = this.$t('This will remove all NWC wallet connections. Your Spark wallet will not be affected. You can reconnect NWC wallets later using your connection strings.');
      this.dangerConfirmPhrase = 'I understand';
      this.dangerConfirmButtonText = this.$t('Remove NWC');
      this.dangerConfirmInput = '';
      this.dangerConfirmAction = 'disconnectNwc';
      this.showDangerConfirmDialog = true;
    },

    confirmDisconnectLNBits() {
      this.dangerConfirmTitle = this.$t('Remove LNBits Connections');
      this.dangerConfirmMessage = this.$t('This will remove all LNBits wallet connections. Your Spark wallet and NWC connections will not be affected. You can reconnect LNBits wallets later using your credentials.');
      this.dangerConfirmPhrase = 'I understand';
      this.dangerConfirmButtonText = this.$t('Remove LNBits');
      this.dangerConfirmInput = '';
      this.dangerConfirmAction = 'disconnectLNBits';
      this.showDangerConfirmDialog = true;
    },

    async executeDangerAction() {
      if (this.dangerConfirmInput !== this.dangerConfirmPhrase) return;

      this.isDangerActionLoading = true;

      try {
        if (this.dangerConfirmAction === 'disconnectNwc') {
          await this.disconnectNwcWallets();
          this.$q.notify({
            type: 'positive',
            message: this.$t('NWC connections removed'),

            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
          this.showDangerConfirmDialog = false;
        } else if (this.dangerConfirmAction === 'disconnectLNBits') {
          await this.disconnectLNBitsWallets();
          this.$q.notify({
            type: 'positive',
            message: this.$t('LNBits connections removed'),

            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
          this.showDangerConfirmDialog = false;
        } else if (this.dangerConfirmAction === 'deleteSparkWallet') {
          await this.removeWallet(this.sparkWallet.id);
          this.$q.notify({
            type: 'positive',
            message: this.$t('Spark wallet deleted'),
            
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
          this.showDangerConfirmDialog = false;
        } else if (this.dangerConfirmAction === 'removeWallet') {
          await this.removeWallet(this.walletToRemove.id);
          this.$q.notify({
            type: 'positive',
            message: this.$t('Wallet removed'),
            
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
          this.showDangerConfirmDialog = false;
          this.walletToRemove = null;
        }

        // Redirect to welcome page if no wallets remain after any deletion
        if (this.wallets.length === 0) {
          this.$router.push('/');
        }
      } catch (error) {
        console.error('Danger action error:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Action failed'),
          caption: this.$t('Please try again'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } finally {
        this.isDangerActionLoading = false;
      }
    },

    /**
     * Handle donation - fetches LNURL-pay invoice and shows QR code
     */
    async handleDonation(amount) {
      const loadingKey = amount === this.customDonationAmount ? 'custom' : amount;
      this.donationLoading = loadingKey;

      try {
        // Parse lightning address to get LNURL-pay endpoint
        const [name, domain] = this.donationAddress.split('@');
        const lnurlPayUrl = `https://${domain}/.well-known/lnurlp/${name}`;

        // Step 1: Fetch LNURL-pay params
        const paramsResponse = await fetch(lnurlPayUrl);
        if (!paramsResponse.ok) {
          throw new Error('Failed to fetch LNURL-pay params');
        }
        const params = await paramsResponse.json();

        if (params.status === 'ERROR') {
          throw new Error(params.reason || 'LNURL-pay error');
        }

        // Validate amount is within bounds (params use millisats)
        const amountMsat = amount * 1000;
        if (amountMsat < params.minSendable || amountMsat > params.maxSendable) {
          const minSats = Math.ceil(params.minSendable / 1000);
          const maxSats = Math.floor(params.maxSendable / 1000);
          const minFormatted = formatAmount(minSats, this.useBip177Format);
          const maxFormatted = formatAmount(maxSats, this.useBip177Format);
          throw new Error(`Amount must be between ${minFormatted} and ${maxFormatted}`);
        }

        // Step 2: Request invoice from callback URL
        const callbackUrl = new URL(params.callback);
        callbackUrl.searchParams.set('amount', amountMsat.toString());

        const invoiceResponse = await fetch(callbackUrl.toString());
        if (!invoiceResponse.ok) {
          throw new Error('Failed to fetch invoice');
        }
        const invoiceData = await invoiceResponse.json();

        if (invoiceData.status === 'ERROR') {
          throw new Error(invoiceData.reason || 'Failed to generate invoice');
        }

        // Success - show the invoice QR
        this.donationInvoice = invoiceData.pr;
        this.donationInvoiceAmount = amount;
        this.showDonationDialog = false;
        this.customDonationAmount = null;
        this.showDonationInvoiceDialog = true;

      } catch (error) {
        console.error('Donation error:', error);
        // Fallback to copying the lightning address
        this.$q.notify({
          type: 'warning',
          message: this.$t('Couldn\'t generate invoice'),
          caption: this.$t('Copy the lightning address instead: {address}', { address: this.donationAddress }),
          
          timeout: 10000,
          actions: [
            {
              label: this.$t('Copy'),
              color: 'white',
              handler: () => {
                navigator.clipboard.writeText(this.donationAddress);
                this.$q.notify({
                  type: 'positive',
                  message: this.$t('Address copied'),
                  
                });
              }
            }
          ]
        });
      } finally {
        this.donationLoading = null;
      }
    },

    /**
     * Copy donation invoice to clipboard
     */
    copyDonationInvoice() {
      if (!this.donationInvoice) return;

      navigator.clipboard.writeText(this.donationInvoice);
      this.$q.notify({
        type: 'positive',
        message: this.$t('Invoice copied'),
        
        timeout: 2000
      });
    },

    /**
     * Open invoice in external wallet via lightning: URL
     */
    openInWallet() {
      if (!this.donationInvoice) return;
      window.location.href = `lightning:${this.donationInvoice}`;
    },

    /**
     * Open the donations support portal
     */
    openSupportPortal() {
      window.open('https://support-buhogo.netlify.app', '_blank');
    },

    /**
     * Format bitcoin amount for display (BIP-177)
     */
    formatSats(amount) {
      // Use utility for BIP-177 or Legacy format
      return formatAmount(amount, this.useBip177Format);
    },

    confirmRemoveWallet(walletId) {
      const wallet = this.wallets.find(w => w.id === walletId)
      if (!wallet) return

      this.walletToRemove = wallet
      this.dangerConfirmTitle = this.$t('Remove Wallet')
      this.dangerConfirmMessage = this.$t('Are you sure you want to remove "{name}"? This action cannot be undone.', { name: wallet.name })
      this.dangerConfirmPhrase = 'I understand'
      this.dangerConfirmButtonText = this.$t('Remove Wallet')
      this.dangerConfirmInput = ''
      this.dangerConfirmAction = 'removeWallet'
      this.showDangerConfirmDialog = true
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
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } else {
        const pinState = JSON.parse(localStorage.getItem('buhoGO_pin_state'));
        if (pinState.pin !== this.currentPin) {
          this.$q.notify({
            type: 'negative',
            message: this.$t('Incorrect PIN'),
            
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
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });

      } catch (error) {
        console.error('Error testing Mempool URL:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('API connection failed'),
          caption: this.$t('Please check the URL and try again'),
          
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
        
        actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
      })
    },

    loadLanguagePreference() {
      const savedLanguage = localStorage.getItem('buhoGO_language')
      if (savedLanguage && this.localeOptions.find(lang => lang.value === savedLanguage)) {
        this.$i18n.locale = savedLanguage
      }
    },

    // Spark wallet methods
    getWalletTypeIcon(wallet) {
      return wallet.type === 'spark' ? 'las la-bolt' : 'las la-link';
    },

    getWalletTypeLabel(wallet) {
      switch (wallet.type) {
        case 'spark': return 'Spark';
        case 'lnbits': return 'LNBits';
        case 'nwc':
        default: return 'NWC';
      }
    },

    getTypeBadgeClass(type) {
      switch (type) {
        case 'spark': return 'type-spark';
        case 'lnbits': return 'type-lnbits';
        case 'nwc':
        default: return 'type-nwc';
      }
    },

    async copySparkAddress() {
      if (!this.activeSparkAddress) return;
      try {
        await navigator.clipboard.writeText(this.activeSparkAddress);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Spark address copied'),

          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to copy'),

          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      }
    },

    async shareSparkAddress() {
      if (!this.activeSparkAddress) return;

      const result = await shareContent({
        title: this.$t('Spark Address'),
        text: this.activeSparkAddress
      });

      if (result.success) {
        // Share was successful - no notification needed, native share UI provides feedback
      } else if (result.reason === 'unsupported' || result.reason === 'error') {
        if (result.reason === 'error') {
          console.error('Failed to share Spark address:', result.error);
        }
        // Fallback to copy if share is not supported or failed
        await this.copySparkAddress();
      }
      // Don't do anything for 'cancelled' - user just closed the dialog
    },

    openViewMnemonicDialog() {
      this.sparkPinInput = '';
      this.viewedMnemonic = '';
      this.isViewingMnemonic = false;
      this.showViewMnemonicDialog = true;
    },

    async viewMnemonic() {
      if (!this.sparkPinInput || this.sparkPinInput.length < 6) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Please enter your PIN'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
        return;
      }

      this.isViewingMnemonic = true;
      try {
        const mnemonic = await this.getSparkMnemonic(this.sparkPinInput);
        this.viewedMnemonic = mnemonic;
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Incorrect PIN'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
        this.sparkPinInput = '';
      } finally {
        this.isViewingMnemonic = false;
      }
    },

    closeViewMnemonicDialog() {
      this.showViewMnemonicDialog = false;
      this.sparkPinInput = '';
      this.viewedMnemonic = '';
    },

    // ==========================================
    // Backup Seed Phrase
    // ==========================================

    openBackupDialog() {
      this.backupPinInput = '';
      this.backupMnemonicWords = [];
      this.backupStep = 'pin';
      this.isLoadingBackup = false;
      this.showBackupDialog = true;
    },

    async startBackup() {
      if (!this.backupPinInput || this.backupPinInput.length < 6) return;

      this.isLoadingBackup = true;
      try {
        const mnemonic = await this.getSparkMnemonic(this.backupPinInput);
        this.backupMnemonicWords = mnemonic.split(' ');
        this.backupStep = 'show';
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Incorrect PIN'),
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
        this.backupPinInput = '';
      } finally {
        this.isLoadingBackup = false;
      }
    },

    async onBackupVerified() {
      await this.confirmBackup();
      this.showBackupDialog = false;
      this.$q.notify({
        type: 'positive',
        message: this.$t('Backup verified successfully!'),
        caption: this.$t('Your recovery phrase has been confirmed.'),
      });
    },

    closeBackupDialog() {
      this.showBackupDialog = false;
      this.backupPinInput = '';
      this.backupMnemonicWords = [];
      this.backupStep = 'pin';
    },

    openChangePinDialog() {
      this.sparkPinInput = '';
      this.sparkNewPin = '';
      this.sparkConfirmNewPin = '';
      this.showChangePinDialog = true;
    },

    async handleChangePin() {
      if (!this.sparkPinInput || this.sparkPinInput.length < 6) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Please enter your current PIN'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
        return;
      }

      if (!this.sparkNewPin || this.sparkNewPin.length < 6) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('New PIN must be 6 digits'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
        return;
      }

      if (this.sparkNewPin !== this.sparkConfirmNewPin) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('PINs do not match'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
        return;
      }

      this.isChangingPin = true;
      try {
        await this.changeSparkPin(this.sparkPinInput, this.sparkNewPin);
        this.$q.notify({
          type: 'positive',
          message: this.$t('PIN changed successfully'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
        this.showChangePinDialog = false;
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: error.message || this.$t('Failed to change PIN'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } finally {
        this.isChangingPin = false;
        this.sparkPinInput = '';
        this.sparkNewPin = '';
        this.sparkConfirmNewPin = '';
      }
    },

    confirmDeleteSparkWallet() {
      if (!this.sparkWallet) return;

      this.dangerConfirmTitle = this.$t('Delete Spark Wallet');
      this.dangerConfirmMessage = this.$t('This will permanently delete your Spark wallet. Make sure you have backed up your seed phrase. This action cannot be undone.');
      this.dangerConfirmPhrase = 'I understand';
      this.dangerConfirmButtonText = this.$t('Delete Wallet');
      this.dangerConfirmInput = '';
      this.dangerConfirmAction = 'deleteSparkWallet';
      this.showDangerConfirmDialog = true;
    },

    truncateAddress(address) {
      return truncateAddress(address);
    },

    navigateToCreateSpark() {
      this.showAddWalletDialog = false;
      this.$router.push('/spark-setup');
    },

    navigateToRestoreSpark() {
      this.showAddWalletDialog = false;
      this.$router.push('/spark-restore');
    },

    navigateToLNBits() {
      this.showAddWalletDialog = false;
      this.$router.push('/lnbits-setup');
    },

    navigateToNWC() {
      this.showAddWalletDialog = false;
      this.$router.push('/nwc-setup');
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
  padding: 1rem 1rem 2rem;
}

/* Section Labels */
.section-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin: 1.5rem 0 0.5rem 0.25rem;
}

.section-label:first-child {
  margin-top: 0.5rem;
}

.section-label-dark {
  color: #666;
}

.section-label-light {
  color: #6B7280;
}

/* Settings Cards */
.settings-card {
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 0;
}

.card-dark {
  background: #1A1A1A;
}

.card-light {
  background: #FFFFFF;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

/* Q-Item Styles */
.settings-card :deep(.q-item) {
  padding: 14px 16px;
  min-height: 48px;
}

.item-label-dark {
  color: #FFFFFF;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 500;
}

.item-label-light {
  color: #1F2937;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 500;
}

.item-caption-dark {
  color: #666;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
}

.item-caption-light {
  color: #9CA3AF;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
}

.mono-caption {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 11px;
}

/* Side Values */
.side-value {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 15px;
  margin-right: 4px;
}

.side-value-dark {
  color: #666;
}

.side-value-light {
  color: #9CA3AF;
}

/* Chevrons */
.chevron-dark {
  color: #444;
  font-size: 18px;
}

.chevron-light {
  color: #D1D5DB;
  font-size: 18px;
}

/* Separators */
.separator-dark {
  background: #2A2A2A;
  margin-left: 16px;
}

.separator-light {
  background: #F3F4F6;
  margin-left: 16px;
}

/* Danger Text */
.danger-text {
  color: #EF4444 !important;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 500;
}

.text-center {
  text-align: center;
  width: 100%;
}

/* Support Card */
.support-card {
  padding: 1rem;
}

.support-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.support-message {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.support-message-dark {
  color: #888;
}

.support-message-light {
  color: #6B7280;
}

.donation-row {
  display: flex;
  gap: 0.5rem;
  width: 100%;
  justify-content: center;
}

.donate-btn {
  min-width: 80px;
  height: 36px;
  border-radius: 8px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
}

.donate-btn-dark {
  color: #888;
}

.donate-btn-light {
  color: #6B7280;
}

.donate-btn-primary {
  background: #15DE72;
  color: #000;
}

/* Donation Dialog */
.donation-dialog-card {
  width: 100%;
  max-width: 320px;
  border-radius: 16px;
}

.donation-dialog-content {
  padding: 0 1.25rem 1.25rem;
}

.donation-input {
  margin-bottom: 1rem;
}

.send-donation-btn {
  width: 100%;
  height: 44px;
  border-radius: 10px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 600;
}

.action-btn-green {
  background: #15DE72 !important;
  color: #000 !important;
}

.action-btn-green:disabled {
  opacity: 0.4;
}

/* Donation Invoice Dialog */
.donation-invoice-card {
  width: 100%;
  max-width: 320px;
  border-radius: 16px;
}

.donation-invoice-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 1.25rem 1.25rem;
}

.donation-qr-wrapper {
  background: #fff;
  padding: 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.donation-qr-wrapper:active {
  transform: scale(0.98);
}

.donation-qr-hint {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  margin-top: 8px;
  margin-bottom: 16px;
}

.open-wallet-btn {
  width: 100%;
  height: 44px;
  border-radius: 10px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 600;
}

.donation-portal-section {
  width: 100%;
  text-align: center;
  margin-top: 8px;
}

.donation-portal-hint {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 11px;
  margin-bottom: 4px;
}

.donation-portal-link {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #ff6b9d;
}

.donation-portal-link .q-icon {
  color: #ff6b9d;
}

/* Danger Confirmation Dialog */
.danger-confirm-card {
  width: 100%;
  max-width: 340px;
  border-radius: 16px;
}

.danger-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1.5rem 1.5rem 0.5rem;
}

.danger-icon-wrapper {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.danger-icon {
  color: #EF4444;
}

.danger-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #EF4444;
  margin-bottom: 0.5rem;
}

.danger-message {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

.danger-content {
  padding: 1rem 1.5rem;
}

.confirm-instruction {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  margin-bottom: 0.75rem;
  text-align: center;
}

.confirm-phrase {
  font-weight: 600;
  color: #EF4444;
}

.confirm-input {
  margin-bottom: 0;
}

.confirm-input :deep(.q-field__control) {
  border-radius: 10px;
}

.danger-actions {
  padding: 0.5rem 1.5rem 1.5rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.cancel-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-weight: 600;
  border-radius: 10px;
}

.danger-action-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-weight: 600;
  border-radius: 10px;
  background: #EF4444 !important;
  color: white !important;
}

.danger-action-btn:disabled {
  opacity: 0.4;
}

/* Spark Address Actions */
.spark-address-actions {
  display: flex;
  flex-direction: row;
  gap: 4px;
}

.action-icon-dark {
  color: rgba(255, 255, 255, 0.6);
}

.action-icon-dark:hover {
  color: rgba(255, 255, 255, 0.9);
}

.action-icon-light {
  color: rgba(0, 0, 0, 0.5);
}

.action-icon-light:hover {
  color: rgba(0, 0, 0, 0.8);
}

/* App Version */
.app-version {
  display: block;
  text-align: center;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  padding: 2rem 1rem 1rem;
  text-decoration: none;
  transition: color 0.2s ease;
}

.app-version:hover {
  color: #15DE72 !important;
}

.version-dark {
  color: #555;
}

.version-light {
  color: #9CA3AF;
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
  background: linear-gradient(135deg, #059573, #15DE72);
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

.stat-value.online-value {
  color: #15DE72;
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
/* Wallets Dialog - Scrollable Layout */
.wallets-dialog-card {
  width: 100%;
  max-width: 480px;
  max-height: 85vh;
  border-radius: 24px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.wallets-dialog-header {
  flex-shrink: 0;
}

/* Add Wallet Button */
.add-wallet-btn {
  width: 100%;
  height: 48px;
  border-radius: 14px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  margin-top: 1rem;
  border: 2px dashed;
  transition: all 0.2s ease;
}

.add-wallet-btn-dark {
  color: #15DE72;
  border-color: #2A342A;
  background: transparent;
}

.add-wallet-btn-dark:hover {
  border-color: #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.add-wallet-btn-light {
  color: #059573;
  border-color: #E5E7EB;
  background: transparent;
}

.add-wallet-btn-light:hover {
  border-color: #15DE72;
  background: rgba(21, 222, 114, 0.08);
}

.wallets-dialog-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.5rem 1.5rem;
  min-height: 0;
}

.wallets-list-container {
  margin-top: 1rem;
}

.wallets-list-scroll {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.no-wallets {
  text-align: center;
  padding: 2rem;
}

.no-wallets-icon {
  margin-bottom: 1rem;
}

.no-wallets-hint {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  margin-top: 0.5rem;
  opacity: 0.5;
}

.no-wallets-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Wallet Card - Clean iOS-style */
.wallet-card {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  border-radius: 12px;
  transition: background 0.15s ease;
}

.wallet-card-dark {
  background: #1A1A1A;
}

.wallet-card-light {
  background: #FFF;
}

.wallet-card-dark:hover {
  background: #222;
}

.wallet-card-light:hover {
  background: #F9FAFB;
}

.wallet-card-active {
  box-shadow: inset 0 0 0 1px #15DE72;
  background: rgba(21, 222, 114, 0.03);
}

.wallet-card-active.wallet-card-dark:hover {
  background: rgba(21, 222, 114, 0.06);
}

.wallet-card-active.wallet-card-light:hover {
  background: rgba(21, 222, 114, 0.05);
}

.wallet-card-disconnected {
  opacity: 0.65;
}

/* Wallet Avatar */
.wallet-avatar {
  position: relative;
  flex-shrink: 0;
}

.wallet-avatar-circle {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
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

.wallet-avatar-black {
  background: linear-gradient(135deg, #2A2A2A, #1A1A1A);
}

.wallet-status-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid;
}

.wallet-card-dark .wallet-status-dot {
  border-color: #1A1A1A;
}

.wallet-card-light .wallet-status-dot {
  border-color: #FFF;
}

.status-connected {
  background: #15DE72;
}

.status-disconnected {
  background: #EF4444;
}

/* Wallet Details */
.wallet-details {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.wallet-header-row {
  margin-bottom: 0.125rem;
}

.wallet-name-field {
  max-width: 180px;
}

.wallet-name-field :deep(.q-field__control) {
  min-height: 0;
  padding: 0;
  height: 24px;
}

.wallet-name-field :deep(.q-field__native) {
  padding: 0 0.25rem;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 600;
  line-height: 24px;
  border-radius: 4px;
  transition: background 0.15s ease;
}

.wallet-name-field-dark :deep(.q-field__native) {
  color: #F6F6F6;
}

.wallet-name-field-light :deep(.q-field__native) {
  color: #212121;
}

.wallet-name-field-dark :deep(.q-field__native:hover),
.wallet-name-field-dark :deep(.q-field__native:focus) {
  background: rgba(255, 255, 255, 0.05);
}

.wallet-name-field-light :deep(.q-field__native:hover),
.wallet-name-field-light :deep(.q-field__native:focus) {
  background: rgba(0, 0, 0, 0.03);
}

/* Wallet Meta Row */
.wallet-meta-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-bottom: 0.25rem;
  flex-wrap: wrap;
}

.wallet-type-badge {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.125rem 0.4rem;
  border-radius: 6px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 9px;
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
  font-size: 9px;
  font-weight: 600;
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  text-transform: capitalize;
  letter-spacing: 0.02em;
}

.tag-active {
  background: #D1FAE5;
  color: #065F46;
}

/* Wallet Balance */
.wallet-balance-row {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  font-weight: 500;
}

.wallet-balance-dark {
  color: #777;
}

.wallet-balance-light {
  color: #9CA3AF;
}

.wallet-error-msg {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 10px;
  color: #EF4444;
  font-weight: 500;
  margin-top: 0.125rem;
}

/* Wallet Card Actions */
.wallet-card-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

.wallet-action-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.wallet-action-btn-dark {
  color: #666;
}

.wallet-action-btn-light {
  color: #9CA3AF;
}

.wallet-action-btn-dark:hover {
  background: rgba(21, 222, 114, 0.1);
  color: #15DE72;
}

.wallet-action-btn-light:hover {
  background: rgba(21, 222, 114, 0.1);
  color: #15DE72;
}

.wallet-action-danger {
  color: #777;
}

.wallet-action-danger:hover {
  background: rgba(239, 68, 68, 0.1) !important;
  color: #EF4444 !important;
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

  .currency-item {
    padding: 0.75rem;
  }

  .wallet-card {
    padding: 0.75rem;
    gap: 0.75rem;
    border-radius: 10px;
  }

  .app-title {
    font-size: 18px;
  }

  .wallet-avatar-circle {
    width: 40px;
    height: 40px;
  }

  .wallet-avatar-circle .q-icon {
    font-size: 20px !important;
  }

  .wallet-status-dot {
    width: 10px;
    height: 10px;
  }

  .wallet-name-field :deep(.q-field__native) {
    font-size: 14px;
  }

  .wallet-type-badge,
  .wallet-tag {
    font-size: 8px;
    padding: 0.1rem 0.35rem;
  }

  .wallet-balance-row {
    font-size: 11px;
  }

  .wallet-action-btn {
    width: 28px;
    height: 28px;
  }

  /* Wallets Dialog Mobile */
  .wallets-dialog-card {
    max-height: 90vh;
  }

  .add-wallet-btn {
    height: 42px;
    font-size: 13px;
    margin-top: 0.75rem;
  }

  .wallets-dialog-content {
    padding: 0.75rem 1rem 1rem;
  }

  .wallet-stats {
    padding: 0.75rem;
  }

  .stat-value {
    font-size: 14px;
  }

  .stat-label {
    font-size: 9px;
  }

  .dialog-actions {
    padding: 1rem 1.25rem 1.25rem;
  }
}

/* Mempool Dialog Styles */
/* Mempool Dialog */
.mempool-dialog {
  width: 100%;
  max-width: 420px;
}

.mempool-intro {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-bottom: 1.25rem;
  text-align: center;
}

.mempool-intro-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mempool-intro-icon-dark {
  background: rgba(21, 222, 114, 0.1);
  color: #15DE72;
}

.mempool-intro-icon-light {
  background: rgba(5, 149, 115, 0.08);
  color: #059573;
}

.mempool-intro-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  max-width: 320px;
}

.mempool-input-wrap {
  margin-bottom: 1rem;
}

.mempool-input-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}

.mempool-url-input {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 12px;
}

/* Server cards */
.mempool-servers {
  margin-bottom: 1rem;
}

.mempool-servers-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.server-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1.5px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 6px;
  -webkit-tap-highlight-color: transparent;
}

.server-card:last-child {
  margin-bottom: 0;
}

.server-card-dark {
  background: #171717;
  border-color: #2A2A2A;
}

.server-card-dark:active {
  background: #1E1E1E;
}

.server-card-light {
  background: #F8F9FA;
  border-color: #E5E7EB;
}

.server-card-light:active {
  background: #F0F1F3;
}

.server-card.server-active {
  border-color: #15DE72;
}

.server-card-dark.server-active {
  background: rgba(21, 222, 114, 0.06);
}

.server-card-light.server-active {
  background: rgba(5, 149, 115, 0.04);
}

.server-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.server-name {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
}

.server-tag {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 20px;
}

.tag-default {
  background: rgba(21, 222, 114, 0.12);
  color: #15DE72;
}

.tag-privacy {
  background: rgba(139, 92, 246, 0.12);
  color: #A78BFA;
}

.tag-community {
  background: rgba(251, 191, 36, 0.12);
  color: #F59E0B;
}

.server-url {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 11px;
}

/* Rate status */
.rate-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
}

.status-dark {
  background: #171717;
}

.status-light {
  background: #F3F4F6;
}

.rate-status span {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  line-height: 1.4;
}

/* Spark Wallet Section Styles */
.spark-icon {
  background: linear-gradient(135deg, #F59E0B, #EAB308);
  color: white;
}

.seed-icon {
  background: linear-gradient(135deg, #8B5CF6, #7C3AED);
  color: white;
}

.pin-icon {
  background: linear-gradient(135deg, #059573, #15DE72);
  color: white;
}

/* PIN Dialog Styles */
.pin-dialog {
  max-width: 360px;
  width: 100%;
}

.pin-inputs-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pin-field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pin-field-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  padding-left: 4px;
}

.pin-input-dark {
  border-radius: 12px;
  background: #171717;
  border: 1px solid #2A342A;
  color: #FFF;
}

.pin-input-dark .q-field__native,
.pin-input-dark .q-field__input {
  color: #FFF !important;
}

.pin-input-dark .q-field__native::placeholder {
  color: #6B7280 !important;
}

.pin-input-light {
  border-radius: 12px;
  background: #F8F8F8;
  border: 1px solid #E5E5E5;
  color: #212121;
}

.pin-input-light .q-field__native,
.pin-input-light .q-field__input {
  color: #212121 !important;
}

.pin-input-light .q-field__native::placeholder {
  color: #9CA3AF !important;
}

.pin-input-dark:focus-within {
  border-color: #059573;
}

.pin-input-light:focus-within {
  border-color: #059573;
}

.pin-input-error {
  border-color: #EF4444 !important;
}

.pin-input-field {
  font-size: 18px;
  letter-spacing: 0.3em;
  font-weight: 500;
  padding: 14px 16px;
}

.pin-format-hint {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  text-align: center;
  margin-top: 8px;
}

.pin-hint {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  text-align: center;
  line-height: 1.4;
  margin-top: 12px;
}

.delete-icon {
  background: linear-gradient(135deg, #EF4444, #DC2626);
  color: white;
}

.delete-spark-card:hover {
  border-color: #EF4444 !important;
}

.delete-text {
  color: #EF4444;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.spark-address-text {
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 10px;
}

/* Legacy Wallet Type Badges (kept for compatibility) */
.spark-type-badge {
  background: linear-gradient(135deg, #15DE72, #059573);
  color: white;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 600;
  padding: 0.125rem 0.4rem;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.nwc-type-badge {
  background: linear-gradient(135deg, #6B7280, #4B5563);
  color: white;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 600;
  padding: 0.125rem 0.4rem;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* Wallet Type Options in Add Wallet Dialog */
.wallet-type-section {
  margin-bottom: 0.5rem;
}

.section-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.75rem;
}

.wallet-type-option {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border-radius: 16px;
  margin-bottom: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.option-dark {
  background: #171717;
}

.option-light {
  background: #F8F8F8;
}

.wallet-type-option:hover {
  border-color: #15DE72;
  transform: translateY(-1px);
}

.option-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
}

.spark-option-icon {
  background: linear-gradient(135deg, #3A3A3A, #1A1A1A);
}

.restore-option-icon {
  background: linear-gradient(135deg, #3A3A3A, #1A1A1A);
}

.lnbits-option-icon {
  background: linear-gradient(135deg, #2A2A2A, #1A1A1A);
}

.nwc-option-icon {
  background: linear-gradient(135deg, #2A2A2A, #1A1A1A);
}

.option-content {
  flex: 1;
}

.option-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.option-subtitle {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
}

/* View Mnemonic Dialog */
.seed-phrase-dialog {
  max-width: 420px;
  width: 100%;
}

.seed-pin-entry {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.seed-icon-header {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0 0.25rem;
}

.seed-icon-circle {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.seed-icon-circle-dark {
  background: rgba(21, 222, 114, 0.1);
}

.seed-icon-circle-light {
  background: rgba(21, 222, 114, 0.08);
}

/* Warning Box - Red */
.seed-warning-box {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(239, 68, 68, 0.06) 100%);
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.seed-warning-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #EF4444;
}

.seed-warning-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.seed-warning-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #EF4444;
}

.seed-warning-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  color: #F87171;
  line-height: 1.4;
}

/* Info Box - Green/Neutral */
.seed-info-box {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 12px;
}

.seed-info-box-dark {
  background: rgba(21, 222, 114, 0.06);
  border: 1px solid rgba(21, 222, 114, 0.15);
}

.seed-info-box-light {
  background: rgba(21, 222, 114, 0.05);
  border: 1px solid rgba(21, 222, 114, 0.2);
}

.seed-info-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(21, 222, 114, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #15DE72;
}

.seed-info-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.seed-info-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
}

.seed-info-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  line-height: 1.4;
}

/* PIN Section */
.seed-pin-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.5rem;
}

.seed-pin-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  text-align: center;
}

.seed-pin-input {
  font-size: 18px;
  letter-spacing: 0.5em;
  font-weight: 600;
}

/* Mnemonic Display State */
.mnemonic-display {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.seed-revealed-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 8px;
  background: rgba(251, 191, 36, 0.12);
  color: #F59E0B;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

.mnemonic-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.mnemonic-word {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  border-radius: 10px;
}

.word-dark {
  background: #171717;
  border: 1px solid #2A342A;
}

.word-light {
  background: #F8F8F8;
  border: 1px solid #E5E7EB;
}

.word-number {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 600;
  color: #6B7280;
  min-width: 16px;
}

.word-text {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  color: #15DE72;
  font-weight: 500;
}

.seed-bottom-warning {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.08);
  color: #EF4444;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
}

@media (max-width: 480px) {
  .mnemonic-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .seed-phrase-dialog {
    max-width: 100%;
  }
}

/* Unlock Dialog */
.unlock-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  text-align: center;
  padding: 1rem 0;
}

.unlock-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: rgba(21, 222, 114, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.unlock-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  max-width: 280px;
}

/* Override Quasar's default blue focus colors */
.settings-page :deep(.q-field--outlined.q-field--focused .q-field__control:before) {
  border-color: #15DE72 !important;
}

.settings-page :deep(.q-field--outlined.q-field--focused .q-field__control:after) {
  border-color: #15DE72 !important;
}

.settings-page :deep(.q-field--focused .q-field__label) {
  color: #15DE72 !important;
}

/* Override for all input types including borderless */
.settings-page :deep(.q-field--float .q-field__label) {
  color: #15DE72 !important;
}

.settings-page :deep(.q-field__bottom) {
  color: inherit;
}

/* Dialog inputs - override Quasar primary color */
.dialog_dark :deep(.q-field--focused .q-field__label),
.dialog_light :deep(.q-field--focused .q-field__label) {
  color: #15DE72 !important;
}

.dialog_dark :deep(.q-field--float .q-field__label),
.dialog_light :deep(.q-field--float .q-field__label) {
  color: #15DE72 !important;
}

.dialog_dark :deep(.q-field--outlined.q-field--focused .q-field__control:before),
.dialog_light :deep(.q-field--outlined.q-field--focused .q-field__control:before) {
  border-color: #15DE72 !important;
}

.dialog_dark :deep(.q-field--outlined.q-field--focused .q-field__control:after),
.dialog_light :deep(.q-field--outlined.q-field--focused .q-field__control:after) {
  border-color: #15DE72 !important;
}

/* Change PIN Dialog Intro */
.pin-change-intro {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-bottom: 1.25rem;
  text-align: center;
}

.pin-change-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pin-change-icon-dark {
  background: rgba(21, 222, 114, 0.1);
  color: #15DE72;
}

.pin-change-icon-light {
  background: rgba(5, 149, 115, 0.08);
  color: #059573;
}

.pin-change-desc {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  max-width: 280px;
}

/* Backup Status Badge */
.backup-status-side {
  flex-direction: row !important;
  align-items: center;
}

.backup-status-badge {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  white-space: nowrap;
}

.badge-verified {
  background: rgba(21, 222, 114, 0.12);
  color: #15DE72;
}

.badge-unverified {
  background: rgba(251, 191, 36, 0.12);
  color: #F59E0B;
}

/* Backup Dialog */
.backup-dialog {
  width: 100%;
  max-width: 420px;
}

.backup-show-step {
  padding: 0.5rem 0;
}

.backup-verify-step {
  padding: 0.5rem 0;
}
</style>