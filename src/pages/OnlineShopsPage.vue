<template>
  <q-page class="online-page" :class="$q.dark.isActive ? 'online-dark' : 'online-light'">
    <!-- Sticky controls: header, facet tabs, search and category chips stay
         pinned while the shop list scrolls underneath. -->
    <div class="online-topbar">
      <!-- Header -->
      <div class="online-header">
        <q-btn flat round dense class="online-back" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" :aria-label="$t('Back')" @click="$router.back()">
          <Icon icon="tabler:chevron-left" width="20" height="20" />
        </q-btn>
        <div class="online-header-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">{{ $t('Spend online') }}</div>
        <ShopInfoTooltip
          tone="brand"
          icon="tabler:building-store"
          trigger-icon="tabler:help"
          :aria-label="$t('How this works')"
          :title="$t('How this works')"
          :lede="$t('A directory of online shops that take Bitcoin.')"
          :steps="helpSteps"
        />
      </div>

      <!-- Facet tabs -->
      <div class="shop-tabs" :class="$q.dark.isActive ? 'shop-tabs-dark' : 'shop-tabs-light'">
        <button type="button" class="shop-tab" :class="{ 'shop-tab--active': store.facet === 'shops' }" @click="store.setFacet('shops')">
          <Icon icon="tabler:building-store" width="17" height="17" />
          <span>{{ $t('Shops') }}</span>
        </button>
        <button type="button" class="shop-tab" :class="{ 'shop-tab--active': store.facet === 'nostr' }" @click="store.setFacet('nostr')">
          <Icon icon="tabler:bolt" width="17" height="17" />
          <span>{{ $t('Nostr markets') }}</span>
        </button>
      </div>

      <!-- Search + filters -->
      <div class="online-controls">
        <label class="search-field" :class="$q.dark.isActive ? 'field-input-wrap-dark' : 'field-input-wrap-light'">
          <Icon icon="tabler:search" width="18" height="18" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'" />
          <input :value="store.filters.search" type="text" :placeholder="$t('Search shops')" spellcheck="false" autocomplete="off" class="search-input" :class="$q.dark.isActive ? 'field-input-dark' : 'field-input-light'" @input="onSearch" />
        </label>
        <button type="button" class="filters-btn" :class="$q.dark.isActive ? 'filters-btn-dark' : 'filters-btn-light'" :aria-label="$t('Filters')" @click="filterOpen = true">
          <Icon icon="tabler:adjustments-horizontal" width="18" height="18" />
          <span v-if="store.activeFilterCount" class="filters-badge">{{ store.activeFilterCount }}</span>
        </button>
      </div>

      <!-- Category chips -->
      <div v-if="store.categoriesPresent.length" class="chip-scroller">
        <button type="button" class="cat-chip" :class="[$q.dark.isActive ? 'cat-chip-dark' : 'cat-chip-light', { 'cat-chip--on': store.filters.category === 'all' }]" @click="store.setCategory('all')">{{ $t('All') }}</button>
        <button v-for="cat in store.categoriesPresent" :key="cat" type="button" class="cat-chip" :class="[$q.dark.isActive ? 'cat-chip-dark' : 'cat-chip-light', { 'cat-chip--on': store.filters.category === cat }]" @click="store.setCategory(cat)">
          <Icon :icon="categoryIcon(cat)" width="14" height="14" />
          <span>{{ categoryLabel(cat) }}</span>
        </button>
      </div>
    </div>

    <!-- Scrollable region: the only part that moves while the topbar stays put. -->
    <div class="online-body">
      <!-- Nostr explainer (scrolls with the list, not part of the fixed bar) -->
      <div v-if="store.facet === 'nostr'" class="nostr-banner" :class="$q.dark.isActive ? 'nostr-banner-dark' : 'nostr-banner-light'">
        <Icon icon="tabler:bolt" width="16" height="16" />
        <span>{{ $t('Markets run by independent sellers on Nostr. Pay sellers directly over Lightning. BuhoGO does not run these markets.') }}</span>
      </div>

      <!-- Loading -->
      <div v-if="isLoading && !currentList.length" class="row-list">
        <div v-for="n in 8" :key="n" class="skeleton-row" :class="$q.dark.isActive ? 'skeleton-dark' : 'skeleton-light'"></div>
      </div>

      <!-- Hard error (nothing loaded) -->
      <div v-else-if="hardError" class="info-state" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
        <Icon icon="tabler:cloud-off" width="24" height="24" />
        <span>{{ $t("Couldn't load shops. Try again.") }}</span>
        <button type="button" class="retry-btn" :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'" @click="store.retry()">{{ $t('Try again') }}</button>
      </div>

      <template v-else>
        <!-- Partial-degrade banner -->
        <div v-if="partialError" class="partial-banner" :class="$q.dark.isActive ? 'partial-banner-dark' : 'partial-banner-light'" role="alert">
          <span>{{ $t('Some shops could not load. Retry.') }}</span>
          <button type="button" @click="store.retry()">{{ $t('Try again') }}</button>
        </div>

        <!-- Results -->
        <div v-if="store.filtered.length" class="row-list">
          <ShopCard v-for="shop in store.filtered" :key="shop.id" :shop="shop" @select="openDetail" />
        </div>

        <!-- Empty -->
        <div v-else class="info-state" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
          <Icon icon="tabler:search-off" width="24" height="24" />
          <span>{{ store.facet === 'nostr' && !store.market.length ? $t('No markets found right now.') : $t('No shops match') }}</span>
          <span class="info-sub">{{ $t('Try a different category or clear your filters') }}</span>
          <button v-if="store.hasActiveQuery" type="button" class="retry-btn" :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'" @click="store.resetFilters()">{{ $t('Clear filters') }}</button>
        </div>
      </template>

      <!-- Attribution -->
      <div class="online-footer" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
        {{ $t('Data from BitcoinListings.org, BTCPay Server Directory, and Nostr') }}
      </div>
    </div>

    <ShopFilterSheet v-model="filterOpen" />
    <ShopDetailSheet v-model="detailOpen" :shop="activeShop" />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useOnlineShopsStore } from '../stores/onlineShops';
