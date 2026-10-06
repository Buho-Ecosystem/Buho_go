<template>
  <q-page class="pp-page">
    <div class="pp-shell">
      <!-- Loading. A spinner and one line: the visitor can do nothing until
           the lookup lands, so there is nothing else to show them. -->
      <div v-if="state === 'loading'" class="pp-state">
        <q-spinner size="30px" color="grey-7" />
        <p class="pp-state-text">{{ $t('Looking this up') }}</p>
      </div>

      <!-- Not found. A typo or an old link, neither of which is the
           visitor's fault, so the copy does not scold and still offers a
           way forward. -->
      <div v-else-if="state === 'missing'" class="pp-state">
        <span class="pp-state-mark"><Icon icon="tabler:user-question" width="30" height="30" /></span>
        <h1 class="pp-state-title">{{ $t('No card here') }}</h1>
        <p class="pp-state-text">{{ $t('This link does not point at anyone. It may have been mistyped.') }}</p>
        <a class="pp-ghost" :href="BUHOGO_HOME">{{ $t('Go to BuhoGO') }}</a>
      </div>

      <!--
        Identity and contact actions stay on the card; ProfilePayment owns
        amount entry, invoice creation and the visitor's choice of wallet.
      -->
      <template v-else>
        <!-- 1. Who this is, and Save riding the row. -->
        <div class="pp-top pp-in" :class="{ 'pp-recipient': !isOwner && !invoiceReady }" style="--d: 0ms">
          <span class="pp-avatar">
            <img v-if="avatar" :src="avatar" alt="" @error="avatarBroken = true" />
            <Icon v-else icon="tabler:user" width="20" height="20" />
          </span>
          <div class="pp-top-copy">
            <p v-if="!isOwner" class="pp-recipient-label">{{ $t('Send to') }}</p>
            <h1 class="pp-top-name">{{ displayName }}</h1>
            <div v-if="showAddress" class="pp-top-nip">
              <NostrAddress :address="profile.nip05" :check="addressCheck === true" :icon-size="12" />
            </div>
          </div>
          <!-- The owner cannot save themselves: say whose card this is. -->
          <span v-if="isOwner" class="pp-own-badge">
            <Icon icon="tabler:id-badge-2" width="13" height="13" />
            {{ $t('You') }}
          </span>
          <button
            v-else-if="insideBuhoGo"
            type="button"
            class="pp-save"
            :disabled="saved || saving"
            @click="saveContact"
          >
            <q-spinner v-if="saving" size="13px" />
            <Icon v-else :icon="saved ? 'tabler:check' : 'tabler:user-plus'" width="13" height="13" />
            {{ saved ? $t('Saved') : $t('Save') }}
          </button>
          <!-- Android browser: hand the card to BuhoGO, where Save works.
               Falls back to the download page when BuhoGO is missing. -->
          <a v-else-if="offerAppHandoff" class="pp-save" :href="appHandoffUrl" data-handoff="save">
            <Icon icon="tabler:user-plus" width="13" height="13" />
            {{ $t('Save') }}
          </a>
          <!-- iPhone / desktop: no app to hand off to from here, so explain
               where contacts live instead of a link that does nothing. -->
          <button v-else type="button" class="pp-save" data-handoff="help" @click="showSaveHelp = true">
            <Icon icon="tabler:user-plus" width="13" height="13" />
            {{ $t('Save') }}
          </button>
        </div>

        <!-- The owner's own link: no paying or saving yourself. -->
        <div v-if="isOwner" class="pp-mid">
          <div class="pp-own pp-in" style="--d: 90ms">
            <span class="pp-own-mark"><Icon icon="tabler:id-badge-2" width="26" height="26" /></span>
            <h1 class="pp-own-title">{{ $t('This is your card') }}</h1>
            <p class="pp-own-text">{{ $t('This is what people see when they open your link.') }}</p>
            <div class="pp-own-actions">
              <button type="button" class="pp-cta" @click="shareOwnLink">
                <Icon :icon="linkCopied ? 'tabler:check' : 'tabler:share'" width="17" height="17" />
                {{ linkCopied ? $t('Link copied') : $t('Share link') }}
              </button>
              <button type="button" class="pp-ghost pp-own-edit" @click="editOwnCard">
                <Icon icon="tabler:pencil" width="15" height="15" />
                {{ $t('Edit card') }}
              </button>
            </div>
          </div>
        </div>

        <ProfilePayment v-else-if="lud16" :address="lud16" :name="displayName" @invoice-ready="invoiceReady = $event" />

        <!-- Nothing to pay yet. Stated once, quietly, where the amount
             would have been. -->
        <div v-else class="pp-mid">
          <div class="pp-note-empty pp-in" style="--d: 90ms">
            <Icon icon="tabler:info-circle" width="17" height="17" />
            <span>{{ $t('{name} has not set up payments yet, so there is nothing to send to.', { name: spokenName }) }}</span>
          </div>
        </div>

        <!-- 5. The foot: a question, answered by the product. -->
        <footer v-if="!isOwner" class="pp-foot pp-in" style="--d: 300ms">
          <img src="/buho_logo.svg" alt="" width="16" height="16" />
          <span>
            {{ $t('Want a page like this too?') }} <a :href="BUHOGO_HOME">{{ $t('Get BuhoGO') }}</a>
            <template v-if="offerAppHandoff"> · <a :href="appHandoffUrl" data-handoff="open">{{ $t('Open in BuhoGO') }}</a></template>
          </span>
        </footer>
      </template>
    </div>

    <!-- Save, where no app handoff exists (iPhone, desktop). Contacts live
         in BuhoGO, so say so and offer the two things that get there. -->
    <q-dialog v-model="showSaveHelp" position="bottom">
      <div class="pp-code-sheet pp-save-help">
        <div class="pp-grab" aria-hidden="true"></div>
        <h2 class="pp-help-title">{{ $t('Save {name} in BuhoGO', { name: spokenName }) }}</h2>
        <p class="pp-help-text">{{ $t('Contacts are kept in the BuhoGO app. Get it, then open this link on that phone and tap Save.') }}</p>
        <a class="pp-cta pp-help-cta" :href="BUHOGO_HOME">
          <Icon icon="tabler:download" width="17" height="17" />
          {{ $t('Get BuhoGO') }}
        </a>
        <button type="button" class="pp-ghost pp-help-copy" @click="copyCardLink">
          <Icon :icon="linkCopied ? 'tabler:check' : 'tabler:copy'" width="15" height="15" />
          {{ linkCopied ? $t('Link copied') : $t('Copy link') }}
        </button>
      </div>
    </q-dialog>
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import ProfilePayment from '../components/profile/ProfilePayment.vue';
import { Capacitor } from '@capacitor/core';
import { lookupIdentifier } from '../utils/nostrLookup.js';
import { fetchProfile, parseProfileContent } from '../utils/nostrFetch.js';
import { profileDisplayName, sanitizeImageUrl, shortenNpub } from '../services/nostrRecipient.js';
import { isLightningAddress } from '../utils/addressUtils.js';
import { formatUsername, lookupOwner, splitNip05 } from '../services/nip05.js';
import NostrAddress from '../components/identity/NostrAddress.vue';
import { BUHOGO_HOME, buildProfileLink, expandProfileSlug, isKey, KEY_PARAM } from '../utils/profileLink.js';
import {
  buildAppHandoffUrl,
  cardUrl,
  cleanCardAddress,
  hashCardAddress,
  isAndroidBrowser,
  isOwnCard,
} from '../utils/publicCard.js';
import { useWalletStore } from '../stores/wallet';
import { useAddressBookStore } from '../stores/addressBook';
import { useIdentityStore } from '../stores/identity';

