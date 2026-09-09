<!--
  SupportBuhoGo — the donation card, self-contained.

  Lived inline on the Settings page; it now belongs to the About page,
  next to the project's story, so Settings stays configuration and the
  ask sits where the context is. Owns the whole flow: preset / custom
  amount, LNURL-pay resolve against the donation address, and the
  invoice QR dialog with its Open-in-Wallet and donations-portal links.
  Falls back to copying the Lightning address when the resolve fails.
-->
<template>
  <div class="support-card" :class="$q.dark.isActive ? 'support-card-dark' : 'support-card-light'">
    <div class="support-heading">{{ $t('Support BuhoGO') }}</div>
    <div class="support-message">{{ $t('Fuel BuhoGO to Fly Higher') }}</div>
    <div class="donation-row">
      <q-btn
        flat dense no-caps
        class="donate-btn"
        :class="$q.dark.isActive ? 'donate-btn-dark' : 'donate-btn-light'"
        :loading="donationLoading === 5000"
        @click="handleDonation(5000)"
      >
        {{ formatSats(5000) }}
      </q-btn>
      <q-btn
        unelevated dense no-caps
        class="donate-btn donate-btn-primary"
        :loading="donationLoading === 21000"
        @click="handleDonation(21000)"
      >
        {{ formatSats(21000) }}
      </q-btn>
      <q-btn
        flat dense no-caps
        class="donate-btn"
        :class="$q.dark.isActive ? 'donate-btn-dark' : 'donate-btn-light'"
        @click="showDonationDialog = true"
      >
        {{ $t('Other') }}
      </q-btn>
    </div>

    <!-- Custom amount -->
    <q-dialog v-model="showDonationDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="donation-dialog-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="donation-dialog-header">
          <div class="donation-dialog-title">{{ $t('Support BuhoGO') }}</div>
          <q-btn flat round dense v-close-popup class="donation-dialog-close">
            <Icon icon="tabler:x" width="18" height="18" />
          </q-btn>
        </q-card-section>
        <q-card-section class="donation-dialog-content">
          <q-input
            v-model.number="customDonationAmount"
            type="number"
            outlined
            :label="$t('Amount')"
            class="donation-input"
            :dark="$q.dark.isActive"
          />
          <q-btn
            unelevated
            no-caps
            class="send-donation-btn donation-btn-green"
            :loading="donationLoading === 'custom'"
            :disable="!customDonationAmount || customDonationAmount < 1"
            @click="handleDonation(customDonationAmount)"
          >
            {{ $t('Send Donation') }}
          </q-btn>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Invoice QR -->
    <q-dialog v-model="showDonationInvoiceDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="donation-invoice-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="donation-dialog-header">
          <div class="donation-dialog-title">{{ $t('Donate') }} {{ formatSats(donationInvoiceAmount) }}</div>
          <q-btn flat round dense v-close-popup class="donation-dialog-close">
            <Icon icon="tabler:x" width="18" height="18" />
          </q-btn>
        </q-card-section>
        <q-card-section class="donation-invoice-content">
          <div class="donation-qr-wrapper" @click="copyDonationInvoice">
            <vue-qrcode
              v-if="donationInvoice"
              :value="donationInvoice"
              :options="{ width: 220, margin: 0, color: { dark: '#1E293B', light: '#ffffff' } }"
              class="donation-qr"
            />
          </div>
          <div class="donation-qr-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ $t('Tap QR to copy invoice') }}
          </div>
          <q-btn
            unelevated
            no-caps
            class="open-wallet-btn donation-btn-green"
            @click="openInWallet"
          >
            <Icon icon="tabler:external-link" class="q-mr-sm" />
            {{ $t('Open in Wallet') }}
          </q-btn>
          <div class="donation-portal-section">
            <q-separator :class="$q.dark.isActive ? 'bg-grey-8' : 'bg-grey-3'" class="q-my-md" />
            <div class="donation-portal-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t('See top donors & recent donations') }}
            </div>
            <q-btn
              flat
              no-caps
              dense
              class="donation-portal-link"
              @click="openSupportPortal"
            >
              <Icon icon="tabler:heart" class="q-mr-xs" />
              {{ $t('Donations Portal') }}
            </q-btn>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script>
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { Icon } from '@iconify/vue';
import { mapState } from 'pinia';
import { useWalletStore } from '../../stores/wallet';
import { formatAmount } from '../../utils/amountFormatting.js';
import { lnurlGetJson } from '../../utils/lnurlHttp.js';

