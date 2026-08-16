<template>
  <!--
    The Social Bucket.

    Money sent to a person's name lands here first, because a new identity has
    no wallet address of its own to give out. This sheet exists to explain that
    in one line and to get the money out again.

    It is deliberately not a wallet: no address of its own, no history, no send,
    no receive. One number and one verb.
  -->
  <q-dialog v-model="open" position="bottom" :persistent="bucket.isSweeping" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
    <q-card class="identity-surface sb-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-grab" aria-hidden="true"><span></span></div>

      <div class="sheet-head">
        <div class="sheet-title">{{ $t('Social Bucket') }}</div>
        <button
          type="button"
          class="sb-info-button"
          :aria-label="$t('About the Social Bucket')"
          :disabled="bucket.isSweeping"
        >
          <Icon icon="tabler:info-circle" width="20" height="20" />
          <q-menu anchor="bottom right" self="top right" :offset="[0, 8]" class="sb-info-menu">
            <div class="sb-info-card identity-surface">
              <strong>{{ $t('About the Social Bucket') }}</strong>
              <p>{{ $t('Your name has no wallet of its own, so BuhoGO gives it a place to receive. Keeping it topped up is not the idea: move it to a wallet and it behaves like any other Bitcoin you hold.') }}</p>
            </div>
          </q-menu>
        </button>
        <q-btn flat round class="sheet-close" :disable="bucket.isSweeping" :aria-label="$t('Close')" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sb-body">
        <!-- A compact balance card makes the object and state clear before
             asking for a destination. The receipt count links this sheet to
             the +N badge that brought the user here. -->
        <div class="sb-balance-card">
          <span class="sb-balance-icon">
            <Icon icon="tabler:inbox" width="24" height="24" />
            <span v-if="bucket.paymentCount" class="sb-count">+{{ bucket.paymentCount }}</span>
          </span>
          <span class="sb-balance-copy">
            <small>{{ bucket.hasBalance ? $t('Ready to move') : $t('Social Bucket') }}</small>
            <strong>{{ formatSats(bucket.balanceSats) }} <em>{{ $t('sats') }}</em></strong>
          </span>
        </div>
        <p class="sb-lede">{{ $t('Payments to your name land here first.') }}</p>

        <!-- Empty. Say what will fill it rather than showing a dead button. -->
        <template v-if="!bucket.hasBalance">
          <div class="sb-empty">
            <Icon icon="tabler:circle-check" width="20" height="20" />
            <span>
              <strong>{{ $t('Nothing waiting') }}</strong>
              <small>{{ lastCheckedCaption }}</small>
            </span>
          </div>
          <p class="sb-empty-note">{{ $t('You do not have to do anything to receive. The bucket fills on its own, and you move it to a wallet whenever you like.') }}</p>
        </template>

        <template v-else>
          <div class="sb-section-head">{{ $t('Destination') }}</div>
          <button
            v-if="selectedWallet"
            type="button"
            class="sb-destination"
            :class="{ 'sb-destination--open': showWallets }"
            :disabled="bucket.isSweeping || wallets.length < 2"
            :aria-expanded="wallets.length > 1 ? String(showWallets) : undefined"
            @click="showWallets = !showWallets"
          >
            <span class="sb-wallet-icon"><Icon :icon="walletIcon(selectedWallet.type)" width="20" height="20" /></span>
            <span class="sb-wallet-copy">
              <strong>{{ selectedWallet.name }}</strong>
              <small>{{ formatSats(selectedWallet.balance) }} {{ $t('sats') }}</small>
            </span>
            <span v-if="wallets.length === 1" class="sb-selected-mark"><Icon icon="tabler:check" width="17" height="17" /></span>
            <Icon
              v-else
              icon="tabler:chevron-down"
              width="19"
              height="19"
              class="sb-wallet-chevron"
              :class="{ 'sb-wallet-chevron--open': showWallets }"
            />
          </button>

          <div v-else class="sb-no-wallet">
            <Icon icon="tabler:wallet-off" width="20" height="20" />
            <span>{{ $t('No wallets available') }}</span>
          </div>

          <transition name="sb-wallet-list">
            <div v-if="showWallets && wallets.length > 1" class="sb-wallet-list">
              <button
                v-for="wallet in wallets"
                :key="wallet.id"
                type="button"
                class="sb-wallet-option"
                :class="{ 'sb-wallet-option--selected': wallet.id === selectedWalletId }"
                @click="selectWallet(wallet.id)"
              >
                <span class="sb-wallet-icon"><Icon :icon="walletIcon(wallet.type)" width="18" height="18" /></span>
                <span class="sb-wallet-copy">
                  <strong>{{ wallet.name }}</strong>
                  <small>{{ formatSats(wallet.balance) }} {{ $t('sats') }}</small>
                </span>
                <Icon v-if="wallet.id === selectedWalletId" icon="tabler:check" width="18" height="18" class="sb-option-check" />
              </button>
            </div>
          </transition>

          <p v-if="!bucket.isSweeping && !moveIssue" class="sb-reassurance">
            <Icon icon="tabler:shield-check" width="16" height="16" />
            <span>{{ $t('Your money stays in the bucket until the transfer completes.') }}</span>
          </p>

          <div
            v-if="bucket.isSweeping"
            class="sb-progress"
            role="status"
            aria-live="polite"
          >
            <div v-for="step in moveSteps" :key="step.key" class="sb-progress-step" :class="step.state">
              <span class="sb-progress-dot">
                <q-spinner v-if="step.state === 'active'" size="15px" />
                <Icon v-else-if="step.state === 'done'" icon="tabler:check" width="15" height="15" />
              </span>
              <span>{{ step.label }}</span>
            </div>
            <p>{{ moveStatusCaption }}</p>
          </div>

          <div
            v-else-if="moveIssue"
            class="sb-status sb-status--paused"
            role="status"
            aria-live="polite"
          >
            <span class="sb-status-icon">
              <Icon icon="tabler:shield-check" width="19" height="19" />
            </span>
            <span class="sb-status-copy">
              <strong>{{ moveIssue.title }}</strong>
              <small>{{ moveIssue.caption }}</small>
            </span>
          </div>

        </template>
      </div>

      <!-- The action never disappears below a long wallet list. The footer is
           a stable home for both the primary action and fee disclosure. -->
      <div v-if="bucket.hasBalance" class="sb-action-bar">
        <button type="button" class="btn-primary" :disabled="!canMove" @click="onMove">
          <span>{{ moveButtonLabel }}</span>
        </button>
        <p>{{ $t('The network fee is taken from this amount.') }}</p>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useSocialBucketStore } from '../../stores/socialBucket';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { useWalletStore } from '../../stores/wallet';
