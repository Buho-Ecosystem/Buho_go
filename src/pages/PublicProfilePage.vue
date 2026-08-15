<template>
  <q-page class="pp-page">
    <div class="pp-shell">
      <!-- Loading. A spinner and nothing else: the page has one job and the
           visitor cannot do anything until the lookup lands. -->
      <div v-if="state === 'loading'" class="pp-state">
        <q-spinner size="30px" color="grey-7" />
        <p class="pp-state-text">{{ $t('Looking this up') }}</p>
      </div>

      <!-- Not found. The likeliest cause is a typo or an old link, and
           neither is the visitor's fault, so the copy does not scold. -->
      <div v-else-if="state === 'missing'" class="pp-state">
        <span class="pp-state-mark"><Icon icon="tabler:user-question" width="30" height="30" /></span>
        <h1 class="pp-state-title">{{ $t('No card here') }}</h1>
        <p class="pp-state-text">{{ $t('This link does not point at anyone. It may have been mistyped.') }}</p>
        <a class="pp-btn pp-btn--ghost" :href="BUHOGO_HOME">{{ $t('Go to BuhoGO') }}</a>
      </div>

      <template v-else>
        <!-- The person. Same shape as the card in the app, so a visitor who
             later installs BuhoGO recognises what they already saw. -->
        <section class="pp-card">
          <span class="pp-avatar">
            <img v-if="avatar" :src="avatar" alt="" @error="avatarBroken = true" />
            <Icon v-else icon="tabler:user" width="38" height="38" />
          </span>

          <h1 class="pp-name">{{ displayName }}</h1>
          <p v-if="username" class="pp-username">{{ '@' + username }}</p>
          <p v-if="about" class="pp-about">{{ about }}</p>
        </section>

        <!-- Paying. The address is what makes any of this work, so when it is
             missing the page says so plainly instead of showing a button that
             would fail. -->
        <template v-if="lud16">
          <button type="button" class="pp-btn pp-btn--primary" @click="onPay">
            <Icon icon="tabler:arrow-bar-to-down" width="18" height="18" />
            {{ payLabel }}
          </button>

          <button type="button" class="pp-btn pp-btn--ghost" @click="showAddress = !showAddress">
            {{ showAddress ? $t('Hide the address') : $t('Show the address') }}
          </button>

          <!-- Desktop and any wallet that cannot open a link: the address
               itself, as text and as a code. -->
          <div v-if="showAddress" class="pp-address">
            <div class="pp-qr">
              <vue-qrcode :value="lud16" :options="qrOptions" class="pp-qr-canvas" />
            </div>
            <button type="button" class="pp-copy" @click="copyAddress">
              <span class="pp-copy-value">{{ lud16 }}</span>
              <Icon :icon="copied ? 'tabler:check' : 'tabler:copy'" width="16" height="16" />
            </button>
            <p class="pp-hint">{{ $t('Scan or paste this into any Bitcoin wallet.') }}</p>
          </div>
        </template>

        <div v-else class="pp-note">
          <Icon icon="tabler:info-circle" width="17" height="17" />
          <span>{{ $t('{name} has not set up payments yet, so there is nothing to send to.', { name: spokenName }) }}</span>
        </div>

        <!-- Keeping the person. Inside BuhoGO this saves them; outside it
             hands the visitor over to the app, which is the only place the
             contact can actually live. -->
        <button v-if="insideBuhoGo" type="button" class="pp-btn pp-btn--ghost" :disabled="saved" @click="saveContact">
          <Icon :icon="saved ? 'tabler:check' : 'tabler:user-plus'" width="18" height="18" />
          {{ saved ? $t('Saved to your contacts') : $t('Save to my contacts') }}
        </button>

        <template v-else>
          <a class="pp-btn pp-btn--ghost" :href="nostrUri">
            <Icon icon="tabler:user-plus" width="18" height="18" />
            {{ $t('Add to BuhoGO') }}
          </a>
          <p class="pp-hint pp-hint--centred">
            {{ $t('Do not have it?') }}
            <a class="pp-link" :href="BUHOGO_HOME">{{ $t('Get BuhoGO') }}</a>
          </p>
        </template>
      </template>

      <footer class="pp-foot">
        <a class="pp-foot-link" :href="BUHOGO_HOME">
          <img src="/buho_logo.svg" alt="" width="18" height="18" />
          <span>BuhoGO</span>
        </a>
      </footer>
    </div>
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { Capacitor } from '@capacitor/core';
import { lookupIdentifier } from '../utils/nostrLookup.js';
import { fetchProfile, parseProfileContent } from '../utils/nostrFetch.js';
import { profileDisplayName, sanitizeImageUrl, shortenNpub } from '../services/nostrRecipient.js';
import { BUHOGO_HOME, expandProfileSlug, isKey, KEY_PARAM } from '../utils/profileLink.js';
import { getQrOptionsWithSize } from '../utils/qrConfig.js';
import { useWalletStore } from '../stores/wallet';
import { useAddressBookStore } from '../stores/addressBook';

