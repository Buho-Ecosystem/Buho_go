<template>
  <q-page class="settings-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <SettingsHubHeader :title="$t('Settings')" />

    <!-- Settings Content -->
    <div class="settings-content">

      <!--
        Top-of-page surface: attention strip → quick toggles. These
        pieces are the "always-on" affordances that turn Settings from
        a flat scrollable list into something a mainstream user can
        scan, act on, and live in. They sit above every section so even
        a user who never scrolls past the first fold still gets the
        high-value entry points (warnings, frequent toggles).
      -->
      <!-- Paused: backup status lives on the Security page.
      <SettingsAttentionStrip
        :warnings="attentionWarnings"
        @action="onAttentionAction"
        @dismiss="onAttentionDismiss"
      />
      -->

      <SettingsQuickToggles
        :toggles="quickToggles"
        @toggle="onQuickToggle"
      />

      <!-- ─────────────── WALLET ─────────────── -->
      <SettingsSection :title="$t('Wallet')">
        <!-- Active wallet info — adapts to wallet type. -->

        <!-- Spark Wallet: only the ACTIVE one; every Spark wallet is listed
             in the home switcher and Manage Wallets. -->
        <template v-if="isActiveWalletSpark && hasSparkWallet">
          <SettingsRow
            :label="activeWallet?.name || $t('Wallet')"
            :show-chevron="false"
            :interactive="false"
          >
            <!-- The wallet's own mark: the wallet glyph means "Manage Wallets" below. -->
            <template #icon>
              <WalletBrandMark type="spark" :size="18" color="currentColor" />
            </template>
            <template #caption>
              <span v-if="!walletStore.getDisplayBalance(activeWalletId).known" class="balance-placeholder" role="img" :aria-label="$t('Balance not loaded yet')" />
              <HiddenAmount v-else :class="{ 'balance-stale': walletStore.getDisplayBalance(activeWalletId).outdated }">{{ walletBalanceText(activeWalletId) }}</HiddenAmount>
            </template>
            <template #right>
              <Icon icon="tabler:circle-check-filled" width="18" height="18" style="color: #15DE72;" />
            </template>
          </SettingsRow>

          <!--
            Lightning Address row. The address is registered server-side
            against the wallet identity, so it survives reinstall and
            recovery; the sheet shows it and handles changing the name.
          -->
          <SettingsRow
            icon="tabler:at"
            :label="$t('Lightning Address')"
            :caption-mono="!!activeWalletLightningAddress"
            :interactive="true"
            :show-chevron="true"
            @click="openLightningAddressSheet(activeWalletId)"
          >
            <template #caption>
              <template v-if="activeWalletLightningAddress">{{ activeWalletLightningAddress }}</template>
              <template v-else>{{ $t('Get one to receive payments by name') }}</template>
            </template>
            <template v-if="activeWalletLightningAddress" #right>
              <q-btn
                flat round dense size="sm"
                @click.stop="copyToClipboard(activeWalletLightningAddress, $t('Lightning address copied'))"
              >
                <Icon icon="tabler:copy" width="16" height="16" />
              </q-btn>
            </template>
          </SettingsRow>

        </template>

        <!-- Arkade Wallet -->
        <template v-else-if="isActiveWalletArkade">
          <SettingsRow
            icon="tabler:qrcode"
            :label="$t('Arkade Address')"
            :caption="truncateAddress(activeArkadeAddress) || $t('Not available')"
            caption-mono
            :interactive="false"
          >
            <template #right>
              <q-btn flat round dense size="sm" @click="copyArkadeAddress">
                <Icon icon="tabler:copy" width="16" height="16" />
              </q-btn>
              <q-btn flat round dense size="sm" @click="shareArkadeAddress">
                <Icon icon="tabler:share" width="16" height="16" />
              </q-btn>
            </template>
          </SettingsRow>
        </template>

        <template v-else-if="isActiveWalletNWC">
          <!--
            Hero row for the active NWC connection: the user-given
            wallet name takes the label slot (this is the name they
            actually recognise — "My Phoenix", "Mutiny BTC" etc.)
            with the upstream provider alias as caption. The plug
            icon signals "this is a connection" at a glance.
            The previous "Features" row (Send · Receive · Multi-pay
            … etc) was demoted because the NWC method list is
            technical jargon that doesn't help a mainstream user
            understand which wallet they are paying from — anyone
            who actually cares about NWC capability strings can find
            them in the Manage Wallets dialog.
          -->
          <SettingsRow
            icon="tabler:plug-connected"
            :label="activeWallet?.name || $t('NWC Wallet')"
            :caption="nwcWalletAlias ? `${$t('via')} ${nwcWalletAlias}` : $t('Nostr Wallet Connect')"
            :interactive="false"
          />
          <SettingsRow
            v-if="activeWalletLightningAddress"
            icon="tabler:bolt"
            :label="$t('Lightning Address')"
            :caption="activeWalletLightningAddress"
            caption-mono
            :interactive="false"
          >
            <template #right>
              <q-btn
                flat round dense size="sm"
                @click="copyToClipboard(activeWalletLightningAddress, $t('Lightning address copied'))"
              >
                <Icon icon="tabler:copy" width="16" height="16" />
              </q-btn>
            </template>
          </SettingsRow>
        </template>

        <template v-else-if="isActiveWalletLNBits">
          <!--
            Hero row first: user-given wallet name as label, server
            domain as caption. Mirrors the NWC pattern so the active
            wallet identity is immediately scannable regardless of
            connection type. The server row was demoted because the
            domain string (e.g. "demo.lnbits.com") is technical
            context that's helpful but not identity.
          -->
          <SettingsRow
            icon="tabler:wallet"
            :label="activeWallet?.name || 'LNbits Wallet'"
            :caption="lnbitsServerDomain ? `${$t('on')} ${lnbitsServerDomain}` : 'LNbits'"
            :interactive="false"
          />
          <!--
            Lightning Address row — always rendered for LNbits.

            States, driven by `lnAddressRowState`:
              • 'set'         — address attached; opens the sheet to swap it.
              • 'unsetReady'  — no address yet, Pay Links answers; opens
                                the sheet to pick or create one.
              • 'unsetBlocked' — the server says Pay Links is off; opens
                                 the sheet that says who can turn it on.
              • 'unknown'     — the server could not be asked; a tap asks again.
              • 'probing'     — not asked yet.
          -->
          <SettingsRow
            icon="tabler:at"
            :label="$t('Lightning Address')"
            :caption-mono="lnAddressRowState === 'set'"
            :interactive="lnAddressRowClickable"
            :show-chevron="lnAddressRowClickable"
            @click="lnAddressRowClickable ? openLightningAddressDialog() : null"
          >
            <template #caption>
              <template v-if="lnAddressRowState === 'set'">{{ activeWalletLightningAddress }}</template>
              <template v-else-if="lnAddressRowState === 'unsetReady'">{{ $t('Get one to receive payments by name') }}</template>
              <template v-else-if="lnAddressRowState === 'unsetBlocked'"><span class="ln-address-dot" aria-hidden="true"></span>{{ $t('Needs Pay Links') }}</template>
              <template v-else-if="lnAddressRowState === 'unknown'">{{ $t("Couldn't reach the server") }}</template>
              <template v-else><q-spinner size="12px" class="q-mr-xs" />{{ $t('Checking server…') }}</template>
            </template>
            <template v-if="lnAddressRowState === 'set'" #right>
              <q-btn
                flat round dense size="sm"
                @click.stop="copyToClipboard(activeWalletLightningAddress, $t('Lightning address copied'))"
              >
                <Icon icon="tabler:copy" width="16" height="16" />
              </q-btn>
            </template>
          </SettingsRow>
        </template>

        <!--
          Wallet-level admin: managing the connected wallets list.
          Auto-Transfer and Address Book moved up into the Feature
          Cards row so they read as features rather than wallet
          config; Backups lives in Security.
        -->
        <SettingsRow
          icon="tabler:wallet"
          :label="$t('Manage Wallets')"
          :caption="`${wallets.length} ${wallets.length === 1 ? $t('wallet') : $t('wallets')}`"
          @click="showWalletsDialog = true"
        />

        <!--
          Transaction report. Wallet-level because it reads across the
          wallets rather than belonging to any one of them, which is also
          why it sits next to Manage Wallets.
        -->
        <SettingsRow
          icon="tabler:file-text"
          :label="$t('Transaction report')"
          :caption="$t('PDF, CSV or XML for your accountant')"
          @click="showTaxReportSheet = true"
        />
      </SettingsSection>

      <!--
        Feature cards — three value features that were previously
        plain rows: Auto-Transfer, Address Book, Kiosk. Positioned
        after the Wallet section (rather than at the very top)
        because the Quick Toggles already occupy the prime above-
        the-fold slot; stacking two card rows at the top read as
        too dense, and putting features here gives them their own
        breathing room while staying high on the page.
      -->
      <SettingsFeatureCards
        :features="featureCards"
        @select="onFeatureSelect"
      />

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
        :check-status="probeLnurlpForActiveWallet"
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

      <!-- One more Spark wallet from the recovery phrase on this device. -->
      <AddSparkWalletSheet v-model="showAddSparkSheet" @created="onSparkWalletCreated" />

      <!-- Hand a Spark wallet's Lightning address to another Spark wallet. -->
      <MoveLightningAddressSheet v-model="showMoveAddressSheet" :from-wallet-id="moveAddressWalletId" @moved="onAddressMoved" />

      <!-- "Move funds" before removing a wallet that still holds money. -->
      <InternalTransferModal
        v-model="showTransferModal"
        :from-wallet-id="transferFromWalletId"
      />

      <!-- ─────────────── PREFERENCES ───────────────
           Theme / Display Currency / App Lock live in Quick Toggles at
           the top of the page: binary controls that don't need a full
           row. Here are the pickers that need a dialog (Currency,
           Language) plus the two on/off rows too rarely flipped to earn
           a quick toggle (Amount format, Screen Privacy). -->
      <SettingsSection :title="$t('Preferences')">
        <SettingsRow
          icon="tabler:currency-dollar"
          :label="$t('Currency')"
          :inline-value="preferredFiatCurrency"
          @click="openCurrencyDialog"
        />
        <SettingsRow
          icon="tabler:language"
          :label="$t('Language')"
          :inline-value="getCurrentLanguageLabel()"
          @click="showLanguageDialog = true"
        />
        <!--
          Amount format — moved down from Quick Toggles. Almost no
          mainstream user has a reason to flip this (it controls
          ₿ vs sats writing convention), so its old home as a
          top-of-page quick pill was prime real estate wasted. Now
          a regular row with a plain-language caption so a curious
          user can still find and understand it.
        -->
        <SettingsRow
          icon="tabler:hash"
          :label="$t('Amount Display Format')"
          :caption="useBip177Format ? $t('Show amounts as ₿ 1,234') : $t('Show amounts as 1,234 sats')"
          :interactive="false"
        >
          <template #right>
            <q-toggle
              :model-value="useBip177Format"
              @update:model-value="updateAmountFormat"
              :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
            />
          </template>
        </SettingsRow>

        <!--
          Notifications: one row, the details in a sheet (master switch, then
          one switch per kind). The value says what is in effect, so a
          permission revoked in system settings reads as Blocked or Off
          without destroying the user's own choices.
        -->
        <SettingsRow
          v-if="notificationsStore.supported"
          icon="tabler:bell"
          :label="$t('Notifications')"
          :inline-value="notificationsSummary"
          @click="showNotificationsSheet = true"
        />

        <!--
          Haptics: on by default, in the app only (a browser cannot play
          them). Off silences every haptic in the app; the phone's own
          vibration setting still applies on top.
        -->
        <SettingsRow
          v-if="hapticsSupported"
          icon="tabler:device-mobile-vibration"
          :label="$t('Haptics')"
          :caption="$t('Feel a tap for payments, errors and other key moments')"
          :interactive="false"
        >
          <template #right>
            <q-toggle
              :model-value="hapticsOn"
              :aria-label="$t('Haptics')"
              @update:model-value="updateHaptics"
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
          enable opens the "Get the Android app" dialog. The OS
          doesn't expose screen-capture blocking to browsers, so
          honestly surfacing that is the only correct UX.
        -->
        <SettingsRow
          icon="tabler:shield-lock"
          :label="$t('Screen Privacy')"
          :caption="$t('Block screenshots, screen recordings, and previews in the app switcher.')"
          :interactive="false"
        >
          <template #right>
            <q-toggle
              :model-value="screenPrivacySupported ? walletStore.privacyScreenEnabled : false"
              @update:model-value="togglePrivacyScreen"
              :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
            />
          </template>
        </SettingsRow>
      </SettingsSection>

      <!-- ─────────────── KIOSK MODE (config) ───────────────
           Only renders when Kiosk is enabled. The enable/disable
           switch lives in the Feature Cards row at the top — the
           card pulses green when active and tapping it toggles
           kiosk on or off through the same `handleKioskToggle`
           pipeline. Once enabled, this section appears below to
           host the configuration: destination wallet → PIN → tips
           → round-up → display → activate CTA. -->
      <SettingsSection
        v-if="walletStore.kioskEnabled"
        :title="$t('kiosk.kioskMode')"
      >
          <SettingsRow
            icon="tabler:wallet"
            :label="$t('kiosk.destinationWallet')"
            :caption="kioskSelectedWalletName || $t('kiosk.noWalletSelected')"
            @click="openKioskWalletPicker"
          />

          <SettingsRow
            icon="tabler:lock"
            :label="$t('kiosk.currentPin') + ': ' + walletStore.kioskPin"
            :interactive="false"
          >
            <template #right>
              <q-btn flat dense no-caps size="sm" class="inline-link-btn" @click="showKioskChangePinDialog = true">
                {{ $t('kiosk.changePin') }}
              </q-btn>
            </template>
          </SettingsRow>

          <SettingsRow
            icon="tabler:heart-handshake"
            :label="$t('kiosk.enableTips')"
            :interactive="false"
          >
            <template #right>
              <q-toggle
                :model-value="walletStore.kioskTipEnabled"
                :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
                @update:model-value="(v) => walletStore.setKioskTipEnabled(v)"
              />
            </template>
          </SettingsRow>

          <!-- Tip percentage inputs — appear only when tips are on,
               keeping the closed state minimal. Three inputs let the
               operator preset the common one-tap tip choices. -->
          <div v-if="walletStore.kioskTipEnabled" class="kiosk-tip-input-row">
            <q-input
              v-for="(val, idx) in walletStore.kioskTipValues" :key="'tip-'+idx"
              :model-value="walletStore.kioskTipValues[idx]"
              type="number"
              suffix="%"
              dense filled
              :label="$t('kiosk.tipValue') + ' ' + (idx + 1)"
              :dark="$q.dark.isActive"
              class="kiosk-tip-input"
              @update:model-value="(v) => updateKioskTipValue(idx, v)"
            />
          </div>

          <SettingsRow
            icon="tabler:arrow-bar-to-up"
            :label="$t('kiosk.roundUp')"
            :caption="$t('kiosk.roundUpDesc')"
            :interactive="false"
          >
            <template #right>
              <q-toggle
                :model-value="walletStore.kioskRoundUpEnabled"
                :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
                @update:model-value="(v) => walletStore.setKioskRoundUpEnabled(v)"
              />
            </template>
          </SettingsRow>

          <SettingsRow
            icon="tabler:currency-bitcoin"
            :label="$t('kiosk.displayCurrency')"
            :interactive="false"
          >
            <template #right>
              <q-btn-toggle
                :model-value="walletStore.kioskDisplayCurrency"
                dense no-caps unelevated size="sm"
                class="settings-mini-toggle"
                :class="$q.dark.isActive ? 'settings-mini-toggle-dark' : 'settings-mini-toggle-light'"
                :options="[{ label: 'Sats', value: 'sats' }, { label: walletStore.preferredFiatCurrency, value: 'fiat' }]"
                @update:model-value="(v) => walletStore.setKioskDisplayCurrency(v)"
              />
            </template>
          </SettingsRow>

          <div class="kiosk-activate-row">
            <q-btn unelevated no-caps
              class="full-width kiosk-start-btn"
              :class="$q.dark.isActive ? 'kiosk-start-btn-dark' : 'kiosk-start-btn-light'"
              :disable="!walletStore.kioskWalletId || kioskActivating"
              :loading="kioskActivating"
              @click="handleStartKiosk">
              {{ $t('kiosk.activateKiosk') }}
            </q-btn>
          </div>
      </SettingsSection>

      <!-- Kiosk PIN Setup Dialog -->
      <q-dialog v-model="showKioskPinSetupDialog" persistent @hide="resetKioskPinSetup">
        <div class="kiosk-setup-dialog" :style="{ background: 'var(--bg-card)', color: 'var(--text-primary)' }">
          <!-- Intro -->
          <template v-if="kioskPinSetupStep === 'intro'">
            <!--
              Animated "scan-to-pay" illustration. Served as a standalone
              SVG so the browser runs its self-contained CSS animations
              inside an <img> sandbox. The :key + URL query string change
              on every entry to the intro step so the browser treats
              each render as a fresh resource and replays the internal
              animations from frame 0. See the `watch` block above.
            -->
            <div class="kiosk-setup-hero">
              <img
                :key="kioskIntroAnimationKey"
                :src="`/Onboarding wizard spark/scan-to-pay-animated.svg?v=${kioskIntroAnimationKey}`"
                class="kiosk-setup-illustration"
                alt=""
                aria-hidden="true"
              />
            </div>

            <h3 class="kiosk-setup-title">{{ $t('kiosk.kioskMode') }}</h3>
            <p class="kiosk-setup-desc">{{ $t('kiosk.introDesc') }}</p>

            <div class="kiosk-setup-features">
              <div class="kiosk-setup-feature">
                <div class="kiosk-feature-icon"><Icon icon="tabler:lock" width="18" height="18" /></div>
                <span>{{ $t('kiosk.introFeaturePos') }}</span>
              </div>
              <div class="kiosk-setup-feature">
                <div class="kiosk-feature-icon"><Icon icon="tabler:shield-lock" width="18" height="18" /></div>
                <span>{{ $t('kiosk.introFeatureLock') }}</span>
              </div>
              <div class="kiosk-setup-feature">
                <div class="kiosk-feature-icon"><Icon icon="tabler:password" width="18" height="18" /></div>
                <span>{{ $t('kiosk.introFeaturePin') }}</span>
              </div>
            </div>

            <button class="kiosk-setup-primary" @click="kioskPinSetupStep = 'selectWallet'">
              {{ $t('kiosk.introContinue') }}
            </button>
            <button class="kiosk-setup-secondary" @click="showKioskPinSetupDialog = false">
              {{ $t('Cancel') }}
            </button>
          </template>

          <!-- Select destination wallet -->
          <template v-else-if="kioskPinSetupStep === 'selectWallet'">
            <h3 class="kiosk-setup-title">{{ $t('kiosk.selectDestinationTitle') }}</h3>
            <p class="kiosk-setup-desc">{{ $t('kiosk.selectDestinationDesc') }}</p>

            <div class="kiosk-wallet-list">
              <p v-if="!kioskEligibleWallets.length" class="kiosk-wallet-empty" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                {{ $t('Kiosk needs a wallet that can create Lightning invoices. Add a Spark, LNbits or NWC wallet first.') }}
              </p>
              <!-- Every wallet is listed; one that cannot take kiosk payments
                   is not choosable and says why where its type would be. -->
              <button
                v-for="w in kioskWalletOptions" :key="w.id"
                type="button"
                class="kiosk-wallet-row"
                :class="{ 'kiosk-wallet-row-active': kioskWalletSelection === w.id, 'kiosk-wallet-row-off': w.kioskReason }"
                :disabled="Boolean(w.kioskReason)"
                @click="kioskWalletSelection = w.id"
              >
                <span class="kiosk-wallet-row-radio">
                  <span v-if="kioskWalletSelection === w.id" class="kiosk-wallet-row-dot" />
                </span>
                <span class="kiosk-wallet-row-info">
                  <span class="kiosk-wallet-row-name">{{ w.name }}</span>
                  <span class="kiosk-wallet-row-type">{{ w.kioskReason || getWalletTypeLabel(w) }}</span>
                </span>
                <span class="kiosk-wallet-row-icon">
                  <svg v-if="w.type === 'spark'" width="18" height="17" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg" :style="{ color: $q.dark.isActive ? '#fff' : '#1a1a1a' }">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="currentColor"/>
                  </svg>
                  <svg v-else-if="w.type === 'nwc'" width="18" height="18" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="url(#nwc_kiosk_setup_grad)"/>
                    <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="#897FFF"/>
                    <defs><linearGradient id="nwc_kiosk_setup_grad" x1="123.989" y1="10.4384" x2="123.989" y2="249.939" gradientUnits="userSpaceOnUse"><stop stop-color="#FFCA4A"/><stop offset="1" stop-color="#F7931A"/></linearGradient></defs>
                  </svg>
                  <svg v-else-if="w.type === 'lnbits'" width="13" height="18" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
                  </svg>
                  <ArkadeLogo v-else-if="w.type === 'arkade'" variant="mark" :size="18" />
                  <Icon v-else icon="tabler:wallet" width="18" height="18" />
                </span>
              </button>
            </div>

            <button class="kiosk-setup-primary"
              :disabled="!kioskWalletSelection"
              :style="!kioskWalletSelection ? { opacity: 0.5, cursor: 'not-allowed' } : null"
              @click="advanceFromKioskWalletSelect">
              {{ $t('kiosk.introNext') }}
            </button>
            <button class="kiosk-setup-secondary" @click="kioskPinSetupStep = 'intro'">
              {{ $t('Back') }}
            </button>
          </template>

          <!-- Enter PIN -->
          <template v-else-if="kioskPinSetupStep === 'enter'">
            <KioskPinPad ref="kioskSetupPinPadRef" :title="$t('kiosk.setupPin')" :error-message="kioskPinError"
              @complete="handleKioskPinSetupComplete" />
            <button class="kiosk-setup-secondary" @click="kioskPinSetupStep = 'selectWallet'; kioskPinError = ''">
              {{ $t('Back') }}
            </button>
          </template>

          <!-- Confirm PIN -->
          <template v-else-if="kioskPinSetupStep === 'confirm'">
            <KioskPinPad ref="kioskSetupPinPadRef" :title="$t('kiosk.confirmPin')" :error-message="kioskPinError"
              @complete="handleKioskPinSetupComplete" />
            <button class="kiosk-setup-secondary"
              @click="kioskPinSetupStep = 'enter'; kioskPinError = ''; $refs.kioskSetupPinPadRef?.reset()">
              {{ $t('Back') }}
            </button>
          </template>
        </div>
      </q-dialog>

      <!-- Kiosk Change PIN Dialog -->
      <q-dialog v-model="showKioskChangePinDialog" persistent @hide="resetKioskChangePin">
        <q-card style="min-width: 320px; max-width: 360px; border-radius: 20px;"
          :class="$q.dark.isActive ? 'bg-dark text-white' : ''">
          <q-card-section class="text-center">
            <div class="text-subtitle1 text-weight-bold q-mb-md">
              {{ kioskChangePinStep === 'verify' ? $t('kiosk.enterCurrentPin') : (kioskChangePinStep === 'enter' ? $t('kiosk.enterNewPin') : $t('kiosk.confirmNewPin')) }}
            </div>
            <KioskPinPad ref="kioskChangePinPadRef" title="" :error-message="kioskChangePinError"
              @complete="handleKioskChangePinComplete" />
            <q-btn flat no-caps color="grey" class="q-mt-sm"
              @click="showKioskChangePinDialog = false">
              {{ $t('Cancel') }}
            </q-btn>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- Kiosk Disable Dialog -->
      <q-dialog v-model="showKioskDisableDialog" persistent @hide="resetKioskDisable">
        <q-card style="min-width: 320px; max-width: 360px; border-radius: 20px;"
          :class="$q.dark.isActive ? 'bg-dark text-white' : ''">
          <q-card-section class="text-center">
            <q-icon name="lock_open" size="32px" color="orange" class="q-mb-md" />
            <div class="text-subtitle1 text-weight-bold q-mb-sm">{{ $t('kiosk.disableKiosk') }}</div>
            <p class="text-body2 q-mb-md" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('kiosk.enterPinToDisable') }}
            </p>
            <KioskPinPad ref="kioskDisablePinPadRef" title="" :error-message="kioskDisableError"
              @complete="handleKioskDisablePin" />
            <q-btn flat no-caps color="grey" class="q-mt-sm"
              @click="showKioskDisableDialog = false">
              {{ $t('Cancel') }}
            </q-btn>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- Kiosk Wallet Picker Dialog -->
      <q-dialog v-model="showKioskWalletPicker">
        <q-card style="min-width: 320px; max-width: 380px; border-radius: 20px;"
          :class="$q.dark.isActive ? 'bg-dark text-white' : ''">
          <q-card-section>
            <div class="text-subtitle1 text-weight-bold q-mb-md text-center">
              {{ $t('kiosk.selectWallet') }}
            </div>
            <q-list>
              <q-item v-for="w in kioskWalletOptions" :key="w.id" clickable v-ripple
                :disable="Boolean(w.kioskReason)"
                @click="kioskWalletSelection = w.id">
                <q-item-section side>
                  <q-radio :model-value="kioskWalletSelection" :val="w.id"
                    :disable="Boolean(w.kioskReason)"
                    :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
                    @update:model-value="kioskWalletSelection = $event" />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ w.name }}</q-item-label>
                  <q-item-label caption>{{ w.kioskReason || getWalletTypeLabel(w) }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <!-- Spark -->
                  <svg v-if="w.type === 'spark'" width="20" height="19" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg" :style="{ color: $q.dark.isActive ? '#fff' : '#1a1a1a' }">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="currentColor"/>
                  </svg>
                  <!-- NWC -->
                  <svg v-else-if="w.type === 'nwc'" width="20" height="20" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="url(#nwc_kiosk_grad)"/>
                    <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="#897FFF"/>
                    <defs><linearGradient id="nwc_kiosk_grad" x1="123.989" y1="10.4384" x2="123.989" y2="249.939" gradientUnits="userSpaceOnUse"><stop stop-color="#FFCA4A"/><stop offset="1" stop-color="#F7931A"/></linearGradient></defs>
                  </svg>
                  <!-- LNbits -->
                  <svg v-else-if="w.type === 'lnbits'" width="14" height="20" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
                  </svg>
                  <!-- Arkade -->
                  <ArkadeLogo v-else-if="w.type === 'arkade'" variant="mark" :size="20" />
                  <!-- Fallback -->
                  <Icon v-else icon="tabler:wallet" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps :label="$t('Cancel')" color="grey" @click="showKioskWalletPicker = false" />
            <q-btn flat no-caps :label="$t('Confirm')"
              :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
              :disable="!kioskSelectionAllowed"
              @click="confirmKioskWalletSelection" />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- The Onboarding Guide lives on the About page now, next to the
           project's story, so Settings stays pure configuration. -->

      <!-- ─────────────── ADVANCED ───────────────
           Collapsed by default. Power-user toggles that the
           typical user never needs to touch (exchange-rate source,
           auto-add Bitcoin deposits). Positioned after the
           mainstream surfaces — wallet, preferences, kiosk — so
           anyone hunting for advanced controls is happy to scroll
           the extra row. -->
      <SettingsSection
        id="settings-advanced"
        :title="$t('Advanced')"
        collapsible
        :default-expanded="$route.query.section === 'advanced'"
      >
        <SettingsRow
          icon="tabler:chart-line"
          :label="$t('Exchange rates')"
          :inline-value="mempoolSourceLabel"
          @click="openExchangeRates"
        />

        <!-- Auto-add Bitcoin deposits — only relevant for Spark
             wallets (the only type with a static deposit address).
             Default-on covers the typical user; only people who
             want manual control over each on-chain claim need to
             find this toggle, and Advanced is the right home. -->
        <SettingsRow
          v-if="isSparkActiveWallet"
          icon="tabler:download"
          :label="$t('Auto-add Bitcoin deposits')"
          :caption="$t('Add deposits to your balance without an extra step.')"
          :interactive="false"
        >
          <template #right>
            <q-btn
              flat
              round
              dense
              size="sm"
              class="branta-info"
              :aria-label="$t('About auto-add Bitcoin deposits')"
              @click="showAutoAddDepositsDialog = true"
            >
              <Icon icon="tabler:info-circle" width="18" height="18" />
            </q-btn>
            <q-toggle
              :model-value="bitcoinPrefsStore.autoAddIncomingBitcoin"
              @update:model-value="bitcoinPrefsStore.setAutoAddIncomingBitcoin"
              :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
            />
          </template>
        </SettingsRow>

        <!-- Merchant verification (Branta), on by default. The section footer
             says what it does when on; off follows from that. -->
        <SettingsRow
          icon="tabler:rosette-discount-check"
          :label="$t('Merchant verification')"
          :interactive="false"
        >
          <template #right>
            <q-toggle
              :model-value="bitcoinPrefsStore.brantaVerificationEnabled"
              @update:model-value="bitcoinPrefsStore.setBrantaVerificationEnabled"
              :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
              :aria-label="$t('Merchant verification')"
            />
          </template>
        </SettingsRow>
        <template #footer>
          {{ $t("Shows a business's verified name and logo before you pay. Checked privately with Branta; your payment details are never shared.") }}
          <a href="https://branta.pro" class="settings-footer-link" @click.prevent="openBrantaSite">{{ $t('About Branta') }}</a>
        </template>
      </SettingsSection>

      <!-- ─────────────── DANGER ZONE ───────────────
           Collapsed by default. Lives at the very bottom of the
           page so reaching it is already deliberate (scroll past
           everything else), and the chevron toggle adds one more
           tap before destructive actions become visible. -->
      <SettingsSection
        v-if="dangerActions.length"
        :title="$t('Danger Zone')"
        collapsible
        :default-expanded="false"
      >
        <!-- Every wallet of a kind at once; one wallet leaves from its own
             details in Manage Wallets. A row that cannot run yet is muted
             and says why; tapping it offers the way out. -->
        <SettingsRow
          v-for="action in dangerActions"
          :key="action.key"
          destructive
          :quiet="!!action.blockedReason"
          :label="action.label"
          :caption="action.blockedReason || action.covers"
          @click="action.run"
        />
      </SettingsSection>

      <!-- About lives behind its own door in the home menu now; Settings
           stays pure configuration. -->

    </div>

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

    <!-- Enhanced Wallets Management Dialog - full-width bottom sheet -->
    <q-dialog
      v-model="showWalletsDialog"
      position="bottom"
      transition-show="slide-up"
      transition-hide="slide-down"
      :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    >
      <q-card class="wallets-dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <!-- One sheet, pushed navigation: a wallet's details replace the list
             and Back returns to it, focus on the row that opened them. -->
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
          :connection-error="connectionStates[detailWallet.id]?.error ? $t('This wallet is offline right now. Check your connection, then tap Reconnect.') : ''"
          :rename-wallet="walletStore.updateWalletName"
          :lightning-address="detailWallet.type === 'spark' ? (walletInfos[detailWallet.id]?.lightningAddress || detailWallet.metadata?.lud16 || '') : ''"
          :can-move-address="sparkWallets.length > 1"
          :nwc-limit="walletStore.nwcLimitFor(detailWallet.id)"
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
        />
        <template v-else>
        <div class="sheet-grabber" aria-hidden="true"><div class="grabber-bar"></div></div>
        <!-- Fixed Header -->
        <q-card-section class="dialog-header wallets-dialog-header">
          <q-btn flat round dense class="glass-back-btn" :aria-label="$t('Back')" v-close-popup>
            <Icon icon="tabler:chevron-left" width="20" height="20" />
          </q-btn>
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Manage Wallets') }}
          </div>
          <div class="wallets-header-spacer" aria-hidden="true"></div>
        </q-card-section>

        <!-- Scrollable Content -->
        <q-card-section class="wallets-dialog-content">
          <!-- Wallet Statistics -->
          <div class="wallet-stats" :class="$q.dark.isActive ? 'wallets-group-dark' : 'wallets-group-light'" v-if="wallets.length > 0">
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
                <!-- Every configured wallet counts; a total missing a wallet's
                     figure reads "at least" and is dimmed (same as the switcher). -->
                <HiddenAmount v-balance-updating="walletStore.totalBalanceInfo.refreshing" :class="{ 'balance-stale': walletStore.totalBalanceInfo.outdated }">{{ walletStore.totalBalanceInfo.complete ? '' : '≥ ' }}{{ formatBalance(totalBalance) }}</HiddenAmount>
              </div>
              <HiddenAmount v-if="walletStore.fiatValueOf(totalBalance)" class="stat-fiat" :class="{ 'balance-stale': walletStore.totalBalanceInfo.outdated }">{{ walletStore.totalBalanceInfo.complete ? '' : '≥ ' }}{{ walletStore.fiatValueOf(totalBalance) }}</HiddenAmount>
              <div class="stat-label" :class="$q.dark.isActive ? 'sats' : 'sats-light'">
                {{ $t('Total') }}
              </div>
            </div>
            <div class="stat-divider" :class="$q.dark.isActive ? 'divider-dark' : 'divider-light'"></div>
            <div class="stat-item">
              <div class="stat-value online-value" :class="$q.dark.isActive ? 'online-dark' : 'online-light'">
                {{ connectedWallets.length }}/{{ wallets.length }}
              </div>
              <div class="stat-label" :class="$q.dark.isActive ? 'sats' : 'sats-light'">
                {{ $t('Online') }}
              </div>
            </div>
          </div>

          <!-- Scrollable Wallet List -->
          <div class="wallets-list-container">
            <div v-if="wallets.length === 0" class="no-wallets">
              <Icon icon="tabler:wallet" width="48" height="48" class="no-wallets-icon"
                      :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-4'" />
              <div class="no-wallets-text" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
                {{ $t('No wallets connected yet') }}
              </div>
              <div class="no-wallets-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                {{ $t('Tap "Add Wallet" to get started') }}
              </div>
            </div>

            <!-- A restore keeps finding the phrase's other wallets for a while. -->
            <p v-if="walletStore.sparkDiscoveryRunning" class="wallets-discovery" role="status">
              <q-spinner size="14px" :aria-hidden="true" />
              {{ $t('Looking for more wallets from your recovery phrase') }}
            </p>

            <!-- Grouped by what this phone holds: a wallet's recovery phrase, or
                 only a connection to a wallet that lives elsewhere. -->
            <section v-for="group in walletGroups" :key="group.kind" class="wallets-group-section" :aria-label="group.title">
            <h3 class="wallets-group-title">{{ group.title }}</h3>
            <div class="wallets-list-scroll" :class="$q.dark.isActive ? 'wallets-group-dark' : 'wallets-group-light'">
              <div
                v-for="wallet in group.wallets"
                :key="wallet.id"
                class="wallet-card-wrapper"
              >
              <div
                class="wallet-card"
                :class="{
                  'wallet-card-disconnected': !connectionStates[wallet.id]?.connected,
                  'wallet-card-dark': $q.dark.isActive,
                  'wallet-card-light': !$q.dark.isActive
                }"
                role="button"
                tabindex="0"
                :data-wallet-id="wallet.id"
                @click="openWalletDetail(wallet.id)"
                @keydown.enter.prevent="openWalletDetail(wallet.id)"
                @keydown.space.prevent="openWalletDetail(wallet.id)"
              >
                <!-- Wallet Avatar -->
                <div class="wallet-avatar">
                  <div class="wallet-avatar-circle wallet-avatar-black" :class="{ 'wallet-avatar-arkade': wallet.type === 'arkade' }">
                    <WalletBrandMark :type="wallet.type" :size="20" />
                  </div>
                  <div
                    class="wallet-status-dot"
                    :class="connectionStates[wallet.id]?.connected ? 'status-connected' : 'status-disconnected'"
                  ></div>
                </div>

                <!-- Wallet Details: name + one status line. -->
                <div class="wallet-details">
                  <div class="wallet-row-name" :class="$q.dark.isActive ? 'row-name-dark' : 'row-name-light'">
                    {{ wallet.name }}
                  </div>
                  <div class="wallet-row-sub" :class="$q.dark.isActive ? 'row-sub-dark' : 'row-sub-light'">
                    <span>{{ getWalletTypeLabel(wallet) }}</span>
                    <span v-if="wallet.id === activeWalletId" class="row-sub-active" :class="$q.dark.isActive ? 'sub-active-dark' : 'sub-active-light'"> · {{ $t('Active') }}</span>
                    <span v-else-if="!connectionStates[wallet.id]?.connected"> · {{ $t('Offline') }}</span>
                  </div>
                </div>

                <!-- Trailing value + disclosure -->
                <div class="wallet-row-value" :class="$q.dark.isActive ? 'row-value-dark' : 'row-value-light'">
                  <!-- Same rule as the home switcher: a placeholder until the first
                       figure, dimmed only when known to be out of date. -->
                  <span v-if="!walletStore.getDisplayBalance(wallet.id).known" v-balance-updating="walletStore.getDisplayBalance(wallet.id).refreshing" class="balance-placeholder" role="img" :aria-label="$t('Balance not loaded yet')" />
                  <template v-else>
                    <HiddenAmount :class="{ 'balance-stale': walletStore.getDisplayBalance(wallet.id).outdated }">{{ walletBalanceText(wallet.id) }}</HiddenAmount>
                    <HiddenAmount v-if="walletStore.fiatValueOf(walletStore.getDisplayBalance(wallet.id).balance)" class="wallet-row-fiat" :class="{ 'balance-stale': walletStore.getDisplayBalance(wallet.id).outdated }">{{ walletStore.fiatValueOf(walletStore.getDisplayBalance(wallet.id).balance) }}</HiddenAmount>
                  </template>
                </div>
                <Icon icon="tabler:chevron-right" width="16" height="16" class="wallet-row-chevron" />
              </div>

              </div>
          </div>
            </section>

            <!-- Wallets an earlier version kept on another recovery phrase:
                 off the list (one phrase per device), never out of reach. -->
            <section v-if="setAsideWallets.length" class="set-aside" :aria-label="$t('Other recovery phrase')">
              <h3 class="set-aside-title">{{ $t('Other recovery phrase') }}</h3>
              <div class="set-aside-group" :class="$q.dark.isActive ? 'wallets-group-dark' : 'wallets-group-light'">
                <button v-for="entry in setAsideWallets" :key="entry.id" type="button" class="set-aside-row" @click="openSeedPhraseDialog('view', entry.id)">
                  <span class="set-aside-name">{{ entry.name || $t('Wallet') }}</span>
                  <span class="set-aside-action">{{ $t('Show recovery phrase') }}</span>
                </button>
              </div>
              <p class="set-aside-footer">{{ $t('These wallets use a different recovery phrase than this phone. Write their words down to keep their money: they open the wallet in any Spark wallet app.') }}</p>
            </section>
          </div>
        </q-card-section>

        <!-- The sheet's one CTA, pinned hard at the bottom edge. -->
        <q-card-section class="wallets-dialog-footer" :class="$q.dark.isActive ? 'wallets-footer-dark' : 'wallets-footer-light'">
          <q-btn
            class="add-wallet-btn"
            :class="$q.dark.isActive ? 'add-wallet-btn-dark' : 'add-wallet-btn-light'"
            no-caps
            unelevated
            @click="showAddWalletDialog = true"
          >
            <Icon icon="tabler:plus" width="20" height="20" class="q-mr-sm" />
            {{ $t('Add Wallet') }}
          </q-btn>
        </q-card-section>
        </template>
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


    <SettingsHubNav />
  </q-page>
