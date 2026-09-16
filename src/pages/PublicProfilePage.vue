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
        The page: one screen, one verb.

        Identity with a way to keep the person, the amount as the page,
        a note, Pay in the thumb zone with the code one tap away, and the
        recruiting line at the foot. Nothing scrolls.
      -->
      <template v-else>
        <!-- 1. Who this is, and Save riding the row. -->
        <div class="pp-top pp-in" style="--d: 0ms">
          <span class="pp-avatar">
            <img v-if="avatar" :src="avatar" alt="" @error="avatarBroken = true" />
            <Icon v-else icon="tabler:user" width="20" height="20" />
          </span>
          <div class="pp-top-copy">
            <div class="pp-top-name">{{ displayName }}</div>
            <div v-if="trustLine" class="pp-top-nip">{{ trustLine }}</div>
          </div>
          <button
            v-if="insideBuhoGo"
            type="button"
            class="pp-save"
            :disabled="saved || saving"
            @click="saveContact"
          >
            <q-spinner v-if="saving" size="13px" />
            <Icon v-else :icon="saved ? 'tabler:check' : 'tabler:user-plus'" width="13" height="13" />
            {{ saved ? $t('Saved') : $t('Save') }}
          </button>
          <a v-else class="pp-save" :href="nostrUri">
            <Icon icon="tabler:user-plus" width="13" height="13" />
            {{ $t('Save') }}
          </a>
        </div>

        <!-- 2. The amount is the page. -->
        <template v-if="lud16">
          <div class="pp-mid">
            <div class="pp-amount-wrap pp-in" style="--d: 90ms">
              <input
                v-model="displayAmount"
                type="text"
                inputmode="decimal"
                class="pp-amount"
                :class="{ 'pp-amount--long': displayAmount.length > 6 }"
                :style="{ width: amountWidth }"
                :placeholder="amountPlaceholder"
                :aria-label="$t('Amount')"
                maxlength="12"
              />
              <span class="pp-amount-unit">{{ unitShort }}</span>
            </div>

            <button v-if="hasRates" type="button" class="pp-unit pp-in" style="--d: 130ms" @click="toggleCurrency">
              <span>{{ unitPillLabel }}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
            </button>

            <div class="pp-conv pp-in" style="--d: 160ms">{{ conversionLine || ' ' }}</div>
          </div>

          <!-- 3. The note rides along. -->
          <label class="pp-note pp-in" style="--d: 210ms">
            <Icon icon="tabler:message-circle" width="15" height="15" />
            <input
              v-model="comment"
              type="text"
              :placeholder="$t('Add a note')"
              maxlength="150"
            />
          </label>

          <!-- 4. The verb, and the code beside it. -->
          <div class="pp-actions pp-in" style="--d: 250ms">
            <button type="button" class="pp-cta" :disabled="paying" @click="onPay">
              <q-spinner v-if="paying" size="17px" />
              <Icon v-else icon="tabler:arrow-up-right" width="17" height="17" />
              {{ ctaLabel }}
            </button>
            <button type="button" class="pp-micro" :aria-label="$t('Show the code')" @click="showCode = true">
              <Icon icon="tabler:qrcode" width="20" height="20" />
            </button>
          </div>
        </template>

        <!-- Nothing to pay yet. Stated once, quietly, where the amount
             would have been. -->
        <div v-else class="pp-mid">
          <div class="pp-note-empty pp-in" style="--d: 90ms">
            <Icon icon="tabler:info-circle" width="17" height="17" />
            <span>{{ $t('{name} has not set up payments yet, so there is nothing to send to.', { name: spokenName }) }}</span>
          </div>
        </div>

        <!-- 5. The foot: a question, answered by the product. -->
        <footer class="pp-foot pp-in" style="--d: 300ms">
          <img src="/buho_logo.svg" alt="" width="16" height="16" />
          <span>{{ $t('Want a page like this too?') }} <a :href="BUHOGO_HOME">{{ $t('Get BuhoGO') }}</a></span>
        </footer>
      </template>
    </div>

    <!-- The code sheet: everything secondary, one tap away. -->
    <q-dialog v-model="showCode" position="bottom">
      <div class="pp-code-sheet">
        <div class="pp-grab" aria-hidden="true"></div>
        <div class="pp-qr">
          <vue-qrcode v-if="payUri" :value="payUri" :options="qrOptions" class="pp-qr-canvas" />
          <span v-if="avatar" class="pp-qr-avatar"><img :src="avatar" alt="" /></span>
        </div>
        <p class="pp-code-caption">{{ $t('Scan from another phone, or with a wallet app.') }}</p>
        <button type="button" class="pp-code-addr" @click="copyAddress">
          <code>{{ lud16 }}</code>
          <Icon :icon="copied ? 'tabler:check' : 'tabler:copy'" width="14" height="14" />
        </button>
      </div>
    </q-dialog>
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
import { lnurlGetJson } from '../utils/lnurlHttp.js';
import { fiatRatesService } from '../utils/fiatRates.js';
import { FIAT_SYMBOLS } from '../utils/fiatCurrencies.js';
import { useWalletStore } from '../stores/wallet';
import { useAddressBookStore } from '../stores/addressBook';

