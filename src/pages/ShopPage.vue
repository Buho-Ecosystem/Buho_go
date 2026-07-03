<template>
  <q-page class="shop-page" :class="$q.dark.isActive ? 'shop-dark' : 'shop-light'">
    <!-- Header -->
    <div class="shop-header">
      <q-btn flat round dense class="shop-back" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" :aria-label="$t('Back')" @click="$router.back()">
        <Icon icon="tabler:chevron-left" width="20" height="20" />
      </q-btn>
      <div class="shop-header-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">{{ $t('Shop') }}</div>
      <q-btn flat round dense class="shop-back" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" :aria-label="$t('My purchases')" @click="myPurchasesOpen = true">
        <Icon icon="tabler:receipt" width="20" height="20" />
        <span v-if="store.totalCount" class="mp-badge">{{ store.totalCount }}</span>
      </q-btn>
    </div>

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
            tone="brand"
            icon="tabler:world"
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

    <!-- eSIM bundle sheet -->
    <CountryBundlesSheet
      v-model="bundleSheetOpen"
      :country="activeCountry"
      :bundles="bundles.list"
      :loading="bundles.loading"
      :error="bundles.error"
      @select="onBundleSelect"
    />

    <!-- Shared purchase sheet -->
    <PurchaseSheet
      v-model="purchaseSheetOpen"
      :descriptor="activeDescriptor"
      @purchased="onPurchased"
    />

    <!-- My purchases -->
    <MyPurchases v-model="myPurchasesOpen" />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import { fiatRatesService } from '../utils/fiatRates.js';
import { useNadanadaPurchasesStore } from '../stores/nadanadaPurchases';
import {
  fetchEsimCountries, fetchEsimBundles, purchaseEsim, waitForEsim,
  fetchVpnCatalog, requestVpn, waitForVpnConfig,
  generateWireGuardKeypair, generatePresharedKey,
} from '../services/nadanada';
import DestinationGrid from '../components/shop/DestinationGrid.vue';
import CountryBundlesSheet from '../components/shop/CountryBundlesSheet.vue';
import VpnConfigurator from '../components/shop/VpnConfigurator.vue';
import PurchaseSheet from '../components/shop/PurchaseSheet.vue';
import MyPurchases from '../components/shop/MyPurchases.vue';
import ShopInfoTooltip from '../components/shop/ShopInfoTooltip.vue';

/**
 * Shop landing. One route, two tabs (Mobile data / VPN). All purchasing
 * happens in bottom sheets so the back stack stays flat. Builds the
 * product-agnostic purchase descriptors the PurchaseSheet consumes; persists
 * completed purchases to the local store (the only record, since nadanada has
 * no accounts).
 */
