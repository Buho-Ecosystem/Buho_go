<template>
  <q-page class="settings-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <!-- The large title below names the page; the bar keeps only the way Home.
         (Hub headers scroll with the page: overflow-x on html/body.) -->
    <SettingsHubHeader title="" />

    <!-- Settings Content: one grouped list, the way the phone's own Settings
         reads. Each group says what it holds in a short footer; a row shows
         where its setting stands, and a row with a chevron opens its own page
         or sheet. -->
    <div class="settings-content">
      <h1 class="settings-large-title">{{ $t('Settings') }}</h1>

      <!-- ─────────────── WALLETS ───────────────
           Every wallet on this phone, with its logo and balance; a row opens
           that wallet's own page. The total sits on top, as Manage Wallets
           used to show it. -->
      <SettingsSection id="settings-wallets" :title="$t('Wallets')">
        <SettingsRow
          v-if="wallets.length > 1"
          class="wallets-total-row"
          :label="$t('Total')"
          :caption="walletsOnlineSummary"
          :interactive="false"
          data-audit="settings-wallets-total"
        >
          <template #right>
            <span class="wallet-row-amount wallet-row-amount--total">
              <!-- Every configured wallet counts; a total missing a wallet's
                   figure reads "at least" and is dimmed (same as the switcher).
                   Until the first figure is in, the wallet rows' placeholder. -->
              <span v-if="!walletStore.totalBalanceInfo.known" v-balance-updating="walletStore.totalBalanceInfo.refreshing" class="balance-placeholder" role="img" :aria-label="$t('Balance not loaded yet')" />
              <template v-else>
                <HiddenAmount v-balance-updating="walletStore.totalBalanceInfo.refreshing" :class="{ 'balance-stale': walletStore.totalBalanceInfo.outdated }">{{ walletStore.totalBalanceInfo.complete ? '' : '≥ ' }}{{ formatBalance(totalBalance) }}</HiddenAmount>
                <HiddenAmount v-if="walletStore.fiatValueOf(totalBalance)" class="wallet-row-fiat" :class="{ 'balance-stale': walletStore.totalBalanceInfo.outdated }">{{ walletStore.totalBalanceInfo.complete ? '' : '≥ ' }}{{ walletStore.fiatValueOf(totalBalance) }}</HiddenAmount>
              </template>
            </span>
          </template>
        </SettingsRow>

        <SettingsRow
          v-for="wallet in sortedWallets"
          :key="wallet.id"
          class="wallet-list-row"
          tiled
          :label="wallet.name"
          :data-wallet-id="wallet.id"
          @click="openWalletDetail(wallet.id)"
        >
          <template #icon>
            <WalletLogoTile :type="wallet.type" :size="30" />
          </template>
          <template #caption>
            {{ walletRowKind(wallet) }}
            <span v-if="wallet.id === activeWalletId" class="wallet-row-state wallet-row-state--active"> · {{ $t('Active') }}</span>
            <!-- What it received since the user last looked at it (stores/unseenReceipts). -->
            <span v-else-if="unseenReceipts.forWallet(wallet.id)" class="wallet-row-state wallet-row-state--unseen"> · <span class="sr-only">{{ $t('Received since you last looked') }}</span> <HiddenAmount>+ {{ formatBalance(unseenReceipts.forWallet(wallet.id).sats) }}</HiddenAmount></span>
            <span v-else-if="walletStore.connectionEnded[wallet.id]" class="wallet-row-state wallet-row-state--off"> · {{ $t('Connection ended') }}</span>
            <!-- The wallet page's own test (isWalletLive), so the row, the total and the page agree. -->
            <span v-else-if="!isWalletLive(wallet)" class="wallet-row-state wallet-row-state--off"> · {{ $t('Offline') }}</span>
          </template>
          <template #right>
            <span class="wallet-row-amount">
              <!-- Same rule as the home switcher: a placeholder until the first
                   figure, dimmed only when known to be out of date. -->
              <span v-if="!walletStore.getDisplayBalance(wallet.id).known" v-balance-updating="walletStore.getDisplayBalance(wallet.id).refreshing" class="balance-placeholder" role="img" :aria-label="$t('Balance not loaded yet')" />
              <HiddenAmount v-else :class="{ 'balance-stale': walletStore.getDisplayBalance(wallet.id).outdated }">{{ walletBalanceText(wallet.id) }}</HiddenAmount>
            </span>
            <Icon icon="tabler:chevron-right" width="16" height="16" class="settings-row-chevron" />
          </template>
        </SettingsRow>

        <!-- A restore keeps finding the phrase's other wallets for a while. -->
        <SettingsRow
          v-if="walletStore.sparkDiscoveryRunning"
          :label="$t('Looking for more wallets from your recovery phrase')"
          :interactive="false"
          role="status"
        >
          <template #icon><q-spinner size="18px" :aria-hidden="true" /></template>
        </SettingsRow>

        <SettingsRow accent :label="$t('Add wallet')" data-audit="settings-add-wallet" @click="showAddWalletDialog = true" />
        <template #footer>
          {{ $t('Spark and Arkade wallets live on this phone, and their recovery words bring them back. NWC and LNbits wallets are connected: they live with their provider.') }}
        </template>
      </SettingsSection>

      <!-- Wallets an earlier version kept on another recovery phrase:
           off the list (one phrase per device), never out of reach. -->
      <SettingsSection v-if="setAsideWallets.length" :title="$t('Other recovery phrase')">
        <SettingsRow
          v-for="entry in setAsideWallets"
          :key="entry.id"
          :label="entry.name || $t('Wallet')"
          :inline-value="$t('Show recovery phrase')"
          @click="openSeedPhraseDialog('view', entry.id)"
        />
        <template #footer>
          {{ $t('These wallets use a different recovery phrase than this phone. Write their words down to keep their money: they open the wallet in any Spark wallet app.') }}
        </template>
      </SettingsSection>

      <!-- ─────────────── WHAT BUHOGO DOES FOR YOU ───────────────
           The two features that work across the wallets, each a door to
           its own page (issue #449). -->
      <SettingsSection>
        <SettingsRow
          icon="tabler:arrow-autofit-right"
          :tile="TILE.green"
          :label="$t('Auto-Transfer')"
          :inline-value="autoTransferMeta"
          data-audit="settings-auto-transfer-row"
          @click="$router.push('/auto-transfer')"
        />
        <SettingsRow
          icon="tabler:cash-register"
          :tile="TILE.ink"
          :label="$t('kiosk.kioskMode')"
          :inline-value="walletStore.kioskEnabled ? $t('On') : $t('Off')"
          data-audit="settings-kiosk-row"
          @click="$router.push('/kiosk-mode')"
        />
        <template #footer>
          {{ $t('Auto-Transfer moves money to another wallet or an address once a wallet holds more than you choose. Kiosk Mode turns this phone into a register for your shop.') }}
        </template>
      </SettingsSection>

      <!-- ─────────────── THIS PHONE ───────────────
           What reaches you, and what keeps others out. -->
      <SettingsSection>
        <!--
          Notifications: one row, the details in a sheet (master switch, then
          one switch per kind). The value says what is in effect, so a
          permission revoked in system settings reads as Blocked or Off
          without destroying the user's own choices.
        -->
        <SettingsRow
          v-if="notificationsStore.supported"
          icon="tabler:bell"
          :tile="TILE.red"
          :label="$t('Notifications')"
          :inline-value="notificationsSummary"
          @click="showNotificationsSheet = true"
        />
        <!--
          App lock. On the web the switch is there so people find it, and
          opens the Get-the-App dialog; on a phone without any screen lock
          it is off and says why.
        -->
        <SettingsRow
          icon="tabler:lock"
          :tile="TILE.slate"
          :label="$t('App lock')"
          :caption="isNativeApp && !biometricsAvailable ? $t('No screen lock set on this device') : ''"
          :interactive="false"
          data-audit="settings-app-lock"
        >
          <template #right>
            <q-toggle
              :model-value="isNativeApp && biometricsEnabled"
              :disable="isNativeApp && !biometricsAvailable"
              :aria-label="$t('App lock')"
              @update:model-value="setAppLock"
              :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
            />
          </template>
        </SettingsRow>
        <!--
          Screen Privacy — Android FLAG_SECURE.
          On native: toggle mirrors the canonical persisted value
          owned by SecureScreenPlugin; toggling here flows through
          the store action which writes to SharedPreferences AND
          applies the flag in a single round-trip.
          On web / PWA: the toggle is rendered (so users discover
          the feature) but always shows OFF and any attempt to
          enable opens the "Get the Android app" dialog.
          In the iOS app: hidden, there is no native implementation.
        -->
        <SettingsRow
          v-if="showScreenPrivacyRow"
          icon="tabler:eye-off"
          :tile="TILE.teal"
          :label="$t('Screen Privacy')"
          :interactive="false"
        >
          <template #right>
            <q-toggle
              :model-value="screenPrivacySupported ? walletStore.privacyScreenEnabled : false"
              :aria-label="$t('Screen Privacy')"
              @update:model-value="togglePrivacyScreen"
              :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
            />
          </template>
        </SettingsRow>
        <template #footer>
          <template v-if="showScreenPrivacyRow">
            {{ $t("App lock asks for your face or fingerprint when BuhoGO opens, or for your phone's PIN, pattern or password when neither is set up. Screen Privacy blocks screenshots, screen recordings and app switcher previews.") }}
          </template>
          <template v-else>
            {{ $t("App lock asks for Face ID or Touch ID when BuhoGO opens, or for your iPhone's passcode when neither is set up.") }}
          </template>
        </template>
      </SettingsSection>

      <!-- ─────────────── HOW BUHOGO LOOKS AND FEELS ─────────────── -->
      <SettingsSection>
        <!-- Theme, main unit, hidden balances and amount format: one page. -->
        <SettingsRow
          icon="tabler:typography"
          :tile="TILE.indigo"
          :label="$t('Display')"
          :inline-value="$q.dark.isActive ? $t('Dark') : $t('Light')"
          data-audit="settings-display-row"
          @click="showDisplaySheet = true"
        />
        <SettingsRow
          icon="tabler:world"
          :tile="TILE.blue"
          :label="$t('Language')"
          :inline-value="getCurrentLanguageLabel()"
          @click="showLanguageDialog = true"
        />
        <SettingsRow
          icon="tabler:coins"
          :tile="TILE.amber"
          :label="$t('Currency')"
          :inline-value="preferredFiatCurrency"
          @click="openCurrencyDialog"
        />
        <!--
          Haptics: on by default, in the app only (a browser cannot play
          them). Off silences every haptic in the app; the phone's own
          vibration setting still applies on top. On the web the toggle
          stays off and switching it on opens the Get-the-App dialog, like
          Screen Privacy.
        -->
        <SettingsRow
          icon="tabler:device-mobile-vibration"
          :tile="TILE.plum"
          :label="$t('Haptics')"
          :interactive="false"
        >
          <template #right>
            <q-toggle
              :model-value="hapticsSupported && hapticsOn"
              :aria-label="$t('Haptics')"
              @update:model-value="updateHaptics"
              :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
            />
          </template>
        </SettingsRow>
        <!--
          Quick access: the Quick Settings tiles and the Home screen
          shortcuts, in a sheet. Android only; on the web the row is there
          so people find it, and opens the Get-the-App dialog. The iOS app
          has no tiles or shortcuts, so it has no row.
        -->
        <SettingsRow
          v-if="showQuickAccessRow"
          icon="tabler:layout-grid-add"
          :tile="TILE.steel"
          :label="$t('Quick access')"
          @click="openQuickAccess"
        />
        <template #footer>
          {{ $t('Haptics let you feel a tap for payments, errors and other key moments.') }}
          <template v-if="showQuickAccessRow">{{ $t('Quick access opens Send, Receive or Scan QR in one tap from outside the app.') }}</template>
        </template>
      </SettingsSection>

      <!-- ─────────────── PAYMENTS AND RECORDS ─────────────── -->
      <SettingsSection>
        <SettingsRow
          icon="tabler:credit-card-pay"
          :tile="TILE.green"
          :label="$t('Default wallet')"
          :inline-value="paymentWalletLabel"
          data-audit="settings-payment-wallet"
          @click="showPaymentWalletSheet = true"
        />
        <!-- Transaction report: reads across the wallets rather than
             belonging to any one of them. -->
        <SettingsRow
          icon="tabler:file-text"
          :tile="TILE.gray"
          :label="$t('Transaction report')"
          @click="showTaxReportSheet = true"
        />
        <template #footer>
          {{ $t('Payments to your contacts start from the default wallet. The transaction report is a PDF, CSV or XML file for your accountant.') }}
        </template>
      </SettingsSection>

      <!-- ─────────────── ADVANCED ───────────────
           Exchange rates, the business check and removing wallets, on their
           own page so reaching them is already deliberate. -->
      <SettingsSection>
        <SettingsRow
          icon="tabler:adjustments-horizontal"
          :tile="TILE.gray"
          :label="$t('Advanced')"
          data-audit="settings-advanced-row"
          @click="showAdvancedSheet = true"
        />
      </SettingsSection>

      <!--
        The LNbits wallet's Lightning address: the same steps as setup
        (pick or create, or Pay Links is off), in one form sheet. This
        page owns the provider, the existing-address list and the save.
      -->
      <LNBitsAddressSheet
        v-model="lnAddressSheet.visible"
        :view="lnAddressSheet.view"
        :server-url="lnAddressSheet.serverUrl"
        :domain="lnAddressSheet.domain"
        :existing-addresses="lnAddressSheet.existingAddresses"
        :default-username="lnAddressSheet.defaultUsername"
        :create-address="createLnbitsAddress"
        :check-status="probeLnurlpForSheetWallet"
        @available="showLnbitsAddressStep"
        @confirm="onLightningAddressConfirm"
      />

      <!-- Breez-engine Spark Lightning address: claim / copy / remove -->
      <SparkLightningAddressSheet
        v-if="lnAddressWalletId || activeWalletId"
        v-model="showSparkLnAddressSheet"
        :wallet-id="lnAddressWalletId || activeWalletId"
      />

      <NotificationsSheet v-model="showNotificationsSheet" />

      <DisplaySheet
        v-model="showDisplaySheet"
        :dark="$q.dark.isActive"
        :main-unit="defaultDisplayCurrency === 'bitcoin' ? 'bitcoin' : 'fiat'"
        :fiat-code="preferredFiatCurrency"
        :balance-hidden="walletStore.balanceHidden"
        :bip177="useBip177Format"
        @toggle-theme="handleToggleDark"
        @main-unit="setDisplayCurrency"
        @toggle-hidden="walletStore.setBalanceHidden()"
        @amount-format="updateAmountFormat"
      />

      <!-- Tiles and launcher shortcuts (#445, #446). Also opened by
           long-pressing a BuhoGO tile: ?section=quick-access. -->
      <QuickAccessSheet v-if="quickAccessSupported" v-model="showQuickAccessSheet" />

      <!-- One more Spark wallet from the recovery phrase on this device. -->
      <AddSparkWalletSheet v-model="showAddSparkSheet" @created="onSparkWalletCreated" />

      <!-- Hand a Spark wallet's Lightning address to another Spark wallet. -->
      <MoveLightningAddressSheet v-model="showMoveAddressSheet" :from-wallet-id="moveAddressWalletId" @moved="onAddressMoved" />

      <!-- "Move funds" before removing a wallet that still holds money. -->
      <InternalTransferModal
        v-model="showTransferModal"
        :from-wallet-id="transferFromWalletId"
      />
    </div>

    <!-- Advanced: rarely needed, so one row away. Removing every wallet of
         a kind at once lives here; one wallet leaves from its own page. -->
    <q-dialog
      v-model="showAdvancedSheet"
      position="bottom"
      transition-show="slide-up"
      transition-hide="slide-down"
      :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    >
      <q-card class="settings-sheet-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'" data-audit="settings-advanced-sheet">
        <div class="form-sheet-grabber" aria-hidden="true"></div>
        <header class="form-sheet-header">
          <span aria-hidden="true"></span>
          <h2 class="form-sheet-title">{{ $t('Advanced') }}</h2>
          <button type="button" class="form-sheet-cancel settings-sheet-done" @click="showAdvancedSheet = false">{{ $t('Done') }}</button>
        </header>
        <div class="settings-sheet-body">
          <SettingsSection>
            <SettingsRow
              icon="tabler:chart-line"
              :label="$t('Exchange rates')"
              :inline-value="mempoolSourceLabel"
              @click="openExchangeRates"
            />
            <template #footer>{{ $t('Where BuhoGO gets Bitcoin prices.') }}</template>
          </SettingsSection>

          <!-- The existing device preference, with a short description.
               No separate payment mode or privacy guarantee is introduced. -->
          <SettingsSection>
            <SettingsRow
              icon="tabler:rosette-discount-check"
              :label="$t('Business check')"
              :interactive="false"
            >
              <template #right>
                <q-toggle
                  :model-value="bitcoinPrefsStore.brantaVerificationEnabled"
                  @update:model-value="bitcoinPrefsStore.setBrantaVerificationEnabled"
                  :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
                  :aria-label="$t('Business check')"
                />
              </template>
            </SettingsRow>
            <template #footer>
              {{ $t("Shows the business behind a payment when a match is available. Checked with Branta.") }}
              <a href="https://branta.pro" class="settings-footer-link" @click.prevent="openBrantaSite">{{ $t('About Branta') }}</a>
            </template>
          </SettingsSection>

          <!-- Every wallet of a kind at once; one wallet leaves from its own
               page. A row that cannot run yet is muted and says why; tapping
               it offers the way out. -->
          <SettingsSection v-if="dangerActions.length" :title="$t('Danger Zone')">
            <SettingsRow
              v-for="action in dangerActions"
              :key="action.key"
              destructive
              :quiet="!!action.blockedReason"
              :label="action.label"
              :caption="action.blockedReason || action.covers"
              @click="action.run"
            />
            <template #footer>{{ $t('A single wallet can be removed or disconnected on its own page.') }}</template>
          </SettingsSection>
        </div>
      </q-card>
    </q-dialog>

    <!-- Typed confirmation: only when a recovery phrase leaves this phone
         (utils/walletRemoval.js). Every other removal is a plain alert. -->
    <q-dialog v-model="showTypedRemoval" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card v-if="typedRemoval" class="typed-removal-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="typed-removal-body">
          <div class="typed-removal-title">{{ typedRemoval.copy.title }}</div>
          <div class="typed-removal-message">{{ typedRemoval.copy.message }}</div>
          <q-input
            v-model="typedRemovalInput"
            outlined
            dense
            class="typed-removal-input"
            :placeholder="$t('Type {phrase}', { phrase: typedRemovalPhrase })"
            :aria-label="$t('Type {phrase}', { phrase: typedRemovalPhrase })"
            :dark="$q.dark.isActive"
            @keyup.enter="confirmTypedRemoval"
          />
        </q-card-section>
        <q-card-actions class="typed-removal-actions">
          <q-btn flat no-caps :label="$t('Cancel')" v-close-popup class="typed-removal-cancel" />
          <q-btn
            flat
            no-caps
            :label="typedRemoval.copy.confirmLabel"
            :disable="typedRemovalInput !== typedRemovalPhrase"
            :loading="isRemoving"
            class="typed-removal-confirm"
            @click="confirmTypedRemoval"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <TaxReportSheet v-model="showTaxReportSheet" />

    <GetAppDialog v-model="showGetAppDialog" :message="getAppDialogMessage" />

    <!-- Language Dialog -->
    <q-dialog v-model="showLanguageDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="picker-dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header picker-dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Language Settings') }}
          </div>
          <q-btn
            flat
            round
            dense
            v-close-popup
            :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
        </q-card-section>

        <q-card-section class="picker-dialog-content">
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
              <div class="picker-row-main">
                <span class="flag-badge">{{ language.flag }}</span>
                <div class="language-info">
                  <div class="language-name" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                    {{ language.label }}
                  </div>
                  <div class="language-code" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                    {{ language.value }}
                  </div>
                </div>
              </div>
              <Icon
                icon="tabler:check"
                v-if="$i18n.locale === language.value"
                class="check-icon"
              />
            </div>
          </div>

          <!-- Low-friction escape hatch for a language we don't have yet:
               one line, no form, opens the explainer popup below. -->
          <button
            type="button"
            class="missing-lang-link"
            :class="$q.dark.isActive ? 'missing-lang-link-dark' : 'missing-lang-link-light'"
            @click="showMissingLanguageDialog = true"
          >
            <Icon icon="tabler:mail" width="15" height="15" />
            <span>{{ $t('Miss a language?') }}</span>
          </button>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Missing-language request — sleek single-purpose popup. Explains we
         read every request, invites the user to translate it themselves,
         then offers three equal-weight channels to reach out. No form,
         no friction. -->
    <q-dialog v-model="showMissingLanguageDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="lang-request-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="lang-request-header">
          <div class="lang-request-icon-wrapper">
            <Icon icon="tabler:language" width="30" height="30" class="lang-request-icon" />
          </div>
          <div class="lang-request-title">{{ $t('Miss a language?') }}</div>
          <div class="lang-request-message" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t("Reach us any way below. We'll do our best to add it, or you can translate it yourself and get a shoutout as an open source contributor.") }}
          </div>
        </q-card-section>

        <q-card-actions class="lang-request-actions">
          <div class="channel-row">
            <button type="button" class="channel-btn" @click="requestMissingLanguage">
              <span class="channel-icon channel-icon--email">
                <Icon icon="tabler:mail" width="22" height="22" />
              </span>
              <span class="channel-label">{{ $t('Email') }}</span>
            </button>

            <button type="button" class="channel-btn" @click="openTelegramCommunity">
              <span class="channel-icon channel-icon--telegram">
                <Icon icon="tabler:brand-telegram" width="22" height="22" />
              </span>
              <span class="channel-label">Telegram</span>
            </button>

            <button type="button" class="channel-btn" @click="openNostrCommunity">
              <span class="channel-icon channel-icon--nostr">
                <img src="/nostr/nostr.png" alt="Nostr" class="channel-icon-img" />
                <span v-if="!nostrCommunityUrl" class="channel-soon-badge">{{ $t('Soon') }}</span>
              </span>
              <span class="channel-label">Nostr</span>
            </button>
          </div>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Currency Dialog -->
    <q-dialog v-model="showCurrencyDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="picker-dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header picker-dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Currency Settings') }}
          </div>
          <q-btn
            flat
            round
            dense
            v-close-popup
            :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
        </q-card-section>

        <q-card-section class="picker-dialog-content">
          <div class="currency-list">
            <div
              v-for="currency in selectableFiatCurrencies()"
              :key="currency"
              class="currency-item"
              :class="{
                'active': preferredFiatCurrency === currency,
                'currency-item-dark': $q.dark.isActive,
                'currency-item-light': !$q.dark.isActive
              }"
              @click="setPreferredCurrency(currency)"
            >
              <div class="picker-row-main">
                <span class="flag-badge">{{ getCurrencyFlag(currency) }}</span>
                <div class="currency-info">
                  <div class="currency-code" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                    {{ currency }}
                  </div>
                  <div class="currency-rate" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                    {{ fiatUnitRate(currency) }}
                  </div>
                </div>
              </div>
              <Icon
                icon="tabler:check"
                v-if="preferredFiatCurrency === currency"
                class="check-icon"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- A wallet's own page, opened from its row in the Wallets group:
         what it is, its balance, what only this kind of wallet has, its
         Auto-Transfer rule, and the way it leaves this phone. -->
    <q-dialog
      v-model="showWalletsDialog"
      position="bottom"
      transition-show="slide-up"
      transition-hide="slide-down"
      :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
      @hide="onWalletDetailHidden"
    >
      <q-card class="wallets-dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <WalletDetailPanel
          v-if="detailWallet"
          :key="detailWallet.id"
          :wallet="detailWallet"
          :type-label="getWalletTypeLabel(detailWallet)"
          :balance="walletBalanceText(detailWallet.id)"
          :balance-known="walletStore.getDisplayBalance(detailWallet.id).known"
          :balance-outdated="walletStore.getDisplayBalance(detailWallet.id).outdated"
          :balance-refreshing="walletStore.getDisplayBalance(detailWallet.id).refreshing"
          :fiat="walletStore.fiatValueOf(walletStore.getDisplayBalance(detailWallet.id).balance)"
          :active="detailWallet.id === activeWalletId"
          :connected="isWalletLive(detailWallet)"
          :switching="walletSwitching"
          :reconnecting="!!isReconnecting[detailWallet.id]"
          :connection-error="connectionProblemText(detailWallet)"
          :connection-ended="!!walletStore.connectionEnded[detailWallet.id]"
          :rename-wallet="walletStore.updateWalletName"
          :lightning-address="detailWallet.type === 'spark' ? (walletStore.lightningAddressOf(detailWallet) || '') : ''"
          :can-move-address="sparkWallets.length > 1"
          :nwc-limit="walletStore.nwcLimitFor(detailWallet.id)"
          :nwc-limit-refusal="walletStore.nwcLimitRefusals[detailWallet.id] || null"
          :nwc-status="walletStore.nwcStatus[detailWallet.id] || ''"
          @back="closeWalletDetail"
          @switch="handleSwitchWallet"
          @reconnect="reconnectWallet"
          :phrase-backed-up="walletStore.phraseBackedUp(detailWallet.id) === true"
          :auto-transfer="autoTransferSummary(detailWallet.id)"
          @auto-transfer="openAutoTransfer"
          @remove="confirmRemoveWallet"
          @backup="openPhraseBackup"
          @copy-address="copyToClipboard($event, $t('Lightning address copied'))"
          @change-address="openLightningAddressSheet"
          @move-address="openMoveAddress"
          :arkade-address="detailWallet.type === 'arkade' ? (arkadeAddressOf(detailWallet) || '') : ''"
          :lnbits-address="detailWallet.type === 'lnbits' ? lnbitsAddressStateFor(detailWallet) : null"
          :server-domain="detailWallet.type === 'lnbits' ? lnbitsDomainOf(detailWallet) : ''"
          :auto-add-deposits="detailWallet.type === 'spark' ? bitcoinPrefsStore.autoAddIncomingBitcoin : null"
          @copy-arkade="copyArkadeAddress"
          @share-arkade="shareArkadeAddress"
          @lnbits-address="openLightningAddressDialog"
          @auto-add="bitcoinPrefsStore.setAutoAddIncomingBitcoin"
          @auto-add-info="showAutoAddDepositsDialog = true"
        />
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
            v-close-popup
            :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
        </q-card-section>

        <q-card-section class="dialog-content">
          <!-- Spark: create or restore the first wallet; afterwards, more
               wallets come from the same recovery phrase until the limit. -->
          <div v-if="hasAnySparkWallet" class="wallet-type-section">
            <div class="section-label" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ $t('Self-Custodial Wallet') }}
            </div>
            <!-- At the limit the row stays, disabled, and says why. -->
            <div
              class="wallet-type-option"
              :class="[$q.dark.isActive ? 'option-dark' : 'option-light', { 'option-disabled': !walletStore.canAddSparkWallet }]"
              role="button"
              :tabindex="walletStore.canAddSparkWallet ? 0 : -1"
              :aria-disabled="walletStore.canAddSparkWallet ? null : 'true'"
              data-audit="add-spark-wallet"
              @click="walletStore.canAddSparkWallet && openAddSparkWallet()"
              @keydown.enter.prevent="walletStore.canAddSparkWallet && openAddSparkWallet()"
            >
              <div class="option-icon spark-option-icon">
                <WalletBrandMark type="spark" :size="22" color="currentColor" />
              </div>
              <div class="option-content">
                <div class="option-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                  {{ $t('New Spark wallet') }}
                </div>
                <div class="option-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ walletStore.canAddSparkWallet
                    ? $t('From your recovery phrase · {count} of {max} left', { count: walletStore.remainingSparkSlots, max: walletStore.maxSparkWallets })
                    : $t('All {max} Spark wallets are in use', { max: walletStore.maxSparkWallets }) }}
                </div>
              </div>
              <Icon v-if="walletStore.canAddSparkWallet" icon="tabler:chevron-right" width="18" height="18" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'" />
            </div>
            <q-separator class="q-my-md" :class="$q.dark.isActive ? 'bg-grey-8' : 'bg-grey-3'"/>
          </div>

          <div v-if="!hasAnySparkWallet" class="wallet-type-section">
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
              <Icon icon="tabler:chevron-right" width="18" height="18" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'" />
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
              <Icon icon="tabler:chevron-right" width="18" height="18" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'" />
            </div>

            <q-separator class="q-my-md" :class="$q.dark.isActive ? 'bg-grey-8' : 'bg-grey-3'"/>
          </div>

          <!-- Arkade Wallet Section (one Arkade wallet only — hidden once it exists) -->
          <div v-if="!hasArkadeWallet" class="wallet-type-section">
            <div class="section-label" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ $t('Arkade Wallet') }}
            </div>

            <div
              class="wallet-type-option"
              :class="$q.dark.isActive ? 'option-dark' : 'option-light'"
              @click="navigateToCreateArkade"
            >
              <div class="option-icon arkade-option-icon">
                <ArkadeLogo variant="mark" :size="26" />
              </div>
              <div class="option-content">
                <div class="option-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                  {{ $t('Create Arkade Wallet') }}
                </div>
                <div class="option-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ $t('Instant, near zero fees') }}
                </div>
              </div>
              <Icon icon="tabler:chevron-right" width="18" height="18" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'" />
            </div>

            <div
              class="wallet-type-option"
              :class="$q.dark.isActive ? 'option-dark' : 'option-light'"
              @click="navigateToRestoreArkade"
            >
              <div class="option-icon arkade-option-icon">
                <ArkadeLogo variant="mark" :size="26" />
              </div>
              <div class="option-content">
                <div class="option-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                  {{ $t('Restore Arkade Wallet') }}
                </div>
                <div class="option-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ $t('Import existing seed phrase') }}
                </div>
              </div>
              <Icon icon="tabler:chevron-right" width="18" height="18" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'" />
            </div>

            <q-separator class="q-my-md" :class="$q.dark.isActive ? 'bg-grey-8' : 'bg-grey-3'"/>
          </div>

          <!-- Wallets that live elsewhere: one row, and the connect sheet
               asks which (Alby Hub, Coinos, LNbits, another wallet). Named
               by what the person does, never by custody: a self-hosted Hub
               or LNbits node is not custodial. -->
          <div class="wallet-type-section">
            <div class="section-label" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
              {{ $t('Connect a wallet you already use') }}
            </div>

            <div
              class="wallet-type-option"
              :class="$q.dark.isActive ? 'option-dark' : 'option-light'"
              role="button"
              tabindex="0"
              data-audit="add-connect-wallet"
              @click="navigateToConnectWallet"
              @keydown.enter.prevent="navigateToConnectWallet"
            >
              <div class="option-icon connect-option-icon">
                <Icon icon="tabler:plug-connected" width="22" height="22" />
              </div>
              <div class="option-content">
                <div class="option-title" :class="$q.dark.isActive ? 'wallet_name_dark' : 'wallet_name_light'">
                  {{ $t('Connect a wallet') }}
                </div>
                <div class="option-subtitle" :class="$q.dark.isActive ? 'table_col_dark' : 'table_col_light'">
                  {{ $t('Alby Hub, Coinos, LNbits and more') }}
                </div>
              </div>
              <Icon icon="tabler:chevron-right" width="18" height="18" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'" />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Auto-add Bitcoin deposits — info popup. Explains, TLDR + friendly, how
         on-chain deposits to a Spark wallet get claimed into the balance. -->
    <q-dialog v-model="showAutoAddDepositsDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="dialog-card info-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Auto-add Bitcoin deposits') }}
          </div>
          <q-btn
            flat
            round
            dense
            v-close-popup
            :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="info-hero">
            <img
              src="/Learn and Earn/Question_pictures/money-income.svg"
              class="info-hero-img"
              alt=""
              aria-hidden="true"
            />
          </div>

          <p class="info-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t("When someone sends you Bitcoin on-chain, it lands on your Spark wallet's own permanent Bitcoin address.") }}
          </p>
          <p class="info-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t("On-chain payments need a few block confirmations before they can be spent. With this on, BuhoGO waits for them and moves the deposit into your spendable balance for you, with no extra step.") }}
          </p>
          <p class="info-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t("If a deposit's claim fee would be unusually high, or the amount very small, you're asked first, so it's never eaten up by fees.") }}
          </p>
          <p class="info-text info-text--muted" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ $t('Off: you add each confirmed deposit yourself with a tap.') }}
          </p>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Where BuhoGO gets Bitcoin prices -->
    <ExchangeRateSheet
      v-model="showMempoolDialog"
      :saved-url="customMempoolUrl"
      :last-update="ratesLastUpdate"
      :check-server="checkMempoolServer"
      @change="onRateServerChange"
    />

    <!-- Spark recovery phrase (unified view + backup flow) -->
    <SparkSeedPhraseDialog
      v-model="showSeedPhraseDialog"
      :mode="seedPhraseMode"
      :wallet-id="seedPhraseWalletId"
      @verified="onSeedPhraseVerified"
    />

    <!-- App Lock enable: explain what happens before the native prompt -->
    <BiometricEnableDialog
      v-model="showBiometricEnableDialog"
      :biometry-type="pendingBiometryType"
      @confirmed="onBiometricEnableConfirmed"
    />


    <PreferredPaymentWalletSheet v-model="showPaymentWalletSheet" />
    <SettingsHubNav />
  </q-page>
