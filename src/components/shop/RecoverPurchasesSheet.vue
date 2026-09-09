<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card class="rec-sheet shop-surface" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
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
        <div class="step-body">
          <!-- Working: searching, and finishing whatever needs no answer -->
          <div v-if="busy" class="stage" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'" aria-live="polite">
            <q-spinner color="grey" size="30px" />
            <span class="stage-text">{{ busyText }}</span>
          </div>

          <!-- Everything is sorted -->
          <template v-else-if="restored.length && !pending.length">
            <div class="stage">
              <div class="stage-check">
                <Icon icon="tabler:circle-check-filled" width="44" height="44" />
              </div>
              <div class="stage-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ restoredTitle }}
              </div>
              <span class="stage-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ restoredBody }}
              </span>
            </div>
            <button
              type="button"
              class="primary-cta"
              :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
              @click="open = false"
            >
              <span>{{ $t('See it in Your products') }}</span>
            </button>
          </template>

          <!-- Nothing to find -->
          <div
            v-else-if="searched && !pending.length"
            class="stage"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            <Icon icon="tabler:circle-check" width="28" height="28" class="stage-ok" />
            <span class="stage-text">{{ $t('Everything you paid for is already here.') }}</span>
            <span v-if="failedWallets" class="stage-note" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t("One of your wallets couldn't be read. Connect it and check again.") }}
            </span>
          </div>

          <!-- Needs one answer each. Choosing is the action: there is no
               second button to press afterwards. -->
          <template v-else-if="pending.length">
            <p class="lede" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ pendingLede }}
            </p>

            <div
              v-for="c in pending"
              :key="c.checkoutId"
              class="item"
              :class="$q.dark.isActive ? 'item-dark' : 'item-light'"
            >
              <div class="item-top">
                <Icon :icon="kindIcon(c.kind)" width="18" height="18" class="item-icon" />
                <span class="item-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                  {{ kindLabel(c.kind) }}
                </span>
                <span class="item-amount" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
                  {{ formatSats(c.priceSats) }} {{ $t('sats') }}
                </span>
              </div>
              <div class="item-sub" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
                {{ $t('Paid {when}', { when: formatDate(c.paidAt) }) }}
              </div>

              <!-- VPN: the same server picker the shop uses. This is not a
                   forgotten choice being asked again — a VPN's location is
                   only set when the config is made, so this order never had
                   one. -->
              <template v-if="detailFor(c) === 'vpn_location'">
                <div class="ask" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                  {{ $t('Pick where your VPN server should be, and it is yours.') }}
                </div>
                <button
                  type="button"
                  class="choose-btn"
                  :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
                  :disabled="!vpnLocations.length"
                  @click="openLocationPicker(c)"
                >
                  <Icon icon="tabler:world" width="16" height="16" />
                  <span>{{ vpnLocations.length ? $t('Choose a server') : $t('Loading locations…') }}</span>
                </button>
              </template>

              <!-- eSIM top-up: pick which of their eSIMs gets the data. -->
              <template v-else-if="detailFor(c) === 'esim_target'">
                <template v-if="store.esims.length">
                  <div class="ask" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                    {{ $t('Tap the eSIM this data belongs to.') }}
                  </div>
                  <button
                    v-for="e in store.esims"
                    :key="e.id"
                    type="button"
                    class="pick-row"
                    :class="$q.dark.isActive ? 'pick-row-dark' : 'pick-row-light'"
                    @click="restore(c, { targetIccid: e.iccid, esim: e })"
                  >
                    <span class="pick-flag">{{ e.flag || '📶' }}</span>
                    <span class="pick-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                      {{ e.countryName || e.title || $t('eSIM') }}
                    </span>
                    <Icon icon="tabler:chevron-right" width="16" height="16" class="pick-go" />
                  </button>
                </template>
                <div v-else class="ask" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                  {{ $t('This is data for an eSIM that is not on this phone. Copy the reference below and send it to the provider.') }}
                </div>
              </template>

              <div v-if="errors[c.checkoutId]" class="item-error" role="alert">
                {{ errors[c.checkoutId] }}
              </div>
            </div>
          </template>
        </div>
      </div>

      <div v-if="showFooter" class="sheet-actions" :class="$q.dark.isActive ? 'sheet-actions-dark' : 'sheet-actions-light'">
        <button
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :disabled="busy"
          @click="search"
        >
          <span>{{ $t('Check again') }}</span>
        </button>
      </div>
    </q-card>
  </q-dialog>

  <!-- The shop's own server picker, so choosing here looks like buying.
       A sibling, not a child: nesting one dialog inside another's slot nests
       their portals too. -->
  <LocationPickerSheet
    v-model="locationPickerOpen"
    :locations="vpnLocations"
    @select="onLocationChosen"
  />
