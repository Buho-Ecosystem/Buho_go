<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card class="tr-sheet report-surface" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ headerTitle }}
        </div>
        <q-btn
          flat round dense
          :aria-label="$t('Close')"
          class="sheet-close-btn"
          :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          @click="open = false"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-scroll">
        <!-- ── Working ─────────────────────────────────────────────── -->
        <div v-if="phase === 'working'" class="step-body">
          <div class="stage" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'" aria-live="polite">
            <q-spinner color="grey" size="30px" />
            <span class="stage-text">{{ progressText }}</span>
          </div>
        </div>

        <!-- ── Done ────────────────────────────────────────────────── -->
        <template v-else-if="phase === 'done'">
          <div class="step-body">
            <div class="stage">
              <div class="stage-check">
                <Icon icon="tabler:circle-check-filled" width="44" height="44" />
              </div>
              <div class="stage-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ result.shared ? $t('Report created') : $t('Report saved') }}
              </div>
              <span class="stage-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ resultDetail }}
              </span>
            </div>

            <!-- Anything the document does not cover is said here as well as
                 on the document, because this is where it can still be acted
                 on. -->
            <div v-if="warnings.length" class="notice" :class="$q.dark.isActive ? 'notice-dark' : 'notice-light'">
              <Icon icon="tabler:info-circle" width="16" height="16" />
              <span>
                <template v-for="(w, i) in warnings" :key="i">{{ w }}<br v-if="i < warnings.length - 1" /></template>
              </span>
            </div>
          </div>
        </template>

        <!-- ── Choose ──────────────────────────────────────────────── -->
        <div v-else class="step-body">
          <p class="lede" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('A record of your transactions with the exchange rate for each one, ready to hand to an accountant.') }}
          </p>

          <!-- The currency decides whether values can be stated at all, so it
               is said before anything is chosen rather than after. -->
          <div v-if="!currencySupported" class="notice notice--warn" :class="$q.dark.isActive ? 'notice-dark' : 'notice-light'">
            <Icon icon="tabler:alert-triangle" width="16" height="16" />
            <span>{{ $t('Historical prices are not available for {currency}, so the report will list amounts in sats without a {currency} value. Switch your currency to euro, dollar, pound, franc, yen or an Australian or Canadian dollar to include values.', { currency }) }}</span>
          </div>

          <!-- Wallets -->
          <section class="group">
            <div class="group-head">
              <span class="group-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ $t('Wallets') }}</span>
              <button
                v-if="wallets.length > 1"
                type="button"
                class="group-action"
                @click="toggleAll"
              >
                {{ allSelected ? $t('Clear') : $t('Select all') }}
              </button>
            </div>
            <button
              v-for="w in wallets"
              :key="w.id"
              type="button"
              class="pick"
              :class="$q.dark.isActive ? 'pick-dark' : 'pick-light'"
              role="checkbox"
              :aria-checked="selectedWallets.includes(w.id) ? 'true' : 'false'"
              @click="toggleWallet(w.id)"
            >
              <span class="pick-body">
                <span class="pick-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ w.name || $t('Wallet') }}</span>
                <span class="pick-meta" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">{{ walletKind(w) }}</span>
              </span>
              <Icon
                v-if="selectedWallets.includes(w.id)"
                icon="tabler:circle-check-filled"
                width="20" height="20"
                class="pick-check"
              />
              <span v-else class="pick-empty" :class="$q.dark.isActive ? 'pick-empty-dark' : 'pick-empty-light'"></span>
            </button>
          </section>

          <!-- Period -->
          <section class="group">
            <div class="group-head">
              <span class="group-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ $t('Period') }}</span>
            </div>
            <div class="segmented" :class="$q.dark.isActive ? 'segmented-dark' : 'segmented-light'" role="radiogroup">
              <button
                v-for="p in periods"
                :key="p.id"
                type="button"
                role="radio"
                :aria-checked="periodId === p.id ? 'true' : 'false'"
                class="segment"
                :class="{ 'segment--on': periodId === p.id }"
                @click="periodId = p.id"
              >{{ $t(p.labelKey) }}</button>
            </div>
          </section>

          <!-- Format -->
          <section class="group">
            <div class="group-head">
              <span class="group-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ $t('Format') }}</span>
            </div>
            <button
              v-for="f in formats"
              :key="f.id"
              type="button"
              class="pick"
              :class="$q.dark.isActive ? 'pick-dark' : 'pick-light'"
              role="radio"
              :aria-checked="format === f.id ? 'true' : 'false'"
              @click="format = f.id"
            >
              <span class="pick-icon" :class="$q.dark.isActive ? 'pick-icon-dark' : 'pick-icon-light'">
                <Icon :icon="f.icon" width="18" height="18" />
              </span>
              <span class="pick-body">
                <span class="pick-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ f.label }}</span>
                <span class="pick-meta" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">{{ f.hint }}</span>
              </span>
              <Icon v-if="format === f.id" icon="tabler:circle-check-filled" width="20" height="20" class="pick-check" />
              <span v-else class="pick-empty" :class="$q.dark.isActive ? 'pick-empty-dark' : 'pick-empty-light'"></span>
            </button>
          </section>

          <div v-if="error" class="notice notice--error" role="alert">
            <Icon icon="tabler:alert-circle" width="16" height="16" />
            <span>{{ error }}</span>
          </div>
        </div>
      </div>

      <div class="sheet-actions" :class="$q.dark.isActive ? 'sheet-actions-dark' : 'sheet-actions-light'">
        <button
          v-if="phase === 'done'"
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          @click="phase = 'choose'"
        >
          <span>{{ $t('Create another') }}</span>
        </button>
        <button
          v-else
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :disabled="!canCreate"
          @click="create"
        >
          <q-spinner v-if="phase === 'working'" size="18px" />
          <span>{{ phase === 'working' ? $t('Working…') : $t('Create report') }}</span>
        </button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../../stores/wallet';