export default {
  name: 'SupportBuhoGo',

  components: { VueQrcode, Icon },

  data() {
    return {
      showDonationDialog: false,
      showDonationInvoiceDialog: false,
      customDonationAmount: null,
      donationAddress: 'buhogo@timecatcher.lnbits.de',
      donationLoading: null,
      donationInvoice: null,
      donationInvoiceAmount: 0,
    };
  },

  computed: {
    ...mapState(useWalletStore, ['useBip177Format']),
  },

  methods: {
    formatSats(amount) {
      return formatAmount(amount, this.useBip177Format);
    },

    /**
     * Resolve the donation Lightning address via LNURL-pay and show the
     * invoice QR. On any failure, fall back to offering the address for
     * manual copy — a donation must never dead-end.
     */
    async handleDonation(amount) {
      const loadingKey = amount === this.customDonationAmount ? 'custom' : amount;
      this.donationLoading = loadingKey;

      try {
        const [name, domain] = this.donationAddress.split('@');
        const lnurlPayUrl = `https://${domain}/.well-known/lnurlp/${name}`;

        const paramsResponse = await lnurlGetJson(lnurlPayUrl);
        if (!paramsResponse.ok) {
          throw new Error('Failed to fetch LNURL-pay params');
        }
        const params = paramsResponse.data;
        if (!params || params.status === 'ERROR') {
          throw new Error(params?.reason || 'LNURL-pay error');
        }

        const amountMsat = amount * 1000;
        if (amountMsat < params.minSendable || amountMsat > params.maxSendable) {
          const minSats = Math.ceil(params.minSendable / 1000);
          const maxSats = Math.floor(params.maxSendable / 1000);
          throw new Error(`Amount must be between ${this.formatSats(minSats)} and ${this.formatSats(maxSats)}`);
        }

        const callbackUrl = new URL(params.callback);
        callbackUrl.searchParams.set('amount', amountMsat.toString());

        const invoiceResponse = await lnurlGetJson(callbackUrl.toString());
        if (!invoiceResponse.ok) {
          throw new Error('Failed to fetch invoice');
        }
        const invoiceData = invoiceResponse.data;
        if (!invoiceData || invoiceData.status === 'ERROR') {
          throw new Error(invoiceData?.reason || 'Failed to generate invoice');
        }

        this.donationInvoice = invoiceData.pr;
        this.donationInvoiceAmount = amount;
        this.showDonationDialog = false;
        this.customDonationAmount = null;
        this.showDonationInvoiceDialog = true;
      } catch (error) {
        console.error('Donation error:', error);
        this.$q.notify({
          type: 'warning',
          message: this.$t("Couldn't generate invoice"),
          caption: this.$t('Copy the lightning address instead: {address}', { address: this.donationAddress }),
          timeout: 10000,
          actions: [
            {
              label: this.$t('Copy'),
              color: 'white',
              handler: () => {
                navigator.clipboard.writeText(this.donationAddress);
                this.$q.notify({ type: 'positive', message: this.$t('Address copied') });
              },
            },
          ],
        });
      } finally {
        this.donationLoading = null;
      }
    },

    copyDonationInvoice() {
      if (!this.donationInvoice) return;
      navigator.clipboard.writeText(this.donationInvoice);
      this.$q.notify({ type: 'positive', message: this.$t('Invoice copied'), timeout: 2000 });
    },

    openInWallet() {
      if (!this.donationInvoice) return;
      window.location.href = `lightning:${this.donationInvoice}`;
    },

    openSupportPortal() {
      window.open('https://support-buhogo.netlify.app', '_blank');
    },
  },
};
</script>

<style scoped>
/* Card shell matches the SettingsSection surface so it reads as part of
   the page's grouped language. */
.support-card {
  border-radius: 16px;
  padding: 16px;
  text-align: center;
}

.support-card-dark {
  background: var(--bg-card, #1A1A1A);
}

.support-card-light {
  background: var(--bg-card, #FFFFFF);
  border: 1px solid var(--border-card, #E3DCC7);
}

.support-heading {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.support-message {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 13px;
}

.donation-row {
  display: flex;
  gap: 8px;
  width: 100%;
  justify-content: center;
}

.donate-btn {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  border-radius: 10px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
}

.donate-btn-dark { color: #888; background: rgba(255, 255, 255, 0.06); }
.donate-btn-light { color: var(--text-secondary); background: rgba(0, 0, 0, 0.04); }

.donate-btn-primary {
  background: var(--brand-accent);
  color: var(--brand-accent-fg, #0B3D2A);
}

.body--light .donate-btn-primary {
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
}

/* ── Dialogs ── */
.donation-dialog-card,
.donation-invoice-card {
  width: 100%;
  max-width: 320px;
  border-radius: 16px;
}

.donation-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem 0.75rem;
}

.donation-dialog-title {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.donation-dialog-close {
  color: var(--text-muted);
}

.donation-dialog-content {
  padding: 0 1.25rem 1.25rem;
}

.donation-input {
  margin-bottom: 1rem;
}

.send-donation-btn,
.open-wallet-btn {
  width: 100%;
  min-height: 44px;
  border-radius: 10px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
}

.donation-btn-green {
  background: #15DE72 !important;
  color: #000 !important;
}

.donation-btn-green:disabled {
  opacity: 0.4;
}

.donation-invoice-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 1.25rem 1.25rem;
}

.donation-qr-wrapper {
  background: #fff;
  padding: 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.donation-qr-wrapper:active {
  transform: scale(0.98);
}

.donation-qr-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  margin-top: 8px;
  margin-bottom: 16px;
}

.donation-portal-section {
  width: 100%;
  text-align: center;
  margin-top: 8px;
}

.donation-portal-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  margin-bottom: 4px;
}

.donation-portal-link {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
</style>
