<template>
  <q-page class="profile-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <!-- Header -->
    <div class="profile-header" :class="$q.dark.isActive ? 'header-dark' : 'header-light'">
      <q-btn
        flat
        round
        dense
        @click="$router.back()"
        class="back-btn"
        :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
        aria-label="Back"
      >
        <Icon icon="tabler:chevron-left" width="18" height="18" />
      </q-btn>
      <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
        {{ $t('Profile') }}
      </div>
      <div class="header-spacer"></div>
    </div>

    <div class="profile-content">
      <!-- Identity strip. Tappable: opens the manage sheet with every
           identity-related action (View, Restore, Generate new). Means
           the page stays at two visible sections (identity + sites)
           and the lower-frequency, scarier actions stay one tap away
           but out of sight. -->
      <button
        type="button"
        class="identity-strip"
        :class="$q.dark.isActive ? 'identity-strip-dark' : 'identity-strip-light'"
        :aria-label="$t('Manage your BuhoGO identity')"
        @click="showManageSheet = true"
      >
        <div
          class="identity-strip-avatar"
          :class="[
            $q.dark.isActive ? 'identity-strip-avatar-dark' : 'identity-strip-avatar-light',
            { 'identity-strip-avatar--warn': identity.bootstrapped && !identity.backupConfirmed },
          ]"
          aria-hidden="true"
        >
          <Icon icon="tabler:user" width="22" height="22" />
        </div>
        <div class="identity-strip-meta">
          <div class="identity-strip-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
            {{ $t('Your BuhoGO identity') }}
          </div>
          <div class="identity-strip-status">
            <template v-if="!identity.bootstrapped">
              <Icon icon="tabler:sparkles" width="13" height="13" class="identity-strip-status-icon" />
              <span :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                {{ $t('Tap to set up') }}
              </span>
            </template>
            <template v-else>
              <Icon
                :icon="identity.backupConfirmed ? 'tabler:shield-check' : 'tabler:shield-exclamation'"
                width="13"
                height="13"
                :class="['identity-strip-status-icon', identity.backupConfirmed ? 'is-ok' : 'is-warn']"
              />
              <span :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                <template v-if="identity.backupConfirmed">
                  {{ $t('Backed up') }}
                </template>
                <template v-else>
                  {{ $t('Backup needed') }}
                </template>
                <template v-if="connectedSites.length > 0">
                  <span class="identity-strip-status-sep" aria-hidden="true"></span>
                  {{ siteCountLine }}
                </template>
              </span>
            </template>
          </div>
        </div>
        <Icon
          icon="tabler:chevron-right"
          width="18"
          height="18"
          class="identity-strip-chevron"
          :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'"
        />
      </button>

      <!-- Attention banner. Only renders when there's something to act
           on — keeps the page calm when everything's healthy. Pulls the
           Back-up action out of the Identity card so the user only sees
           the call to action once, where it matters most. -->
      <transition name="attention-fade">
        <button
          v-if="identity.bootstrapped && !identity.backupConfirmed"
          class="attention-card"
          :class="$q.dark.isActive ? 'attention-card-dark' : 'attention-card-light'"
          type="button"
          @click="openIdentitySeedDialog('backup')"
        >
          <div class="attention-icon" aria-hidden="true">
            <Icon icon="tabler:shield-exclamation" width="20" height="20" />
          </div>
          <div class="attention-body">
            <div class="attention-title">
              {{ $t('Back up your identity') }}
            </div>
            <div class="attention-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('Write down your 12 recovery words so you can sign back in on any device.') }}
            </div>
          </div>
          <div class="attention-cta">
            <span class="attention-cta-label">{{ $t('Back up') }}</span>
            <Icon icon="tabler:chevron-right" width="16" height="16" />
          </div>
        </button>
      </transition>

      <!-- Sites the user has signed in to. Has three states:
           – Bootstrapped + sites: list each one, "+" in the header.
           – Bootstrapped + empty:  a friendly placeholder + clear CTA.
           – Not bootstrapped:      no section at all (strip carries it). -->
      <template v-if="identity.bootstrapped">
        <div class="sites-section-header">
          <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
            {{ $t('Sites you sign in to') }}
          </div>
          <button
            v-if="connectedSites.length > 0"
            type="button"
            class="sites-add-btn"
            :class="$q.dark.isActive ? 'sites-add-btn-dark' : 'sites-add-btn-light'"
            :aria-label="$t('Sign in to a new site')"
            @click="showAddSiteSheet = true"
          >
            <Icon icon="tabler:plus" width="16" height="16" />
          </button>
        </div>
      </template>
      <template v-if="identity.bootstrapped && connectedSites.length > 0">
        <div class="settings-card" :class="$q.dark.isActive ? 'card-dark' : 'card-light'">
          <template v-for="(site, idx) in connectedSites" :key="site.domain">
            <!-- Whole row is the affordance. Opening a detail sheet on
                 tap means an accidental press just shows information —
                 never silently disconnects. The destructive action
                 lives inside the sheet, one more deliberate step away. -->
            <q-item clickable v-ripple @click="openSiteSheet(site.domain)">
              <q-item-section side>
                <SiteFavicon :domain="site.domain" :size="28" />
              </q-item-section>
              <q-item-section>
                <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                  {{ site.domain.replace(/^www\./i, '') }}
                </q-item-label>
                <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                  {{ $t('Last used') }} {{ formatLastUsed(site.lastUsedAt) }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
              </q-item-section>
            </q-item>
            <q-separator
              v-if="idx < connectedSites.length - 1"
              :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"
            />
          </template>
        </div>
      </template>

      <!-- Empty state: bootstrapped identity but no linked sites yet.
           Compact, single CTA. Sits in the same slot the sites list
           would occupy, so the page never feels half-built. -->
      <template v-if="identity.bootstrapped && connectedSites.length === 0">
        <div
          class="sites-empty"
          :class="$q.dark.isActive ? 'sites-empty-dark' : 'sites-empty-light'"
        >
          <div
            class="sites-empty-icon"
            :class="$q.dark.isActive ? 'sites-empty-icon-dark' : 'sites-empty-icon-light'"
            aria-hidden="true"
          >
            <Icon icon="tabler:link" width="22" height="22" />
          </div>
          <div class="sites-empty-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
            {{ $t('Sign in to your first site') }}
          </div>
          <p class="sites-empty-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('Any site that supports "Login with Bitcoin" works. No passwords, no email.') }}
          </p>
          <button
            type="button"
            class="sites-empty-cta"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            @click="showAddSiteSheet = true"
          >
            <Icon icon="tabler:plus" width="15" height="15" />
            <span>{{ $t('Sign in to a site') }}</span>
          </button>
        </div>
      </template>

    </div>

    <!-- Identity manage bottom sheet (View / Restore / Generate new).
         Opened by tapping the identity strip. Keeps these three actions
         off the page itself so a non-technical user sees a calm two-
         section layout by default. -->
    <IdentityManageSheet
      v-model="showManageSheet"
      @view-seed="openIdentitySeedDialog(identity.backupConfirmed ? 'view' : 'backup')"
      @restore="showIdentityRestoreDialog = true"
      @regenerate="openRegenerateDialog"
    />

    <!-- Add-site sheet (paste lnurl1/keyauth link) → parses into a
         challenge, hands it to the IdentityAuthDialog below for the
         familiar approve/sign/submit flow. -->
    <AddSiteSheet
      v-model="showAddSiteSheet"
      @submit="onAddSiteSubmitted"
    />

    <!-- LUD-04 auth dialog. Mounted here too (in addition to Wallet.vue)
         so the Profile add-site flow can finish on this page without a
         navigation jump. Self-contained — opens, signs, closes. -->
    <IdentityAuthDialog
      v-model="showIdentityAuthDialog"
      :challenge="pendingChallenge"
    />

    <!-- Connected-site detail bottom sheet -->
    <ConnectedSiteSheet
      v-model="showSiteSheet"
      :site="selectedSite"
      @forget="forgetConnectedSite"
    />

    <!-- Identity seed phrase dialog (view + first-time backup) -->
    <IdentitySeedPhraseDialog
      v-model="showIdentitySeedDialog"
      :mode="identitySeedDialogMode"
      @verified="onIdentitySeedVerified"
    />

    <!-- Restore from seed phrase -->
    <IdentityRestoreDialog
      v-model="showIdentityRestoreDialog"
      @restored="onIdentityRestored"
    />

    <!-- Regenerate identity confirmation. Mirrors the typed-phrase gate
         the Settings danger-zone uses for wallet removal so the visual
         language is consistent. Inlined here (rather than borrowed from
         Settings) so this page stays self-contained. -->
    <q-dialog
      v-model="showRegenerateConfirm"
      :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    >
      <q-card class="danger-confirm-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="danger-header">
          <div class="danger-icon-wrapper">
            <Icon icon="tabler:alert-triangle" width="32" height="32" class="danger-icon" />
          </div>
          <div class="danger-title">{{ $t('Generate new identity?') }}</div>
          <div class="danger-message" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('This wipes your current BuhoGO identity and creates a fresh one. Every site you have linked will see you as a new user. Your wallets are not affected.') }}
          </div>
        </q-card-section>

        <q-card-section class="danger-content">
          <div class="confirm-instruction" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ $t('Type') }} <span class="confirm-phrase">"{{ confirmPhrase }}"</span> {{ $t('to confirm') }}
          </div>
          <q-input
            v-model="regenerateConfirmInput"
            outlined
            dense
            :placeholder="confirmPhrase"
            class="confirm-input"
            :dark="$q.dark.isActive"
            :color="$q.dark.isActive ? 'white' : 'dark'"
            @keyup.enter="executeRegenerate"
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
            :label="$t('Generate new identity')"
            :disable="regenerateConfirmInput !== confirmPhrase"
            :loading="isRegenerating"
            class="danger-action-btn"
            @click="executeRegenerate"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import IdentitySeedPhraseDialog from '../components/IdentitySeedPhraseDialog.vue';
