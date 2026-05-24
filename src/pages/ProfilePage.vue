<template>
  <q-page class="profile-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <!-- Header. Back · centred title · gear (manage). The gear opens
         the IdentityManageSheet, which still owns the lower-frequency
         actions (seed phrase, restore, regenerate, public-profile-
         details). It used to be the only way into those — now the
         profile header below owns the everyday actions and the gear
         is a deliberate, one-tap step away. -->
    <div class="page-header" :class="$q.dark.isActive ? 'header-dark' : 'header-light'">
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
      <q-btn
        flat
        round
        dense
        class="manage-btn"
        :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
        :aria-label="$t('Manage your BuhoGO identity')"
        @click="showManageSheet = true"
      >
        <!-- Kebab/more affordance. Deliberately NOT a gear: the
             global Settings page already owns that glyph; using
             it here too would muddy the meaning. The dots match
             the modern "more options for this surface" convention. -->
        <Icon icon="tabler:dots-vertical" width="18" height="18" />
      </q-btn>
    </div>

    <div class="profile-content">
      <!-- Profile header. Three state variations driven entirely by
           identity.bootstrapped + profile.isEmpty:
             1. !bootstrapped       → "Set up your profile" + Get started
             2. bootstrapped, empty → "Add your name and a picture"
             3. fully set up        → avatar / name / pills / Edit + Share
           See the UX contract in Plan 09 build guide §7a. -->
      <section
        class="profile-hero"
        :class="$q.dark.isActive ? 'hero-dark' : 'hero-light'"
      >
        <!-- Avatar block. Tap opens edit (or "get started" for fresh
             installs). Backup-warn ring lights up amber whenever the
             user has an identity but hasn't written down their seed. -->
        <button
          type="button"
          class="hero-avatar-btn"
          :aria-label="$t('Edit profile picture')"
          @click="openProfileEditor"
        >
          <!-- Avatar slot. The circle clips its own image fill;
               the camera badge anchors to the wrap so it never
               gets cropped at the circle border. -->
          <div class="hero-avatar-wrap">
            <div
              class="hero-avatar"
              :class="$q.dark.isActive ? 'hero-avatar-dark' : 'hero-avatar-light'"
            >
              <img
                v-if="resolvedAvatarUrl"
                :src="resolvedAvatarUrl"
                :alt="$t('Profile picture')"
                class="hero-avatar-img"
                @error="onAvatarLoadError"
              />
              <Icon
                v-else
                icon="tabler:user"
                width="40"
                height="40"
                class="hero-avatar-glyph"
                aria-hidden="true"
              />
            </div>
            <span class="hero-avatar-edit-badge" aria-hidden="true">
              <Icon icon="tabler:camera" width="14" height="14" />
            </span>
          </div>
        </button>

        <!-- Name + subline. Tappable as one block so any reasonable
             miss-tap on the headline area still lands in the editor. -->
        <button
          type="button"
          class="hero-meta-btn"
          :aria-label="$t('Edit profile')"
          @click="openProfileEditor"
        >
          <div
            class="hero-name"
            :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
          >
            {{ heroHeadline }}
          </div>
          <div
            v-if="heroSubline"
            class="hero-subline"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          >
            {{ heroSubline }}
          </div>
        </button>

        <!--
          Status pills (backup-state + publish-state) were removed in
          favour of a calmer hero. The same information is still
          reachable but in less-noisy places:
          - Backup status: shown inside the kebab sheet header.
          - Publish failures: surface in-context inside the edit
            sheet's error banner.
          The hero stays focused on identity (who you are) and the
          two primary CTAs (Edit, Share).
        -->

        <!-- Two equal-width neutral pills side by side — Instagram /
             Threads style. Both gated on `identity.bootstrapped` so
             the row stays empty during the sub-100ms passive-
             bootstrap window; `min-height` on `.hero-actions`
             reserves the vertical slot so the page never jumps. -->
        <div class="hero-actions" v-if="identity.bootstrapped">
          <button
            type="button"
            class="hero-cta"
            :class="$q.dark.isActive ? 'hero-cta-dark' : 'hero-cta-light'"
            @click="openProfileEditor"
          >
            <Icon icon="tabler:pencil" width="15" height="15" />
            <span>{{ $t('Edit profile') }}</span>
          </button>

          <button
            v-if="!profile.isEmpty"
            type="button"
            class="hero-cta"
            :class="$q.dark.isActive ? 'hero-cta-dark' : 'hero-cta-light'"
            @click="showProfileShareSheet = true"
          >
            <Icon icon="tabler:share-2" width="15" height="15" />
            <span>{{ $t('Share profile') }}</span>
          </button>
        </div>
      </section>

      <!-- Sites the user has signed in to. Has three states:
           – Bootstrapped + sites: list each one, "+" in the header.
           – Bootstrapped + empty:  a friendly placeholder + clear CTA.
           – Not bootstrapped:      no section at all (strip carries it). -->
      <template v-if="identity.bootstrapped">
        <div class="sites-section-header">
          <!--
            Section title + inline help icon. The help icon opens the
            same SiteExamplesSheet the AddSiteSheet uses, so the user
            can discover concrete sites without having to start the
            add-site flow first. Sits inside the title row so the (?)
            reads as "what is this section about?", not "how do I add
            one?" — which is what the + button next to it answers.
          -->
          <div class="sites-section-title">
            <div class="section-label" :class="$q.dark.isActive ? 'section-label-dark' : 'section-label-light'">
              {{ $t('Sites you sign in to') }}
            </div>
            <button
              type="button"
              class="sites-help-btn"
              :class="$q.dark.isActive ? 'sites-help-btn-dark' : 'sites-help-btn-light'"
              :aria-label="$t('Where can I sign in?')"
              @click="showSiteExamplesSheet = true"
            >
              <Icon icon="tabler:help-circle" width="15" height="15" />
            </button>
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
          <!--
            Body line + inline "See examples" link. The link opens
            the SiteExamplesSheet directly (mounted at page level)
            so the user can browse concrete options without having
            to start the add-site flow first. Wording stays tight:
            one short sentence + one clear next step.
          -->
          <p class="sites-empty-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('Use your profile instead of passwords.') }}
            <button
              type="button"
              class="sites-empty-link"
              :class="$q.dark.isActive ? 'sites-empty-link-dark' : 'sites-empty-link-light'"
              @click="showSiteExamplesSheet = true"
            >
              {{ $t('See examples') }}
              <Icon icon="tabler:chevron-right" width="12" height="12" />
            </button>
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
         Opened by tapping the gear icon in the page header. Keeps these
         lower-frequency actions one tap away from the everyday flows. -->
    <IdentityManageSheet
      v-model="showManageSheet"
      @view-seed="openIdentitySeedDialog(identity.backupConfirmed ? 'view' : 'backup')"
      @restore="showIdentityRestoreDialog = true"
      @regenerate="openRegenerateDialog"
      @view-nostr="openNostrIdentityDialog"
    />

    <!-- Profile edit sheet — owns its own local form state and
         commits to profileStore on Save & Publish. The avatar
         picker (Step 7c) lives below and is chained in via the
         @open-picker emit. -->
    <ProfileEditSheet
      v-model="showProfileEditSheet"
      @open-picker="openAvatarPicker"
    />

    <!-- Avatar picker. Chains *back* into the edit sheet when the
         upload succeeds (or when the user removes the avatar), so
         the user always returns to the surface they opened it from. -->
    <ProfileAvatarPickerSheet
      v-model="showProfileAvatarPicker"
      @uploaded="returnToProfileEditor"
      @removed="returnToProfileEditor"
    />

    <!-- Share profile — QR + npub + native share. Self-contained;
         the only signal it needs from the page is `v-model` for
         visibility, and identityStore for the cached npub. -->
    <ProfileShareSheet v-model="showProfileShareSheet" />

    <!-- First-open intro carousel. Triggered from `created()` once
         per identity; subsequent visits skip it via the persisted
         `profileIntroSeenAt` flag on the identity store. -->
    <ProfileIntroDialog v-model="showProfileIntro" />

    <!-- Add-site sheet (paste lnurl1/keyauth link) → parses into a
         challenge, hands it to the IdentityAuthDialog below for the
         familiar approve/sign/submit flow. -->
    <AddSiteSheet
      v-model="showAddSiteSheet"
      @submit="onAddSiteSubmitted"
    />

    <!--
      Help sheet showing concrete example sites. Reachable from two
      places: the (?) icon on this page's "Sites you sign in to"
      section header, and the (?) icon inside AddSiteSheet's own
      header. Same component, mounted twice — no shared state to
      sync.
    -->
    <SiteExamplesSheet v-model="showSiteExamplesSheet" />

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

    <!-- Nostr identity dialog (view npub, reveal nsec, rotate key).
         Derived from the same recovery phrase via NIP-06, so it lives
         alongside the seed-phrase dialog rather than as a separate
         identity surface. -->
    <NostrIdentityDialog v-model="showNostrIdentityDialog" />

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
          <div class="danger-title">{{ $t('Start a new profile?') }}</div>
          <div class="danger-message" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('Your wallets are safe and stay untouched. This replaces your current profile with a fresh one. Sites you signed in to will see you as a new user, and your old name, picture, and contacts will be gone from here.') }}
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
            :label="$t('Start a new profile')"
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
import NostrIdentityDialog from '../components/NostrIdentityDialog.vue';
import ProfileEditSheet from '../components/ProfileEditSheet.vue';
import ProfileAvatarPickerSheet from '../components/ProfileAvatarPickerSheet.vue';
import ProfileShareSheet from '../components/ProfileShareSheet.vue';
import ProfileIntroDialog from '../components/ProfileIntroDialog.vue';
import AddSiteSheet from '../components/AddSiteSheet.vue';
import SiteExamplesSheet from '../components/SiteExamplesSheet.vue';
import SiteFavicon from '../components/SiteFavicon.vue';
import ConnectedSiteSheet from '../components/ConnectedSiteSheet.vue';
import { useIdentityStore } from '../stores/identity';
import { useProfileStore } from '../stores/profile';
import { useAddressBookStore } from '../stores/addressBook';
import { useWalletStore } from '../stores/wallet';

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
    NostrIdentityDialog,
    ProfileEditSheet,
    ProfileAvatarPickerSheet,
    ProfileShareSheet,
    ProfileIntroDialog,
    AddSiteSheet,
    SiteExamplesSheet,
    SiteFavicon,
    ConnectedSiteSheet,
  },

  setup() {
    const identity = useIdentityStore();
    const profile = useProfileStore();
    const walletStore = useWalletStore();
    return { identity, profile, walletStore };
  },

  data() {
    return {
      // Identity dialogs
      showIdentitySeedDialog: false,
      identitySeedDialogMode: 'backup',
      showIdentityRestoreDialog: false,

      // Identity manage bottom sheet (View / Restore / Generate new).
      showManageSheet: false,

      // Profile bottom sheets.
      showProfileEditSheet: false,
      showProfileShareSheet: false,
      showProfileAvatarPicker: false,

      // First-open intro carousel. Shown exactly once per identity;
      // gated by `identity.profileIntroSeenAt` and resolved in
      // `created()` so we don't flash the dialog mid-render.
      showProfileIntro: false,

      // Avatar load error sticky: once an avatar URL has failed to load
      // in this session, we silently fall back to the silhouette so we
      // don't keep retrying a broken URL on every re-render.
      avatarBroken: false,

      // Add-site flow. `pendingChallenge` is the parsed LUD-04 challenge
      // produced by the AddSiteSheet paste/parse step; the auth dialog
      // mirrors the deep-link path from Wallet.vue.
      showAddSiteSheet: false,
      // Visibility for the example-sites help sheet, opened by the
      // (?) icon next to the "Sites you sign in to" section header.
      showSiteExamplesSheet: false,
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

      // Nostr identity dialog (view npub, reveal nsec, rotate key).
      showNostrIdentityDialog: false,
    };
  },

  computed: {
    connectedSites() {
      return this.identity.connectedSitesSorted;
    },

    /**
     * Resolved avatar URL. Honours the runtime `avatarBroken` flag so
     * a failed load falls back to the silhouette without us retrying
     * the broken URL on every render. Cleared via `onAvatarReset()`
     * whenever the underlying `profile.picture` actually changes.
     */
    resolvedAvatarUrl() {
      if (!this.profile.picture) return '';
      if (this.avatarBroken) return '';
      return this.profile.picture;
    },

    /**
     * Headline shown in the hero block. Identity is bootstrapped
     * passively in `created()`, so by the time the user has anything
     * to look at there are only two meaningful states: empty profile
     * (prompt to fill it in) or populated profile (show the name).
     *
     * The brief !bootstrapped window between created() firing and
     * ensureIdentity() resolving renders as an empty string — the
     * avatar block alone holds the visual layout for that single
     * frame so the page never flashes a stale label.
     */
    heroHeadline() {
      if (!this.identity.bootstrapped) return '';
      if (this.profile.isEmpty) return this.$t('Set up your profile');
      // Prefer the display name; fall back to handle, then to a
      // shortened profile address. Last-resort placeholder keeps
      // the layout stable for never-published states.
      return this.profile.displayName
        || this.profile.name
        || this.shortNpub
        || this.$t('Your profile');
    },

    /**
     * Subline under the headline. Empty profile gets a one-liner
     * that explains *what the profile is for* — the most common
     * thing first-time users don't know. Once set up, we show the
     * Lightning address (or the shortened profile address) so a
     * friend has something concrete to copy into another app.
     */
    heroSubline() {
      if (!this.identity.bootstrapped) return '';
      if (this.profile.isEmpty) {
        return this.$t('Add a name and picture so friends can find you and pay you.');
      }
      if (this.profile.lud16) return this.profile.lud16;
      return this.shortNpub;
    },

    /**
     * Compact `npub1abc…wxyz` form for places that don't want to
     * blow up the layout. Falls back to '' before the cache lands.
     */
    shortNpub() {
      const npub = this.identity.nostrNpub;
      if (typeof npub !== 'string' || npub.length < 16) return '';
      return `${npub.slice(0, 10)}…${npub.slice(-6)}`;
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

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();
    // Passive identity bootstrap. The user never sees an "onboarding"
    // step for the BuhoGO seed or the derived Nostr key — opening the
    // Profile page is itself the signal that they're ready to use it.
    // Backup of the recovery phrase is a separate, non-blocking nag
    // surfaced by the attention card lower on the page; it does not
    // gate any flow here.
    if (!this.identity.bootstrapped) {
      await this.identity.ensureIdentity();
    }

    // First-open intro. We only show it after the identity is in place
    // so the carousel never appears against a half-initialised Profile.
    // The seen flag persists, so re-visits don't re-trigger.
    if (!this.identity.profileIntroSeenAt) {
      this.showProfileIntro = true;
    }
  },

  watch: {
    'profile.picture'() {
      // Avatar URL changed → reset the load-failure flag so a fresh
      // upload gets a fresh fetch attempt. Cheap; no debounce needed
      // because the URL only changes via uploadAvatar.
      this.avatarBroken = false;
    },
  },

  methods: {
    /**
     * Single entry point into the editor sheet. Identity is
     * bootstrapped passively in `created()`, but we still re-await
     * here as belt-and-braces: a user who somehow opens the editor
     * via a deep link (or before `created()` resolves on a very
     * slow device) still gets a working seed by the time the sheet
     * appears.
     */
    async openProfileEditor() {
      if (!this.identity.bootstrapped) {
        await this.identity.ensureIdentity();
      }
      this.showProfileEditSheet = true;
    },

    /**
     * The hero <img> failed to load. Stop trying — fall back to the
     * silhouette glyph until the user picks a new avatar.
     */
    onAvatarLoadError() {
      this.avatarBroken = true;
    },

    /**
     * Chain from the edit sheet into the avatar picker. Same
     * 180ms gap pattern the manage sheet uses to make sheet
     * transitions feel like one fluid flow rather than overlapping
     * cards.
     */
    openAvatarPicker() {
      this.showProfileEditSheet = false;
      setTimeout(() => {
        this.showProfileAvatarPicker = true;
      }, 180);
    },

    /**
     * Picker → edit-sheet return chain. Fired by both `@uploaded`
     * (avatar successfully written) and `@removed` (avatar wiped)
     * so the user always lands back where they started.
     */
    returnToProfileEditor() {
      // The picker emits before closing itself, so by the time this
      // runs the picker is already in its leave animation. Re-open
      // the edit sheet after the same 180ms gap.
      setTimeout(() => {
        this.showProfileEditSheet = true;
      }, 180);
    },

    async openIdentitySeedDialog(mode) {
      await this.identity.ensureIdentity();
      this.identitySeedDialogMode = mode;
      this.showIdentitySeedDialog = true;
    },

    onIdentitySeedVerified() {
      // No-op: the store flips backupConfirmed and the hero re-renders.
    },

    async onIdentityRestored() {
      // The restore dialog already fired its own "Identity restored"
      // notify. Recovery rides on top of that: pull the user's
      // public profile (kind:0) AND the private NIP-51 address book
      // so "your name, avatar, and people came back too" — the
      // whole point of having those things on relays in the first
      // place.
      //
      // Both fetches run in parallel and are fire-and-forget. We
      // don't block the restore dialog's close on a relay round-
      // trip, and a failure on either side never undoes the
      // successful identity restore.
      const addressBook = useAddressBookStore();
      const identity = useIdentityStore();
      const profile = this.profile;

      // Wipe the profile store before recovery. Profile metadata is
      // identity-scoped, so any local fields are stale under the new
      // pubkey. If the restored identity has a published kind:0, the
      // recovery step below repopulates from it; if not, the user
      // correctly lands on an empty profile rather than seeing the
      // previous identity's name and avatar.
      profile.reset();

      const [profileResult, addressBookResult] = await Promise.allSettled([
        profile.recoverFromNostr({ identityStore: identity }),
        addressBook.recoverFromNostr({ identityStore: identity }),
      ]);

      if (profileResult.status === 'rejected') {
        // Non-fatal. The user can retry by editing & re-publishing
        // the profile, or via a manual "Restore profile from Nostr"
        // action if we add one later.
        console.warn('[profile] profile recovery after restore failed:', profileResult.reason);
      } else {
        const r = profileResult.value;
        if (r && r.ok && r.hadRemote && r.applied > 0) {
          this.$q.notify({
            type: 'positive',
            message: this.$t('Profile restored'),
            caption: this.$t('We pulled your latest profile from Nostr.'),
            timeout: 4500,
          });
        }
        // hadRemote=false / applied=0 stays silent — a fresh
        // identity with no published profile is the expected case
        // and shouldn't earn a toast.
      }

      if (addressBookResult.status === 'rejected') {
        // Non-fatal. The user can retry from Address Book → kebab →
        // "Restore contacts from Nostr".
        console.warn('[profile] address-book recovery after restore failed:', addressBookResult.reason);
      } else {
        const result = addressBookResult.value;
        if (result && result.ok && result.hadRemote && result.restored > 0) {
          const caption = result.unpayable > 0
            ? this.$t('{n} couldn\'t be restored. They have no Lightning address right now.', { n: result.unpayable })
            : undefined;
          this.$q.notify({
            type: 'positive',
            message: this.$t('Restored {n} contacts', { n: result.restored }),
            caption,
            timeout: 4500,
          });
        }
      }
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

    async openNostrIdentityDialog() {
      // Make sure an identity exists before opening — same lazy pattern
      // as the seed-phrase dialog. The dialog itself calls
      // `identity.loadNostrIdentity()` on mount to populate the cached
      // npub for users whose metadata predates this feature.
      await this.identity.ensureIdentity();
      this.showNostrIdentityDialog = true;
    },

    async executeRegenerate() {
      if (this.regenerateConfirmInput !== this.confirmPhrase) return;
      this.isRegenerating = true;
      try {
        await this.identity.regenerate();
        // Profile metadata is identity-scoped: the new pubkey has no
        // published kind:0 yet, so the old display name / avatar /
        // lud16 are nonsense under the new identity. Wipe the store
        // so the UI lands on the empty "set up your profile" state.
        this.profile.reset();
        this.$q.notify({
          type: 'positive',
          message: this.$t('New profile created'),
          caption: this.$t('Back up your new recovery phrase so you can move this profile to a new phone.'),
          timeout: 4500,
        });
        this.showRegenerateConfirm = false;
      } catch (err) {
        console.error('[Profile] regenerate failed', err);
        // Reuse the 'identity' context so the same modal users see for
        // every other sign-in/identity issue handles this too.
        this.walletStore.showPaymentError(err, {
          context: 'identity',
          route: 'Regenerate identity',
          reason: this.$t('Please try again.'),
          t: this.$t.bind(this),
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

.page-header {
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

.manage-btn {
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

/* ---------- Profile hero ----------
   The trust-anchor surface of the page: one 96px avatar, name,
   subline, status pills, primary + secondary CTA. Replaces the old
   identity strip outright. State variations (fresh install / empty /
   fully set up) are driven by `identity.bootstrapped` + `profile.isEmpty`;
   the markup below is single-template-conditional-light because the
   three states share most of their structure. */

.profile-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 28px 16px 24px;
  margin: 8px 0 16px;
  border-radius: 18px;
  text-align: center;
}

.hero-light {
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.hero-dark {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

/* ---------- Hero avatar ----------
   96px circle. Tap-target wraps the avatar so a generous miss-tap
   region opens the editor. The camera badge in the bottom-right says
   "this is tappable" without needing a caption. */
.hero-avatar-btn {
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.hero-avatar-btn:focus-visible {
  outline: 2px solid #15DE72;
  outline-offset: 4px;
  border-radius: 50%;
}

/* Positioning anchor for the camera badge — the badge sits OUTSIDE
   the avatar's overflow-hidden clip so the icon is never cropped
   at the circle's border. The wrap is the relative parent; the
   avatar inside still owns the clip for the image fill. */
.hero-avatar-wrap {
  position: relative;
  width: 96px;
  height: 96px;
}

.hero-avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  position: relative;
}

.hero-avatar-btn:active .hero-avatar {
  transform: scale(0.97);
  transition-duration: 0.08s;
}

.hero-avatar-light {
  background: rgba(15, 23, 42, 0.04);
  color: #0f172a;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.hero-avatar-dark {
  background: rgba(255, 255, 255, 0.04);
  color: #f8fafc;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.hero-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* Suppress the iOS image-tap callout */
  -webkit-user-select: none;
  user-select: none;
  -webkit-user-drag: none;
}

.hero-avatar-glyph {
  opacity: 0.7;
}

/* Camera badge — neutral monochrome on both themes. The avatar
   itself is the affordance; the badge is just a glanceable hint
   that the area is tappable. No brand colour here. */
.hero-avatar-edit-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #0f172a;
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  border: 2px solid var(--surface-card, #ffffff);
}

body.body--dark .hero-avatar-edit-badge {
  background: rgba(255, 255, 255, 0.10);
  color: #f8fafc;
  border-color: rgba(0, 0, 0, 0.4);
}

/* ---------- Name + subline ----------
   Whole block is one tap target so a near-miss still opens the
   editor. Padding mirrors the avatar gap so the row reads as the
   same surface visually. */
.hero-meta-btn {
  background: transparent;
  border: 0;
  padding: 4px 12px;
  margin: -4px 0 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  -webkit-tap-highlight-color: transparent;
}

.hero-meta-btn:focus-visible {
  outline: 2px solid #15DE72;
  outline-offset: 2px;
  border-radius: 10px;
}

.hero-name {
  font-family: 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
  max-width: 320px;
  /* Wrap on small screens rather than truncating to ellipsis — long
     names are part of the user's identity, not noise. */
  word-break: break-word;
}

.hero-subline {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.4;
  max-width: 320px;
  word-break: break-word;
}

/* ---------- Hero status pills ----------
   Tappable rounded chips. Tone classes are semantic only (is-ok /
   is-warn / is-busy / is-muted / is-danger); the base pill carries
   the layout + light/dark surface. */
.hero-pills {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  padding-top: 2px;
}

.hero-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  cursor: default;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 1;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.18s ease, transform 0.12s ease;
}

button.hero-pill {
  cursor: pointer;
}

button.hero-pill:active {
  transform: scale(0.97);
  transition-duration: 0.06s;
}

button.hero-pill:focus-visible {
  outline: 2px solid #15DE72;
  outline-offset: 2px;
}

/* Single neutral surface across every pill state. The icon to the
   left carries the meaning (shield-check vs shield-exclamation,
   cloud-off vs circle-check, etc); the chip background stays
   monochrome so the row never reads as alarm-coloured noise. */
.hero-pill-light {
  background: rgba(15, 23, 42, 0.04);
  color: #475569;
  border-color: rgba(15, 23, 42, 0.06);
}

.hero-pill-dark {
  background: rgba(255, 255, 255, 0.04);
  color: #cbd5e1;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ---------- Hero CTAs ----------
   Two equal-width neutral pills sharing one row. Same surface on
   both buttons — no primary/secondary hierarchy — so the hero row
   reads as a calm pair of options rather than a green CTA fighting
   a grey one. Modern social-app convention (Instagram, Threads). */
.hero-actions {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 10px;
  width: 100%;
  max-width: 360px;
  margin-top: 6px;
  /* Reserve vertical space so the layout never jumps during the
     sub-100ms passive-bootstrap window when the buttons aren't
     rendered yet. */
  min-height: 44px;
}

.hero-cta {
  flex: 1 1 0;
  height: 44px;
  padding: 0 14px;
  border-radius: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  transition: background-color 0.18s ease, transform 0.12s ease;
}

.hero-cta:active {
  transform: scale(0.98);
}

.hero-cta-light {
  background: rgba(15, 23, 42, 0.06);
  color: #0f172a;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.hero-cta-light:hover {
  background: rgba(15, 23, 42, 0.10);
}

.hero-cta-dark {
  background: rgba(255, 255, 255, 0.06);
  color: #f8fafc;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.hero-cta-dark:hover {
  background: rgba(255, 255, 255, 0.10);
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

/*
  Inline title + help-icon group on the left side of the section
  header. Same vertical rhythm as the standalone label so adding
  the (?) doesn't shift the row height. The help icon is small and
  ghost-styled — it should read as "explain this", not as a primary
  action that competes with the + button on the right.
*/
.sites-section-title {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
}

.sites-help-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background-color 0.18s ease, transform 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.sites-help-btn-light {
  color: rgba(15, 23, 42, 0.55);
}

.sites-help-btn-light:hover {
  background: rgba(15, 23, 42, 0.06);
}

.sites-help-btn-dark {
  color: rgba(248, 250, 252, 0.65);
}

.sites-help-btn-dark:hover {
  background: rgba(255, 255, 255, 0.08);
}

.sites-help-btn:active {
  transform: scale(0.94);
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

/*
  Inline "See examples" link inside the empty-state body line.
  Behaves like a text link — restrained styling, slight accent
  colour to signal tappability without overriding the primary CTA
  (the "+ Sign in to a site" button) below.
*/
.sites-empty-link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  margin-left: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
  -webkit-tap-highlight-color: transparent;
}

.sites-empty-link-light {
  color: #059573;
}

.sites-empty-link-dark {
  color: #15DE72;
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
