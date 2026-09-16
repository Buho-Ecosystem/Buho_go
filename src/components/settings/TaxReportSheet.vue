<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card
      class="tr-sheet report-surface"
      :class="[$q.dark.isActive ? 'card_dark_style' : 'card_light_style', { 'tr-sheet--tall': view === 'wallets' }]"
    >
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <div class="sheet-header">
        <!-- One contextual way back: the wallet picker steps back to the
             main view (never a second stacked sheet to close), everywhere
             else the arrow leaves the sheet. -->
        <q-btn
          flat round dense
          :aria-label="$t('Back')"
          class="sheet-back-btn glass-back-btn"
          @click="view === 'wallets' ? (view = 'main') : (open = false)"
        >
          <Icon icon="tabler:chevron-left" width="20" height="20" />
        </q-btn>
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ headerTitle }}
        </div>
        <div class="sheet-header-spacer" aria-hidden="true"></div>
      </div>

      <div class="sheet-scroll">
        <!-- ── Wallets ─────────────────────────────────────────────── -->
        <div v-if="view === 'wallets'" class="step-body">
          <div class="group-head group-head--sticky" :class="$q.dark.isActive ? 'sticky-dark' : 'sticky-light'">
            <span class="group-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ walletCountLabel }}</span>
            <button v-if="wallets.length > 1" type="button" class="group-action" @click="toggleAll">
              {{ allSelected ? $t('Clear') : $t('Select all') }}
            </button>
          </div>

          <!-- A filter only earns its place once the list stops fitting. -->
          <div v-if="wallets.length > 8" class="finder" :class="$q.dark.isActive ? 'finder-dark' : 'finder-light'">
            <Icon icon="tabler:search" width="16" height="16" />
            <input
              v-model="walletFilter"
              type="text"
              class="finder-input"
              :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
              :placeholder="$t('Find a wallet')"
              :aria-label="$t('Find a wallet')"
              autocomplete="off"
              spellcheck="false"
            />
            <button v-if="walletFilter" type="button" class="finder-clear" :aria-label="$t('Clear')" @click="walletFilter = ''">
              <Icon icon="tabler:x" width="14" height="14" />
            </button>
          </div>

          <div class="group">
            <button
              v-for="w in filteredWallets"
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

            <p v-if="!filteredWallets.length" class="lede" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('No wallet by that name.') }}
            </p>
          </div>
        </div>

        <!-- ── Working ─────────────────────────────────────────────── -->
        <div v-else-if="phase === 'working'" class="step-body">
          <div class="stage stage--work" aria-live="polite">
            <!-- Determinate from the first frame: the number of wallets is
                 known before anything is read, and a bar that starts as a
                 spinner cannot become one without changing shape. -->
            <div class="meter" :class="$q.dark.isActive ? 'meter-dark' : 'meter-light'"
                 role="progressbar" :aria-label="progressText"
                 :aria-valuenow="Math.round(fraction * 100)" aria-valuemin="0" aria-valuemax="100">
              <span class="meter-fill" :style="{ width: `${Math.round(fraction * 100)}%` }"></span>
            </div>
            <span class="stage-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ progressText }}</span>
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

            <!-- What each wallet actually gave. A single sentence covering
                 all of them is the thing a user skims past. -->
            <section v-if="walletResults.length > 1" class="group">
              <div class="group-head">
                <span class="group-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ $t('Wallets') }}</span>
              </div>
              <div
                v-for="r in walletResults"
                :key="r.id || r.name"
                class="tally"
                :class="$q.dark.isActive ? 'tally-dark' : 'tally-light'"
              >
                <Icon
                  :icon="r.status === 'read' ? 'tabler:circle-check-filled' : 'tabler:alert-circle'"
                  width="17" height="17"
                  :class="r.status === 'read' ? 'tally-ok' : 'tally-warn'"
                />
                <span class="tally-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ r.name }}</span>
                <span class="tally-count" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">{{ tallyLabel(r) }}</span>
              </div>
            </section>

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

          <!-- Wallets: one row whatever the count, so the period and the
               format stay visible for someone with fifteen of them. -->
          <section class="group">
            <div class="group-head">
              <span class="group-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ $t('Wallets') }}</span>
            </div>
            <button
              type="button"
              class="pick"
              :class="$q.dark.isActive ? 'pick-dark' : 'pick-light'"
              @click="view = 'wallets'"
            >
              <span class="pick-body">
                <span class="pick-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ walletSummary }}</span>
                <span class="pick-meta" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">{{ walletNames }}</span>
              </span>
              <Icon icon="tabler:chevron-right" width="18" height="18" class="pick-more" />
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
          v-if="view === 'wallets'"
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :disabled="!selectedWallets.length"
          @click="view = 'main'"
        >
          <span>{{ $t('Done') }}</span>
        </button>
        <template v-else-if="phase === 'working'">
          <button
            type="button"
            class="primary-cta primary-cta--quiet"
            :class="$q.dark.isActive ? 'quiet-dark' : 'quiet-light'"
            @click="cancel"
          >
            <span>{{ $t('Cancel') }}</span>
          </button>
        </template>
        <button
          v-else-if="phase === 'done'"
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
          <span>{{ $t('Create report') }}</span>
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
import { createReportConnector } from '../../services/taxReport/connect.js';

