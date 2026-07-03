<template>
  <div class="success-body">
    <div class="centered-stage">
      <div class="success-check" :class="{ 'success-check--animate': animate }">
        <Icon icon="tabler:circle-check-filled" width="48" height="48" />
      </div>
      <div class="centered-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
        {{ $t('Your VPN is ready') }}
      </div>
      <div class="centered-sub" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
        {{ subtitle }}
      </div>
    </div>

    <!-- QR first: the canonical WireGuard onboarding path. -->
    <div class="qr-stage">
      <vue-qrcode v-if="receipt.config" :value="receipt.config" :options="qrOptions" class="qr-canvas" />
      <div class="qr-hint" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
        {{ $t('In the WireGuard app, tap + then Create from QR code.') }}
      </div>
    </div>

    <div class="key-warning" :class="$q.dark.isActive ? 'key-warning-dark' : 'key-warning-light'">
      <Icon icon="tabler:lock" width="14" height="14" />
      <span>{{ $t('This contains your private key. Do not share or screenshot it publicly.') }}</span>
    </div>

    <!-- One primary action: hand the .conf to the WireGuard app. -->
    <button
      type="button"
      class="primary-cta"
      :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
      @click="openInWireGuard"
    >
      <Icon icon="tabler:share-2" width="18" height="18" />
      <span>{{ $t('Open in WireGuard') }}</span>
    </button>

    <button
      type="button"
      class="disclosure-toggle"
      :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
      @click="showAdvanced = !showAdvanced"
    >
      <Icon :icon="showAdvanced ? 'tabler:chevron-up' : 'tabler:chevron-down'" width="14" height="14" />
      <span>{{ $t('Advanced') }}</span>
    </button>

    <div v-if="showAdvanced" class="advanced-block">
      <button type="button" class="ghost-row" :class="$q.dark.isActive ? 'ghost-row-dark' : 'ghost-row-light'" @click="download">
        <Icon icon="tabler:download" width="16" height="16" />
        <span>{{ saved ? $t('Saved') : $t('Save .conf file') }}</span>
      </button>
      <button type="button" class="ghost-row" :class="$q.dark.isActive ? 'ghost-row-dark' : 'ghost-row-light'" @click="copyConfig">
        <Icon :icon="copied ? 'tabler:check' : 'tabler:copy'" width="16" height="16" />
        <span>{{ copied ? $t('Copied') : $t('Copy config text') }}</span>
      </button>
      <button type="button" class="ghost-row" :class="$q.dark.isActive ? 'ghost-row-dark' : 'ghost-row-light'" @click="getApp">
        <Icon icon="tabler:external-link" width="16" height="16" />
        <span>{{ $t('Get the WireGuard app') }}</span>
      </button>
    </div>

    <button type="button" class="done-link" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'" @click="$emit('done')">
      {{ $t('Done') }}
    </button>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { Capacitor } from '@capacitor/core';
import { shareWireGuardConfig, downloadWireGuardConfig } from '../../services/nadanada/wgShare.js';
import { openInAppBrowser } from '../../utils/inAppBrowser.js';

const WIREGUARD_IOS = 'https://apps.apple.com/app/wireguard/id1441195209';
const WIREGUARD_ANDROID = 'https://play.google.com/store/apps/details?id=com.wireguard.android';

/**
 * VPN success body. QR-first (the reliable WireGuard import path), with the
 * native share sheet as the same-device handoff and an Advanced disclosure
 * for save / copy / get-the-app. Renders from a stored receipt so it doubles
 * as the "My purchases" detail view.
 */
export default {
  name: 'SuccessVpn',
  components: { Icon, VueQrcode },
  props: {
    receipt: { type: Object, required: true },
    animate: { type: Boolean, default: true },
  },
  emits: ['done'],

  data() {
    return { showAdvanced: false, copied: false, saved: false, copiedTimer: null, savedTimer: null };
  },

  beforeUnmount() {
    clearTimeout(this.copiedTimer);
    clearTimeout(this.savedTimer);
  },

  computed: {
    subtitle() {
      const parts = [];
      const flagName = [this.receipt?.flag, this.receipt?.countryName].filter(Boolean).join(' ');
      if (flagName) parts.push(flagName);
      if (this.receipt?.durationLabel) parts.push(this.receipt.durationLabel);
      return parts.join(' · ');
    },
    label() {
      return `buho ${this.receipt?.countryName || 'vpn'}`;
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
    async openInWireGuard() {
      const res = await shareWireGuardConfig({ config: this.receipt.config, label: this.label });
      // On web (or share unsupported) fall back to a file download.
      if (!res?.success && res?.reason === 'unsupported') this.download();
    },
    download() {
      const ok = downloadWireGuardConfig({ config: this.receipt.config, label: this.label });
      if (ok) {
        this.saved = true;
        clearTimeout(this.savedTimer);
        this.savedTimer = setTimeout(() => { this.saved = false; }, 1600);
      }
    },
    async copyConfig() {
      try {
        await navigator.clipboard.writeText(this.receipt.config);
        this.copied = true;
        clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => { this.copied = false; }, 1400);
      } catch { /* ignore */ }
    },
    getApp() {
      const platform = (Capacitor.getPlatform && Capacitor.getPlatform()) || 'web';
      const url = platform === 'android' ? WIREGUARD_ANDROID : WIREGUARD_IOS;
      openInAppBrowser(url);
    },
  },
};
</script>

<style scoped>
.success-body { display: flex; flex-direction: column; gap: 12px; }
.centered-stage { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 8px 2px; text-align: center; }
.centered-title { font-family: 'Manrope', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
.centered-sub { font-family: 'Manrope', sans-serif; font-size: 13.5px; font-weight: 500; }
.success-check { color: #15a35b; }
body.body--dark .success-check { color: #2bd17f; }
.success-check--animate { animation: pop 0.42s cubic-bezier(0.2, 0, 0, 1) both; }
@keyframes pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .success-check--animate { animation: none; } }

.qr-stage { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 2px 0; }
.qr-canvas { width: min(100%, 230px) !important; height: auto !important; border-radius: 12px; }
.qr-hint { font-family: 'Manrope', sans-serif; font-size: 12.5px; text-align: center; max-width: 280px; }

.key-warning { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 10px; font-family: 'Manrope', sans-serif; font-size: 12px; line-height: 1.35; }
.key-warning-light { background: rgba(245, 158, 11, 0.10); color: #b45309; }
.key-warning-dark { background: rgba(245, 158, 11, 0.14); color: #fbbf24; }

.primary-cta { width: 100%; height: 48px; border-radius: 16px; border: 0; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: filter 0.18s ease, transform 0.1s ease; }
.primary-cta:active { transform: scale(0.98); }

.disclosure-toggle { all: unset; display: inline-flex; align-items: center; gap: 6px; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 600; cursor: pointer; align-self: center; -webkit-tap-highlight-color: transparent; }

.advanced-block { display: flex; flex-direction: column; gap: 8px; }
.ghost-row { display: flex; align-items: center; gap: 10px; padding: 12px; border: 0; border-radius: 12px; font-family: 'Manrope', sans-serif; font-size: 13.5px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: left; }
.ghost-row-light { background: rgba(15, 23, 42, 0.05); color: #0f172a; }
.ghost-row-dark { background: rgba(255, 255, 255, 0.06); color: #f8fafc; }

.done-link { all: unset; align-self: center; padding: 6px 12px; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
