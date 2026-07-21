<template>
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <q-page class="welcome-page">
    <div class="bgo-screen">
      <!-- ═══════════════ Cream editorial hero ═══════════════ -->
      <div class="bgo-top">
        <!-- Buho brand mark, embossed into the cream like a letterpress
             watermark. Rises from the bottom and crops at the cream/dark seam. -->
        <svg class="bgo-emblem" viewBox="0 0 30 32" fill="currentColor" aria-hidden="true">
          <path d="M0 13.4423C0 6.01833 6.01833 0 13.4423 0V18.5577C13.4423 25.9817 7.42399 32 0 32V13.4423Z"/>
          <path d="M15.3906 7.30444C15.3906 3.27031 18.6609 0 22.6951 0C26.7292 0 29.9995 3.27031 29.9995 7.30444V7.72091C29.9995 11.755 26.7292 15.0253 22.6951 15.0253C18.6609 15.0253 15.3906 11.755 15.3906 7.72091V7.30444Z"/>
          <path d="M15.3906 24.281C15.3906 20.2469 18.6609 16.9766 22.6951 16.9766C26.7292 16.9766 29.9995 20.2469 29.9995 24.281V24.6975C29.9995 28.7316 26.7292 32.0019 22.6951 32.0019C18.6609 32.0019 15.3906 28.7316 15.3906 24.6975V24.281Z"/>
        </svg>

        <div class="bgo-brand-row">
          <span class="bgo-brand">BuhoGO</span>
        </div>

        <div class="bgo-diag">
          <div class="bgo-kicker">{{ $t('Welcome') }}</div>
          <h1 class="bgo-h1">
            {{ $t('A fresh') }}<br>
            {{ $t('Bitcoin') }}<br>
            <em class="bgo-under">{{ $t('wallet.') }}</em>
          </h1>
          <p class="bgo-sub">{{ $t('Yours in seconds. No sign-up, no account.') }}</p>
        </div>
      </div>

      <!-- ═══════════════ Dark action bar ═══════════════ -->
      <div class="bgo-bot">
        <q-btn
          class="apple-cta full-width"
          :label="$t('Create Wallet')"
          @click="goToSparkSetup"
          no-caps
          unelevated
        />

        <button class="bgo-more" type="button" @click="showMoreSheet = true">
          {{ $t('More ways to start') }}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <path d="M18 15l-6-6-6 6"/>
          </svg>
        </button>

        <div class="bgo-foot">
          <span class="bgo-foot-trust">
            <span class="bgo-icon-pair" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2 3 14h8l-1 8 11-12h-8l1-8Z"/>
              </svg>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="9.5"/>
                <path d="M9.5 7.5h4.2a2.3 2.3 0 0 1 0 4.5H9.5m0 0h4.6a2.3 2.3 0 0 1 0 4.5H9.5m0-9v9m2-10.5v1.5m0 9v1.5" stroke-linecap="round"/>
              </svg>
            </span>
            {{ $t('Lightning & Bitcoin ready') }}
          </span>
          <button
            class="bgo-lang"
            type="button"
            :aria-label="$t('Change language')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9"/>
              <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>
            </svg>
            <span>{{ currentLocaleLabel }}</span>
            <svg class="bgo-lang-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M6 9l6 6 6-6"/>
            </svg>
            <q-menu
              anchor="top end"
              self="bottom end"
              :offset="[0, 10]"
              class="bgo-lang-menu"
              transition-show="jump-up"
              transition-hide="jump-down"
            >
              <q-list class="bgo-lang-list">
                <q-item
                  v-for="locale in supportedLocales"
                  :key="locale.value"
                  v-close-popup
                  clickable
                  :active="$i18n.locale === locale.value"
                  class="bgo-lang-item"
                  @click="changeLocale(locale.value)"
                >
                  <q-item-section>{{ locale.label }}</q-item-section>
                  <q-item-section side v-if="$i18n.locale === locale.value">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path d="M20 6 9 17l-5-5"/>
                    </svg>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </button>
        </div>
      </div>
    </div>

    <!-- ═══════════════ "More ways to start" sheet ═══════════════ -->
    <!--
      One place for every non-default path. Replaces the old numbered
      list AND the separate "Advanced" view: NWC and LNbits now live
      under the "power users" divider here, so there's no second screen
      to maintain.
    -->
    <q-dialog v-model="showMoreSheet" position="bottom" class="bgo-sheet-dialog">
      <div class="bgo-sheet">
        <div class="bgo-grab" aria-hidden="true"></div>
        <div class="bgo-sheet-title">{{ $t('More ways to start') }}</div>

        <button class="bgo-srow" type="button" @click="goToArkadeSetup">
          <span class="bgo-tile bgo-tile-ark">
            <svg viewBox="0 0 94 94" fill="#F14317" aria-hidden="true">
              <rect x="46.55" y="23.28" width="11.64" height="11.64"/>
              <rect x="34.92" y="23.28" width="11.64" height="11.64"/>
              <rect x="58.19" y="34.92" width="11.64" height="11.64"/>
              <rect width="11.64" height="11.64" transform="matrix(-1 0 0 1 34.92 34.92)"/>
              <rect width="11.64" height="11.64" transform="matrix(-1 0 0 1 46.55 46.55)"/>
              <rect width="11.64" height="11.64" transform="matrix(-1 0 0 1 58.19 46.55)"/>
              <rect x="58.19" y="58.19" width="11.64" height="11.64"/>
              <rect width="11.64" height="11.64" transform="matrix(-1 0 0 1 34.92 58.19)"/>
              <path d="M58.19 23.28L69.83 34.92H58.19V23.28Z"/>
              <path d="M34.92 23.28L23.28 34.92H34.92V23.28Z"/>
            </svg>
          </span>
          <span class="bgo-st">
            <span class="bgo-t">{{ $t('Create an Arkade wallet') }}</span>
            <span class="bgo-d">{{ $t('Instant, near zero fees') }}</span>
          </span>
          <svg class="bgo-schev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M1 1l5.5 5.5L1 12"/>
          </svg>
        </button>

        <button class="bgo-srow" type="button" @click="goToRestore">
          <span class="bgo-tile">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="6" r="1.7"/><circle cx="12" cy="6" r="1.7"/><circle cx="19" cy="6" r="1.7"/>
              <circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>
              <circle cx="5" cy="18" r="1.7"/><circle cx="12" cy="18" r="1.7"/><circle cx="19" cy="18" r="1.7"/>
            </svg>
          </span>
          <span class="bgo-st">
            <span class="bgo-t">{{ $t('Restore from backup') }}</span>
            <span class="bgo-d">{{ $t('Use your recovery phrase') }}</span>
          </span>
          <svg class="bgo-schev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M1 1l5.5 5.5L1 12"/>
          </svg>
        </button>

        <!-- Android only: pull the encrypted backup out of Google Drive.
             Hidden elsewhere - the native plugin is the only implementation. -->
        <button v-if="cloudRestoreAvailable" class="bgo-srow" type="button" @click="openCloudRestore">
          <span class="bgo-tile">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6.5 19a4.5 4.5 0 1 1 .42-8.98 6 6 0 0 1 11.45 1.67A3.5 3.5 0 0 1 17.5 19h-11Z"/>
              <path d="M12 12v6m0 0-2.4-2.4M12 18l2.4-2.4"/>
            </svg>
          </span>
          <span class="bgo-st">
            <span class="bgo-t">{{ $t('Restore from Google Drive') }}</span>
            <span class="bgo-d">{{ $t('Your encrypted cloud backup') }}</span>
          </span>
          <svg class="bgo-schev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M1 1l5.5 5.5L1 12"/>
          </svg>
        </button>

        <div class="bgo-spower">{{ $t('For power users') }}</div>

        <button class="bgo-srow" type="button" @click="goToNWCSetup">
          <span class="bgo-tile bgo-tile-nwc">
            <svg viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="url(#bgo_nwc_grad)"/>
              <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="#897FFF"/>
              <defs>
                <linearGradient id="bgo_nwc_grad" x1="123.989" y1="10.4384" x2="123.989" y2="249.939" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#FFCA4A"/>
                  <stop offset="1" stop-color="#F7931A"/>
                </linearGradient>
              </defs>
            </svg>
          </span>
          <span class="bgo-st">
            <span class="bgo-t">Nostr Wallet Connect</span>
            <span class="bgo-d">{{ $t('Paste an NWC string') }}</span>
          </span>
          <svg class="bgo-schev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M1 1l5.5 5.5L1 12"/>
          </svg>
        </button>

        <button class="bgo-srow" type="button" @click="goToLNBitsSetup">
          <span class="bgo-tile bgo-tile-lnb">
            <svg viewBox="-249 -49 1000 1000" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
            </svg>
          </span>
          <span class="bgo-st">
            <span class="bgo-t">LNbits Wallet</span>
            <span class="bgo-d">{{ $t('Connect via API endpoint') }}</span>
          </span>
          <svg class="bgo-schev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M1 1l5.5 5.5L1 12"/>
          </svg>
        </button>
      </div>
    </q-dialog>

    <!-- Encrypted Google Drive restore (Android only). intent="restore"
         jumps straight to the passphrase step once signed in. -->
    <CloudBackupSheet
      v-model="showCloudRestoreSheet"
      intent="restore"
      @restored="onCloudRestored"
      @update:model-value="onCloudSheetToggled"
    />
  </q-page>