</template>

<script>
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../../stores/wallet';
import { useNadanadaOrdersStore } from '../../stores/nadanadaOrders';
import { normalizeTx } from '../../services/txNormalizer.js';
import {
  collectOutgoingPayments, findOrphanPayments, missingDetailFor, candidateOrderFields,
} from '../../services/nadanada/recovery.js';
import { redeemOrder, ORDER_KIND, ORDER_STATE, REDEEM_ATTEMPT_MS } from '../../services/nadanada/orders.js';
import { fetchVpnCatalog } from '../../services/nadanada/vpn.js';
import { generateWireGuardKeypair, generatePresharedKey } from '../../services/nadanada/wireguard.js';
import LocationPickerSheet from './LocationPickerSheet.vue';

/** How far back through each wallet's history to look. Deep enough to cover a
 *  purchase from weeks ago, shallow enough to stay one request per wallet. */
const SCAN_LIMIT = 100;

/**
 * Recovery for purchases made before the order ledger existed.
 *
 * The ledger stops purchases going missing from now on. This is for the ones
 * already lost: the app used to store only completed products, so a payment
 * that never completed left no record. The wallet's own history still holds
 * the invoice, and every nadanada invoice names its order (see
 * services/nadanada/recovery.js), which is all a redemption needs.
 *
 * It behaves the way someone expects a shop to behave, not the way a repair
 * tool behaves: it looks by itself, finishes everything it can without asking,
 * and only speaks up for the one thing it genuinely cannot know — where a VPN
 * server should be, or which eSIM some data was for. Answering that question
 * IS the action; there is no confirm step afterwards.
 */
