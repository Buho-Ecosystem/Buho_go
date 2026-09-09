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

    <div class="about-content">
      <!-- Identity hero: the mark, the name, and the version as one calm
           block - the platform's own About pages lead with who the app
           is before what it links to. The version pill is the update
           checker; a dot appears when a newer build is waiting. -->
      <div class="about-hero">
        <div class="about-hero-mark">
          <img src="/buho_logo.svg" alt="" class="about-hero-logo" />
        </div>
        <div class="about-hero-name">BuhoGO</div>
        <button
          type="button"
          class="about-version-pill"
          :class="{ 'about-version-pill--update': updateStore.hasUpdate }"
          @click="onVersionClick"
        >
          <span v-if="updateStore.hasUpdate" class="about-version-dot" aria-hidden="true"></span>
          v{{ appVersion }}
        </button>
        <div class="about-version-caption">{{ versionCaption }}</div>
      </div>

      <p class="about-mission">
        {{ $t("BuhoGO started as a wallet for our friends. We keep it simple and skip the confusing tech talk, because that's how we'd want it too.") }}
      </p>

      <!-- The ask lives next to the story it belongs to. -->
      <SupportBuhoGo />

      <SettingsSection>
        <SettingsRow
          icon="tabler:brand-github"
          :label="$t('View source on GitHub')"
          @click="openGithubRepo"
        />

        <div class="about-tile-block">
          <div class="about-tile-label">{{ $t('Join our community') }}</div>
          <div class="channel-row">
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
        </div>
      </SettingsSection>

      <div class="about-downloads">
        <div class="about-tile-label about-tile-label--freestanding">{{ $t('Get the app') }}</div>
        <div class="store-badge-row">
          <button type="button" class="store-badge-btn" @click="openPlayStore">
            <span class="store-badge-playstore">
              <Icon icon="logos:google-play-icon" width="26" height="26" />
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
    </div>
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import { version } from '../../package.json';
import SettingsSection from '../components/settings/SettingsSection.vue';
import SettingsRow from '../components/settings/SettingsRow.vue';
import SupportBuhoGo from '../components/settings/SupportBuhoGo.vue';
import { useUpdateStore } from '../stores/update';

export default {
  name: 'AboutPage',
  components: { Icon, SettingsSection, SettingsRow, SupportBuhoGo },
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
  padding: 1.25rem 1rem calc(2rem + var(--safe-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 21px;
  max-width: 480px;
  margin: 0 auto;
  box-sizing: border-box;
}

/* ----------------------------------------------------------------
   Identity hero
---------------------------------------------------------------- */
.about-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 13px;
}

.about-hero-mark {
  width: 84px;
  height: 84px;
  border-radius: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.08);
}

.about-hero-logo {
  width: 56px;
  height: 56px;
  object-fit: contain;
}

.about-hero-name {
  margin-top: 13px;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

/* The version pill IS the update checker: quiet by default, ringed with
   a dot when a newer build waits. 44pt target via padding. */
.about-version-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  min-height: 32px;
  padding: 4px 14px;
  border: 1px solid var(--border-card);
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 12.5px;
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
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #15DE72;
}

.about-version-caption {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--text-muted);
}

.about-mission {
  margin: 0 auto;
  padding: 0 0.5rem;
  max-width: 40ch;
  font-size: 14px;
  line-height: 1.55;
  text-align: center;
  color: var(--text-secondary);
}

/* ----------------------------------------------------------------
   Freeform content inside SettingsSection (same pattern as before):
   the tile block isn't a .settings-row so it draws no auto-divider.
---------------------------------------------------------------- */
.about-tile-block {
  padding: 14px 16px;
}

.about-tile-label {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.about-tile-label--freestanding {
  text-align: center;
}

/* ----------------------------------------------------------------
   Community channels — Telegram / Nostr. Soft brand-tinted circles
   matching the app's quiet-tint language.
---------------------------------------------------------------- */
.channel-row {
  display: flex;
  justify-content: center;
  gap: 28px;
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

.channel-icon--telegram {
  background: rgba(38, 165, 228, 0.14);
  color: #26A5E4;
}

/* The Nostr PNG already carries its own purple fill and mark, so the
   tile just frames it at the same footprint as the other one. */
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
   Downloads — real "Get it on" store badges, centered as the page's
   end cap.
---------------------------------------------------------------- */
.about-downloads {
  padding: 0 0.25rem;
}

.store-badge-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
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
  height: 52px;
  width: auto;
  display: block;
}

.store-badge-playstore {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 16px;
  border-radius: 12px;
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
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #A6A6A6;
}

.store-badge-title {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  margin-top: 2px;
}
</style>
