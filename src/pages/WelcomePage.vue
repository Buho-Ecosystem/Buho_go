<template>
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <q-page class="welcome-page">
    <transition :name="transitionName" mode="out-in">
      <!-- ═══════════════ Welcome view ═══════════════ -->
      <div v-if="currentView === 'welcome'" key="welcome" class="bgo-screen">
        <div class="bgo-top">
          <div class="bgo-brand-row">
            <span class="bgo-brand">BuhoGO</span>
          </div>

          <div class="bgo-diag">
            <div class="bgo-kicker">{{ $t('A new wallet') }}</div>
            <h1 class="bgo-h1">
              {{ $t('A fresh') }}<br>
              {{ $t('Bitcoin') }}<br>
              <em class="bgo-under">{{ $t('wallet.') }}</em>
            </h1>
            <p class="bgo-sub">{{ $t("A Bitcoin wallet that's yours. Ready in seconds - no sign-up needed.") }}</p>
          </div>

          <div class="bgo-object" aria-hidden="true">
            <div class="obj">
              <div class="seam"></div>
              <div class="dot"></div>
              <div class="mark">₿</div>
              <div class="logo-stamp">
                <svg viewBox="0 0 30 32" fill="currentColor">
                  <path d="M0 13.44C0 6.02 6.02 0 13.44 0v18.56C13.44 25.98 7.42 32 0 32V13.44Z"/>
                  <path d="M15.39 7.30C15.39 3.27 18.66 0 22.70 0c4.03 0 7.30 3.27 7.30 7.30v.42c0 4.03-3.27 7.30-7.30 7.30-4.03 0-7.30-3.27-7.30-7.30V7.30Z"/>
                  <path d="M15.39 24.28C15.39 20.25 18.66 16.98 22.70 16.98c4.03 0 7.30 3.27 7.30 7.30v.42c0 4.03-3.27 7.30-7.30 7.30-4.03 0-7.30-3.27-7.30-7.30v-.42Z"/>
                </svg>
                Buho
              </div>
              <div class="serial">No. {{ serial }}</div>
            </div>
          </div>
        </div>

        <div class="bgo-bot">
          <div class="bgo-section-label">{{ $t('Other options') }}</div>
          <div class="bgo-rows">
            <button class="bgo-rowitem" @click="goToSparkRestore">
              <span class="num">I.</span>
              <span class="label">
                <div class="t">{{ $t('Restore from backup') }}</div>
                <div class="d">{{ $t('Use your recovery phrase') }}</div>
              </span>
              <svg class="chev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M1 1l5.5 5.5L1 12"/>
              </svg>
            </button>
            <button class="bgo-rowitem" @click="openAdvanced">
              <span class="num">II.</span>
              <span class="label">
                <div class="t">{{ $t('Advanced setup') }}</div>
                <div class="d">NWC · LNbits</div>
              </span>
              <svg class="chev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M1 1l5.5 5.5L1 12"/>
              </svg>
            </button>
          </div>

          <div class="bgo-actions">
            <q-btn
              class="apple-cta full-width"
              :label="$t('Create Wallet')"
              @click="goToSparkSetup"
              no-caps
              unelevated
            />
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
      </div>

      <!-- ═══════════════ Advanced view ═══════════════ -->
      <div v-else key="advanced" class="bgo-screen">
        <div class="bgo-top">
          <div class="bgo-brand-row">
            <button class="bgo-back" @click="closeAdvanced">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
              {{ $t('Back') }}
            </button>
          </div>

          <div class="bgo-diag">
            <div class="bgo-kicker">{{ $t('For power users') }}</div>
            <h1 class="bgo-h1">
              {{ $t('Bring') }} <em class="bgo-under">{{ $t('your own') }}</em><br>
              {{ $t('wallet.') }}
            </h1>
            <p class="bgo-sub">{{ $t('Use an existing Lightning wallet. Your keys stay where they already live.') }}</p>
          </div>
        </div>

        <div class="bgo-bot">
          <div class="bgo-section-label">{{ $t('Connection method') }}</div>
          <div class="bgo-rows">
            <button class="bgo-rowitem" @click="goToNWCSetup">
              <span class="num">I.</span>
              <span class="label">
                <div class="t">Nostr Wallet Connect</div>
                <div class="d">{{ $t('Paste an NWC string') }}</div>
              </span>
              <svg class="chev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M1 1l5.5 5.5L1 12"/>
              </svg>
            </button>
            <button class="bgo-rowitem" @click="goToLNBitsSetup">
              <span class="num">II.</span>
              <span class="label">
                <div class="t">LNbits Wallet</div>
                <div class="d">{{ $t('Connect via API endpoint') }}</div>
              </span>
              <svg class="chev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M1 1l5.5 5.5L1 12"/>
              </svg>
            </button>
          </div>

          <div class="bgo-actions">
            <div class="bgo-foot">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>
                </svg>
                {{ $t('Two methods supported') }}
              </span>
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                {{ $t('More coming soon') }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </q-page>
</template>

<script>
import LoadingScreen from '../components/LoadingScreen.vue'
import {
  SUPPORTED_LOCALES,
  applyLocale,
  getLocaleLabel,
} from '../i18n/locales'

export default {
  name: 'WelcomePage',
  components: {
    LoadingScreen,
  },
  data() {
    return {
      showLoadingScreen: true,
      loadingText: 'Initializing BuhoGO...',
      currentView: 'welcome',
      transitionName: 'bgo-slide-forward',
      supportedLocales: SUPPORTED_LOCALES,
    }
  },
  computed: {
    serial() {
      const d = new Date()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const year = String(d.getFullYear()).slice(-2)
      return `${month}\u00B7${year}`
    },
    currentLocaleLabel() {
      return getLocaleLabel(this.$i18n.locale)
    }
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
    openAdvanced() {
      this.transitionName = 'bgo-slide-forward'
      this.currentView = 'advanced'
    },
    closeAdvanced() {
      this.transitionName = 'bgo-slide-back'
      this.currentView = 'welcome'
    },
    goToSparkSetup() { this.$router.push('/spark-setup') },
    goToSparkRestore() { this.$router.push('/spark-restore') },
    goToNWCSetup() { this.$router.push('/nwc-setup') },
    goToLNBitsSetup() { this.$router.push('/lnbits-setup') },
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

/* ─── Cream editorial top ─── */
.bgo-top {
  position: relative;
  padding:
    calc(var(--safe-top, 0px) + 14px)
    26px
    40px;
  background:
    radial-gradient(120% 80% at 10% 10%, #EDE4CE 0%, #DBCFB1 55%, #C7B991 100%);
  color: #1A1A1A;
  flex-shrink: 0;
  overflow: hidden;
}

/* Paper grain */
.bgo-top::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.12  0 0 0 0 0.10  0 0 0 0 0.06  0 0 0 0.45 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.4'/></svg>");
  mix-blend-mode: multiply;
  opacity: 0.38;
  pointer-events: none;
}

.bgo-brand-row {
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: space-between;
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
.bgo-back {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Fraunces', 'Manrope', serif;
  font-weight: 500;
  font-style: italic;
  font-size: 15px;
  letter-spacing: -0.01em;
  color: #1A1A1A;
  padding: 4px 8px 4px 0;
}
.bgo-back svg { opacity: 0.7 }

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
  font-size: 44px;
  line-height: 0.98;
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

/* Professional editorial underline */
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
  max-width: 260px;
  margin: 18px 0 0;
  line-height: 1.55;
  letter-spacing: -0.005em;
}

/* ─── Tilted metallic object ─── */
.bgo-object {
  position: absolute;
  right: -34px;
  top: calc(var(--safe-top, 0px) + 70px);
  width: 170px;
  height: 170px;
  transform: rotate(-9deg);
  z-index: 1;
  pointer-events: none;
}
.bgo-object .obj {
  width: 100%;
  height: 100%;
  border-radius: 26px;
  background: linear-gradient(135deg, #FCFBF7 0%, #E6E0D1 40%, #A9A393 100%);
  box-shadow:
    inset 0 2px 3px rgba(255, 255, 255, 0.85),
    inset 0 -8px 18px rgba(70, 60, 40, 0.2),
    0 30px 60px -12px rgba(50, 40, 20, 0.45),
    0 6px 12px rgba(50, 40, 20, 0.15);
  position: relative;
}
.bgo-object .seam {
  position: absolute;
  inset: 13px;
  border-radius: 16px;
  border: 1px solid rgba(0, 0, 0, 0.07);
}
.bgo-object .mark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-family: 'Fraunces', 'Manrope', serif;
  font-weight: 500;
  font-style: italic;
  font-size: 56px;
  color: #2A2620;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
  line-height: 1;
}
.bgo-object .dot {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #059573;
  box-shadow: 0 0 0 3px rgba(5, 149, 115, 0.18);
  animation: bgoPing 2.6s ease-out infinite;
}
@keyframes bgoPing {
  0%   { box-shadow: 0 0 0 0 rgba(5, 149, 115, 0.45) }
  70%  { box-shadow: 0 0 0 8px rgba(5, 149, 115, 0) }
  100% { box-shadow: 0 0 0 0 rgba(5, 149, 115, 0) }
}
.bgo-object .logo-stamp {
  position: absolute;
  bottom: 13px;
  left: 13px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Fraunces', 'Manrope', serif;
  font-style: italic;
  font-weight: 500;
  font-size: 9.5px;
  color: #4A4238;
  letter-spacing: 0.02em;
  opacity: 0.75;
}
.bgo-object .logo-stamp svg { width: 10px; height: 11px; opacity: 0.8 }
.bgo-object .serial {
  position: absolute;
  bottom: 13px;
  right: 13px;
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 8px;
  color: #4A4238;
  opacity: 0.55;
  letter-spacing: 0.04em;
}

/* ─── Dark bottom ─── */
.bgo-bot {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 22px 24px calc(var(--safe-bottom, 0px) + 20px);
  background: radial-gradient(80% 60% at 50% 0%, #14161A 0%, #0A0B0C 80%);
  position: relative;
}

.bgo-section-label {
  font-family: 'Manrope', sans-serif;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: #6B6B70;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.bgo-section-label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
}

.bgo-rows {
  display: flex;
  flex-direction: column;
}
.bgo-rowitem {
  all: unset;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  position: relative;
  transition: padding-left 0.2s ease;
}
.bgo-rowitem:active { padding-left: 8px }
.bgo-rowitem:last-child { border-bottom: none }
.bgo-rowitem .num {
  font-family: 'Fraunces', 'Manrope', serif;
  font-style: italic;
  font-weight: 500;
  font-size: 13px;
  color: #52525B;
  width: 20px;
  flex-shrink: 0;
  letter-spacing: -0.01em;
}
.bgo-rowitem .label {
  flex: 1;
  min-width: 0;
}
.bgo-rowitem .t {
  font-size: 15px;
  font-weight: 500;
  color: #F4F4F5;
  letter-spacing: -0.01em;
}
.bgo-rowitem .d {
  font-size: 12px;
  color: #71717A;
  margin-top: 2px;
  letter-spacing: -0.005em;
}
.bgo-rowitem .chev {
  color: #52525B;
  flex-shrink: 0;
}

/* ─── CTA ─── */
.bgo-actions {
  margin-top: auto;
  padding-top: 22px;
  display: flex;
  flex-direction: column;
  gap: 4px;
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

/* ─── Foot signals + language switcher ─── */
.bgo-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
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

/* ─── Transitions ─── */
.bgo-slide-forward-enter-active,
.bgo-slide-forward-leave-active,
.bgo-slide-back-enter-active,
.bgo-slide-back-leave-active {
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s ease;
}
.bgo-slide-forward-enter-from { transform: translateX(28px); opacity: 0 }
.bgo-slide-forward-leave-to   { transform: translateX(-18px); opacity: 0 }
.bgo-slide-back-enter-from    { transform: translateX(-18px); opacity: 0 }
.bgo-slide-back-leave-to      { transform: translateX(28px); opacity: 0 }

/* ─── Small screens ─── */
@media (max-height: 720px) {
  .bgo-h1 { font-size: 38px }
  .bgo-diag { padding-top: 32px }
  .bgo-object { width: 150px; height: 150px; right: -30px }
  .bgo-object .mark { font-size: 50px }
}
@media (max-width: 360px) {
  .bgo-top { padding-left: 22px; padding-right: 22px }
  .bgo-bot { padding-left: 20px; padding-right: 20px }
  .bgo-h1 { font-size: 38px }
  .bgo-object { width: 140px; height: 140px }
  .bgo-object .mark { font-size: 46px }
}
</style>

<!--
  q-menu is teleported to <body>, so scoped styles cannot reach it.
  This second, non-scoped block styles ONLY the menu flagged with
  `.bgo-lang-menu` (opened from the language switcher on WelcomePage).
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
</style>