</template>

<script>
import {useWalletStore} from '../stores/wallet'
import {useUnseenReceiptsStore} from '../stores/unseenReceipts.js'
import {useAutoWithdrawStore} from '../stores/autoWithdraw'
import { destinationLabel } from '../utils/autoTransferCopy.js'
import {useBitcoinPreferencesStore} from '../stores/bitcoinPreferences'
import {useIdentityStore} from '../stores/identity'
import {useProfileStore} from '../stores/profile'
import {useNotificationsStore} from '../stores/notifications'
import {usePaymentPreferencesStore} from '../stores/paymentPreferences.js'
import {useChatRuntime} from '../composables/useChatRuntime'
import {mapState, mapActions} from 'pinia'
import {fiatRatesService, checkMempoolServer} from '../utils/fiatRates.js'
import { mempoolServerLabel } from '../utils/mempoolServer.js'
import {formatAmount} from '../utils/amountFormatting.js'
import { SELECTABLE_FIAT_CURRENCIES, fiatSymbol, fiatFlag } from '../utils/fiatCurrencies.js'
import {shareContent} from '../utils/share.js'
import { toggleThemeWithSweep } from '../utils/themeTransition.js'
import { isBiometricAvailable } from '../utils/biometric.js'
import { isScreenPrivacySupported } from '../utils/secureScreen.js'
import { Capacitor } from '@capacitor/core'
import { loadDismissedWarnings, saveDismissedWarnings } from '../utils/attentionWarnings.js'
import SparkSeedPhraseDialog from '../components/SparkSeedPhraseDialog.vue'
import balanceUpdating from '../directives/balanceUpdating.js'
import ArkadeLogo from '../components/ArkadeLogo.vue'
import WalletBrandMark from '../components/WalletBrandMark.vue'
import BiometricEnableDialog from '../components/BiometricEnableDialog.vue'
import LNBitsAddressSheet from '../components/lnbits/LNBitsAddressSheet.vue'
import ExchangeRateSheet from '../components/settings/ExchangeRateSheet.vue'
import { walletTypeLabel } from '../utils/walletNames.js'
import { NWC_ERROR, nwcError } from '../utils/nwcErrors.js'
import SparkLightningAddressSheet from '../components/SparkLightningAddressSheet.vue'
import InternalTransferModal from '../components/InternalTransferModal.vue'
import WalletDetailPanel from '../components/settings/WalletDetailPanel.vue'
import AddSparkWalletSheet from '../components/wallets/AddSparkWalletSheet.vue'
import NotificationsSheet from '../components/settings/NotificationsSheet.vue'
import PreferredPaymentWalletSheet from '../components/settings/PreferredPaymentWalletSheet.vue'
import QuickAccessSheet from '../components/settings/QuickAccessSheet.vue'
import { quickAccessSupported } from '../services/quickAccess.js'
import MoveLightningAddressSheet from '../components/wallets/MoveLightningAddressSheet.vue'
import { removalCopy, removalBlockerLabel, sparkRemovalCopy, disconnectAllCopy, walletKind, WALLET_KIND } from '../utils/walletRemoval.js'
import GetAppDialog from '../components/GetAppDialog.vue'
import TaxReportSheet from '../components/settings/TaxReportSheet.vue'
import SettingsSection from '../components/settings/SettingsSection.vue'
import SettingsRow from '../components/settings/SettingsRow.vue'
import SettingsAttentionStrip from '../components/settings/SettingsAttentionStrip.vue'
import WalletLogoTile from '../components/settings/WalletLogoTile.vue'
import DisplaySheet from '../components/settings/DisplaySheet.vue'
import SettingsHubHeader from '../components/settings/SettingsHubHeader.vue'
import SettingsHubNav from '../components/settings/SettingsHubNav.vue'
import HiddenAmount from '../components/HiddenAmount.vue'
import { openInAppBrowser } from '../utils/inAppBrowser.js'
import { haptics, hapticsEnabled, hapticsSupported, setHapticsEnabled } from '../utils/haptics.js'
import { LNBitsWalletProvider } from '../providers/LNBitsWalletProvider'
// Alternative lightweight verification (type 3 random words). Kept out
// of the flow intentionally — the order-tap check is stronger. Retained
// here for future reuse.
// import MnemonicVerify from '../components/MnemonicVerify.vue'
import { SUPPORTED_LOCALES, applyLocale, getSavedLocale } from '../i18n/locales'