</template>

<script>
import { Capacitor } from '@capacitor/core'
import LoadingScreen from '../components/LoadingScreen.vue'
import CloudBackupSheet from '../components/CloudBackupSheet.vue'
import {
  SUPPORTED_LOCALES,
  applyLocale,
  getLocaleLabel,
} from '../i18n/locales'

export default {
  name: 'WelcomePage',
  components: {
    LoadingScreen,
    CloudBackupSheet,
  },
  data() {
    return {
      showLoadingScreen: true,
      loadingText: 'Initializing BuhoGO...',
      showMoreSheet: false,
      showCloudRestoreSheet: false,
      // Set once a Drive restore brought anything back; navigation happens
      // when the sheet closes so the user first sees the result summary.
      cloudRestoreSucceeded: false,
      supportedLocales: SUPPORTED_LOCALES,
    }
  },
  computed: {
    currentLocaleLabel() {
      return getLocaleLabel(this.$i18n.locale)
    },
    cloudRestoreAvailable() {
      return Capacitor.getPlatform() === 'android'
    },
  },
  mounted() {
    setTimeout(() => {
      this.showLoadingScreen = false
    }, 5000)
    this.initializeApp()
  },
  methods: {
    async initializeApp() {
      try {
        const existingState = localStorage.getItem('buhoGO_wallet_store')
        if (existingState) {
          this.loadingText = 'Checking wallet state...'
          try {
            const walletInfo = JSON.parse(existingState)
            if (walletInfo.activeWalletId && walletInfo.wallets?.length > 0) {
              this.loadingText = 'Loading wallet...'
              this.$router.push('/wallet')
              return
            }
          } catch (parseError) {
            console.warn('Failed to parse wallet state, clearing:', parseError)
            localStorage.removeItem('buhoGO_wallet_store')
          }
        }
        this.showLoadingScreen = false
      } catch (error) {
        console.error('Error initializing app:', error)
        this.showLoadingScreen = false
      }
    },
    goToSparkSetup() { this.$router.push('/spark-setup') },
    openCloudRestore() {
      this.showMoreSheet = false
      this.showCloudRestoreSheet = true
    },
    onCloudRestored(result) {
      // Anything usable back on the device counts: freshly restored, or
      // already present (e.g. a retry after a partial first attempt).
      this.cloudRestoreSucceeded =
        (result?.restored?.length || 0) + (result?.skipped?.length || 0) > 0
    },
    onCloudSheetToggled(open) {
      if (!open && this.cloudRestoreSucceeded) {
        this.$router.push('/wallet')
      }
    },
    goToArkadeSetup() { this.showMoreSheet = false; this.$router.push('/arkade-setup') },
    goToRestore() { this.showMoreSheet = false; this.$router.push('/restore') },
    goToNWCSetup() { this.showMoreSheet = false; this.$router.push('/nwc-setup') },
    goToLNBitsSetup() { this.showMoreSheet = false; this.$router.push('/lnbits-setup') },
    changeLocale(code) {
      applyLocale(this.$i18n, code)
    },
  }
}
</script>

