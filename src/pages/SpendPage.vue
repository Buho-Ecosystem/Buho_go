<template>
  <q-page class="spend-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <SettingsHubHeader :title="$t('Spend')" />

    <div class="spend-content">
      <div
        class="map-hero-card"
        role="button"
        tabindex="0"
        @click="$router.push('/map')"
        @keydown.enter="$router.push('/map')"
        @keydown.space.prevent="$router.push('/map')"
      >
        <span class="hero-watermark--map" aria-hidden="true"></span>
        <span class="hero-watermark--map-lift" aria-hidden="true"></span>
        <span class="map-hero-scrim" aria-hidden="true"></span>
        <span class="map-hero-text">
          <span class="map-hero-label">{{ $t('Bitcoin Map') }}</span>
          <span class="map-hero-title">{{ $t('Find shops that accept Bitcoin near you') }}</span>
        </span>
      </div>

      <div class="spend-rows">
        <button type="button" class="spend-row" @click="$router.push('/shop')">
          <span class="spend-row-icon">
            <Icon icon="tabler:device-sim" width="22" height="22" />
          </span>
          <span class="spend-row-text">
            <span class="spend-row-title">{{ $t('eSIM & VPN') }}</span>
            <span class="spend-row-sub">{{ $t('Mobile data and a private connection, paid in bitcoin') }}</span>
          </span>
          <Icon icon="tabler:chevron-right" class="spend-row-chevron" width="18" height="18" />
        </button>

        <button type="button" class="spend-row" @click="$router.push('/online-shops')">
          <span class="spend-row-icon">
            <Icon icon="tabler:building-store" width="22" height="22" />
          </span>
          <span class="spend-row-text">
            <span class="spend-row-title">{{ $t('Spend online') }}</span>
            <span class="spend-row-sub">{{ $t('Shops worldwide that accept Bitcoin') }}</span>
          </span>
          <Icon icon="tabler:chevron-right" class="spend-row-chevron" width="18" height="18" />
        </button>

        <button
          type="button"
          class="spend-row"
          :class="{ 'spend-row--active': earnSatsActive }"
          @click="onEarnSatsSelect"
        >
          <span class="spend-row-icon">
            <Icon icon="tabler:trophy" width="22" height="22" />
          </span>
          <span class="spend-row-text">
            <span class="spend-row-title">{{ $t('Learn & Earn') }}</span>
            <span class="spend-row-sub">{{ bitcoinLessonsMeta }}</span>
          </span>
          <Icon icon="tabler:chevron-right" class="spend-row-chevron" width="18" height="18" />
        </button>
      </div>
    </div>

    <SettingsHubNav />
    <GetAppDialog v-model="showGetAppDialog" :message="getAppDialogMessage" />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import { Capacitor } from '@capacitor/core';
import { useEarnStore } from '../stores/earn';
import SettingsHubHeader from '../components/settings/SettingsHubHeader.vue';
import SettingsHubNav from '../components/settings/SettingsHubNav.vue';
import GetAppDialog from '../components/GetAppDialog.vue';

/**
 * Spend tab of the Settings / Identity / Spend hub - the default landing
 * tab. The Bitcoin Map is the hero (full width, tallest, map photo as
 * the actual background); eSIM & VPN, Spend online, and Earn Sats follow
 * as one consistent stack of full-width rows.
 */
export default {
  name: 'SpendPage',
  components: { Icon, SettingsHubHeader, SettingsHubNav, GetAppDialog },
  data() {
    return {
      showGetAppDialog: false,
      getAppDialogMessage: '',
    };
  },
  computed: {
    isNativeApp() {
      return Capacitor.isNativePlatform();
    },
    bitcoinLessonsMeta() {
      const earn = useEarnStore();
      if (earn.claimableAmount > 0) {
        return this.$t('Claim {n} sats!', { n: earn.claimableAmount });
      }
      if (earn.totalEarned > 0) {
        return this.$t('{n} sats earned', { n: earn.totalEarned });
      }
      return this.$t('Earn real sats');
    },
    earnSatsActive() {
      const earn = useEarnStore();
      return earn.claimableAmount > 0;
    },
  },
  methods: {
    onEarnSatsSelect() {
      if (!this.isNativeApp) {
        // Learn & Earn pays out real sats. On the web build there is no way
        // to stop a user from spinning up fresh wallets to farm rewards, so
        // the whole feature is native-only - surface that honestly instead
        // of routing into the earn flow.
        this.promptForLearnEarnApp();
        return;
      }
      this.$router.push('/learn');
    },
    promptForApp(message) {
      this.getAppDialogMessage = message;
      this.showGetAppDialog = true;
    },
    promptForLearnEarnApp() {
      this.promptForApp(
        this.$t('Learn & Earn is only available in the BuhoGO Android app. Install it from Google Play to complete lessons and earn sats.')
      );
    },
  },
};
</script>