import IdentityRestoreDialog from '../components/IdentityRestoreDialog.vue';
import IdentityManageSheet from '../components/IdentityManageSheet.vue';
import IdentityAuthDialog from '../components/IdentityAuthDialog.vue';
import AddSiteSheet from '../components/AddSiteSheet.vue';
import SiteFavicon from '../components/SiteFavicon.vue';
import ConnectedSiteSheet from '../components/ConnectedSiteSheet.vue';
import { useIdentityStore } from '../stores/identity';

// The typed confirmation phrase. Matched verbatim to the wallet-removal
// flow ("I understand") so users build the same muscle memory across
// every destructive action in the app.
const CONFIRM_PHRASE = 'I understand';

export default {
  name: 'ProfilePage',

  components: {
    Icon,
    IdentitySeedPhraseDialog,
    IdentityRestoreDialog,
    IdentityManageSheet,
    IdentityAuthDialog,
    AddSiteSheet,
    SiteFavicon,
    ConnectedSiteSheet,
  },

  setup() {
    const identity = useIdentityStore();
    return { identity };
  },

  data() {
    return {
      // Identity dialogs
      showIdentitySeedDialog: false,
      identitySeedDialogMode: 'backup',
      showIdentityRestoreDialog: false,

      // Identity manage bottom sheet (View / Restore / Generate new).
      showManageSheet: false,

      // Add-site flow. `pendingChallenge` is the parsed LUD-04 challenge
      // produced by the AddSiteSheet paste/parse step; the auth dialog
      // mirrors the deep-link path from Wallet.vue.
      showAddSiteSheet: false,
      showIdentityAuthDialog: false,
      pendingChallenge: null,

      // Connected-site details sheet. `selectedSite` is a reference to
      // the row currently being inspected; we re-read from the store at
      // computed-time so the sheet stays in sync if the underlying
      // record changes (e.g. site is used again while sheet is open).
      showSiteSheet: false,
      selectedSiteDomain: null,

      // Regenerate (destructive)
      showRegenerateConfirm: false,
      regenerateConfirmInput: '',
      isRegenerating: false,
      confirmPhrase: CONFIRM_PHRASE,
    };
  },

  computed: {
    connectedSites() {
      return this.identity.connectedSitesSorted;
    },

    /**
     * Single-line site count for the identity-strip subtitle. Skips the
     * line entirely when the user hasn't linked any sites yet so we
     * don't read "0 sites linked" on a fresh install — silence beats
     * vanity metrics.
     */
    siteCountLine() {
      const n = this.connectedSites.length;
      if (n === 0) return this.$t('No sites yet');
      if (n === 1) return this.$t('1 site linked');
      return this.$t('{n} sites linked', { n });
    },

    /**
     * Always read from the store rather than caching the site object in
     * `data()` so the sheet's facts stay live if the user signs in
     * again to the same site while the sheet is open. Returns null
     * between sheet opens.
     */
    selectedSite() {
      if (!this.selectedSiteDomain) return null;
      return this.identity.connectedSites.find(
        s => s.domain === this.selectedSiteDomain,
      ) || null;
    },
  },

  created() {
    this.identity.hydrate();
  },

  methods: {
    async openIdentitySeedDialog(mode) {
      await this.identity.ensureIdentity();
      this.identitySeedDialogMode = mode;
      this.showIdentitySeedDialog = true;
    },

    onIdentitySeedVerified() {
      // No-op: the store flips backupConfirmed and the hero re-renders.
    },

    onIdentityRestored() {
      // No-op: notify is fired inside the dialog itself.
    },

    openSiteSheet(domain) {
      this.selectedSiteDomain = domain;
      this.showSiteSheet = true;
    },

    /**
     * Hand a parsed LUD-04 challenge from the AddSiteSheet into the
     * standard auth dialog. The `setTimeout` lets the add-site sheet
     * complete its leave animation before the dialog appears — same
     * 180ms gap used elsewhere in this page so chained sheets feel
     * like a single fluid flow rather than overlapping cards.
     */
    onAddSiteSubmitted(challenge) {
      this.pendingChallenge = challenge;
      setTimeout(() => {
        this.showIdentityAuthDialog = true;
      }, 180);
    },

    forgetConnectedSite(domain) {
      this.identity.removeConnectedSite(domain);
      this.$q.notify({
        type: 'info',
        message: this.$t('Forgot {site} locally', { site: domain.replace(/^www\./i, '') }),
        caption: this.$t('The site still has your public key. Visiting it again will re-link.'),
        timeout: 4000,
      });
      // Close the sheet once the row is gone so the sheet doesn't
      // linger pointing at a non-existent record.
      this.showSiteSheet = false;
      this.selectedSiteDomain = null;
    },

    formatLastUsed(timestamp) {
      if (!timestamp) return '';
      const days = Math.floor((Date.now() - timestamp) / 86400000);
      if (days === 0) return this.$t('Today');
      if (days === 1) return this.$t('Yesterday');
      if (days < 30) return this.$t('{n}d ago', { n: days });
      const months = Math.floor(days / 30);
      if (months < 12) return this.$t('{n}mo ago', { n: months });
      const years = Math.floor(months / 12);
      return this.$t('{n}y ago', { n: years });
    },

    openRegenerateDialog() {
      this.regenerateConfirmInput = '';
      this.showRegenerateConfirm = true;
    },

    async executeRegenerate() {
      if (this.regenerateConfirmInput !== this.confirmPhrase) return;
      this.isRegenerating = true;
      try {
        await this.identity.regenerate();
        this.$q.notify({
          type: 'positive',
          message: this.$t('New identity generated'),
          caption: this.$t('Back up your new 12 recovery words to keep these logins.'),
          timeout: 4500,
        });
        this.showRegenerateConfirm = false;
      } catch (err) {
        console.error('[Profile] regenerate failed', err);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t generate a new identity'),
          caption: this.$t('Please try again.'),
        });
      } finally {
        this.isRegenerating = false;
      }
    },
  },
};
</script>