<style scoped>
.welcome-page {
  padding: 0 !important;
  min-height: 100vh;
  min-height: 100dvh;
  overflow: hidden;
  background: #0A0B0C;
}

.bgo-screen {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  color: #F4F4F5;
}

/* ─── Cream editorial hero ─── */
.bgo-top {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding:
    calc(var(--safe-top, 0px) + 14px)
    26px
    24px;
  background:
    radial-gradient(125% 78% at 12% 8%, #EEE6D0 0%, #DCD0B2 54%, #C6B88F 100%);
  color: #1A1A1A;
  overflow: hidden;
}

/* Paper grain */
.bgo-top::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.12  0 0 0 0 0.10  0 0 0 0 0.06  0 0 0 0.45 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.4'/></svg>");
  mix-blend-mode: multiply;
  opacity: 0.34;
  pointer-events: none;
}

/* Embossed Buho brand mark, rising from the bottom of the hero */
.bgo-emblem {
  position: absolute;
  left: 50%;
  bottom: -30px;
  transform: translateX(-50%);
  width: 264px;
  height: auto;
  color: #7A6E52;
  opacity: 0.16;
  z-index: 1;
  pointer-events: none;
  filter:
    drop-shadow(0 1.5px 0.5px rgba(255, 248, 232, 0.55))
    drop-shadow(0 -1px 0.5px rgba(60, 48, 30, 0.25));
}