</template>

<script>
import {useWalletStore} from '../stores/wallet'
import {useAutoWithdrawStore} from '../stores/autoWithdraw'
import { destinationLabel } from '../utils/autoTransferCopy.js'
import {useBitcoinPreferencesStore} from '../stores/bitcoinPreferences'
import {useIdentityStore} from '../stores/identity'
import {useProfileStore} from '../stores/profile'
import {useNotificationsStore} from '../stores/notifications'
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
import {truncateAddress} from '../utils/addressUtils.js'
import { loadDismissedWarnings, saveDismissedWarnings } from '../utils/attentionWarnings.js'
import KioskPinPad from '../components/KioskPinPad.vue'
import SparkSeedPhraseDialog from '../components/SparkSeedPhraseDialog.vue'
import balanceUpdating from '../directives/balanceUpdating.js'
import ArkadeLogo from '../components/ArkadeLogo.vue'
import WalletBrandMark from '../components/WalletBrandMark.vue'
import BiometricEnableDialog from '../components/BiometricEnableDialog.vue'
import LNBitsAddressSheet from '../components/lnbits/LNBitsAddressSheet.vue'
import ExchangeRateSheet from '../components/settings/ExchangeRateSheet.vue'
import { suggestedWalletName } from '../utils/nwcWallet.js'
import { kioskWalletBlocker, KIOSK_BLOCKER } from '../utils/walletCapabilities.js'
import { NWC_ERROR, nwcError } from '../utils/nwcErrors.js'
import SparkLightningAddressSheet from '../components/SparkLightningAddressSheet.vue'
import InternalTransferModal from '../components/InternalTransferModal.vue'
import WalletDetailPanel from '../components/settings/WalletDetailPanel.vue'
import AddSparkWalletSheet from '../components/wallets/AddSparkWalletSheet.vue'
import NotificationsSheet from '../components/settings/NotificationsSheet.vue'
import MoveLightningAddressSheet from '../components/wallets/MoveLightningAddressSheet.vue'
import { removalCopy, removalBlockerLabel, sparkRemovalCopy, disconnectAllCopy, walletKind, WALLET_KIND } from '../utils/walletRemoval.js'
import GetAppDialog from '../components/GetAppDialog.vue'
import TaxReportSheet from '../components/settings/TaxReportSheet.vue'
import SettingsSection from '../components/settings/SettingsSection.vue'
import SettingsRow from '../components/settings/SettingsRow.vue'
import SettingsAttentionStrip from '../components/settings/SettingsAttentionStrip.vue'
import SettingsQuickToggles from '../components/settings/SettingsQuickToggles.vue'
import SettingsFeatureCards from '../components/settings/SettingsFeatureCards.vue'
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

