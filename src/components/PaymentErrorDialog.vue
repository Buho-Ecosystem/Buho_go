<template>
  <q-dialog
    v-model="open"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="error-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <!-- Header -->
      <q-card-section class="error-dialog-header">
        <div class="error-dialog-title-wrap">
          <div class="error-dialog-icon">
            <Icon icon="tabler:alert-triangle" width="20" height="20" />
          </div>
          <div
            class="error-dialog-title"
            :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'"
          >
            {{ title }}
          </div>
        </div>
        <q-btn
          flat
          round
          dense
          @click="close"
          :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          :aria-label="$t('Close')"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </q-card-section>

      <!-- Body -->
      <q-card-section class="error-dialog-body">
        <!--
          Two render modes for the reason:
            * Curated / fallback prose: BuhoGO is speaking, render plain.
            * Upstream prose: render in a quoted block with an attribution
              label so the user can tell the message is from a third
              party (LUD-06 reason field, NWC error, etc.) and decide
              how much weight to give it.
        -->
        <div
          v-if="isUpstreamReason"
          class="error-quote"
          :class="$q.dark.isActive ? 'error-quote-dark' : 'error-quote-light'"
        >
          <div
            class="error-quote-label"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ reasonAttribution }}
          </div>
          <div
            class="error-quote-text"
            :class="$q.dark.isActive ? 'text-grey-3' : 'text-grey-9'"
          >
            {{ reason }}
          </div>
        </div>
        <p
          v-else
          class="error-reason"
          :class="$q.dark.isActive ? 'text-grey-3' : 'text-grey-9'"
        >
          {{ reason }}
        </p>

        <button
          v-if="hasTechnical"
          type="button"
          class="error-details-toggle"
          :class="$q.dark.isActive ? 'error-details-toggle-dark' : 'error-details-toggle-light'"
          @click="detailsOpen = !detailsOpen"
        >
          <Icon
            :icon="detailsOpen ? 'tabler:chevron-down' : 'tabler:chevron-right'"
            width="14"
            height="14"
          />
          {{ $t('Technical details') }}
        </button>

        <pre
          v-if="hasTechnical && detailsOpen"
          class="error-details-block"
          :class="$q.dark.isActive ? 'error-details-block-dark' : 'error-details-block-light'"
        >{{ technicalText }}</pre>
      </q-card-section>

      <!-- Actions -->
      <q-card-actions class="error-dialog-actions">
        <q-btn
          v-if="hasTechnical"
          flat
          no-caps
          class="error-secondary-btn"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          :icon-right="copied ? 'check' : null"
          :label="copied ? $t('Copied') : $t('Copy details')"
          @click="copyDetails"
        />
        <q-btn
          unelevated
          no-caps
          class="error-primary-btn"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :label="$t('OK')"
          @click="close"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script>
import { useWalletStore } from '../stores/wallet';

export default {
  name: 'PaymentErrorDialog',

  setup() {
    return { walletStore: useWalletStore() };
  },

  data() {
    return {
      detailsOpen: false,
      copied: false,
    };
  },

  computed: {
    open: {
      get() {
        return this.walletStore.paymentError?.visible || false;
      },
      set(v) {
        if (!v) this.walletStore.dismissPaymentError();
      },
    },

    title() {
      return this.walletStore.paymentError?.title || this.$t('Something went wrong');
    },

    reason() {
      return this.walletStore.paymentError?.reason || this.$t('Please try again.');
    },

    reasonAttribution() {
      return this.walletStore.paymentError?.reasonAttribution || '';
    },

    isUpstreamReason() {
      return this.walletStore.paymentError?.reasonSource === 'upstream';
    },

    technical() {
      return this.walletStore.paymentError?.technical || null;
    },

    hasTechnical() {
      return !!(this.technical && this.technical.raw);
    },

    technicalText() {
      const t = this.technical;
      if (!t) return '';
      const lines = [
        'BuhoGO payment error',
        `Time: ${t.timestamp || '—'}`,
      ];
      if (t.walletType)        lines.push(`Wallet: ${t.walletType}`);
      if (t.route)             lines.push(`Route: ${t.route}`);
      if (typeof t.amountSats === 'number') lines.push(`Amount: ${t.amountSats} sats`);
      lines.push('');
      lines.push(`Raw: ${t.raw || ''}`);
      return lines.join('\n');
    },
  },

  watch: {
    open(isOpen) {
      // Reset the disclosure state each time the dialog opens so a user
      // who left "Technical details" expanded last time isn't shown raw
      // text on the next, unrelated failure.
      if (isOpen) {
        this.detailsOpen = false;
        this.copied = false;
      }
    },
  },

  methods: {
    close() {
      this.walletStore.dismissPaymentError();
    },

    async copyDetails() {
      try {
        await navigator.clipboard.writeText(this.technicalText);
        this.copied = true;
        // Flip the label back after a moment so the affordance is
        // available again without forcing the user to re-open the
        // dialog. Two seconds is long enough to register the change
        // and short enough not to feel stuck.
        setTimeout(() => { this.copied = false; }, 2000);
      } catch (err) {
        console.error('Copy failed:', err);
        this.$q.notify({
          type: 'negative',
          message: this.$t("Couldn't copy details"),
          timeout: 2000,
        });
      }
    },
  },
};
</script>

<style scoped>
.error-dialog {
  width: 100%;
  max-width: 460px;
  border-radius: 20px;
  overflow: hidden;
}

.error-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 8px;
}

.error-dialog-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.error-dialog-icon {
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
}

.error-dialog-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.error-dialog-body {
  padding: 8px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.error-reason {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.55;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ─── Quote block for upstream-sourced reasons ───
   Border-left signal mirrors the seed-callout pattern used elsewhere
   in the app, but with a neutral slate colour so the user reads it
   as "third-party text" rather than a BuhoGO action callout. */

.error-quote {
  border-left: 2px solid #94a3b8;
  padding: 10px 12px;
  border-radius: 8px;
  font-family: 'Manrope', sans-serif;
}

.error-quote-light { background: rgba(148, 163, 184, 0.10); }
.error-quote-dark  { background: rgba(255, 255, 255, 0.04); }

.error-quote-label {
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 4px;
}

.error-quote-text {
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.error-details-toggle {
  background: none;
  border: none;
  padding: 6px 0;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  align-self: flex-start;
}

.error-details-toggle-light { color: #475569; }
.error-details-toggle-dark { color: #cbd5e1; }

.error-details-block {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
}

.error-details-block-light {
  background: #f1f5f9;
  color: #0f172a;
}

.error-details-block-dark {
  background: rgba(255, 255, 255, 0.05);
  color: #e2e8f0;
}

.error-dialog-actions {
  padding: 0 16px 16px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
}

.error-primary-btn {
  min-width: 120px;
  height: 44px;
  border-radius: 22px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.error-secondary-btn {
  height: 40px;
  border-radius: 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

@media (max-width: 480px) {
  .error-dialog-body {
    padding: 8px 16px 14px;
  }
}
</style>
