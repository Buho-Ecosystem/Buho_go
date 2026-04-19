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
        <Icon icon="tabler:chevron-left" width="18" height="18" />
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
          <q-item-section side>
            <Icon icon="tabler:wallet" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Manage Wallets') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ wallets.length }} {{ wallets.length === 1 ? $t('wallet') : $t('wallets') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item clickable v-ripple @click="showAutoTransferDialog = true">
          <q-item-section side>
            <Icon icon="tabler:send" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Auto-Transfer') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ awActiveCount > 0 ? awActiveCount + ' ' + $t('active') : $t('No rules configured') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item clickable v-ripple @click="$router.push('/address-book')">
          <q-item-section side>
            <Icon icon="tabler:address-book" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Address Book') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>
      </div>

      <!-- ACTIVE WALLET Section — adapts to active wallet type -->

      <!-- Spark Wallet -->
      <template v-if="isActiveWalletSpark && hasSparkWallet">
        <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
          {{ $t('Wallet') }} - Spark
        </div>
        <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
          <!-- Wallet Switcher -->
          <q-item
            clickable
            v-ripple
            @click="handleSwitchSparkWallet(sparkBusinessWallet?.id)"
            :disable="walletSwitching"
          >
            <q-item-section side>
              <Icon icon="tabler:building-store" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ sparkBusinessWallet?.name || 'Business' }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ formatBalance(balances[sparkBusinessWallet?.id] || 0) }}
              </q-item-label>
            </q-item-section>
            <q-item-section side v-if="sparkBusinessWallet && activeWalletId === sparkBusinessWallet.id">
              <Icon icon="tabler:circle-check-filled" width="18" height="18" style="color: #15DE72;" />
            </q-item-section>
          </q-item>
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <q-item
            clickable
            v-ripple
            @click="handleSwitchSparkWallet(sparkPersonalWallet?.id)"
            :disable="walletSwitching"
          >
            <q-item-section side>
              <Icon icon="tabler:user" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ sparkPersonalWallet?.name || 'Personal' }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ formatBalance(balances[sparkPersonalWallet?.id] || 0) }}
              </q-item-label>
            </q-item-section>
            <q-item-section side v-if="sparkPersonalWallet && activeWalletId === sparkPersonalWallet.id">
              <Icon icon="tabler:circle-check-filled" width="18" height="18" style="color: #15DE72;" />
            </q-item-section>
          </q-item>
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <q-item>
            <q-item-section side>
              <Icon icon="tabler:qrcode" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Spark Address') }}
              </q-item-label>
              <q-item-label caption class="mono-caption" :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ truncateAddress(activeSparkAddress) || $t('Not available') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side class="spark-address-actions">
              <q-btn flat round dense @click="copySparkAddress" :class="$q.dark.isActive ? 'action-icon-dark' : 'action-icon-light'" size="sm">
                <Icon icon="tabler:copy" width="16" height="16" />
              </q-btn>
              <q-btn flat round dense @click="shareSparkAddress" :class="$q.dark.isActive ? 'action-icon-dark' : 'action-icon-light'" size="sm">
                <Icon icon="tabler:share" width="16" height="16" />
              </q-btn>
            </q-item-section>
          </q-item>
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <!-- Before backup: show Backup action -->
          <q-item v-if="!activeSparkBackedUp" clickable v-ripple @click="openSeedPhraseDialog('backup')">
            <q-item-section side>
              <Icon icon="tabler:shield-check" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Backup Seed Phrase') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('Verify your recovery phrase') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side class="backup-status-side">
              <span class="backup-status-badge badge-unverified">
                {{ $t('Not verified') }}
              </span>
            </q-item-section>
          </q-item>
          <!-- After backup: show View Seed Phrase -->
          <q-item v-else clickable v-ripple @click="openSeedPhraseDialog('view')">
            <q-item-section side>
              <Icon icon="tabler:eye" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('View Seed Phrase') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('Show your recovery phrase') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <span class="backup-status-badge badge-verified">
                {{ $t('Verified') }}
              </span>
            </q-item-section>
          </q-item>
        </div>
      </template>

      <!-- NWC Wallet -->
      <template v-else-if="isActiveWalletNWC">
        <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
          {{ $t('Wallet') }} - NWC · {{ activeWallet?.name }}
        </div>
        <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
          <!-- Wallet Alias -->
          <q-item v-if="nwcWalletAlias">
            <q-item-section side>
              <Icon icon="tabler:plug-connected" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Connected to') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ nwcWalletAlias }}
              </q-item-label>
            </q-item-section>
          </q-item>
          <q-separator v-if="nwcWalletAlias" :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <!-- Lightning Address -->
          <q-item v-if="activeWalletLightningAddress">
            <q-item-section side>
              <Icon icon="tabler:bolt" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Lightning Address') }}
              </q-item-label>
              <q-item-label caption class="mono-caption" :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ activeWalletLightningAddress }}
              </q-item-label>
            </q-item-section>
            <q-item-section side class="spark-address-actions">
              <q-btn flat round dense @click="copyToClipboard(activeWalletLightningAddress, $t('Lightning address copied'))" :class="$q.dark.isActive ? 'action-icon-dark' : 'action-icon-light'" size="sm">
                <Icon icon="tabler:copy" width="16" height="16" />
              </q-btn>
            </q-item-section>
          </q-item>
          <q-separator v-if="activeWalletLightningAddress" :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <!-- Supported Features -->
          <q-item v-if="nwcSupportedMethods.length > 0">
            <q-item-section side>
              <Icon icon="tabler:list-check" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Features') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ nwcSupportedMethods.join(' · ') }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </div>
      </template>

      <!-- LNBits Wallet -->
      <template v-else-if="isActiveWalletLNBits">
        <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
          {{ $t('Wallet') }} - LNBits · {{ activeWallet?.name }}
        </div>
        <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
          <!-- Server -->
          <q-item>
            <q-item-section side>
              <Icon icon="tabler:server" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Server') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ lnbitsServerDomain }}
              </q-item-label>
            </q-item-section>
          </q-item>
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <!-- Wallet Name -->
          <q-item>
            <q-item-section side>
              <Icon icon="tabler:wallet" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Wallet Name') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ activeWallet?.name || 'LNBits Wallet' }}
              </q-item-label>
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
          <q-item-section side>
            <Icon icon="tabler:currency-dollar" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
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
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item>
          <q-item-section side>
            <Icon icon="tabler:eye" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Display Currency') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ $t('Your balance will always start in this currency') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-btn-toggle
              :model-value="defaultDisplayCurrency"
              dense no-caps rounded unelevated size="sm"
              toggle-color="green"
              :options="[{ label: 'Bitcoin', value: 'bitcoin' }, { label: preferredFiatCurrency, value: 'fiat' }]"
              @update:model-value="setDisplayCurrency"
            />
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item clickable v-ripple @click="showLanguageDialog = true">
          <q-item-section side>
            <Icon icon="tabler:language" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
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
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item>
          <q-item-section side>
            <Icon icon="tabler:hash" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
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
          <q-item-section side>
            <Icon icon="tabler:moon" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
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


      <!-- SECURITY Section -->
      <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
        {{ $t('Security') }}
      </div>
      <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
        <q-item :class="{ 'opacity-50': !biometricsAvailable }">
          <q-item-section side>
            <Icon :icon="biometryIcon" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('App Lock') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ biometryDescription }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <!--
              One-way :model-value binding (not v-model) so the toggle's
              visual state only flips when we explicitly set
              `biometricsEnabled`. Prevents a brief ON→OFF flash while the
              explain dialog is opening or an availability probe is in flight.
            -->
            <q-toggle
              :model-value="biometricsEnabled"
              :color="$q.dark.isActive ? 'green' : 'green-7'"
              :disable="!biometricsAvailable"
              @update:model-value="toggleBiometrics"
            />
          </q-item-section>
        </q-item>
      </div>

      <!-- KIOSK MODE Section -->
      <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
        {{ $t('kiosk.kioskMode') }}
      </div>
      <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
        <!-- Enable toggle -->
        <q-item>
          <q-item-section side>
            <Icon icon="tabler:cash-register" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ walletStore.kioskEnabled ? $t('kiosk.enabled') : $t('kiosk.disabled') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-toggle
              :model-value="walletStore.kioskEnabled"
              :color="$q.dark.isActive ? 'green' : 'green-7'"
              @update:model-value="handleKioskToggle"
            />
          </q-item-section>
        </q-item>
        <div class="kiosk-mode-desc" :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
          {{ $t('kiosk.kioskModeWhat') }}
        </div>

        <template v-if="walletStore.kioskEnabled">
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'" />

          <!-- Destination Wallet -->
          <q-item clickable v-ripple @click="kioskWalletSelection = walletStore.kioskWalletId || ''; showKioskWalletPicker = true">
            <q-item-section side>
              <Icon icon="tabler:wallet" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('kiosk.destinationWallet') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ kioskSelectedWalletName || $t('kiosk.noWalletSelected') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
          </q-item>

          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'" />

          <!-- Current PIN + Change -->
          <q-item>
            <q-item-section side>
              <Icon icon="tabler:lock" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('kiosk.currentPin') }}: {{ walletStore.kioskPin }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn flat dense no-caps size="sm" color="green" @click="showKioskChangePinDialog = true">
                {{ $t('kiosk.changePin') }}
              </q-btn>
            </q-item-section>
          </q-item>

          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'" />

          <!-- Enable Tips -->
          <q-item>
            <q-item-section side>
              <Icon icon="tabler:heart-handshake" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('kiosk.enableTips') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-toggle
                :model-value="walletStore.kioskTipEnabled"
                :color="$q.dark.isActive ? 'green' : 'green-7'"
                @update:model-value="(v) => walletStore.setKioskTipEnabled(v)"
              />
            </q-item-section>
          </q-item>

          <!-- Tip Values (when tips enabled) -->
          <template v-if="walletStore.kioskTipEnabled">
            <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'" />
            <q-item dense>
              <q-item-section>
                <div style="display: flex; gap: 8px;">
                  <q-input
                    v-for="(val, idx) in walletStore.kioskTipValues" :key="'tip-'+idx"
                    :model-value="walletStore.kioskTipValues[idx]"
                    type="number"
                    suffix="%"
                    dense filled
                    :label="$t('kiosk.tipValue') + ' ' + (idx + 1)"
                    :dark="$q.dark.isActive"
                    class="kiosk-tip-input"
                    style="flex: 1; min-width: 0;"
                    @update:model-value="(v) => updateKioskTipValue(idx, v)"
                  />
                </div>
              </q-item-section>
            </q-item>
          </template>

          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'" />

          <!-- Round Up -->
          <q-item>
            <q-item-section side>
              <Icon icon="tabler:arrow-bar-to-up" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('kiosk.roundUp') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('kiosk.roundUpDesc') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-toggle
                :model-value="walletStore.kioskRoundUpEnabled"
                :color="$q.dark.isActive ? 'green' : 'green-7'"
                @update:model-value="(v) => walletStore.setKioskRoundUpEnabled(v)"
              />
            </q-item-section>
          </q-item>

          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'" />

          <!-- Display Currency -->
          <q-item>
            <q-item-section side>
              <Icon icon="tabler:currency-bitcoin" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('kiosk.displayCurrency') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn-toggle
                :model-value="walletStore.kioskDisplayCurrency"
                dense no-caps rounded unelevated size="sm"
                toggle-color="green"
                :options="[{ label: 'Sats', value: 'sats' }, { label: walletStore.preferredFiatCurrency, value: 'fiat' }]"
                @update:model-value="(v) => walletStore.setKioskDisplayCurrency(v)"
              />
            </q-item-section>
          </q-item>

          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'" />

          <!-- Start Kiosk Mode -->
          <q-item>
            <q-item-section>
              <q-btn unelevated no-caps
                :color="$q.dark.isActive ? 'green' : 'green-7'"
                class="full-width kiosk-start-btn"
                :disable="!walletStore.kioskWalletId || kioskActivating"
                :loading="kioskActivating"
                @click="handleStartKiosk">
                {{ $t('kiosk.activateKiosk') }}
              </q-btn>
            </q-item-section>
          </q-item>
        </template>
      </div>

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

            <button class="kiosk-setup-primary" @click="kioskPinSetupStep = 'enter'">
              {{ $t('kiosk.introNext') }}
            </button>
            <button class="kiosk-setup-secondary" @click="showKioskPinSetupDialog = false">
              {{ $t('Cancel') }}
            </button>
          </template>

          <!-- Enter PIN -->
          <template v-else-if="kioskPinSetupStep === 'enter'">
            <KioskPinPad ref="kioskSetupPinPadRef" :title="$t('kiosk.setupPin')" :error-message="kioskPinError"
              @complete="handleKioskPinSetupComplete" />
            <button class="kiosk-setup-secondary" @click="kioskPinSetupStep = 'intro'; kioskPinError = ''">
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
              <q-item v-for="w in wallets" :key="w.id" clickable v-ripple
                @click="kioskWalletSelection = w.id">
                <q-item-section side>
                  <q-radio :model-value="kioskWalletSelection" :val="w.id" color="green"
                    @update:model-value="kioskWalletSelection = $event" />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ w.name }}</q-item-label>
                  <q-item-label caption>{{ getWalletTypeLabel(w) }}</q-item-label>
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
                  <!-- LNBits -->
                  <svg v-else-if="w.type === 'lnbits'" width="14" height="20" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
                  </svg>
                  <!-- Fallback -->
                  <Icon v-else icon="tabler:wallet" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps :label="$t('Cancel')" color="grey" @click="showKioskWalletPicker = false" />
            <q-btn flat no-caps :label="$t('Confirm')" color="green" :disable="!kioskWalletSelection"
              @click="confirmKioskWalletSelection" />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- ADVANCED Section -->
      <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
        {{ $t('Advanced') }}
      </div>
      <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
        <q-item clickable v-ripple @click="showMempoolDialog = true">
          <q-item-section side>
            <Icon icon="tabler:chart-line" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Exchange Rate Source') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ mempoolSourceLabel }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>
      </div>

      <!-- Learn & Earn -->
      <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
        {{ $t('Learn & Earn') }}
      </div>
      <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
        <q-item clickable v-ripple @click="$router.push('/spark-success?full=true')">
          <q-item-section side>
            <Icon icon="tabler:school" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Onboarding Guide') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ $t('Learn about all BuhoGO features') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item clickable v-ripple @click="$router.push('/learn')">
          <q-item-section side>
            <Icon icon="tabler:trophy" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Bitcoin Lessons') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ $t('Learn about Bitcoin, earn real sats') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>
      </div>

      <!-- DANGER ZONE -->
      <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
        {{ $t('Danger Zone') }}
      </div>
      <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
        <q-item v-if="hasSparkWallet" clickable v-ripple @click="confirmDeleteSparkWallet">
          <q-item-section>
            <q-item-label class="danger-text text-center">
              {{ $t('Delete Spark Wallets') }}
            </q-item-label>
          </q-item-section>
        </q-item>
        <q-separator v-if="hasSparkWallet && hasNwcWallets" :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item v-if="hasNwcWallets" clickable v-ripple @click="confirmDisconnectNwc">
          <q-item-section>
            <q-item-label class="danger-text text-center">
              {{ $t('Remove NWC Connections') }}
            </q-item-label>
          </q-item-section>
        </q-item>
        <q-separator v-if="hasLnbitsWallets && (hasSparkWallet || hasNwcWallets)" :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item v-if="hasLnbitsWallets" clickable v-ripple @click="confirmDisconnectLNBits">
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
          <q-btn flat round dense v-close-popup
                 :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
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
          <q-btn flat round dense v-close-popup
                 :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
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
            <Icon icon="tabler:external-link" class="q-mr-sm" />
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
              <Icon icon="tabler:heart" class="q-mr-xs" />
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
            <Icon icon="tabler:alert-triangle" width="32" height="32" class="danger-icon" />
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
            v-close-popup
            :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
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
              <Icon
                icon="tabler:check"
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
            v-close-popup
            :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
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
            v-close-popup
            :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
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
            <Icon icon="tabler:plus" width="20" height="20" class="q-mr-sm" />
            {{ $t('Add Wallet') }}
          </q-btn>

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

            <div class="wallets-list-scroll">
              <div
                v-for="wallet in sortedWallets"
                :key="wallet.id"
                class="wallet-card-wrapper"
              >
              <div
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
                    <Icon v-else icon="tabler:wallet" width="20" height="20" style="color: white;" />
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
                      <Icon v-else icon="tabler:wallet" width="10" height="10" />
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
                    @click="reconnectWallet(wallet.id)"
                    :loading="isReconnecting[wallet.id]"
                    class="wallet-action-btn"
                    :class="$q.dark.isActive ? 'wallet-action-btn-dark' : 'wallet-action-btn-light'"
                    size="sm"
                  >
                    <Icon icon="tabler:refresh" width="16" height="16" />
                    <q-tooltip>{{ $t('Reconnect') }}</q-tooltip>
                  </q-btn>

                  <q-btn
                    v-if="wallet.id !== activeWalletId"
                    flat
                    round
                    dense
                    @click="handleSwitchWallet(wallet.id)"
                    class="wallet-action-btn"
                    :class="$q.dark.isActive ? 'wallet-action-btn-dark' : 'wallet-action-btn-light'"
                    size="sm"
                  >
                    <Icon icon="tabler:transfer" width="16" height="16" />
                    <q-tooltip>{{ $t('Switch') }}</q-tooltip>
                  </q-btn>

                  <q-btn
                    flat
                    round
                    dense
                    @click="confirmRemoveWallet(wallet.id)"
                    class="wallet-action-btn wallet-action-danger"
                    size="sm"
                  >
                    <Icon icon="tabler:trash" width="16" height="16" />
                    <q-tooltip>{{ $t('Remove') }}</q-tooltip>
                  </q-btn>
                </div>
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
            v-close-popup
            :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
        </q-card-section>

        <q-card-section class="dialog-content">
          <!-- Spark Wallet Options (only if no Spark wallet exists) -->
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
                  {{ hasAnySparkWallet ? $t('Add Spark Wallet') : $t('Create Spark Wallet') }}
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
              <Icon icon="tabler:chevron-right" width="18" height="18" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'" />
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
              <Icon icon="tabler:chevron-right" width="18" height="18" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'" />
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
            v-close-popup
            :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
        </q-card-section>

        <q-card-section class="dialog-content">
          <!--
            Animated building-blocks illustration. Self-contained SVG so
            the browser runs its CSS animations inside an <img> sandbox.
            Three layers of "replay on open" defense, because SVG-in-img
            animation restart is inconsistent across WebViews:
              1. v-if toggles off-and-on each open → Vue destroys and
                 recreates the DOM element, guaranteeing a fresh load.
              2. :key bumps → forces Vue to treat the new element as
                 brand new even when the subtree isn't otherwise
                 invalidated.
              3. ?v= URL cache-bust → forces the browser to treat the
                 SVG as a new resource with a fresh render context.
            See the `showMempoolDialog` watcher.
          -->
          <div class="mempool-hero">
            <img
              v-if="mempoolHeroMounted"
              :key="mempoolAnimationKey"
              :src="`/Onboarding wizard spark/building-blocks-animated.svg?v=${mempoolAnimationKey}`"
              class="mempool-hero-img"
              alt=""
              aria-hidden="true"
            />
          </div>

          <!-- Plain-language intro. "BuhoGO" is rendered as a brand
               span so the green accent survives translations. -->
          <p class="mempool-intro-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            <span class="buhogo-brand">BuhoGO</span>
            {{ $t('uses a public Bitcoin server to show live prices. Pick which one to use.') }}
          </p>

          <!-- Source picker. Single radio-style list; the custom input
               appears inline exactly when "Your own server" is selected,
               so there's no extra click to reveal or hide it. -->
          <div class="source-list" :class="$q.dark.isActive ? 'source-list-dark' : 'source-list-light'">
            <!-- Default -->
            <button
              type="button"
              class="source-row"
              :class="{ 'source-row-selected': mempoolSelectedSource === 'default' }"
              @click="selectMempoolSource('default')"
            >
              <span class="source-radio" aria-hidden="true">
                <span class="source-radio-dot" />
              </span>
              <span class="source-body">
                <span class="source-head">
                  <span class="source-name">mempool.space</span>
                  <span class="source-tag tag-default">{{ $t('Default') }}</span>
                </span>
                <span class="source-desc">{{ $t('Works for everyone') }}</span>
              </span>
            </button>

            <div class="source-separator" role="presentation"></div>

            <!-- Blocktrainer -->
            <button
              type="button"
              class="source-row"
              :class="{ 'source-row-selected': mempoolSelectedSource === 'blocktrainer' }"
              @click="selectMempoolSource('blocktrainer')"
            >
              <span class="source-radio" aria-hidden="true">
                <span class="source-radio-dot" />
              </span>
              <span class="source-body">
                <span class="source-head">
                  <span class="source-name">Blocktrainer</span>
                  <span class="source-tag tag-community">{{ $t('Community') }}</span>
                </span>
                <span class="source-desc">{{ $t('Community-run, based in Germany') }}</span>
              </span>
            </button>

            <div class="source-separator" role="presentation"></div>

            <!-- Your own server (custom) -->
            <button
              type="button"
              class="source-row"
              :class="{ 'source-row-selected': mempoolSelectedSource === 'custom' }"
              @click="selectMempoolSource('custom')"
            >
              <span class="source-radio" aria-hidden="true">
                <span class="source-radio-dot" />
              </span>
              <span class="source-body">
                <span class="source-head">
                  <span class="source-name">{{ $t('Your own server') }}</span>
                  <span class="source-tag tag-advanced">{{ $t('Advanced') }}</span>
                </span>
                <span class="source-desc">{{ $t('Point BuhoGO at a Mempool server you host or trust') }}</span>
              </span>
            </button>

            <!-- Inline custom input, part of the same list. Only rendered
                 when the custom row is the active selection. -->
            <div v-if="mempoolSelectedSource === 'custom'" class="source-custom">
              <q-input
                ref="mempoolCustomInput"
                v-model="mempoolCustomDraft"
                :placeholder="$t('https://your-mempool.example.com/api/v1')"
                class="source-custom-input"
                :class="$q.dark.isActive ? 'source-custom-input-dark' : 'source-custom-input-light'"
                borderless
                input-class="q-px-md source-custom-input-inner"
                dense
                clearable
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                :error="!!customUrlErrorMessage"
                :error-message="customUrlErrorMessage"
                hide-bottom-space
              />
              <p class="source-custom-help" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                <Icon icon="tabler:info-circle" width="14" height="14" class="source-custom-help-icon" />
                {{ $t('Must start with https:// and end with /api/v1') }}
              </p>
            </div>
          </div>

        </q-card-section>

        <q-card-actions align="right" class="dialog-actions">
          <q-btn
            flat
            :label="$t('Use default')"
            @click="resetMempoolUrl"
            no-caps
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          />
          <q-btn
            flat
            :label="$t('Save')"
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

    <!-- Spark recovery phrase (unified view + backup flow) -->
    <SparkSeedPhraseDialog
      v-model="showSeedPhraseDialog"
      :mode="seedPhraseMode"
      @verified="onSeedPhraseVerified"
    />

    <!-- App Lock enable: explain what happens before the native prompt -->
    <BiometricEnableDialog
      v-model="showBiometricEnableDialog"
      :biometry-type="pendingBiometryType"
      @confirmed="onBiometricEnableConfirmed"
    />


    <!-- Auto-Transfer Wallet List Dialog -->
    <q-dialog v-model="showAutoTransferDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="wallets-dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header wallets-dialog-header">
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Auto-Transfer') }}
          </div>
          <q-btn flat round dense v-close-popup :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </q-btn>
        </q-card-section>

        <q-card-section class="wallets-dialog-content">
          <!-- Empty state -->
          <div v-if="wallets.length === 0" class="aw-empty-state" :class="$q.dark.isActive ? 'aw-empty-dark' : 'aw-empty-light'">
            <img
              src="/Onboarding wizard spark/storyset-transfer-money-bro.svg"
              class="aw-empty-illustration"
              alt=""
              aria-hidden="true"
            />
            <div class="aw-empty-text">{{ $t('Connect a wallet to set up automatic transfers') }}</div>
          </div>

          <!-- Wallet list -->
          <div v-else class="aw-dialog-list">
            <div
              v-for="entry in awWalletEntries"
              :key="'awd-' + entry.configKey"
              class="aw-dialog-item"
              :class="$q.dark.isActive ? 'aw-dialog-item-dark' : 'aw-dialog-item-light'"
              @click="openAutoWithdrawFromDialog(entry.wallet, entry.configKey, entry.name)"
            >
              <div class="aw-wallet-avatar" :class="'aw-avatar-' + (entry.type || 'nwc')">
                <!-- Spark -->
                <svg v-if="entry.type === 'spark'" width="16" height="15" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="white"/>
                </svg>
                <!-- NWC -->
                <svg v-else-if="entry.type === 'nwc'" width="16" height="16" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646-2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="white"/>
                  <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="white"/>
                </svg>
                <!-- LNBits -->
                <svg v-else-if="entry.type === 'lnbits'" width="14" height="16" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="white"/>
                </svg>
                <Icon v-else icon="tabler:wallet" width="16" height="16" style="color: white;" />
              </div>
              <div class="aw-dialog-item-info">
                <div class="aw-dialog-item-name" :class="$q.dark.isActive ? 'aw-name-dark' : 'aw-name-light'">
                  {{ entry.name }}
                </div>
                <div v-if="getAutoWithdrawConfig(entry.configKey)?.enabled" class="aw-dialog-item-summary" :class="$q.dark.isActive ? 'aw-summary-dark' : 'aw-summary-light'">
                  {{ Number(getAutoWithdrawConfig(entry.configKey).thresholdSats).toLocaleString() }} {{ $t('sats') }} &rarr; {{ truncateAutoWithdrawDest(entry.configKey) }}
                </div>
              </div>
              <div class="aw-dialog-item-right">
                <span
                  class="aw-status-pill"
                  :class="getAutoWithdrawConfig(entry.configKey)?.enabled ? 'aw-pill-active' : 'aw-pill-inactive'"
                >
                  {{ getAutoWithdrawConfig(entry.configKey)?.enabled ? $t('Active') : $t('Off') }}
                </span>
                <Icon icon="tabler:chevron-right" width="16" height="16" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
              </div>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Auto-Withdraw Config Dialog -->
    <q-dialog v-model="showAutoWithdrawDialog" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="aw-config-dialog" :class="$q.dark.isActive ? 'dialog_card_dark' : 'dialog_card_light'">
        <!-- Header -->
        <q-card-section class="aw-dialog-header">
          <div class="aw-dialog-icon-wrap" :class="'aw-icon-wrap-' + (awConfigWallet?.type || 'nwc')">
            <Icon icon="tabler:send" width="28" height="28" />
          </div>
          <div class="aw-dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Auto-Transfer') }}
          </div>
          <div class="aw-dialog-entry-name" :class="$q.dark.isActive ? 'aw-subtitle-dark' : 'aw-subtitle-light'">
            {{ awConfigEntryName }}
          </div>
          <div class="aw-dialog-subtitle" :class="$q.dark.isActive ? 'aw-subtitle-dark' : 'aw-subtitle-light'">
            {{ $t('Move funds automatically when your balance grows past a threshold') }}
          </div>
        </q-card-section>

        <q-card-section class="aw-dialog-body">
          <!-- Enable toggle -->
          <div class="aw-toggle-row" :class="$q.dark.isActive ? 'aw-toggle-dark' : 'aw-toggle-light'">
            <div class="aw-toggle-label">
              <span class="aw-toggle-text" :class="$q.dark.isActive ? 'aw-name-dark' : 'aw-name-light'">
                {{ awConfigForm.enabled ? $t('Active') : $t('Inactive') }}
              </span>
            </div>
            <q-toggle
              v-model="awConfigForm.enabled"
              :color="awToggleColor"
            />
          </div>

          <!-- Threshold -->
          <div class="aw-field-group">
            <div class="aw-field-label" :class="$q.dark.isActive ? 'aw-label-dark' : 'aw-label-light'">
              {{ $t('Threshold') }}
            </div>
            <q-input
              v-model.number="awConfigForm.thresholdSats"
              type="number"
              :placeholder="$t('Amount in sats')"
              borderless
              dense
              class="aw-input"
              :class="$q.dark.isActive ? 'aw-input-dark' : 'aw-input-light'"
              :disable="!awConfigForm.enabled"
            >
              <template v-slot:append>
                <span class="aw-input-suffix" :class="$q.dark.isActive ? 'aw-suffix-dark' : 'aw-suffix-light'">sats</span>
              </template>
            </q-input>
            <div v-if="awConfigForm.thresholdSats > 0 && exchangeRates[preferredFiatCurrency]" class="aw-fiat-hint" :class="$q.dark.isActive ? 'aw-hint-dark' : 'aw-hint-light'">
              &asymp; {{ formatFiatValue(awConfigForm.thresholdSats) }} {{ preferredFiatCurrency }}
            </div>
          </div>

          <!-- Payout type (Spark only — 3 options) -->
          <div v-if="awConfigWallet?.type === 'spark'" class="aw-field-group">
            <div class="aw-field-label" :class="$q.dark.isActive ? 'aw-label-dark' : 'aw-label-light'">
              {{ $t('Transfer via') }}
            </div>
            <div class="aw-payout-pills">
              <div
                class="aw-pill-option"
                :class="[
                  awConfigForm.payoutType === 'spark' ? 'aw-pill-selected aw-pill-sel-spark' : '',
                  $q.dark.isActive ? 'aw-pill-dark' : 'aw-pill-light',
                  !awConfigForm.enabled ? 'aw-pill-disabled' : ''
                ]"
                @click="awConfigForm.enabled && (awConfigForm.payoutType = 'spark')"
              >
                <svg width="14" height="13" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="currentColor"/>
                </svg>
                {{ $t('Spark') }}
              </div>
              <div
                class="aw-pill-option"
                :class="[
                  awConfigForm.payoutType === 'lightning' ? 'aw-pill-selected aw-pill-sel-spark' : '',
                  $q.dark.isActive ? 'aw-pill-dark' : 'aw-pill-light',
                  !awConfigForm.enabled ? 'aw-pill-disabled' : ''
                ]"
                @click="awConfigForm.enabled && (awConfigForm.payoutType = 'lightning')"
              >
                <Icon icon="tabler:bolt" width="16" height="16" />
                {{ $t('Lightning') }}
              </div>
              <div
                class="aw-pill-option"
                :class="[
                  awConfigForm.payoutType === 'onchain' ? 'aw-pill-selected aw-pill-sel-spark' : '',
                  $q.dark.isActive ? 'aw-pill-dark' : 'aw-pill-light',
                  !awConfigForm.enabled ? 'aw-pill-disabled' : ''
                ]"
                @click="awConfigForm.enabled && (awConfigForm.payoutType = 'onchain')"
              >
                <Icon icon="tabler:link" width="16" height="16" />
                {{ $t('On-chain') }}
              </div>
            </div>
            <!-- Zero-fee hint for Spark -->
            <div v-if="awConfigForm.payoutType === 'spark'" class="aw-spark-hint" :class="$q.dark.isActive ? 'aw-hint-dark' : 'aw-hint-light'">
              <Icon icon="tabler:discount-check" width="14" height="14" />
              {{ $t('Spark transfers are instant and free') }}
            </div>
          </div>

          <!-- Destination -->
          <div class="aw-field-group">
            <div class="aw-field-label" :class="$q.dark.isActive ? 'aw-label-dark' : 'aw-label-light'">
              {{ awDestinationLabel }}
            </div>
            <q-input
              v-if="awConfigForm.payoutType === 'spark' && awConfigWallet?.type === 'spark'"
              v-model="awConfigForm.sparkAddress"
              :placeholder="$t('spark1...')"
              borderless
              dense
              class="aw-input"
              :class="$q.dark.isActive ? 'aw-input-dark' : 'aw-input-light'"
              :disable="!awConfigForm.enabled"
            />
            <q-input
              v-else-if="awConfigForm.payoutType === 'onchain' && awConfigWallet?.type === 'spark'"
              v-model="awConfigForm.bitcoinAddress"
              :placeholder="$t('bc1q...')"
              borderless
              dense
              class="aw-input"
              :class="$q.dark.isActive ? 'aw-input-dark' : 'aw-input-light'"
              :disable="!awConfigForm.enabled"
            />
            <q-input
              v-else
              v-model="awConfigForm.lightningAddress"
              :placeholder="$t('user@example.com')"
              borderless
              dense
              class="aw-input"
              :class="$q.dark.isActive ? 'aw-input-dark' : 'aw-input-light'"
              :disable="!awConfigForm.enabled"
            />
          </div>

          <!-- Fee speed (on-chain only) -->
          <div v-if="awConfigForm.payoutType === 'onchain' && awConfigWallet?.type === 'spark'" class="aw-field-group">
            <div class="aw-field-label" :class="$q.dark.isActive ? 'aw-label-dark' : 'aw-label-light'">
              {{ $t('Network fee') }}
            </div>
            <div class="aw-fee-cards">
              <div
                v-for="speed in feeSpeedOptions"
                :key="speed.value"
                class="aw-fee-card"
                :class="[
                  awConfigForm.feeSpeed === speed.value ? 'aw-fee-selected aw-fee-sel-' + (awConfigWallet?.type || 'nwc') : '',
                  $q.dark.isActive ? 'aw-fee-dark' : 'aw-fee-light',
                  !awConfigForm.enabled ? 'aw-pill-disabled' : ''
                ]"
                @click="awConfigForm.enabled && (awConfigForm.feeSpeed = speed.value)"
              >
                <Icon :icon="speed.icon" width="18" height="18" />
                <div class="aw-fee-label">{{ speed.label }}</div>
                <div class="aw-fee-desc" :class="$q.dark.isActive ? 'aw-hint-dark' : 'aw-hint-light'">{{ speed.desc }}</div>
              </div>
            </div>
          </div>

          <!-- Last transfer info -->
          <div v-if="awConfigLastTriggered" class="aw-last-transfer" :class="$q.dark.isActive ? 'aw-hint-dark' : 'aw-hint-light'">
            <Icon icon="tabler:clock" width="14" height="14" />
            {{ $t('Last transfer') }}: {{ awConfigLastTriggered }}
          </div>
        </q-card-section>

        <!-- Actions -->
        <q-card-actions class="aw-dialog-actions">
          <q-btn
            flat
            :label="$t('Save')"
            @click="saveAutoWithdrawConfig"
            :disable="!isAutoWithdrawConfigValid"
            class="aw-save-btn"
            :class="'aw-save-' + (awConfigWallet?.type || 'nwc')"
            no-caps
          />
          <q-btn
            v-if="getAutoWithdrawConfig(awConfigWalletId)"
            flat
            :label="$t('Remove rule')"
            @click="removeAutoWithdrawConfig"
            class="aw-remove-btn"
            no-caps
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import {useWalletStore} from '../stores/wallet'
import {useAutoWithdrawStore} from '../stores/autoWithdraw'
import {mapState, mapActions} from 'pinia'
import {fiatRatesService} from '../utils/fiatRates.js'
import {formatAmount} from '../utils/amountFormatting.js'
import {shareContent} from '../utils/share.js'
import { isBiometricAvailable } from '../utils/biometric.js'
import {truncateAddress} from '../utils/addressUtils.js'
import VueQrcode from '@chenfengyuan/vue-qrcode'
import KioskPinPad from '../components/KioskPinPad.vue'
import SparkSeedPhraseDialog from '../components/SparkSeedPhraseDialog.vue'
import BiometricEnableDialog from '../components/BiometricEnableDialog.vue'
// Alternative lightweight verification (type 3 random words). Kept out
// of the flow intentionally — the order-tap check is stronger. Retained
// here for future reuse.
// import MnemonicVerify from '../components/MnemonicVerify.vue'
import { version } from '../../package.json'