export default {
  name: 'SettingsPage',
  directives: { balanceUpdating },
  setup() {
    return { chatAvailable: useChatRuntime().available };
  },
  components: {
    ArkadeLogo,
    WalletBrandMark,
    SparkSeedPhraseDialog,
    BiometricEnableDialog,
    KioskPinPad,
    LNBitsAddressSheet,
    ExchangeRateSheet,
    SparkLightningAddressSheet,
    InternalTransferModal,
    WalletDetailPanel,
    AddSparkWalletSheet,
    NotificationsSheet,
    MoveLightningAddressSheet,
    GetAppDialog,
    TaxReportSheet,
    SettingsSection,
    SettingsRow,
    SettingsAttentionStrip,
    SettingsQuickToggles,
    SettingsFeatureCards,
    SettingsHubHeader,
    SettingsHubNav,
    HiddenAmount,
  },
  data() {
    return {
      hapticsOn: hapticsEnabled(),
      hapticsSupported: hapticsSupported(),
      showWalletsDialog: false,
      showSparkLnAddressSheet: false,
      showAddWalletDialog: false,
      // A wallet's details, pushed inside the Manage Wallets sheet.
      detailWalletId: null,
      showAddSparkSheet: false,
      lnAddressWalletId: null,
      showMoveAddressSheet: false,
      moveAddressWalletId: null,
      showTransferModal: false,
      transferFromWalletId: null,
      showCurrencyDialog: false,
      showNotificationsSheet: false,
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

      // Kiosk Mode
      showKioskPinSetupDialog: false,
      showKioskChangePinDialog: false,
      showKioskDisableDialog: false,
      showKioskWalletPicker: false,
      kioskPinSetupStep: 'intro', // 'intro' | 'selectWallet' | 'enter' | 'confirm'
      // Monotonically increments each time the user lands on the intro
      // step with the dialog open. Drives both a Vue `:key` (so Vue
      // fully remounts the <img> DOM node) and a URL query-string on
      // the animated SVG (so the browser treats each render as a new
      // resource and restarts the SVG's internal CSS animations from
      // frame 0). Without both, Chromium and WebKit have been observed
      // to cache the final animation state and skip the replay.
      //
      // Each unique key adds one entry (~60 KB) to the HTTP cache.
      // Expected bump count per session is small (dialog opens are a
      // rare, deliberate action), so unbounded growth is acceptable.
      // Ping-ponging across a small pool was considered and rejected:
      // reusing a URL defeats the cache-bust and can leave the animation
      // frozen for users on browsers where that was the original issue.
      kioskIntroAnimationKey: 0,
      kioskPinFirst: '',
      kioskPinError: '',
      kioskChangePinStep: 'verify', // 'verify' | 'enter' | 'confirm'
      kioskChangePinFirst: '',
      kioskChangePinError: '',
      kioskDisableError: '',
      kioskActivating: false,
      kioskWalletSelection: '',

    }
  },
  computed: {
    /** Wallets set aside on another recovery phrase (see the wallet store). */
    setAsideWallets() {
      return this.showWalletsDialog ? this.walletStore.setAsideSparkWallets() : [];
    },
    /**
     * Wallets the kiosk can charge through. Kiosk charges are Lightning
     * invoices, and Arkade's Lightning rail is out of service (Boltz
     * retired) - offering it would set up a kiosk that cannot charge.
     */
    /**
     * Every wallet for the kiosk pickers, each with the reason it cannot take
     * kiosk payments ('' when it can): utils/walletCapabilities decides, so
     * an NWC connection that may not create invoices, or never see them
     * paid, is not offered, and Arkade not while its Lightning is paused.
     */
    kioskWalletOptions() {
      return this.wallets.map((w) => ({ ...w, kioskReason: this.kioskReasonText(kioskWalletBlocker(w)) }));
    },
    kioskEligibleWallets() {
      return this.kioskWalletOptions.filter((w) => !w.kioskReason);
    },
    kioskSelectionAllowed() {
      return this.kioskEligibleWallets.some((w) => w.id === this.kioskWalletSelection);
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

    /** Manage Wallets: wallets whose phrase is on this phone, then connected ones. */
    walletGroups() {
      const groups = [
        { kind: WALLET_KIND.ON_PHONE, title: this.$t('On this phone'), wallets: [] },
        { kind: WALLET_KIND.CONNECTED, title: this.$t('Connected'), wallets: [] },
      ];
      for (const wallet of this.sortedWallets) groups.find((g) => g.kind === walletKind(wallet)).wallets.push(wallet);
      return groups.filter((g) => g.wallets.length);
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
      'isActiveWalletArkade',
      'arkadeWallet',
      'activeArkadeAddress',
      'useBip177Format',
      'hasBackedUp',
      'walletSwitching',
      'isActiveWalletNWC',
      'isActiveWalletLNBits',
      'activeWallet',
      'activeWalletLightningAddress',
      'walletInfos',
    ]),

    walletStore() {
      return useWalletStore();
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

    /**
     * The auto-add-incoming-Bitcoin setting only applies to Spark
     * wallets (the only wallet type that produces static deposit
     * addresses). Hide the section for everyone else so we don't
     * advertise a control they can't use.
     */
    isSparkActiveWallet() {
      return this.walletStore.activeWalletType === 'spark';
    },

    kioskSelectedWalletName() {
      if (!this.walletStore.kioskWalletId) return '';
      const w = this.kioskWalletOptions.find(w => w.id === this.walletStore.kioskWalletId);
      if (!w) return '';
      // Chosen before its connection lost the grant: say so where it is set.
      return w.kioskReason ? `${w.name} · ${w.kioskReason}` : w.name;
    },

    nwcWalletAlias() {
      if (!this.activeWallet || this.activeWallet.type !== 'nwc') return null;
      // What the wallet calls itself; placeholders ("Unknown", "N/A") say nothing.
      return suggestedWalletName({ alias: this.activeWallet.metadata?.alias }, '') || null;
    },

    lnbitsServerDomain() {
      if (!this.activeWallet || this.activeWallet.type !== 'lnbits') return '';
      const url = this.activeWallet.connectionData?.serverUrl || '';
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    },

    /**
     * Drives the Lightning Address row template. Single source of truth so
     * the template never repeats branching logic.
     *
     *   'set'           — address attached; row opens dialog to swap.
     *   'unsetReady'    — no address; lnurlp probe succeeded.
     *   'unsetBlocked'  — no address; lnurlp probe explicitly failed.
     *   'probing'       — first paint, awaiting probe result.
     */
    lnAddressRowState() {
      if (this.activeWalletLightningAddress) return 'set';
      const walletId = this.activeWallet?.id;
      if (!walletId) return 'probing';
      const status = this.lnurlpStatus[walletId];
      if (status === 'available') return 'unsetReady';
      if (status === 'off') return 'unsetBlocked';
      if (status === 'unknown') return 'unknown';
      return 'probing';
    },

    /** Every state leads somewhere except the brief wait for the first answer. */
    lnAddressRowClickable() {
      return this.lnAddressRowState !== 'probing';
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

    /**
     * Feature cards row — Auto-Transfer and Kiosk Mode. Meta strings
     * carry live context (active rule count, kiosk status) so the
     * card is informative before a tap. Earn Sats and Address Book
     * moved to the Spend tab.
     */
    /** Rules that are switched on. */
    autoTransferOn() {
      return Object.values(useAutoWithdrawStore().configs).filter((rule) => rule.enabled).length;
    },
    autoTransferMeta() {
      const store = useAutoWithdrawStore();
      if (store.needingAttention.length) return this.$t('Needs attention');
      if (this.autoTransferOn) return this.$t('{count} on', { count: this.autoTransferOn });
      return Object.keys(store.configs).length ? this.$t('Paused') : this.$t('No rules yet');
    },

    featureCards() {
      const kioskOn = !!this.walletStore.kioskEnabled;
      return [
        {
          id: 'auto-transfer',
          icon: 'tabler:arrow-autofit-right',
          label: this.$t('Auto-Transfer'),
          meta: this.autoTransferMeta,
          active: this.autoTransferOn > 0,
        },
        {
          id: 'kiosk',
          icon: 'tabler:cash-register',
          label: this.$t('kiosk.kioskMode'),
          meta: kioskOn ? this.$t('Active') : this.$t('Off'),
          active: kioskOn,
        },
      ];
    },

    /**
     * The 4 most-frequently-flipped controls, surfaced as compact pill
     * toggles above the sections. Same underlying state as the full
     * rows further down — deliberate duplication, mirroring iOS
     * Control Center vs Settings → Display.
     *
     * Each toggle's `id` is consumed by `onQuickToggle(id)` which
     * fans out to the matching setter so the underlying logic
     * (dialogs, confirmations, etc.) stays in one place.
     */
    quickToggles() {
      const darkActive = this.$q.dark.isActive;
      const bitcoinDisplay = this.defaultDisplayCurrency === 'bitcoin';
      const balanceHidden = this.walletStore.balanceHidden;
      return [
        {
          id: 'theme',
          icon: 'tabler:contrast',
          label: this.$t('Theme'),
          value: darkActive ? this.$t('Dark') : this.$t('Light'),
          // No `on` — Theme is either-or, neither side is "active".
        },
        {
          id: 'display',
          // Currency switch (Bitcoin ↔ user's fiat). The two-way
          // arrow reads as "swap" — same visual convention banking
          // apps use for currency toggles. The old eye icon
          // collided with hide-balance one row below.
          icon: 'tabler:arrows-exchange',
          label: this.$t('Display'),
          value: bitcoinDisplay ? this.$t('Bitcoin') : this.preferredFiatCurrency,
        },
        {
          // Privacy mode for balances. Replaced the previous "Format"
          // pill (BIP-177 vs Legacy), which was technical jargon a
          // noob would never tap on purpose. Hide-balance is a
          // mainstream-loved fintech feature (Cash App, Revolut,
          // Monzo all have it) and a quick toggle is the perfect
          // home for it: one tap covers the wallet hero, every
          // switcher row, and the manage-wallets totals.
          id: 'hide-balance',
          icon: balanceHidden ? 'tabler:eye-off' : 'tabler:eye',
          label: this.$t('Balance'),
          value: balanceHidden ? this.$t('Hidden') : this.$t('Visible'),
          on: balanceHidden,
        },
        {
          id: 'app-lock',
          // Biometric-first hint. Even when the user's enrolled
          // method is device PIN, fingerprint reads as "biometric
          // app lock" to mainstream users — same convention as
          // banking apps (Revolut, N26, Sparkasse).
          icon: 'tabler:fingerprint',
          label: this.$t('Lock'),
          // On web the card stays tappable so the user can discover
          // the feature; the tap opens the Get-the-App dialog rather
          // than the native enable flow. On native without enrolled
          // biometrics we still surface N/A and disable — that's a
          // device-level limitation, not a platform limitation.
          value: !this.isNativeApp
            ? this.$t('Off')
            : this.biometricsAvailable
              ? (this.biometricsEnabled ? this.$t('On') : this.$t('Off'))
              : this.$t('N/A'),
          on: this.biometricsEnabled, // true binary on/off — show green tint when on.
          disabled: this.isNativeApp && !this.biometricsAvailable,
        },
      ];
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
    // A removed wallet's details close; the sheet always reopens on the list.
    detailWallet(wallet) {
      if (!wallet && this.detailWalletId) this.detailWalletId = null;
    },
    showWalletsDialog(open) {
      if (!open) this.detailWalletId = null;
    },

    /**
     * Replay the kiosk intro animation every time the user lands on
     * the intro step with the dialog visible. Covers both (a) a fresh
     * open of the setup dialog and (b) navigating back to intro from
     * the PIN entry step. Bumping `kioskIntroAnimationKey` changes the
     * `<img>` :key (remounting the DOM node) and the SVG URL query
     * string (invalidating the cached render context), which together
     * force the SVG's internal CSS animations to restart from frame 0.
     */
    kioskPinSetupStep(next) {
      if (next === 'intro' && this.showKioskPinSetupDialog) {
        this.kioskIntroAnimationKey += 1;
      }
    },
    showKioskPinSetupDialog(isOpen) {
      if (isOpen && this.kioskPinSetupStep === 'intro') {
        this.kioskIntroAnimationKey += 1;
      }
    },

    /**
     * Trigger an lnurlp availability probe whenever the active wallet
     * becomes (or is replaced by) an LNbits wallet. Result is cached
     * per wallet id, so re-visits during the same session are free.
     * Fires `immediate: true` so the first paint reflects the probe.
     */
    'activeWallet.id': {
      immediate: true,
      handler() {
        this.maybeProbeLnurlpForActiveWallet();
      },
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

    // Handle deep link from wallet switcher "Manage Wallets" button
    if (this.$route.query.section === 'wallets') {
      this.$nextTick(() => { this.showWalletsDialog = true; });
    }

    // Native-only redirect. A direct web navigation to /learn* is bounced
    // here by the router guard (see router/routes.js) with ?getApp=learn.
    // Open the shared Get-the-App dialog so the user learns that Learn &
    // Earn is app-only, matching the card-tap path in onFeatureSelect.
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

    // ─── Kiosk Mode ───────────────────────────────────

    handleKioskToggle(val) {
      if (val) {
        // Pre-select an existing kiosk destination if one was set previously,
        // otherwise default to the currently active wallet so the wizard's
        // wallet step always has a sensible default and can never produce
        // a half-configured state (kiosk enabled, no destination).
        // Only pre-select a wallet the kiosk can actually charge through
        // (Arkade is filtered out of the picker while its Lightning rail is
        // out; a hidden ineligible selection would let Next persist it).
        const eligible = new Set(this.kioskEligibleWallets.map((w) => w.id));
        const preferred = this.walletStore.kioskWalletId || this.walletStore.activeWalletId || '';
        this.kioskWalletSelection = eligible.has(preferred)
          ? preferred
          : (this.kioskEligibleWallets[0]?.id || '');
        this.showKioskPinSetupDialog = true;
      } else {
        this.showKioskDisableDialog = true;
      }
    },

    async advanceFromKioskWalletSelect() {
      if (!this.kioskWalletSelection) return;
      // Defense in depth: never persist a wallet the picker doesn't offer.
      if (!this.kioskEligibleWallets.some((w) => w.id === this.kioskWalletSelection)) return;
      await this.walletStore.setKioskWallet(this.kioskWalletSelection);
      this.kioskPinSetupStep = 'enter';
    },

    handleKioskPinSetupComplete(pin) {
      if (this.kioskPinSetupStep === 'enter') {
        this.kioskPinFirst = pin;
        this.kioskPinSetupStep = 'confirm';
        this.kioskPinError = '';
        this.$nextTick(() => this.$refs.kioskSetupPinPadRef?.reset());
      } else {
        if (pin === this.kioskPinFirst) {
          this.walletStore.enableKiosk(pin, this.walletStore.kioskWalletId || '');
          this.showKioskPinSetupDialog = false;
          this.$q.notify({ message: this.$t('kiosk.kioskEnabled'), color: 'positive' });
        } else {
          this.kioskPinError = this.$t('kiosk.pinMismatch');
        }
      }
    },

    resetKioskPinSetup() {
      this.kioskPinSetupStep = 'intro';
      this.kioskPinFirst = '';
      this.kioskPinError = '';
    },

    handleKioskChangePinComplete(pin) {
      if (this.kioskChangePinStep === 'verify') {
        if (this.walletStore.verifyKioskPin(pin)) {
          this.kioskChangePinStep = 'enter';
          this.kioskChangePinError = '';
          this.$nextTick(() => this.$refs.kioskChangePinPadRef?.reset());
        } else {
          this.kioskChangePinError = this.$t('kiosk.incorrectPin');
        }
      } else if (this.kioskChangePinStep === 'enter') {
        this.kioskChangePinFirst = pin;
        this.kioskChangePinStep = 'confirm';
        this.kioskChangePinError = '';
        this.$nextTick(() => this.$refs.kioskChangePinPadRef?.reset());
      } else {
        if (pin === this.kioskChangePinFirst) {
          this.walletStore.changeKioskPin(pin);
          this.showKioskChangePinDialog = false;
          this.$q.notify({ message: this.$t('kiosk.pinChanged'), color: 'positive' });
        } else {
          this.kioskChangePinError = this.$t('kiosk.pinMismatch');
        }
      }
    },

    resetKioskChangePin() {
      this.kioskChangePinStep = 'verify';
      this.kioskChangePinFirst = '';
      this.kioskChangePinError = '';
    },

    handleKioskDisablePin(pin) {
      if (this.walletStore.verifyKioskPin(pin)) {
        this.walletStore.disableKiosk();
        this.showKioskDisableDialog = false;
        this.$q.notify({ message: this.$t('kiosk.kioskDisabled'), color: 'positive' });
      } else {
        this.kioskDisableError = this.$t('kiosk.incorrectPin');
      }
    },

    resetKioskDisable() {
      this.kioskDisableError = '';
    },

    /** The words for a kiosk blocker (utils/walletCapabilities), or ''. */
    kioskReasonText(blocker) {
      if (blocker === KIOSK_BLOCKER.CANNOT_RECEIVE) return this.$t("Can't receive");
      if (blocker === KIOSK_BLOCKER.CANNOT_CONFIRM) return this.$t("Can't confirm payments");
      return '';
    },

    confirmKioskWalletSelection() {
      // Never persist a wallet the picker does not offer.
      if (!this.kioskEligibleWallets.some((w) => w.id === this.kioskWalletSelection)) return;
      this.walletStore.setKioskWallet(this.kioskWalletSelection);
      this.showKioskWalletPicker = false;
    },

    updateKioskTipValue(idx, val) {
      const arr = [...this.walletStore.kioskTipValues];
      arr[idx] = parseInt(val) || 0;
      this.walletStore.setKioskTipValues(arr);
    },

    /** The kiosk wallet picker, preselecting the saved wallet only while it can take payments. */
    openKioskWalletPicker() {
      const saved = this.walletStore.kioskWalletId || '';
      this.kioskWalletSelection = this.kioskEligibleWallets.some((w) => w.id === saved) ? saved : '';
      this.showKioskWalletPicker = true;
    },

    async handleStartKiosk() {
      if (!this.walletStore.kioskWalletId) {
        this.$q.notify({ message: this.$t('kiosk.noWalletSelected'), color: 'warning' });
        return;
      }
      // A kiosk wallet that is no longer on this phone (one left before
      // removals cleared the binding) would fail every sale: choose again.
      if (!this.wallets.some((w) => w.id === this.walletStore.kioskWalletId)) {
        this.$q.notify({ message: this.$t('Choose a kiosk wallet that can take payments'), color: 'warning' });
        this.openKioskWalletPicker();
        return;
      }
      // A wallet chosen before its connection lost a grant would show a QR
      // that can never complete: choose another one first.
      const saved = this.kioskWalletOptions.find((w) => w.id === this.walletStore.kioskWalletId);
      if (saved?.kioskReason) {
        this.$q.notify({ message: this.$t('Choose a kiosk wallet that can take payments'), caption: `${saved.name} · ${saved.kioskReason}`, color: 'warning' });
        this.openKioskWalletPicker();
        return;
      }
      this.kioskActivating = true;
      try {
        await this.walletStore.activateKioskMode();
        this.$router.push('/kiosk');
      } catch (err) {
        console.error('Kiosk activation failed:', err);
        this.walletStore.showPaymentError(err, {
          context: 'kiosk',
          walletType: this.walletStore.activeWalletType,
          route: 'Kiosk activation',
          t: this.$t.bind(this),
        });
      } finally {
        this.kioskActivating = false;
      }
    },

    // ─── LNbits Lightning Address ─────────────────────────────────────

    /**
     * Construct a one-shot LNBitsWalletProvider for the active LNbits
     * wallet. We deliberately mirror the throwaway pattern used by
     * LNBitsSetupPage (it doesn't go through the connected provider
     * registry in `walletStore.providers`, so the call path is identical
     * whether the wallet was just added or has been around for months).
     *
     * @returns {LNBitsWalletProvider|null} a fresh provider, or null
     *   if the active wallet isn't an LNbits wallet (defensive guard;
     *   callers gate on `isActiveWalletLNBits` already).
     */
    _buildActiveLNBitsProvider() {
      const wallet = this.activeWallet;
      if (!wallet || wallet.type !== 'lnbits') return null;
      const conn = wallet.connectionData || {};
      return new LNBitsWalletProvider(wallet.id, {
        name: wallet.name,
        serverUrl: conn.serverUrl,
        walletId: conn.walletId,
        adminKey: conn.adminKey,
      });
    },

    /**
     * Ask the active LNbits wallet's server about Pay Links (lnurlp) once
     * and cache the answer, so moving around Settings does not re-ask.
     * No-op for other wallet types.
     */
    async maybeProbeLnurlpForActiveWallet() {
      const wallet = this.activeWallet;
      if (!wallet || wallet.type !== 'lnbits' || this.lnurlpStatus[wallet.id]) return;
      await this.probeLnurlpForActiveWallet();
    },

    /** Ask again, cache and return the answer ('available' | 'off' | 'unknown'). */
    async probeLnurlpForActiveWallet() {
      const wallet = this.activeWallet;
      const provider = this._buildActiveLNBitsProvider();
      if (!provider) return 'unknown';
      const status = await provider.lnurlpStatus();
      this.lnurlpStatus = { ...this.lnurlpStatus, [wallet.id]: status };
      return status;
    },

    /**
     * The Lightning Address row. Pay Links answering opens the address
     * step (pick when addresses exist, else create); Pay Links off opens
     * the step that says who can turn it on; a server that cannot be
     * reached is asked once more, then said so.
     */
    async openLightningAddressDialog() {
      const wallet = this.activeWallet;
      if (!wallet || wallet.type !== 'lnbits') return;

      let status = this.lnurlpStatus[wallet.id];
      if (status !== 'available' && status !== 'off') status = await this.probeLnurlpForActiveWallet();
      if (status === 'unknown') {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't reach the server"), caption: this._lnbitsDomain(wallet), timeout: 3000 });
        return;
      }

      this.lnAddressSheet = {
        visible: false,
        view: status === 'off' ? 'paylinks' : 'address',
        walletId: wallet.id,
        serverUrl: wallet.connectionData?.serverUrl || '',
        domain: this._lnbitsDomain(wallet),
        existingAddresses: [],
        defaultUsername: wallet.name || '',
      };
      if (status === 'available') await this._loadLnbitsAddresses();
      this.lnAddressSheet.visible = true;
    },

    /** Pay Links was turned on while the sheet was open: on to the address step. */
    async showLnbitsAddressStep() {
      this.lnurlpStatus = { ...this.lnurlpStatus, [this.lnAddressSheet.walletId]: 'available' };
      await this._loadLnbitsAddresses();
      this.lnAddressSheet.view = 'address';
    },

    async _loadLnbitsAddresses() {
      const provider = this._buildActiveLNBitsProvider();
      try {
        this.lnAddressSheet.existingAddresses = provider ? await provider.listLightningAddresses() : [];
      } catch (err) {
        // Pay Links answered but listing failed: creating still works.
        console.warn('[settings] listLightningAddresses failed:', err);
        this.lnAddressSheet.existingAddresses = [];
      }
    },

    createLnbitsAddress(username, options = {}) {
      const provider = this._buildActiveLNBitsProvider();
      if (!provider) return Promise.reject(new Error(this.$t('Could not create address.')));
      return provider.createLightningAddress({ username, successText: options.successText });
    },

    _lnbitsDomain(wallet) {
      return this.lnbitsServerDomain
        || (wallet.connectionData?.serverUrl ? this._safeHostname(wallet.connectionData.serverUrl) : '');
    },

    /**
     * Parse just the hostname portion of a URL. Used as a fallback when
     * `lnbitsServerDomain` isn't yet computed (rare race).
     */
    _safeHostname(rawUrl) {
      try { return new URL(rawUrl).hostname; }
      catch { return rawUrl; }
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
     * Fan-out router for quick-toggle pills. Keeps the underlying
     * setters / dialogs as the single source of truth — quick toggles
     * are a shortcut surface, not a second implementation path.
     */
    onQuickToggle(id) {
      switch (id) {
        case 'theme':
          this.handleToggleDark();
          return;
        case 'display':
          this.setDisplayCurrency(
            this.defaultDisplayCurrency === 'bitcoin' ? 'fiat' : 'bitcoin',
          );
          return;
        case 'hide-balance':
          this.walletStore.setBalanceHidden();
          return;
        case 'app-lock':
          if (!this.isNativeApp) {
            // Web: no native biometric API exists. Surface the
            // limitation honestly with the same Get-the-App prompt
            // we use for screen privacy.
            this.promptForApp(
              this.$t('Biometric app lock runs on the device and is only available in the BuhoGO Android app. Install it from Google Play to unlock the app with your fingerprint or face.')
            );
            return;
          }
          this.toggleBiometrics(!this.biometricsEnabled);
          return;
      }
    },

    /**
     * Routes a feature-card tap to the right surface. Same fan-out
     * pattern as the quick-toggle and attention-strip handlers —
     * keeps the underlying dialogs / routes / toggles as the single
     * source of truth, with the card surface staying purely visual.
     *
     * For Kiosk: tapping the card always flips the toggle. The
     * setup dialog opens automatically on the off→on transition via
     * `handleKioskToggle`, so the user sees the same first-run flow
     * whether they tap the card or the section toggle.
     */
    onFeatureSelect(id) {
      switch (id) {
        case 'auto-transfer':
          this.$router.push('/auto-transfer');
          return;
        case 'kiosk':
          this.handleKioskToggle(!this.walletStore.kioskEnabled);
          return;
      }
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

    /**
     * Open the shared Get-the-App dialog with a feature-specific
     * message. Used by every native-only feature that wants to
     * surface honestly on web instead of being silently disabled —
     * screen privacy, biometric app lock, future Android-only
     * protections.
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
     * of the app-only message so the card-tap gate (onFeatureSelect) and
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
      if ((wallet.type || 'nwc') !== 'nwc') return true;
      return !['no-answer', 'relay'].includes(this.walletStore.nwcStatus[wallet.id]);
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
        includesKioskWallet: this.sparkWallets.some((w) => w.id === this.walletStore.kioskWalletId),
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
        includesKioskWallet: wallets.some((w) => w.id === this.walletStore.kioskWalletId),
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
        isKioskWallet: this.walletStore.kioskWalletId === walletId,
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
      switch (wallet.type) {
        case 'spark': return 'Spark';
        case 'arkade': return 'Arkade';
        case 'lnbits': return 'LNbits';
        case 'nwc':
        default: return 'NWC';
      }
    },

    openWalletDetail(walletId) {
      this.detailWalletId = walletId;
    },

    /** Back from a wallet's details to the list, focus on the row that opened them. */
    closeWalletDetail() {
      const walletId = this.detailWalletId;
      this.detailWalletId = null;
      this.$nextTick(() => {
        document.querySelector(`.wallets-dialog-card [data-wallet-id="${CSS.escape(walletId || '')}"]`)?.focus();
      });
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

    async copyArkadeAddress() {
      await this.copyToClipboard(this.activeArkadeAddress, this.$t('Arkade address copied'));
    },

    async shareArkadeAddress() {
      if (!this.activeArkadeAddress) return;

      const result = await shareContent({
        title: this.$t('Arkade Address'),
        text: this.activeArkadeAddress
      });

      if (result.success) {
        // Native share UI provides its own feedback.
      } else if (result.reason === 'unsupported' || result.reason === 'error') {
        if (result.reason === 'error') {
          console.error('Failed to share Arkade address:', result.error);
        }
        await this.copyArkadeAddress();
      }
    },

    // ==========================================
    // Recovery phrase (unified view + backup flow)
    // ==========================================

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
.ln-address-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: #B7791F;
  vertical-align: 1px;
}

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

/* Compact layout helpers introduced by the refactor */
.kiosk-tip-input-row {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
}
.kiosk-tip-input-row .kiosk-tip-input {
  flex: 1;
  min-width: 0;
}

.kiosk-activate-row {
  padding: 12px 16px 14px;
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
.branta-info {
  color: var(--text-muted);
}

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
/* Summary strip: three equal, centered columns on the same grouped
   surface as the list below - a reading, not a bordered widget. */
.wallet-stats {
  display: flex;
  align-items: center;
  border-radius: 16px;
  padding: 0.875rem 0.5rem;
  margin-bottom: 0.75rem;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  min-width: 0;
}

.wallet-stats .stat-value {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.2;
  margin-bottom: 0.15rem;
}

.stat-value.online-value.online-light { color: #1A1A1A; }
.stat-value.online-value.online-dark  { color: #15DE72; }

.stat-label {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 500;
  text-transform: capitalize;
  letter-spacing: 0.025em;
  opacity: 0.55;
}

.stat-divider {
  width: 1px;
  height: 28px;
  flex-shrink: 0;
}

.divider-dark {
  background: rgba(128, 128, 128, 0.25);
}

.divider-light {
  background: rgba(128, 128, 128, 0.22);
}

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

.wallets-dialog-card .sheet-grabber {
  display: flex;
  justify-content: center;
  padding: 10px 0 2px;
  flex-shrink: 0;
}

.wallets-dialog-card .grabber-bar {
  width: 36px;
  height: 5px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.35);
}

.wallets-dialog-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: none;
  padding-top: 0.25rem;
  padding-bottom: 0.5rem;
}

.wallets-dialog-header .dialog-title {
  flex: 1;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Mirrors the back button so the title stays optically centered. */
.wallets-header-spacer {
  flex: 0 0 auto;
  width: 40px;
}

/* Pinned footer + its one CTA: dark ink in light mode, the app's credit
   green in dark mode. */
.wallets-dialog-footer {
  flex-shrink: 0;
  padding: 0.75rem 1rem;
  padding-bottom: max(0.875rem, var(--safe-bottom, 0px));
  border-top: 1px solid rgba(128, 128, 128, 0.15);
}

.wallets-footer-dark { background: #171717; }
.wallets-footer-light { background: var(--bg-primary); }

.add-wallet-btn {
  width: 100%;
  min-height: 48px;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.15s ease;
}

.add-wallet-btn-dark {
  color: var(--btn-primary-fg);
  background: var(--btn-primary-bg);
}

.add-wallet-btn-dark:hover {
  filter: brightness(1.05);
}

.add-wallet-btn-light {
  color: #FFFFFF;
  background: #1A1A1A;
}

.add-wallet-btn-light:hover {
  background: #2A2A2A;
}

.wallets-dialog-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 1rem 1.5rem 1.5rem;
  min-height: 0;
  scrollbar-width: none;
}

.wallets-dialog-content::-webkit-scrollbar {
  display: none;
}

.wallets-list-container {
  margin-top: 0.25rem;
}

/* Inset grouped list: one rounded surface, hairline separators inset past
   the leading mark - the same reading as the wallet switcher sheet. */
.wallets-list-scroll {
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
}

.wallets-group-section + .wallets-group-section { margin-top: 18px; }
.wallets-group-title { margin: 0 4px 8px; color: var(--text-secondary); font-size: 13px; font-weight: 600; }

.wallets-group-light { background: #FFFFFF; }
.wallets-group-dark  { background: #2C2C2E; }

/* Two-line disclosure row: identity left, value trailing, chevron as the
   affordance. All management lives one tap deeper. */
.wallet-card {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.wallet-row-name {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-name-dark { color: #F6F6F6; }
.row-name-light { color: #212121; }

.wallet-row-sub {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-sub-dark { color: rgba(255, 255, 255, 0.5); }
.row-sub-light { color: rgba(0, 0, 0, 0.45); }

.row-sub-active.sub-active-light { color: #1A1A1A; font-weight: 600; }
.row-sub-active.sub-active-dark { color: #15DE72; font-weight: 600; }

.wallet-row-value {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
  margin-left: auto;
  text-align: right;
}

.row-value-dark { color: rgba(255, 255, 255, 0.75); }
.row-value-light { color: rgba(0, 0, 0, 0.65); }

.set-aside { margin-top: 24px; }
.set-aside-title { margin: 0 4px 8px; color: var(--text-secondary); font-size: 13px; font-weight: 600; }
.set-aside-group { border-radius: 16px; overflow: hidden; }
.set-aside-row { width: 100%; min-height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; border: 0; background: transparent; color: var(--text-primary); font: 600 15px/1.3 'Manrope', sans-serif; text-align: left; cursor: pointer; }
.set-aside-row + .set-aside-row { border-top: 1px solid var(--border-card); }
.set-aside-name { min-width: 0; overflow-wrap: anywhere; }
.set-aside-action { flex: 0 0 auto; color: var(--brand-accent-text); font-size: 14px; }
.set-aside-footer { margin: 8px 6px 0; color: var(--text-secondary); font-size: 12.5px; line-height: 1.45; }

.wallet-row-fiat {
  display: block;
  margin-top: 2px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  opacity: 0.7;
}

.stat-fiat {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
}

.wallet-row-chevron {
  flex-shrink: 0;
  opacity: 0.35;
}

.no-wallets {
  text-align: center;
  padding: 2rem;
}

.no-wallets-icon {
  margin-bottom: 1rem;
}

.no-wallets-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  margin-top: 0.5rem;
  opacity: 0.5;
}

.no-wallets-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Wallet row inside the grouped surface */
.wallet-card-wrapper:not(:first-child) .wallet-card {
  position: relative;
}

.wallet-card-wrapper:not(:first-child) .wallet-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 74px;
  right: 0;
  height: 1px;
  background: rgba(128, 128, 128, 0.18);
}

.wallet-card {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  transition: background 0.12s ease;
  overflow: hidden;
  max-width: 100%;
}

.wallet-card-dark:hover {
  background: rgba(255, 255, 255, 0.06);
}

.wallet-card-light:hover {
  background: rgba(0, 0, 0, 0.045);
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

/* Arkade's purple mark needs a light tile on cream (brand rule). */
body.body--light .wallet-avatar-arkade {
  background: var(--arkade-tile);
  box-shadow: inset 0 0 0 1px var(--arkade-tint-border);
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
  border-color: #2C2C2E;
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

  .picker-dialog-card {
    max-height: 88vh;
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

.wallets-discovery {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
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

/* Kiosk Setup Dialog */
.kiosk-setup-dialog {
  width: 90vw; max-width: 420px;
  border-radius: var(--radius-lg);
  padding: 20px 24px 28px;
  display: flex; flex-direction: column; align-items: center;
  text-align: center;
}

/* Animated hero illustration for the intro step.
   The SVG carries its own CSS keyframes inside a <style> block and is
   served via <img> so the animation plays in a self-contained sandbox
   and auto-replays whenever the dialog remounts. */
.kiosk-setup-hero {
  width: 100%;
  display: flex;
  justify-content: center;
  margin-bottom: 8px;
  /* Clip any drawing that overflows the intended frame so the skew on
     the QR-code animation can't push beyond the dialog edge. */
  overflow: hidden;
}

.kiosk-setup-illustration {
  width: 100%;
  max-width: 340px;
  height: auto;
  user-select: none;
  pointer-events: none;
}

.kiosk-setup-title {
  font-family: 'Manrope', sans-serif;
  font-size: 1.25rem; font-weight: 800;
  margin: 0 0 8px; color: var(--text-primary);
}

.kiosk-setup-desc {
  font-family: 'Manrope', sans-serif;
  font-size: 0.875rem; line-height: 1.5;
  color: var(--text-secondary);
  margin: 0 0 20px; max-width: 300px;
}

.kiosk-setup-features {
  width: 100%; display: flex; flex-direction: column; gap: 8px;
  margin-bottom: 24px;
}

.kiosk-setup-feature {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-radius: var(--radius-sm);
  background: var(--bg-input); text-align: left;
  font-family: 'Manrope', sans-serif; font-size: 0.875rem; font-weight: 500;
  color: var(--text-secondary);
}

.kiosk-feature-icon {
  width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-secondary); color: var(--text-muted);
}

/* PIN-setup intro CTA — tinted green, matches .kiosk-start-btn. */
.kiosk-setup-primary {
  width: 100%;
  height: 50px;
  border: none;
  border-radius: 16px;
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22);
  font-family: 'Manrope', sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    filter 0.18s ease,
    transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}
.kiosk-setup-primary:hover { filter: brightness(1.06); }
.kiosk-setup-primary:active { transform: scale(0.98); filter: brightness(0.94); }

body.body--light .kiosk-setup-primary {
  /* Same neutral primary-action pill as .kiosk-start-btn-light and
     .create-invoice-btn-light. One visual weight for every CTA on
     cream. */
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
  box-shadow: none;
}

.kiosk-setup-secondary {
  background: none; border: none;
  color: var(--text-muted);
  font-family: 'Manrope', sans-serif; font-size: 0.875rem; font-weight: 500;
  cursor: pointer; padding: 12px 16px; margin-top: 4px;
  -webkit-tap-highlight-color: transparent;
}
.kiosk-setup-secondary:active { opacity: 0.6; }

/* Wizard wallet picker — mirrors the .kiosk-setup-feature card style but
   is interactive: each row is a button with a left-side radio dot, and
   the selected row uses the app-wide tinted-green selection grammar. */
.kiosk-wallet-list {
  width: 100%; display: flex; flex-direction: column; gap: 8px;
  margin-bottom: 20px;
}

.kiosk-wallet-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  border: 1px solid transparent;
  text-align: left;
  font-family: 'Manrope', sans-serif;
  color: var(--text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease;
}
.kiosk-wallet-row:active { transform: scale(0.99); }
/* Cannot take kiosk payments: the name steps back, the reason stays readable. */
.kiosk-wallet-row-off { cursor: not-allowed; }
.kiosk-wallet-row-off:active { transform: none; }
.kiosk-wallet-row-off .kiosk-wallet-row-name,
.kiosk-wallet-row-off .kiosk-wallet-row-icon,
.kiosk-wallet-row-off .kiosk-wallet-row-radio { opacity: .45; }
.kiosk-wallet-row-off .kiosk-wallet-row-type { color: var(--text-secondary); }

.kiosk-wallet-row-active {
  background: rgba(21, 222, 114, 0.14);
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22);
}
body.body--light .kiosk-wallet-row-active {
  background: rgba(5, 149, 115, 0.10);
  box-shadow: inset 0 0 0 1px rgba(5, 149, 115, 0.20);
}

.kiosk-wallet-row-radio {
  width: 20px; height: 20px; flex-shrink: 0;
  border-radius: 50%;
  border: 1.5px solid var(--text-muted);
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.15s ease;
}
.kiosk-wallet-row-active .kiosk-wallet-row-radio { border-color: #15DE72; }
body.body--light .kiosk-wallet-row-active .kiosk-wallet-row-radio { border-color: #059573; }

.kiosk-wallet-row-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: #15DE72;
}
body.body--light .kiosk-wallet-row-dot { background: #059573; }

.kiosk-wallet-row-info {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 2px;
}

.kiosk-wallet-row-name {
  font-size: 0.9375rem; font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.kiosk-wallet-row-type {
  font-size: 0.75rem; font-weight: 500;
  color: var(--text-muted);
}

.kiosk-wallet-row-icon {
  flex-shrink: 0;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-muted);
}

</style>