.bgo-brand-row {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  min-height: 22px;
}
.bgo-brand {
  font-family: 'Fraunces', 'Manrope', serif;
  font-weight: 500;
  font-style: italic;
  font-size: 15px;
  letter-spacing: -0.01em;
  color: #1A1A1A;
}

.bgo-diag {
  position: relative;
  z-index: 2;
  padding: 42px 2px 0;
  text-align: left;
}
.bgo-kicker {
  font-family: 'Fraunces', 'Manrope', serif;
  font-weight: 500;
  font-style: italic;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: #5A564F;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.bgo-kicker::before {
  content: '';
  width: 20px;
  height: 1px;
  background: #5A564F;
}

.bgo-h1 {
  font-family: 'Fraunces', 'Manrope', serif;
  font-weight: 400;
  font-size: 46px;
  line-height: 0.97;
  letter-spacing: -0.035em;
  margin: 0;
  color: #0C0C0E;
  max-width: 260px;
}
.bgo-h1 em {
  font-style: italic;
  font-weight: 400;
  color: #2E2A22;
}
.bgo-h1 .bgo-under {
  text-decoration: underline;
  text-decoration-color: #059573;
  text-decoration-thickness: 2px;
  text-underline-offset: 5px;
  text-decoration-skip-ink: none;
}

.bgo-sub {
  font-size: 14px;
  color: #45433E;
  max-width: 250px;
  margin: 17px 0 0;
  line-height: 1.55;
  letter-spacing: -0.005em;
}

