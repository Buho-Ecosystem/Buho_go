<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card
      class="identity-surface get-paid-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <div class="sheet-grab" aria-hidden="true"><span></span></div>
      <div class="sheet-head">
        <div class="sheet-title">{{ $t('Get paid') }}</div>
        <q-btn flat round class="sheet-close" :aria-label="$t('Close')" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="get-paid-body">
        <template v-if="payAddress">
          <!-- The QR and the share action are one compact object: show it in
               person, or send the same payment destination remotely. -->
          <div class="pay-hero">
            <div class="pay-qr">
              <vue-qrcode :value="payQrValue" :options="qrOptions" class="pay-qr-canvas" />
            </div>
            <div class="pay-hero-copy">
              <strong class="pay-qr-caption">{{ $t('Show this to get paid in person') }}</strong>
              <button type="button" class="pay-share" @click="shareLink">
                <Icon icon="tabler:share-2" width="16" height="16" />
                <span>{{ $t('Send my link') }}</span>
              </button>
            </div>
          </div>
          <p class="pay-hint">
            {{ $t('Send this to anyone, anywhere. It works whether or not they have BuhoGO.') }}
          </p>

          <!-- Only receipts attributable to this profile address appear here.
               Details stay in a compact sheet rather than leaving Get paid. -->
          <button
            v-if="incomingLoading || latestIncoming"
            type="button"
            class="pay-recent"
            :disabled="!latestIncoming"
            aria-live="polite"
            @click="showPaymentDetails = true"
          >
            <template v-if="latestIncoming">
              <span class="pay-row-icon pay-row-icon--received">
                <Icon icon="tabler:arrow-down-left" width="17" height="17" />
              </span>
              <span class="pay-row-copy">
                <strong>{{ $t('Payment Received') }}</strong>
                <small>
                  {{ latestIncoming.walletName }}<template v-if="relativeIncomingTime"> · {{ relativeIncomingTime }}</template>
                </small>
              </span>
              <span class="pay-recent-amount">+{{ formatSats(latestIncoming.amountSats) }} {{ $t('sats') }}</span>
              <Icon icon="tabler:chevron-right" width="17" height="17" class="pay-row-chevron" />
            </template>
            <template v-else>
              <q-spinner size="17px" />
              <span class="pay-row-copy"><small>{{ $t('Checking') }}</small></span>
            </template>
          </button>

          <div class="pay-stack">
            <button
              v-if="usingBucket || bucket.hasBalance"
              type="button"
              class="pay-row"
              data-audit="identity-bucket"
              @click="showBucket = true"
            >
              <span class="pay-row-icon"><Icon icon="tabler:inbox" width="17" height="17" /></span>
              <span class="pay-row-copy">
                <small>{{ $t('Where it lands') }}</small>
                <strong>{{ $t('Social Bucket') }}</strong>
                <small>{{ bucketCaption }}</small>
              </span>
              <span v-if="bucket.hasBalance" class="pay-row-chip">{{ $t('Move') }}</span>
              <Icon v-else icon="tabler:chevron-right" width="17" height="17" class="pay-row-chevron" />
            </button>

            <div class="pay-row pay-row--address">
              <span class="pay-row-icon"><Icon icon="tabler:wallet" width="17" height="17" /></span>
              <span class="pay-row-copy">
                <small>{{ $t('Lightning address') }}</small>
                <strong class="pay-address">{{ payAddressShown }}</strong>
              </span>
              <span class="pay-row-actions">
                <button type="button" :aria-label="$t('Copy')" @click="copy(payAddress, 'address')">
                  <Icon :icon="copied === 'address' ? 'tabler:check' : 'tabler:copy'" width="16" height="16" />
                </button>
                <button
                  type="button"
                  data-audit="identity-own-address"
                  :aria-label="$t('Edit')"
                  @click="openEditor"
                >
                  <Icon icon="tabler:pencil" width="16" height="16" />
                </button>
              </span>
            </div>
          </div>

          <p v-if="usingBucket || bucket.hasBalance" class="pay-row-foot">{{ bucketFooter }}</p>
          <p class="pay-row-foot">{{ addressFooter }}</p>

          <!-- Editing one string stays inline. No second sheet and no new
               navigation level for a task this small. -->
          <transition name="pay-editor">
            <div v-if="showEditor" class="pay-editor">
              <div class="pay-editor-head">
                <strong>{{ $t('Your own address') }}</strong>
                <button type="button" :aria-label="$t('Close')" @click="showEditor = false">
                  <Icon icon="tabler:x" width="16" height="16" />
                </button>
              </div>
              <input
                v-model="editorInput"
                type="text"
                class="field-input"
                :class="{ 'field-input--error': editorError }"
                placeholder="you@your-wallet.com"
                spellcheck="false"
                autocomplete="off"
                autocapitalize="none"
                inputmode="email"
                maxlength="200"
                @keydown.enter.prevent="saveAddress"
              />
              <span v-if="editorError" class="field-error">{{ editorError }}</span>
              <span v-else class="field-help">{{ $t('Copy it from the wallet you want to be paid in.') }}</span>
              <div class="pay-editor-note">
                <Icon icon="tabler:info-circle" width="15" height="15" />
                <span>{{ $t('Payments then arrive in that wallet instead of your bucket. If it is not one of your BuhoGO wallets, your balance here will not change.') }}</span>
              </div>
              <div class="pay-editor-actions">
                <button
                  v-if="!usingBucket"
                  type="button"
                  class="pay-editor-secondary"
                  :disabled="profile.isPublishing"
                  @click="clearAddress"
                >
                  {{ $t('Go back to my bucket') }}
                </button>
                <button
                  type="button"
                  class="pay-editor-save"
                  :disabled="profile.isPublishing"
                  @click="saveAddress"
                >
                  <q-spinner v-if="profile.isPublishing" size="16px" />
                  <span v-else>{{ $t('Save') }}</span>
                </button>
              </div>
            </div>
          </transition>
        </template>

        <div v-else class="pay-empty">
          <span class="pay-empty-mark"><q-spinner size="24px" /></span>
          <h2 class="pay-empty-title">{{ $t('Setting up your address') }}</h2>
          <p class="pay-empty-body">
            {{ $t('BuhoGO is giving your name somewhere to receive. This needs a connection and finishes on its own.') }}
          </p>
          <button type="button" class="pay-share" @click="openEditor">
            <Icon icon="tabler:plus" width="16" height="16" />
            {{ $t('Use my own address instead') }}
          </button>
        </div>
      </div>
    </q-card>
  </q-dialog>

  <SocialBucketSheet v-model="showBucket" />

  <q-dialog
    v-model="showPaymentDetails"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card
      class="identity-surface payment-detail-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <div class="sheet-grab" aria-hidden="true"><span></span></div>
      <div class="sheet-head">
        <div class="sheet-title">{{ $t('Payments received') }}</div>
        <q-btn flat round class="sheet-close" :aria-label="$t('Close')" @click="showPaymentDetails = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="payment-detail-body">
        <div class="payment-week-head">
          <div>
            <strong>{{ $t('Last 7 days') }}</strong>
            <p>{{ $t("Received through your profile's Lightning address.") }}</p>
          </div>
          <span>{{ formatSats(weeklyIncomingTotal) }} {{ $t('sats') }}</span>
        </div>

        <div class="payment-address-band">
          <span>{{ $t('Lightning address') }}</span>
          <strong>{{ payAddress }}</strong>
        </div>

        <div class="payment-week-list">
          <article v-for="tx in incomingTransactions" :key="tx.sourceKey">
            <span class="payment-list-icon"><Icon icon="tabler:arrow-down-left" width="17" height="17" /></span>
            <span class="payment-list-copy">
              <strong>{{ tx.walletName }}</strong>
              <small>{{ formatIncomingDate(tx) }}</small>
              <small v-if="incomingMemoFor(tx)" class="payment-list-memo">{{ incomingMemoFor(tx) }}</small>
            </span>
            <strong class="payment-list-amount">+{{ formatSats(tx.amountSats) }} {{ $t('sats') }}</strong>
          </article>
        </div>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import SocialBucketSheet from './SocialBucketSheet.vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { useSocialBucketStore } from '../../stores/socialBucket';