<style scoped>
/* ---------- Page chrome ----------
   Mirrors Settings.vue: plain flex-column page so the Danger Zone can
   push itself to the natural bottom via `margin-top: auto`. The global
   `.q-page` rule in app.css already adds `padding-top: var(--safe-top)`
   so we don't double-pad the status-bar area on Android. Bottom padding
   uses `env(safe-area-inset-bottom)` to clear the gesture/nav bar. */

.profile-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
}

.profile-header {
  display: flex;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid var(--border-card);
  gap: 1rem;
}

.header-light,
.header-dark {
  /* Inherit the page background — the bottom border alone separates
     the bar from the scrolling content. */
  background: transparent;
}

.header-title {
  flex: 1 1 auto;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.header-spacer {
  width: 40px;
}

.profile-content {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  padding: 0 16px;
  padding-bottom: max(32px, env(safe-area-inset-bottom, 0px));
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
}

/* ---------- Identity strip ----------
   Compact horizontal header replacing the old hero card. Pattern from
   Cash App / Strike / 1Password mobile: the user's identity is a thin
   anchor at the top, not a vanity panel. */

.identity-strip {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  margin: 16px 0 12px;
  padding: 12px 14px;
  border-radius: 14px;
  /* `<button>` reset — every appearance, every margin, every focus
     outline comes from us so the strip reads as a row, not a system
     button. */
  border: 1px solid transparent;
  font-family: 'Manrope', sans-serif;
  text-align: left;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}

.identity-strip:focus-visible {
  outline: 2px solid #0f172a;
  outline-offset: 2px;
}

.identity-strip:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
}