import { useTransactionMetadataStore } from '../../stores/transactionMetadata';
import { normalizeTx } from '../../services/txNormalizer.js';
import {
  buildReport, exportReport, standardPeriods, supportsCurrency,
} from '../../services/taxReport';

/**
 * "Transaction report" — the tax-record export.
 *
 * One screen, three choices, one action. The alternative shape was a wizard,
 * and a wizard for three questions is ceremony: the whole configuration fits
 * above the fold, so the user can see what they are about to get before they
 * ask for it.
 *
 * The choices are ordered by what changes the answer most: which wallets
 * (the report is worthless if it covers the wrong money), then the period,
 * then the file format, which is the only one that can be changed after the
 * fact without redoing the work.
 */
export default {
  name: 'TaxReportSheet',
  components: { Icon },
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],

  setup() {
    return {
      walletStore: useWalletStore(),
      metadataStore: useTransactionMetadataStore(),
    };
  },

  data() {
    return {
      phase: 'choose',
      selectedWallets: [],
      periodId: 'thisYear',
      format: 'pdf',
      progress: null,
      error: '',
      result: null,
      warnings: [],
      controller: null,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    wallets() {
      return this.walletStore.wallets || [];
    },

    currency() {
      return String(this.walletStore.preferredFiatCurrency || 'USD').toUpperCase();
    },

    currencySupported() {
      return supportsCurrency(this.currency);
    },

    periods() {
      return standardPeriods();
    },

    formats() {
      return [
        { id: 'pdf', icon: 'tabler:file-text', label: this.$t('PDF'), hint: this.$t('A statement to read or hand over') },
        { id: 'csv', icon: 'tabler:table', label: this.$t('CSV'), hint: this.$t('Opens in Excel, Numbers or Sheets') },
        { id: 'xml', icon: 'tabler:file-code', label: this.$t('XML'), hint: this.$t('For bookkeeping software') },
      ];
    },

    allSelected() {
      return this.wallets.length > 0 && this.selectedWallets.length === this.wallets.length;
    },

    canCreate() {
      return this.phase === 'choose' && this.selectedWallets.length > 0;
    },

    headerTitle() {
      if (this.phase === 'working') return this.$t('One moment');
      if (this.phase === 'done') return this.$t('Done');
      return this.$t('Transaction report');
    },

    progressText() {
      const p = this.progress;
      if (!p) return this.$t('Getting your transactions…');
      if (p.phase === 'collecting') {
        return p.wallet
          ? this.$t('Reading {wallet}…', { wallet: p.wallet })
          : this.$t('Getting your transactions…');
      }
      if (p.phase === 'pricing') {
        return this.$t('Looking up the rate for each transaction ({done} of {total})…', {
          done: p.done, total: p.total,
        });
      }
      return this.$t('Building the file…');
    },

    resultDetail() {
      if (!this.result) return '';
      const { filename, shared, count } = this.result;
      const covered = this.$t('{n} transactions', { n: count });
      return shared
        ? `${covered} · ${filename}`
        : this.$t('{covered}. Saved as {filename}.', { covered, filename });
    },
  },

  watch: {
    open(isOpen) {
      if (isOpen) this.reset();
    },
  },

  beforeUnmount() {
    this.controller?.abort();
  },

  methods: {
    reset() {
      this.phase = 'choose';
      // Every wallet by default: a report that quietly covers one of three is
      // the failure mode worth designing against, and unticking is easier
      // than remembering to tick.
      this.selectedWallets = this.wallets.map((w) => w.id);
      this.periodId = 'thisYear';
      this.format = 'pdf';
      this.progress = null;
      this.error = '';
      this.result = null;
      this.warnings = [];
    },

    onShow() {
      this.reset();
    },

    onHide() {
      this.controller?.abort();
      this.controller = null;
      this.phase = 'choose';
    },

    walletKind(w) {
      switch (w?.type) {
        case 'spark': return this.$t('Spark');
        case 'lnbits': return this.$t('LNbits');
        case 'nwc': return this.$t('Nostr Wallet Connect');
        case 'arkade': return this.$t('Arkade');
        default: return '';
      }
    },

    toggleWallet(id) {
      const i = this.selectedWallets.indexOf(id);
      if (i >= 0) this.selectedWallets.splice(i, 1);
      else this.selectedWallets.push(id);
    },

    toggleAll() {
      this.selectedWallets = this.allSelected ? [] : this.wallets.map((w) => w.id);
    },

    async create() {
      if (!this.canCreate) return;
      this.phase = 'working';
      this.error = '';
      this.progress = null;
      this.controller?.abort();
      this.controller = new AbortController();

      try {
        const period = this.periods.find((p) => p.id === this.periodId) || {};
        const chosen = this.wallets.filter((w) => this.selectedWallets.includes(w.id));

        const report = await buildReport({
          wallets: chosen,
          providers: this.walletStore.providers || {},
          normalize: (raw, ctx) => normalizeTx(raw, ctx),
          snapshotFor: (txId, walletId) =>
            this.metadataStore.getFiatAtSettlementForTransaction(txId, walletId),
          currency: this.currency,
          period: { fromMs: period.fromMs ?? null, toMs: period.toMs ?? null },
          locale: this.$i18n?.locale,
          onProgress: (p) => { this.progress = p; },
          signal: this.controller.signal,
        });

        const out = await exportReport(report, this.format);

        this.warnings = [
          report.meta.failedNote,
          report.meta.truncatedNote,
          report.summary.missingRates > 0
            ? this.$t('{n} transactions have no recorded exchange rate, so no value is stated for them.', { n: report.summary.missingRates })
            : '',
        ].filter(Boolean);

        this.result = { ...out, count: report.summary.count };
        this.phase = 'done';
      } catch (err) {
        this.error = err?.message
          ? this.$t("The report couldn't be created: {msg}", { msg: err.message })
          : this.$t("The report couldn't be created. Try again.");
        this.phase = 'choose';
      }
    },
  },
};
</script>