<style scoped>
/* SettingsHubHeader is sticky and already applies its own safe-top inset,
   so cancel the app-wide .q-page top padding here or it would be applied
   twice. */
.spend-page {
  padding-top: 0;
}

.bg-dark {
  background: #0C0C0C;
  color: #FFF;
}

.bg-light {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.spend-content {
  padding: 0 16px;
  padding-bottom: calc(96px + var(--safe-bottom, 0px));
}

/* ==================================================================
   Bitcoin Map hero - the primary card on this page. Tall, full-bleed
   map photo as the actual card background (not a faint corner accent),
   with just a label + headline overlaid top-left and a light scrim
   for legibility. Size and position alone (first, full-width, tallest)
   signal "this is the main thing here" - no icon or badge needed.
   ================================================================== */
.map-hero-card {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 280px;
  margin: 4px 0 20px;
  padding: 24px;
  border-radius: 22px;
  background-color: var(--bg-card);
  border: 1px solid var(--border-card);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.16s ease, border-color 0.18s ease;
  position: relative;
  overflow: hidden;
}
body.body--dark .map-hero-card {
  border-color: rgba(255, 255, 255, 0.08);
}
.map-hero-card:active {
  transform: scale(0.985);
  border-color: var(--map-accent);
}
.map-hero-text {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 90%;
  text-align: left;
}
.map-hero-label {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.01em;
}
.map-hero-title {
  font-family: 'Manrope', sans-serif;
  font-size: 20px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  /* Generous line-height - German/Spanish translations run longer than
     English and wrap to 2-3 lines here, and a tight line-height at this
     font-weight/size reads as overlapping rather than just wrapped. */
  line-height: 1.4;
}
.hero-watermark--map {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  user-select: none;
  background-image: url('/maps/btc-map-light.jpg');
  background-size: cover;
  background-position: center;
  opacity: 0.95;
}
body.body--dark .hero-watermark--map {
  background-image: url('/maps/btc-map-dark.jpg');
  opacity: 1;
}
/* The dark map export itself is very low-contrast (muted grey roads on
   near-black, unlike the light export's crisp roads/labels) - multiple
   users reported it reads as barely-there. A plain brightness() filter
   fixes that but clips the pins' red channel before green catches up,
   shifting them from Bitcoin-orange to yellow. A mix-blend-mode: screen
   layer lifts dark pixels a lot while leaving already-bright pixels (the
   pins) mostly alone, so roads become legible without discoloring them. */
.hero-watermark--map-lift {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  display: none;
}
body.body--dark .hero-watermark--map-lift {
  display: block;
  background: rgba(150, 150, 150, 0.35);
  mix-blend-mode: screen;
}
.map-hero-scrim {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.65) 0%, rgba(255, 255, 255, 0.15) 40%, rgba(255, 255, 255, 0) 65%);
}
body.body--dark .map-hero-scrim {
  background: linear-gradient(180deg, rgba(12, 12, 12, 0.65) 0%, rgba(12, 12, 12, 0.15) 40%, rgba(12, 12, 12, 0) 65%);
}

/* ==================================================================
   Spend rows - eSIM & VPN / Spend online / Earn Sats, presented as one
   consistent stack of full-width rows (icon, title + meta, chevron)
   rather than a mixed grid-plus-standalone-card layout, so all three
   "things to do with sats" read as equal peers. Earn Sats' active
   (claimable) tint + pulse reuses the same green tokens the bottom nav
   pill uses for its active tab, so "something is waiting for you"
   reads the same way in both places.
   ================================================================== */
.spend-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.spend-row {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 16px;
  border-radius: var(--radius-md, 16px);
  background-color: var(--bg-card);
  border: 1px solid var(--border-card);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), inset 0 -1px 0 rgba(40, 34, 20, 0.03);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.16s ease, border-color 0.18s ease, background-color 0.18s ease;
}
body.body--dark .spend-row {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(0, 0, 0, 0.40);
}
.spend-row:active {
  transform: scale(0.985);
}
.spend-row-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  color: var(--map-cta-fg);
  background: var(--map-accent);
}
.spend-row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.spend-row-title {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.spend-row-sub {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.spend-row-chevron {
  flex-shrink: 0;
  color: var(--text-muted);
}

.spend-row--active {
  position: relative;
  border-color: rgba(21, 222, 114, 0.4);
  background-color: rgba(21, 222, 114, 0.14);
}
.spend-row--active .spend-row-sub {
  color: #15DE72;
  font-weight: 600;
}
.spend-row--active::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  animation: spend-row-pulse 2.4s ease-out infinite;
}
@keyframes spend-row-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(21, 222, 114, 0.35); }
  70%  { box-shadow: 0 0 0 10px rgba(21, 222, 114, 0); }
  100% { box-shadow: 0 0 0 0 rgba(21, 222, 114, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .spend-row--active::after {
    animation: none;
  }
}
</style>
