<template>
  <q-page class="wizard-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <div class="wizard-container">

      <!-- Top bar: Logo left, Skip right -->
      <div class="wizard-topbar">
        <div class="wizard-logo">
          <img src="/buho_logo.svg" alt="Buho" class="wizard-logo-img" />
        </div>
        <q-btn flat no-caps dense class="skip-btn" @click="goToWallet">
          {{ $t('Skip') }}
        </q-btn>
      </div>

      <!-- Carousel -->
      <q-carousel
        v-model="currentSlide"
        swipeable
        animated
        transition-prev="slide-right"
        transition-next="slide-left"
        :navigation="false"
        :arrows="false"
        :infinite="false"
        class="wizard-carousel"
      >
        <!-- Spark-specific screens -->
        <template v-if="isSparkMode">
          <!-- 1: Personal Wallet -->
          <q-carousel-slide name="personal" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-piggy-bank-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Your Personal Wallet') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Your private funds stay separate here. Both wallets share the same recovery words, but each has its own balance.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 2: Business Wallet -->
          <q-carousel-slide name="business" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-ewallet-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Your Business Wallet') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Accept payments from customers, manage your sales, and keep your business funds in one place.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 3: Save to Hardware -->
          <q-carousel-slide name="savings" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-investing-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Save for the Future') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Ready to save? You can send your Bitcoin to a hardware wallet or any Bitcoin address for long-term storage.') }}
              </p>
            </div>
          </q-carousel-slide>
        </template>

        <!-- Extended screens (only if user opted in or general mode) -->
        <template v-if="showExtended">
          <!-- 4: Send & Receive -->
          <q-carousel-slide name="send-receive" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-bitcoin-p2p-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Send & Receive') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Pay anyone instantly with Lightning or send to any Bitcoin address. Just scan a QR code or paste an address.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 5: Internal Transfer -->
          <q-carousel-slide name="transfer" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-transfer-money-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Move Between Wallets') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Move money between your Business and Personal wallet anytime. It happens instantly and costs nothing.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 6: Auto-Transfer -->
          <q-carousel-slide name="auto-transfer" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-manage-money-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Auto-Transfer') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Set a rule and your funds move automatically when your balance grows past a certain amount. Set it and forget it.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 7: Transaction History -->
          <q-carousel-slide name="history" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-finance-app-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Your Transaction History') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Every payment you send or receive is saved. Tag them, add notes, and keep track of everything.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 8: Contacts -->
          <q-carousel-slide name="contacts" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-online-friends-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Your Contacts') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Save the people you pay often. Next time, just pick a name instead of typing an address.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 8: Amount Display -->
          <q-carousel-slide name="display" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-mobile-apps-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Choose Your View') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('See your balance in sats or in Bitcoin (₿). You can change this anytime in Settings.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 9: More Wallets -->
          <q-carousel-slide name="more-wallets" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-connected-world-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('More Wallets') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('You can also connect other wallets like NWC or LNbits and manage everything in one place.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 10: App Lock -->
          <q-carousel-slide name="security" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-fingerprint-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Keep It Locked') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Protect your app with Face ID, fingerprint, or your phone\'s lock screen. Turn it on in Settings.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 11: Backup Reminder -->
          <q-carousel-slide name="backup" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-secure-login-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Back Up Your Words') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Your 12 recovery words are the only way to restore your wallet. Write them down and keep them somewhere safe.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 12: Kiosk Mode -->
          <q-carousel-slide name="kiosk" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-receipt-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Kiosk Mode') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Hand your device to an employee. They can only take payments while your wallet stays locked behind a PIN.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 13: Bitcoin Lessons -->
          <q-carousel-slide name="lessons" class="wizard-slide">
            <div class="slide-content">
              <img src="/Learn and Earn/education.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('Bitcoin Lessons') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Learn about Bitcoin step by step and earn real sats along the way. The more you learn, the more you earn.') }}
              </p>
            </div>
          </q-carousel-slide>

          <!-- 14: You're ready! -->
          <q-carousel-slide name="ready" class="wizard-slide">
            <div class="slide-content">
              <img src="/Onboarding wizard spark/storyset-setup-wizard-bro.svg" class="slide-illustration" alt="" />
              <h2 class="slide-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ $t('You\'re All Set!') }}
              </h2>
              <p class="slide-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Your wallet is ready. Send, receive, and manage your Bitcoin from one app. Enjoy!') }}
              </p>
            </div>
          </q-carousel-slide>
        </template>
      </q-carousel>

      <!-- Dots -->
      <div class="wizard-dots">
        <span
          v-for="step in activeSlides"
          :key="step"
          class="dot"
          :class="{ active: currentSlide === step }"
          @click="currentSlide = step"
        />
      </div>

      <!-- Navigation -->
      <div class="wizard-nav">
        <!-- Last core slide: two buttons (Spark mode only) -->
        <template v-if="currentSlide === 'savings' && !showExtended && isSparkMode">
          <q-btn
            unelevated
            no-caps
            :label="$t('Let\'s go!')"
            @click="goToWallet"
            class="wizard-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          />
          <q-btn
            flat
            no-caps
            :label="$t('Tell me more')"
            @click="expandWizard"
            class="wizard-btn-secondary"
          />
        </template>

        <!-- Final extended slide -->
        <template v-else-if="currentSlide === lastSlide">
          <q-btn
            unelevated
            no-caps
            :label="$t('Let\'s go!')"
            @click="goToWallet"
            class="wizard-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          />
        </template>

        <!-- All other slides -->
        <template v-else>
          <q-btn
            unelevated
            no-caps
            :label="$t('Next')"
            @click="nextSlide"
            class="wizard-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          />
        </template>
      </div>
    </div>
  </q-page>
</template>

<script>
/**
 * Wizard modes:
 *   'spark'      — Full Spark onboarding (3 Spark screens + "Tell me more" gate + all features)
 *   'nwc-lnbits' — NWC / LNbits onboarding (features only, no Spark-specific screens)
 *
 * Query params:
 *   ?mode=nwc-lnbits  — triggers the non-Spark flow
 *   ?full=true         — shows all screens immediately (used by Settings "Onboarding Guide")
 */

// Spark-only intro screens (Business wallet, Personal wallet, Savings)
const SPARK_INTRO = ['personal', 'business', 'savings']

// All feature screens (shown after Spark intro or standalone for NWC/LNbits)
const ALL_FEATURES = [
  'send-receive', 'transfer', 'auto-transfer', 'history',
  'contacts', 'display', 'more-wallets', 'security', 'backup', 'kiosk', 'lessons', 'ready'
]

// NWC/LNbits: only features that apply (no internal transfer, auto-transfer, or seed backup)
const NWC_LNBITS_FEATURES = [
  'send-receive', 'history', 'contacts', 'display', 'more-wallets', 'security', 'lessons', 'ready'
]

export default {
  name: 'SparkSuccessWizard',
  data() {
    const mode = this.$route.query.mode || 'spark'
    const isSparkMode = mode !== 'nwc-lnbits'
    return {
      currentSlide: isSparkMode ? 'personal' : 'send-receive',
      showExtended: !isSparkMode || this.$route.query.full === 'true',
      isSparkMode
    }
  },
  computed: {
    activeSlides() {
      if (!this.isSparkMode) return NWC_LNBITS_FEATURES
      return this.showExtended ? [...SPARK_INTRO, ...ALL_FEATURES] : SPARK_INTRO
    },
    lastSlide() {
      return this.activeSlides[this.activeSlides.length - 1]
    }
  },
  methods: {
    nextSlide() {
      const idx = this.activeSlides.indexOf(this.currentSlide)
      if (idx < this.activeSlides.length - 1) {
        this.currentSlide = this.activeSlides[idx + 1]
      }
    },
    expandWizard() {
      this.showExtended = true
      this.$nextTick(() => {
        this.currentSlide = EXTENDED_SLIDES[0]
      })
    },
    goToWallet() {
      this.$router.replace('/wallet')
    }
  }
}
</script>

<style scoped>
.wizard-page {
  min-height: 100vh;
  display: flex;
  justify-content: center;
}

.bg-dark { background: var(--bg-primary); }
.bg-light { background: var(--bg-primary); }

.wizard-container {
  width: 100%;
  max-width: 420px;
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}

/* ── Top bar ── */
.wizard-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 0;
  flex-shrink: 0;
}