export default {
  name: 'PublicProfilePage',

  components: { Icon, ProfilePayment, NostrAddress },

  setup() {
    return { walletStore: useWalletStore(), addressBook: useAddressBookStore(), identity: useIdentityStore() };
  },

  data() {
    return {
      state: 'loading', // 'loading' | 'ready' | 'missing'
      npub: '',
      // Kept from the lookup so a save can go through the Nostr contact path,
      // which is keyed on the pubkey and does not need a Lightning address.
      pubkey: '',
      relayHints: [],
      profileEvent: null,
      profile: null,
      /** Does the profile's address point at this key? true, false, or null (not known yet). */
      addressCheck: null,
      avatarBroken: false,
      showSaveHelp: false,
      invoiceReady: false,
      linkCopied: false,
      saved: false,
      saving: false,
      BUHOGO_HOME,
      _linkTimer: null,
    };
  },

  computed: {
    /** True when the card published a name we can use in prose. */
    hasName() {
      return !!this.profile?.name;
    },

    /**
     * The heading. A shortened key is an acceptable heading; it is not an
     * acceptable subject for a sentence, which is what `spokenName` is for.
     */
    displayName() {
      if (this.hasName) return this.profile.name;
      return this.npub ? shortenNpub(this.npub) : this.$t('This person');
    },

    /** The name as it appears inside sentences and on buttons. */
    spokenName() {
      return this.hasName ? this.firstName : this.$t('This person');
    },

    firstName() {
      return String(this.displayName).trim().split(/\s+/)[0];
    },

    /**
     * The address line under the name: the full `name@domain`, domain
     * emphasised, per the Nostr Design Guide. Hidden when it would repeat
     * the name above it, for a retired free handle, and for an address that
     * points at someone else's key.
     */
    showAddress() {
      const parts = formatUsername(this.profile?.nip05);
      if (!parts || this.addressCheck === false) return false;
      return parts.text !== String(this.displayName).trim().toLowerCase();
    },

    /**
     * What this person gets filed under. The heading may fall back to a
     * shortened key, which identifies them on screen but is not something to
     * save an address book entry as.
     */
    contactName() {
      if (this.hasName) return this.profile.name;
      return formatUsername(this.profile?.nip05)?.local || this.$t('Unnamed');
    },

    avatar() {
      if (this.avatarBroken) return '';
      return this.profile?.picture || '';
    },

    /**
     * The payment address, only when it is actually payable.
     *
     * Profiles in the wild carry malformed values here, `@domain` with no
     * local part being a common one. Offering to pay something the send path
     * would reject is worse than saying there is nothing to pay, so this
     * uses the same validator the wallet uses before it will spend.
     */
    lud16() {
      const value = String(this.profile?.lud16 || '').trim();
      return isLightningAddress(value) ? value : '';
    },

    /**
     * True when the page is being read by someone who already has BuhoGO:
     * the native app, or the web build with a wallet already set up. A
     * stranger opening the link in a browser has neither, and needs the
     * handoff rather than in-app actions.
     */
    insideBuhoGo() {
      if (Capacitor.isNativePlatform()) return true;
      return (this.walletStore.wallets || []).length > 0;
    },

    /**
     * The visitor is the card's owner (their own identity on this device).
     * They see a "This is your card" state instead of Save and Pay.
     */
    isOwner() {
      if (this.state !== 'ready') return false;
      return isOwnCard({ pubkey: this.pubkey, npub: this.npub }, this.identity);
    },

    /**
     * The https link for this card on the production origin. Leads with the
     * resolved key when there is one, so the app opens it with no lookup.
     */
    canonicalCardUrl() {
      if (this.npub) return cardUrl(this.npub);
      return cardUrl(String(this.$route.params.id || ''), String(this.$route.query[KEY_PARAM] || ''));
    },

    /**
     * Android browsers get an intent link that opens this card in BuhoGO
     * (Save works there) and falls back to the download page. A `nostr:`
     * link used to be here: Android handed it to BuhoGO's payment handler,
     * and iPhones and desktops did nothing at all.
     */
    offerAppHandoff() {
      if (this.insideBuhoGo) return false;
      return typeof navigator !== 'undefined' && isAndroidBrowser(navigator.userAgent);
    },

    appHandoffUrl() {
      return buildAppHandoffUrl(this.canonicalCardUrl, { fallbackUrl: BUHOGO_HOME });
    },

  },

  watch: {
    // The component is reused between cards (a nostr: deep link while a card
    // is already open), so a new id has to resolve again.
    '$route.params.id'(id, previous) {
      if (!id || id === previous || !this.$route.path.startsWith('/p/')) return;
      this.resetCard();
      this.resolve();
      this.$nextTick(() => this.useCleanAddress());
    },
  },

  async created() {
    // Owner detection reads the identity from disk; hydrate is idempotent.
    Promise.resolve(this.identity.hydrate?.()).catch(() => {});
    await this.resolve();
  },

  mounted() {
    this.useCleanAddress();
  },

  beforeRouteLeave(to, from, next) {
    this.restoreHashAddress();
    next();
  },

  beforeUnmount() {
    this.restoreHashAddress();
    if (this._linkTimer) clearTimeout(this._linkTimer);
  },

  methods: {
    /**
     * Show `go.mybuho.de/p/…` in the address bar instead of `/#/p/…`.
     *
     * The copied address is what people pass on, and only the path form can
     * match the Android App Link. The router keeps its own state, so it keeps
     * working; the index.html shim puts the hash back on a reload or when the
     * visitor comes back to this entry, and `restoreHashAddress` does before
     * the router navigates away. Browser only: the packaged app has no
     * address bar and its path must stay `/`.
     */
    useCleanAddress() {
      if (Capacitor.isNativePlatform() || typeof window === 'undefined') return;
      const clean = cleanCardAddress(window.location.hash);
      if (!clean) return;
      try {
        window.history.replaceState(window.history.state, '', clean);
      } catch { /* a browser that refuses keeps the hash form, which works */ }
    },

    /** Undo the above, so the router builds its next URL from `/#/…`. */
    restoreHashAddress() {
      if (Capacitor.isNativePlatform() || typeof window === 'undefined') return;
      const { pathname, search, hash } = window.location;
      const hashed = hashCardAddress(pathname, search, hash);
      if (!hashed) return;
      try {
        window.history.replaceState(window.history.state, '', hashed);
      } catch { /* nothing to restore */ }
    },

    resetCard() {
      Object.assign(this, {
        state: 'loading',
        npub: '',
        pubkey: '',
        relayHints: [],
        profileEvent: null,
        profile: null,
        addressCheck: null,
        avatarBroken: false,
        saved: false,
        saving: false,
        invoiceReady: false,
      });
    },

    async copyCardLink() {
      const link = this.canonicalCardUrl;
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
        this.flashLinkCopied();
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800, position: 'top' });
      }
    },

    flashLinkCopied() {
      this.linkCopied = true;
      if (this._linkTimer) clearTimeout(this._linkTimer);
      this._linkTimer = setTimeout(() => { this.linkCopied = false; }, 1600);
    },

    /** The owner's Share: the system sheet where there is one, else copy. */
    async shareOwnLink() {
      const link = buildProfileLink({ npub: this.npub }) || this.canonicalCardUrl;
      if (!link) return;
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({ url: link });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(link);
        this.flashLinkCopied();
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800, position: 'top' });
      }
    },

    editOwnCard() {
      this.$router.push('/identity/profile').catch(() => {});
    },

    /**
     * Slug to profile.
     *
     * The link leads with the key, which resolves with no network call. A
     * username slug goes through NIP-05 and can fail for reasons that have
     * nothing to do with the person, so `k` still works as the fallback for
     * older links. Only a link with nothing resolvable is missing.
     */
    async resolve() {
      // A newer card (same component, new id) wins over a lookup in flight.
      const run = (this._resolveRun = (this._resolveRun || 0) + 1);
      const stale = () => run !== this._resolveRun;

      const identifier = expandProfileSlug(this.$route.params.id);
      const fallbackKey = String(this.$route.query[KEY_PARAM] || '').trim();

      if (!identifier && !fallbackKey) {
        this.state = 'missing';
        return;
      }

      let resolved = identifier ? await this.tryLookup(identifier) : null;
      if (stale()) return;

      if (!resolved && fallbackKey && isKey(fallbackKey)) {
        console.warn('[public-profile] name lookup failed, falling back to the key');
        resolved = await this.tryLookup(fallbackKey);
        if (stale()) return;
      }

      if (!resolved) {
        this.state = 'missing';
        return;
      }

      this.npub = resolved.npub;
      this.pubkey = resolved.pubkey;
      this.relayHints = Array.isArray(resolved.relays) ? resolved.relays : [];

      // The page renders either way. A key that resolves but has published
      // nothing is still a real person, and a relay round trip that fails is
      // not a reason to tell a visitor the link is broken.
      try {
        const event = await fetchProfile(resolved.pubkey, { relays: resolved.relays });
        if (stale()) return;
        if (event) {
          this.profileEvent = event;
          const content = parseProfileContent(event);
          this.profile = {
            name: profileDisplayName(content),
            picture: sanitizeImageUrl(content.picture),
            about: typeof content.about === 'string' ? content.about : '',
            nip05: typeof content.nip05 === 'string' ? content.nip05 : '',
            lud16: typeof content.lud16 === 'string' ? content.lud16.trim().toLowerCase() : '',
          };
          this.checkAddress();
        }
      } catch (err) {
        console.warn('[public-profile] profile fetch failed:', err);
      }

      if (stale()) return;
      this.state = 'ready';
    },

    /**
     * Confirm the profile's address points at this key before the check is
     * shown. Our own domain is asked of the name server directly; any other
     * domain through its NIP-05 file. Unknown stays unknown: the address is
     * shown without the check rather than hidden.
     */
    async checkAddress() {
      const parts = splitNip05(this.profile?.nip05);
      if (!parts || !this.pubkey) return;
      let owner = null;
      if (parts.ours) {
        owner = await lookupOwner(parts.local);
      } else {
        const resolved = await this.tryLookup(`${parts.local}@${parts.domain}`);
        owner = resolved ? resolved.pubkey : null;
      }
      if (owner === null) return;
      this.addressCheck = String(owner).toLowerCase() === String(this.pubkey).toLowerCase();
    },

    /**
     * One lookup attempt. Returns null instead of throwing so the caller can
     * simply try the next identifier it has.
     */
    async tryLookup(identifier) {
      try {
        return await lookupIdentifier(identifier);
      } catch (err) {
        console.warn('[public-profile] could not resolve', identifier, err?.code || err);
        return null;
      }
    },

    /**
     * Saving goes through the Nostr contact path, not the plain address one.
     *
     * Two reasons. A person is their key, so a contact keyed on the pubkey
     * survives them changing where money lands. And the plain path validates
     * whatever it is handed as a Lightning address, so passing an npub to it
     * threw "Invalid Lightning address format": saving anyone whose card had
     * no Lightning address failed outright, which is exactly the person a
     * visitor most needs to keep.
     */
    async saveContact() {
      if (this.saved || this.saving) return;
      this.saving = true;
      try {
        if (this.profileEvent) {
          await this.addressBook.addNostrContact({
            pubkey: this.pubkey,
            npub: this.npub,
            event: this.profileEvent,
            relayHints: this.relayHints,
            allowWithoutLightningAddress: true,
          });
        } else if (this.lud16) {
          // No card came back from the relays, so there is nothing to verify
          // and nothing to key on. An address and a name is still a contact.
          await this.addressBook.addEntry({
            name: this.contactName,
            address: this.lud16,
            addressType: 'lightning',
          });
        } else {
          this.$q.notify({
            type: 'warning',
            message: this.$t("Couldn't load their card"),
            caption: this.$t('Try again in a moment.'),
            timeout: 3500,
          });
          return;
        }
        this.saved = true;
        this.$q.notify({ type: 'positive', message: this.$t('Contact added'), timeout: 2500 });
      } catch (err) {
        // Already having them is the outcome the button promises, not a
        // failure to report.
        if (/already/i.test(String(err?.message || ''))) {
          this.saved = true;
          return;
        }
        console.warn('[public-profile] save failed:', err);
        this.$q.notify({ type: 'negative', message: this.$t("Couldn't save the contact"), timeout: 3000 });
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>

<style scoped>
/* This page is read by people who have never seen BuhoGO, usually inside a
   chat app's browser. It carries its own light palette rather than inheriting
   the wallet's theme, so it looks the same for everyone and never depends on
   a setting the visitor has not made. */
.pp-page {
  min-height: 100vh;
  min-height: 100dvh;
  background: #FAF7EF;
  color: #1C1B18;
  font-family: 'Manrope', sans-serif;
  display: flex;
  justify-content: center;
  /* --safe-top / --safe-bottom, not raw env(): env resolves to 0 on most
     Android Capacitor WebViews, and this page is reachable inside the app. */
  padding: max(16px, var(--safe-top, 0px)) 20px max(12px, var(--safe-bottom, 0px));
}

.pp-shell {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Snappy entrance: pop and rise, staggered, everything inside 400ms. */
.pp-in {
  opacity: 0;
  animation: pp-rise 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: var(--d, 0ms);
}

@keyframes pp-rise {
  0% { opacity: 0; transform: translateY(14px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .pp-in { animation: none; opacity: 1; }
}

/* States */
.pp-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  text-align: center;
  gap: 12px;
  padding: 40px 0;
}

.pp-state-mark {
  width: 66px;
  height: 66px;
  border-radius: 50%;
  background: rgba(28, 27, 24, 0.06);
  color: #9A9488;
  display: grid;
  place-items: center;
}

.pp-state-title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0;
}

.pp-state-text {
  font-size: 14px;
  color: #6B665C;
  line-height: 1.55;
  max-width: 32ch;
  margin: 0;
}

.pp-ghost {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 20px;
  border-radius: 22px;
  background: rgba(28, 27, 24, 0.06);
  color: #1C1B18;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}

/* 1. Identity row */
.pp-top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 8px;
  flex: 0 0 auto;
}

.pp-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(28, 27, 24, 0.06);
  color: #9A9488;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.pp-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pp-top-copy { flex: 1; min-width: 0; }

.pp-top-name {
  margin: 0;
  line-height: 1.4;
  font-size: 15px;
  font-weight: 780;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pp-top-nip {
  display: flex;
  min-width: 0;
  font-size: 11.5px;
  color: #6B665C;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pp-save {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: rgba(5, 149, 115, 0.1);
  color: #08785C;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 750;
  border-radius: 999px;
  min-height: 44px;
  padding: 0 13px;
  flex: 0 0 auto;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.1s ease;
}

.pp-save:active { transform: scale(0.94); }
.pp-save:disabled { cursor: default; }

/* A shared payment page leads with the person, like a personal payment link.
   Contact saving remains available without competing with the payment. */
.pp-recipient {
  position: relative;
  flex-direction: column;
  gap: 12px;
  padding: 28px 0 12px;
  text-align: center;
}
.pp-recipient .pp-avatar { width: 72px; height: 72px; }
.pp-recipient .pp-avatar :deep(svg) { width: 30px; height: 30px; }
.pp-recipient .pp-top-copy { width: 100%; }
.pp-recipient .pp-top-name { font-size: 23px; white-space: normal; overflow-wrap: anywhere; }
.pp-recipient .pp-top-nip { justify-content: center; color: #6b665c; margin-top: 4px; }
.pp-recipient .pp-save { position: absolute; top: 0; right: 0; color: #08785c; }
.pp-recipient-label { margin: 0 0 3px; font-size: 13px; color: #6b665c; }
.pp-save:focus-visible, .pp-foot a:focus-visible { outline: 2px solid #08785c; outline-offset: 3px; }

@media (min-width: 600px) {
  .pp-page { padding: 40px 24px; background: #eeebe3; align-items: center; }
  .pp-shell { max-width: 440px; min-height: 700px; padding: 24px; border-radius: 28px; background: #faf7ef; box-shadow: 0 12px 48px #1c1b180a; }
}

/* 2. The amount */
.pp-mid {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.pp-note-empty {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13.5px;
  color: #6B665C;
  line-height: 1.5;
  max-width: 34ch;
}

/* 4. The verb */
.pp-cta {
  flex: 1;
  min-height: 52px;
  border-radius: 26px;
  border: 0;
  background: #1A1A1C;
  color: #FAF7EF;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 780;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: transform 0.1s ease;
}

.pp-cta:active { transform: scale(0.97); }
.pp-cta:disabled { opacity: 0.75; cursor: default; }

/* 5. The foot */
/* The owner's own card. */
.pp-own-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(28, 27, 24, 0.06);
  color: #6B665C;
  font-size: 12px;
  font-weight: 750;
  border-radius: 999px;
  min-height: 34px;
  padding: 0 13px;
  flex: 0 0 auto;
}
.pp-own {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  width: 100%;
}
.pp-own-mark {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: rgba(5, 149, 115, 0.1);
  color: #059573;
  display: grid;
  place-items: center;
}
.pp-own-title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0;
}
.pp-own-text {
  font-size: 14px;
  color: #6B665C;
  line-height: 1.55;
  max-width: 32ch;
  margin: 0;
}
.pp-own-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  width: 100%;
  margin-top: 8px;
}
.pp-own-edit,
.pp-help-copy {
  justify-content: center;
  gap: 6px;
  border: 0;
  font-family: 'Manrope', sans-serif;
  cursor: pointer;
}

/* Save help (no app handoff on this device). */
.pp-save-help {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pp-help-title {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.01em;
  margin: 4px 0 0;
  text-align: center;
}
.pp-help-text {
  font-size: 14px;
  color: #6B665C;
  line-height: 1.55;
  margin: 0;
  text-align: center;
}
.pp-help-cta {
  flex: 0 0 auto;
  text-decoration: none;
}
.pp-help-cta,
.pp-help-copy {
  align-self: stretch;
}

.pp-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 14px 0 4px;
  font-size: 12px;
  color: #6B665C;
  flex: 0 0 auto;
}

.pp-foot a {
  color: #08785C;
  font-weight: 800;
  text-decoration: none;
  white-space: nowrap;
}

/* The code sheet */
.pp-code-sheet {
  width: 100%;
  max-width: 400px;
  background: #FAF7EF;
  color: #1C1B18;
  border-radius: 22px 22px 0 0;
  padding: 10px 20px max(20px, env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: 'Manrope', sans-serif;
}

.pp-grab {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: #9A9488;
  opacity: 0.4;
  margin: 0 auto 16px;
}

</style>
