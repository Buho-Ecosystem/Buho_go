<template>
  <q-page class="spend-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <SettingsHubHeader :title="$t('Spend')" />

    <div class="spend-content">
      <button type="button" class="map-card" @click="$router.push('/map')">
        <span class="map-card-preview"><SpendMapPreview /></span>
        <span class="map-card-body">
          <span class="map-card-text">
            <span class="map-card-label">
              <Icon icon="tabler:map-pin-filled" width="14" height="14" class="map-card-pin" />
              {{ $t('Bitcoin Map') }}
            </span>
            <span class="map-card-title">{{ $t('Find shops that accept Bitcoin near you') }}</span>
          </span>
          <Icon icon="tabler:chevron-right" class="spend-row-chevron" width="18" height="18" />
        </span>
      </button>

      <div class="spend-rows">
        <button
          type="button"
          class="spend-row"
          :class="{ 'spend-row--waiting': shopNeedsAttention }"
          @click="onShopSelect"
        >
          <span class="spend-row-icon spend-row-icon--brand">
            <img src="/NadaNada/NadaNada.png" alt="" />
          </span>
          <span class="spend-row-text">
            <span class="spend-row-title">{{ $t('eSIM & VPN') }}</span>
            <span class="spend-row-sub">{{ shopRowMeta }}</span>
          </span>
          <Icon icon="tabler:chevron-right" class="spend-row-chevron" width="18" height="18" />
        </button>

        <!-- Bitrefill: gift cards, mobile top-ups and more, bought inside
             the app and paid from this wallet. The store is not built yet;
             the door is here so the shape of Spend is settled. -->
        <button type="button" class="spend-row" @click="showBitrefill = true">
          <span class="spend-row-icon spend-row-icon--brand">
            <img src="/Bitrefill/bitrefill-mark.png" alt="" />
          </span>
          <span class="spend-row-text">
            <span class="spend-row-title">Bitrefill</span>
            <span class="spend-row-sub">{{ $t('Gift cards, mobile top-ups and more') }}</span>
          </span>
          <Icon icon="tabler:chevron-right" class="spend-row-chevron" width="18" height="18" />
        </button>

        <!-- Retired: the online-shops directory was a list of merchants that
             take Bitcoin. Too technical for the people this tab is for, so
             Bitrefill takes its place. The page, store and service stay in
             the repo unrouted (see router/routes.js) until we decide to
             delete them.
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
        -->

        <button
          type="button"
          class="spend-row"
          :class="{ 'spend-row--active': earnSatsActive }"
          @click="onEarnSatsSelect"
        >
          <span class="spend-row-icon spend-row-icon--brand spend-row-icon--earn">
            <img :src="earnMark" alt="" />
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
    <ComingSoonSheet
      v-model="showBitrefill"
      :title="$t('Bitrefill is on its way')"
      :message="$t('Buy gift cards and mobile top-ups with your bitcoin, right here. We are building it now.')"
    >
      <template #brand><img src="/Bitrefill/bitrefill-mark.png" alt="" /></template>
    </ComingSoonSheet>
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import { Capacitor } from '@capacitor/core';
import { useEarnStore } from '../stores/earn';
import { useNadanadaOrdersStore } from '../stores/nadanadaOrders';
import { EARN_BRAND } from '../services/earnBrand';
import SettingsHubHeader from '../components/settings/SettingsHubHeader.vue';
import SettingsHubNav from '../components/settings/SettingsHubNav.vue';
import GetAppDialog from '../components/GetAppDialog.vue';
import ComingSoonSheet from '../components/ComingSoonSheet.vue';
import SpendMapPreview from '../components/settings/SpendMapPreview.vue';

/**
 * Spend tab of the Settings / Identity / Spend hub - the default landing
 * tab. The Bitcoin Map is the hero (full width, tallest, a drawn map
 * above its title); eSIM & VPN, Bitrefill, and Learn & Earn follow as one
 * consistent stack of full-width rows.
 */