export default {
  name: 'ShopPage',
  components: { Icon, DestinationGrid, CountryBundlesSheet, VpnConfigurator, PurchaseSheet, MyPurchases, ShopInfoTooltip },

  setup() {
    const store = useNadanadaPurchasesStore();
    return { store };
  },

  data() {
    return {
      activeTab: 'esim',
      esim: { loading: false, error: '', countries: [], regions: [] },
      bundles: { loading: false, error: '', list: [] },
      vpn: { loading: false, error: '', durations: [], countries: [], loaded: false },
      activeCountry: null,
      activeDescriptor: null,
      bundleSheetOpen: false,
      purchaseSheetOpen: false,
      myPurchasesOpen: false,
    };
  },

  computed: {
    recentCountries() {
      const seen = new Set();
      const out = [];
      for (const e of this.store.esims) {
        if (!e.slug || seen.has(e.slug)) continue;
        seen.add(e.slug);
        out.push({ slug: e.slug, name: e.countryName || e.slug, flag: e.flag || '' });
        if (out.length >= 5) break;
      }
      return out;
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
  },

  methods: {
    // ── catalog loading ──────────────────────────────────────────────
    async loadEsimCatalog() {
      this.esim.loading = true;
      this.esim.error = '';
      try {
        const { countries } = await fetchEsimCountries();
        this.esim.countries = countries;
        // Regions are hidden for now: their purchase SKU differs from the
        // country `fixed_ -> esim_..._V2` transform and is not yet verified.
        // Re-enable by restoring `regions` here once confirmed with nadanada.
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

    // ── eSIM flow ────────────────────────────────────────────────────
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
      const buildReceipt = (esim) => ({
        kind: 'esim',
        iccid: esim.iccid,
        bundleName: esim.bundleName || bundle.bundleName,
        orderReference: esim.orderReference,
        installation: esim.installation,
        countryName: country.name,
        flag: country.isRegion ? '' : country.flag,
        slug: country.slug,
        dataInGB: bundle.dataInGB,
        durationInDays: bundle.durationInDays,
        priceUsd: bundle.priceUsd,
        planLabel,
        purchasedAt: Date.now(),
      });
      return {
        kind: 'esim',
        title: flagName,
        meta: planLabel,
        createInvoice: async () => {
          const inv = await purchaseEsim({ bundleName: bundle.bundleName, slug: country.slug });
          return {
            paymentRequest: inv.paymentRequest,
            paymentHash: inv.paymentHash,
            priceUsd: inv.priceUsd,
            originalPriceUsd: inv.originalPriceUsd,
            expiresAt: inv.expiresAt,
            ctx: { country, bundle },
          };
        },
        fulfill: async ({ paymentHash, signal, expiresAt }) => {
          const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
          const res = await waitForEsim({ paymentHash, signal, deadline: Number.isFinite(deadline) ? deadline : undefined });
          return res.ok ? { ok: true, receipt: buildReceipt(res.esim) } : { ok: false };
        },
        // Single-shot settlement check (one attempt), used after a payInvoice
        // error to catch the errored-yet-settled case without re-paying.
        probeSettled: async ({ paymentHash }) => {
          const res = await waitForEsim({ paymentHash, maxMs: 1 });
          return res.ok ? { ok: true, receipt: buildReceipt(res.esim) } : { ok: false };
        },
      };
    },

    // ── VPN flow ─────────────────────────────────────────────────────
    onVpnContinue({ duration, location }) {
      this.activeDescriptor = this.buildVpnDescriptor(duration, location);
      this.purchaseSheetOpen = true;
    },

    buildVpnDescriptor(duration, location) {
      // Generate the WireGuard keypair once, up front, so it is stable across
      // config-poll retries and can be persisted with the finished config.
      const keypair = generateWireGuardKeypair();
      const presharedKey = generatePresharedKey();
      const flagName = [location.flag, location.name].filter(Boolean).join(' ');
      const buildReceipt = (res) => ({
        kind: 'vpn',
        publicKey: res.publicKey,
        privateKey: res.privateKey,
        presharedKey: res.presharedKey,
        config: res.config,
        country: location.code,
        countryName: location.name,
        flag: location.flag,
        durationLabel: duration.label,
        priceUsd: duration.priceUsd,
        purchasedAt: Date.now(),
      });
      // `location.code` is nadanada's internal server id. Verify on a live VPN
      // purchase whether the config endpoint wants this or the ISO code.
      return {
        kind: 'vpn',
        title: flagName,
        meta: duration.label,
        createInvoice: async () => {
          const inv = await requestVpn({ duration: duration.value });
          return {
            paymentRequest: inv.paymentRequest,
            paymentHash: inv.paymentHash,
            priceUsd: inv.priceUsd,
            expiresAt: inv.expiresAt,
            ctx: { location, duration },
          };
        },
        fulfill: async ({ paymentHash, signal, expiresAt }) => {
          const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
          const res = await waitForVpnConfig({
            paymentHash, country: location.code, keypair, presharedKey, signal,
            deadline: Number.isFinite(deadline) ? deadline : undefined,
          });
          return res.ok ? { ok: true, receipt: buildReceipt(res) } : { ok: false };
        },
        probeSettled: async ({ paymentHash }) => {
          const res = await waitForVpnConfig({ paymentHash, country: location.code, keypair, presharedKey, maxMs: 1 });
          return res.ok ? { ok: true, receipt: buildReceipt(res) } : { ok: false };
        },
      };
    },

    // ── shared ───────────────────────────────────────────────────────
    onPurchased(receipt) {
      if (!receipt) return;
      if (receipt.kind === 'esim') this.store.addEsim(receipt);
      else if (receipt.kind === 'vpn') this.store.addVpn(receipt);
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
  },
};
</script>

<style scoped>
.shop-page { min-height: 100vh; padding-bottom: max(24px, env(safe-area-inset-bottom, 0px)); }
.shop-light { background: #FAF7EF; }
.shop-dark { background: #0C0C0C; }

.shop-header { display: flex; align-items: center; gap: 8px; padding: max(8px, env(safe-area-inset-top, 0px)) 12px 8px; position: sticky; top: 0; z-index: 10; backdrop-filter: blur(8px); }
.shop-light .shop-header { background: rgba(250, 247, 239, 0.82); }
.shop-dark .shop-header { background: rgba(12, 12, 12, 0.82); }
.shop-header-title { flex: 1 1 auto; text-align: center; font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.shop-back { flex: 0 0 auto; position: relative; }
.mp-badge { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: #15a35b; color: #fff; font-family: 'Manrope', sans-serif; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
body.body--dark .mp-badge { background: #15DE72; color: #0c0c0c; }

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