.identity-strip:active {
  transform: translateY(0);
  transition-duration: 0.06s;
}

.identity-strip-chevron {
  flex: 0 0 auto;
  opacity: 0.6;
}

.identity-strip-light {
  background: #ffffff;
  border-color: rgba(15, 23, 42, 0.06);
}

.identity-strip-dark {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.06);
}

/* Avatar: 44px circle, same dark-neutral palette as the primary CTA
   buttons. Status communicated via an optional 2px ring rather than a
   coloured background — keeps the surface monochrome and on-brand. */
.identity-strip-avatar {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  transition: box-shadow 0.18s ease;
}

.identity-strip-avatar-light {
  background: var(--btn-neutral-bg, #0f172a);
  color: var(--btn-neutral-fg, #ffffff);
}

.identity-strip-avatar-dark {
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22);
}

/* Amber ring around the avatar when the seed has not been written
   down yet. Visual nag the user sees every time they land on this
   page until they back up. Disappears the moment backup is done. */
.identity-strip-avatar--warn {
  box-shadow: 0 0 0 2px #f59e0b;
}

.identity-strip-meta {
  flex: 1 1 auto;
  min-width: 0;
}

.identity-strip-name {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 1.2;
}

.identity-strip-status {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  line-height: 1.3;
}

.identity-strip-status-icon {
  flex: 0 0 auto;
  opacity: 0.85;
}

.identity-strip-status-icon.is-ok {
  color: #0f9c54;
  opacity: 1;
}

.identity-strip-status-icon.is-warn {
  color: #b06d00;
  opacity: 1;
}

.identity-strip-status-sep {
  opacity: 0.55;
  margin: 0 6px;
  font-weight: 600;
  /* Bullet rather than middle dot — slightly larger glyph, reads better
     at this small size against the warm cream background. */
}

.identity-strip-status-sep::before {
  content: '\2022';
}

/* ---------- Attention banner ----------
   Renders only when the user has something concrete to do (right now:
   back up the seed). Pulls the call-to-action out of the regular list
   so it can't be missed, and frees the Identity card from carrying a
   row that flips meaning between states. */

.attention-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  margin: 0 0 12px;
  border-radius: 14px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  font-family: 'Manrope', sans-serif;
  text-align: left;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}