import { SHOP_CATEGORY_ICONS, SHOP_CATEGORY_LABELS } from '../services/onlineShops';
import ShopCard from '../components/onlineShops/ShopCard.vue';
import ShopFilterSheet from '../components/onlineShops/ShopFilterSheet.vue';
import ShopDetailSheet from '../components/onlineShops/ShopDetailSheet.vue';
import ShopInfoTooltip from '../components/shop/ShopInfoTooltip.vue';

/**
 * Online-shops directory page. One route, two facets (Shops / Nostr markets).
 * Discover -> detail sheet -> Visit shop (in-app browser) or Pay with BuhoGO.
 */
export default {
  name: 'OnlineShopsPage',
  components: { Icon, ShopCard, ShopFilterSheet, ShopDetailSheet, ShopInfoTooltip },
  setup() {
    return { store: useOnlineShopsStore() };
  },
  data() {
    return { filterOpen: false, detailOpen: false, activeShop: null, searchTimer: null };
  },
  computed: {
    helpSteps() {
      return [
        this.$t('Browse or search shops by category and country.'),
        this.$t('Tap Visit shop to open their site in a secure in-app browser.'),
        this.$t('Pay in Bitcoin at their checkout, or tap Pay with BuhoGO when a Lightning address is shown.'),
      ];
    },
    currentList() {
      return this.store.facet === 'nostr' ? this.store.market : this.store.directory;
    },
    isLoading() {
      return this.store.facet === 'nostr' ? this.store.loading.market : this.store.loading.directory;
    },
    hardError() {
      // Nothing in the active facet AND every relevant source errored.
      if (this.currentList.length) return false;
      if (this.store.facet === 'nostr') return !!this.store.errors.nostr && this.store.loadedMarket;
      return !!this.store.errors.listings && !!this.store.errors.btcpay && this.store.loadedDirectory;
    },
    partialError() {
      if (this.store.facet === 'nostr') return false;
      const e = this.store.errors;
      return (!!e.listings || !!e.btcpay) && !this.hardError && this.store.directory.length > 0;
    },
  },
  created() {
    this.store.loadDirectory();
  },
  beforeUnmount() {
    clearTimeout(this.searchTimer);
  },
  methods: {
    onSearch(e) {
      const v = e.target.value;
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.store.setSearch(v), 250);
    },
    categoryIcon(cat) { return SHOP_CATEGORY_ICONS[cat] || SHOP_CATEGORY_ICONS.other; },
    categoryLabel(cat) {
      // Flat full-text key (the app's convention); avoids vue-i18n dotted-key
      // nesting. SHOP_CATEGORY_LABELS supplies both the key and the en value.
      return this.$t(SHOP_CATEGORY_LABELS[cat] || SHOP_CATEGORY_LABELS.other);
    },
    openDetail(shop) {
      this.activeShop = shop;
      this.detailOpen = true;
    },
  },
};
</script>

<style scoped>
/* Fixed-height flex column: the page never scrolls itself. The topbar is a
   static row and .online-body is the single bounded scroll container, so the
   controls stay put regardless of WebView quirks with page-level sticky.
   Mirrors the proven pattern in TransactionHistory.vue. */