/**
 * "Transaction report" — the tax-record export.
 *
 * Three choices and one action, all of them on one screen, so the user can see
 * what they are about to get before they ask for it. Only the wallet list
 * moves off that screen, and only because it is the one part that has no fixed
 * size.
 *
 * The choices are ordered by what changes the answer most: which wallets
 * (the report is worthless if it covers the wrong money), then the period,
 * then the file format, which is the only one that can be changed after the
 * fact without redoing the work.
 *
 * Wallets are ONE ROW, not a list. Listing them inline held while people had
 * three; at fifteen the list is around 990px on its own and pushes the period
 * and the format entirely off the screen, so the two questions that decide
 * what the file contains become invisible behind the one that usually has the
 * same answer every time. The row opens a full-height list in place — the
 * sheet's own content swapping, with a Back button, rather than a second sheet
 * stacked on this one, which would leave someone closing two things to get out
 * of one.
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
      view: 'main',
      walletFilter: '',
      walletResults: [],
      selectedWallets: [],
      periodId: 'thisYear',
      format: 'pdf',
      progress: null,
      error: '',
      result: null,
      warnings: [],
      /**
       * The report currently in flight, or null.
       *
       * One object rather than a controller field and a connector field,
       * because the two only ever make sense together: every method that
       * touches one has to touch the other, and holding them separately is
       * what let a second run adopt half of the first run's state.
       */
      run: null,
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

    /**
     * Whether everything CURRENTLY LISTED is ticked.
     *
     * Against the filtered list, not the whole set: the button sits above the
     * list the user is looking at, and "Select all" reaching wallets they have
     * filtered out is a silent change to what the report covers.
     */
    allSelected() {
      const shown = this.filteredWallets;
      return shown.length > 0 && shown.every((w) => this.selectedWallets.includes(w.id));
    },

    filteredWallets() {
      const q = this.walletFilter.trim().toLowerCase();
      if (!q) return this.wallets;
      return this.wallets.filter((w) => (w.name || '').toLowerCase().includes(q)
        || this.walletKind(w).toLowerCase().includes(q));
    },

    /** The headline on the row: what is covered, not how many boxes are ticked. */
    walletSummary() {
      const n = this.selectedWallets.length;
      if (!n) return this.$t('No wallets chosen');
      if (this.allSelected) {
        return this.wallets.length === 1
          ? this.$t('Your wallet')
          : this.$t('All {n} wallets', { n: this.wallets.length });
      }
      return this.$t('{n} of {m} wallets', { n, m: this.wallets.length });
    },

    /** Names underneath, so the row says which money without opening it. */
    walletNames() {
      const chosen = this.wallets.filter((w) => this.selectedWallets.includes(w.id));
      if (!chosen.length) return this.$t('Choose at least one');
      const names = chosen.map((w) => w.name || this.$t('Wallet'));
      if (names.length <= 3) return names.join(', ');
      return this.$t('{names} and {n} more', { names: names.slice(0, 2).join(', '), n: names.length - 2 });
    },

    walletCountLabel() {
      return this.$t('{n} of {m} selected', { n: this.selectedWallets.length, m: this.wallets.length });
    },

    /**
     * One bar from start to finish.
     *
     * Reading the wallets is the slow half and its size is known up front, so
     * the bar is determinate from the first frame rather than starting as a
     * spinner: a spinner that becomes a bar changes shape mid-task, which
     * reads as a different operation starting.
     */
    fraction() {
      const p = this.progress;
      if (!p) return 0.02;
      const share = (done, total) => (total > 0 ? Math.min(1, done / total) : 0);
      if (p.phase === 'collecting') return 0.02 + share(p.done, p.total) * 0.53;
      if (p.phase === 'pricing') return 0.55 + share(p.done, p.total) * 0.40;
      return 0.97;
    },

    canCreate() {
      return this.phase === 'choose' && this.selectedWallets.length > 0;
    },

    headerTitle() {
      if (this.view === 'wallets') return this.$t('Wallets');
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
      const covered = this.countLabel(count);
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
    this.stopRun();
  },

  methods: {
    reset() {
      this.phase = 'choose';
      this.view = 'main';
      this.walletFilter = '';
      this.walletResults = [];
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
      this.stopRun();
      this.phase = 'choose';
      this.view = 'main';
    },

    /** Stop a report that is taking longer than the user wants to wait. */
    cancel() {
      this.stopRun();
      this.phase = 'choose';
      this.progress = null;
    },

    /**
     * Abort the run in flight, if there is one.
     *
     * The run's own `finally` is what restores the wallet connection, and it
     * cannot do that until the awaits it is sitting on unwind. So this only
     * signals; it never restores here and never clears `this.run`, because
     * doing either would take the state away from the code that still has to
     * clean up with it.
     */
    async stopRun() {
      const run = this.run;
      if (!run) return;
      run.controller.abort();
      // Wait for its `finally` to restore the connection, so the next report
      // never starts opening wallets while this one is still putting one back.
      await run.settled.catch(() => {});
    },

    tallyLabel(r) {
      if (r.status === 'failed') return this.$t('Could not be read');
      if (r.status === 'skipped') return this.$t('Not read');
      return this.countLabel(r.count);
    },

    /** vue-i18n runs in legacy mode here, so the singular is its own key. */
    countLabel(n) {
      return n === 1 ? this.$t('1 transaction') : this.$t('{n} transactions', { n });
    },

    missingRatesNote(n) {
      if (!n) return '';
      return n === 1
        ? this.$t('One transaction has no recorded exchange rate, so no value is stated for it.')
        : this.$t('{n} transactions have no recorded exchange rate, so no value is stated for them.', { n });
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
      const shown = this.filteredWallets.map((w) => w.id);
      if (this.allSelected) {
        this.selectedWallets = this.selectedWallets.filter((id) => !shown.includes(id));
        return;
      }
      const merged = new Set(this.selectedWallets);
      for (const id of shown) merged.add(id);
      this.selectedWallets = [...merged];
    },

    async create() {
      if (!this.canCreate) return;
      // Claim the working phase before the first await. `canCreate` requires
      // the choose phase, so this is what stops a second tap during the wait
      // below from starting a run of its own.
      this.phase = 'working';

      // Never two reports at once. They would fight over the same single live
      // wallet connection, and each one's cleanup would put back a wallet the
      // other had just opened.
      await this.stopRun();

      const run = {
        controller: new AbortController(),
        // The app keeps one wallet live at a time, so a report covering
        // several has to open them itself. The connector does that in the
        // order the report reads them and puts the user's own connection back
        // afterwards.
        connector: createReportConnector(this.walletStore),
      };
      run.settled = this.runReport(run);
      this.run = run;
      await run.settled;
    },

    /**
     * One report, start to finish.
     *
     * Every piece of per-run state is an argument or a local. Reading
     * `this.controller` back after an await was how a cancelled run went on to
     * write a file, and how one run's cleanup reached into another's: by the
     * time the await resolved, the field no longer held the run that started.
     */
    async runReport({ controller, connector }) {
      const { signal } = controller;
      this.phase = 'working';
      this.error = '';
      this.progress = null;

      try {
        const period = this.periods.find((p) => p.id === this.periodId) || {};
        const chosen = connector.order(
          this.wallets.filter((w) => this.selectedWallets.includes(w.id)),
        );

        const report = await buildReport({
          wallets: chosen,
          providers: this.walletStore.providers || {},
          connect: (w) => connector.connect(w),
          normalize: (raw, ctx) => normalizeTx(raw, ctx),
          snapshotFor: (txId, walletId) =>
            this.metadataStore.getFiatAtSettlementForTransaction(txId, walletId),
          currency: this.currency,
          period: { fromMs: period.fromMs ?? null, toMs: period.toMs ?? null },
          locale: this.$i18n?.locale,
          onProgress: (p) => { if (!signal.aborted) this.progress = p; },
          signal,
        });

        // A cancelled read RESOLVES rather than throwing (the wallets it never
        // reached come back marked skipped), so this is the path a cancelled
        // report actually takes. Producing a file here would hand someone a
        // partial record they had just asked us not to make.
        if (signal.aborted) return;

        const out = await exportReport(report, this.format);

        this.walletResults = report.walletResults || [];
        this.warnings = [
          report.meta.failedNote,
          report.meta.truncatedNote,
          this.missingRatesNote(report.summary.missingRates),
        ].filter(Boolean);

        this.result = { ...out, count: report.summary.count };
        this.phase = 'done';
      } catch (err) {
        if (signal.aborted) return;
        this.error = err?.message
          ? this.$t("The report couldn't be created: {msg}", { msg: err.message })
          : this.$t("The report couldn't be created. Try again.");
        this.phase = 'choose';
      } finally {
        // Whether it worked, failed or was cancelled: the wallet the user was
        // on is the wallet they get back.
        await connector.restore();
        // Only if this run is still the current one. A later run owns the slot
        // now and is entitled to finish.
        if (this.run?.controller === controller) this.run = null;
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

.sheet-header { display: flex; align-items: center; padding: 6px 16px 10px; gap: 8px; flex-shrink: 0; }
.sheet-title { flex: 1 1 auto; text-align: center; font-family: 'Manrope', sans-serif; font-size: 16px; font-weight: 600; letter-spacing: -0.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sheet-back-btn { flex: 0 0 auto; }
/* Mirrors the back button's width so the centered title stays optically
   centered (HIG: balance the nav bar's leading and trailing slots). */
.sheet-header-spacer { flex: 0 0 auto; width: 40px; }

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

/* The wallet list is the one view that wants the whole sheet: a list that
   ends halfway up the screen reads as a short list rather than a scrollable
   one. */
.tr-sheet--tall { height: 92vh; height: 92dvh; }

/* A filter, once the list stops fitting. */
.finder {
  display: flex; align-items: center; gap: 8px;
  height: 40px; padding: 0 12px; border-radius: 12px;
}
.finder-light { background: rgba(15, 23, 42, 0.05); color: #64748b; }
.finder-dark { background: rgba(255, 255, 255, 0.06); color: #94a3b8; }
.finder-input {
  all: unset; flex: 1 1 auto; min-width: 0;
  font-family: 'Manrope', sans-serif; font-size: 14.5px; font-weight: 500;
}
.finder-clear {
  all: unset; display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 50%; cursor: pointer; flex-shrink: 0;
}

/* The count and Select all stay put while the list moves under them, so the
   way to tick everything is not somewhere above a fifteen-item scroll. */
.group-head--sticky {
  position: sticky; top: 0; z-index: 1;
  padding: 4px 0 8px; margin-bottom: -4px;
}
/* Must match the card exactly or the list shows through the gap. */
.sticky-light { background: var(--bg-card); }
.sticky-dark { background: #0C0C0C; }

/* The row that opens the list. */
.pick-more { flex-shrink: 0; opacity: 0.4; }

/* Determinate from the first frame. */
.stage--work { gap: 18px; width: 100%; }
.meter {
  width: 100%; max-width: 320px; height: 6px; border-radius: 999px; overflow: hidden;
}
.meter-light { background: rgba(15, 23, 42, 0.08); }
.meter-dark { background: rgba(255, 255, 255, 0.10); }
.meter-fill {
  display: block; height: 100%; border-radius: 999px; background: #15a35b;
  transition: width 240ms ease;
}
body.body--dark .meter-fill { background: #2bd17f; }
@media (prefers-reduced-motion: reduce) { .meter-fill { transition: none; } }

/* What each wallet gave. */
.tally { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 11px; }
.tally-light { background: rgba(15, 23, 42, 0.035); }
.tally-dark { background: rgba(255, 255, 255, 0.045); }
.tally-name {
  flex: 1 1 auto; min-width: 0; font-family: 'Manrope', sans-serif;
  font-size: 14px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tally-count { flex-shrink: 0; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 500; }
.tally-ok { flex-shrink: 0; color: #15a35b; }
body.body--dark .tally-ok { color: #2bd17f; }
.tally-warn { flex-shrink: 0; color: #b45309; }
body.body--dark .tally-warn { color: #fbbf24; }

/* Cancel: present and reachable, without competing with a primary action
   that is not on screen while it is. */
.primary-cta--quiet { font-weight: 600; }
.quiet-light { background: rgba(15, 23, 42, 0.06); color: #334155; }
.quiet-dark { background: rgba(255, 255, 255, 0.08); color: #e2e8f0; }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