// Preset Mempool servers offered in the exchange-rate source picker.
// Kept at module scope so they are referenced via computed getters in
// the template without being reactive (they never change per instance).
// Any URL that is not one of these presets is treated as "custom" and
// the custom-server panel is auto-expanded on dialog open.
const MEMPOOL_DEFAULT_URL = 'https://mempool.space/api/v1';
const MEMPOOL_BLOCKTRAINER_URL = 'https://mempool.blocktrainer.de/api/v1';
const MEMPOOL_PRESET_URLS = [MEMPOOL_DEFAULT_URL, MEMPOOL_BLOCKTRAINER_URL];

export default {
  name: 'SettingsPage',
  components: {
    VueQrcode,
    SparkSeedPhraseDialog,
    BiometricEnableDialog,
    KioskPinPad,
    // MnemonicDisplay and MnemonicOrderVerify are used inside
    // SparkSeedPhraseDialog; they are not needed at this level.
    // The 3-random-words variant (MnemonicVerify) is retained as a
    // commented-out alternative — see SparkSeedPhraseDialog's import.
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

      // Mempool API settings.
      //
      // The dialog edits state through two explicit data fields:
      //   * `mempoolSelectedSource` — which radio row is active. This is
      //     stored as the source of truth so "custom with empty draft"
      //     still reads as 'custom' in the UI rather than collapsing
      //     back to default (as a URL-derived computed would).
      //   * `mempoolCustomDraft` — the text in the custom URL input.
      //     Preserved across selection switches so quickly tapping a
      //     preset to compare doesn't discard the user's typing.
      //
      // `customMempoolUrl` remains the persisted, committed value from
      // the store; the other two are scratch space used only while the
      // dialog is open.
      customMempoolUrl: null,
      mempoolSelectedSource: 'default', // 'default' | 'blocktrainer' | 'custom'
      mempoolCustomDraft: '',
      isTestingUrl: false,
      // Bumps on every dialog open so the animated SVG replays its
      // internal CSS animations. The key drives both a Vue :key and a
      // URL query-string on the <img> for cache-busting.
      mempoolAnimationKey: 0,
      // Toggled off-then-on around each open so Vue fully unmounts and
      // remounts the <img> element. Belt-and-braces: some WebView
      // builds keep SVG animation state across `:key` changes when the
      // parent q-dialog doesn't fully tear down the subtree, so we
      // force a real DOM destroy with v-if. Paired with the key + URL
      // bust, this makes replay reliable on Chromium and WebKit.
      mempoolHeroMounted: true,

      // Language options
      localeOptions: [
        { value: 'en-US', label: 'English' },
        { value: 'de', label: 'Deutsch' },
        { value: 'es', label: 'Español' }
      ],

      // Spark wallet settings
      showSparkSettingsDialog: false,

      // Unified seed-phrase dialog (view + backup flows)
      showSeedPhraseDialog: false,
      seedPhraseMode: 'view', // 'view' | 'backup'

      // Spark reconnect dialog
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

      // Biometrics / App Lock
      biometricsEnabled: false,
      biometricsAvailable: false,
      biometryType: 'none', // 'fingerprint', 'face', 'device-pin', 'multiple', 'none'

      // Enable-flow explanation dialog state
      showBiometricEnableDialog: false,
      pendingBiometryType: 'none',

      // Wallet removal
      walletToRemove: null,

      // Kiosk Mode
      showKioskPinSetupDialog: false,
      showKioskChangePinDialog: false,
      showKioskDisableDialog: false,
      showKioskWalletPicker: false,
      kioskPinSetupStep: 'intro', // 'intro' | 'enter' | 'confirm'
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

      // Auto-transfer
      showAutoTransferDialog: false,
      showAutoWithdrawDialog: false,
      awConfigWalletId: null,
      awConfigWallet: null,
      awConfigEntryName: '',
      awConfigForm: {
        enabled: false,
        thresholdSats: 0,
        payoutType: 'lightning',
        lightningAddress: '',
        bitcoinAddress: '',
        sparkAddress: '',
        feeSpeed: 'medium',
      },
      feeSpeedOptions: [
        { value: 'low', label: 'Economy', desc: '~1 hour', icon: 'tabler:leaf' },
        { value: 'medium', label: 'Standard', desc: '~30 min', icon: 'tabler:scale' },
        { value: 'high', label: 'Priority', desc: 'Next block', icon: 'tabler:rocket' },
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
      'defaultDisplayCurrency',
      'exchangeRates',
      'hasSparkWallet',
      'hasAnySparkWallet',
      'sparkWallet',
      'sparkWallets',
      'isActiveWalletSpark',
      'activeSparkAddress',
      'useBip177Format',
      'hasBackedUp',
      'sparkBusinessWallet',
      'sparkPersonalWallet',
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

    kioskSelectedWalletName() {
      if (!this.walletStore.kioskWalletId) return '';
      const w = this.wallets.find(w => w.id === this.walletStore.kioskWalletId);
      return w ? w.name : '';
    },

    nwcWalletAlias() {
      if (!this.activeWallet || this.activeWallet.type !== 'nwc') return null;
      const alias = this.activeWallet.metadata?.alias
        || this.walletInfos[this.activeWalletId]?.alias
        || null;
      // Don't show "Unknown" — it's just noise
      if (!alias || alias === 'Unknown') return null;
      return alias;
    },

    nwcSupportedMethods() {
      if (!this.activeWallet || this.activeWallet.type !== 'nwc') return [];
      const methods = this.activeWallet.metadata?.methods
        || this.walletInfos[this.activeWalletId]?.methods
        || [];
      // Map both snake_case (NWC spec) and camelCase (Alby SDK) to user-friendly labels
      const friendlyNames = {
        'pay_invoice': 'Send',
        'make_invoice': 'Receive',
        'get_balance': 'Balance',
        'lookup_invoice': 'Lookup',
        'list_transactions': 'History',
        'get_info': 'Info',
        'multi_pay_invoice': 'Multi-pay',
        // camelCase variants (Alby SDK format)
        'payInvoice': 'Send',
        'sendPayment': 'Send',
        'payKeysend': 'Keysend',
        'makeInvoice': 'Receive',
        'getBalance': 'Balance',
        'lookupInvoice': 'Lookup',
        'listTransactions': 'History',
        'getInfo': 'Info',
        'multiPayInvoice': 'Multi-pay',
      };
      // Deduplicate friendly names (e.g. payInvoice + sendPayment both → "Send")
      const seen = new Set();
      return methods
        .map(m => friendlyNames[m] || m)
        .filter(label => {
          if (seen.has(label)) return false;
          seen.add(label);
          return true;
        })
        .slice(0, 6);
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

    activeSparkWalletName() {
      return this.sparkWallet?.name || 'Spark Wallet';
    },

    activeSparkBackedUp() {
      return this.sparkWallet?.metadata?.hasBackedUp ?? this.hasBackedUp;
    },

    biometryIcon() {
      switch (this.biometryType) {
        case 'face': return 'tabler:face-id'
        case 'fingerprint': return 'tabler:fingerprint'
        case 'device-pin': return 'tabler:lock'
        default: return 'tabler:fingerprint'
      }
    },

    biometryDescription() {
      if (!this.biometricsAvailable) {
        return this.$t('No screen lock set on this device')
      }
      switch (this.biometryType) {
        case 'face': return this.$t('Use Face ID to unlock')
        case 'fingerprint': return this.$t('Use fingerprint to unlock')
        case 'device-pin': return this.$t('Use device PIN to unlock')
        case 'multiple': return this.$t('Use biometrics or PIN to unlock')
        default: return this.$t('Use device lock to unlock')
      }
    },

    hasNwcWallets() {
      return this.wallets.some(w => w.type === 'nwc');
    },
    hasLnbitsWallets() {
      return this.wallets.some(w => w.type === 'lnbits');
    },
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

    /**
     * Whether the current edit is ready to save. Presets are always
     * valid. For custom: an empty draft is treated as "use default" and
     * allowed; a non-empty draft must parse as an http(s) URL.
     */
    isMempoolUrlValid() {
      if (this.mempoolSelectedSource !== 'custom') return true;
      const url = (this.mempoolCustomDraft || '').trim();
      if (!url) return true;
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
      } catch {
        return false;
      }
    },

    /**
     * The URL that `saveMempoolUrl` will persist, before normalization.
     * Returns null for "use the built-in default" so the Settings row
     * caption reads accurately afterwards.
     */
    mempoolEffectiveUrl() {
      switch (this.mempoolSelectedSource) {
        case 'blocktrainer':
          return MEMPOOL_BLOCKTRAINER_URL;
        case 'custom': {
          const url = (this.mempoolCustomDraft || '').trim();
          return url === MEMPOOL_DEFAULT_URL || !url ? null : url;
        }
        case 'default':
        default:
          return null;
      }
    },

    // Expose the module-scope preset URLs to the template. Returning the
    // same reference each render keeps reactivity cheap.
    MEMPOOL_DEFAULT_URL() {
      return MEMPOOL_DEFAULT_URL;
    },

    MEMPOOL_BLOCKTRAINER_URL() {
      return MEMPOOL_BLOCKTRAINER_URL;
    },

    /**
     * Inline error shown below the custom-URL input. Returns an empty
     * string (falsy) when the URL is valid or the field is empty.
     * Keeping the validation message inline here rather than in a
     * separate notify makes the constraint feel like part of the form,
     * not a jarring after-the-fact alert.
     */
    customUrlErrorMessage() {
      if (this.mempoolSelectedSource !== 'custom') return '';
      const url = (this.mempoolCustomDraft || '').trim();
      if (!url) return ''; // empty is allowed while the user is still typing
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return this.$t('Must start with https:// (or http://)');
        }
      } catch {
        return this.$t('That does not look like a valid address');
      }
      return '';
    },

    // Plain-language label for the Settings-row caption. Picks the
    // friendly name of a known preset when applicable, otherwise falls
    // back to "Custom" for a user-supplied URL.
    mempoolSourceLabel() {
      const saved = this.customMempoolUrl;
      if (!saved || saved === MEMPOOL_DEFAULT_URL) {
        return this.$t('Default (mempool.space)');
      }
      if (saved === MEMPOOL_BLOCKTRAINER_URL) {
        return this.$t('Blocktrainer');
      }
      return this.$t('Custom server');
    },

    appVersion() {
      return version;
    },

    // Expand wallets into auto-transfer entries
    awWalletEntries() {
      const entries = [];
      for (const wallet of this.wallets) {
        entries.push({
          configKey: wallet.id,
          wallet,
          account: null,
          name: wallet.name,
          parentName: null,
          isPocket: false,
          type: wallet.type,
        });
      }
      return entries;
    },

    awActiveCount() {
      return this.awWalletEntries.filter(
        entry => this.getAutoWithdrawConfig(entry.configKey)?.enabled
      ).length;
    },

    awToggleColor() {
      const type = this.awConfigWallet?.type;
      if (type === 'spark') return 'grey-8';
      if (type === 'lnbits') return 'pink-5';
      return 'amber-7'; // nwc
    },

    awDestinationLabel() {
      if (this.awConfigWallet?.type === 'spark') {
        if (this.awConfigForm.payoutType === 'spark') return this.$t('Spark address');
        if (this.awConfigForm.payoutType === 'onchain') return this.$t('Bitcoin address');
      }
      return this.$t('Lightning address');
    },

    isAutoWithdrawConfigValid() {
      if (!this.awConfigForm.enabled) return true; // Can save disabled config
      if (!this.awConfigForm.thresholdSats || this.awConfigForm.thresholdSats <= 0) return false;
      if (this.awConfigForm.payoutType === 'spark' && this.awConfigWallet?.type === 'spark') {
        return !!this.awConfigForm.sparkAddress?.trim();
      }
      if (this.awConfigForm.payoutType === 'onchain' && this.awConfigWallet?.type === 'spark') {
        return !!this.awConfigForm.bitcoinAddress.trim();
      }
      return !!this.awConfigForm.lightningAddress.trim();
    },

    awConfigLastTriggered() {
      const config = this.getAutoWithdrawConfig(this.awConfigWalletId);
      if (!config?.lastTriggeredAt) return null;
      const d = new Date(config.lastTriggeredAt);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  },
  watch: {
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
     * Whenever the exchange-rate-source dialog opens, rehydrate the
     * editing state from whatever is currently saved. Covers the
     * "cancel without saving" case (don't leak stale edits) and the
     * "legacy URL" case (user with a saved emzy.de URL sees the custom
     * row selected and their URL in the input, ready to keep using).
     * Also replays the building-blocks animation by briefly unmounting
     * and re-inserting the hero image (see the comment on the template).
     */
    showMempoolDialog(isOpen) {
      if (!isOpen) return;
      this.resetMempoolEditorFromSavedUrl();
      // Unmount → bump → remount in the next tick. This guarantees
      // Vue destroys the <img> DOM node and creates a fresh one, which
      // (combined with the URL cache-bust) triggers a brand-new SVG
      // load with its internal animations at frame 0.
      this.mempoolHeroMounted = false;
      this.mempoolAnimationKey += 1;
      this.$nextTick(() => {
        this.mempoolHeroMounted = true;
      });
    },
  },

  created() {
    this.initializeStore();
    this.loadPinState();
    this.checkNotificationPermission();
    this.loadMempoolSettings();
    this.loadLanguagePreference();
    this.checkBiometricAvailability();
  },

  mounted() {
    // Refresh exchange rates every 5 minutes
    this.exchangeRateInterval = setInterval(() => {
      this.loadExchangeRates();
    }, 300000); // 5 minutes

    // Handle deep link from backup banner
    if (this.$route.query.section === 'backup' && this.hasSparkWallet) {
      this.$nextTick(() => this.openBackupDialog());
    }

    // Handle deep link from wallet switcher "Manage Wallets" button
    if (this.$route.query.section === 'wallets') {
      this.$nextTick(() => { this.showWalletsDialog = true; });
    }
  },

  beforeUnmount() {
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
      'connectSparkWallet',
      'updateBip177Preference',
      'confirmBackup',
      'updateBiometricsEnabled',
    ]),

    async initializeStore() {
      await this.initialize()
    },

    // ─── Kiosk Mode ───────────────────────────────────

    handleKioskToggle(val) {
      if (val) {
        this.showKioskPinSetupDialog = true;
      } else {
        this.showKioskDisableDialog = true;
      }
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

    confirmKioskWalletSelection() {
      this.walletStore.setKioskWallet(this.kioskWalletSelection);
      this.showKioskWalletPicker = false;
    },

    updateKioskTipValue(idx, val) {
      const arr = [...this.walletStore.kioskTipValues];
      arr[idx] = parseInt(val) || 0;
      this.walletStore.setKioskTipValues(arr);
    },

    async handleStartKiosk() {
      if (!this.walletStore.kioskWalletId) {
        this.$q.notify({ message: this.$t('kiosk.noWalletSelected'), color: 'warning' });
        return;
      }
      this.kioskActivating = true;
      try {
        await this.walletStore.activateKioskMode();
        this.$router.push('/kiosk');
      } catch (err) {
        this.$q.notify({ message: err.message || 'Activation failed', color: 'negative' });
      } finally {
        this.kioskActivating = false;
      }
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

    setDisplayCurrency(value) {
      this.walletStore.defaultDisplayCurrency = value;
      this.walletStore.persistState();
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

        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Connection failed'),
          caption: this.$t('Please check your connection and try again'),

        })
      } finally {
        this.isAddingWallet = false
      }
    },

    async reconnectWallet(walletId) {
      if (this.isReconnecting[walletId]) return

      this.isReconnecting[walletId] = true

      try {
        const wallet = this.wallets.find(w => w.id === walletId)
        if (wallet?.type === 'spark') {
          await this.connectSparkWallet(walletId)
        } else {
          await this.connectWallet(walletId)
        }
        this.$q.notify({
          type: 'positive',
          message: this.$t('Reconnected'),
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Reconnection failed'),
          caption: this.$t('Please try again'),
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
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t switch wallet'),
          caption: this.$t('Please try again'),

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

          });
          this.showDangerConfirmDialog = false;
        } else if (this.dangerConfirmAction === 'disconnectLNBits') {
          await this.disconnectLNBitsWallets();
          this.$q.notify({
            type: 'positive',
            message: this.$t('LNBits connections removed'),

          });
          this.showDangerConfirmDialog = false;
        } else if (this.dangerConfirmAction === 'deleteSparkWallet') {
          // removeWallet handles the entire wallet group, so one call is enough
          const firstSpark = this.sparkWallets[0];
          if (firstSpark) {
            await this.removeWallet(firstSpark.id);
          }
          this.$q.notify({
            type: 'positive',
            message: this.$t('Spark wallets deleted'),
          });
          this.showDangerConfirmDialog = false;
        } else if (this.dangerConfirmAction === 'removeWallet') {
          await this.removeWallet(this.walletToRemove.id);
          this.$q.notify({
            type: 'positive',
            message: this.$t('Wallet removed'),

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
      this.resetMempoolEditorFromSavedUrl();
    },

    /**
     * Map the persisted `customMempoolUrl` back into the dialog's
     * editing state (source + custom draft). Called on component load
     * and every time the dialog opens. Centralised so the "saved URL →
     * editor state" mapping lives in exactly one function.
     */
    resetMempoolEditorFromSavedUrl() {
      const saved = this.customMempoolUrl;
      if (!saved || saved === MEMPOOL_DEFAULT_URL) {
        this.mempoolSelectedSource = 'default';
        this.mempoolCustomDraft = '';
      } else if (saved === MEMPOOL_BLOCKTRAINER_URL) {
        this.mempoolSelectedSource = 'blocktrainer';
        this.mempoolCustomDraft = '';
      } else {
        // Anything else, including legacy emzy.de URLs that predate the
        // preset cull, lands on the custom row with the URL preserved
        // so the user can keep using it or switch to a preset.
        this.mempoolSelectedSource = 'custom';
        this.mempoolCustomDraft = saved;
      }
    },

    /**
     * "Use default" button: revert the editor to the built-in default.
     * The custom draft is cleared so it doesn't linger silently and
     * surprise the user next time they expand the custom row.
     */
    resetMempoolUrl() {
      this.mempoolSelectedSource = 'default';
      this.mempoolCustomDraft = '';
    },

    /**
     * Change which exchange-rate source is selected. When switching to
     * 'custom', focus the input so the user can start typing without a
     * second tap. Idempotent: re-selecting the active source is a no-op.
     */
    selectMempoolSource(source) {
      if (this.mempoolSelectedSource === source) return;
      this.mempoolSelectedSource = source;
      if (source === 'custom') {
        this.$nextTick(() => {
          const ref = this.$refs.mempoolCustomInput;
          if (ref && typeof ref.focus === 'function') ref.focus();
        });
      }
    },

    async saveMempoolUrl() {
      this.isTestingUrl = true;

      try {
        // The computed already normalizes default preset and empty
        // custom draft to null so the Settings row caption reflects
        // "Default (mempool.space)" when that's effectively what's in
        // use (rather than "Custom server").
        const urlToTest = this.mempoolEffectiveUrl;

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

        // Force refresh rates so the app starts using the new source
        // immediately instead of waiting for the next periodic tick.
        await fiatRatesService.fetchLatestRates();

        this.showMempoolDialog = false;

        // Confirmation toast names the new source so the user can see
        // exactly what changed. The label is computed off the just-
        // updated `customMempoolUrl`, so it stays accurate for presets
        // and custom URLs alike. Concatenated rather than interpolated
        // because vue-i18n returns missing keys verbatim without
        // running interpolation on the fallback.
        this.$q.notify({
          type: 'positive',
          message: this.$t('Exchange rate source updated'),
          caption: `${this.$t('Now using')} ${this.mempoolSourceLabel}`,
          timeout: 2000,
        });

      } catch (error) {
        console.error('Error testing Mempool URL:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('API connection failed'),
          caption: this.$t('Please check the URL and try again'),

        });
      } finally {
        this.isTestingUrl = false;
      }
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
      return wallet.type === 'spark' ? 'tabler:bolt' : 'tabler:link';
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

    async copySparkAddress() {
      await this.copyToClipboard(this.activeSparkAddress, this.$t('Spark address copied'));
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

    // ==========================================
    // Recovery phrase (unified view + backup flow)
    // ==========================================

    /**
     * Open the recovery-phrase dialog. The dialog handles re-auth
     * (biometric / device PIN on native, skipped on web), phrase
     * reveal with 120s auto-hide and screenshot protection, and,
     * in backup mode, the tap-12-words-in-order verification.
     *
     * @param {'view'|'backup'} mode
     */
    openSeedPhraseDialog(mode) {
      this.seedPhraseMode = mode;
      this.showSeedPhraseDialog = true;
    },

    onSeedPhraseVerified() {
      // Backup flow succeeded — the dialog has already flagged the
      // wallet as backed up via the store, closed itself, and emitted.
      // Nothing else to do here; the Settings row re-renders via the
      // `activeSparkBackedUp` computed.
    },

    confirmDeleteSparkWallet() {
      if (!this.sparkWallets.length) return;

      const count = this.sparkWallets.length;
      this.dangerConfirmTitle = this.$t('Delete Spark Wallets');
      this.dangerConfirmMessage = count > 1
        ? this.$t('This will permanently delete all {count} Spark wallets. Make sure you have backed up your seed phrases. This action cannot be undone.', { count })
        : this.$t('This will permanently delete your Spark wallet. Make sure you have backed up your seed phrase. This action cannot be undone.');
      this.dangerConfirmPhrase = 'I understand';
      this.dangerConfirmButtonText = this.$t('Delete');
      this.dangerConfirmInput = '';
      this.dangerConfirmAction = 'deleteSparkWallet';
      this.showDangerConfirmDialog = true;
    },

    // ==========================================
    // Sub-Wallets
    // ==========================================

    async handleSwitchSparkWallet(walletId) {
      if (!walletId || walletId === this.activeWalletId || this.walletSwitching) return;
      try {
        await this.switchActiveWallet(walletId);
        const wallet = this.wallets.find(w => w.id === walletId);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Switched to {name}', { name: wallet?.name }),
        });
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to switch wallet'),
        });
      }
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
    },

    // Auto-withdraw methods
    getAutoWithdrawConfig(walletId) {
      if (!walletId) return null;
      const store = useAutoWithdrawStore();
      return store.getConfig(walletId);
    },

    truncateAutoWithdrawDest(walletId) {
      const config = this.getAutoWithdrawConfig(walletId);
      if (!config) return '';
      let dest = '';
      if (config.payoutType === 'spark') dest = config.sparkAddress;
      else if (config.payoutType === 'onchain') dest = config.bitcoinAddress;
      else dest = config.lightningAddress;
      if (!dest) return '';
      if (dest.includes('@')) return dest;
      if (dest.length > 16) return `${dest.slice(0, 8)}...${dest.slice(-4)}`;
      return dest;
    },

    openAutoWithdrawFromDialog(wallet, configKey, entryName) {
      this.showAutoTransferDialog = false;
      // Small delay to let the list dialog close before opening the config dialog
      setTimeout(() => {
        this.openAutoWithdrawConfig(wallet, configKey, entryName);
      }, 200);
    },

    openAutoWithdrawConfig(wallet, configKey, entryName) {
      this.awConfigWalletId = configKey || wallet.id;
      this.awConfigWallet = wallet;
      this.awConfigEntryName = entryName || wallet.name;
      const existing = this.getAutoWithdrawConfig(this.awConfigWalletId);
      if (existing) {
        this.awConfigForm = {
          enabled: existing.enabled,
          thresholdSats: existing.thresholdSats,
          payoutType: existing.payoutType || 'lightning',
          lightningAddress: existing.lightningAddress || '',
          bitcoinAddress: existing.bitcoinAddress || '',
          sparkAddress: existing.sparkAddress || '',
          feeSpeed: existing.feeSpeed || 'medium',
        };
      } else {
        this.awConfigForm = {
          enabled: false,
          thresholdSats: 0,
          payoutType: 'lightning',
          lightningAddress: '',
          bitcoinAddress: '',
          sparkAddress: '',
          feeSpeed: 'medium',
        };
      }
      this.showAutoWithdrawDialog = true;
    },

    async saveAutoWithdrawConfig() {
      const store = useAutoWithdrawStore();
      await store.saveConfig(this.awConfigWalletId, this.awConfigForm);
      this.showAutoWithdrawDialog = false;
      this.$q.notify({
        message: this.$t('Auto-transfer settings saved'),
        color: 'positive',
        position: 'top',
        timeout: 2000,
      });
    },

    async removeAutoWithdrawConfig() {
      const store = useAutoWithdrawStore();
      await store.removeConfig(this.awConfigWalletId);
      this.showAutoWithdrawDialog = false;
      this.$q.notify({
        message: this.$t('Auto-transfer rule removed'),
        color: 'info',
        position: 'top',
        timeout: 2000,
      });
    },

    formatFiatValue(sats) {
      if (!sats || !this.exchangeRates[this.preferredFiatCurrency]) return '';
      const btcAmount = sats / 100000000;
      const fiatValue = btcAmount * this.exchangeRates[this.preferredFiatCurrency];
      return fiatValue.toFixed(2);
    }
  }
}
</script>

