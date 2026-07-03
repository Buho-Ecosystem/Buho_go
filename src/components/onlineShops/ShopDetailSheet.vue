<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="shop-detail" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ $t('Shop details') }}</div>
        <q-btn flat round dense :aria-label="$t('Close')" class="sheet-close-btn" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div v-if="shop" class="detail-body">
        <div class="detail-head">
          <ShopAvatar :shop="shop" :size="56" remote />
          <div class="detail-head-text">
            <div class="detail-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ shop.name }}
              <Icon v-if="shop.verified" icon="tabler:rosette-discount-check-filled" width="16" height="16" class="detail-verified" />
            </div>
            <div class="detail-meta" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
              <span v-if="shop.country" class="detail-flag">
                <Icon v-if="flagIcon(shop.country.code)" :icon="flagIcon(shop.country.code)" width="16" height="16" />
                <Icon v-else icon="tabler:world" width="14" height="14" />
                <span>{{ shop.country.code === 'WW' ? $t('Worldwide') : shop.country.name }}</span>
              </span>
              <span v-if="shop.payments && shop.payments.lightning" class="detail-badge"><Icon icon="tabler:bolt" width="13" height="13" /> {{ $t('Lightning') }}</span>
              <span v-if="shop.payments && shop.payments.onchain" class="detail-badge"><Icon icon="tabler:currency-bitcoin" width="13" height="13" /> {{ $t('On-chain') }}</span>
            </div>
          </div>
        </div>

        <p v-if="shop.description" class="detail-desc" :class="$q.dark.isActive ? 'text-grey-3' : 'text-grey-8'">{{ shop.description }}</p>

        <!-- Always show where a tap leads before any tap. -->
        <div v-if="shop.host" class="detail-host" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
          <Icon icon="tabler:external-link" width="14" height="14" />
          <span>{{ shop.host }}</span>
        </div>
        <div v-else-if="isNostr" class="detail-host" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
          <Icon icon="tabler:bolt" width="14" height="14" />
          <span>{{ $t('Nostr market') }}</span>
        </div>

        <!-- Actions -->
        <div class="detail-actions">
          <!-- Nostr seller: there is no in-app checkout, so lead to the seller's
               market to browse + order, with an honest optional tip. -->
          <template v-if="isNostr">
            <button type="button" class="primary-cta" :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'" :disabled="!visitTarget" @click="visit">
              <span>{{ $t('Visit shop') }}</span>
              <Icon icon="tabler:external-link" width="18" height="18" />
            </button>
            <p class="detail-pay-note" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t("Browse and order on the seller's Nostr market.") }}</p>
            <button v-if="shop.lnAddress" type="button" class="secondary-cta" :class="$q.dark.isActive ? 'secondary-cta-dark' : 'secondary-cta-light'" @click="sendToLn">
              <Icon icon="tabler:bolt" width="16" height="16" />
              <span>{{ $t('Tip the seller') }}</span>
            </button>
          </template>
          <!-- A directory shop that carries a Lightning address: pay it directly. -->
          <template v-else-if="shop.lnAddress">
            <button type="button" class="primary-cta" :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'" @click="sendToLn">
              <Icon icon="tabler:bolt" width="18" height="18" />
              <span>{{ $t('Pay with BuhoGO') }}</span>
            </button>
            <button v-if="shop.website" type="button" class="secondary-cta" :class="$q.dark.isActive ? 'secondary-cta-dark' : 'secondary-cta-light'" @click="visit">
              <span>{{ $t('Visit shop') }}</span>
              <Icon icon="tabler:external-link" width="16" height="16" />
            </button>
          </template>
          <!-- Plain website shop: visit and pay at their checkout. -->
          <template v-else>
            <button type="button" class="primary-cta" :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'" :disabled="!shop.website" @click="visit">
              <span>{{ $t('Visit shop') }}</span>
              <Icon icon="tabler:external-link" width="18" height="18" />
            </button>
            <p class="detail-pay-note" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t('Pay in Bitcoin at their checkout.') }}</p>
          </template>
        </div>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import ShopAvatar from './ShopAvatar.vue';
import { useWalletStore } from '../../stores/wallet';
import { openInAppBrowser } from '../../utils/inAppBrowser.js';
import { flagIcon as resolveFlagIcon } from '../../services/onlineShops/flags.js';