.attention-card-light {
  background: #fffaf0;
  color: #0f172a;
}

.attention-card-dark {
  background: rgba(245, 158, 11, 0.08);
  color: #f8fafc;
}

.attention-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(245, 158, 11, 0.18);
}

.attention-card:active {
  transform: translateY(0);
  transition-duration: 0.06s;
}

.attention-icon {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(245, 158, 11, 0.14);
  color: #b06d00;
  display: flex;
  align-items: center;
  justify-content: center;
}

.attention-body {
  flex: 1 1 auto;
  min-width: 0;
}

.attention-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.attention-text {
  font-size: 12px;
  line-height: 1.4;
  margin-top: 2px;
}

.attention-cta {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  color: #b06d00;
  font-size: 12.5px;
  font-weight: 600;
}

.attention-cta-label {
  white-space: nowrap;
}

/* Hide the inline label below ~360px so the card never wraps the CTA
   onto a second line on small phones; the chevron still communicates
   tap-able. */
@media (max-width: 360px) {
  .attention-cta-label {
    display: none;
  }
}

.attention-fade-enter-active,
.attention-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.attention-fade-enter-from,
.attention-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ---------- Section labels (cloned from Settings.vue) ---------- */

.section-label {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin: 1.5rem 0 0.5rem 0.25rem;
}

.section-label-dark {
  color: var(--text-muted, #94a3b8);
}

.section-label-light {
  color: var(--text-muted, #64748b);
}

.section-label--danger {
  color: #ef4444 !important;
}

.connected-count {
  font-weight: 500;
  text-transform: none;
  font-size: 12px;
  margin-left: 4px;
}

/* Header row for the Sites section: label on the left, "+" button on
   the right, both vertically aligned on the same baseline. The button
   is small and quiet so it sits comfortably without competing with
   the label or the strip above. */
.sites-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 1.5rem 0 0.5rem 0;
}

.sites-section-header .section-label {
  margin: 0 0 0 0.25rem;
}

.sites-add-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, transform 0.12s ease;
}