<style scoped>
.tr-sheet {
  width: 100%; max-width: 520px;
  border-top-left-radius: 22px; border-top-right-radius: 22px;
  overflow: hidden;
  /* var(--safe-bottom), not a bare env(): Android reports the env() inset as
     0 even with a nav bar; boot/safe-area.js patches the variable. */
  padding-bottom: max(16px, var(--safe-bottom, 16px));
  display: flex; flex-direction: column;
  max-height: 92vh; max-height: 92dvh;
}
.sheet-handle { display: flex; justify-content: center; padding: 8px 0 4px; flex-shrink: 0; }
.sheet-handle-bar-light, .sheet-handle-bar-dark { width: 36px; height: 4px; border-radius: 999px; display: block; }
.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark { background: rgba(255, 255, 255, 0.22); }

.sheet-header { display: flex; align-items: center; padding: 4px 18px 8px; gap: 8px; flex-shrink: 0; }
.sheet-title { flex: 1 1 auto; font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 600; letter-spacing: -0.005em; }
.sheet-close-btn { flex: 0 0 auto; }

.sheet-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.step-body { display: flex; flex-direction: column; gap: 18px; padding: 6px 18px 18px; }

.lede { margin: 0; font-family: 'Manrope', sans-serif; font-size: 13.5px; line-height: 1.5; }

