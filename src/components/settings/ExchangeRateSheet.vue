<!--
  ExchangeRateSheet: where BuhoGO gets Bitcoin prices, from Settings. One
  form sheet with two views:

    view 'list'   — mempool.space or your own server, as a list with a
                    check. A tap applies the choice; there is no Save. One
                    line says when prices last came in.
    view 'server' — the address of your own server. It is checked before
                    BuhoGO switches to it, and https:// and /api/v1 are
                    added when left out.

  UI only: the caller passes `checkServer` and stores the choice on `change`
  (an API URL, or null for the default).
-->
<template>
  <q-dialog :model-value="modelValue" position="bottom" @update:model-value="$emit('update:modelValue', $event)" @hide="onHide">
    <div class="iform-sheet exchange-rate-sheet" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <div class="iform-sheet-grab" aria-hidden="true"></div>

      <FormSheetStep
        v-if="view === 'list'"
        :title="$t('Exchange rates')"
        :subtitle="$t('Where BuhoGO gets Bitcoin prices.')"
        :skip-label="$t('Done')"
        :title-id="titleId"
        @skip="close"
      >
        <template #icon>
          <Icon icon="tabler:chart-line" width="26" height="26" />
        </template>

        <div class="iform-seclabel exchange-rate-sheet__label">{{ $t('Server') }}</div>
        <div class="iform-group" role="radiogroup" :aria-label="$t('Server')">
          <button type="button" role="radio" class="iform-line" :aria-checked="!savedUrl" @click="useDefault">
            <span class="iform-line-label">mempool.space<small>{{ $t('Default') }}</small></span>
            <Icon v-if="!savedUrl" icon="tabler:check" width="20" height="20" class="exchange-rate-sheet__check" />
          </button>
          <button type="button" role="radio" class="iform-line" :aria-checked="!!savedUrl" @click="openServer">
            <span class="iform-line-label">
              {{ $t('Your own server') }}
              <small>{{ savedUrl ? serverLabel : $t('A Mempool server you run or trust') }}</small>
            </span>
            <Icon v-if="savedUrl" icon="tabler:check" width="20" height="20" class="exchange-rate-sheet__check" />
            <Icon icon="tabler:chevron-right" width="18" height="18" class="iform-line-chevron" />
          </button>
        </div>
        <p class="iform-foot">{{ $t("If the server doesn't answer, BuhoGO asks a backup server.") }}</p>

        <div class="iform-group exchange-rate-sheet__status">
          <div class="iform-line">
            <span class="iform-line-label">{{ $t('Last updated') }}</span>
            <span class="iform-line-value">{{ updatedLabel }}</span>
          </div>
        </div>
      </FormSheetStep>

      <FormSheetStep
        v-else
        :title="$t('Your own server')"
        :subtitle="$t('Any Mempool server you run or trust.')"
        :badge="error ? 'warn' : ''"
        :title-id="titleId"
        back
        @back="view = 'list'"
      >
        <template #icon>
          <Icon icon="tabler:server" width="26" height="26" />
        </template>

        <div class="iform-group">
          <div class="iform-row">
            <label class="iform-label" :for="inputId">{{ $t('Server address') }}</label>
            <q-input
              ref="input"
              v-model="draft"
              :for="inputId"
              class="iform-input"
              borderless
              dense
              clearable
              placeholder="node.example.com"
              inputmode="url"
              autocapitalize="off"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
              :aria-invalid="!!error"
              :aria-describedby="error ? errorId : undefined"
              @keyup.enter="useServer"
            />
          </div>
        </div>
        <p v-if="error" :id="errorId" class="exchange-rate-sheet__error" role="alert">
          <Icon icon="tabler:alert-circle" width="16" height="16" class="exchange-rate-sheet__error-icon" />
          <span>{{ error }}</span>
        </p>
        <p v-else class="iform-foot">{{ $t('https:// and /api/v1 are added for you.') }}</p>

        <template #footer>
          <q-btn
            class="iform-connect full-width"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :loading="checking"
            :disable="!draft || !draft.trim() || checking"
            no-caps
            unelevated
            @click="useServer"
          >{{ error ? $t('Try again') : $t('Use this server') }}</q-btn>
        </template>
      </FormSheetStep>
    </div>
  </q-dialog>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';