import { useWalletStore } from '../../stores/wallet';
import { normalizeTx } from '../../services/txNormalizer.js';
import { npubCashAddress, isNpubCashAddress } from '../../services/npubCash.js';
import { buildProfileLink } from '../../utils/profileLink.js';
import { getQrOptionsWithSize } from '../../utils/qrConfig.js';
import { shareContent } from '../../utils/share.js';
import { isLightningAddress } from '../../utils/addressUtils.js';

export default {
  name: 'IdentityGetPaidSheet',

  components: {
    Icon,
    VueQrcode,
    SocialBucketSheet,
  },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue'],

  setup() {
    return {
      identity: useIdentityStore(),
      profile: useProfileStore(),
      bucket: useSocialBucketStore(),
      walletStore: useWalletStore(),
    };
  },

  data() {
    return {
      copied: '',
      showEditor: false,
      showBucket: false,
      showPaymentDetails: false,
      editorInput: '',
      editorError: '',
      incomingTransactions: [],
      incomingLoading: false,
      _copyTimer: null,
      _incomingToken: 0,
      _preparing: false,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(value) {
        if (!value) this.showEditor = false;
        this.$emit('update:modelValue', value);
      },
    },

    /**
     * The one thing to give a person. It resolves for someone with a Bitcoin
     * wallet, someone with only a browser, and someone who has never heard of
     * BuhoGO, which is the only string on this screen that can say that.
     */
    shareUrl() {
      return buildProfileLink({
        username: this.identity.nip05ActiveEntry?.handle,
        nip05: this.profile.nip05 || this.identity.nip05Address,
        npub: this.identity.nostrNpub,
      });
    },

    /**
     * What the code carries.
     *
     * `lightning:` is what turns the code from plain text into something the
     * operating system routes: a phone camera offers the installed wallets
     * instead of offering to web-search the address. Every wallet unwraps the
     * scheme, so nothing that could read the bare address stops working.
     */
    payQrValue() {
      return this.payAddress ? `lightning:${this.payAddress}` : '';
    },

    /** What any wallet can actually send to. */
    payAddress() {
      return this.profile.lud16 || '';
    },

    /** True while payments route through the identity's own bucket. */
    /**
     * The address as it is read, not as it is sent.
     *
     * A bucket address is the npub plus a domain, seventy characters that
     * wrap to three lines and tell the reader nothing. Nobody types this one:
     * it is scanned, copied or shared, and all three carry the real value.
     * Their own address is short enough to show whole.
     */
    payAddressShown() {
      const value = this.payAddress;
      if (value.length <= 30) return value;
      const [local, domain] = value.split('@');
      if (!domain) return `${value.slice(0, 12)}…${value.slice(-6)}`;
      return `${local.slice(0, 8)}…${local.slice(-5)}@${domain}`;
    },

    usingBucket() {
      return isNpubCashAddress(this.payAddress);
    },

    /**
     * Names the term the user will have been shown by whatever app sent them
     * looking. "Lightning address" is not a word this surface uses, but it is
     * the word on the other screen, and refusing to say it once here would
     * leave someone unable to match the two.
     */
    addressFooter() {
      return this.usingBucket
        ? this.$t('Some apps ask for a "Lightning address". This is yours. You never have to remember it: send your link instead.')
        : this.$t('Payments go straight to that wallet. Remove it and BuhoGO receives for you again.');
    },

    bucketCaption() {
      if (this.bucket.isSyncing && !this.bucket.hasBalance) return this.$t('Checking');
      if (!this.bucket.hasBalance) return this.$t('Nothing waiting');
      return this.$t('{n} sats waiting', { n: this.formatSats(this.bucket.balanceSats) });
    },

    bucketFooter() {
      return this.usingBucket
        ? this.$t('Payments to your name arrive here, then you move them to one of your wallets.')
        : this.$t('Money that arrived before you set your own address is still here.');
    },

    qrOptions() {
      // 126px sits pixel-for-pixel inside the 148px frame (10px quiet zone
      // + 1px border on each side), avoiding canvas scaling blur.
      return getQrOptionsWithSize(126);
    },

    latestIncoming() {
      return this.incomingTransactions[0] || null;
    },

    weeklyIncomingTotal() {
      return this.incomingTransactions.reduce(
        (total, tx) => total + (Number(tx.amountSats) || 0),
        0,
      );
    },

    relativeIncomingTime() {
      const timeMs = this.latestIncoming?.timeMs;
      if (!timeMs) return '';

      const elapsedSeconds = Math.max(0, Math.round((Date.now() - timeMs) / 1000));
      let value;
      let unit;
      if (elapsedSeconds < 60) {
        value = -elapsedSeconds;
        unit = 'second';
      } else if (elapsedSeconds < 3600) {
        value = -Math.round(elapsedSeconds / 60);
        unit = 'minute';
      } else if (elapsedSeconds < 86400) {
        value = -Math.round(elapsedSeconds / 3600);
        unit = 'hour';
      } else {
        value = -Math.round(elapsedSeconds / 86400);
        unit = 'day';
      }

      try {
        return new Intl.RelativeTimeFormat(this.$i18n?.locale || undefined, {
          numeric: 'auto',
        }).format(value, unit);
      } catch {
        return new Date(timeMs).toLocaleDateString();
      }
    },

  },

  watch: {
    modelValue: {
      immediate: true,
      handler(isOpen) {
        if (isOpen) this.prepareSheet();
      },
    },
  },

  beforeUnmount() {
    if (this._copyTimer) clearTimeout(this._copyTimer);
  },

  methods: {
    formatSats(n) {
      return new Intl.NumberFormat().format(Math.max(0, Math.floor(n || 0)));
    },

    async prepareSheet() {
      if (this._preparing) return;
      this._preparing = true;
      try {
        await this.identity.hydrate();
        await Promise.all([
          this.profile.hydrate(),
          this.bucket.hydrate({ pubkey: this.identity.nostrPubkeyHex }),
          this.walletStore.initialize(),
        ]);

        // Adopting the address is a boot step, but the sheet may open in the
        // few seconds before it finishes, or after it failed while offline.
        if (!this.payAddress && this.identity.nostrNpub) {
          const address = npubCashAddress(this.identity.nostrNpub);
          if (address) {
            const changed = this.profile.adoptBucketAddress(address, {
              isBucketAddress: isNpubCashAddress,
            });
            if (changed) this.profile.publish().catch(() => {});
          }
        }

        await Promise.allSettled([
          this.bucket.sync({ identityStore: this.identity }),
          this.loadLatestIncoming(),
        ]);
        this.includeBucketTransactions();
      } finally {
        this._preparing = false;
      }
    },

    transactionTimeMs(tx) {
      const raw = tx?.settled_at ?? tx?.created_at ?? tx?.timestamp ?? tx?.time;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw < 1e12 ? raw * 1000 : raw;
      }
      const numeric = Number(raw);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric < 1e12 ? numeric * 1000 : numeric;
      }
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    },

    includeBucketTransactions() {
      if (!this.usingBucket) return;
      const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
      // Pinia HMR and persisted pre-history stores may not have this newer
      // field until the first successful sync. Treat that as an empty inbox.
      const receipts = Array.isArray(this.bucket.recentReceipts)
        ? this.bucket.recentReceipts
        : [];
      const bucketTransactions = receipts
        .map((quote) => ({
          id: quote.quoteId,
          sourceKey: `bucket:${quote.quoteId}`,
          walletName: this.$t('Social Bucket'),
          amountSats: Math.max(0, Number(quote.amount) || 0),
          timeMs: this.transactionTimeMs({
            settled_at: quote.paidAt,
            created_at: quote.createdAt,
          }),
        }))
        .filter((tx) => tx.timeMs >= cutoff);

      const merged = new Map(
        [...this.incomingTransactions, ...bucketTransactions]
          .map((tx) => [tx.sourceKey, tx]),
      );
      this.incomingTransactions = [...merged.values()]
        .sort((a, b) => b.timeMs - a.timeMs);
    },

    /**
     * Read the last week from providers that are already available and retain
     * only settled receives attributable to the profile's current address.
     */
    async loadLatestIncoming() {
      const token = ++this._incomingToken;
      const sources = this.walletStore.wallets
        .map((wallet) => ({ wallet, provider: this.walletStore.providers?.[wallet.id] }))
        .filter(({ provider }) => typeof provider?.getTransactions === 'function');

      if (!sources.length) {
        this.incomingTransactions = [];
        this.incomingLoading = false;
        return;
      }

      this.incomingLoading = true;
      try {
        const batches = await Promise.all(sources.map(async ({ wallet, provider }) => {
          try {
            const result = await provider.getTransactions({ limit: 100, offset: 0 });
            const rawTransactions = Array.isArray(result) ? result : (result?.transactions || []);
            return rawTransactions.map((raw) => {
              const tx = normalizeTx(raw, { walletType: wallet.type });
              const profileAddress = this.payAddress.trim().toLowerCase();
              const transactionAddress = String(tx.lnaddress || '').trim().toLowerCase();
              const walletAddress = this.walletLightningAddress(wallet);
              return {
                ...tx,
                sourceKey: `wallet:${wallet.id}:${tx.id || this.transactionTimeMs(tx)}`,
                walletName: wallet.name || this.$t('Wallet'),
                amountSats: tx.recipientSats || Math.abs(Number(tx.amount) || 0),
                timeMs: this.transactionTimeMs(tx),
                arrivedAtProfile: transactionAddress
                  ? transactionAddress === profileAddress
                  : walletAddress === profileAddress,
              };
            });
          } catch {
            return [];
          }
        }));

        if (token !== this._incomingToken) return;
        const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
        this.incomingTransactions = batches
          .flat()
          .filter((tx) => (
            tx.type === 'incoming'
            && tx.arrivedAtProfile
            && tx.timeMs >= cutoff
            && !['pending', 'failed', 'expired'].includes(tx.status)
          ))
          .sort((a, b) => b.timeMs - a.timeMs);
      } finally {
        if (token === this._incomingToken) this.incomingLoading = false;
      }
    },

    /** The wallet's advertised address, used only to attribute a receipt. */
    walletLightningAddress(wallet) {
      const stored = String(wallet?.metadata?.lud16 || '').trim().toLowerCase();
      if (isLightningAddress(stored)) return stored;

      const nwcUrl = wallet?.nwcUrl || wallet?.connectionData?.nwcUrl;
      if (!nwcUrl) return '';
      try {
        const parsed = new URL(String(nwcUrl).replace('nostr+walletconnect://', 'http://'));
        const value = String(parsed.searchParams.get('lud16') || '').trim().toLowerCase();
        return isLightningAddress(value) ? value : '';
      } catch {
        return '';
      }
    },

    formatIncomingDate(tx) {
      if (!tx?.timeMs) return '';
      try {
        return new Intl.DateTimeFormat(this.$i18n?.locale || undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(tx.timeMs));
      } catch {
        return new Date(tx.timeMs).toLocaleString();
      }
    },

    incomingMemoFor(tx) {
      return String(tx?.comment || tx?.description || '').trim();
    },

    async copy(value, which) {
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        this.copied = which;
        if (this._copyTimer) clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => { this.copied = ''; }, 1600);
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800, position: 'top' });
      }
    },

    /**
     * `shareContent` reports failure through its return value rather than by
     * throwing, so an unhandled result reads as a dead button on every device
     * without a share menu.
     */
    async shareLink() {
      if (!this.shareUrl) return;

      const result = await shareContent({ title: this.$t('Get paid'), text: this.shareUrl });
      if (result.success || result.reason === 'cancelled') return;

      if (result.reason === 'unsupported') {
        await this.copy(this.shareUrl, 'link');
        this.$q.notify({
          type: 'positive',
          message: this.$t('Copied'),
          caption: this.$t('This device has no share menu, so we copied it instead.'),
          timeout: 3000,
        });
        return;
      }

      console.warn('[identity-get-paid] share failed:', result.error);
      this.$q.notify({ type: 'negative', message: this.$t("Couldn't share"), timeout: 2500 });
    },

    openEditor() {
      this.editorInput = this.usingBucket ? '' : this.payAddress;
      this.editorError = '';
      this.showEditor = true;
    },

    async saveAddress() {
      const value = this.editorInput.trim().toLowerCase();
      if (!value) {
        this.editorError = this.$t('Enter an address, or go back to your bucket.');
        return;
      }
      if (!isLightningAddress(value)) {
        this.editorError = this.$t('That does not look like an address yet. It should read like an email address.');
        return;
      }
      this.editorError = '';
      await this.persist(value, this.$t('Payments now go to your own wallet'));
    },

    /** Back to the bucket: clear the field and let the identity receive again. */
    async clearAddress() {
      const address = npubCashAddress(this.identity.nostrNpub);
      await this.persist(address, this.$t('Payments come back to your bucket'));
    },

    /**
     * Publishing is what makes any of this work: the address only becomes
     * reachable once it is on the published profile, so a save that did not
     * reach the network has not finished the job and has to say so.
     */
    async persist(value, successMessage) {
      this.profile.setField('lud16', value);
      let result = null;
      try {
        result = await this.profile.publish();
      } catch (err) {
        console.warn('[identity-get-paid] publish failed:', err);
      }
      this.showEditor = false;

      if (result && result.ok) {
        this.$q.notify({ type: 'positive', message: successMessage, timeout: 2500 });
        return;
      }

      this.$q.notify({
        type: 'warning',
        message: this.$t('Saved on this phone'),
        caption: this.$t('Paying you by name will start working once BuhoGO can reach the network.'),
        timeout: 4000,
      });
    },
  },
};
</script>

