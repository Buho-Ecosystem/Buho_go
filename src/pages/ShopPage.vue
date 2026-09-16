<template>
  <q-page class="shop-page shop-surface" :class="$q.dark.isActive ? 'shop-dark' : 'shop-light'">
    <!-- Header. It owns the top safe-area inset itself and sticks at top: 0 —
         a non-zero sticky top would displace it into the content at rest on
         Android, because the page already carries the global --safe-top pad. -->
    <div class="shop-header">
      <q-btn flat round dense class="shop-back" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" :aria-label="$t('Back')" @click="$router.back()">
        <Icon icon="tabler:chevron-left" width="20" height="20" />
      </q-btn>
      <div class="shop-header-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">{{ $t('Shop') }}</div>
      <q-btn
        flat round dense
        class="shop-back"
        :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
        :aria-label="productsLabel"
        @click="myProductsOpen = true"
      >
        <Icon icon="tabler:receipt" width="20" height="20" />
        <span
          v-if="store.totalCount"
          class="mp-badge"
          :class="{ 'mp-badge--alert': store.attentionCount > 0 }"
        >{{ store.totalCount }}</span>
      </q-btn>
    </div>

    <!-- Standing notice for anything paid but not delivered. It is the first
         thing on the page because it is the only thing here that costs money
         if it is missed. -->
    <button
      v-if="store.attentionCount"
      type="button"
      class="attention-banner"
      :class="$q.dark.isActive ? 'attention-banner-dark' : 'attention-banner-light'"
      @click="myProductsOpen = true"
    >
      <Icon icon="tabler:clock-exclamation" width="18" height="18" class="attention-icon" />
      <span class="attention-text">{{ attentionText }}</span>
      <Icon icon="tabler:chevron-right" width="16" height="16" class="attention-go" />
    </button>

    <!-- Segmented tabs -->
    <div class="shop-tabs" :class="$q.dark.isActive ? 'shop-tabs-dark' : 'shop-tabs-light'">
      <button
        type="button"
        class="shop-tab"
        :class="{ 'shop-tab--active': activeTab === 'esim' }"
        @click="activeTab = 'esim'"
      >
        <Icon icon="tabler:world" width="17" height="17" />
        <span>{{ $t('Mobile data') }}</span>
      </button>
      <button
        type="button"
        class="shop-tab"
        :class="{ 'shop-tab--active': activeTab === 'vpn' }"
        @click="selectVpnTab"
      >
        <Icon icon="tabler:shield-lock" width="17" height="17" />
        <span>{{ $t('VPN') }}</span>
      </button>
    </div>

    <!-- Body -->
    <div class="shop-body">
      <!-- eSIM -->
      <template v-if="activeTab === 'esim'">
        <div class="shop-help-row">
          <span class="shop-help-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t('Mobile data for 200+ countries') }}</span>
          <ShopInfoTooltip
            tone="toolbox"
            trigger-icon="tabler:tools"
            icon="tabler:tools"
            :aria-label="$t('How eSIM works')"
            :title="$t('How you get your eSIM')"
            :lede="$t('A data-only plan that installs as a QR code.')"
            :steps="esimHelpSteps"
          />
        </div>
        <div v-if="esim.error" class="info-state" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
          <Icon icon="tabler:cloud-off" width="22" height="22" />
          <span>{{ esim.error }}</span>
          <button type="button" class="retry-btn" :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'" @click="loadEsimCatalog">{{ $t('Try again') }}</button>
        </div>
        <DestinationGrid
          v-else
          :countries="esim.countries"
          :regions="esim.regions"
          :recent="recentCountries"
          :loading="esim.loading"
          @select="onDestinationSelect"
        />
      </template>

      <!-- VPN -->
      <template v-else>
        <VpnConfigurator
          :durations="vpn.durations"
          :locations="vpn.countries"
          :loading="vpn.loading"
          @continue="onVpnContinue"
        />
      </template>

      <!-- Provider attribution. The products are nadanada's; the affiliate
           relationship itself stays invisible. -->
      <div class="shop-footer">
        <span class="shop-footer-text" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">{{ $t('Powered by') }}</span>
        <img src="/NadaNada/NadaNada.png" alt="nada nada" class="shop-footer-logo" />
      </div>
    </div>

    <!-- eSIM bundle sheet (new purchase) -->
    <CountryBundlesSheet
      v-model="bundleSheetOpen"
      :country="activeCountry"
      :bundles="bundles.list"
      :loading="bundles.loading"
      :error="bundles.error"
      @select="onBundleSelect"
    />

    <!-- eSIM bundle sheet (top-up of an eSIM already owned) -->
    <CountryBundlesSheet
      v-model="topupSheetOpen"
      :country="topup.country"
      :subtitle="$t('Added to the eSIM you already have')"
      :bundles="topup.list"
      :loading="topup.loading"
      :error="topup.error"
      @select="onTopupBundleSelect"
    />

    <!-- VPN extension sheet -->
    <VpnExtendSheet
      v-model="extendSheetOpen"
      :durations="vpn.durations"
      :subtitle="extend.subtitle"
      :loading="vpn.loading"
      :error="vpn.error"
      @select="onExtendDurationSelect"
    />

    <!-- Shared purchase sheet -->
    <PurchaseSheet
      v-model="purchaseSheetOpen"
      :descriptor="activeDescriptor"
      @purchased="onPurchased"
      @backgrounded="onBackgrounded"
    />

    <!-- Your products -->
    <MyProducts
      ref="myProducts"
      v-model="myProductsOpen"
      @topup="onTopupRequest"
      @extend="onExtendRequest"
      @recover="recoverOpen = true"
    />

    <!-- Recovery for purchases made before the order ledger existed -->
    <RecoverPurchasesSheet v-model="recoverOpen" @restored="onRestored" />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import { fiatRatesService } from '../utils/fiatRates.js';