import { MEMPOOL_DEFAULT_URL, normalizeMempoolUrl, mempoolServerLabel } from '../../utils/mempoolServer.js';

let uid = 0;

export default {
  name: 'ExchangeRateSheet',
  components: { FormSheetStep },
  props: {
    modelValue: { type: Boolean, default: false },
    /** The user's own server as an API URL, or null for the default. */
    savedUrl: { type: String, default: null },
    /** When prices last came in, or null when they have not yet. */
    lastUpdate: { type: Date, default: null },
    /** Resolves when a server answers with prices, throws when it does not. */
    checkServer: { type: Function, required: true },
  },
  emits: ['update:modelValue', 'change'],
  data() {
    uid += 1;
    return {
      view: 'list',
      draft: '',
      error: '',
      checking: false,
      now: Date.now(),
      clock: null,
      titleId: `exchange-rate-title-${uid}`,
      inputId: `exchange-rate-server-${uid}`,
      errorId: `exchange-rate-error-${uid}`,
    };
  },
  computed: {
    serverLabel() {
      return mempoolServerLabel(this.savedUrl);
    },
    updatedLabel() {
      if (!this.lastUpdate) return this.$t('Not yet');
      const mins = Math.floor((this.now - this.lastUpdate.getTime()) / 60000);
      if (mins < 1) return this.$t('Just now');
      if (mins < 60) return this.$t('{n} min ago', { n: mins });
      return this.$t('{n} h ago', { n: Math.floor(mins / 60) });
    },
  },
  watch: {
    // Keeps "2 min ago" true while the sheet is open.
    modelValue: {
      immediate: true,
      handler(open) {
        clearInterval(this.clock);
        this.clock = null;
        if (!open) return;
        this.now = Date.now();
        this.clock = setInterval(() => { this.now = Date.now(); }, 30000);
      },
    },
    draft() {
      this.error = '';
    },
  },
  beforeUnmount() {
    clearInterval(this.clock);
  },
  methods: {
    close() {
      this.$emit('update:modelValue', false);
    },
    onHide() {
      this.view = 'list';
      this.error = '';
      this.checking = false;
    },
    useDefault() {
      if (this.savedUrl) this.$emit('change', null);
    },
    openServer() {
      this.draft = this.savedUrl ? this.serverLabel : '';
      this.error = '';
      this.view = 'server';
      this.$nextTick(() => this.$refs.input?.focus());
    },
    async useServer() {
      if (this.checking || !this.draft || !this.draft.trim()) return;
      const url = normalizeMempoolUrl(this.draft);
      if (!url) {
        this.error = this.$t("That doesn't look like a server address.");
        return;
      }
      if (url === MEMPOOL_DEFAULT_URL) {
        this.useDefault();
        this.view = 'list';
        return;
      }
      this.checking = true;
      try {
        await this.checkServer(url);
        this.$emit('change', url);
        this.view = 'list';
      } catch (err) {
        console.warn('[exchange-rates] server check failed:', err?.message || err);
        this.error = this.$t("This server didn't answer. Check the address and try again.");
      } finally {
        this.checking = false;
      }
    },
  },
};
</script>

<style scoped>
/* Quasar only makes a dialog's direct child tappable: keep it a <div>. */
.exchange-rate-sheet {
  pointer-events: all;
  height: min(720px, calc(100dvh - var(--safe-top, 0px) - 10px));
}
.exchange-rate-sheet__label {
  margin: 0 4px 9px;
}
.exchange-rate-sheet__check {
  flex-shrink: 0;
  color: var(--brand-accent-text);
}
.exchange-rate-sheet__status {
  margin-top: 24px;
}
.exchange-rate-sheet__error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 10px 4px 0;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.45;
  color: #8A5A00;
}
body.body--dark .exchange-rate-sheet__error { color: #F5C451; }
.exchange-rate-sheet__error-icon {
  flex-shrink: 0;
  margin-top: 1px;
}
</style>