.online-page { height: 100vh; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
.online-light { background: #FAF7EF; }
.online-dark { background: #0C0C0C; }

/* The control cluster is a fixed flex row; only .online-body below it scrolls. */
.online-topbar { flex: 0 0 auto; }
.online-light .online-topbar { background: #FAF7EF; border-bottom: 1px solid rgba(15, 23, 42, 0.06); }
.online-dark .online-topbar { background: #0C0C0C; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }

.online-header { display: flex; align-items: center; gap: 8px; padding: max(8px, env(safe-area-inset-top, 0px)) 12px 8px; }
.online-header-title { flex: 1 1 auto; text-align: center; font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.online-back { flex: 0 0 auto; }

.shop-tabs { display: flex; gap: 4px; margin: 4px 16px 8px; padding: 4px; border-radius: 999px; }
.shop-tabs-light { background: rgba(15, 23, 42, 0.05); }
.shop-tabs-dark { background: rgba(255, 255, 255, 0.06); }
.shop-tab { flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 38px; border: 0; border-radius: 999px; background: transparent; cursor: pointer; -webkit-tap-highlight-color: transparent; font-family: 'Manrope', sans-serif; font-size: 13.5px; font-weight: 600; color: #64748b; transition: background-color 0.15s ease, color 0.15s ease; }
body.body--dark .shop-tab { color: #94a3b8; }
.shop-tab--active { background: #fff; color: #0f172a; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06); }
body.body--dark .shop-tab--active { background: rgba(21, 222, 114, 0.16); color: #f8fafc; box-shadow: none; }

.online-controls { display: flex; align-items: center; gap: 10px; padding: 0 16px 10px; }
.search-field { flex: 1 1 auto; display: flex; align-items: center; gap: 8px; border-radius: 12px; border: 1px solid transparent; padding: 0 12px; }
.field-input-wrap-light { background: rgba(15, 23, 42, 0.04); border-color: rgba(15, 23, 42, 0.08); }
.field-input-wrap-light:focus-within { background: #fff; border-color: rgba(15, 23, 42, 0.32); }
.field-input-wrap-dark { background: rgba(255, 255, 255, 0.04); border-color: rgba(255, 255, 255, 0.06); }
.field-input-wrap-dark:focus-within { background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.28); }
.search-input { flex: 1 1 auto; width: 100%; border: 0; outline: none; padding: 11px 0; background: transparent; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 500; }
.field-input-light { color: #0f172a; }
.field-input-dark { color: #f8fafc; }
.field-input-light::placeholder { color: rgba(15, 23, 42, 0.45); }
.field-input-dark::placeholder { color: rgba(255, 255, 255, 0.45); }
.filters-btn { position: relative; flex: 0 0 auto; width: 44px; height: 44px; border: 0; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.filters-btn-light { background: rgba(15, 23, 42, 0.05); color: #0f172a; }
.filters-btn-dark { background: rgba(255, 255, 255, 0.06); color: #f8fafc; }
.filters-badge { position: absolute; top: 4px; right: 4px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: #15a35b; color: #fff; font-family: 'Manrope', sans-serif; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
body.body--dark .filters-badge { background: #15de72; color: #0c0c0c; }

.chip-scroller { display: flex; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 0 16px 10px; }
.cat-chip { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; border: 0; border-radius: 999px; padding: 8px 13px; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; white-space: nowrap; }
.cat-chip-light { background: rgba(15, 23, 42, 0.05); color: #334155; }
.cat-chip-dark { background: rgba(255, 255, 255, 0.06); color: #cbd5e1; }
.cat-chip--on { background: rgba(21, 222, 114, 0.12); color: #0e7b3f; }
body.body--dark .cat-chip--on { background: rgba(21, 222, 114, 0.18); color: #6ee7a8; }

.nostr-banner { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 12px; padding: 10px 12px; border-radius: 12px; font-family: 'Manrope', sans-serif; font-size: 12.5px; line-height: 1.4; }
.nostr-banner-light { background: rgba(247, 147, 26, 0.08); color: #b45309; }
.nostr-banner-dark { background: rgba(247, 147, 26, 0.14); color: #fbbf24; }

/* The one scroll container. min-height:0 lets this flex child shrink below its
   content so overflow-y actually scrolls (the classic flexbox scroll gotcha). */
.online-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 12px 16px max(24px, env(safe-area-inset-bottom, 0px)); }
.row-list { display: flex; flex-direction: column; gap: 8px; }
.skeleton-row { height: 72px; border-radius: 16px; }
.skeleton-light { background: rgba(15, 23, 42, 0.05); animation: pulse 1.4s ease-in-out infinite; }
.skeleton-dark { background: rgba(255, 255, 255, 0.05); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) { .skeleton-light, .skeleton-dark { animation: none; } }

.info-state { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 44px 16px; font-family: 'Manrope', sans-serif; font-size: 14px; line-height: 1.45; }
.info-sub { font-size: 12.5px; opacity: 0.8; }
.retry-btn { border: 0; border-radius: 14px; height: 44px; padding: 0 20px; font-family: 'Manrope', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 4px; }

.partial-banner { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; padding: 8px 12px; border-radius: 10px; font-family: 'Manrope', sans-serif; font-size: 12.5px; }
.partial-banner-light { background: rgba(245, 158, 11, 0.10); color: #b45309; }
.partial-banner-dark { background: rgba(245, 158, 11, 0.14); color: #fbbf24; }
.partial-banner button { all: unset; font-weight: 700; cursor: pointer; text-decoration: underline; -webkit-tap-highlight-color: transparent; }

.online-footer { padding: 18px 8px 8px; text-align: center; font-family: 'Manrope', sans-serif; font-size: 11.5px; font-weight: 500; }
</style>