import { useNadanadaOrdersStore } from '../stores/nadanadaOrders';
import { useWalletStore } from '../stores/wallet';
import {
  fetchEsimCountries, fetchEsimBundles, purchaseEsim, purchaseEsimTopup,
  fetchVpnCatalog, requestVpn, requestVpnExtension,
  generateWireGuardKeypair, generatePresharedKey,
  redeemAll, ORDER_KIND,
  collectOutgoingPayments, findOrphanPayments,
} from '../services/nadanada';
import { normalizeTx } from '../services/txNormalizer.js';
import DestinationGrid from '../components/shop/DestinationGrid.vue';
import CountryBundlesSheet from '../components/shop/CountryBundlesSheet.vue';
import VpnConfigurator from '../components/shop/VpnConfigurator.vue';
import VpnExtendSheet from '../components/shop/VpnExtendSheet.vue';
import PurchaseSheet from '../components/shop/PurchaseSheet.vue';
import MyProducts from '../components/shop/MyProducts.vue';
import RecoverPurchasesSheet from '../components/shop/RecoverPurchasesSheet.vue';
import ShopInfoTooltip from '../components/shop/ShopInfoTooltip.vue';

/**
 * Shop landing. One route, two tabs (Mobile data / VPN). All purchasing
 * happens in bottom sheets so the back stack stays flat.
 *
 * This page builds the purchase descriptors the PurchaseSheet consumes and
 * owns the four ways money can leave: a new eSIM, a top-up for one already
 * owned, a new VPN, and an extension of one already owned. All four go through
 * the same sheet and therefore the same order ledger, so none of them can
 * strand a payment.
 *
 * It also retries anything left pending as soon as the shop opens, because a
 * user who comes back after a stuck purchase should find it finished rather
 * than have to know to press something.
 */
