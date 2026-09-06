<template>
  <q-page class="about-page">
    <!-- Header — header-owns-inset pattern (see TransactionDetails.vue).
         Sticky top MUST stay 0; the header's own padding absorbs the
         safe-area inset instead. A non-zero sticky top displaces the
         header into the content at rest on Android (overflow-x:hidden
         promotes this page to a non-scrolling sticky-container ancestor). -->
    <div class="page-header">
      <q-btn flat round dense @click="$router.back()" class="back-btn glass-back-btn">
        <Icon icon="tabler:chevron-left" width="20" height="20" />
      </q-btn>
      <div class="header-title">{{ $t('About BuhoGO') }}</div>
      <div class="header-spacer"></div>
    </div>

    <!-- No cards on this page: the story sits directly on the background
         and hairlines carry the structure. The only boxed things left are
         real controls (version pill, donate buttons) and the official
         store badges, which are boxes by design. -->
    <div class="about-content">
      <!-- Identity hero: bare mark, name, version. The version pill is the
           update checker; a dot appears when a newer build is waiting. -->
      <div class="about-hero">
        <img src="/buho_logo.svg" alt="" class="about-hero-logo" />
        <div class="about-hero-body">
          <div class="about-hero-title-row">
            <span class="about-hero-name">BuhoGO</span>
            <button
              type="button"
              class="about-version-pill"
              :class="{ 'about-version-pill--update': updateStore.hasUpdate }"
              @click="onVersionClick"
            >
              <span v-if="updateStore.hasUpdate" class="about-version-dot" aria-hidden="true"></span>
              v{{ appVersion }}
            </button>
          </div>
          <div class="about-version-caption">{{ versionCaption }}</div>
        </div>
      </div>

      <p class="about-mission">
        {{ $t("BuhoGO started as a wallet for our friends. We keep it simple and skip the confusing tech talk, because that's how we'd want it too.") }}
      </p>

      <!-- Plain rows, full-bleed tap targets, one hairline between. -->
      <div class="about-list">
        <SettingsRow
          icon="tabler:school"
          :label="$t('Onboarding Guide')"
          :caption="$t('Learn about all BuhoGO features')"
          @click="$router.push('/spark-success?full=true')"
        />
        <SettingsRow
          icon="tabler:brand-github"
          :label="$t('View source on GitHub')"
          @click="openGithubRepo"
        />
      </div>

      <div class="about-group">
        <div class="about-label">{{ $t('Join our community') }}</div>
        <div class="about-list">
          <!-- Both channels wear the same filled 20px brand tile, so the
               pair reads as one set. -->
          <SettingsRow label="Telegram" @click="openTelegramCommunity">
            <template #icon>
              <span class="about-brand-tile about-brand-tile--telegram">
                <Icon icon="tabler:brand-telegram" width="14" height="14" />
              </span>
            </template>
          </SettingsRow>
          <SettingsRow
            label="Nostr"
            :caption="nostrCommunityUrl ? '' : $t('Soon')"
            @click="openNostrCommunity"
          >
            <template #icon>
              <img src="/nostr/nostr.png" alt="" class="about-brand-tile" />
            </template>
          </SettingsRow>
        </div>
      </div>

      <div class="about-group">
        <div class="about-label">{{ $t('Get the app') }}</div>
        <div class="store-badge-row">
          <button type="button" class="store-badge-btn" @click="openPlayStore">
            <span class="store-badge-playstore">
              <Icon icon="logos:google-play-icon" width="24" height="24" />
              <span class="store-badge-text">
                <span class="store-badge-eyebrow">GET IT ON</span>
                <span class="store-badge-title">Google Play</span>
              </span>
            </span>
          </button>

          <button type="button" class="store-badge-btn" @click="openZapstore">
            <img src="/ZapStore/get-it-on-zapstore.png" alt="Get it on Zapstore" class="store-badge-img" />
          </button>
        </div>
      </div>

      <!-- The ask closes the page: story first, then the ways in, then
           support for the people who just read why it exists. -->
      <SupportBuhoGo />
    </div>
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import { version } from '../../package.json';
import SettingsRow from '../components/settings/SettingsRow.vue';
import SupportBuhoGo from '../components/settings/SupportBuhoGo.vue';
import { useUpdateStore } from '../stores/update';