export default {
  name: 'RecoverPurchasesSheet',
  components: { Icon, LocationPickerSheet },
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'restored', 'searched'],

  setup() {
    const walletStore = useWalletStore();
    const store = useNadanadaOrdersStore();
    return { walletStore, store };
  },

  data() {
    return {
      searching: false,
      finishing: false,
      searched: false,
      /** Found, and still waiting on one answer from the user. */
      pending: [],
      /** Found and already handed over during this visit. */
      restored: [],
      failedWallets: 0,
      errors: {},
      vpnLocations: [],
      locationPickerOpen: false,
      locationTarget: null,
      controller: null,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    busy() {
      return this.searching || this.finishing;
    },

    busyText() {
      return this.finishing
        ? this.$t('Getting it for you…')
        : this.$t('Checking your payments…');
    },

    headerTitle() {
      if (this.busy) return this.$t('One moment');
      if (this.restored.length && !this.pending.length) return this.$t('Sorted');
      if (this.pending.length) return this.$t('Almost there');
      return this.$t('Missing purchases');
    },

    restoredTitle() {
      return this.restored.length === 1
        ? this.$t('Found your purchase')
        : this.$t('Found your purchases');
    },

    restoredBody() {
      const delivered = this.restored.filter((o) => o?.state === ORDER_STATE.FULFILLED).length;
      return delivered === this.restored.length
        ? this.$t('It is in Your products now, ready to use.')
        : this.$t('It is saved in Your products. We will keep asking the provider for it.');
    },

    pendingLede() {
      return this.pending.length === 1
        ? this.$t('One purchase needs a single answer before we can finish it.')
        : this.$t('These purchases each need one answer before we can finish them.');
    },

    /** The manual re-check only earns its place once there is nothing left to
     *  do on screen. */
    showFooter() {
      return !this.busy && this.searched && !this.pending.length && !this.restored.length;
    },
  },

  beforeUnmount() {
    this.controller?.abort();
  },

  methods: {
    onShow() {
      this.search();
    },

    onHide() {
      this.controller?.abort();
      this.controller = null;
      this.searching = false;
      this.finishing = false;
      this.restored = [];
    },

    /**
     * Read every connected wallet's recent payments, keep the nadanada
     * purchases the ledger has never seen, and immediately finish the ones
     * that need nothing from the user.
     */
    async search() {
      if (this.busy) return;
      this.searching = true;
      this.errors = {};
      this.restored = [];
      this.controller?.abort();
      this.controller = new AbortController();

      let found = [];
      try {
        const { transactions, failedWallets, scannedWallets } = await collectOutgoingPayments({
          wallets: this.walletStore.wallets || [],
          providers: this.walletStore.providers || {},
          normalize: (raw, ctx) => normalizeTx(raw, ctx),
          limit: SCAN_LIMIT,
          signal: this.controller.signal,
        });
        this.failedWallets = failedWallets;
        found = findOrphanPayments(transactions, this.store.orders);
        // A search that read no wallet has not really happened; leave the flag
        // unset so it is tried again once a wallet is connected.
        if (scannedWallets > 0) this.store.markRecoveryScanned();
      } catch {
        this.failedWallets = 1;
      } finally {
        this.searching = false;
        this.searched = true;
      }

      this.pending = found.filter((c) => this.detailFor(c));
      if (this.pending.some((c) => c.kind === ORDER_KIND.VPN)) this.loadVpnLocations();

      const ready = found.filter((c) => !this.detailFor(c));
      if (ready.length) await this.finishAll(ready);

      this.$emit('searched', { found: found.length });
    },

    /** Redeem everything that needs no answer, one after another. */
    async finishAll(candidates) {
      this.finishing = true;
      try {
        for (const candidate of candidates) {
          if (this.controller?.signal.aborted) break;
          await this.restore(candidate, this.autoExtrasFor(candidate), { silent: true });
        }
      } finally {
        this.finishing = false;
      }
    },

    /**
     * Write the order to the ledger, then ask the provider for the product.
     *
     * The write comes first and is never undone: from that moment the purchase
     * is durable and reachable from Your products, whether or not the provider
     * answers right now.
     */
    async restore(candidate, extras = {}, { silent = false } = {}) {
      if (!silent && this.busy) return;
      if (!silent) this.finishing = true;
      this.errors = { ...this.errors, [candidate.checkoutId]: '' };

      try {
        const order = this.store.createOrder(
          candidateOrderFields(candidate, this.orderContext(candidate, extras)),
        );

        const res = await redeemOrder(order, { maxMs: REDEEM_ATTEMPT_MS });
        if (res.ok && res.patch) {
          this.store.patchOrder(order.id, res.patch);
        } else if (res.fatal) {
          if (res.patch) this.store.patchOrder(order.id, res.patch);
          this.store.markFailed(order.id, { error: res.error, code: res.code });
        }

        const stored = this.store.orderById(order.id);
        this.pending = this.pending.filter((c) => c.checkoutId !== candidate.checkoutId);
        this.restored.push(stored);
        this.$emit('restored', stored);
      } catch {
        this.errors = {
          ...this.errors,
          [candidate.checkoutId]: this.$t("Couldn't reach the provider. Try again in a moment."),
        };
      } finally {
        if (!silent) this.finishing = false;
      }
    },

    // ── the one question we may have to ask ──────────────────────────────

    detailFor(candidate) {
      return missingDetailFor(candidate, { esims: this.store.esims });
    },

    openLocationPicker(candidate) {
      this.locationTarget = candidate;
      this.locationPickerOpen = true;
    },

    onLocationChosen(location) {
      const candidate = this.locationTarget;
      this.locationTarget = null;
      if (candidate && location) this.restore(candidate, { location });
    },

    async loadVpnLocations() {
      if (this.vpnLocations.length) return;
      try {
        const { countries } = await fetchVpnCatalog({ signal: this.controller?.signal });
        this.vpnLocations = countries;
      } catch {
        // Offline: the Choose button stays disabled, which is the honest state.
        // A config cannot be made without a location.
      }
    },

    /** The answer for a candidate that needs no asking. */
    autoExtrasFor(candidate) {
      if (candidate.kind !== ORDER_KIND.ESIM_TOPUP) return {};
      const esim = this.store.esims[0];
      return esim ? { targetIccid: esim.iccid, esim } : {};
    },

    /**
     * The product context a restored order needs in order to render like any
     * other, and to be redeemable.
     */
    orderContext(candidate, extras) {
      const meta = this.$t('Restored purchase');

      if (candidate.kind === ORDER_KIND.VPN) {
        const loc = extras.location;
        // No keypair survived the original purchase, so make a fresh one. The
        // provider binds the config to whichever public key asks for it, and
        // it has not issued one for this payment yet.
        const keypair = generateWireGuardKeypair();
        return {
          title: [loc?.flag, loc?.name].filter(Boolean).join(' ') || this.$t('VPN'),
          meta,
          country: loc?.code || '',
          countryName: loc?.name || '',
          flag: loc?.flag || '',
          publicKey: keypair.publicKey,
          privateKey: keypair.privateKey,
          presharedKey: generatePresharedKey(),
        };
      }

      if (candidate.kind === ORDER_KIND.ESIM_TOPUP) {
        const target = extras.esim;
        return {
          title: [target?.flag, target?.countryName].filter(Boolean).join(' ') || this.$t('eSIM data'),
          meta,
          targetIccid: extras.targetIccid || '',
          countryName: target?.countryName || '',
          flag: target?.flag || '',
          slug: target?.slug || '',
          countryCode: target?.countryCode || '',
        };
      }

      return { title: this.$t('eSIM'), meta };
    },

    // ── presentation ─────────────────────────────────────────────────────

    kindIcon(kind) {
      return kind === ORDER_KIND.VPN ? 'tabler:shield-lock' : 'tabler:world';
    },

    kindLabel(kind) {
      switch (kind) {
        case ORDER_KIND.VPN: return this.$t('VPN');
        case ORDER_KIND.ESIM_TOPUP: return this.$t('eSIM data');
        default: return this.$t('eSIM');
      }
    },

    formatSats(n) {
      if (!Number.isFinite(n)) return '';
      try { return new Intl.NumberFormat(this.$i18n?.locale || undefined).format(n); }
      catch { return String(n); }
    },

    formatDate(ms) {
      if (!Number.isFinite(ms)) return '';
      try {
        return new Intl.DateTimeFormat(this.$i18n?.locale || undefined, {
          day: 'numeric', month: 'short',
        }).format(ms);
      } catch { return new Date(ms).toISOString().slice(0, 10); }
    },
  },
};
</script>