/* ─── Dark action bar ─── */
.bgo-bot {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  /* 48px floor clears a 3-button Android nav bar on devices where the
     WebView reports zero bottom inset. On gesture-nav devices and iOS
     the larger calc() with var(--safe-bottom) wins. */
  padding: 22px 24px max(48px, calc(var(--safe-bottom, 0px) + 20px));
  background: radial-gradient(80% 70% at 50% 0%, #14161A 0%, #0A0B0C 82%);
  position: relative;
}

.apple-cta {
  background: linear-gradient(180deg, #2E3034 0%, #181A1D 100%) !important;
  color: #F4F4F5 !important;
  border-radius: 14px !important;
  padding: 16px !important;
  font-family: 'Manrope', sans-serif !important;
  font-size: 16px !important;
  font-weight: 600 !important;
  letter-spacing: -0.015em !important;
  min-height: 54px;
  text-transform: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04),
    0 10px 24px -8px rgba(0, 0, 0, 0.6);
}
.apple-cta :deep(.q-btn__content) {
  font-weight: 600;
}

.bgo-more {
  all: unset;
  cursor: pointer;
  box-sizing: border-box;
  width: 100%;
  margin-top: 10px;
  min-height: 48px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: #A1A1AA;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: background 0.18s ease, color 0.18s ease;
}
.bgo-more:hover,
.bgo-more:focus-visible {
  background: rgba(255, 255, 255, 0.06);
  color: #F4F4F5;
}
.bgo-more svg { width: 12px; height: 12px; opacity: 0.7; }

/* ─── Foot signals + language switcher ─── */
.bgo-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: 14px;
  font-size: 11px;
  color: #71717A;
  letter-spacing: 0.01em;
}
.bgo-foot-trust {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.bgo-icon-pair {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: #9CA39D;
}
.bgo-icon-pair svg {
  width: 11px;
  height: 11px;
}

.bgo-lang {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 500;
  color: #A1A1AA;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}
.bgo-lang:hover,
.bgo-lang:focus-visible {
  background: rgba(255, 255, 255, 0.07);
  color: #F4F4F5;
  border-color: rgba(255, 255, 255, 0.1);
}
.bgo-lang > svg:first-child {
  width: 11px;
  height: 11px;
  opacity: 0.8;
}
.bgo-lang-chev {
  width: 10px;
  height: 10px;
  opacity: 0.7;
  margin-left: -1px;
}

/* ─── Small screens ─── */
@media (max-height: 720px) {
  .bgo-h1 { font-size: 40px }
  .bgo-diag { padding-top: 32px }
  .bgo-emblem { width: 220px }
}
@media (max-width: 360px) {
  .bgo-top { padding-left: 22px; padding-right: 22px }
  .bgo-bot { padding-left: 20px; padding-right: 20px }
  .bgo-h1 { font-size: 40px }
}
</style>

<!--
  q-menu and q-dialog teleport to <body>, so scoped styles cannot reach
  them. This second, non-scoped block styles ONLY the elements flagged
  with `.bgo-lang-menu` (the language switcher) and `.bgo-sheet-dialog`
  (the "More ways to start" sheet), both opened from WelcomePage.
-->
<style>
.bgo-lang-menu {
  background: #15171A !important;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px !important;
  min-width: 140px;
  box-shadow:
    0 20px 40px -10px rgba(0, 0, 0, 0.6),
    0 4px 12px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  padding: 4px;
}
.bgo-lang-menu .bgo-lang-list {
  padding: 0;
}
.bgo-lang-menu .bgo-lang-item {
  min-height: 36px;
  padding: 6px 10px;
  border-radius: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #D4D4D8;
  letter-spacing: -0.005em;
}
.bgo-lang-menu .bgo-lang-item:hover {
  background: rgba(255, 255, 255, 0.05);
}
.bgo-lang-menu .bgo-lang-item.q-item--active {
  background: rgba(21, 222, 114, 0.08);
  color: #15DE72;
}
.bgo-lang-menu .bgo-lang-item.q-item--active .q-item__section--side {
  color: #15DE72;
}

/* ─── "More ways to start" bottom sheet ─── */
.bgo-sheet-dialog .q-dialog__inner {
  padding: 0;
}
.bgo-sheet-dialog .q-dialog__inner > .bgo-sheet {
  width: 100%;
  max-width: 480px;
}
.bgo-sheet {
  position: relative;
  border-radius: 30px 30px 0 0;
  background: radial-gradient(140% 100% at 20% 0%, #F0E8D4 0%, #DED2B5 70%, #D1C39F 100%);
  color: #1C1A16;
  padding: 12px 24px max(30px, calc(var(--safe-bottom, 0px) + 18px));
  overflow: hidden;
  box-shadow: 0 -20px 50px rgba(0, 0, 0, 0.45);
}
.bgo-sheet::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.12  0 0 0 0 0.10  0 0 0 0 0.06  0 0 0 0.45 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.4'/></svg>");
  mix-blend-mode: multiply;
  opacity: 0.28;
  pointer-events: none;
}
.bgo-grab {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.18);
  margin: 0 auto 16px;
  position: relative;
}
.bgo-sheet-title {
  position: relative;
  font-family: 'Fraunces', 'Manrope', serif;
  font-style: italic;
  font-weight: 500;
  font-size: 19px;
  letter-spacing: -0.01em;
  margin-bottom: 4px;
  color: #1C1A16;
}
.bgo-srow {
  all: unset;
  cursor: pointer;
  box-sizing: border-box;
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 13px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.bgo-srow:last-of-type { border-bottom: none; }
.bgo-srow:active { background: rgba(0, 0, 0, 0.03); }
.bgo-srow .bgo-tile {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.07);
  color: #2A2620;
}
.bgo-srow .bgo-tile svg { width: 18px; height: 18px; }
.bgo-srow .bgo-tile-ark { background: rgba(241, 67, 23, 0.12); }
.bgo-srow .bgo-tile-ark svg { width: 25px; height: 25px; }
.bgo-srow .bgo-tile-nwc svg { width: 23px; height: 23px; }
.bgo-srow .bgo-tile-lnb svg { width: 20px; height: 24px; }
.bgo-srow .bgo-st {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  text-align: left;
}
.bgo-srow .bgo-t {
  font-family: 'Manrope', sans-serif;
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #1C1A16;
}
.bgo-srow .bgo-d {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  color: #5A564F;
  margin-top: 1px;
}
.bgo-srow .bgo-schev {
  color: rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}
.bgo-spower {
  position: relative;
  font-family: 'Manrope', sans-serif;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #6B6156;
  margin: 14px 0 2px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.bgo-spower::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(0, 0, 0, 0.1);
}
</style>