<style scoped>
.get-paid-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  max-height: 92dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.get-paid-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 16px max(18px, env(safe-area-inset-bottom, 0px));
}

.pay-hero {
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  padding: 3px 0 5px;
}

.pay-qr {
  position: relative;
  box-sizing: border-box;
  width: 148px;
  height: 148px;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 20px;
  background: #fff;
  padding: 10px;
  box-shadow: 0 12px 30px -22px rgba(0, 0, 0, 0.72);
}

.pay-qr::after {
  content: '';
  position: absolute;
  inset: 4px;
  pointer-events: none;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 16px;
}

.pay-qr :deep(img),
.pay-qr :deep(canvas),
.pay-qr-canvas { width: 100%; height: 100%; display: block; }

.pay-hero-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}

.pay-qr-caption,
.pay-hint,
.pay-row-foot { color: var(--text-secondary); line-height: 1.4; }

.pay-qr-caption {
  margin: 0 2px;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 680;
  line-height: 1.35;
}

.pay-share,
.pay-editor-save,
.pay-editor-secondary {
  min-height: 38px;
  border: 0;
  border-radius: var(--radius-md);
  font: 650 14px 'Manrope', sans-serif;
  cursor: pointer;
}

.pay-share,
.pay-editor-save {
  background: #1a1a1c;
  color: #faf7ef;
}

