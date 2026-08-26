<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card class="mp-sheet shop-surface" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <div class="sheet-header">
        <q-btn
          v-if="detail"
          flat round dense
          :aria-label="$t('Back')"
          class="sheet-close-btn"
          :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          @click="detail = null"
        >
          <Icon icon="tabler:chevron-left" width="20" height="20" />
        </q-btn>
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ detail ? detailTitle : $t('Your products') }}
        </div>
        <q-btn flat round dense :aria-label="$t('Close')" class="sheet-close-btn" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-scroll">
        <!-- ─────────── DETAIL ─────────── -->
        <div v-if="detail" class="step-body">
          <SuccessEsim v-if="detail.kind === ORDER_KIND.ESIM" :receipt="detail" :animate="false" @done="detail = null" />
          <SuccessVpn v-else :receipt="detail" :animate="false" @done="detail = null" />

          <ReceiptRow :order="detail" expanded />

          <button
            v-if="!confirmRemove"
            type="button"
            class="remove-link"
            @click="confirmRemove = true"
          >
            <Icon icon="tabler:trash" width="14" height="14" />
            <span>{{ $t('Remove from this list') }}</span>
          </button>
          <div v-else class="confirm-remove" :class="$q.dark.isActive ? 'confirm-remove-dark' : 'confirm-remove-light'">
            <p class="confirm-text">
              {{ detail.kind === ORDER_KIND.ESIM
                ? $t('Removing this deletes your install code from this phone. The eSIM itself keeps working if you already installed it.')
                : $t('Removing this deletes the config and its private key from this phone. There is no copy anywhere else.') }}
            </p>
            <div class="confirm-actions">
              <button type="button" class="confirm-btn confirm-btn--ghost" @click="confirmRemove = false">{{ $t('Keep it') }}</button>
              <button type="button" class="confirm-btn confirm-btn--danger" @click="removeCurrent">{{ $t('Remove') }}</button>
            </div>
          </div>
        </div>

        <!-- ─────────── LIST ─────────── -->
        <div v-else class="step-body">
          <!-- Anything still owed to the user comes first and is never hidden
               behind a filter. -->
          <section v-if="store.attentionOrders.length" class="block">
            <div class="block-head">
              <div class="block-title block-title--alert">{{ $t('Needs your attention') }}</div>
              <ShopInfoTooltip
                tone="toolbox"
                trigger-icon="tabler:tools"
                icon="tabler:tools"
                :aria-label="$t('Why is an order here')"
                :title="$t('Why an order lands here')"
                :lede="$t('You paid, and the product has not arrived yet.')"
                :steps="attentionHelpSteps"
              />
            </div>

            <div
              v-for="o in store.attentionOrders"
              :key="o.id"
              class="issue"
              :class="$q.dark.isActive ? 'issue-dark' : 'issue-light'"
            >
              <div class="issue-top">
                <Icon
                  :icon="o.state === ORDER_STATE.FAILED ? 'tabler:alert-triangle' : 'tabler:clock-exclamation'"
                  width="17" height="17"
                  :class="o.state === ORDER_STATE.FAILED ? 'issue-icon--fail' : 'issue-icon--wait'"
                />
                <span class="issue-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ o.title || $t('Order') }}</span>
              </div>
              <div class="issue-sub" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
                {{ issueSubtitle(o) }}
              </div>

              <ReceiptRow :order="o" />

              <button
                v-if="canCheck(o)"
                type="button"
                class="issue-cta"
                :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
                :disabled="checkingId === o.id"
                @click="checkNow(o)"
              >
                <q-spinner v-if="checkingId === o.id" size="16px" />
                <Icon v-else icon="tabler:refresh" width="16" height="16" />
                <span>{{ checkingId === o.id ? $t('Checking…') : $t('Check now') }}</span>
              </button>
            </div>
          </section>

          <!-- Delivered products -->
          <section v-if="store.esims.length || store.vpns.length" class="block">
            <div class="mp-tabs" :class="$q.dark.isActive ? 'mp-tabs-dark' : 'mp-tabs-light'" role="tablist">
              <button
                v-for="t in tabs"
                :key="t.key"
                type="button"
                role="tab"
                :aria-selected="tab === t.key ? 'true' : 'false'"
                class="mp-tab"
                :class="{ 'mp-tab--active': tab === t.key }"
                @click="tab = t.key"
              >
                {{ t.label }}<span v-if="t.count" class="mp-tab-count">{{ t.count }}</span>
              </button>
            </div>

            <div v-if="visibleProducts.length" class="cards">
              <ProductCard
                v-for="o in visibleProducts"
                :key="o.id"
                :order="o"
                :derived="derivedFor(o)"
                @open="openDetail"
                @extend="onExtend"
              />
            </div>
            <div v-else class="info-state" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              <span>{{ tab === 'active' ? $t('Nothing active right now.') : $t('Nothing here yet.') }}</span>
            </div>

            <div v-if="refreshing" class="refresh-note" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'" aria-live="polite">
              <q-spinner size="12px" />
              <span>{{ $t('Updating…') }}</span>
            </div>
          </section>

          <!-- First-time empty state -->
          <div v-if="!store.hasAnything" class="info-state info-state--empty" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            <Icon icon="tabler:basket" width="24" height="24" />
            <span>{{ $t('Nothing here yet. Anything you buy shows up here, with its install code and its receipt.') }}</span>
            <button
              type="button"
              class="empty-cta"
              :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
              @click="open = false"
            >
              {{ $t('Browse the shop') }}
            </button>
          </div>

          <!-- Recovery for purchases made before the order ledger existed.
               Low-key on purpose: most people never need it, but the ones who
               do have no other way back to their money. -->
          <button
            type="button"
            class="recover-link"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            @click="$emit('recover')"
          >
            <Icon icon="tabler:history" width="15" height="15" />
            <span>{{ $t('Paid for something that is not here?') }}</span>
          </button>
        </div>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useNadanadaOrdersStore } from '../../stores/nadanadaOrders';