export default {
  name: 'SpendPage',
  components: { Icon, SettingsHubHeader, SettingsHubNav, GetAppDialog, ComingSoonSheet, SpendMapPreview },
  data() {
    return {
      showGetAppDialog: false,
      getAppDialogMessage: '',
      showBitrefill: false,
      earnMark: EARN_BRAND.logo,
    };
  },
  mounted() {
    // Native-only redirect. A direct web navigation to /shop is bounced here
    // by the router guard (see router/routes.js) with ?getApp=shop. Open the
    // same dialog the row tap opens, so both paths say the same thing.
    if (this.$route.query.getApp === 'shop') {
      this.$nextTick(() => this.onShopSelect());
    }
  },

  computed: {
    isNativeApp() {
      return Capacitor.isNativePlatform();
    },
    /** An order the user paid for but never received must be findable without
     *  walking back into the shop first. Reads local storage only, no network. */
    shopNeedsAttention() {
      return useNadanadaOrdersStore().attentionCount > 0;
    },
    shopRowMeta() {
      const n = useNadanadaOrdersStore().attentionCount;
      if (!n) return this.$t('Mobile data and a private connection, paid in bitcoin');
      return n === 1
        ? this.$t('1 order is waiting to be delivered')
        : this.$t('{n} orders are waiting to be delivered', { n });
    },
    bitcoinLessonsMeta() {
      const earn = useEarnStore();
      if (earn.claimableAmount > 0) {
        return this.$t('Claim {n} sats!', { n: earn.claimableAmount });
      }
      if (earn.totalEarned > 0) {
        return this.$t('{n} sats earned', { n: earn.totalEarned });
      }
      return this.$t('Learn in short lessons and earn real bitcoin');
    },
    earnSatsActive() {
      const earn = useEarnStore();
      return earn.claimableAmount > 0;
    },
  },
  methods: {
    onShopSelect() {
      if (!this.isNativeApp) {
        // The shop talks to nadanada directly, and nadanada's API is not
        // reachable from a browser. Say so plainly instead of routing into a
        // screen that could only fail.
        this.promptForApp(
          this.$t('The eSIM and VPN shop is only available in the BuhoGO Android app. Install it from Google Play to buy and manage your plans.')
        );
        return;
      }
      this.$router.push('/shop');
    },

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
   Bitcoin Map card - the primary card on this page: a drawn map on top
   (components/settings/SpendMapPreview.vue), the label and headline on
   the plain card below it, so the text never competes with the map.
   Size and position (first, full width, tallest) mark it as the main
   thing here; the chevron says it opens a screen, like the rows below.
   ================================================================== */
.map-card {
  all: unset;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  margin: 4px 0 20px;
  overflow: hidden;
  border-radius: 22px;
  background-color: var(--bg-card);
  border: 1px solid var(--border-card);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.16s ease, border-color 0.18s ease;
}
body.body--dark .map-card {
  border-color: rgba(255, 255, 255, 0.08);
}
.map-card:active {
  transform: scale(0.985);
  border-color: var(--map-accent);
}
.map-card:focus-visible {
  outline: 2px solid var(--map-accent);
  outline-offset: 2px;
}
.map-card-preview {
  display: block;
  height: 188px;
}
.map-card-body {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px 18px;
}
.map-card-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
}
.map-card-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}
.map-card-pin {
  color: #E07F0B;
}
body.body--dark .map-card-pin {
  color: #F7931A;
}
.map-card-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  /* German and Spanish run longer and wrap to two or three lines. */
  line-height: 1.3;
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
/* A partner mark fills the tile edge to edge instead of sitting as a glyph
   on the accent. */
.spend-row-icon--brand {
  background: transparent;
  overflow: hidden;
}
.spend-row-icon--brand img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
/* The Learn & Earn tile is cream like the light page, so it gets a hairline
   edge there; on the dark page it stands out on its own. */
.spend-row-icon--earn {
  position: relative;
}
.spend-row-icon--earn::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(120, 90, 40, 0.14);
  pointer-events: none;
}
body.body--dark .spend-row-icon--earn::after {
  display: none;
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

/* An undelivered order is a problem to resolve, not a reward to collect, so it
   gets its own calm amber state rather than the green pulse used for claims. */
.spend-row--waiting {
  border-color: rgba(247, 147, 26, 0.45);
  background-color: rgba(247, 147, 26, 0.12);
}
.spend-row--waiting .spend-row-sub {
  color: #b45309;
  font-weight: 600;
}
body.body--dark .spend-row--waiting .spend-row-sub { color: #fbbf24; }

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
