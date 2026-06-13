<template>
  <div class="success-body">
    <div class="centered-stage">
      <div class="success-check" :class="{ 'success-check--animate': animate }">
        <Icon icon="tabler:circle-check-filled" width="48" height="48" />
      </div>
      <div class="centered-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
        {{ $t('Your eSIM is ready') }}
      </div>
      <div class="centered-sub" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
        {{ subtitle }}
      </div>
    </div>

    <!-- Primary path: one-tap install (platform universal link). Hidden when
         no install URL is available, in which case the QR leads. -->
    <button
      v-if="installUrl"
      type="button"
      class="primary-cta"
      :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
      @click="install"
    >
      <Icon icon="tabler:download" width="18" height="18" />
      <span>{{ $t('Install eSIM') }}</span>
    </button>

    <!-- Guaranteed fallback: QR + manual codes. Open by default when there is
         no one-tap install URL. -->
    <button
      type="button"
      class="disclosure-toggle"
      :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
      @click="showManual = !showManual"
    >
      <Icon :icon="showManual ? 'tabler:chevron-up' : 'tabler:chevron-down'" width="14" height="14" />
      <span>{{ installUrl ? $t('Other ways to install') : $t('Scan or enter manually') }}</span>
    </button>

    <div v-if="showManual" class="manual-block">
      <div v-if="lpa" class="qr-stage">
        <vue-qrcode :value="lpa" :options="qrOptions" class="qr-canvas" />
        <div class="qr-hint" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
          {{ $t('Scan this in Settings to add the data plan.') }}
        </div>
      </div>

      <div class="copy-rows">
        <div v-if="inst.smdpAddress" class="copy-row" :class="$q.dark.isActive ? 'copy-row-dark' : 'copy-row-light'">
          <div class="copy-row-meta">
            <span class="copy-row-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ $t('SM-DP+ address') }}</span>
            <span class="copy-row-value">{{ inst.smdpAddress }}</span>
          </div>
          <button type="button" class="copy-btn" :aria-label="$t('Copy')" @click="copy(inst.smdpAddress, 'smdp')">
            <Icon :icon="copied === 'smdp' ? 'tabler:check' : 'tabler:copy'" width="16" height="16" />
          </button>
        </div>
        <div v-if="inst.matchingId" class="copy-row" :class="$q.dark.isActive ? 'copy-row-dark' : 'copy-row-light'">
          <div class="copy-row-meta">
            <span class="copy-row-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ $t('Activation code') }}</span>
            <span class="copy-row-value">{{ inst.matchingId }}</span>
          </div>
          <button type="button" class="copy-btn" :aria-label="$t('Copy')" @click="copy(inst.matchingId, 'code')">
            <Icon :icon="copied === 'code' ? 'tabler:check' : 'tabler:copy'" width="16" height="16" />
          </button>
        </div>
        <div v-if="inst.manualCode && inst.manualCode !== inst.matchingId" class="copy-row" :class="$q.dark.isActive ? 'copy-row-dark' : 'copy-row-light'">
          <div class="copy-row-meta">
            <span class="copy-row-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ $t('Confirmation code') }}</span>
            <span class="copy-row-value">{{ inst.manualCode }}</span>
          </div>
          <button type="button" class="copy-btn" :aria-label="$t('Copy')" @click="copy(inst.manualCode, 'manual')">
            <Icon :icon="copied === 'manual' ? 'tabler:check' : 'tabler:copy'" width="16" height="16" />
          </button>
        </div>
      </div>

      <p class="install-note" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
        {{ $t('After installing, turn the line on in Settings, under Cellular or Mobile data.') }}
      </p>
    </div>

    <button type="button" class="done-link" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'" @click="$emit('done')">
      {{ $t('Done') }}
    </button>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { buildLpaString, esimInstallUrl, openEsimInstaller } from '../../services/nadanada/esimInstall.js';