.group { display: flex; flex-direction: column; gap: 8px; }
.group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.group-title { font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; }
.group-action {
  all: unset; min-height: 32px; display: inline-flex; align-items: center; padding: 0 4px;
  font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 600; color: #15a35b;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
body.body--dark .group-action { color: #2bd17f; }

.pick {
  all: unset; box-sizing: border-box;
  display: flex; align-items: center; gap: 12px;
  width: 100%; min-height: 56px; padding: 10px 14px; border-radius: 14px;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.pick-light { background: rgba(15, 23, 42, 0.04); }
.pick-dark { background: rgba(255, 255, 255, 0.05); }
.pick:active { transform: scale(0.995); }
.pick-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0; }
.pick-icon-light { background: rgba(15, 23, 42, 0.06); color: #334155; }
.pick-icon-dark { background: rgba(255, 255, 255, 0.08); color: #e2e8f0; }
.pick-body { display: flex; flex-direction: column; gap: 1px; flex: 1 1 auto; min-width: 0; }
.pick-name { font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; letter-spacing: -0.005em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick-meta { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 500; }
.pick-check { flex-shrink: 0; color: #15a35b; }
body.body--dark .pick-check { color: #2bd17f; }
.pick-empty { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; }
.pick-empty-light { box-shadow: inset 0 0 0 1.5px rgba(15, 23, 42, 0.18); }
.pick-empty-dark { box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.24); }

.segmented { display: flex; gap: 4px; padding: 4px; border-radius: 999px; }
.segmented-light { background: rgba(15, 23, 42, 0.05); }
.segmented-dark { background: rgba(255, 255, 255, 0.06); }
.segment {
  all: unset; box-sizing: border-box; flex: 1 1 0; min-height: 38px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600;
  color: #64748b; cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: center;
  transition: background-color 0.15s ease, color 0.15s ease;
}
body.body--dark .segment { color: #94a3b8; }
.segment--on { background: #ffffff; color: #0f172a; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1); }
body.body--dark .segment--on { background: rgba(255, 255, 255, 0.12); color: #f8fafc; box-shadow: none; }

.stage { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; padding: 34px 12px 16px; }
.stage-title { font-family: 'Manrope', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
.stage-text { font-family: 'Manrope', sans-serif; font-size: 14px; line-height: 1.5; max-width: 320px; }
.stage-check { color: #15a35b; }
body.body--dark .stage-check { color: #2bd17f; }

.notice { display: flex; align-items: flex-start; gap: 9px; padding: 11px 13px; border-radius: 12px; font-family: 'Manrope', sans-serif; font-size: 12.5px; line-height: 1.45; }
.notice-light { background: rgba(15, 23, 42, 0.045); color: #475569; }
.notice-dark { background: rgba(255, 255, 255, 0.05); color: #cbd5e1; }
.notice :deep(svg) { flex-shrink: 0; margin-top: 1px; }
.notice--warn { background: rgba(247, 147, 26, 0.1); color: #92400e; }
body.body--dark .notice--warn { background: rgba(247, 147, 26, 0.14); color: #fbbf24; }
.notice--error { background: rgba(239, 68, 68, 0.08); color: #b91c1c; }
body.body--dark .notice--error { background: rgba(239, 68, 68, 0.14); color: #fca5a5; }

.sheet-actions { flex-shrink: 0; padding: 12px 18px 6px; border-top: 1px solid transparent; }
.sheet-actions-light { border-top-color: rgba(15, 23, 42, 0.06); }
.sheet-actions-dark { border-top-color: rgba(255, 255, 255, 0.06); }
.primary-cta {
  width: 100%; height: 48px; border-radius: 16px; border: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.primary-cta:disabled { opacity: 0.45; cursor: default; }
.primary-cta:not(:disabled):active { transform: scale(0.98); }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