import { useTransactionMetadataStore } from '../../stores/transactionMetadata';
import { sanitizeImageUrl } from '../../services/nostrRecipient';

export default {
  name: 'SocialBucketSheet',

  components: { Icon },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue', 'moved'],

  setup() {
    return {
      bucket: useSocialBucketStore(),
      identity: useIdentityStore(),
      profile: useProfileStore(),
      walletStore: useWalletStore(),
      transactionMetadata: useTransactionMetadataStore(),
    };
  },

  data() {
    return {
      selectedWalletId: null,
      moveIssue: null,
      showWallets: false,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    /** Every wallet can receive, so every wallet is a valid destination. */
    wallets() {
      return this.walletStore.getTransferableWallets();
    },

    selectedWalletName() {
      const w = this.wallets.find((x) => x.id === this.selectedWalletId);
      return w?.name || this.$t('your wallet');
    },

    selectedWallet() {
      return this.wallets.find((wallet) => wallet.id === this.selectedWalletId) || null;
    },

    canMove() {
      return this.bucket.canSweep && !!this.selectedWalletId;
    },

    moveButtonLabel() {
      if (!this.bucket.isSweeping) {
        return this.moveIssue
          ? this.$t('Try again')
          : this.$t('Move to {wallet}', { wallet: this.selectedWalletName });
      }
      if (this.bucket.sweepStage === 'checking') return this.$t('Checking payments');
      if (this.bucket.sweepStage === 'collecting') return this.$t('Preparing transfer');
      if (this.bucket.sweepStage === 'sending') {
        return this.$t('Sending to {wallet}', { wallet: this.selectedWalletName });
      }
      return this.$t('Moving');
    },

    moveStatusCaption() {
      if (this.bucket.sweepStage === 'sending') {
        return this.$t('Your wallet is receiving one normal Lightning payment.');
      }
      return this.$t('Keep BuhoGO open. This can take a moment.');
    },

    moveSteps() {
      const order = ['checking', 'collecting', 'sending'];
      const current = Math.max(0, order.indexOf(this.bucket.sweepStage));
      return [
        { key: 'checking', label: this.$t('Checking payments') },
        { key: 'collecting', label: this.$t('Preparing transfer') },
        { key: 'sending', label: this.$t('Sending to {wallet}', { wallet: this.selectedWalletName }) },
      ].map((step, index) => ({
        ...step,
        state: index < current ? 'done' : (index === current ? 'active' : 'waiting'),
      }));
    },

    lastCheckedCaption() {
      if (this.bucket.isSyncing) return this.$t('Checking');
      if (!this.bucket.lastSyncAt) return '';
      return this.$t('Checked just now');
    },
  },

  watch: {
    async modelValue(isOpen) {
      if (!isOpen) return;
      this.moveIssue = null;
      this.showWallets = false;
      this.selectedWalletId = this.walletStore.activeWalletId || this.wallets[0]?.id || null;
      // The balance is the reason this sheet exists, so it is refreshed on
      // every open rather than trusted from the last visit.
      await this.bucket.sync({ identityStore: this.identity });
    },
  },

  methods: {
    formatSats(n) {
      return new Intl.NumberFormat().format(Math.max(0, Math.floor(n || 0)));
    },

    walletIcon(type) {
      if (type === 'nwc') return 'tabler:plug-connected';
      if (type === 'lnbits') return 'tabler:server';
      return 'tabler:wallet';
    },

    selectWallet(walletId) {
      if (this.bucket.isSweeping) return;
      this.selectedWalletId = walletId;
      this.showWallets = false;
      this.moveIssue = null;
    },

    async onMove() {
      if (!this.canMove) return;
      this.moveIssue = null;
      const walletId = this.selectedWalletId;
      const walletName = this.selectedWalletName;

      const result = await this.bucket.sweepTo({
        identityStore: this.identity,
        createInvoice: (sats) =>
          this.walletStore.createInvoiceOnWallet(walletId, sats, 'Social Bucket'),
      });

      if (result.ok) {
        // The destination provider assigns the transaction id, so we cannot
        // annotate the receive directly. Queue a wallet-scoped incoming link
        // before refreshing: the normal transaction loader consumes it and
        // persists this profile identity on the matching receive. That gives
        // home, history and details one durable source of truth.
        try {
          await this.transactionMetadata.enqueuePendingContactLink({
            amountSats: result.moved,
            label: this.$t('Profile payout'),
            source: 'social-bucket',
            counterpartyAvatar: {
              kind: 'nostr',
              npub: this.identity.nostrNpub || null,
              picture: sanitizeImageUrl(this.profile.picture) || null,
            },
            perPayment: true,
            direction: 'incoming',
            walletId,
          });
        } catch (err) {
          // Metadata is presentation only. A completed Lightning payment must
          // never be reported as failed because local annotation did not save.
          console.warn('[social-bucket] could not label destination transaction:', err);
        }

        this.$q.notify({
          type: 'positive',
          message: this.$t('{n} sats moved to {wallet}', {
            n: this.formatSats(result.moved),
            wallet: walletName,
          }),
          timeout: 3500,
        });
        this.$emit('moved', result);
        this.open = false;
        // The destination balance is now stale everywhere it is shown.
        this.walletStore.refreshBalances?.();
        return;
      }

      this.moveIssue = {
        title: this.moveErrorMessage(result.reason),
        caption: result.reason === 'MINT_PARTIAL'
          ? this.$t('We paused before sending. All remaining sats are safe here.')
          : this.$t('Nothing was lost. You can try again.'),
      };
    },

    /**
     * Every failure has to say something a person can act on. A raw code in a
     * toast is the same as no message at all.
     */
    moveErrorMessage(reason) {
      switch (reason) {
        case 'TOO_SMALL':
        case 'FEES_TOO_HIGH':
          return this.$t('Too little to move right now');
        case 'NO_INVOICE':
          return this.$t('That wallet could not take a payment');
        case 'MINT_FAILED':
          return this.$t('Could not collect the payment yet');
        case 'MINT_PARTIAL':
          return this.$t('One payment needs another moment');
        case 'EMPTY':
          return this.$t('Nothing to move');
        default:
          return this.$t("Couldn't move it");
      }
    },
  },
};
</script>

<style scoped>
.sb-sheet {
  width: 100%;
  max-width: 520px;
  max-height: min(88dvh, 760px);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.sb-info-button {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}
.sb-info-button:active:not(:disabled) { background: var(--bg-input); }
.sb-info-button:disabled { color: var(--text-muted); }

.sb-info-card {
  width: min(310px, calc(100vw - 32px));
  padding: 16px;
  color: var(--text-primary);
  background: var(--bg-card);
}
.sb-info-card strong { font: 720 15px 'Manrope', sans-serif; }
.sb-info-card p { margin: 6px 0 0; color: var(--text-secondary); font-size: 12.5px; line-height: 1.5; }

.sb-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px 16px 16px;
}

.sb-balance-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 15px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
}