.sites-add-btn-light {
  color: #0f172a;
  background: rgba(15, 23, 42, 0.04);
}

.sites-add-btn-light:hover {
  background: rgba(15, 23, 42, 0.08);
}

.sites-add-btn-dark {
  color: #f8fafc;
  background: rgba(255, 255, 255, 0.06);
}

.sites-add-btn-dark:hover {
  background: rgba(255, 255, 255, 0.10);
}

.sites-add-btn:active {
  transform: scale(0.94);
}

/* Empty-state card: appears in the sites slot when an identity exists
   but no sites are linked yet. Same card dimensions as a populated
   list so the page never visually "shrinks" when a user forgets their
   only site. Deliberately quiet — single icon, one short line, one
   CTA — so it doesn't feel like an empty error. */
.sites-empty {
  padding: 24px 20px 20px;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
}

.sites-empty-light {
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.sites-empty-dark {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.sites-empty-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
}

.sites-empty-icon-light {
  background: rgba(15, 23, 42, 0.06);
  color: #475569;
}

.sites-empty-icon-dark {
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
}

.sites-empty-title {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.sites-empty-text {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
  margin: 0;
  max-width: 280px;
}

.sites-empty-cta {
  margin-top: 8px;
  height: 40px;
  padding: 0 20px;
  border-radius: 20px;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: filter 0.18s ease, transform 0.12s ease;
}

.sites-empty-cta:hover {
  filter: brightness(1.06);
}

.sites-empty-cta:active {
  transform: scale(0.98);
}

/* ---------- Settings cards (cloned from Settings.vue) ---------- */

.settings-card {
  border-radius: 14px;
  overflow: hidden;
}

.card-light {
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.card-dark {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.item-label-light { color: #0f172a; }
.item-label-dark { color: #f8fafc; }
.item-caption-light { color: #64748b; }
.item-caption-dark { color: #94a3b8; }
.chevron-light { color: #94a3b8; }
.chevron-dark { color: #cbd5e1; }
.separator-light { background: rgba(15, 23, 42, 0.06); }
.separator-dark { background: rgba(255, 255, 255, 0.06); }
.action-icon-light { color: #94a3b8; }
.action-icon-dark { color: #cbd5e1; }

/* ---------- Danger row ---------- */

.identity-danger-row .identity-danger-icon {
  color: #ef4444;
}

.identity-danger-label {
  color: #ef4444;
  font-weight: 500;
}

/* ---------- Danger confirm dialog (mirrors Settings.vue styling) ---------- */

.danger-confirm-card {
  width: 100%;
  max-width: 440px;
  border-radius: 18px;
  overflow: hidden;
}

.danger-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 20px 8px;
  gap: 8px;
}

.danger-icon-wrapper {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ef4444;
}

.danger-title {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 700;
  margin: 0;
}

.danger-message {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.5;
}

.danger-content {
  padding: 8px 20px 16px;
}

.confirm-instruction {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  margin-bottom: 8px;
  text-align: center;
}

.confirm-phrase {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-weight: 600;
}

/* Override the q-input outlined border color so the focused state
   doesn't pick up Quasar's `primary` (BuhoGO green) on what is a
   destructive-action input. Neutral dark/light is the right cue. */
.confirm-input :deep(.q-field__control:before) {
  border-color: rgba(15, 23, 42, 0.18);
}

.confirm-input :deep(.q-field--focused .q-field__control:after) {
  border-color: #0f172a;
  border-width: 1px;
}

body.body--dark .confirm-input :deep(.q-field__control:before) {
  border-color: rgba(255, 255, 255, 0.18);
}

body.body--dark .confirm-input :deep(.q-field--focused .q-field__control:after) {
  border-color: #f8fafc;
}

.danger-actions {
  padding: 0 20px 20px;
  gap: 8px;
}

.danger-action-btn {
  background: #ef4444;
  color: #ffffff;
  border-radius: 999px;
  flex: 1 1 auto;
  height: 44px;
}

.cancel-btn {
  flex: 0 0 auto;
}

/* ---------- Danger-zone wrapper ----------
   Pushes the destructive section to the natural bottom of the page.
   When the user has few connected sites it sits at the viewport
   bottom; when the list is long it falls right below the list. */
.profile-danger-zone {
  margin-top: auto;
}
</style>