import {
  redeemOrder, isRedeemable, isUnconfirmed, ORDER_KIND, ORDER_STATE,
} from '../../services/nadanada/orders.js';
import { fetchEsimStatus, deriveEsimState } from '../../services/nadanada/esim.js';
import { fetchVpnStatus, deriveVpnState } from '../../services/nadanada/vpn.js';
import SuccessEsim from './SuccessEsim.vue';
import SuccessVpn from './SuccessVpn.vue';
import ShopInfoTooltip from './ShopInfoTooltip.vue';
import ReceiptRow from './ReceiptRow.vue';
import ProductCard from './ProductCard.vue';

/** Don't re-ask the provider for a status we fetched moments ago. */
const STATUS_TTL_MS = 60000;

/** An ended product's numbers no longer change, so re-check it rarely. */
const ENDED_TTL_MS = 24 * 60 * 60 * 1000;

/** A manual "Check now" is bounded so the button can never spin indefinitely.
 *  The order stays on disk either way, so giving up early costs nothing. */
const CHECK_NOW_MS = 25000;

/**
 * "Your products" — the durable retrieval surface for everything bought from
 * the shop.
 *
 * It shows two different things in one place on purpose:
 *   1. orders that are paid but undelivered, pinned at the top and never
 *      filtered away, each with its receipt and a Check now button;
 *   2. delivered eSIMs and VPNs with their live window and usage.
 *
 * Splitting those into separate screens is what let a stuck purchase become
 * invisible. Here, a user who paid always has somewhere to go.
 */
