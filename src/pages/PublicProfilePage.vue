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
        <a class="pp-btn pp-btn--ghost" :href="BUHOGO_HOME">{{ $t('Go to BuhoGO') }}</a>
      </div>

      <template v-else>
        <!--
          1. Who this is.

          The person owns the top of the page on their own. Everything below
          is something the visitor can do about them, which is the order a
          stranger reads in: who, then what.
        -->
        <section class="pp-person">
          <span class="pp-avatar">
            <img v-if="avatar" :src="avatar" alt="" @error="avatarBroken = true" />
            <Icon v-else icon="tabler:user" width="38" height="38" />
          </span>

          <h1 class="pp-name">{{ displayName }}</h1>
          <p v-if="username" class="pp-username">{{ '@' + username }}</p>
          <p v-if="about" class="pp-about">{{ about }}</p>
        </section>

        <!--
          2. The one thing most visitors came to do.

          A single filled button, alone, with nothing competing beside it.
          Everything else on the page is quieter than this by design.
        -->
        <template v-if="lud16">
          <button type="button" class="pp-btn pp-btn--primary" @click="onPay">
            <Icon icon="tabler:arrow-bar-to-down" width="18" height="18" />
            {{ payLabel }}
          </button>
          <p class="pp-caption">{{ $t('Opens your Bitcoin wallet.') }}</p>

          <!--
            3. The same payment, by hand.

            A grouped list rather than more buttons: these are for people
            whose wallet cannot take a link, or who are reading this on a
            desktop, and they should read as details rather than as choices
            competing with Pay.
          -->
          <div class="pp-group">
            <button type="button" class="pp-row" @click="copyAddress">
              <span class="pp-row-icon"><Icon :icon="copied ? 'tabler:check' : 'tabler:copy'" width="17" height="17" /></span>
              <span class="pp-row-text">
                <span class="pp-row-label">{{ copied ? $t('Copied') : $t('Copy the address') }}</span>
                <span class="pp-row-caption pp-row-caption--mono">{{ lud16 }}</span>
              </span>
            </button>

            <button type="button" class="pp-row" :aria-expanded="showCode" @click="showCode = !showCode">
              <span class="pp-row-icon"><Icon icon="tabler:qrcode" width="17" height="17" /></span>
              <span class="pp-row-text">
                <span class="pp-row-label">{{ showCode ? $t('Hide the code') : $t('Show the code') }}</span>
                <span class="pp-row-caption">{{ $t('Scan it from another phone') }}</span>
              </span>
              <Icon
                icon="tabler:chevron-down"
                width="17"
                height="17"
                class="pp-row-chev"
                :class="{ 'pp-row-chev--open': showCode }"
              />
            </button>

            <div v-if="showCode" class="pp-code">
              <div class="pp-qr">
                <vue-qrcode :value="lud16" :options="qrOptions" class="pp-qr-canvas" />
              </div>
            </div>
          </div>
        </template>

        <!-- Nothing to pay yet. Stated once, quietly, where the pay button
             would have been. -->
        <div v-else class="pp-note">
          <Icon icon="tabler:info-circle" width="17" height="17" />
          <span>{{ $t('{name} has not set up payments yet, so there is nothing to send to.', { name: spokenName }) }}</span>
        </div>

        <!--
          4. Keeping the person.

          Inside BuhoGO this saves them outright. Outside it is a handoff to
          the app, because a contact has nowhere else to live.
        -->
        <div class="pp-group pp-group--spaced">
          <button v-if="insideBuhoGo" type="button" class="pp-row" :disabled="saved" @click="saveContact">
            <span class="pp-row-icon"><Icon :icon="saved ? 'tabler:check' : 'tabler:user-plus'" width="17" height="17" /></span>
            <span class="pp-row-text">
              <span class="pp-row-label">{{ saved ? $t('Saved to your contacts') : $t('Save to my contacts') }}</span>
              <span v-if="!saved" class="pp-row-caption">{{ $t('Pay them by name next time') }}</span>
            </span>
          </button>

          <a v-else class="pp-row" :href="nostrUri">
            <span class="pp-row-icon"><Icon icon="tabler:user-plus" width="17" height="17" /></span>
            <span class="pp-row-text">
              <span class="pp-row-label">{{ $t('Add to BuhoGO') }}</span>
              <span class="pp-row-caption">{{ $t('Opens the app if you have it') }}</span>
            </span>
          </a>
        </div>

        <!--
          5. What this even is.

          The visitor may never have heard of BuhoGO, and a bare logo does
          not answer that. One sentence, at the end, where it belongs.
        -->
        <footer class="pp-foot">
          <a class="pp-foot-brand" :href="BUHOGO_HOME">
            <img src="/buho_logo.svg" alt="" width="17" height="17" />
            <span>BuhoGO</span>
          </a>
          <p class="pp-foot-text">
            {{ $t('A Bitcoin wallet you can pay people by name with.') }}
            <a class="pp-link" :href="BUHOGO_HOME">{{ $t('Get BuhoGO') }}</a>
          </p>
        </footer>
      </template>
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
import { isLightningAddress } from '../utils/addressUtils.js';
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
      showCode: false,
      copied: false,
      saved: false,
      BUHOGO_HOME,
      _copyTimer: null,
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
     * The handle to print under the name.
     *
     * A NIP-05 address of `_@domain` is the convention for "this domain
     * itself" and its local part is not a name: printing it verbatim gives
     * the reader `@_`. Those show the domain instead, which is what every
     * other client does and what the person actually goes by.
     */
    username() {
      const nip05 = String(this.profile?.nip05 || '').trim();
      if (!nip05.includes('@')) return nip05;
      const [local, domain] = nip05.split('@');
      if (!local || local === '_') return domain || '';
      return local;
    },

    about() {
      return this.profile?.about || '';
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

    payLabel() {
      return this.hasName ? this.$t('Pay {name}', { name: this.firstName }) : this.$t('Pay');
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
     * A username goes through NIP-05, which is a call to that username's
     * domain and can fail for reasons that have nothing to do with the
     * person or the link. The link carries the key in `k` for exactly that
     * case, so a lookup failure falls back to it instead of showing a
     * stranger a dead page. Only a link with no key left to try is missing.
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
     * including BuhoGO.
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
      // Nothing handled the scheme, most likely a desktop browser. Open the
      // code so the visit still ends somewhere useful.
      setTimeout(() => { this.showCode = true; }, 1200);
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
/* This page is read by people who have never seen BuhoGO, usually inside a
   chat app's browser. It carries its own light palette rather than inheriting
   the wallet's theme, so it looks the same for everyone and never depends on
   a setting the visitor has not made. */
.pp-page {
  min-height: 100vh;
  background: #FAF7EF;
  font-family: 'Manrope', sans-serif;
  display: flex;
  justify-content: center;
  padding: max(28px, env(safe-area-inset-top, 0px)) 20px max(28px, env(safe-area-inset-bottom, 0px));
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

/* 1. The person */
.pp-person {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 4px 0 28px;
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
  font-size: 26px;
  font-weight: 760;
  letter-spacing: -0.034em;
  color: #1A1A1C;
  margin: 16px 0 0;
  line-height: 1.2;
  word-break: break-word;
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

/* 2. The primary action, alone */
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
  text-decoration: none;
}

.pp-btn--primary { background: #1A1A1C; color: #FAF7EF; }
.pp-btn--primary:active { opacity: 0.9; }

.pp-btn--ghost {
  background: transparent;
  color: #1A1A1C;
  border-color: #E3DCC7;
  margin-top: 10px;
}

.pp-caption {
  font-size: 12.5px;
  color: #928D83;
  text-align: center;
  margin: 9px 0 0;
}

/* 3 and 4. Grouped lists, the same inset shape the app uses */
.pp-group {
  margin-top: 20px;
  background: #FFFDF8;
  border: 1px solid #E3DCC7;
  border-radius: 18px;
  overflow: hidden;
}

.pp-group--spaced { margin-top: 14px; }

.pp-row {
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  min-height: 62px;
  padding: 13px 14px;
  background: transparent;
  border: 0;
  text-align: left;
  font-family: 'Manrope', sans-serif;
  color: #1A1A1C;
  cursor: pointer;
  text-decoration: none;
}

.pp-row + .pp-row { border-top: 1px solid #EEE8DA; }
.pp-row:active { background: rgba(40, 34, 20, 0.04); }
.pp-row:disabled { cursor: default; opacity: 0.75; }

.pp-row-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: #F3EFE3;
  color: #5F5B52;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.pp-row-text { flex: 1; min-width: 0; }

.pp-row-label {
  display: block;
  font-size: 15px;
  font-weight: 620;
  letter-spacing: -0.012em;
}

.pp-row-caption {
  display: block;
  font-size: 12.5px;
  color: #5F5B52;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The address is a value, so it gets the monospace face; the rest of the
   captions are prose and stay in the body face. */
.pp-row-caption--mono { font-family: 'SF Mono', 'Monaco', 'Menlo', monospace; }

.pp-row-chev {
  color: #928D83;
  flex: 0 0 auto;
  transition: transform 0.2s ease;
}

.pp-row-chev--open { transform: rotate(180deg); }

.pp-code {
  display: flex;
  justify-content: center;
  padding: 0 14px 18px;
  border-top: 1px solid #EEE8DA;
}

.pp-qr {
  width: 188px;
  height: 188px;
  border-radius: 20px;
  background: #fff;
  padding: 10px;
  margin-top: 16px;
  box-shadow: 0 14px 30px -20px rgba(40, 34, 20, 0.55);
}

.pp-qr :deep(img),
.pp-qr :deep(canvas),
.pp-qr-canvas { width: 100%; height: 100%; display: block; }

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
}

.pp-note svg { color: #928D83; margin-top: 1px; flex: 0 0 auto; }

/* 5. What this is */
.pp-foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding-top: 28px;
}

.pp-foot-brand {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
  color: #5F5B52;
  text-decoration: none;
  letter-spacing: -0.01em;
}

.pp-foot-text {
  font-size: 12.5px;
  color: #928D83;
  text-align: center;
  line-height: 1.5;
  margin: 0;
  max-width: 300px;
}

.pp-link { color: #059573; font-weight: 620; text-decoration: none; white-space: nowrap; }

/* Desktop keeps the same single column: the page is a handoff, and a wide
   version of it would only add empty space around the same four elements. */
@media (min-width: 720px) {
  .pp-page { align-items: center; }
}
</style>
