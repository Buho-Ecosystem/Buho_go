<!--
  Other apps: where the card works besides BuhoGO, opened from the identity
  tab's "Other apps" row.

  One short task, so a sheet over the card: the apps to try, then how to sign
  in to them. Signing in means pasting the identity's secret key into the app,
  so the key is one tap away here, behind the same sheet (and the same unlock)
  as on the identity's own page. A signer app keeps its key, so then there is
  nothing to copy and the footer says so.

  Each logo ships with the app in /public/clients/: opening the sheet asks no
  other site for anything. An app opens in the in-app browser, never by
  leaving BuhoGO, and an app that does not run on this phone is not offered.
-->
<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card
      class="identity-surface apps-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <div class="sheet-grab" aria-hidden="true"><span></span></div>

      <div class="sheet-head">
        <div class="sheet-title">{{ $t('Other apps') }}</div>
        <q-btn flat round class="sheet-close" :aria-label="$t('Close')" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-body apps-body">
        <p class="id-lede apps-lede">
          {{ $t('Sign in to these apps with your card. Your name, photo and contacts come with you. No new account, no password.') }}
        </p>

        <IdentityGroup :title="$t('Apps to try')">
          <IdentityRow
            v-for="app in apps"
            :key="app.name"
            :label="app.name"
            :caption="app.tagline"
            :chevron="false"
            data-audit="identity-app-row"
            @click="openApp(app)"
          >
            <template #leading>
              <SiteFavicon :domain="app.domain" :icon-url="app.icon" :size="36" shape="rounded-square" />
            </template>
            <template #trailing>
              <Icon icon="tabler:arrow-up-right" width="17" height="17" class="apps-out" />
            </template>
          </IdentityRow>
        </IdentityGroup>

        <IdentityGroup
          v-if="hasSecretKey"
          class="apps-key"
          :footer="$t('Paste it where the app asks for your key. Copy it only into an app you trust.')"
        >
          <IdentityRow
            icon="tabler:lock-password"
            :label="$t('Secret key')"
            :caption="$t('Copy it to sign in')"
            data-audit="identity-apps-secret-key"
            @click="openSecretKey"
          />
        </IdentityGroup>
        <p v-else-if="signerApp" class="id-foot apps-signer">
          {{ $t('Your key stays in your signer app. Many of these apps can sign in with it too.') }}
        </p>
      </div>
    </q-card>
  </q-dialog>

  <!-- Replaces this sheet rather than stacking on it; this one returns when it closes. -->
  <IdentityPrivateKeySheet
    v-if="hasSecretKey"
    v-model="showSecretKey"
    :account="identity.activeExternalId ? null : identity.nostrAccountIndex"
    :external-id="identity.activeExternalId"
    :name="name"
    :npub="identity.nostrNpub || ''"
  />
</template>

<script>
import { Capacitor } from '@capacitor/core';
import { Icon } from '@iconify/vue';
import SiteFavicon from '../SiteFavicon.vue';
import IdentityGroup from './IdentityGroup.vue';
import IdentityRow from './IdentityRow.vue';
import IdentityPrivateKeySheet from './IdentityPrivateKeySheet.vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { openInAppBrowser } from '../../utils/inAppBrowser.js';

/** Quasar's sheet leave transition; the next sheet opens once it is over. */
const SHEET_HANDOFF_MS = 320;

/**
 * The apps that run where BuhoGO runs now: on a phone app, the web apps and
 * that phone's own; in a browser, which could be any phone, all of them.
 */
function appsFor(apps, platform) {
  if (platform !== 'ios' && platform !== 'android') return apps;
  return apps.filter((app) => app.runsOn.includes('web') || app.runsOn.includes(platform));
}

export default {
  name: 'IdentityAppsSheet',

  components: { Icon, SiteFavicon, IdentityGroup, IdentityRow, IdentityPrivateKeySheet },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue'],

  setup() {
    return { identity: useIdentityStore(), profile: useProfileStore() };
  },

  data() {
    return {
      showSecretKey: false,
      returning: false,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(value) { this.$emit('update:modelValue', value); },
    },

    /** In display order: Lotus first (BuhoGO's own), then the others. 'web' runs on every phone. */
    apps() {
      const web = { runsOn: ['web'] };
      const phones = { runsOn: ['ios', 'android'] };
      const android = { runsOn: ['android'] };
      return appsFor([
        { name: 'Lotus', tagline: this.$t('One peaceful place for your day, your people and your ideas.'), ...web, url: 'https://lotus.mybuho.de/app', domain: 'lotus.mybuho.de', icon: '/clients/lotus_logo.png' },
        { name: 'Primal', tagline: this.$t('Polished social app with built-in Bitcoin payments.'), ...phones, url: 'https://primal.net', domain: 'primal.net', icon: '/clients/primal_logo.png' },
        { name: 'Yakihonne', tagline: this.$t('Long-form posts, zaps, and a curated community feed.'), ...phones, url: 'https://yakihonne.com', domain: 'yakihonne.com', icon: '/clients/yakihonne_logo.png' },
        { name: 'Amethyst', tagline: this.$t('Feature-rich open-source Android client.'), ...android, url: 'https://www.amethyst.social', domain: 'amethyst.social', icon: '/clients/amethyst_logo.png' },
        { name: 'WISP', tagline: this.$t('Lightweight mobile client built for quick browsing.'), ...phones, url: 'https://wisp.mobile', domain: 'wisp.mobile', icon: '/clients/WISP_logo.png' },
        { name: 'Jumble', tagline: this.$t('Browse and post from any browser. No install needed.'), ...web, url: 'https://jumble.social', domain: 'jumble.social', icon: '/clients/jumble_logo.png' },
      ], Capacitor.getPlatform());
    },

    /** The identity in use has its secret key on this phone. */
    hasSecretKey() {
      return this.identity.identityCapabilities.rawKey && !!this.identity.nostrNpub;
    },

    /** A signer app keeps the key, so there is nothing here to copy. */
    signerApp() {
      return this.identity.identityCapabilities.needsApproval;
    },

    name() {
      return this.profile.displayName || this.profile.name || '';
    },
  },

  watch: {
    showSecretKey(value, previous) {
      if (value || !previous || !this.returning) return;
      setTimeout(() => {
        this.returning = false;
        this.open = true;
      }, SHEET_HANDOFF_MS);
    },
  },

  methods: {
    openApp(app) {
      openInAppBrowser(app.url);
    },

    openSecretKey() {
      this.returning = true;
      this.open = false;
      setTimeout(() => { this.showSecretKey = true; }, SHEET_HANDOFF_MS);
    },
  },
};
</script>

<style scoped>
.apps-sheet {
  max-height: 88vh;
  border-radius: 18px 18px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: var(--safe-bottom, 0px);
}

.apps-body {
  overflow-y: auto;
  padding-top: 2px;
}

.apps-lede { margin-bottom: 0; }

/* Leaves BuhoGO for the app's page, so an arrow out rather than a chevron in. */
.apps-out { color: var(--text-muted); flex: 0 0 auto; }

/* A section of its own: the space an inset list leaves between groups. */
.apps-key { margin-top: 24px; }

.apps-signer { margin-top: 14px; }
</style>