export default {
  name: 'MyProducts',
  components: { Icon, SuccessEsim, SuccessVpn, ShopInfoTooltip, ReceiptRow, ProductCard },
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'topup', 'extend', 'recover'],

  setup() {
    const store = useNadanadaOrdersStore();
    return { store, ORDER_KIND, ORDER_STATE };
  },

  data() {
    return {
      detail: null,
      detailId: null,
      confirmRemove: false,
      tab: 'active',
      checkingId: null,
      refreshing: false,
      refreshController: null,
      checkController: null,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    products() {
      return [...this.store.esims, ...this.store.vpns]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },

    activeProducts() {
      return this.products.filter((o) => {
        const d = this.derivedFor(o);
        // With no live answer we cannot claim a product has ended, so it stays
        // in Active where the user can still reach its codes.
        return !d || d.state === 'active' || d.state === 'upcoming' || d.state === 'unknown';
      });
    },

    endedProducts() {
      return this.products.filter((o) => {
        const d = this.derivedFor(o);
        return d && (d.state === 'expired' || d.state === 'disabled');
      });
    },

    tabs() {
      return [
        { key: 'active', label: this.$t('Active'), count: this.activeProducts.length },
        { key: 'ended', label: this.$t('Ended'), count: this.endedProducts.length },
        { key: 'all', label: this.$t('All'), count: this.products.length },
      ];
    },

    visibleProducts() {
      if (this.tab === 'ended') return this.endedProducts;
      if (this.tab === 'all') return this.products;
      return this.activeProducts;
    },

    detailTitle() {
      return this.detail?.kind === ORDER_KIND.ESIM ? this.$t('Your eSIM') : this.$t('Your VPN');
    },

    attentionHelpSteps() {
      return [
        this.$t('Tap Check now. Most orders land within a minute or two.'),
        this.$t('Nothing is lost while it waits here. Your receipt stays with the order.'),
        this.$t('If it stays stuck, copy the receipt and send it to info{\'@\'}nadanada.me.'),
      ];
    },
  },

  watch: {
    // Keep the open detail view in step with the ledger, so a top-up or a
    // status refresh is reflected without closing and reopening it.
    'store.orders': {
      deep: true,
      handler() {
        if (this.detailId) {
          const fresh = this.store.orderById(this.detailId);
          if (fresh) this.detail = fresh;
        }
      },
    },
  },

  beforeUnmount() {
    this.refreshController?.abort();
    this.checkController?.abort();
  },

  methods: {
    onHide() {
      this.detail = null;
      this.detailId = null;
      // Stop talking to the provider for a sheet nobody is looking at.
      this.refreshController?.abort();
      this.checkController?.abort();
    },

    onShow() {
      this.detail = null;
      this.detailId = null;
      this.confirmRemove = false;
      this.tab = 'active';
      // Unpaid orders whose invoice has lapsed took no money and can never
      // take any, so they stop being something the user has to look at.
      this.store.pruneSettledUnpaid();
      this.refreshAll();
    },

    /** Called by the shop once a recovered order has landed in the ledger.
     *  Show it straight away when the provider handed it over on the spot. */
    showRestored(order) {
      if (order?.state === ORDER_STATE.FULFILLED) this.openDetail(order);
    },

    openDetail(order) {
      this.detailId = order.id;
      this.detail = this.store.orderById(order.id) || order;
      this.confirmRemove = false;
    },

    onExtend(order) {
      this.$emit(order.kind === ORDER_KIND.ESIM ? 'topup' : 'extend', order);
    },

    removeCurrent() {
      if (!this.detail) return;
      this.store.removeOrder(this.detail.id);
      this.detail = null;
      this.detailId = null;
      this.confirmRemove = false;
    },

    /** Cached live state for a product, or null when we have never reached the
     *  provider for it. Null is meaningful: the card then shows no status
     *  rather than inventing one. */
    derivedFor(order) {
      if (!order?.live) return null;
      return order.kind === ORDER_KIND.ESIM
        ? deriveEsimState(order.live)
        : deriveVpnState(order.live);
    },

    /** Whether asking the provider again could still change this order. */
    canCheck(order) {
      return isRedeemable(order);
    },

    issueSubtitle(order) {
      if (order.state === ORDER_STATE.FAILED) {
        return order.lastError || this.$t('The provider could not complete this order.');
      }
      // The wallet reported an error on this one, so we genuinely do not know
      // whether the sats left. Say exactly that instead of implying either.
      if (isUnconfirmed(order)) {
        return this.$t("Your wallet reported a problem, so we don't know if the sats went out. Checking is free.");
      }
      const paid = order.paidAt
        ? this.$t('Paid {when}', { when: this.relativeTime(order.paidAt) })
        : this.$t('Paid');
      const amount = Number.isFinite(order.priceSats)
        ? `${this.formatSats(order.priceSats)} ${this.$t('sats')}`
        : '';
      return [paid, amount, this.$t('waiting for the provider')].filter(Boolean).join(' · ');
    },

    formatSats(n) {
      if (!Number.isFinite(n)) return '';
      try { return new Intl.NumberFormat(this.$i18n?.locale || undefined).format(n); }
      catch { return String(n); }
    },

    relativeTime(ts) {
      const diff = Date.now() - ts;
      const mins = Math.round(diff / 60000);
      if (mins < 1) return this.$t('just now');
      if (mins < 60) return this.$t('{n} min ago', { n: mins });
      const hours = Math.round(mins / 60);
      if (hours < 24) return this.$t('{n} h ago', { n: hours });
      const days = Math.round(hours / 24);
      return this.$t('{n} d ago', { n: days });
    },

    /** Retry one stuck order on demand. Redemption is idempotent server-side,
     *  so this is always safe to press. */
    async checkNow(order) {
      if (this.checkingId) return;
      this.checkingId = order.id;
      this.checkController?.abort();
      this.checkController = new AbortController();
      try {
        const res = await redeemOrder(order, {
          signal: this.checkController.signal,
          maxMs: CHECK_NOW_MS,
        });
        if (res.ok && res.patch) {
          this.store.patchOrder(order.id, res.patch);
          const fulfilled = this.store.orderById(order.id);
          if (fulfilled) this.openDetail(fulfilled);
        } else if (res.fatal) {
          if (res.patch) this.store.patchOrder(order.id, res.patch);
          this.store.markFailed(order.id, { error: res.error, code: res.code });
        } else {
          this.store.patchOrder(order.id, {
            attempts: (order.attempts || 0) + 1,
            lastTriedAt: Date.now(),
          });
        }
      } catch { /* aborted or offline — the order is untouched and still here */ }
      finally {
        this.checkingId = null;
      }
    },

    /**
     * Refresh live status for delivered products, one at a time. Sequential on
     * purpose: nadanada sits behind Cloudflare and parallel bursts trip its
     * rate limit, which would leave every card statusless at once.
     */
    async refreshAll() {
      if (this.refreshing) return;
      const now = Date.now();
      const due = this.products.filter((o) => {
        if (!o.liveFetchedAt) return true;
        const ttl = this.derivedFor(o)?.state === 'expired' ? ENDED_TTL_MS : STATUS_TTL_MS;
        return now - o.liveFetchedAt > ttl;
      });
      if (!due.length) return;

      this.refreshController?.abort();
      this.refreshController = new AbortController();
      const signal = this.refreshController.signal;
      this.refreshing = true;
      try {
        for (const o of due) {
          if (signal.aborted) break;
          try {
            const live = o.kind === ORDER_KIND.ESIM
              ? await fetchEsimStatus(o.iccid, { signal })
              : await fetchVpnStatus(o.publicKey, { signal });
            this.store.cacheLive(o.id, live);
          } catch {
            // Offline or a provider hiccup: keep whatever we cached last time.
            // Never blank a card the user might need right now.
          }
        }
      } finally {
        this.refreshing = false;
      }
    },
  },
};
</script>