.wizard-logo-img {
  height: 30px;
  width: auto;
  display: block;
}

.skip-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
}

/* ── Carousel (fills all space between topbar and footer) ── */
.wizard-carousel {
  width: 100%;
  flex: 1;
  min-height: 0;
  background: transparent !important;
}

.wizard-slide {
  padding: 0;
}

.slide-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  height: 100%;
  padding: 0 24px;
}

/* ── Illustration ── */
.slide-illustration {
  width: 90%;
  max-width: 380px;
  max-height: 42vh;
  object-fit: contain;
  margin-top: auto;
  margin-bottom: 0;
  flex-shrink: 1;
}

/* Spacer between illustration and text */
.slide-title {
  font-family: 'Manrope', sans-serif;
  font-size: 24px;
  font-weight: 800;
  line-height: 1.2;
  margin: 40px 0 8px 0;
  flex-shrink: 0;
}

.slide-text {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 400;
  line-height: 1.55;
  margin: 0 0 auto 0;
  max-width: 310px;
  flex-shrink: 0;
}

/* ── Dot indicators ── */
.wizard-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 12px 20px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
}

body.body--light .dot {
  background: rgba(0, 0, 0, 0.15);
}

.dot.active {
  width: 24px;
  border-radius: 4px;
  background: linear-gradient(90deg, #059573, #15DE72);
}

/* ── Navigation buttons ── */
.wizard-nav {
  padding: 0 20px 24px;
  padding-bottom: max(24px, var(--safe-bottom, 16px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.wizard-btn {
  width: 100%;
  padding: 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 600;
  border-radius: 16px;
}

.wizard-btn-secondary {
  width: 100%;
  padding: 10px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  border-radius: 12px;
}

.wizard-btn-secondary:hover {
  color: var(--text-primary);
}

/* ── Responsive ── */
@media (max-height: 700px) {
  .slide-illustration {
    max-height: 32vh;
  }
  .slide-title { font-size: 20px; margin-top: 20px; }
  .slide-text { font-size: 13px; }
  .wizard-dots { padding: 8px 20px; }
  .wizard-nav { padding-bottom: max(16px, var(--safe-bottom, 16px)); }
}

@media (max-width: 380px) {
  .slide-illustration { width: 85%; }
  .slide-title { font-size: 20px; }
  .slide-text { font-size: 14px; }
}
</style>