.get-paid-sheet.card_dark_style .pay-share,
.get-paid-sheet.card_dark_style .pay-editor-save {
  background: #f4f4f4;
  color: #0c0c0c;
}

.pay-share {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
}

.pay-hint { margin: 5px 2px 12px; font-size: 13px; }

.pay-recent,
.pay-row {
  min-height: 54px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-primary);
}

.pay-recent {
  width: 100%;
  border: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  margin-bottom: 9px;
  text-align: left;
  font-family: 'Manrope', sans-serif;
  cursor: pointer;
}

.pay-recent:disabled { cursor: default; opacity: 1; }

.pay-stack { display: flex; flex-direction: column; gap: 8px; }

.pay-row {
  width: 100%;
  border: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  text-align: left;
  font-family: 'Manrope', sans-serif;
}

button.pay-row { cursor: pointer; }

.pay-row-icon {
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--bg-card);
  color: var(--text-secondary);
}

.pay-row-icon--received { color: #067a5d; }
.get-paid-sheet.card_dark_style .pay-row-icon--received { color: #34d399; }

.pay-row-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pay-row-copy strong { font-size: 14px; font-weight: 680; line-height: 1.3; }
.pay-row-copy small { font-size: 12.5px; color: var(--text-secondary); line-height: 1.4; }

.pay-recent-amount {
  flex: 0 0 auto;
  color: #067a5d;
  font-size: 14px;
  font-weight: 720;
}

.get-paid-sheet.card_dark_style .pay-recent-amount { color: #34d399; }

.pay-row-chip {
  flex: 0 0 auto;
  border-radius: 999px;
  background: #1a1a1c;
  color: #faf7ef;
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 700;
}

.get-paid-sheet.card_dark_style .pay-row-chip {
  background: #f4f4f4;
  color: #0c0c0c;
}

.pay-row-chevron { color: var(--text-muted); flex: 0 0 auto; }
.pay-address { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pay-row-actions { display: flex; align-items: center; gap: 2px; }
.pay-row-actions button,
.pay-editor-head button {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.pay-row-actions button:active,
.pay-editor-head button:active { background: rgba(127, 127, 127, 0.12); }

.pay-row-foot { margin: 5px 5px 9px; font-size: 12.5px; }

.pay-editor {
  margin-top: 7px;
  padding: 11px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.pay-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: -4px -4px 7px 1px;
  color: var(--text-primary);
  font-size: 14px;
}

.pay-editor-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 9px;
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.45;
}

.pay-editor-note svg { flex: 0 0 auto; margin-top: 1px; }

.pay-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 11px;
}

.pay-editor-save,
.pay-editor-secondary { padding: 0 13px; }
.pay-editor-secondary { background: var(--bg-input); color: var(--text-primary); }
.pay-editor-save:disabled,
.pay-editor-secondary:disabled { opacity: 0.55; cursor: default; }

.pay-editor-enter-active,
.pay-editor-leave-active { transition: opacity 0.16s ease, transform 0.16s ease; }
.pay-editor-enter-from,
.pay-editor-leave-to { opacity: 0; transform: translateY(-5px); }

.pay-empty { text-align: center; padding: 12px 6px 8px; }
.pay-empty-mark {
  width: 54px;
  height: 54px;
  border-radius: var(--radius-lg);
  background: var(--bg-input);
  color: var(--text-secondary);
  display: grid;
  place-items: center;
  margin: 0 auto 12px;
}
.pay-empty-title { margin: 0 0 6px; color: var(--text-primary); font-size: 19px; }
.pay-empty-body { margin: 0 auto 13px; max-width: 340px; color: var(--text-secondary); font-size: 14px; line-height: 1.5; }

.payment-detail-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  max-height: 88dvh;
  padding-bottom: max(18px, env(safe-area-inset-bottom, 0px));
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.payment-detail-body {
  min-height: 0;
  overflow-y: auto;
  padding: 5px 16px 4px;
}

.payment-week-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 3px 2px 13px;
}

.payment-week-head strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
}

.payment-week-head p {
  margin: 2px 0 0;
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.4;
}

.payment-week-head > span {
  flex: 0 0 auto;
  color: #067a5d;
  font-size: 14px;
  font-weight: 750;
}

.payment-detail-sheet.card_dark_style .payment-week-head > span { color: #34d399; }

.payment-address-band {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  margin-bottom: 9px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

.payment-address-band span { color: var(--text-secondary); font-size: 12px; }
.payment-address-band strong {
  color: var(--text-primary);
  font: 600 12px/1.4 var(--font-mono);
  overflow-wrap: anywhere;
}

.payment-week-list {
  border-radius: var(--radius-md);
  background: var(--bg-input);
  overflow: hidden;
}

.payment-week-list article {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 12px;
}

.payment-week-list article + article { border-top: 1px solid var(--border-card); }

.payment-list-icon {
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--bg-card);
  color: #067a5d;
}

.payment-detail-sheet.card_dark_style .payment-list-icon { color: #34d399; }

.payment-list-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.payment-list-copy strong {
  color: var(--text-primary);
  font-size: 13.5px;
  line-height: 1.35;
}

.payment-list-copy small { color: var(--text-secondary); font-size: 12px; line-height: 1.4; }
.payment-list-memo { margin-top: 3px; color: var(--text-primary) !important; }

.payment-list-amount {
  flex: 0 0 auto;
  padding-top: 6px;
  color: #067a5d;
  font-size: 13px;
  font-weight: 750;
}

.payment-detail-sheet.card_dark_style .payment-list-amount { color: #34d399; }

@media (max-width: 360px) {
  .pay-hero { grid-template-columns: 1fr; }
  .pay-qr { margin: 0 auto; }
  .pay-qr-caption { text-align: center; }
}

@media (prefers-reduced-motion: reduce) {
  .pay-editor-enter-active,
  .pay-editor-leave-active { transition: none; }
}
</style>