export default {
  name: 'ShopPage',
  components: {
    Icon, DestinationGrid, CountryBundlesSheet, VpnConfigurator, VpnExtendSheet,
    PurchaseSheet, MyProducts, RecoverPurchasesSheet, ShopInfoTooltip,
  },

  setup() {
    const store = useNadanadaOrdersStore();
    const walletStore = useWalletStore();
    return { store, walletStore };
  },

  data() {
    return {
      activeTab: 'esim',
      esim: { loading: false, error: '', countries: [], regions: [] },
      bundles: { loading: false, error: '', list: [] },
      vpn: { loading: false, error: '', durations: [], countries: [], loaded: false },
      topup: { order: null, country: null, list: [], loading: false, error: '' },
      extend: { order: null, subtitle: '' },
      activeCountry: null,
      activeDescriptor: null,
      bundleSheetOpen: false,
      topupSheetOpen: false,
      extendSheetOpen: false,
      purchaseSheetOpen: false,
      myProductsOpen: false,
      recoverOpen: false,
      // A top-up or extension renews something already in Your products, so
      // that is where the user should land once the sheet closes.
      reopenProductsAfterPurchase: false,
      resumeController: null,
    };
  },

  watch: {
    purchaseSheetOpen(open) {
      if (open || !this.reopenProductsAfterPurchase) return;
      this.reopenProductsAfterPurchase = false;
      this.myProductsOpen = true;
    },
  },

  computed: {
    recentCountries() {
      return this.store.recentDestinations;
    },

    /** Two keys rather than a plural rule: the app runs vue-i18n in legacy
     *  mode and uses no pipe-separated plurals anywhere else. */
    attentionText() {
      const n = this.store.attentionCount;
      return n === 1
        ? this.$t('1 order is waiting to be delivered')
        : this.$t('{n} orders are waiting to be delivered', { n });
    },

    productsLabel() {
      return this.store.attentionCount
        ? this.$t('Your products, {n} waiting', { n: this.store.attentionCount })
        : this.$t('Your products');
    },

    esimHelpSteps() {
      return [
        this.$t('Pick a destination and a data plan.'),
        this.$t('Pay the invoice in bitcoin. No account needed.'),
        this.$t('Your install QR code appears right here after payment.'),
        this.$t('In phone Settings, add a cellular or eSIM plan, then scan the QR.'),
        this.$t('Turn on data roaming for the new line when you travel.'),
      ];
    },
  },

  created() {
    this.loadEsimCatalog();
    // Finish anything the last visit left hanging, quietly and in the
    // background. Idempotent server-side, so it is always safe to run.
    this.resumePending();
    // Once, ever: look for purchases made before the ledger existed. Someone
    // whose money went missing should not have to know a recovery feature
    // exists in order to get it back.
    this.autoFindLostPurchases();
  },

  beforeUnmount() {
    this.resumeController?.abort();
  },

  methods: {
    // ── recovery ─────────────────────────────────────────────────────
    /**
     * Retry every paid-but-undelivered order. Runs on entering the shop so a
     * user who was stranded last time finds the product waiting rather than
     * having to discover a button.
     */
    async resumePending() {
      // Clear orders whose invoice lapsed unpaid first: they can never settle,
      // so retrying them would be noise on the user's attention list.
      this.store.pruneSettledUnpaid();
      const pending = this.store.pendingOrders;
      if (!pending.length) return;
      this.resumeController?.abort();
      this.resumeController = new AbortController();
      try {
        await redeemAll(
          pending,
          (id, patch) => { if (patch) this.store.patchOrder(id, patch); },
          { signal: this.resumeController.signal, maxMs: 20000 },
        );
      } catch { /* offline: the orders stay pending and visible */ }
    },

    /**
     * One-time search of the wallet history for purchases the ledger never
     * recorded, from before it existed. Silent unless it finds something: the
     * recovery sheet only appears when there is actually money to hand back.
     *
     * It costs one transaction fetch per connected wallet, once per install.
     */
    async autoFindLostPurchases() {
      if (this.store.recoveryScannedAt) return;
      try {
        const { transactions, scannedWallets } = await collectOutgoingPayments({
          wallets: this.walletStore.wallets || [],
          providers: this.walletStore.providers || {},
          normalize: (raw, ctx) => normalizeTx(raw, ctx),
        });
        if (findOrphanPayments(transactions, this.store.orders).length) {
          // The sheet does the work; it searches again on open and takes it
          // from there.
          this.recoverOpen = true;
          return;
        }
        // Only a search that actually read a wallet counts as having happened.
        // No wallet connected yet is not the same as nothing to find, and the
        // user may connect one tomorrow.
        if (scannedWallets > 0) this.store.markRecoveryScanned();
      } catch {
        // Offline or an unreadable wallet. Leave the flag unset so the next
        // visit tries again rather than writing off a purchase unseen.
      }
    },

    // ── catalog loading ──────────────────────────────────────────────
    async loadEsimCatalog() {
      this.esim.loading = true;
      this.esim.error = '';
      try {
        const { countries } = await fetchEsimCountries();
        this.esim.countries = countries;
        // Regions are hidden because they are not purchasable UPSTREAM, not
        // because of anything on our side. Verified live: every region bundle
        // the catalog lists (e.g. fixed_1GB_7D_EUROPE) is rejected by
        // /esim/purchase with `bundle_slug_mismatch` for its own slug, and no
        // slug variant is accepted either. Re-enable once nadanada configures
        // fixed pricing for region slugs.
        this.esim.regions = [];
      } catch {
        this.esim.error = this.$t("Couldn't load destinations. Check your connection and try again.");
      } finally {
        this.esim.loading = false;
      }
    },

    selectVpnTab() {
      this.activeTab = 'vpn';
      if (!this.vpn.loaded) this.loadVpnCatalog();
    },

    async loadVpnCatalog() {
      this.vpn.loading = true;
      this.vpn.error = '';
      try {
        const { countries, durations } = await fetchVpnCatalog();
        this.vpn.countries = countries;
        this.vpn.durations = await this.augmentSats(durations);
        this.vpn.loaded = true;
      } catch {
        this.vpn.error = this.$t("Couldn't load VPN plans. Try again.");
      } finally {
        this.vpn.loading = false;
      }
    },

    // ── eSIM: new purchase ───────────────────────────────────────────
    async onDestinationSelect(item) {
      const isRegion = item._kind === 'region';
      this.activeCountry = {
        name: item.name,
        slug: item.slug,
        code: item.code || '',
        flag: isRegion ? '🌍' : (item.flag || ''),
        isRegion,
      };
      this.bundleSheetOpen = true;
      this.bundles = { loading: true, error: '', list: [] };
      try {
        const params = isRegion ? { region: item.slug } : { country: item.code };
        const list = await fetchEsimBundles(params);
        this.bundles.list = await this.augmentSats(list);
      } catch {
        this.bundles.error = this.$t("Couldn't load plans. Try again.");
      } finally {
        this.bundles.loading = false;
      }
    },

    onBundleSelect(bundle) {
      this.activeDescriptor = this.buildEsimDescriptor(this.activeCountry, bundle);
      this.bundleSheetOpen = false;
      this.purchaseSheetOpen = true;
    },

    buildEsimDescriptor(country, bundle) {
      const planLabel = this.esimPlanLabel(bundle);
      const flagName = [country.flag, country.name].filter(Boolean).join(' ');
      return {
        kind: ORDER_KIND.ESIM,
        title: flagName,
        meta: planLabel,
        createInvoice: () => purchaseEsim({ bundleName: bundle.bundleName, slug: country.slug }),
        // Everything the success screen and the product card will need later,
        // stored alongside the redemption keys so a recovered order renders
        // exactly like one that completed first time.
        orderFields: (inv) => ({
          countryName: country.name,
          countryCode: country.code || '',
          flag: country.isRegion ? '' : country.flag,
          slug: country.slug,
          bundleName: bundle.bundleName,
          providerBundleName: inv.providerBundleName || '',
          dataInGB: bundle.dataInGB,
          durationInDays: bundle.durationInDays,
          planLabel,
        }),
      };
    },

    // ── eSIM: top-up of an existing eSIM ─────────────────────────────
    async onTopupRequest(order) {
      this.myProductsOpen = false;
      this.topup = { order, country: null, list: [], loading: true, error: '' };
      this.topupSheetOpen = true;

      // The country code was not stored before the ledger existed; fall back to
      // resolving it from the catalog by slug so older eSIMs can still top up.
      let code = order.countryCode || '';
      if (!code && order.slug) {
        if (!this.esim.countries.length) {
          try { this.esim.countries = (await fetchEsimCountries()).countries; } catch { /* handled below */ }
        }
        code = this.esim.countries.find((c) => c.slug === order.slug)?.code || '';
      }
      this.topup.country = {
        name: order.countryName || this.$t('Your eSIM'),
        slug: order.slug || '',
        code,
        flag: order.flag || '',
      };

      if (!code || !order.slug) {
        this.topup.loading = false;
        this.topup.error = this.$t("We can't look up plans for this eSIM. Buy a new one instead.");
        return;
      }
      try {
        const list = await fetchEsimBundles({ country: code });
        this.topup.list = await this.augmentSats(list);
      } catch {
        this.topup.error = this.$t("Couldn't load plans. Try again.");
      } finally {
        this.topup.loading = false;
      }
    },

    onTopupBundleSelect(bundle) {
      const order = this.topup.order;
      const country = this.topup.country;
      if (!order?.iccid || !country) return;
      const planLabel = this.esimPlanLabel(bundle);
      this.activeDescriptor = {
        kind: ORDER_KIND.ESIM_TOPUP,
        title: [country.flag, country.name].filter(Boolean).join(' '),
        meta: this.$t('{plan} added to your eSIM', { plan: planLabel }),
        createInvoice: () => purchaseEsimTopup({
          iccid: order.iccid,
          bundleName: bundle.bundleName,
          slug: country.slug,
        }),
        orderFields: (inv) => ({
          targetIccid: inv.iccid || order.iccid,
          countryName: country.name,
          countryCode: country.code,
          flag: country.flag,
          slug: country.slug,
          bundleName: bundle.bundleName,
          dataInGB: bundle.dataInGB,
          durationInDays: bundle.durationInDays,
          planLabel,
        }),
      };
      this.topupSheetOpen = false;
      this.purchaseSheetOpen = true;
    },

    // ── VPN: new purchase ────────────────────────────────────────────
    onVpnContinue({ duration, location }) {
      this.activeDescriptor = this.buildVpnDescriptor(duration, location);
      this.purchaseSheetOpen = true;
    },

    buildVpnDescriptor(duration, location) {
      // Generate the WireGuard keypair once, up front, so it is stable across
      // retries and is persisted with the order BEFORE the config is requested
      // — the server issues a config exactly once per payment, and a config
      // whose private key we never stored would be worthless.
      const keypair = generateWireGuardKeypair();
      const presharedKey = generatePresharedKey();
      const durationLabel = this.durationLabel(duration);
      const flagName = [location.flag, location.name].filter(Boolean).join(' ');
      return {
        kind: ORDER_KIND.VPN,
        title: flagName,
        meta: durationLabel,
        createInvoice: () => requestVpn({ duration: duration.value }),
        orderFields: () => ({
          // nadanada's own server id, which is what /vpn/config expects as
          // `country` (their spec's example value is this same id form).
          country: location.code,
          countryName: location.name,
          flag: location.flag,
          durationLabel,
          durationValue: duration.value,
          publicKey: keypair.publicKey,
          privateKey: keypair.privateKey,
          presharedKey,
        }),
      };
    },

    // ── VPN: extend an existing subscription ─────────────────────────
    onExtendRequest(order) {
      this.myProductsOpen = false;
      this.extend = {
        order,
        subtitle: [order.flag, order.countryName].filter(Boolean).join(' '),
      };
      this.extendSheetOpen = true;
      if (!this.vpn.loaded) this.loadVpnCatalog();
    },

    onExtendDurationSelect(duration) {
      const order = this.extend.order;
      if (!order?.publicKey) return;
      const durationLabel = this.durationLabel(duration);
      this.activeDescriptor = {
        kind: ORDER_KIND.VPN_EXTEND,
        title: [order.flag, order.countryName].filter(Boolean).join(' '),
        meta: this.$t('{duration} more', { duration: durationLabel }),
        createInvoice: () => requestVpnExtension({
          publicKey: order.publicKey,
          duration: duration.value,
        }),
        // The extension reuses the subscription's existing keys and server:
        // a new keypair here would create a second, unrelated tunnel. The
        // server names the country it is renewing, which beats our copy.
        orderFields: (inv) => ({
          country: inv.country || order.country,
          countryName: inv.countryName || order.countryName,
          flag: order.flag,
          durationLabel,
          durationValue: duration.value,
          publicKey: order.publicKey,
          privateKey: order.privateKey,
          presharedKey: order.presharedKey,
          extendsOrderId: order.id,
        }),
      };
      this.extendSheetOpen = false;
      this.purchaseSheetOpen = true;
    },

    // ── shared ───────────────────────────────────────────────────────
    /** The order is already in the ledger; this only closes the loop in the
     *  UI. A top-up or extension folds back into the product it renewed. */
    onPurchased(order) {
      if (!order) return;
      if (order.kind === ORDER_KIND.ESIM_TOPUP || order.kind === ORDER_KIND.VPN_EXTEND) {
        this.reopenProductsAfterPurchase = true;
      }
      if (order.kind === ORDER_KIND.ESIM_TOPUP && order.targetIccid) {
        // Force the target eSIM to re-fetch its usage next time it is shown.
        const target = this.store.esims.find((o) => o.iccid === order.targetIccid);
        if (target) this.store.patchOrder(target.id, { liveFetchedAt: null });
      }
      if (order.kind === ORDER_KIND.VPN_EXTEND && order.extendsOrderId) {
        this.store.patchOrder(order.extendsOrderId, { liveFetchedAt: null });
      }
    },

    /** A pre-ledger purchase was found and imported. Hand it to Your products
     *  so a product that came back is shown, not just filed away. */
    onRestored(order) {
      this.myProductsOpen = true;
      this.$nextTick(() => this.$refs.myProducts?.showRestored?.(order));
    },

    /** The user left a paid order behind. Point them at where it lives now,
     *  rather than letting it go quiet. */
    onBackgrounded(order) {
      if (!order) return;
      this.$q.notify?.({
        message: this.$t('Saved to Your products. We will keep trying.'),
        color: this.$q.dark.isActive ? 'grey-9' : 'grey-10',
        textColor: 'white',
        position: 'bottom',
        timeout: 3500,
        actions: [{
          label: this.$t('View'),
          color: 'green-4',
          handler: () => { this.myProductsOpen = true; },
        }],
      });
    },

    /** Attach a sats estimate (USD -> sats at the live rate) for display. The
     *  exact charge is read off the invoice in the purchase sheet; this is the
     *  catalog-time estimate, hence the "≈" in the UI. */
    async augmentSats(items) {
      return Promise.all(items.map(async (it) => {
        let priceSatsEstimate = null;
        if (Number.isFinite(it.priceUsd)) {
          try {
            const sats = await fiatRatesService.convertFiatToSats(it.priceUsd, 'USD');
            if (Number.isFinite(sats)) priceSatsEstimate = Math.round(sats);
          } catch { /* rate unavailable -> fall back to USD display */ }
        }
        return { ...it, priceSatsEstimate };
      }));
    },

    esimPlanLabel(bundle) {
      if (bundle.unlimited) return this.$t('Unlimited data');
      const gb = bundle.dataInGB != null ? `${bundle.dataInGB} GB` : '';
      const days = bundle.durationInDays != null ? this.$t('{n} days', { n: bundle.durationInDays }) : '';
      return [gb, days].filter(Boolean).join(' · ');
    },

    /** Localised "1 month" / "3 months" from the API's amount + unit pair.
     *  The API's own `duration` field is a price, not a length of time. */
    durationLabel(d) {
      const n = d?.amount ?? 1;
      switch (d?.unit) {
        case 'day': return this.$t('{n} days', { n });
        case 'week': return this.$t('{n} weeks', { n });
        case 'month': return this.$t('{n} months', { n });
        case 'year': return this.$t('{n} years', { n });
        default: return d?.label || '';
      }
    },
  },
};
</script>