/**
 * Row tile colours, one hue per kind of setting, white glyph on top. Wallet
 * rows carry their own brand tiles (WalletLogoTile) instead.
 */
const SETTINGS_TILE = Object.freeze({
  green: '#0A8F6C',
  ink: '#3A3A3F',
  red: '#D2453B',
  slate: '#4A5568',
  teal: '#2C7A73',
  indigo: '#5A4FCF',
  blue: '#2F7BD9',
  amber: '#C27C0E',
  plum: '#8E5BA8',
  steel: '#557089',
  gray: '#7A7670',
});

export default {
  name: 'SettingsPage',
  directives: { balanceUpdating },
  setup() {
    const paymentPreferences = usePaymentPreferencesStore();
    paymentPreferences.initialize();
    return { chatAvailable: useChatRuntime().available, paymentPreferences };
  },
  components: {
    ArkadeLogo,
    WalletBrandMark,
    SparkSeedPhraseDialog,
    BiometricEnableDialog,
    LNBitsAddressSheet,
    ExchangeRateSheet,
    SparkLightningAddressSheet,
    InternalTransferModal,
    WalletDetailPanel,
    AddSparkWalletSheet,
    NotificationsSheet,
    PreferredPaymentWalletSheet,
    QuickAccessSheet,
    MoveLightningAddressSheet,
    GetAppDialog,
    TaxReportSheet,
    SettingsSection,
    SettingsRow,
    SettingsAttentionStrip,
    WalletLogoTile,
    DisplaySheet,
    SettingsHubHeader,
    SettingsHubNav,
    HiddenAmount,
  },
  data() {
    return {
      hapticsOn: hapticsEnabled(),
      hapticsSupported: hapticsSupported(),
      quickAccessSupported: quickAccessSupported(),
      // A wallet's own page (WalletDetailPanel), opened from its row.
      showWalletsDialog: false,
      showDisplaySheet: false,
      showAdvancedSheet: false,
      TILE: SETTINGS_TILE,
      showPaymentWalletSheet: false,
      showSparkLnAddressSheet: false,
      showAddWalletDialog: false,
      // The wallet whose page is open.
      detailWalletId: null,
      showAddSparkSheet: false,
      lnAddressWalletId: null,
      showMoveAddressSheet: false,
      moveAddressWalletId: null,
      showTransferModal: false,
      transferFromWalletId: null,
      showCurrencyDialog: false,
      showNotificationsSheet: false,
      showQuickAccessSheet: false,
      showLanguageDialog: false,
      showMissingLanguageDialog: false,
      nostrCommunityUrl: 'https://nostr-ecosystem.netlify.app/join/g/groups.0xchat.com/85016a489c551428a50c339c75b6931a?n=BuhoGO&a=Public+discussion%2C+support%2C+and+updates+for+the+Buho+GO+Wallet%3A+a+native+wallet+interface+for+Spark%2C+Ark%2C+LNbits%2C+Nostr+Wallet+Connect%2C+and+&p=https%3A%2F%2Fblossom.primal.net%2Fd816ffbd78b10591710a1be9deca91700fe278e50250a07f0b1e421f0db03748',
      showNotificationsDialog: false,
      showSecurityDialog: false,
      showMempoolDialog: false,
      showAutoAddDepositsDialog: false,


      // New wallet form
      isReconnecting: {},

      // Settings
      pinEnabled: false,
      hasPin: false,
      currentPin: '',
      newPin: '',

      // Exchange rates: the user's own Mempool server (null = the
      // default) and when prices last came in, for the sheet.
      customMempoolUrl: null,
      ratesLastUpdate: null,

      // Language options (shared registry — see src/i18n/locales.js)
      localeOptions: SUPPORTED_LOCALES,

      // Spark wallet settings
      showSparkSettingsDialog: false,

      // Unified seed-phrase dialog (view + backup flows)
      showSeedPhraseDialog: false,
      seedPhraseMode: 'view', // 'view' | 'backup'
      // Set only by the identity surface's per-phrase deep link; null means
      // "the active seed wallet", which is what this page's own rows want.
      seedPhraseWalletId: null,

      // Spark reconnect dialog
      isSparkReconnecting: false,

      // Donation

      // Danger confirmation dialog
      // A removal waiting for its typed confirmation: { copy, remove, recheck }.
      showTypedRemoval: false,
      typedRemoval: null,
      typedRemovalInput: '',
      isRemoving: false,

      // Biometrics / App Lock
      biometricsEnabled: false,
      biometricsAvailable: false,
      biometryType: 'none', // 'fingerprint', 'face', 'device-pin', 'multiple', 'none'

      // Screen privacy (Android FLAG_SECURE). True only on Capacitor
      // native. On web / PWA the toggle row still renders (so users
      // can discover the feature) but always shows OFF and any
      // attempt to enable opens the Get-the-App dialog.
      screenPrivacySupported: false,

      // Get-the-App dialog state. Opens when a user tries to enable
      // a native-only feature from the web build. The dialog is
      // shared by every such feature (screen privacy, biometric app
      // lock, future Android-only protections); the caller passes a
      // localized message key via promptForApp() so the body line
      // describes the specific feature being requested.
      showGetAppDialog: false,
      getAppDialogMessage: '',
      showTaxReportSheet: false,

      // Enable-flow explanation dialog state
      showBiometricEnableDialog: false,
      pendingBiometryType: 'none',

      // Attention cards the user has dismissed (swipe / X). Persisted so a
      // dismissed reminder doesn't nag again; the quiet "Backup needed" chip
      // in the profile row remains as the non-aggressive indicator.
      dismissedWarnings: loadDismissedWarnings(),

      // Wallet removal

      // ─── LNbits lightning address management ───────────────────────────
      //
      // Pay Links (lnurlp) status per wallet id, from provider.lnurlpStatus():
      // 'available' | 'off' | 'unknown'; missing = not asked yet. Keyed by
      // wallet, not server: Pay Links is switched on per LNbits account.
      lnurlpStatus: {},

      // The Lightning address sheet (LNBitsAddressSheet).
      lnAddressSheet: {
        visible: false,
        view: 'address',
        walletId: null,
        serverUrl: '',
        domain: '',
        existingAddresses: [],
        defaultUsername: '',
      },

    }
  },
  computed: {
    paymentWalletLabel() {
      const id = this.paymentPreferences.preferredWalletId;
      // A wallet that is no longer on this phone cannot be the default: the
      // preference itself returns to Automatic (paymentPreferences.forgetMissing).
      return (id && this.wallets.find(wallet => wallet.id === id)?.name) || this.$t('Automatic');
    },
    /**
     * Wallets set aside on another recovery phrase (see the wallet store).
     * Read again whenever the wallet list changes: the set-aside list is
     * written by the same migrations that change it.
     */
    setAsideWallets() {
      void this.wallets.length;
      return this.walletStore.setAsideSparkWallets();
    },
    /** The wallet the detail sheet is showing; null once it is removed. */
    detailWallet() {
      return this.wallets.find((w) => w.id === this.detailWalletId) || null;
    },

    /**
     * The phrase a destructive action makes you type. Translated: the gate
     * exists so the user reads and understands what they are about to do,
     * and asking a German or Spanish reader to copy English characters is
     * transcription, not understanding. Built from one value so the label,
     * the comparison and the translation can never drift apart.
     */
    typedRemovalPhrase() {
      return this.$t('I understand');
    },

    /** Danger Zone: what each row covers, and why it cannot run yet ('' when it can). */
    dangerActions() {
      const t = this.$t.bind(this);
      const actions = [];
      if (this.sparkWallets.length) {
        actions.push({
          key: 'spark',
          label: t('Remove Spark from this phone'),
          covers: this.listNames(this.sparkWallets.map((w) => w.name)),
          blockedReason: removalBlockerLabel(this.walletStore.sparkRemovalCheck(), t),
          run: this.confirmRemoveSpark,
        });
      }
      const arkade = this.wallets.find((w) => w.type === 'arkade');
      if (arkade) {
        actions.push({
          key: 'arkade',
          label: t('Remove Arkade from this phone'),
          covers: arkade.name,
          blockedReason: removalBlockerLabel(this.walletStore.removalCheckFor(arkade.id), t),
          run: () => this.confirmRemoveWallet(arkade.id),
        });
      }
      const connected = this.wallets.filter((w) => walletKind(w) === WALLET_KIND.CONNECTED);
      if (connected.length) {
        actions.push({
          key: 'connected',
          label: t('Disconnect all connected wallets'),
          covers: this.listNames(connected.map((w) => w.name)),
          blockedReason: '',
          run: this.confirmDisconnectAll,
        });
      }
      return actions;
    },

    ...mapState(useWalletStore, [
      'wallets',
      'activeWalletId',
      'balances',
      'connectionStates',
      'sortedWallets',
      'totalBalance',
      'connectedWallets',
      'preferredFiatCurrency',
      'defaultDisplayCurrency',
      'exchangeRates',
      'hasSparkWallet',
      'hasAnySparkWallet',
      'hasArkadeWallet',
      'sparkWallet',
      'sparkWallets',
      'isActiveWalletSpark',
      'activeSparkAddress',
      'arkadeWallet',
      'useBip177Format',
      'hasBackedUp',
      'walletSwitching',
      'activeWallet',
      'walletInfos',
    ]),

    walletStore() {
      return useWalletStore();
    },
    unseenReceipts() {
      return useUnseenReceiptsStore();
    },

    /**
     * True only when running inside the Capacitor Android (or iOS)
     * build. Gates the visual treatment of native-only feature
     * cards (biometric app lock, screen privacy) — on web they
     * stay tappable but open the Get-the-App dialog instead of
     * showing a misleading "N/A" / disabled state.
     */
    isNativeApp() {
      return Capacitor.isNativePlatform();
    },

    /** Screen Privacy in the Android app, and on the web to point there; never in the iOS app. */
    showScreenPrivacyRow() {
      return this.screenPrivacySupported || !this.isNativeApp;
    },

    /** Quick access in the Android app, and on the web to point there; never in the iOS app. */
    showQuickAccessRow() {
      return this.quickAccessSupported || !this.isNativeApp;
    },

    bitcoinPrefsStore() {
      return useBitcoinPreferencesStore();
    },

    /**
     * The Identity store underpins LUD-04 (LNURL-auth) and, in the
     * future, NIP-06 / NIP-05 derivation. It is intentionally not tied
     * to any payment stream so the section here is visible to every
     * user regardless of which wallet types they have configured.
     */
    identityStore() {
      return useIdentityStore();
    },

    /**
     * Profile (kind:0 metadata + Lightning Address) store. Needed
     * by the profile card and surfaces in Settings that surface
     * the user's chosen display name / avatar.
     */
    profileStore() {
      return useProfileStore();
    },

    /**
     * Notification store. Drives the row's visibility (`supported`) and
     * its value; `created()` calls `initialize()` so the row reflects the
     * live OS permission on first paint. The switches live in
     * NotificationsSheet.
     */
    notificationsStore() {
      return useNotificationsStore();
    },

    /** What the Notifications row says is in effect: On, Off or Blocked. */
    notificationsSummary() {
      const store = this.notificationsStore;
      if (store.permission === 'denied') return this.$t('Blocked');
      const any = store.canNotifyPayments || (this.chatAvailable && store.canNotifyMessages);
      return any ? this.$t('On') : this.$t('Off');
    },

    /** Under the total: how many wallets, and how many of them answer right now (isWalletLive, as each row and page). */
    walletsOnlineSummary() {
      const count = this.wallets.length;
      const online = this.wallets.filter((wallet) => this.isWalletLive(wallet)).length;
      return online >= count
        ? this.$t('{count} wallets, all online', { count })
        : this.$t('{count} wallets, {online} online', { count, online });
    },

    activeSparkBackedUp() {
      return this.sparkWallet?.metadata?.hasBackedUp ?? this.hasBackedUp;
    },

    activeArkadeBackedUp() {
      return !!this.arkadeWallet?.metadata?.hasBackedUp;
    },

    /**
     * Computed warning list driving the SettingsAttentionStrip at the
     * top of Settings. Only items that actually need the user's
     * attention right now appear here — when the array is empty the
     * strip renders nothing. Order matters: most-critical first so a
     * single-warning screen always shows the most important card.
     *
     * Each warning's `id` is the contract between this list and
     * `onAttentionAction(id)`, which routes the CTA tap to the
     * appropriate dialog / route / toggle.
     */
    attentionWarnings() {
      const warnings = [];

      // 1. Wallet seed backup outstanding (seed-based backends only — Spark
      //    and Arkade; NWC/LNbits have no local seed to back up).
      const seedBackupOutstanding =
        (this.hasSparkWallet && !this.activeSparkBackedUp) ||
        (this.arkadeWallet && !this.activeArkadeBackedUp);
      if (seedBackupOutstanding) {
        warnings.push({
          id: 'wallet-seed-backup',
          variant: 'warning',
          icon: 'tabler:shield-exclamation',
          title: this.$t('Back up your wallet seed'),
          description: this.$t('Your 12 words are the only way to recover funds.'),
          ctaLabel: this.$t('Back up'),
        });
      }

      // Drop anything the user has swiped / X-ed away.
      return warnings.filter((w) => !this.dismissedWarnings.includes(w.id));
    },

    /** The Auto-Transfer row's value: where its page's rules stand, in a few words. */
    autoTransferMeta() {
      const rules = useAutoWithdrawStore().rulesOf(this.walletStore.wallets);
      if (rules.some((entry) => entry.status.kind === 'attention')) return this.$t('Needs attention');
      const on = rules.filter((entry) => entry.rule.enabled).length;
      if (on) return this.$t('{count} on', { count: on });
      return rules.length ? this.$t('Paused') : this.$t('No rules yet');
    },

    isPinValid() {
      if (!this.hasPin) {
        return this.newPin.length >= 4;
      }
      return this.currentPin.length >= 4 && this.newPin.length >= 4;
    },

    // The server prices come from, as the Settings row shows it.
    mempoolSourceLabel() {
      return mempoolServerLabel(this.customMempoolUrl);
    },

  },
  watch: {
    // Long-pressing a BuhoGO tile while Settings is already open.
    '$route.query.section'(section) {
      if (section === 'quick-access') this.openQuickAccessFromRoute();
    },

    // A removed wallet's page closes. An LNbits wallet's page asks its
    // server about Pay Links once, so the address row knows what it can offer.
    detailWallet(wallet) {
      if (!wallet && this.detailWalletId) {
        this.lastDetailWalletId = this.detailWalletId;
        this.detailWalletId = null;
        this.showWalletsDialog = false;
        return;
      }
      if (wallet?.type === 'lnbits' && !this.lnurlpStatus[wallet.id]) void this.probeLnurlpFor(wallet);
    },
    showWalletsDialog(open) {
      // Remember which row to focus once the sheet has gone.
      if (!open) {
        this.lastDetailWalletId = this.detailWalletId || this.lastDetailWalletId;
        this.detailWalletId = null;
      }
    },

  },

  created() {
    this.initializeStore();
    this.loadPinState();
    // Load the user's switch, then re-read the OS permission: they may have
    // changed it in system settings since the app started, and this row must
    // never claim more than the OS allows.
    this.notificationsStore.initialize()
      .then(() => this.notificationsStore.syncPermission())
      .catch(() => {});
    this.loadMempoolSettings();
    this.loadLanguagePreference();
    this.checkBiometricAvailability();
    // Probe whether FLAG_SECURE control is available on this build —
    // gates the visibility of the Screen Privacy toggle row.
    this.screenPrivacySupported = isScreenPrivacySupported();
    // Hydrate the Identity store so the section renders with the right
    // bootstrapped/backup state on first paint. Idempotent; cheap.
    this.identityStore.hydrate();
    // Hydrate the Profile store from localStorage so the avatar / name
    // show on first paint after an app restart. Idempotent; cheap.
    this.profileStore.hydrate();
    // First-install fallback: if hydrate found nothing AND we have an
    // identity, kick off the same Nostr fetch the Profile page would
    // do on its own mount. Non-blocking — Settings renders with an
    // empty avatar and the picture pops in once relays respond. Without
    // this, a brand-new install never shows the avatar in Settings
    // until the user has opened the Profile page at least once.
    if (this.identityStore.bootstrapped && this.profileStore.isEmpty) {
      this.profileStore
        .recoverFromNostr({ identityStore: this.identityStore })
        .catch((err) =>
          console.warn('[settings] profile refresh failed:', err)
        );
    }
  },

  mounted() {
    // Refresh exchange rates every 5 minutes
    this.exchangeRateInterval = setInterval(() => {
      this.loadExchangeRates();
    }, 300000); // 5 minutes

    // The Breez lightning address is fetched lazily after connect, so the
    // cached wallet info can lag one refresh cycle behind. Pull it live so
    // the row shows the current state on first paint.
    this.refreshSparkLightningAddress();

    // ?section=wallets (the home switcher's Manage button) needs nothing
    // more: the wallets head this page. ?section=advanced opens Advanced once.
    if (this.$route.query.section === 'advanced') {
      // Opened once: Back from here must not open it again.
      const { section, ...query } = this.$route.query;
      this.$router.replace({ query }).catch(() => {}).then(() => { this.showAdvancedSheet = true; });
    }


    // Long-pressing a BuhoGO tile in Quick Settings (#445).
    if (this.$route.query.section === 'quick-access') {
      this.$nextTick(() => this.openQuickAccessFromRoute());
    }

    // Native-only redirect. A direct web navigation to /learn* is bounced
    // here by the router guard (see router/routes.js) with ?getApp=learn.
    // Open the shared Get-the-App dialog so the user learns that Learn &
    // Earn is app-only, the same message the Learn & Earn card gives on the web.
    if (this.$route.query.getApp === 'learn') {
      this.$nextTick(() => this.promptForLearnEarnApp());
    }
  },

  beforeUnmount() {
    if (this.exchangeRateInterval) {
      clearInterval(this.exchangeRateInterval);
    }
  },
  methods: {
    /**
     * Open the Quick access sheet for ?section=quick-access. The query is
     * dropped first, so the next long-press on a tile changes the route again
     * and the watcher above sees it; the sheet opens only after that
     * navigation, because a dialog closes itself on a route change.
     */
    openQuickAccessFromRoute() {
      const { section, ...query } = this.$route.query;
      const dropped = section === 'quick-access' ? this.$router.replace({ query }).catch(() => {}) : Promise.resolve();
      dropped.then(() => {
        if (this.quickAccessSupported) this.showQuickAccessSheet = true;
      });
    },

    openBrantaSite() {
      openInAppBrowser('https://branta.pro')
    },

    ...mapActions(useWalletStore, [
      'initialize',
      'updateWalletName',
      'setDefaultWallet',
      'switchActiveWallet',
      'connectWallet',
      'disconnectAll',
      'updateCurrencyPreferences',
      'loadExchangeRates',
      'getSparkMnemonic',
      'connectSparkWallet',
      'updateBip177Preference',
      'confirmBackup',
      'updateBiometricsEnabled',
      'setWalletLightningAddress',
    ]),

    async initializeStore() {
      await this.initialize()
    },

    // ─── Security ─────────────────────────────────────

    /**
     * The one dialog behind all four seed rows: identity gate
     * (biometric / device PIN on native, skipped on web), phrase
     * reveal with 120s auto-hide and screenshot protection, and,
     * in backup mode, the tap-12-words-in-order verification.
     *
     * @param {'view'|'backup'} mode
     */
    openSeedPhraseDialog(mode, walletId = null) {
      this.seedPhraseMode = mode;
      // No id: the active wallet. An id names a wallet set aside on another
      // phrase; it never carries over to the next opening.
      this.seedPhraseWalletId = walletId;
      this.showSeedPhraseDialog = true;
    },

    onSeedPhraseVerified() {
      // Backup flow succeeded — the dialog has already flagged the
      // wallet as backed up via the store, closed itself, and emitted.
      // Nothing else to do here; the Settings row re-renders via the
      // `activeSparkBackedUp` computed.
    },

    // ─── LNbits Lightning Address ─────────────────────────────────────

    /**
     * Construct a one-shot LNBitsWalletProvider for an LNbits wallet. We
     * deliberately mirror the throwaway pattern used by LNBitsSetupPage (it
     * doesn't go through the connected provider registry in
     * `walletStore.providers`, so the call path is identical whether the
     * wallet was just added or has been around for months).
     *
     * @returns {LNBitsWalletProvider|null} a fresh provider, or null if the
     *   wallet isn't an LNbits wallet.
     */
    _buildLNBitsProvider(wallet) {
      if (!wallet || wallet.type !== 'lnbits') return null;
      const conn = wallet.connectionData || {};
      return new LNBitsWalletProvider(wallet.id, {
        name: wallet.name,
        serverUrl: conn.serverUrl,
        walletId: conn.walletId,
        adminKey: conn.adminKey,
      });
    },

    /** The wallet the LNbits address sheet is working on. */
    _lnAddressSheetWallet() {
      return this.wallets.find((w) => w.id === this.lnAddressSheet.walletId) || null;
    },

    /**
     * An LNbits wallet's Lightning address row, for its page:
     *   { state, address }, state one of
     *   'set'          — address attached; opens the sheet to swap it.
     *   'unsetReady'   — no address yet, Pay Links answers; opens the sheet
     *                    to pick or create one.
     *   'unsetBlocked' — the server says Pay Links is off; opens the sheet
     *                    that says who can turn it on.
     *   'unknown'      — the server could not be asked; a tap asks again.
     *   'probing'      — not asked yet.
     */
    lnbitsAddressStateFor(wallet) {
      const address = this.walletStore.lightningAddressOf(wallet) || '';
      if (address) return { state: 'set', address };
      const status = this.lnurlpStatus[wallet.id];
      const state = { available: 'unsetReady', off: 'unsetBlocked', unknown: 'unknown' }[status] || 'probing';
      return { state, address: '' };
    },

    /** Ask the wallet's server about Pay Links (lnurlp), cache and return the answer ('available' | 'off' | 'unknown'). */
    async probeLnurlpFor(wallet) {
      const provider = this._buildLNBitsProvider(wallet);
      if (!provider) return 'unknown';
      const status = await provider.lnurlpStatus();
      this.lnurlpStatus = { ...this.lnurlpStatus, [wallet.id]: status };
      return status;
    },

    /** The address sheet's "check again" button: the wallet it is open for. */
    probeLnurlpForSheetWallet() {
      return this.probeLnurlpFor(this._lnAddressSheetWallet());
    },

    /**
     * The Lightning Address row on an LNbits wallet's page. Pay Links
     * answering opens the address step (pick when addresses exist, else
     * create); Pay Links off opens the step that says who can turn it on; a
     * server that cannot be reached is asked once more, then said so.
     */
    async openLightningAddressDialog(walletId) {
      const wallet = this.wallets.find((w) => w.id === walletId);
      if (!wallet || wallet.type !== 'lnbits') return;

      let status = this.lnurlpStatus[wallet.id];
      if (status !== 'available' && status !== 'off') status = await this.probeLnurlpFor(wallet);
      if (status === 'unknown') {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't reach the server"), caption: this.lnbitsDomainOf(wallet), timeout: 3000 });
        return;
      }

      this.lnAddressSheet = {
        visible: false,
        view: status === 'off' ? 'paylinks' : 'address',
        walletId: wallet.id,
        serverUrl: wallet.connectionData?.serverUrl || '',
        domain: this.lnbitsDomainOf(wallet),
        existingAddresses: [],
        defaultUsername: wallet.name || '',
      };
      if (status === 'available') await this._loadLnbitsAddresses();
      // The person closed this wallet's page, or asked for another wallet's address, meanwhile.
      if (this.detailWalletId !== wallet.id || this.lnAddressSheet.walletId !== wallet.id) return;
      this.lnAddressSheet.visible = true;
    },

    /** Pay Links was turned on while the sheet was open: on to the address step. */
    async showLnbitsAddressStep() {
      this.lnurlpStatus = { ...this.lnurlpStatus, [this.lnAddressSheet.walletId]: 'available' };
      await this._loadLnbitsAddresses();
      this.lnAddressSheet.view = 'address';
    },

    async _loadLnbitsAddresses() {
      const provider = this._buildLNBitsProvider(this._lnAddressSheetWallet());
      try {
        this.lnAddressSheet.existingAddresses = provider ? await provider.listLightningAddresses() : [];
      } catch (err) {
        // Pay Links answered but listing failed: creating still works.
        console.warn('[settings] listLightningAddresses failed:', err);
        this.lnAddressSheet.existingAddresses = [];
      }
    },

    createLnbitsAddress(username, options = {}) {
      const provider = this._buildLNBitsProvider(this._lnAddressSheetWallet());
      if (!provider) return Promise.reject(new Error(this.$t('Could not create address.')));
      return provider.createLightningAddress({ username, successText: options.successText });
    },

    /** The LNbits server's host name, for captions ("demo.lnbits.com"). */
    lnbitsDomainOf(wallet) {
      const url = wallet?.connectionData?.serverUrl || '';
      try { return new URL(url).hostname; }
      catch { return url; }
    },

    async onLightningAddressConfirm({ address, isNew }) {
      const walletId = this.lnAddressSheet.walletId;
      if (!walletId || !address) return;

      try {
        await this.setWalletLightningAddress(walletId, address);
        this.$q.notify({
          type: 'positive',
          message: isNew
            ? this.$t('Lightning address created')
            : this.$t('Lightning address updated'),
          caption: address,
          timeout: 2500,
        });
      } catch (err) {
        // Persisting to local state is a synchronous-ish store update; a
        // failure here is extremely unlikely but worth surfacing so the
        // user doesn't think the change took effect when it didn't.
        console.error('[settings] setWalletLightningAddress failed:', err);
        this.$q.notify({
          type: 'warning',
          message: this.$t('Address created but not saved locally'),
          caption: this.$t('You can try again from this page.'),
          timeout: 5000,
        });
      }
    },

    openCurrencyDialog() {
      // Open at once; the rates refresh behind it. Choosing a currency never
      // needs a rate, so a slow or down rate source must not block the picker.
      this.showCurrencyDialog = true
      this.loadExchangeRates()
    },

    /**
     * Dark-mode toggle with the diagonal sweep transition. The sweep
     * utility flips the Quasar dark flag at mid-animation so the class
     * change is hidden under the overlay. Falls back to an instant
     * toggle on prefers-reduced-motion.
     */
    handleToggleDark() {
      toggleThemeWithSweep(this.$q)
    },

    /**
     * The App lock switch. On the web no device lock exists, so the switch
     * says where it does (the Android app) and stays off; on a phone it
     * runs the usual enable or disable steps.
     */
    setAppLock(value) {
      if (!this.isNativeApp) {
        if (value) {
          this.promptForApp(
            this.$t('Biometric app lock runs on the device and is only available in the BuhoGO Android app. Install it from Google Play to unlock the app with your fingerprint or face.')
          );
        }
        return;
      }
      this.toggleBiometrics(value);
    },

    /**
     * Routes an attention-strip CTA tap to the right surface. The
     * strip stays thin — it just reports which warning was acted on;
     * the work happens here so the actual dialogs / routes / toggles
     * remain in one place.
     */
    onAttentionAction(id) {
      switch (id) {
        case 'wallet-seed-backup':
          this.openSeedPhraseDialog('backup');
          return;
      }
    },

    // Dismiss an attention card (swipe / X). Persisted so it stays gone.
    onAttentionDismiss(id) {
      if (this.dismissedWarnings.includes(id)) return;
      this.dismissedWarnings = [...this.dismissedWarnings, id];
      saveDismissedWarnings(this.dismissedWarnings);
    },

    setPreferredCurrency(currency) {
      this.updateCurrencyPreferences(currency, this.denominationCurrency)
      this.showCurrencyDialog = false
    },

    setDisplayCurrency(value) {
      this.walletStore.defaultDisplayCurrency = value;
      this.walletStore.persistState();
    },

    /** Haptics on or off; turning them on answers with one tap, so the user feels what they chose. */
    updateHaptics(value) {
      if (!this.hapticsSupported) {
        if (value) {
          this.promptForApp(
            this.$t('Haptics are felt through the phone and are only available in the BuhoGO Android app. Install it from Google Play to feel a tap for payments, errors and other key moments.')
          )
        }
        return
      }
      setHapticsEnabled(value)
      this.hapticsOn = value
      if (value) haptics.tap()
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

    selectableFiatCurrencies() {
      return SELECTABLE_FIAT_CURRENCIES
    },

    /** What one unit of the currency buys, "$1 = 1,180 sats". The stored rate is the price of one bitcoin. */
    fiatUnitRate(currency) {
      const btcPrice = this.exchangeRates[currency.toLowerCase()]
      const sats = btcPrice > 0 ? this.formatSats(Math.round(100000000 / btcPrice)) : '--'
      return `${this.getCurrencySymbol(currency)}1 = ${sats}`
    },

    getCurrencySymbol(currency) {
      return fiatSymbol(currency)
    },

    getCurrencyFlag(currency) {
      return fiatFlag(currency)
    },

    formatBalance(balance) {
      return formatAmount(balance, this.useBip177Format)
    },

    async checkBiometricAvailability() {
      const { available, biometryType } = await isBiometricAvailable()
      this.biometricsAvailable = available
      this.biometryType = biometryType
      // Sync toggle with store
      const store = useWalletStore()
      this.biometricsEnabled = store.biometricsEnabled
    },

    async toggleBiometrics(value) {
      if (value) {
        // Probe availability before showing the explain dialog so we can
        // tell the user which method will actually be used (fingerprint,
        // Face ID, device PIN). If nothing is available, bail early with
        // a plain-language notice. The toggle stays visually OFF (via
        // the one-way :model-value binding) until the dialog confirms.
        const { available, biometryType } = await isBiometricAvailable()
        if (!available) {
          this.$q.notify({
            message: this.$t('No screen lock set on this device'),
            color: 'warning',
            timeout: 3000
          })
          return
        }

        this.pendingBiometryType = biometryType
        this.showBiometricEnableDialog = true
      } else {
        // Straightforward disable. A follow-up should gate this behind
        // re-auth so a briefly-unlocked phone can't flip it off with a
        // single tap (known gap tracked separately).
        this.biometricsEnabled = false
        this.updateBiometricsEnabled(false)
        this.$q.notify({
          message: this.$t('App lock disabled'),
          color: 'positive',
          timeout: 1500
        })
      }
    },

    /**
     * Flip the Screen Privacy toggle.
     *
     * On web / PWA the underlying OS primitive doesn't exist, so
     * any tap to enable opens the Get-the-App dialog instead of
     * updating store state. The toggle's one-way `:model-value`
     * binding ensures it visually stays OFF — the user sees the
     * dialog appear in lieu of the toggle flipping, which makes
     * the constraint self-explanatory.
     *
     * On native we update pessimistically: the Pinia state only
     * flips after the plugin confirms the value has been persisted
     * to SharedPreferences AND applied to the window. If the native
     * call rejects, the store stays at its last good value (the
     * action doesn't mutate on rejection) and we surface a warning
     * toast so the toggle visually springs back.
     *
     * @param {boolean} value
     */
    async togglePrivacyScreen(value) {
      if (!this.screenPrivacySupported) {
        // Only prompt on the enable attempt — there's nothing to
        // disable on web because the toggle never actually goes ON.
        if (value) {
          this.promptForApp(
            this.$t('Screen-capture protection runs on the device and is only available in the BuhoGO Android app. Install it from Google Play to keep your screen private.')
          );
        }
        return;
      }

      try {
        await this.walletStore.updatePrivacyScreenEnabled(value);
        this.$q.notify({
          message: value
            ? this.$t('Screen privacy enabled')
            : this.$t('Screen privacy disabled'),
          color: 'positive',
          timeout: 1500,
        });
      } catch (error) {
        console.error('[settings] Privacy screen toggle failed:', error);
        this.$q.notify({
          message: this.$t("Couldn't update screen privacy"),
          color: 'warning',
          timeout: 3000,
        });
      }
    },

    /** Quick access in the app; the Get-the-App dialog on the web. */
    openQuickAccess() {
      if (this.quickAccessSupported) {
        this.showQuickAccessSheet = true;
        return;
      }
      this.promptForApp(
        this.$t('Quick access puts Send, Receive and Scan QR on your Home screen and in Quick Settings, and is only available in the BuhoGO Android app. Install it from Google Play to open them in one tap.')
      );
    },

    /**
     * Open the shared Get-the-App dialog with a feature-specific
     * message. Used by every native-only feature that wants to
     * surface honestly on web instead of being silently disabled —
     * screen privacy, biometric app lock, haptics, Quick access,
     * future Android-only protections.
     *
     * @param {string} message - already-localized body line
     *   describing the feature being requested.
     */
    promptForApp(message) {
      this.getAppDialogMessage = message;
      this.showGetAppDialog = true;
    },

    /**
     * Open the shared Get-the-App dialog for Learn & Earn. Single source
     * of the app-only message so the card-tap gate and
     * the router-guard redirect landing (mounted) stay in sync.
     */
    promptForLearnEarnApp() {
      this.promptForApp(
        this.$t('Learn & Earn is only available in the BuhoGO Android app. Install it from Google Play to complete lessons and earn sats.')
      );
    },

    /**
     * Called by BiometricEnableDialog after the user confirmed AND the
     * native biometric prompt passed. The dialog owns the auth flow; at
     * this point we just persist the setting and confirm back to the
     * user that it is now active.
     */
    onBiometricEnableConfirmed() {
      this.biometricsEnabled = true
      this.updateBiometricsEnabled(true)
      this.$q.notify({
        message: this.$t('App lock enabled'),
        color: 'positive',
        timeout: 1500
      })
    },

    getWalletAvatarClass(wallet) {
      const colors = ['wallet-green', 'wallet-blue', 'wallet-purple', 'wallet-orange', 'wallet-red']
      const index = wallet.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length
      return colors[index]
    },

    /**
     * Live for the detail panel: connected, and for NWC also answering when
     * last asked (store.nwcStatus), so a silent wallet offers Reconnect.
     */
    isWalletLive(wallet) {
      if (!this.connectionStates[wallet.id]?.connected) return false;
      if (this.walletStore.connectionEnded[wallet.id]) return false;
      if ((wallet.type || 'nwc') !== 'nwc') return true;
      return !['no-answer', 'relay', 'ended'].includes(this.walletStore.nwcStatus[wallet.id]);
    },

    /**
     * The detail panel's line about a connection that is not working: what
     * ended it and what brings it back, or that the wallet is offline.
     */
    connectionProblemText(wallet) {
      if (this.walletStore.connectionEnded[wallet.id]) {
        return wallet.type === 'lnbits'
          ? this.$t('LNbits no longer opens this wallet with its key. Disconnect it here, then add it again with a current key.')
          : this.$t('This connection was removed or has expired. Create a new one in {wallet}.', { wallet: wallet.name });
      }
      return this.connectionStates[wallet.id]?.error
        ? this.$t('This wallet is offline right now. Check your connection, then tap Reconnect.')
        : '';
    },

    async reconnectWallet(walletId) {
      if (this.isReconnecting[walletId]) return

      this.isReconnecting[walletId] = true

      try {
        const wallet = this.wallets.find(w => w.id === walletId)
        if (wallet?.type === 'spark') {
          // Rebuild only this wallet; the other Spark wallet stays live (#285).
          await this.connectSparkWallet(walletId, { forceReinit: true })
          void this.walletStore.reconcileSpark([walletId], 'user')
        } else {
          await this.connectWallet(walletId)
          // NWC: connecting only sets the connection up. Ask the wallet, and
          // only call it reconnected when it answered.
          if ((wallet?.type || 'nwc') === 'nwc') {
            const status = await this.walletStore.refreshNwcDetails(walletId)
            if (status === 'ended') throw nwcError('UNAUTHORIZED')
            if (status !== 'answering') {
              throw nwcError(status === 'relay' ? NWC_ERROR.RELAY_UNREACHABLE : NWC_ERROR.NO_ANSWER)
            }
          }
        }
        this.$q.notify({
          type: 'positive',
          message: this.$t('Reconnected'),
        })
      } catch (error) {
        this.walletStore.showPaymentError(error, {
          context: 'connect',
          route: 'Reconnect wallet',
          walletName: this.wallets.find(w => w.id === walletId)?.name || '',
          t: this.$t.bind(this),
        })
      } finally {
        this.isReconnecting[walletId] = false
      }
    },

    async handleSwitchWallet(walletId) {
      try {
        const wallet = this.wallets.find(w => w.id === walletId)
        await this.switchActiveWallet(walletId)
        this.$q.notify({
          type: 'positive',
          message: this.$t('Switched to {name}', { name: wallet?.name || 'Wallet' }),
        })
      } catch (error) {
        this.walletStore.showPaymentError(error, {
          context: 'connect',
          route: 'Switch wallet',
          t: this.$t.bind(this),
        })
      }
    },

    /** Names joined the way the person's language joins them ("Alby Hub and Kitty"). */
    listNames(names) {
      try {
        return new Intl.ListFormat(this.$i18n.locale, { style: 'long', type: 'conjunction' }).format(names);
      } catch {
        return names.join(', ');
      }
    },

    /** Every Spark wallet, and their shared recovery phrase, off this phone. */
    confirmRemoveSpark() {
      const balanceSats = this.sparkWallets.reduce((sum, w) => sum + (this.walletStore.getDisplayBalance(w.id).balance || 0), 0);
      const copy = sparkRemovalCopy({
        check: this.walletStore.sparkRemovalCheck(),
        t: this.$t.bind(this),
        formatAmount: this.formatSats,
        balanceSats,
        includesKioskWallet: this.walletStore.kioskEnabled && this.sparkWallets.some((w) => w.id === this.walletStore.kioskWalletId),
      });
      if (copy.blocked) {
        this.showRemovalBlocked(copy, this.sparkWallets[0]?.id);
        return;
      }
      this.askToRemove(copy, () => this.walletStore.removeSparkFromDevice(), () => this.confirmRemoveSpark());
    },

    /** Every connected wallet (NWC, LNbits): only connections leave. */
    confirmDisconnectAll() {
      const wallets = this.wallets.filter((w) => walletKind(w) === WALLET_KIND.CONNECTED);
      if (!wallets.length) return;
      const copy = disconnectAllCopy({
        wallets,
        t: this.$t.bind(this),
        listNames: this.listNames,
        includesKioskWallet: this.walletStore.kioskEnabled && wallets.some((w) => w.id === this.walletStore.kioskWalletId),
      });
      this.askToRemove(copy, () => this.walletStore.disconnectConnectedWallets());
    },

    /**
     * Ask the way the copy says: a plain alert, or the typed confirmation
     * when a recovery phrase leaves this phone. `recheck` runs again when
     * the store refuses because something changed since the check.
     */
    askToRemove(copy, remove, recheck = null) {
      if (copy.typed) {
        this.typedRemoval = { copy, remove, recheck };
        this.typedRemovalInput = '';
        this.showTypedRemoval = true;
        return;
      }
      this.$q.dialog({
        title: copy.title,
        message: copy.message,
        cancel: { label: this.$t('Cancel'), flat: true, noCaps: true },
        ok: { label: copy.confirmLabel, color: 'negative', flat: true, noCaps: true },
        class: this.$q.dark.isActive ? 'card_dark_style' : 'card_light_style',
        dark: this.$q.dark.isActive,
      }).onOk(() => this.runRemoval(copy, remove, recheck));
    },

    async confirmTypedRemoval() {
      if (!this.typedRemoval || this.typedRemovalInput !== this.typedRemovalPhrase || this.isRemoving) return;
      const { copy, remove, recheck } = this.typedRemoval;
      this.isRemoving = true;
      try {
        await this.runRemoval(copy, remove, recheck);
      } finally {
        this.isRemoving = false;
        this.showTypedRemoval = false;
      }
    },

    async runRemoval(copy, remove, recheck) {
      try {
        await remove();
        this.$q.notify({ type: 'positive', message: copy.doneMessage });
        // Nothing left to manage: back to the start.
        if (this.wallets.length === 0) this.$router.push('/');
      } catch (error) {
        if (error?.code === 'WALLET_REMOVAL_BLOCKED' && recheck) {
          // The situation changed since the check (money arrived): explain it.
          this.showTypedRemoval = false;
          recheck();
          return;
        }
        this.walletStore.showPaymentError(error, { route: 'Remove wallet', t: this.$t.bind(this) });
      }
    },

    /**
     * Handle donation - fetches LNURL-pay invoice and shows QR code
     */
    /**
     * Format bitcoin amount for display (BIP-177)
     */
    formatSats(amount) {
      // Use utility for BIP-177 or Legacy format
      return formatAmount(amount, this.useBip177Format);
    },

    /** One wallet off this phone, from its details or the Danger Zone. */
    async confirmRemoveWallet(walletId) {
      const wallet = this.wallets.find((w) => w.id === walletId);
      if (!wallet) return;
      // Only a balance read just now can show a wallet is empty.
      if (walletKind(wallet) === WALLET_KIND.ON_PHONE) {
        await this.walletStore.refreshBalance(walletId).catch(() => {});
      }
      const copy = removalCopy({
        check: this.walletStore.removalCheckFor(walletId),
        wallet,
        t: this.$t.bind(this),
        formatAmount: this.formatSats,
        balanceSats: this.walletStore.getDisplayBalance(walletId).balance,
        // Turning kiosk off keeps its wallet for next time: only a kiosk that
        // is on stops taking payments.
        isKioskWallet: this.walletStore.kioskEnabled && this.walletStore.kioskWalletId === walletId,
      });
      if (copy.blocked) {
        this.showRemovalBlocked(copy, walletId);
        return;
      }
      this.askToRemove(copy, () => this.walletStore.removeWallet(walletId), () => this.confirmRemoveWallet(walletId));
    },

    /** The wallet's Auto-Transfer rule in a few words, for its details. */
    autoTransferSummary(walletId) {
      const rule = useAutoWithdrawStore().getConfig(walletId);
      if (!rule) return '';
      if (!rule.enabled) return this.$t('Paused');
      return this.$t('To {name}', { name: destinationLabel(rule.destination, { wallets: this.wallets }) });
    },

    /** The wallet's rule, or the setup sheet for a new one. */
    openAutoTransfer(walletId) {
      this.showWalletsDialog = false;
      this.$router.push(useAutoWithdrawStore().getConfig(walletId) ? `/auto-transfer/${walletId}` : { path: '/auto-transfer', query: { new: walletId } });
    },

    /** Security, opened on this wallet's recovery phrase. */
    openPhraseBackup(walletId) {
      this.showWalletsDialog = false;
      this.$router.push({ path: '/security', query: { open: 'backup', wallet: walletId } });
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

        });
      } else {
        const pinState = JSON.parse(localStorage.getItem('buhoGO_pin_state'));
        if (pinState.pin !== this.currentPin) {
          this.$q.notify({
            type: 'negative',
            message: this.$t('Incorrect PIN'),

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

        });
      }
    },

    loadMempoolSettings() {
      this.customMempoolUrl = fiatRatesService.customApiUrl;
    },

    openExchangeRates() {
      this.ratesLastUpdate = fiatRatesService.lastUpdate;
      this.showMempoolDialog = true;
    },

    checkMempoolServer(url) {
      return checkMempoolServer(url);
    },

    /** The sheet checked the server already; switch to it and fetch prices from it now. */
    async onRateServerChange(url) {
      fiatRatesService.setCustomApiUrl(url);
      this.customMempoolUrl = url;
      await fiatRatesService.fetchLatestRates();
      this.ratesLastUpdate = fiatRatesService.lastUpdate;
      this.loadExchangeRates();
    },

    getCurrentLanguageLabel() {
      const currentLang = this.localeOptions.find(lang => lang.value === this.$i18n.locale)
      return currentLang ? currentLang.label : 'English'
    },

    setLanguage(languageCode) {
      if (!applyLocale(this.$i18n, languageCode)) return
      this.showLanguageDialog = false

      this.$q.notify({
        type: 'positive',
        message: this.$t('Language updated'),
      })
    },

    /**
     * Hands off to the system mail client with a prefilled subject/body,
     * same lightning: URL pattern the donation card uses.
     */
    requestMissingLanguage() {
      const subject = encodeURIComponent(this.$t('Language request'))
      const body = encodeURIComponent(`${this.$t('Hi BuhoGO team, I would love to see BuhoGO in:')}\n\n`)
      window.location.href = `mailto:contact@mybuho.de?subject=${subject}&body=${body}`
      this.showMissingLanguageDialog = false
    },

    openTelegramCommunity() {
      window.open('https://telegram.me/+cpmyopRYnKRlOTRi', '_blank', 'noopener,noreferrer')
      this.showMissingLanguageDialog = false
    },

    openNostrCommunity() {
      if (!this.nostrCommunityUrl) {
        this.$q.notify({
          type: 'info',
          message: this.$t('Nostr community coming soon'),
          timeout: 2500,
        })
        return
      }
      window.open(this.nostrCommunityUrl, '_blank', 'noopener,noreferrer')
      this.showMissingLanguageDialog = false
    },

    loadLanguagePreference() {
      // Boot already restores the saved locale on app start; this keeps
      // Settings in sync if it mounts before the user-driven change.
      const saved = getSavedLocale()
      if (saved && saved !== this.$i18n.locale) {
        this.$i18n.locale = saved
      }
    },

    // Spark wallet methods
    getWalletTypeIcon(wallet) {
      return wallet.type === 'spark' ? 'tabler:bolt' : 'tabler:link';
    },

    getWalletTypeLabel(wallet) {
      return walletTypeLabel(wallet);
    },

    /** A wallet's row: its own page. */
    openWalletDetail(walletId) {
      this.detailWalletId = walletId;
      this.showWalletsDialog = true;
    },

    /** Back from a wallet's page: the sheet closes, focus returns to its row (onWalletDetailHidden). */
    closeWalletDetail() {
      this.showWalletsDialog = false;
    },

    onWalletDetailHidden() {
      const walletId = this.lastDetailWalletId;
      this.lastDetailWalletId = null;
      if (!walletId) return;
      // A wallet that just left this phone has no row: Add wallet takes the focus.
      const row = document.querySelector(`.settings-content [data-wallet-id="${CSS.escape(walletId)}"]`);
      (row || document.querySelector('.settings-content [data-audit="settings-add-wallet"]'))?.focus({ preventScroll: true });
    },

    /** A wallet row's caption starts with its kind ("NWC"); the group's footer says where each kind lives. */
    walletRowKind(wallet) {
      return this.getWalletTypeLabel(wallet);
    },

    openAddSparkWallet() {
      this.showAddWalletDialog = false;
      this.showAddSparkSheet = true;
    },

    /** The new wallet is the active one now: say so, by name. */
    onSparkWalletCreated(wallet) {
      this.$q.notify({ type: 'positive', message: this.$t('Switched to {name}', { name: wallet.name }), position: 'top' });
    },

    openMoveAddress(walletId) {
      this.moveAddressWalletId = walletId;
      this.showMoveAddressSheet = true;
    },

    onAddressMoved({ moved, target }) {
      this.$q.notify({ type: 'positive', message: this.$t('{address} now receives into {name}', { address: moved, name: target.name }), position: 'top' });
    },

    /** Change the Lightning address of any Spark wallet, not only the active one. */
    openLightningAddressSheet(walletId) {
      this.lnAddressWalletId = walletId || this.activeWalletId;
      this.showSparkLnAddressSheet = true;
    },

    /** A removal the rules refuse: say why, and offer the one step that unblocks it. */
    showRemovalBlocked(copy, walletId) {
      this.$q.dialog({
        title: copy.title,
        message: copy.message,
        ok: copy.action ? { label: copy.actionLabel, flat: true, noCaps: true } : { label: this.$t('OK'), flat: true, noCaps: true },
        cancel: copy.action ? { label: this.$t('Not now'), flat: true, noCaps: true } : false,
        class: this.$q.dark.isActive ? 'card_dark_style' : 'card_light_style',
        dark: this.$q.dark.isActive,
      }).onOk(() => {
        if (copy.action === 'backup') {
          this.openPhraseBackup(walletId);
        } else if (copy.action === 'move_funds') {
          this.transferFromWalletId = walletId;
          this.showTransferModal = true;
        }
      });
    },

    async refreshSparkLightningAddress() {
      if (!this.isActiveWalletSpark) return;
      const provider = this.walletStore.providers[this.activeWalletId];
      if (!provider?.getLightningAddress) return;
      try {
        const info = await provider.getLightningAddress();
        if (this.walletStore.walletInfos[this.activeWalletId]) {
          this.walletStore.walletInfos[this.activeWalletId].lightningAddress =
            info?.lightningAddress || null;
        }
      } catch (e) { /* row falls back to the cached value */ }
    },

    async copyToClipboard(text, successMessage) {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        this.$q.notify({
          type: 'positive',
          message: successMessage || this.$t('Copied'),
        });
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to copy'),
        });
      }
    },

    /** An Arkade wallet's own ark1/tark1 address, whether or not it is the active wallet. */
    arkadeAddressOf(wallet) {
      return this.walletStore.walletInfos[wallet.id]?.arkadeAddress || wallet.metadata?.arkadeAddress || null;
    },

    async copyArkadeAddress(address) {
      await this.copyToClipboard(address, this.$t('Arkade address copied'));
    },

    async shareArkadeAddress(address) {
      if (!address) return;

      const result = await shareContent({
        title: this.$t('Arkade address'),
        text: address
      });

      if (result.success) {
        // Native share UI provides its own feedback.
      } else if (result.reason === 'unsupported' || result.reason === 'error') {
        if (result.reason === 'error') {
          console.error('Failed to share Arkade address:', result.error);
        }
        await this.copyArkadeAddress(address);
      }
    },

    // ==========================================
    // Recovery phrase (unified view + backup flow)
    // ==========================================


    navigateToCreateSpark() {
      this.showAddWalletDialog = false;
      this.$router.push('/spark-setup');
    },

    navigateToRestoreSpark() {
      this.showAddWalletDialog = false;
      this.$router.push('/spark-restore');
    },

    navigateToConnectWallet() {
      this.showAddWalletDialog = false;
      this.$router.push('/connect-wallet');
    },

    navigateToCreateArkade() {
      this.showAddWalletDialog = false;
      this.$router.push('/arkade-setup');
    },

    navigateToRestoreArkade() {
      this.showAddWalletDialog = false;
      this.$router.push('/arkade-restore');
    },

    /**
     * A wallet row's balance from the store's canonical state (#293): the
     * known value (stale ones are styled as such), or a dash while nothing
     * is known yet — never a 0 standing in for "not loaded".
     */
    walletBalanceText(walletId) {
      const d = this.walletStore.getDisplayBalance(walletId)
      // Callers show a placeholder for an unknown balance; never a dash.
      return d.known ? this.formatBalance(d.balance) : ''
    },

    formatFiatValue(sats) {
      if (!sats) return '';
      return this.walletStore.fiatValueOf(sats);
    }
  }
}
</script>