<style scoped>
.settings-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
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
  padding: 1rem 1rem 2rem;
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

/* Settings Cards */
.settings-card {
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 0;
}

.card-dark {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
}

.card-light {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

/* Q-Item Styles */
.settings-card :deep(.q-item) {
  padding: 14px 16px;
  min-height: 48px;
}

.item-label-dark {
  color: #FFFFFF;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
}

.item-label-light {
  color: #1F2937;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
}

.kiosk-mode-desc {
  padding: 0 16px 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.5;
}

.kiosk-tip-input :deep(.q-field__control) {
  border-radius: 12px;
}

.kiosk-start-btn {
  border-radius: 14px;
  height: 48px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
}


.item-caption-dark {
  color: #666;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
}

.item-caption-light {
  color: #9CA3AF;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
}

.mono-caption {
  font-family: var(--font-mono);
  font-size: 11px;
}

/* Side Values */
.side-value {
  font-family: 'Manrope', sans-serif;
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
  background: var(--border-card);
  margin-left: 16px;
}

.separator-light {
  background: var(--border-card);
  margin-left: 16px;
}

/* Danger Text */
.danger-text {
  color: #EF4444 !important;
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  margin-top: 8px;
  margin-bottom: 16px;
}

.open-wallet-btn {
  width: 100%;
  height: 44px;
  border-radius: 10px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
}

.donation-portal-section {
  width: 100%;
  text-align: center;
  margin-top: 8px;
}

.donation-portal-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  margin-bottom: 4px;
}