<style scoped>
/* The page cancels the global .q-page top inset so the header can own it —
   see the header comment. The bottom inset uses var(--safe-bottom), not a bare
   env(), because Android WebViews report env(safe-area-inset-bottom) as 0 even
   with a nav bar present; boot/safe-area.js patches the variable. */
.shop-page { min-height: 100vh; padding-top: 0; padding-bottom: max(24px, var(--safe-bottom, 24px)); }
.shop-light { background: #FAF7EF; }
.shop-dark { background: #0C0C0C; }

.shop-header { display: flex; align-items: center; gap: 8px; padding: calc(8px + var(--safe-top, 0px)) 12px 8px; position: sticky; top: 0; z-index: 10; backdrop-filter: blur(8px); }
.shop-light .shop-header { background: rgba(250, 247, 239, 0.82); }
.shop-dark .shop-header { background: rgba(12, 12, 12, 0.82); }
.shop-header-title { flex: 1 1 auto; text-align: center; font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.shop-back { flex: 0 0 auto; position: relative; }
.mp-badge { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: #15a35b; color: #fff; font-family: 'Manrope', sans-serif; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
body.body--dark .mp-badge { background: #15DE72; color: #0c0c0c; }
.mp-badge--alert { background: #d97706; color: #fff; }
body.body--dark .mp-badge--alert { background: #fbbf24; color: #0c0c0c; }

/* Standing notice for undelivered orders. */
.attention-banner {
  all: unset;
  box-sizing: border-box;
  display: flex; align-items: center; gap: 10px;
  width: calc(100% - 32px); margin: 4px 16px 4px;
  min-height: 48px; padding: 10px 14px; border-radius: 14px;
  font-family: 'Manrope', sans-serif; font-size: 13.5px; font-weight: 600;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.attention-banner-light { background: rgba(247, 147, 26, 0.1); color: #92400e; box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.26); }
.attention-banner-dark { background: rgba(247, 147, 26, 0.14); color: #fbbf24; box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.3); }
.attention-banner:active { transform: scale(0.995); }
.attention-banner:focus-visible { outline: 2px solid #15DE72; outline-offset: 2px; }
.attention-icon, .attention-go { flex-shrink: 0; }
.attention-text { flex: 1 1 auto; min-width: 0; line-height: 1.35; }

.shop-tabs { display: flex; gap: 4px; margin: 4px 16px 8px; padding: 4px; border-radius: 999px; }
.shop-tabs-light { background: rgba(15, 23, 42, 0.05); }
.shop-tabs-dark { background: rgba(255, 255, 255, 0.06); }
.shop-tab { flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 38px; border: 0; border-radius: 999px; background: transparent; cursor: pointer; -webkit-tap-highlight-color: transparent; font-family: 'Manrope', sans-serif; font-size: 13.5px; font-weight: 600; letter-spacing: -0.005em; color: #64748b; transition: background-color 0.15s ease, color 0.15s ease; }
body.body--dark .shop-tab { color: #94a3b8; }
.shop-tab--active { background: #fff; color: #0f172a; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06); }
body.body--dark .shop-tab--active { background: rgba(21, 222, 114, 0.16); color: #f8fafc; box-shadow: none; }

.shop-body { padding: 8px 16px 16px; }

.shop-help-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 2px 12px; }
.shop-help-label { font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600; letter-spacing: -0.005em; }

.info-state { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; padding: 40px 16px; font-family: 'Manrope', sans-serif; font-size: 14px; line-height: 1.45; }
.retry-btn { border: 0; border-radius: 14px; height: 44px; padding: 0 20px; font-family: 'Manrope', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; }

.shop-footer { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 28px 16px 8px; }
.shop-footer-text { font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 500; }
.shop-footer-logo { height: 22px; width: 22px; border-radius: 6px; object-fit: cover; display: block; }
</style>