export default {
  name: 'AboutPage',
  components: { Icon, SettingsRow, SupportBuhoGo },
  setup() {
    return { updateStore: useUpdateStore() };
  },
  data() {
    return {
      nostrCommunityUrl: 'https://nostr-ecosystem.netlify.app/join/g/groups.0xchat.com/85016a489c551428a50c339c75b6931a?n=BuhoGO&a=Public+discussion%2C+support%2C+and+updates+for+the+Buho+GO+Wallet%3A+a+native+wallet+interface+for+Spark%2C+Ark%2C+LNbits%2C+Nostr+Wallet+Connect%2C+and+&p=https%3A%2F%2Fblossom.primal.net%2Fd816ffbd78b10591710a1be9deca91700fe278e50250a07f0b1e421f0db03748',
    };
  },
  computed: {
    appVersion() {
      return version;
    },
    versionCaption() {
      if (this.updateStore.isRequired) return this.$t('Update required');
      if (this.updateStore.hasUpdate) return this.$t('A newer version is ready');
      if (this.updateStore.status === 'checking') return this.$t('Checking for updates...');
      return this.$t('Tap to check for updates');
    },
  },
  methods: {
    async onVersionClick() {
      let result = null;
      if (!this.updateStore.hasUpdate) {
        result = await this.updateStore.checkForUpdates({ force: true });
      }
      if (this.updateStore.hasUpdate) {
        this.updateStore.openSheet();
        return;
      }
      if (result?.error || this.updateStore.status === 'error') {
        this.$q.notify({
          message: this.$t('Could not check for updates. Please try again.'),
          icon: 'cloud_off',
          timeout: 3000,
        });
        return;
      }
      if (result?.skipped === 'kiosk') {
        this.$q.notify({
          message: this.$t('Update checks are unavailable in kiosk mode.'),
          icon: 'info',
          timeout: 3000,
        });
        return;
      }
      this.$q.notify({
        message: this.$t('BuhoGO is up to date'),
        icon: 'check_circle',
        timeout: 2500,
      });
    },

    openGithubRepo() {
      window.open('https://github.com/Buho-Ecosystem/Buho_go', '_blank', 'noopener,noreferrer');
    },
    openTelegramCommunity() {
      window.open('https://telegram.me/+cpmyopRYnKRlOTRi', '_blank', 'noopener,noreferrer');
    },
    openNostrCommunity() {
      if (!this.nostrCommunityUrl) {
        this.$q.notify({
          type: 'info',
          message: this.$t('Nostr community coming soon'),
          timeout: 2500,
        });
        return;
      }
      window.open(this.nostrCommunityUrl, '_blank', 'noopener,noreferrer');
    },
    openPlayStore() {
      window.open('https://play.google.com/store/apps/details?id=mybuho.buhogo', '_blank', 'noopener,noreferrer');
    },
    openZapstore() {
      window.open(
        'https://zapstore.dev/apps/naddr1qqxk67tzw45x7tnzw45x7em0qgs83nn04fezvsu89p8xg7axjwye2u67errat3dx2um725fs7qnrqlgrqsqqqlstrk2q4u',
        '_blank',
        'noopener,noreferrer'
      );
    },
  },
};
</script>

<style scoped>
.about-page {
  background: var(--bg-secondary);
  min-height: 100vh;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
  /* The header owns the top safe-area inset, so the global .q-page top
     padding is cancelled here. */
  padding-top: 0;
}

/* Header — sticky offset must stay 0; see the template comment. */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(0.75rem + var(--safe-top, 0px)) 1rem 0.75rem;
  background: var(--bg-primary);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-title {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
  flex: 1;
  text-align: center;
}

/* Mirrors the back button's width so the title stays optically
   centered, same trick used across the app's other page headers. */
.header-spacer {
  width: 40px;
  flex-shrink: 0;
}

.about-content {
  padding: 1.25rem 1rem calc(1.5rem + var(--safe-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 480px;
  margin: 0 auto;
  box-sizing: border-box;
}

/* ----------------------------------------------------------------
   Identity hero — bare mark, no tile, no card.
---------------------------------------------------------------- */
.about-hero {
  display: flex;
  align-items: center;
  gap: 14px;
}

.about-hero-logo {
  width: 52px;
  height: 52px;
  object-fit: contain;
  flex-shrink: 0;
}

.about-hero-body {
  flex: 1;
  min-width: 0;
}

.about-hero-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.about-hero-name {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

/* The version pill IS the update checker: quiet by default, ringed with
   a dot when a newer build waits. The one boxed control up here. */
.about-version-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 3px 10px;
  border: 1px solid var(--border-card);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.1s ease;
}

.about-version-pill:active {
  transform: scale(0.96);
}

.about-version-pill--update {
  border-color: #15DE72;
  color: var(--text-primary);
}

.about-version-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #15DE72;
}

.about-version-caption {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-muted);
}

.about-mission {
  margin: -8px 0 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-secondary);
  max-width: 44ch;
}

/* ----------------------------------------------------------------
   Plain lists — rows bleed to the screen edges so their built-in
   16px inset lines up with the page padding, and a single hairline
   separates neighbours. No wrapper card.
---------------------------------------------------------------- */
.about-list {
  margin: 0 -1rem;
  border-top: 1px solid var(--border-card);
  border-bottom: 1px solid var(--border-card);
}

.about-list :deep(.settings-row + .settings-row) {
  border-top: 1px solid var(--border-card);
}

.about-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* One label voice for every group on the page (the support block
   below uses the same recipe). */
.about-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

/* Filled 20px brand tiles so both community rows read as one set. */
.about-brand-tile {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  object-fit: cover;
}

.about-brand-tile--telegram {
  background: #26A5E4;
  color: #FFFFFF;
}

/* ----------------------------------------------------------------
   Downloads — the official badges are boxes by design; left-aligned
   like everything else on the page.
---------------------------------------------------------------- */
.store-badge-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.store-badge-btn {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.1s ease;
}

.store-badge-btn:active {
  transform: scale(0.97);
}

.store-badge-img {
  height: 44px;
  width: auto;
  display: block;
}

.store-badge-playstore {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 44px;
  padding: 0 14px;
  border-radius: 10px;
  background: #000;
  border: 1.5px solid #A6A6A6;
  box-sizing: border-box;
}

.store-badge-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.store-badge-eyebrow {
  font-family: 'Manrope', sans-serif;
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #A6A6A6;
}

.store-badge-title {
  font-family: 'Manrope', sans-serif;
  font-size: 14.5px;
  font-weight: 700;
  color: #fff;
  margin-top: 2px;
}
</style>