.donation-portal-link {
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #EF4444;
  margin-bottom: 0.5rem;
}

.danger-message {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

.danger-content {
  padding: 1rem 1.5rem;
}

.confirm-instruction {
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
  border-radius: 10px;
}

.danger-action-btn {
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
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
  background: rgba(15, 23, 42, 0.04);
}

.currency-item-light:hover,
.language-item-light:hover {
  background: rgba(15, 23, 42, 0.06);
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
.wallet-stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 16px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.stats-dark {
  background: var(--bg-secondary);
  border: 1px solid var(--border-card);
}

.stats-light {
  background: var(--bg-secondary);
  border: 1px solid var(--border-card);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.stat-value {
  font-family: 'Manrope', sans-serif;
  margin-bottom: 0.25rem;
}

.stat-value.online-value {
  color: #15DE72;
}

.stat-label {
  font-family: 'Manrope', sans-serif;
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
  background: var(--border-card);
}

.divider-light {
  background: var(--border-card);
}

/* Wallets List */
/* Wallets Dialog - Scrollable Layout */
.wallets-dialog-card {
  width: 100%;
  max-width: min(480px, 95vw);
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
  font-family: 'Manrope', sans-serif;
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

.add-pocket-btn-dark {
  color: #15DE72;
  border: 1px dashed #2A342A;
  background: transparent;
  border-radius: 12px;
}

.add-pocket-btn-dark:hover {
  border-color: #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.add-pocket-btn-light {
  color: #059573;
  border: 1px dashed #E5E7EB;
  background: transparent;
  border-radius: 12px;
}

.add-pocket-btn-light:hover {
  border-color: #15DE72;
  background: rgba(21, 222, 114, 0.08);
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
  margin-top: 1rem;
}

.wallets-list-scroll {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow: hidden;
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

/* Wallet Card - Clean iOS-style */
.wallet-card-wrapper {
  margin-bottom: 0.5rem;
}

.wallet-card-wrapper:last-child {
  margin-bottom: 0;
}

.wallet-card {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  border-radius: 12px;
  transition: background 0.15s ease;
  overflow: hidden;
  max-width: 100%;
}

.wallet-card-dark {
  background: var(--bg-card);
}

.wallet-card-light {
  background: var(--bg-card);
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
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
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
  font-family: 'Manrope', sans-serif;
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
  font-family: var(--font-mono);
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
  font-family: 'Manrope', sans-serif;
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

/* Exchange-rate-source (Mempool) Dialog
 * Shares .dialog-card base styles (overflow: hidden for rounded corners)
 * but lays its children out as a flex column so the middle section
 * scrolls internally when content exceeds the viewport. Without this,
 * expanding the custom-server panel clips the Save button off-screen
 * on short devices. */
.mempool-dialog {
  width: 100%;
  max-width: 440px;
  max-height: min(92vh, 760px);
  display: flex;
  flex-direction: column;
}

.mempool-dialog .dialog-header {
  flex: 0 0 auto;
}

.mempool-dialog .dialog-content {
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* Fade the scroll edges into the card for a softer look when the
     content overflows. Optional polish. */
  scrollbar-width: thin;
}

.mempool-dialog .dialog-actions {
  flex: 0 0 auto;
  border-top: 1px solid var(--border-card);
}

/* Animated hero illustration. Served via <img> so the SVG's inline CSS
   keyframes run in a self-contained sandbox. `min-height` reserves the
   illustration's vertical footprint so the layout doesn't jump during
   the one-tick unmount-remount that forces the animation to replay. */
.mempool-hero {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 0 8px;
  min-height: 220px;
  /* Clip any skew that overshoots the hero frame during the animation
     so it can't push the card wider mid-animation. */
  overflow: hidden;
}

.mempool-hero-img {
  width: 100%;
  max-width: 220px;
  height: auto;
  user-select: none;
  pointer-events: none;
}

@media (max-height: 720px) {
  .mempool-hero {
    min-height: 180px;
  }
  .mempool-hero-img {
    max-width: 180px;
  }
}

.mempool-intro-text {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  margin: 0 auto 14px;
  max-width: 340px;
  text-align: center;
}

/* Green brand accent for the word "BuhoGO" in body copy. Keeps the
   surrounding text translatable while letting the brand name pop. */
.buhogo-brand {
  font-weight: 700;
  color: #15DE72;
  background: linear-gradient(135deg, #059573, #15DE72);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: 0.01em;
}

/* Exchange-rate source picker.
 * Single radio-style list: three rows with an inline custom-URL field
 * that appears when the "Your own server" row is the active selection.
 * No disclosure toggle — the selection itself drives visibility. */
.source-list {
  border-radius: 14px;
  border: 1px solid;
  overflow: hidden;
  margin-bottom: 14px;
}

.source-list-dark {
  background: var(--bg-secondary);
  border-color: var(--border-card);
}

.source-list-light {
  background: #ffffff;
  border-color: #e2e8f0;
}

.source-row {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.source-row:active {
  background: rgba(21, 222, 114, 0.06);
}

.source-radio {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--border-card);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.source-row-selected .source-radio {
  border-color: #15DE72;
  background: #15DE72;
}

.source-radio-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ffffff;
  transform: scale(0);
  transition: transform 0.15s ease;
}

.source-row-selected .source-radio-dot {
  transform: scale(1);
}

.source-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.source-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.source-name {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.source-desc {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-muted);
}

.source-separator {
  height: 1px;
  background: var(--border-card);
  margin-left: 48px; /* aligns with the body column, not the radio */
}

/* Inline custom input — part of the list, visually anchored to the
   "Your own server" row but clearly its own editing surface. */
.source-custom {
  padding: 0 16px 16px 48px; /* left-inset matches source-body column */
}

.source-custom-input {
  border-radius: 10px;
  transition: border-color 0.15s ease;
}

.source-custom-input-dark {
  background: var(--bg-input);
  border: 1px solid var(--border-card);
}

.source-custom-input-light {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.source-custom-input-inner {
  font-family: var(--font-mono);
  font-size: 12px;
}

.source-custom-help {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  line-height: 1.4;
}

.source-custom-help-icon {
  flex: 0 0 auto;
  opacity: 0.8;
}

.source-tag {
  font-family: 'Manrope', sans-serif;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.tag-advanced {
  background: rgba(148, 163, 184, 0.16);
  color: #64748b;
}

/* Shared preset tags, used by .source-head badges. */
.tag-default {
  background: rgba(21, 222, 114, 0.12);
  color: #15DE72;
}

.tag-community {
  background: rgba(251, 191, 36, 0.12);
  color: #F59E0B;
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
  background: rgba(21, 222, 114, 0.12);
  color: #15DE72;
}

.badge-unverified {
  background: rgba(251, 191, 36, 0.12);
  color: #F59E0B;
}

/* Accounts Dialog */
.accounts-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.account-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.account-item-dark {
  background: var(--bg-input);
}

.account-item-dark:hover {
  background: rgba(255, 255, 255, 0.08);
}

.account-item-light {
  background: #F3F4F6;
}

.account-item-light:hover {
  background: #E5E7EB;
}

.account-item-active.account-item-dark {
  background: rgba(21, 222, 114, 0.08);
  border: 1px solid rgba(21, 222, 114, 0.2);
}

.account-item-active.account-item-light {
  background: rgba(5, 149, 115, 0.06);
  border: 1px solid rgba(5, 149, 115, 0.15);
}

.account-active-indicator {
  flex-shrink: 0;
  color: #15DE72;
  display: flex;
  align-items: center;
}

.account-inactive-indicator {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  opacity: 0.4;
}

.account-item-info {
  flex: 1;
  min-width: 0;
}

.account-item-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.account-edit-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.account-name-input {
  flex: 1;
}

.account-item-name {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.account-primary-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(21, 222, 114, 0.12);
  color: #15DE72;
}

.account-item-address {
  font-size: 11px;
  margin-top: 2px;
}

/* Accounts dialog subtitle */
.accounts-dialog-subtitle {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  margin-top: 2px;
}

/* Pockets compact info banner */
.pockets-compact-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 11.5px;
  padding: 8px 12px;
  border-radius: 10px;
}

.pockets-compact-info-dark {
  background: rgba(255, 255, 255, 0.03);
}

.pockets-compact-info-light {
  background: rgba(0, 0, 0, 0.02);
}

.pockets-max-info {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  text-align: center;
  padding: 4px 0;
}

/* Pockets visual explainer */
.pockets-explainer {
  border-radius: 14px;
  padding: 16px 12px 14px;
}

.pockets-explainer-dark {
  background: rgba(255, 255, 255, 0.03);
}

.pockets-explainer-light {
  background: rgba(0, 0, 0, 0.02);
}

.pockets-illustration {
  width: 100%;
  height: auto;
  margin-bottom: 14px;
}

.pockets-explainer-features {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pockets-feature-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.4;
}

.pockets-feature-row svg {
  flex-shrink: 0;
}

/* Account balance in dialog */
.account-item-balance {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  margin-top: 2px;
}

/* Add Account confirm dialog */
.add-account-confirm-section {
  text-align: center;
  padding-bottom: 8px !important;
}

.add-account-confirm-icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(21, 222, 114, 0.1);
  color: #15DE72;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
}

.add-account-confirm-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.6;
  margin-bottom: 14px;
}

.add-account-confirm-info {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  text-align: left;
}

.add-account-confirm-info-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.add-account-confirm-info-dark {
  background: rgba(21, 222, 114, 0.06);
  color: rgba(21, 222, 114, 0.8);
}

.add-account-confirm-info-light {
  background: rgba(5, 149, 115, 0.06);
  color: rgba(5, 149, 115, 0.8);
}

/* Wallet tag for accounts badge in Manage Wallets */
.tag-accounts {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(59, 130, 246, 0.12);
  color: #3B82F6;
}

/* Manage Wallets — Account rows under Spark wallets */
.manage-wallet-accounts {
  padding: 4px 8px 0 52px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.manage-account-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: all 0.15s ease;
  border-radius: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
}

.manage-account-row-dark {
  background: rgba(255, 255, 255, 0.03);
}

.manage-account-row-dark:hover {
  background: rgba(255, 255, 255, 0.07);
}

.manage-account-row-light {
  background: rgba(0, 0, 0, 0.02);
}

.manage-account-row-light:hover {
  background: rgba(0, 0, 0, 0.05);
}

.manage-account-row-active.manage-account-row-dark {
  background: rgba(21, 222, 114, 0.06);
  border-color: rgba(21, 222, 114, 0.15);
}

.manage-account-row-active.manage-account-row-light {
  background: rgba(5, 149, 115, 0.04);
  border-color: rgba(5, 149, 115, 0.12);
}

.manage-account-check {
  color: #15DE72;
  flex-shrink: 0;
}

.manage-account-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.manage-account-name {
  font-weight: 500;
}

.manage-account-balance {
  font-size: 12px;
  flex-shrink: 0;
}

/* Backup Dialog */
/* ==========================================
   Auto-Withdraw — Neobank Style
   ========================================== */

/* Empty state */
.aw-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  margin: 0 16px 12px;
  border-radius: 14px;
}
.aw-empty-dark {
  background: rgba(255, 255, 255, 0.03);
}
.aw-empty-light {
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.aw-empty-icon {
  color: rgba(128, 128, 128, 0.4);
}
.aw-empty-illustration {
  width: 100%;
  max-width: 160px;
  height: auto;
  margin-bottom: 8px;
  user-select: none;
  pointer-events: none;
}
.aw-empty-text {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: rgba(128, 128, 128, 0.5);
  text-align: center;
}

/* Wallet list */
.aw-wallet-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px;
  margin-bottom: 12px;
}

.aw-wallet-card {
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.aw-card-dark {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
}
.aw-card-dark:active {
  background: rgba(255, 255, 255, 0.08);
}
.aw-card-light {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.aw-card-light:active {
  background: rgba(0, 0, 0, 0.02);
}

.aw-wallet-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.aw-wallet-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.aw-avatar-spark {
  background: linear-gradient(135deg, #2A2A2A, #1A1A1A);
}
.aw-avatar-lnbits {
  background: linear-gradient(135deg, #FF1FE1, #C919B0);
}
.aw-avatar-nwc {
  background: linear-gradient(135deg, #FFCA4A, #F7931A);
}

.aw-wallet-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.aw-wallet-name {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  display: flex;
  align-items: center;
  gap: 6px;
}
.aw-name-dark { color: rgba(255, 255, 255, 0.9); }
.aw-name-light { color: rgba(0, 0, 0, 0.85); }

.aw-pocket-label {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}
.aw-pocket-label-dark {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.4);
}
.aw-pocket-label-light {
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.35);
}

.aw-pocket-card {
  margin-left: 12px;
}

.aw-wallet-summary {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aw-summary-dark { color: rgba(255, 255, 255, 0.4); }
.aw-summary-light { color: rgba(0, 0, 0, 0.4); }

.aw-wallet-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.aw-status-pill {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  letter-spacing: 0.01em;
}
.aw-pill-active {
  background: rgba(16, 185, 129, 0.12);
  color: #10B981;
}
.aw-pill-inactive {
  background: rgba(128, 128, 128, 0.1);
  color: rgba(128, 128, 128, 0.6);
}

/* Auto-Transfer dialog list */
.aw-dialog-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.aw-dialog-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.aw-dialog-item-dark {
  background: rgba(255, 255, 255, 0.03);
}
.aw-dialog-item-dark:active {
  background: rgba(255, 255, 255, 0.06);
}
.aw-dialog-item-light {
  background: rgba(0, 0, 0, 0.02);
}
.aw-dialog-item-light:active {
  background: rgba(0, 0, 0, 0.05);
}
.aw-dialog-item-info {
  flex: 1;
  min-width: 0;
}
.aw-dialog-item-name {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aw-dialog-item-summary {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aw-dialog-item-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Config dialog */
.aw-config-dialog {
  width: 100%;
  max-width: 420px;
  border-radius: 20px 20px 0 0 !important;
}

.aw-dialog-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 20px 12px;
  text-align: center;
}

.aw-dialog-icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
}
/* Dialog icon wrap — per wallet type */
.aw-icon-wrap-spark {
  background: rgba(30, 30, 30, 0.1);
  color: #3A3A3A;
}
.aw-icon-wrap-lnbits {
  background: rgba(255, 31, 225, 0.1);
  color: #FF1FE1;
}
.aw-icon-wrap-nwc {
  background: rgba(247, 147, 26, 0.1);
  color: #F7931A;
}

.aw-dialog-title {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 700;
}

.aw-dialog-entry-name {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}

.aw-dialog-subtitle {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  line-height: 1.4;
  max-width: 280px;
}
.aw-subtitle-dark { color: rgba(255, 255, 255, 0.4); }
.aw-subtitle-light { color: rgba(0, 0, 0, 0.45); }

.aw-dialog-body {
  padding: 8px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Toggle row */
.aw-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 12px;
}
.aw-toggle-dark { background: rgba(255, 255, 255, 0.04); }
.aw-toggle-light { background: rgba(0, 0, 0, 0.02); }

.aw-toggle-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
}

/* Field groups */
.aw-field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.aw-field-label {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.aw-label-dark { color: rgba(255, 255, 255, 0.35); }
.aw-label-light { color: rgba(0, 0, 0, 0.4); }

.aw-input {
  border-radius: 10px;
  padding: 2px 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
}
.aw-input-dark { background: var(--bg-input); }
.aw-input-light { background: var(--bg-input); border: 1px solid var(--border-card); }

.aw-input-suffix {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
}
.aw-suffix-dark { color: rgba(255, 255, 255, 0.3); }
.aw-suffix-light { color: rgba(0, 0, 0, 0.3); }

.aw-fiat-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  padding-left: 12px;
}
.aw-spark-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  margin-top: 6px;
}
.aw-hint-dark { color: rgba(255, 255, 255, 0.3); }
.aw-hint-light { color: rgba(0, 0, 0, 0.35); }

/* Payout type pills */
.aw-payout-pills {
  display: flex;
  gap: 8px;
}

.aw-pill-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  border-radius: 10px;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s ease;
}
.aw-pill-dark {
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
}
.aw-pill-light {
  background: rgba(0, 0, 0, 0.03);
  color: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
/* Pill selected — per wallet type */
.aw-pill-sel-spark.aw-pill-dark { background: rgba(60, 60, 60, 0.3); color: #fff; }
.aw-pill-sel-spark.aw-pill-light { background: rgba(30, 30, 30, 0.08); color: #1A1A1A; border-color: rgba(30, 30, 30, 0.2); }
.aw-pill-sel-lnbits.aw-pill-dark { background: rgba(255, 31, 225, 0.15); color: #FF5AEA; }
.aw-pill-sel-lnbits.aw-pill-light { background: rgba(255, 31, 225, 0.08); color: #C919B0; border-color: rgba(255, 31, 225, 0.25); }
.aw-pill-sel-nwc.aw-pill-dark { background: rgba(247, 147, 26, 0.15); color: #FFCA4A; }
.aw-pill-sel-nwc.aw-pill-light { background: rgba(247, 147, 26, 0.1); color: #D97706; border-color: rgba(247, 147, 26, 0.3); }
.aw-pill-disabled {
  opacity: 0.4;
  pointer-events: none;
}

/* Fee speed cards */
.aw-fee-cards {
  display: flex;
  gap: 8px;
}

.aw-fee-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.aw-fee-dark {
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
}
.aw-fee-light {
  background: rgba(0, 0, 0, 0.03);
  color: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
/* Fee selected — per wallet type (only Spark has on-chain) */
.aw-fee-sel-spark.aw-fee-dark { background: rgba(60, 60, 60, 0.3); color: #fff; }
.aw-fee-sel-spark.aw-fee-light { background: rgba(30, 30, 30, 0.08); color: #1A1A1A; border-color: rgba(30, 30, 30, 0.2); }

.aw-fee-label {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
}

.aw-fee-desc {
  font-family: 'Manrope', sans-serif;
  font-size: 10px;
}

/* Last transfer */
.aw-last-transfer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  padding-top: 4px;
}

/* Dialog actions */
.aw-dialog-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 20px 20px;
}

.aw-save-btn {
  width: 100%;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  padding: 12px;
  border-radius: 12px;
}
/* Save button — per wallet type */
.aw-save-spark { background: rgba(30, 30, 30, 0.9); color: #fff; }
.aw-save-spark:hover { background: rgba(30, 30, 30, 1); }
.aw-save-lnbits { background: rgba(255, 31, 225, 0.15); color: #FF1FE1; }
.aw-save-lnbits:hover { background: rgba(255, 31, 225, 0.25); }
.aw-save-nwc { background: rgba(247, 147, 26, 0.15); color: #D97706; }
.aw-save-nwc:hover { background: rgba(247, 147, 26, 0.25); }

.aw-remove-btn {
  width: 100%;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: rgba(239, 68, 68, 0.7);
}

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

.kiosk-setup-primary {
  width: 100%; height: 50px; border: none; border-radius: var(--radius-md);
  background: var(--color-green); color: white;
  font-family: 'Manrope', sans-serif; font-size: 0.9375rem; font-weight: 700;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
}
.kiosk-setup-primary:active { opacity: 0.85; }

.kiosk-setup-secondary {
  background: none; border: none;
  color: var(--text-muted);
  font-family: 'Manrope', sans-serif; font-size: 0.875rem; font-weight: 500;
  cursor: pointer; padding: 12px 16px; margin-top: 4px;
  -webkit-tap-highlight-color: transparent;
}
.kiosk-setup-secondary:active { opacity: 0.6; }

</style>