export default {
  name: 'PublicProfilePage',

  components: { Icon, VueQrcode },

  setup() {
    return { walletStore: useWalletStore(), addressBook: useAddressBookStore() };
  },

  data() {
    return {
      state: 'loading', // 'loading' | 'ready' | 'missing'
      npub: '',
      profile: null,
      avatarBroken: false,
      showAddress: false,
      copied: false,
      saved: false,
      BUHOGO_HOME,
      _copyTimer: null,
    };
  },

  computed: {
    /** True when the card actually published a name we can use in prose. */
    hasName() {
      return !!this.profile?.name;
    },

    /** The heading. A shortened key is an acceptable heading; it is not an
        acceptable subject for a sentence, which is what `spokenName` is for. */
    displayName() {
      if (this.hasName) return this.profile.name;
      return this.npub ? shortenNpub(this.npub) : this.$t('This person');
    },

    /** The name as it appears inside sentences and on buttons. */
    spokenName() {
      return this.hasName ? this.firstName : this.$t('This person');
    },

    username() {
      const nip05 = this.profile?.nip05 || '';
      return nip05 ? nip05.split('@')[0] : '';
    },

    about() {
      return this.profile?.about || '';
    },

    avatar() {
      if (this.avatarBroken) return '';
      return this.profile?.picture || '';
    },

    lud16() {
      return this.profile?.lud16 || '';
    },

    /**
     * True when the page is being read by someone who already has BuhoGO:
     * the native app, or the web build with a wallet already set up. A
     * stranger opening the link in a browser has neither, and needs the
     * app-handoff buttons instead of in-app actions.
     */
    insideBuhoGo() {
      if (Capacitor.isNativePlatform()) return true;
      return (this.walletStore.wallets || []).length > 0;
    },

    payLabel() {
      return this.hasName ? this.$t('Pay {name}', { name: this.firstName }) : this.$t('Pay');
    },

    firstName() {
      return String(this.displayName).trim().split(/\s+/)[0];
    },

    /** Opens BuhoGO on Android, which already claims the nostr scheme. */
    nostrUri() {
      return this.npub ? `nostr:${this.npub}` : BUHOGO_HOME;
    },

    qrOptions() {
      return getQrOptionsWithSize(168);
    },
  },

  async created() {
    await this.resolve();
  },

  beforeUnmount() {
    if (this._copyTimer) clearTimeout(this._copyTimer);
  },

  methods: {
    /**
     * Slug to profile.
     *
     * A username has to go through NIP-05, which is a call to that
     * username's domain and can fail for reasons that have nothing to do
     * with the person or the link: the domain can be down, slow, or its
     * record can have moved. The link carries the key in `k` for exactly
     * that case, so a lookup failure falls back to it instead of showing a
     * stranger a dead page. Only a link with no key left to try can be
     * genuinely missing.
     */
    async resolve() {
      const identifier = expandProfileSlug(this.$route.params.id);
      const fallbackKey = String(this.$route.query[KEY_PARAM] || '').trim();

      if (!identifier && !fallbackKey) {
        this.state = 'missing';
        return;
      }

      let resolved = identifier ? await this.tryLookup(identifier) : null;

      if (!resolved && fallbackKey && isKey(fallbackKey)) {
        console.warn('[public-profile] name lookup failed, falling back to the key');
        resolved = await this.tryLookup(fallbackKey);
      }

      if (!resolved) {
        this.state = 'missing';
        return;
      }

      this.npub = resolved.npub;

      // The card renders either way. A key that resolves but has published
      // nothing is still a real person, and a relay round trip that fails is
      // not a reason to tell a visitor the link is broken.
      try {
        const event = await fetchProfile(resolved.pubkey, { relays: resolved.relays });
        if (event) {
          const content = parseProfileContent(event);
          this.profile = {
            name: profileDisplayName(content),
            picture: sanitizeImageUrl(content.picture),
            about: typeof content.about === 'string' ? content.about : '',
            nip05: typeof content.nip05 === 'string' ? content.nip05 : '',
            lud16: typeof content.lud16 === 'string' ? content.lud16.trim().toLowerCase() : '',
          };
        }
      } catch (err) {
        console.warn('[public-profile] profile fetch failed:', err);
      }

      this.state = 'ready';
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
     * Inside the app this hands the address to the send flow. Outside it
     * hands it to the operating system, which offers every installed wallet
     * including BuhoGO. Either way the visitor never has to copy anything.
     */
    onPay() {
      if (!this.lud16) return;

      if (this.insideBuhoGo) {
        this.$router.push({
          path: '/wallet',
          query: {
            action: 'pay_contact',
            address: this.lud16,
            addressType: 'lightning',
            contactName: this.displayName,
          },
        });
        return;
      }

      window.location.href = `lightning:${this.lud16}`;
      // No wallet handled the scheme, most likely a desktop browser. Reveal
      // the address so the visit still ends somewhere useful.
      setTimeout(() => { this.showAddress = true; }, 1200);
    },

    async copyAddress() {
      if (!this.lud16) return;
      try {
        await navigator.clipboard.writeText(this.lud16);
        this.copied = true;
        if (this._copyTimer) clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => { this.copied = false; }, 1600);
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800, position: 'top' });
      }
    },

    async saveContact() {
      if (this.saved) return;
      const address = this.lud16 || this.npub;
      if (!address) return;

      try {
        // addEntry initialises the store itself, so a visitor who lands here
        // before the address book has ever loaded is handled.
        await this.addressBook.addEntry({
          name: this.displayName,
          address,
          addressType: this.lud16 ? 'lightning' : 'nostr',
        });
        this.saved = true;
        this.$q.notify({ type: 'positive', message: this.$t('Contact added'), timeout: 2500 });
      } catch (err) {
        console.warn('[public-profile] save failed:', err);
        this.$q.notify({ type: 'negative', message: this.$t("Couldn't save the contact"), timeout: 3000 });
      }
    },
  },
};
</script>