<style scoped>
/* Pay Links is off on this LNbits server: an amber dot before the caption. */

.settings-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
  /* SettingsHubHeader is sticky and adds its own safe-top padding;
     cancel the global .q-page safe-top inset so it isn't doubled. */
  padding-top: 0;
}

.bg-dark {
  background: #0C0C0C;
  color: #FFF;
}

.bg-light {
  /* Single source of truth lives in app.css → body.body--light → --bg-primary */
  background: var(--bg-primary);
  color: var(--text-primary);
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
  border-bottom-color: var(--border-card);
}

.header-light {
  border-bottom-color: var(--border-card);
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
  color: var(--text-primary);
}

.back-btn-dark:hover {
  background: #2A342A;
}

.back-btn-light:hover {
  background: var(--bg-input);
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
  font-family: 'Manrope', sans-serif;
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
  /* Bottom padding clears the floating SettingsHubNav pill so the last
     section is never hidden underneath it. */
  padding: 1rem 1rem calc(96px + var(--safe-bottom, 0px));
}

/* Section Labels */
.section-label {
  font-family: 'Manrope', sans-serif;
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
  color: var(--text-muted);
}

.section-label-light {
  color: var(--text-muted);
}

.donation-portal-link .q-icon {
  color: #ff6b9d;
}