/**
 * eSIM success body. Renders from a stored receipt so it works for both a
 * fresh purchase and a later review in "My purchases". Owns a single primary
 * action (one-tap install) with the QR + manual codes as the guaranteed
 * fallback path.
 */
export default {
  name: 'SuccessEsim',
  components: { Icon, VueQrcode },
  props: {
    receipt: { type: Object, required: true },
    // When false (review mode) the success animation does not replay.
    animate: { type: Boolean, default: true },
  },
  emits: ['done'],

  data() {
    return {
      showManual: false,
      copied: null,
      copiedTimer: null,
    };
  },

  created() {
    // Lead with the manual block when there is no one-tap install link.
    this.showManual = !this.installUrl;
  },

  beforeUnmount() {
    clearTimeout(this.copiedTimer);
  },

  computed: {
    inst() { return this.receipt?.installation || {}; },
    lpa() { return buildLpaString(this.inst); },
    installUrl() { return esimInstallUrl(this.inst); },
    subtitle() {
      const parts = [];
      const flagName = [this.receipt?.flag, this.receipt?.countryName].filter(Boolean).join(' ');
      if (flagName) parts.push(flagName);
      if (this.receipt?.planLabel) parts.push(this.receipt.planLabel);
      return parts.join(' · ');
    },
    qrOptions() {
      const dark = this.$q.dark.isActive;
      return {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 6,
        color: { dark: dark ? '#f8fafc' : '#0f172a', light: dark ? '#0b0f17' : '#ffffff' },
      };
    },
  },

  methods: {
    async install() {
      await openEsimInstaller(this.installUrl);
      // Reveal the fallback so the user has the QR if the OS sheet didn't open.
      this.showManual = true;
    },
    async copy(text, key) {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        this.copied = key;
        clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => { if (this.copied === key) this.copied = null; }, 1400);
      } catch { /* ignore */ }
    },
  },
};
</script>

<style scoped>
.success-body { display: flex; flex-direction: column; gap: 14px; }
.centered-stage { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 8px 4px; text-align: center; }
.centered-title { font-family: 'Manrope', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
.centered-sub { font-family: 'Manrope', sans-serif; font-size: 13.5px; font-weight: 500; }
.success-check { color: #15a35b; }
body.body--dark .success-check { color: #2bd17f; }
.success-check--animate { animation: pop 0.42s cubic-bezier(0.2, 0, 0, 1) both; }
@keyframes pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .success-check--animate { animation: none; } }

.primary-cta { width: 100%; height: 48px; border-radius: 16px; border: 0; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: filter 0.18s ease, transform 0.1s ease; }
.primary-cta:active { transform: scale(0.98); }

.disclosure-toggle { all: unset; display: inline-flex; align-items: center; gap: 6px; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 600; cursor: pointer; align-self: center; -webkit-tap-highlight-color: transparent; }

.manual-block { display: flex; flex-direction: column; gap: 12px; }
.qr-stage { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 6px 0; }
.qr-canvas { width: min(100%, 220px) !important; height: auto !important; border-radius: 12px; }
.qr-hint { font-family: 'Manrope', sans-serif; font-size: 12.5px; text-align: center; max-width: 260px; }

.copy-rows { display: flex; flex-direction: column; gap: 8px; }
.copy-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; }
.copy-row-light { background: rgba(15, 23, 42, 0.05); }
.copy-row-dark { background: rgba(255, 255, 255, 0.06); }
.copy-row-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.copy-row-label { font-family: 'Manrope', sans-serif; font-size: 11.5px; font-weight: 600; }
.copy-row-value { font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.copy-btn { border: 0; background: transparent; cursor: pointer; padding: 6px; border-radius: 8px; display: inline-flex; color: inherit; -webkit-tap-highlight-color: transparent; flex-shrink: 0; }

.install-note { font-family: 'Manrope', sans-serif; font-size: 12.5px; line-height: 1.45; margin: 0; text-align: center; }
.done-link { all: unset; align-self: center; padding: 6px 12px; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
