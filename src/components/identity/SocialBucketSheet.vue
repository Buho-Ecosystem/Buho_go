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
        <q-btn flat round class="sheet-close" :disable="bucket.isSweeping" :aria-label="$t('Close')" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-body">
        <!-- The amount is the whole point of opening this, so it leads. -->
        <div class="sb-amount">
          <span class="sb-amount-value">{{ formatSats(bucket.balanceSats) }}</span>
          <span class="sb-amount-unit">{{ $t('sats') }}</span>
        </div>
        <p class="sb-lede">{{ $t('Payments to your name land here first.') }}</p>

        <!-- Empty. Say what will fill it rather than showing a dead button. -->
        <template v-if="!bucket.hasBalance">
          <IdentityGroup :footer="$t('You do not have to do anything to receive. The bucket fills on its own, and you move it to a wallet whenever you like.')">
            <IdentityRow
              icon="tabler:inbox"
              :label="$t('Nothing waiting')"
              :caption="lastCheckedCaption"
              :interactive="false"
            />
          </IdentityGroup>
        </template>

        <template v-else>
          <!-- Destination. One row when there is one wallet, a picker when
               there are several. Choosing is the only decision here. -->
          <IdentityGroup
            :title="$t('Move it to')"
            :footer="destinationFooter"
          >
            <IdentityRow
              v-for="w in wallets"
              :key="w.id"
              :icon="walletIcon(w.type)"
              :tone="w.id === selectedWalletId ? 'accent' : 'neutral'"
              :label="w.name"
              :caption="formatSats(w.balance) + ' ' + $t('sats')"
              :chip="w.id === selectedWalletId ? $t('Selected') : ''"
              chip-tone="ok"
              :chevron="false"
              @click="selectedWalletId = w.id"
            />
          </IdentityGroup>

          <button
            type="button"
            class="btn-primary"
            :disabled="!canMove"
            @click="onMove"
          >
            <q-spinner v-if="bucket.isSweeping" size="18px" />
            <span>{{ bucket.isSweeping ? $t('Moving') : $t('Move to {wallet}', { wallet: selectedWalletName }) }}</span>
          </button>

          <p class="sb-foot">{{ $t('Moving costs a small network fee, taken from the amount.') }}</p>
        </template>

        <!-- One quiet line about what this is, for the person who opened the
             sheet to find out rather than to move money. -->
        <p class="sb-explainer">
          {{ $t('Your name has no wallet of its own, so BuhoGO gives it a place to receive. Keeping it topped up is not the idea: move it to a wallet and it behaves like any other Bitcoin you hold.') }}
        </p>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import IdentityGroup from './IdentityGroup.vue';
import IdentityRow from './IdentityRow.vue';
import { useSocialBucketStore } from '../../stores/socialBucket';
import { useIdentityStore } from '../../stores/identity';
import { useWalletStore } from '../../stores/wallet';

export default {
  name: 'SocialBucketSheet',

  components: { Icon, IdentityGroup, IdentityRow },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue', 'moved'],

  setup() {
    return {
      bucket: useSocialBucketStore(),
      identity: useIdentityStore(),
      walletStore: useWalletStore(),
    };
  },

  data() {
    return { selectedWalletId: null };
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

    canMove() {
      return this.bucket.canSweep && !!this.selectedWalletId;
    },

    destinationFooter() {
      return this.wallets.length > 1
        ? this.$t('The money arrives as a normal payment in that wallet.')
        : this.$t('It arrives as a normal payment, like any other.');
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

    async onMove() {
      if (!this.canMove) return;
      const walletId = this.selectedWalletId;
      const walletName = this.selectedWalletName;

      const result = await this.bucket.sweepTo({
        identityStore: this.identity,
        createInvoice: (sats) =>
          this.walletStore.createInvoiceOnWallet(walletId, sats, 'Social Bucket'),
      });

      if (result.ok) {
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

      this.$q.notify({
        type: 'negative',
        message: this.moveErrorMessage(result.reason),
        caption: this.$t('Nothing was lost. You can try again.'),
        timeout: 4500,
      });
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
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

/* The number leads. Everything else on the sheet is smaller than it. */
.sb-amount {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 7px;
  padding: 10px 0 2px;
}

.sb-amount-value {
  font-family: 'Manrope', sans-serif;
  font-size: 40px;
  font-weight: 780;
  letter-spacing: -0.04em;
  color: var(--text-primary);
  line-height: 1;
}

.sb-amount-unit {
  font-size: 15px;
  font-weight: 640;
  color: var(--text-secondary);
}

.sb-lede {
  font-size: 13.5px;
  color: var(--text-secondary);
  text-align: center;
  margin: 10px 0 20px;
  line-height: 1.45;
}

.sb-foot,
.sb-explainer {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 10px 6px 0;
}

.sb-explainer {
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid var(--border-card);
}
</style>