<style scoped>
.mp-sheet {
  width: 100%; max-width: 520px;
  border-top-left-radius: 22px; border-top-right-radius: 22px;
  overflow: hidden;
  /* var(--safe-bottom), not a bare env(): Android reports the env() inset as 0
     even with a nav bar; boot/safe-area.js patches the variable. */
  padding-bottom: max(16px, var(--safe-bottom, 16px));
  display: flex; flex-direction: column;
  max-height: 90vh; max-height: 90dvh;
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

.block { display: flex; flex-direction: column; gap: 10px; }
.block-head { display: flex; align-items: center; gap: 7px; }
.block-title { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: #64748b; }
body.body--dark .block-title { color: #94a3b8; }
.block-title--alert { color: #b45309; }
body.body--dark .block-title--alert { color: #fbbf24; }

/* Needs-attention rows */
.issue { display: flex; flex-direction: column; gap: 9px; padding: 14px; border-radius: 16px; }
.issue-light { background: rgba(247, 147, 26, 0.07); box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.22); }
.issue-dark { background: rgba(247, 147, 26, 0.1); box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.26); }
.issue-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.issue-icon--wait { color: #b45309; flex-shrink: 0; }
.issue-icon--fail { color: #b91c1c; flex-shrink: 0; }
body.body--dark .issue-icon--wait { color: #fbbf24; }
body.body--dark .issue-icon--fail { color: #fca5a5; }
.issue-name { font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.issue-sub { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 500; line-height: 1.4; }
.issue-cta {
  width: 100%; min-height: 44px; border-radius: 13px; border: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: 'Manrope', sans-serif; font-size: 14px; font-weight: 600;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.issue-cta:disabled { opacity: 0.6; cursor: default; }
.issue-cta:not(:disabled):active { transform: scale(0.98); }

/* Segmented tabs */
.mp-tabs { display: flex; gap: 4px; padding: 4px; border-radius: 999px; }
.mp-tabs-light { background: rgba(15, 23, 42, 0.05); }
.mp-tabs-dark { background: rgba(255, 255, 255, 0.06); }
.mp-tab {
  all: unset; box-sizing: border-box;
  flex: 1 1 0; min-height: 36px;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600;
  color: #64748b; cursor: pointer; -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease, color 0.15s ease;
}
body.body--dark .mp-tab { color: #94a3b8; }
.mp-tab--active { background: #ffffff; color: #0f172a; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1); }
body.body--dark .mp-tab--active { background: rgba(255, 255, 255, 0.12); color: #f8fafc; box-shadow: none; }
.mp-tab-count { font-size: 11.5px; font-weight: 700; opacity: 0.65; font-variant-numeric: tabular-nums; }

.cards { display: flex; flex-direction: column; gap: 10px; }

.refresh-note { display: inline-flex; align-items: center; gap: 6px; font-family: 'Manrope', sans-serif; font-size: 11.5px; align-self: center; }

.info-state { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; padding: 22px 16px; font-family: 'Manrope', sans-serif; font-size: 14px; line-height: 1.45; }
.info-state--empty { padding: 34px 16px; }
.empty-cta {
  min-height: 44px; padding: 0 20px; border-radius: 14px; border: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: 'Manrope', sans-serif; font-size: 14px; font-weight: 600;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}

/* Remove, with the consequence stated before it happens. */
.recover-link { all: unset; display: inline-flex; align-items: center; min-height: 44px; gap: 6px; align-self: center; padding: 0 12px; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; }

.remove-link { all: unset; display: inline-flex; align-items: center; min-height: 44px; gap: 6px; align-self: center; padding: 0 12px; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 600; color: #b91c1c; cursor: pointer; -webkit-tap-highlight-color: transparent; }
body.body--dark .remove-link { color: #fca5a5; }
.confirm-remove { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px; }
.confirm-remove-light { background: rgba(239, 68, 68, 0.07); box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.2); }
.confirm-remove-dark { background: rgba(239, 68, 68, 0.12); box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.26); }
.confirm-text { margin: 0; font-family: 'Manrope', sans-serif; font-size: 13px; line-height: 1.45; color: #b91c1c; }
body.body--dark .confirm-text { color: #fca5a5; }
.confirm-actions { display: flex; gap: 8px; }
.confirm-btn {
  all: unset; box-sizing: border-box; flex: 1 1 0; min-height: 44px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 12px; font-family: 'Manrope', sans-serif; font-size: 13.5px; font-weight: 600;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.confirm-btn--ghost { background: rgba(15, 23, 42, 0.06); color: #0f172a; }
body.body--dark .confirm-btn--ghost { background: rgba(255, 255, 255, 0.1); color: #f8fafc; }
.confirm-btn--danger { background: #b91c1c; color: #ffffff; }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