/**
 * Consent + action surface for a shop. Primary action depends on the data:
 * a known Lightning address (Nostr merchant) gets "Pay with BuhoGO" (hands the
 * destination to the wallet's send flow via the pendingDeepLink contract);
 * otherwise "Visit shop" opens the website in the in-app browser to pay at the
 * shop's own checkout. The destination host is always shown before any tap.
 */
export default {
  name: 'ShopDetailSheet',
  components: { Icon, ShopAvatar },
  props: {
    modelValue: { type: Boolean, default: false },
    shop: { type: Object, default: null },
  },
  emits: ['update:modelValue'],
  setup() {
    const walletStore = useWalletStore();
    return { walletStore };
  },
  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },
    isNostr() { return this.shop?.source === 'nostr'; },
    // What "Visit shop" opens: the seller's own site if any, else (for Nostr)
    // their market page where products + ordering live.
    visitTarget() { return this.shop?.website || this.shop?.marketUrl || ''; },
  },
  methods: {
    flagIcon(code) { return resolveFlagIcon(code); },
    visit() {
      if (this.visitTarget) openInAppBrowser(this.visitTarget);
    },
    sendToLn() {
      if (!this.shop?.lnAddress) return;
      // Hand the destination to the wallet via the buffered deep-link the
      // Wallet view drains on mount (its immediate watcher opens Send +
      // PaymentConfirmSheet pre-filled). The store field is the contract.
      // For a Nostr seller this is framed as an optional tip; for a directory
      // shop that carries an address it is a direct payment.
      this.walletStore.pendingDeepLink = { type: 'lightning_address', data: this.shop.lnAddress };
      this.open = false;
      this.$router.push('/wallet');
    },
  },
};
</script>

<style scoped>
.shop-detail { width: 100%; max-width: 520px; border-top-left-radius: 22px; border-top-right-radius: 22px; overflow: hidden; padding-bottom: max(16px, env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; max-height: 90vh; max-height: 90dvh; }
.sheet-handle { display: flex; justify-content: center; padding: 8px 0 4px; flex-shrink: 0; }
.sheet-handle-bar-light, .sheet-handle-bar-dark { width: 36px; height: 4px; border-radius: 999px; display: block; }
.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark { background: rgba(255, 255, 255, 0.22); }
.sheet-header { display: flex; align-items: center; padding: 4px 18px 8px; gap: 8px; flex-shrink: 0; }
.sheet-title { flex: 1 1 auto; font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 600; letter-spacing: -0.005em; }
.sheet-close-btn { flex: 0 0 auto; }

.detail-body { display: flex; flex-direction: column; gap: 14px; padding: 6px 18px 18px; overflow-y: auto; }
.detail-head { display: flex; align-items: center; gap: 14px; }
.detail-head-text { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.detail-name { font-family: 'Manrope', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; display: flex; align-items: center; gap: 6px; }
.detail-verified { color: #15a35b; }
body.body--dark .detail-verified { color: #2bd17f; }
.detail-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 500; }
.detail-flag { display: inline-flex; align-items: center; gap: 5px; }
.detail-badge { display: inline-flex; align-items: center; gap: 4px; }
.detail-desc { font-family: 'Manrope', sans-serif; font-size: 14px; line-height: 1.5; margin: 0; }
.detail-host { display: inline-flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace; font-size: 12.5px; }

.detail-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 2px; }
.primary-cta { width: 100%; height: 48px; border-radius: 16px; border: 0; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: filter 0.18s ease, transform 0.1s ease, opacity 0.18s ease; }
.primary-cta:disabled { opacity: 0.45; cursor: default; }
.primary-cta:not(:disabled):active { transform: scale(0.98); }
.secondary-cta { width: 100%; height: 46px; border-radius: 16px; border: 0; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Manrope', sans-serif; font-size: 14.5px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.secondary-cta-light { background: rgba(15, 23, 42, 0.05); color: #0f172a; }
.secondary-cta-dark { background: rgba(255, 255, 255, 0.06); color: #f8fafc; }
.secondary-cta:active { transform: scale(0.98); }
.detail-pay-note { font-family: 'Manrope', sans-serif; font-size: 12.5px; text-align: center; margin: 0; }

.item-label-light { color: #0f172a; }
.item-label-dark { color: #f8fafc; }
</style>