<style scoped>
.rec-sheet {
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
.step-body { display: flex; flex-direction: column; gap: 14px; padding: 6px 18px 18px; }

.stage { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; padding: 30px 12px 16px; }
.stage-title { font-family: 'Manrope', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
.stage-text { font-family: 'Manrope', sans-serif; font-size: 14px; line-height: 1.5; max-width: 300px; }
.stage-note { font-family: 'Manrope', sans-serif; font-size: 12.5px; line-height: 1.45; max-width: 300px; }
.stage-check, .stage-ok { color: #15a35b; }
body.body--dark .stage-check, body.body--dark .stage-ok { color: #2bd17f; }

.lede { margin: 0; font-family: 'Manrope', sans-serif; font-size: 13.5px; line-height: 1.5; }

.item { display: flex; flex-direction: column; gap: 9px; padding: 14px; border-radius: 16px; }
.item-light { background: rgba(247, 147, 26, 0.07); box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.22); }
.item-dark { background: rgba(247, 147, 26, 0.1); box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.26); }
.item-top { display: flex; align-items: center; gap: 9px; min-width: 0; }
.item-icon { flex-shrink: 0; color: #b45309; }
body.body--dark .item-icon { color: #fbbf24; }
.item-name { flex: 1 1 auto; min-width: 0; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-amount { flex-shrink: 0; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.item-sub { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 500; }
.item-error { font-family: 'Manrope', sans-serif; font-size: 12.5px; line-height: 1.4; color: #b91c1c; }
body.body--dark .item-error { color: #fca5a5; }

.ask { font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600; line-height: 1.45; margin-top: 2px; }

.choose-btn {
  width: 100%; min-height: 44px; border-radius: 13px; border: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: 'Manrope', sans-serif; font-size: 14px; font-weight: 600;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.choose-btn:disabled { opacity: 0.5; cursor: default; }
.choose-btn:not(:disabled):active { transform: scale(0.98); }

.pick-row {
  all: unset; box-sizing: border-box;
  display: flex; align-items: center; gap: 10px;
  width: 100%; min-height: 52px; padding: 0 14px; border-radius: 13px;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.pick-row-light { background: rgba(255, 255, 255, 0.75); }
.pick-row-dark { background: rgba(255, 255, 255, 0.08); }
.pick-row:active { transform: scale(0.99); }
.pick-flag { font-size: 19px; flex-shrink: 0; line-height: 1; }
.pick-name { flex: 1 1 auto; min-width: 0; font-family: 'Manrope', sans-serif; font-size: 14.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick-go { flex-shrink: 0; opacity: 0.5; }

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