/**
 * The visitor's currency, guessed from their locale region. Sats stay the
 * source of truth; this only decides which fiat the swap offers. USD is the
 * fallback the world over.
 */
const EURO_REGIONS = new Set(['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK']);
const REGION_CURRENCY = { US: 'USD', GB: 'GBP', CH: 'CHF', JP: 'JPY', CA: 'CAD', AU: 'AUD', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', MX: 'MXN', BR: 'BRL', KE: 'KES', ZM: 'ZMW', TZ: 'TZS', ZA: 'ZAR' };

function guessVisitorCurrency() {
  try {
    const locale = new Intl.Locale(navigator.language || 'en-US');
    const region = (locale.maximize?.().region || locale.region || 'US').toUpperCase();
    if (EURO_REGIONS.has(region)) return 'EUR';
    return REGION_CURRENCY[region] || 'USD';
  } catch {
    return 'USD';
  }
}

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
      // Kept from the lookup so a save can go through the Nostr contact path,
      // which is keyed on the pubkey and does not need a Lightning address.
      pubkey: '',
      relayHints: [],
      profileEvent: null,
      profile: null,
      avatarBroken: false,
      showCode: false,
      copied: false,
      saved: false,
      saving: false,
      paying: false,
      displayAmount: '',
      comment: '',
      currency: 'sats', // 'sats' | the visitor's fiat code
      fiatCode: guessVisitorCurrency(),
      fiatRates: {},
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
     * The trust line under the name: handle and domain, plainly, per the
     * Nostr design guide. `_@domain` is the convention for "the domain
     * itself" and prints as just the domain.
     */
    trustLine() {
      const nip05 = String(this.profile?.nip05 || '').trim();
      if (!nip05) return '';
      if (!nip05.includes('@')) return nip05;
      const [local, domain] = nip05.split('@');
      if (!local || local === '_') return domain || '';
      return `@${local} · ${domain}`;
    },

    /**
     * What this person gets filed under. The heading may fall back to a
     * shortened key, which identifies them on screen but is not something to
     * save an address book entry as.
     */
    contactName() {
      if (this.hasName) return this.profile.name;
      const nip05 = String(this.profile?.nip05 || '').trim();
      const local = nip05.split('@')[0];
      return (local && local !== '_' ? local : '') || this.$t('Unnamed');
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
     * The code and the plain-link fallback hand over the same thing, and
     * both carry the scheme so the receiving app knows what it is given.
     */
    payUri() {
      return this.lud16 ? `lightning:${this.lud16}` : '';
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

    /** Opens BuhoGO on Android, which already claims the nostr scheme. */
    nostrUri() {
      return this.npub ? `nostr:${this.npub}` : BUHOGO_HOME;
    },

    hasRates() {
      return !!this.fiatRates[this.fiatCode];
    },

    isFiat() {
      return this.currency !== 'sats';
    },

    fiatSymbol() {
      return FIAT_SYMBOLS[this.fiatCode] || (this.fiatCode + ' ');
    },

    unitShort() {
      return this.isFiat ? this.fiatSymbol.trim() : this.$t('sats');
    },

    unitPillLabel() {
      return this.isFiat ? this.fiatCode : 'SATS';
    },

    amountPlaceholder() {
      return this.isFiat ? '0.00' : '0';
    },

    /** The typed amount in sats, whatever the unit on screen. */
    amountInSats() {
      const n = parseFloat(String(this.displayAmount).replace(',', '.'));
      if (!isFinite(n) || n <= 0) return 0;
      if (!this.isFiat) return Math.floor(n);
      const rate = this.fiatRates[this.fiatCode];
      if (!rate) return 0;
      return Math.floor((n / rate) * 100000000);
    },

    conversionLine() {
      const sats = this.amountInSats;
      if (!sats) return '';
      if (this.isFiat) return `≈ ${sats.toLocaleString()} ${this.$t('sats')}`;
      const fiat = fiatRatesService.convertSatsToFiatSync(sats, this.fiatCode);
      if (fiat === null || !this.hasRates) return '';
      return `≈ ${this.fiatSymbol}${fiat.toFixed(2)}`;
    },

    ctaLabel() {
      const sats = this.amountInSats;
      if (!sats) {
        return this.hasName ? this.$t('Pay {name}', { name: this.firstName }) : this.$t('Pay');
      }
      if (this.isFiat) {
        const n = parseFloat(String(this.displayAmount).replace(',', '.'));
        return `${this.$t('Pay')} ${this.fiatSymbol}${n.toFixed(2)}`;
      }
      return `${this.$t('Pay')} ${sats.toLocaleString()} ${this.$t('sats')}`;
    },

    /**
     * The input is exactly as wide as what it holds, so the figure and
     * its unit center as one group. `ch` tracks the digit width closely
     * enough under tabular numerals; the fraction covers the caret.
     */
    amountWidth() {
      const shown = String(this.displayAmount || this.amountPlaceholder);
      return `${Math.max(shown.length, 1) + 0.3}ch`;
    },

    qrOptions() {
      // 212 sits inside the 228 plate with its padding; H-level error
      // correction (the app-wide default) tolerates the centered avatar.
      return getQrOptionsWithSize(212);
    },
  },

  async created() {
    await this.resolve();
    // Rates power the fiat swap; the page works sats-only without them.
    fiatRatesService.ensureRatesLoaded()
      .then(() => fiatRatesService.getRates())
      .then((rates) => { this.fiatRates = rates || {}; })
      .catch(() => {});
  },

  beforeUnmount() {
    if (this._copyTimer) clearTimeout(this._copyTimer);
  },

  methods: {
    /**
     * Slug to profile.
     *
     * The link leads with the key, which resolves with no network call. A
     * username slug goes through NIP-05 and can fail for reasons that have
     * nothing to do with the person, so `k` still works as the fallback for
     * older links. Only a link with nothing resolvable is missing.
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
      this.pubkey = resolved.pubkey;
      this.relayHints = Array.isArray(resolved.relays) ? resolved.relays : [];

      // The page renders either way. A key that resolves but has published
      // nothing is still a real person, and a relay round trip that fails is
      // not a reason to tell a visitor the link is broken.
      try {
        const event = await fetchProfile(resolved.pubkey, { relays: resolved.relays });
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

    toggleCurrency() {
      this.currency = this.isFiat ? 'sats' : this.fiatCode;
      this.displayAmount = '';
    },

    /**
     * Pay.
     *
     * Inside the app this hands the address to the send flow. Outside, a
     * typed amount is turned into a real invoice through the address's own
     * pay endpoint so the wallet opens with the number inside; anything that
     * fails on that path falls back to the plain lightning: link, which
     * every wallet accepts. No amount, plain link straight away.
     */
    async onPay() {
      if (!this.lud16 || this.paying) return;

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

      const sats = this.amountInSats;
      if (sats > 0) {
        this.paying = true;
        try {
          const invoice = await this.fetchInvoice(sats);
          if (invoice) {
            this.openInWallet(`lightning:${invoice}`);
            return;
          }
        } catch (err) {
          console.warn('[public-profile] invoice fetch failed, using the plain link:', err);
        } finally {
          this.paying = false;
        }
      }

      this.openInWallet(this.payUri);
    },

    /**
     * Amount to invoice, through the address's own LNURL-pay endpoint. The
     * note rides along when the endpoint accepts comments. Returns '' when
     * the amount is outside the endpoint's bounds (after telling the user)
     * and throws on network trouble so the caller can fall back.
     */
    async fetchInvoice(sats) {
      const [name, domain] = this.lud16.split('@');
      const paramsResponse = await lnurlGetJson(`https://${domain}/.well-known/lnurlp/${name}`);
      if (!paramsResponse.ok) throw new Error('lnurlp params unavailable');
      const params = paramsResponse.data;
      if (!params || params.status === 'ERROR' || !params.callback) throw new Error(params?.reason || 'lnurlp error');

      const msat = sats * 1000;
      if (params.minSendable && msat < params.minSendable) {
        this.$q.notify({
          type: 'warning',
          message: this.$t('Minimum is {n} sats', { n: Math.ceil(params.minSendable / 1000).toLocaleString() }),
          timeout: 3000,
        });
        return '';
      }
      if (params.maxSendable && msat > params.maxSendable) {
        this.$q.notify({
          type: 'warning',
          message: this.$t('Maximum is {n} sats', { n: Math.floor(params.maxSendable / 1000).toLocaleString() }),
          timeout: 3000,
        });
        return '';
      }

      const callback = new URL(params.callback);
      callback.searchParams.set('amount', String(msat));
      const note = this.comment.trim();
      const allowed = Number(params.commentAllowed) || 0;
      if (note && allowed > 0) {
        callback.searchParams.set('comment', note.slice(0, allowed));
      }

      const invoiceResponse = await lnurlGetJson(callback.toString());
      if (!invoiceResponse.ok) throw new Error('invoice unavailable');
      const data = invoiceResponse.data;
      if (!data || data.status === 'ERROR' || !data.pr) throw new Error(data?.reason || 'no invoice');
      return data.pr;
    },

    openInWallet(uri) {
      window.location.href = uri;
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
  color: #9A9488;
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
  font-size: 15px;
  font-weight: 780;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pp-top-nip {
  font-family: var(--font-mono, 'JetBrains Mono', Menlo, monospace);
  font-size: 10px;
  color: #9A9488;
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
  color: #059573;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 750;
  border-radius: 999px;
  min-height: 34px;
  padding: 0 13px;
  flex: 0 0 auto;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.1s ease;
}

.pp-save:active { transform: scale(0.94); }
.pp-save:disabled { cursor: default; }

/* 2. The amount */
.pp-mid {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.pp-amount-wrap {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  width: 100%;
}

.pp-amount {
  max-width: 270px;
  border: 0;
  outline: none;
  background: transparent;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 56px;
  font-weight: 800;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
  color: #1C1B18;
  caret-color: #059573;
  padding: 0;
  min-width: 0;
}

.pp-amount--long { font-size: 42px; }

.pp-amount::placeholder { color: #C9C4B5; }

.pp-amount-unit {
  font-size: 18px;
  font-weight: 700;
  color: #9A9488;
  flex: 0 0 auto;
}

.pp-unit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: rgba(28, 27, 24, 0.06);
  color: #1C1B18;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.08em;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  margin-top: 12px;
  cursor: pointer;
  transition: transform 0.1s ease;
}

.pp-unit:active { transform: scale(0.94); }

.pp-conv {
  font-size: 13px;
  color: #9A9488;
  margin-top: 8px;
  min-height: 18px;
  font-variant-numeric: tabular-nums;
}

/* 3. The note */
.pp-note {
  display: flex;
  align-items: center;
  gap: 9px;
  background: rgba(28, 27, 24, 0.06);
  border-radius: 14px;
  padding: 0 14px;
  min-height: 46px;
  color: #9A9488;
  margin-bottom: 10px;
  flex: 0 0 auto;
}

.pp-note input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  color: #1C1B18;
}

.pp-note input::placeholder { color: #9A9488; }

.pp-note-empty {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13.5px;
  color: #9A9488;
  line-height: 1.5;
  max-width: 34ch;
}

/* 4. The verb */
.pp-actions {
  display: flex;
  gap: 9px;
  flex: 0 0 auto;
}

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

.pp-micro {
  width: 52px;
  min-height: 52px;
  border-radius: 26px;
  border: 0;
  background: rgba(28, 27, 24, 0.06);
  color: #1C1B18;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  cursor: pointer;
  transition: transform 0.1s ease;
}

.pp-micro:active { transform: scale(0.94); }

/* 5. The foot */
.pp-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 14px 0 4px;
  font-size: 12px;
  color: #9A9488;
  flex: 0 0 auto;
}

.pp-foot a {
  color: #059573;
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

.pp-qr {
  position: relative;
  width: 228px;
  height: 228px;
  border-radius: 18px;
  background: #FFFFFF;
  padding: 8px;
  box-shadow: 0 12px 26px -16px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(28, 27, 24, 0.1);
}

.pp-qr :deep(img),
.pp-qr :deep(canvas),
.pp-qr-canvas { width: 100%; height: 100%; display: block; }

/* Centered face on the code, same as the card's own: safe at level-H
   error correction, clear of the three finder patterns. */
.pp-qr-avatar {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 52px;
  height: 52px;
  border-radius: 14px;
  overflow: hidden;
  border: 4px solid #FFFFFF;
  box-shadow: 0 0 0 1px rgba(28, 27, 24, 0.1);
  display: block;
}

.pp-qr-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

.pp-code-caption {
  text-align: center;
  font-size: 12.5px;
  color: #9A9488;
  margin: 14px 0 0;
}

.pp-code-addr {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: rgba(28, 27, 24, 0.06);
  border-radius: 12px;
  padding: 11px 13px;
  margin-top: 18px;
  color: #9A9488;
  cursor: pointer;
  text-align: left;
}

.pp-code-addr code {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono, 'JetBrains Mono', Menlo, monospace);
  font-size: 11px;
  color: #1C1B18;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
</style>