.sb-balance-icon {
  position: relative;
  width: 50px;
  height: 50px;
  flex: 0 0 50px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  color: var(--brand-accent-text);
  background: var(--brand-accent-soft);
}

.sb-count {
  position: absolute;
  top: -6px;
  right: -8px;
  min-width: 23px;
  height: 19px;
  display: grid;
  place-items: center;
  padding: 0 5px;
  border: 2px solid var(--bg-card);
  border-radius: var(--radius-pill);
  background: var(--brand-accent-text);
  color: var(--bg-card);
  font: 750 10px 'Manrope', sans-serif;
}

.sb-balance-copy { min-width: 0; }
.sb-balance-copy small,
.sb-balance-copy strong { display: block; }
.sb-balance-copy small { margin-bottom: 3px; color: var(--text-secondary); font-size: 12px; }
.sb-balance-copy strong { color: var(--text-primary); font: 770 28px/1.05 'Manrope', sans-serif; letter-spacing: -0.035em; }
.sb-balance-copy em { color: var(--text-secondary); font-size: 14px; font-style: normal; font-weight: 650; letter-spacing: 0; }

.sb-lede { margin: 10px 3px 18px; color: var(--text-secondary); font-size: 12.5px; line-height: 1.45; }
.sb-section-head { margin: 0 4px 8px; color: var(--text-secondary); font: 680 12px 'Manrope', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; }