<style scoped>
/* This page is read by people who have never seen BuhoGO, often on a random
   phone in a chat app's in-app browser. It carries its own light palette
   rather than inheriting the wallet's theme, so it looks the same for
   everyone and never depends on a setting the visitor has not made. */
.pp-page {
  min-height: 100vh;
  background: #FAF7EF;
  font-family: 'Manrope', sans-serif;
  display: flex;
  justify-content: center;
  padding: max(24px, env(safe-area-inset-top, 0px)) 20px max(24px, env(safe-area-inset-bottom, 0px));
}

.pp-shell {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

/* States */
.pp-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 40px 0;
}

.pp-state-mark {
  width: 66px;
  height: 66px;
  border-radius: 22px;
  background: #F3EFE3;
  color: #5F5B52;
  display: grid;
  place-items: center;
}

.pp-state-title {
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.03em;
  color: #1A1A1C;
  margin: 4px 0 0;
}

.pp-state-text {
  font-size: 14.5px;
  color: #5F5B52;
  line-height: 1.5;
  margin: 0;
  max-width: 300px;
}

/* The person */
.pp-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 8px 0 26px;
}

.pp-avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  overflow: hidden;
  background: #F3EFE3;
  color: #928D83;
  display: grid;
  place-items: center;
  box-shadow: 0 12px 30px -18px rgba(40, 34, 20, 0.5);
}

.pp-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

.pp-name {
  font-size: 25px;
  font-weight: 760;
  letter-spacing: -0.032em;
  color: #1A1A1C;
  margin: 16px 0 0;
  line-height: 1.2;
}

.pp-username {
  font-size: 14.5px;
  color: #5F5B52;
  margin: 5px 0 0;
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
}

.pp-about {
  font-size: 14.5px;
  color: #5F5B52;
  line-height: 1.5;
  margin: 12px 0 0;
  max-width: 320px;
}

/* Actions. One primary, everything else quiet, which is the whole point of
   a page with a single job. */
.pp-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  min-height: 54px;
  padding: 16px 18px;
  border-radius: 16px;
  border: 1px solid transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
  cursor: pointer;
  margin-bottom: 10px;
  text-decoration: none;
}

.pp-btn--primary { background: #1A1A1C; color: #FAF7EF; }
.pp-btn--primary:active { opacity: 0.9; }

.pp-btn--ghost {
  background: transparent;
  color: #1A1A1C;
  border-color: #E3DCC7;
}

.pp-btn:disabled { opacity: 0.55; cursor: default; }

/* Address block */
.pp-address {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 6px 0 4px;
}

.pp-qr {
  width: 188px;
  height: 188px;
  border-radius: 20px;
  background: #fff;
  padding: 10px;
  box-shadow: 0 14px 30px -20px rgba(40, 34, 20, 0.55);
}

.pp-qr :deep(img),
.pp-qr :deep(canvas),
.pp-qr-canvas { width: 100%; height: 100%; display: block; }

.pp-copy {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
  background: #F3EFE3;
  border: 1px solid #E3DCC7;
  border-radius: 14px;
  padding: 12px 14px;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  color: #1A1A1C;
  min-height: 48px;
}

.pp-copy-value {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pp-note {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 14px;
  border-radius: 14px;
  background: #F3EFE3;
  color: #5F5B52;
  font-size: 13.5px;
  line-height: 1.5;
  margin-bottom: 14px;
}

.pp-note svg { color: #928D83; margin-top: 1px; flex: 0 0 auto; }

.pp-hint {
  font-size: 12.5px;
  color: #928D83;
  line-height: 1.5;
  margin: 2px 0 10px;
  text-align: center;
}

.pp-hint--centred { text-align: center; }

.pp-link { color: #059573; font-weight: 620; text-decoration: none; }

.pp-foot {
  display: flex;
  justify-content: center;
  padding-top: 22px;
}

.pp-foot-link {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 650;
  color: #928D83;
  text-decoration: none;
}

/* Desktop gets the same column rather than a stretched layout: the page is a
   handoff, and a wide version of it would only add empty space. */
@media (min-width: 720px) {
  .pp-page { align-items: center; }
}
</style>