/* Typed removal confirmation (a recovery phrase leaves this phone) */
.typed-removal-card {
  width: 100%;
  max-width: 320px;
  border-radius: 16px;
}

.typed-removal-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 22px 20px 6px;
  text-align: center;
  font-family: 'Manrope', sans-serif;
}

.typed-removal-title {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.3;
}

.typed-removal-message {
  font-size: 14px;
  line-height: 1.45;
  color: var(--text-secondary);
}

.typed-removal-input {
  margin-top: 8px;
}

.typed-removal-input :deep(.q-field__control) {
  border-radius: 10px;
}

.typed-removal-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 8px 12px 12px;
}

.typed-removal-cancel,
.typed-removal-confirm {
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
  border-radius: 10px;
}

.typed-removal-confirm {
  color: var(--color-negative, #B42332);
  font-weight: 700;
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

/* Lightning Address row — informational/disabled state.
   Used when the LNbits server lacks the lnurlp extension. Dimmed so the
   user can tell at a glance that this row is not actionable, without
   removing it entirely (their wallet still works for everything else). */
.ln-address-row-disabled {
  opacity: 0.55;
  cursor: default;
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
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 0.125rem;
}

.card-subtitle {
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
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
  border-top-color: var(--border-card);
}

.disconnect-container {
  max-width: 400px;
  margin: 0 auto;
}

.disconnect-btn {
  width: 100%;
  height: 44px;
  border-radius: 18px;
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
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
  border-bottom-color: var(--border-card);
}

.close-btn {
  width: 32px;
  height: 32px;
}

.dialog-content {
  padding: 1.5rem;
}

/* ----------------------------------------------------------------
   Picker dialog — scrollable shell shared by Currency and Language
   (same proven pattern as .wallets-dialog-card below): capped
   height, header stays put, list scrolls internally. Fixes the
   picker running off-screen on short devices instead of overflowing
   past the viewport edge.
---------------------------------------------------------------- */
.picker-dialog-card {
  width: 100%;
  max-width: min(420px, 92vw);
  max-height: 82vh;
  border-radius: 24px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.picker-dialog-header {
  flex-shrink: 0;
}

.picker-dialog-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.5rem 1.25rem 1.25rem;
  min-height: 0;
  scrollbar-width: none;
}

.picker-dialog-content::-webkit-scrollbar {
  display: none;
}

/* Tighter rows so more options are visible per scroll. */
.picker-dialog-content .currency-item,
.picker-dialog-content .language-item {
  padding: 10px 12px;
}

.picker-row-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.flag-badge {
  width: 34px;
  height: 34px;
  min-width: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  background: var(--bg-input);
  flex-shrink: 0;
}

/* "Miss a language?" escape hatch — one quiet line under the list,
   not a button, so it doesn't compete with the actual choices. */
.missing-lang-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin-top: 0.75rem;
  padding: 10px;
  border: none;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 12px;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.missing-lang-link-dark {
  color: var(--text-muted, #9CA3AF);
}
.missing-lang-link-dark:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.missing-lang-link-light {
  color: var(--text-secondary);
}
.missing-lang-link-light:hover {
  background: rgba(40, 34, 20, 0.06);
  color: var(--text-primary);
}

/* ----------------------------------------------------------------
   Missing-language request popup — compact, friendly confirm-style
   card (same shell shape as .typed-removal-card, brand-green
   instead of alarm-red since this is an invitation, not a warning).
---------------------------------------------------------------- */
.lang-request-card {
  width: 100%;
  max-width: 340px;
  border-radius: 20px;
}

.lang-request-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1.75rem 1.5rem 0.5rem;
}

.lang-request-icon-wrapper {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(21, 222, 114, 0.14);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.lang-request-icon {
  color: #15DE72;
}

.lang-request-title {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.lang-request-message {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

.lang-request-actions {
  padding: 0.5rem 1.5rem 1.75rem;
}

/* Three equal-weight contact channels — email, Telegram, Nostr.
   Soft brand-tinted circles rather than solid-fill tiles, matching
   the app's existing "quiet tint" language (wallet-hint, seed-callout,
   quick-chip.active) instead of a loud row of saturated brand colors. */
.channel-row {
  width: 100%;
  display: flex;
  justify-content: center;
  gap: 22px;
}

.channel-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.channel-icon {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.12s ease, filter 0.15s ease;
}

.channel-btn:active .channel-icon {
  transform: scale(0.93);
}

.channel-icon--email {
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
}

.channel-icon--telegram {
  background: rgba(38, 165, 228, 0.14);
  color: #26A5E4;
}

/* The Nostr PNG already carries its own purple fill and mark, so the
   tile just frames it at the same footprint as the other two — no
   extra background or icon color needed. */
.channel-icon--nostr {
  background: transparent;
}

.channel-icon-img {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  object-fit: cover;
  display: block;
}

.channel-soon-badge {
  position: absolute;
  bottom: -4px;
  right: -6px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--bg-card);
  box-shadow: inset 0 0 0 1px var(--border-card);
  color: var(--text-secondary);
  font-family: 'Manrope', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.channel-label {
  font-family: 'Manrope', sans-serif;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-secondary);
}

/* ----------------------------------------------------------------
   Language + Currency selection — unified tinted-fill dialogs.

   Inactive rows wear a neutral translucent wash (no chunky borders).
   The active row gets the brand-green tinted pane with a 1px inset
   ring and a green check — same visual grammar as the Send/Receive
   buttons, the Spark/Lightning/Bitcoin toggle, and the Copy/Share
   buttons. Newbies get one consistent selection pattern across the
   whole app: "tinted green = this one is selected".
---------------------------------------------------------------- */
.currency-list,
.language-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.currency-item,
.language-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-radius: 14px;
  border: none;
  cursor: pointer;
  /* Reserve the inset ring slot so active state can fade in
     smoothly without a layout shift. */
  box-shadow: inset 0 0 0 1px transparent;
  transition:
    background-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease;
}

/* Inactive: neutral translucent wash, lightly brighter on hover. */
.currency-item-dark,
.language-item-dark {
  background: rgba(255, 255, 255, 0.04);
}

.currency-item-dark:hover,
.language-item-dark:hover {
  background: rgba(255, 255, 255, 0.07);
}

.currency-item-light,
.language-item-light {
  background: var(--bg-input);
}

.currency-item-light:hover,
.language-item-light:hover {
  background: rgba(40, 34, 20, 0.06);
}

/* Active: brand-green tinted pane with inset ring. */
.currency-item.active,
.language-item.active {
  background: rgba(21, 222, 114, 0.14);
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22);
}

/* Active in light mode uses the deeper green for WCAG contrast. */
.body--light .currency-item.active,
.language-item-light.active,
.currency-item-light.active {
  background: rgba(5, 149, 115, 0.10);
  box-shadow: inset 0 0 0 1px rgba(5, 149, 115, 0.20);
}

.currency-info,
.language-info {
  flex: 1;
}

/* Info affordance next to a toggle (Advanced). */

.currency-code,
.language-name {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 1.2;
  margin-bottom: 2px;
}

.currency-rate,
.language-code {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  opacity: 0.7;
  line-height: 1.2;
}

.check-icon {
  color: #15DE72;
  font-size: 20px;
  flex: 0 0 auto;
  margin-left: 12px;
}

.body--light .check-icon {
  color: #059573;
}

/* Wallet Statistics */

/* Wallets List */
/* Wallets Dialog - Scrollable Layout */
.wallets-dialog-card {
  width: 100%;
  /* A sheet, not a page: bounded on tablets and desktop, full width on phones. */
  max-width: 560px;
  margin: 0 auto;
  max-height: 92dvh;
  border-radius: 24px 24px 0 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.wallet-row-fiat {
  display: block;
  margin-top: 2px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  opacity: 0.7;
}

/* Wallet Avatar */

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

/* Wallet Details */

.wallet-error-msg {
  font-family: 'Manrope', sans-serif;
  font-size: 10px;
  color: #EF4444;
  font-weight: 500;
  margin-top: 0.125rem;
}

/* Wallet Card Actions */

.connect-wallet-btn {
  width: 100%;
  height: 48px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
}

.input-help {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 400;
  padding: 0 1.5rem;
}

/* Responsive Design */
@media (max-width: 480px) {
  .settings-content {
    padding: 0.75rem 0.75rem calc(96px + var(--safe-bottom, 0px));
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

  .app-title {
    font-size: 18px;
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

  .picker-dialog-card {
    max-height: 88vh;
  }

  .dialog-actions {
    padding: 1rem 1.25rem 1.25rem;
  }
}

/* Auto-add Bitcoin deposits info popup. A flex column, so the middle
 * section scrolls when the content is taller than the viewport. */
.info-dialog {
  width: 100%;
  max-width: 440px;
  max-height: min(92vh, 760px);
  display: flex;
  flex-direction: column;
}
.info-dialog .dialog-content {
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.info-hero {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 4px 0 14px;
}
.info-hero-img {
  width: 72%;
  max-width: 230px;
  height: auto;
}
.info-text {
  font-size: 14px;
  line-height: 1.5;
  margin: 0 0 12px;
}
.info-text--muted {
  font-size: 13px;
  opacity: 0.85;
  margin-bottom: 0;
}

.settings-footer-link {
  color: var(--brand-accent-text, var(--text-primary));
  font-weight: 600;
  text-decoration: none;
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
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  padding-left: 4px;
}

.pin-input-dark {
  border-radius: 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
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
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  color: var(--text-primary);
}

.pin-input-light .q-field__native,
.pin-input-light .q-field__input {
  color: var(--text-primary) !important;
}

.pin-input-light .q-field__native::placeholder {
  color: var(--text-muted) !important;
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
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  text-align: center;
  margin-top: 8px;
}

.pin-hint {
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.spark-address-text {
  font-family: var(--font-mono);
  font-size: 10px;
}

/* Legacy Wallet Type Badges (kept for compatibility) */
.spark-type-badge {
  background: linear-gradient(135deg, #15DE72, #059573);
  color: white;
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
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

.option-disabled {
  cursor: default;
  opacity: 0.55;
}

.option-dark {
  background: var(--bg-secondary);
}

.option-light {
  background: var(--bg-secondary);
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

.connect-option-icon {
  background: linear-gradient(135deg, #2A2A2A, #1A1A1A);
}

.arkade-option-icon {
  background: linear-gradient(135deg, #2A2A2A, #1A1A1A);
}

.option-content {
  flex: 1;
}

.option-title {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.option-subtitle {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
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
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  white-space: nowrap;
}

.badge-verified {
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22);
}

.badge-unverified {
  background: rgba(251, 191, 36, 0.12);
  color: #F59E0B;
}

/* Backup Dialog */
/* NWC Method Chips */
.nwc-methods-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.nwc-method-chip {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

.nwc-method-chip-dark {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.5);
}

.nwc-method-chip-light {
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.5);
}


/* ─── Grouped list (Settings root) ─────────────────────────────
   One large title that hands over to the bar once scrolled, then the
   groups. Wallet rows carry their own logo tiles (WalletLogoTile). */
.settings-large-title {
  margin: 4px 4px 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--text-primary);
}

/* Balance on the right of a wallet row: the figure, fiat under it. */
.wallet-row-amount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 0;
  max-width: 46vw;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  text-align: right;
  white-space: nowrap;
}
.wallet-row-amount--total { font-size: 15px; font-weight: 700; }
.wallet-row-amount .wallet-row-fiat { color: var(--text-secondary); opacity: 1; }
.wallets-total-row :deep(.settings-row-label) { font-weight: 700; }

/* After the kind on a wallet row: Active, what came in, or why it is quiet. */
.wallet-row-state--active { color: var(--brand-accent-text); font-weight: 600; }
.wallet-row-state--unseen { color: var(--brand-accent-text); font-weight: 600; }
.wallet-row-state--off { color: var(--text-secondary); }

/* A slot icon lives in this page's scope, so the chevron is styled here. */
/* A wallet's name is typed by its owner and can be one long word: the
   balance moves under it early, and only such a word breaks. */
.wallet-list-row :deep(.settings-row-body) { flex: 1 1 8rem; min-width: 0; }
.wallet-list-row :deep(.settings-row-label) { overflow-wrap: anywhere; }

.settings-row-chevron { flex-shrink: 0; color: var(--text-muted); opacity: 0.7; }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

/* Advanced: a form sheet ending on Done, like Notifications. */
.settings-sheet-card {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  max-height: min(90dvh, calc(100dvh - var(--safe-top, 0px) - 8px));
  overflow-y: auto;
  border-radius: 24px 24px 0 0;
  padding-bottom: max(20px, var(--safe-bottom, 0px));
}
.settings-sheet-body { padding: 4px 16px 0; }
.settings-sheet-done { justify-self: end; font-weight: 600; }
</style>