.sb-destination,
.sb-no-wallet {
  width: 100%;
  min-height: 66px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  background: var(--bg-card);
  text-align: left;
}
.sb-destination { cursor: pointer; }
.sb-destination:disabled { cursor: default; opacity: 1; }
.sb-destination:active:not(:disabled),
.sb-destination--open { background: var(--bg-input); }

.sb-wallet-icon {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  color: var(--brand-accent-text);
  background: var(--brand-accent-soft);
}
.sb-wallet-copy { min-width: 0; flex: 1; }
.sb-wallet-copy strong,
.sb-wallet-copy small { display: block; }
.sb-wallet-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 680 14.5px 'Manrope', sans-serif; }
.sb-wallet-copy small { margin-top: 3px; color: var(--text-secondary); font-size: 12px; }
.sb-selected-mark,
.sb-option-check { color: var(--brand-accent-text); }
.sb-wallet-chevron { flex: 0 0 auto; color: var(--text-muted); transition: transform 160ms ease; }
.sb-wallet-chevron--open { transform: rotate(180deg); }

.sb-wallet-list {
  max-height: min(260px, 34dvh);
  overflow-y: auto;
  margin-top: 8px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
}

.sb-wallet-option {
  width: 100%;
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--border-card);
  color: var(--text-primary);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.sb-wallet-option:last-child { border-bottom: 0; }
.sb-wallet-option:active,
.sb-wallet-option--selected { background: var(--brand-accent-soft); }
.sb-wallet-option .sb-wallet-icon { width: 36px; height: 36px; flex-basis: 36px; }

.sb-wallet-list-enter-active,
.sb-wallet-list-leave-active { transition: opacity 150ms ease, transform 150ms ease; transform-origin: top; }
.sb-wallet-list-enter-from,
.sb-wallet-list-leave-to { opacity: 0; transform: translateY(-4px); }

.sb-reassurance,
.sb-empty-note { margin: 12px 4px 0; color: var(--text-muted); font-size: 11.5px; line-height: 1.45; }
.sb-reassurance { display: flex; align-items: flex-start; gap: 7px; }
.sb-reassurance svg { flex: 0 0 auto; margin-top: 1px; color: var(--brand-accent-text); }

.sb-empty,
.sb-no-wallet { color: var(--text-secondary); }
.sb-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 14px;
  border-radius: var(--radius-lg);
  background: var(--bg-input);
}
.sb-empty > svg { flex: 0 0 auto; color: var(--brand-accent-text); }
.sb-empty span { min-width: 0; }
.sb-empty strong,
.sb-empty small { display: block; }
.sb-empty strong { color: var(--text-primary); font-size: 13.5px; }
.sb-empty small { margin-top: 2px; color: var(--text-muted); font-size: 11.5px; }

.sb-progress {
  margin-top: 14px;
  padding: 13px 14px;
  border: 1px solid var(--brand-accent-soft);
  border-radius: var(--radius-lg);
  background: var(--brand-accent-soft);
}
.sb-progress-step { min-height: 30px; display: flex; align-items: center; gap: 10px; color: var(--text-muted); font: 620 12.5px 'Manrope', sans-serif; }
.sb-progress-step.active { color: var(--text-primary); font-weight: 700; }
.sb-progress-step.done { color: var(--brand-accent-text); }
.sb-progress-dot { width: 22px; height: 22px; flex: 0 0 22px; display: grid; place-items: center; border: 1px solid var(--border-card); border-radius: 50%; background: var(--bg-card); }
.sb-progress-step.active .sb-progress-dot,
.sb-progress-step.done .sb-progress-dot { border-color: var(--brand-accent-text); color: var(--brand-accent-text); }
.sb-progress p { margin: 8px 0 0 32px; color: var(--text-secondary); font-size: 11.5px; line-height: 1.4; }

.sb-status { display: flex; align-items: center; gap: 12px; margin-top: 14px; padding: 13px 14px; border: 1px solid var(--color-warn-soft); border-radius: var(--radius-lg); background: var(--color-warn-soft); }
.sb-status-icon { width: 36px; height: 36px; flex: 0 0 36px; display: grid; place-items: center; border-radius: var(--radius-md); color: var(--color-warn); background: var(--bg-card); }
.sb-status-copy { min-width: 0; }
.sb-status-copy strong,
.sb-status-copy small { display: block; }
.sb-status-copy strong { color: var(--text-primary); font-size: 13.5px; font-weight: 680; }
.sb-status-copy small { margin-top: 3px; color: var(--text-secondary); font-size: 11.5px; line-height: 1.4; }

.sb-action-bar {
  flex: 0 0 auto;
  padding: 10px 16px max(14px, env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--border-card);
  background: var(--bg-page);
  box-shadow: 0 -12px 30px -28px rgba(0, 0, 0, 0.65);
}
.sb-action-bar .btn-primary { margin-top: 0; }
.sb-action-bar p { margin: 7px 4px 0; color: var(--text-muted); text-align: center; font-size: 11px; line-height: 1.35; }

@media (max-height: 600px) {
  .sb-sheet { max-height: 94dvh; }
  .sb-balance-card { padding: 11px 13px; }
  .sb-balance-icon { width: 44px; height: 44px; flex-basis: 44px; }
  .sb-lede { margin-bottom: 12px; }
}
</style>
