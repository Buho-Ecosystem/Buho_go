<template>
  <q-page class="kiosk-owner identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <div v-if="loading" class="ko-centered" role="status"><q-spinner size="28px" /><p>{{ $t('Opening your register…') }}</p></div>
    <div v-else-if="loadError" class="ko-centered" role="alert"><h1>{{ $t('Your records need attention') }}</h1><p>{{ $t('We could not open the saved register. Keep this device data and try again before taking a payment.') }}</p><button class="ko-primary" @click="initialize">{{ $t('Try again') }}</button><button class="ko-plain" @click="$router.push('/settings')">{{ $t('Settings') }}</button></div>
    <KioskOnboarding
      v-else-if="setupStep"
      :step="setupStep"
      v-model:intro="introOpen"
      :wallet="setupWallet"
      :currency="setupCurrency"
      :currencies="currencies"
      :currency-locked="currencyLocked"
      :can-continue="!!setupWallet && !setupWallet.blocked"
      :needs-wallet-setup="!eligibleWallets.length"
      :busy="busy"
      :error="error"
      @start="startSetup"
      @back="setupBack"
      @wallet="walletSheetOpen = true"
      @currency="setupCurrency = $event"
      @next="confirmDefaults"
      @connect-wallet="connectWallet"
      @open-register="openRegister"
      @open-transfers="finishToTransfers"
    >
      <template #pin><KioskPinPad ref="setupPad" :title="firstPin ? $t('kiosk.confirmPin') : $t('kiosk.setupPin')" :error-message="pinError" :disabled="busy" @complete="setupPin" /></template>
    </KioskOnboarding>
    <template v-else>
      <KioskToolbar
        :title="title"
        :back-label="view === 'home' ? $t('Settings') : $t('Back')"
        :search-enabled="view === 'products' || view === 'sales'"
        v-model:search-open="searchOpen"
        v-model:search-value="search"
        :search-placeholder="view === 'products' ? $t('Search products') : $t('Search sales')"
        :actions="toolbarActions"
        @back="back"
        @action="toolbarAction"
        @search-cancel="restoreBrowse"
      />
      <p v-if="error" class="ko-error" role="alert">{{ error }}</p>
      <template v-if="view === 'products'">
        <p class="ko-context">{{ $t('Saved on this device') }} · {{ merchant.catalogCurrency }}</p>
        <KioskProducts ref="catalog" :products="merchant.products" :categories="merchant.categories" :search="search" v-model:category="category" :format-price="productPrice" :manage="true" :disabled="busy" :scroll-top="catalogScroll" :empty-action-label="$t('Add product')" @edit="editProduct" @manage="editProduct()" @clear-filters="resetSearch" @scroll="catalogScroll = $event" />
      </template>
      <div v-else-if="view === 'receipt' && selectedSale" class="ko-receipt"><KioskReceipt :sale="selectedSale" :format-currency="money" :format-sats="sats" :format-date="date" /><p v-if="selectedSale.duplicatePayment" class="ko-error" role="status">{{ $t('More than one payment was received. Review the payment details.') }}</p></div>
      <div v-else-if="view === 'receipt'" class="ko-centered"><h2>{{ $t('This receipt is unavailable') }}</h2><p>{{ $t('Return to sales to choose another receipt.') }}</p><button class="ko-plain" @click="go('sales')">{{ $t('Sales and activity') }}</button></div>
      <div v-else-if="view === 'sales'" class="ko-sales">
        <div class="ko-filters">
          <label class="ko-sr" for="ko-period">{{ $t('Period') }}</label><select id="ko-period" v-model="period"><option value="today">{{ $t('Today') }}</option><option value="week">{{ $t('Last 7 days') }}</option><option value="all">{{ $t('All time') }}</option></select>
          <label class="ko-sr" for="ko-status">{{ $t('Payment status') }}</label><select id="ko-status" v-model="statusFilter"><option value="all">{{ $t('All statuses') }}</option><option value="paid">{{ $t('Paid') }}</option><option value="waiting">{{ $t('Waiting') }}</option><option value="attention">{{ $t('Needs attention') }}</option></select>
          <label v-if="saleCurrencies.length > 1" class="ko-sr" for="ko-sale-currency">{{ $t('Currency') }}</label><select v-if="saleCurrencies.length > 1" id="ko-sale-currency" v-model="saleCurrency"><option value="">{{ $t('All currencies') }}</option><option v-for="code in saleCurrencies" :key="code" :value="code">{{ code }}</option></select>
        </div>
        <q-virtual-scroll ref="salesList" class="ko-scroll ko-sales-scroll" :items="visibleSales" :virtual-scroll-item-size="78" :virtual-scroll-slice-size="20" :aria-label="$t('Sales and activity')" @scroll.passive="salesScroll = $event.target.scrollTop">
          <template #before>
          <div v-if="summary.length" class="ko-summary" :aria-label="$t('Sales summary')">
            <section v-for="group in summary" :key="group.currency">
              <div class="ko-summary-main"><span>{{ $t('Base sales') }} · {{ group.currency }}</span><strong>{{ group.minor == null ? sats(group.baseSats) : money(group.minor, group.currency) }}</strong></div>
              <p>{{ $t('{n} paid sales', { n: group.count }) }} · {{ $t('Average {amount}', { amount: group.minor == null ? sats(Math.floor(group.baseSats / group.count)) : money(Math.round(group.minor / group.count), group.currency) }) }}</p>
              <p v-if="group.extrasSats">{{ $t('Extras') }} {{ sats(group.extrasSats) }}</p>
            </section>
          </div>
          <p class="ko-context ko-context--inset">{{ $t('Saved on this device') }}</p>
          </template>
          <template #default="{ item: sale }">
          <button :key="sale.id" class="ko-sale-row" type="button" @click="openReceipt(sale)"><span><strong>{{ sale.label || sale.items[0]?.name || $t('Sale') }}</strong><small>{{ date(sale.paidAt || sale.createdAt) }} · {{ statusText(sale) }}<template v-if="sale.duplicatePayment"> · {{ $t('Needs attention') }}</template></small></span><span class="ko-sale-amount">{{ receiptTotal(sale) }}<small v-if="sale.totalMinor != null">{{ sats(sale.totalSats) }}</small></span><Icon icon="tabler:chevron-right" width="17" height="17" /></button>
          </template>
          <template #after>
          <div v-if="!visibleSales.length" class="ko-centered ko-empty"><Icon icon="tabler:receipt" width="32" height="32" /><h2>{{ $t('No sales to show') }}</h2><p>{{ search ? $t('Try another name or clear the filters.') : $t('Your register payments appear here.') }}</p><button v-if="search || statusFilter !== 'all' || period !== 'all'" class="ko-plain" @click="clearSalesFilters">{{ $t('Clear filters') }}</button></div>
          </template>
        </q-virtual-scroll>
      </div>
      <div v-else-if="view === 'categories'" class="ko-scroll ko-body">
        <IdentityGroup v-if="merchant.categories.length"><IdentityRow v-for="name in merchant.categories" :key="name" :label="name" :caption="$t('{n} products', { n: merchant.products.filter(product => product.category === name).length })" @click="editCategory(name)" /></IdentityGroup>
        <div v-else class="ko-centered ko-empty"><h2>{{ $t('Group your products') }}</h2><p>{{ $t('Categories help you find products at the counter.') }}</p></div>
        <button class="ko-primary" @click="editCategory()">{{ $t('Add category') }}</button>
      </div>
      <div v-else-if="view === 'baskets'" class="ko-scroll ko-body">
        <IdentityGroup v-if="merchant.savedBaskets.length" :footer="$t('Saved baskets keep their original prices.')"><IdentityRow v-for="basket in merchant.savedBaskets" :key="basket.id" :label="basket.name" :caption="$t('{n} items', { n: basket.draft.items.reduce((count, item) => count + item.qty, 0) })" @click="basketActions(basket)" /></IdentityGroup>
        <div v-else class="ko-centered ko-empty"><Icon icon="tabler:shopping-bag" width="32" height="32" /><h2>{{ $t('No saved baskets') }}</h2><p>{{ $t('Save a basket from the register and return to it later.') }}</p></div>
      </div>
      <div v-else-if="view === 'settings'" class="ko-scroll ko-body">
        <IdentityGroup :title="$t('Payments')">
          <IdentityRow :label="$t('Receiving Wallet')" :caption="receivingWallet?.blocked ? receivingWallet.caption : ''" @click="walletSheetOpen = true"><template #trailing><span class="ko-value">{{ receivingWallet?.name || $t('Choose') }}</span></template></IdentityRow>
          <IdentityRow :label="$t('Price currency')" :caption="$t('Existing products keep their pricing currency.')" :interactive="false" wrap><template #trailing><select :value="merchant.catalogCurrency" :disabled="currencyLocked || busy" :aria-label="$t('Price currency')" @change="changeCurrency($event.target.value)"><option v-for="code in currencies" :key="code" :value="code">{{ code }}</option></select></template></IdentityRow>
          <IdentityRow :label="$t('Withdraw and Auto-Transfer')" @click="go('payouts')" />
        </IdentityGroup>
        <IdentityGroup :title="$t('Checkout')">
          <IdentityRow :label="$t('Tips')" :interactive="false"><template #trailing><q-toggle :model-value="walletStore.kioskTipEnabled" color="positive" :disable="busy" :aria-label="$t('Tips')" @update:model-value="value => run(() => walletStore.setKioskTipEnabled(value))" /></template></IdentityRow>
          <div v-if="walletStore.kioskTipEnabled" class="ko-tip-fields"><label v-for="(value,index) in walletStore.kioskTipValues" :key="index"><span>{{ $t('Tip choice {n}', { n: index + 1 }) }}</span><span class="ko-tip-input"><input :value="value" type="number" min="0" max="100" step="1" :disabled="busy" @change="setTip(index, $event.target.value)" />%</span></label></div>
          <IdentityRow :label="$t('kiosk.roundUp')" :caption="$t('kiosk.roundUpDesc')" :interactive="false" wrap><template #trailing><q-toggle :model-value="walletStore.kioskRoundUpEnabled" color="positive" :disable="busy" :aria-label="$t('kiosk.roundUp')" @update:model-value="value => run(() => walletStore.setKioskRoundUpEnabled(value))" /></template></IdentityRow>
        </IdentityGroup>
        <IdentityGroup :title="$t('Owner access')" :footer="$t('You need your PIN to leave the register. It is never shown.')"><IdentityRow :label="$t('Change PIN')" @click="pinSheetOpen = true" /><IdentityRow :label="$t('Turn off Kiosk Mode')" danger @click="disableKiosk" /></IdentityGroup>
        <IdentityGroup :title="$t('Register data')" :footer="$t('Products and itemized sales are saved on this device. Your wallet recovery phrase does not restore them. Keep a register backup before clearing browser data.')"><IdentityRow :label="$t('Export register backup')" @click="exportBackup" /><IdentityRow :label="$t('Restore register backup')" :caption="merchant.canRestore ? $t('Restore into this empty register') : $t('Restore is available in an empty register')" :interactive="merchant.canRestore && !busy" @click="$refs.backupInput.click()" /></IdentityGroup>
        <input ref="backupInput" class="ko-sr" type="file" accept="application/json,.json" tabindex="-1" :aria-label="$t('Restore register backup')" @change="restoreBackup" />
      </div>
      <div v-else-if="view === 'payouts'" class="ko-scroll ko-body">
        <IdentityGroup :footer="$t('Your wallet balance includes payments outside this register.')"><IdentityRow :label="receivingWallet?.name || $t('Receiving Wallet')" :caption="receivingWallet?.caption || ''" :interactive="false" /><IdentityRow :label="$t('Withdraw now')" icon="tabler:arrow-up-right" @click="withdrawOpen = true" /></IdentityGroup>
        <IdentityGroup :title="$t('Auto-Transfer')" :footer="$t('Rules run while BuhoGO is open and connected. Fees are checked at each transfer.')">
          <IdentityRow v-if="transferRule" :label="transferDestination || $t('Destination')" :caption="transferStatus" @click="autoTransferOpen = true" />
          <IdentityRow v-else :label="$t('Set up Auto-Transfer')" :caption="$t('Choose when and where your takings move.')" @click="autoTransferOpen = true" />
          <IdentityRow v-if="transferRule" :label="$t('Auto-Transfer')" :interactive="false"><template #trailing><q-toggle :model-value="transferRule.enabled" color="positive" :disable="busy" :aria-label="$t('Auto-Transfer')" @update:model-value="value => run(() => autoTransfer.setEnabled(walletStore.kioskWalletId, value))" /></template></IdentityRow>
        </IdentityGroup>
        <p class="ko-note">{{ $t('Available destinations depend on the selected wallet. Bitcoin addresses are available for Auto-Transfer from Spark wallets.') }}</p>
        <button v-if="transferRule" class="ko-plain" @click="$router.push(`/auto-transfer/${walletStore.kioskWalletId}`)">{{ $t('Transfer history and details') }}</button>
      </div>
      <div v-else class="ko-scroll ko-body">
        <button class="ko-primary ko-open" :disabled="busy" @click="openRegister"><Icon icon="tabler:device-mobile" width="20" height="20" />{{ $t('Open register') }}</button>
        <IdentityGroup :title="$t('At the counter')"><IdentityRow :label="$t('Products')" icon="tabler:package" :caption="$t('{n} products', { n: merchant.products.length })" @click="go('products')" /><IdentityRow :label="$t('Saved baskets')" icon="tabler:shopping-bag" :caption="$t('{n} baskets', { n: merchant.savedBaskets.length })" @click="go('baskets')" /></IdentityGroup>
        <IdentityGroup :title="$t('Your business')"><IdentityRow :label="$t('Sales and activity')" icon="tabler:receipt" @click="go('sales')" /><IdentityRow :label="$t('Withdraw and Auto-Transfer')" icon="tabler:arrow-up-right" @click="go('payouts')" /><IdentityRow :label="$t('Register settings')" icon="tabler:adjustments-horizontal" @click="go('settings')" /></IdentityGroup>
      </div>
    </template>
    <KioskWalletSheet v-model="walletSheetOpen" :options="walletOptions" :selected="setupStep ? setupWalletId : walletStore.kioskWalletId || ''" @select="setWallet" />
    <KioskPinSheet v-model="pinSheetOpen" :heading="$t('Change PIN')" :changing="true" @done="pin => run(() => walletStore.changeKioskPin(pin))" />
    <AutoTransferSheet v-model="autoTransferOpen" :wallet-id="walletStore.kioskWalletId || ''" :editing="!!transferRule" @saved="autoTransferOpen = false" />
    <KioskWithdraw v-if="withdrawOpen" :source-wallet-id="walletStore.kioskWalletId" @close="withdrawOpen = false" />
    <q-dialog v-model="menuOpen" position="bottom"><q-card class="ko-sheet" :aria-label="$t('More actions')"><div class="form-sheet-grabber" aria-hidden="true"></div><header class="ko-sheet-header"><h2>{{ $t('More actions') }}</h2><button class="ko-icon" :aria-label="$t('Close')" @click="menuOpen = false"><Icon icon="tabler:x" width="21" height="21" /></button></header><button v-for="action in moreActions" :key="action.id" class="ko-menu-action" :disabled="action.disabled || busy" @click="performMore(action.id)"><Icon :icon="action.icon" width="21" height="21" />{{ action.label }}</button></q-card></q-dialog>
    <q-dialog v-model="editorOpen" position="bottom" :persistent="busy"><q-card class="ko-sheet ko-editor"><form @submit.prevent="saveEditor"><div class="form-sheet-grabber" aria-hidden="true"></div><header class="ko-sheet-header"><button class="ko-icon" :aria-label="$t('Cancel')" :disabled="busy" type="button" @click="editorOpen = false"><Icon icon="tabler:x" width="21" height="21" /></button><h2>{{ editorTitle }}</h2><span class="ko-icon"></span></header><div class="ko-editor-fields"><label>{{ editorType === 'label' ? $t('Sale label') : $t('Name') }}<input ref="editorName" v-model="editor.name" maxlength="160" :disabled="busy" :required="editorType !== 'label'" :aria-label="editorType === 'label' ? $t('Sale label') : $t('Name')" enterkeyhint="next" /></label><template v-if="editorType === 'product'"><label>{{ $t('Price') }} · {{ merchant.catalogCurrency }}<input v-model="editor.price" inputmode="decimal" autocomplete="off" :disabled="busy" :aria-label="$t('Price')" required placeholder="0.00" /></label><label>{{ $t('Category') }}<select v-model="editor.category" :disabled="busy"><option value="">{{ $t('No category') }}</option><option v-for="name in merchant.categories" :key="name" :value="name">{{ name }}</option></select></label></template><p v-if="editorError" class="ko-error" role="alert">{{ editorError }}</p><button class="ko-primary" type="submit" :disabled="busy"><q-spinner v-if="busy" size="18px" /><template v-else>{{ $t('Save') }}</template></button><button v-if="editor.id && editorType !== 'label'" class="ko-danger" type="button" :disabled="busy" @click="deleteEdited">{{ $t('Delete') }}</button></div></form></q-card></q-dialog>
    <q-dialog v-model="detailsOpen" position="bottom"><q-card class="ko-sheet ko-details"><div class="form-sheet-grabber" aria-hidden="true"></div><header class="ko-sheet-header"><h2>{{ $t('Payment details') }}</h2><button class="ko-icon" :aria-label="$t('Close')" @click="detailsOpen = false"><Icon icon="tabler:x" width="21" height="21" /></button></header><dl v-if="selectedSale"><dt>{{ $t('Reference') }}</dt><dd>{{ selectedSale.id }}</dd><dt>{{ $t('Receiving Wallet') }}</dt><dd>{{ selectedSale.walletName }}</dd><dt>{{ $t('Payment status') }}</dt><dd>{{ statusText(selectedSale) }}</dd><dt>{{ $t('Payment method') }}</dt><dd>{{ selectedSale.method }}</dd><dt>{{ $t('Sale label') }}</dt><dd>{{ selectedSale.label || '—' }}</dd><template v-for="attempt in selectedSale.attempts" :key="attempt.id"><dt>{{ $t('Payment reference') }}</dt><dd>{{ attempt.paymentHash || $t('Waiting for confirmation') }}</dd></template></dl></q-card></q-dialog>
  </q-page>
</template>

<script>
import { Icon } from "@iconify/vue";
import { Capacitor } from "@capacitor/core";
import { saveFile } from "../services/fileExport.js";
import { useKioskPayments } from "../composables/useKioskPayments.js";
import KioskToolbar from "../components/kiosk/KioskToolbar.vue";
import KioskProducts from "../components/kiosk/KioskProducts.vue";
import KioskOnboarding from "../components/kiosk/KioskOnboarding.vue";
import KioskReceipt from "../components/kiosk/KioskReceipt.vue";
import KioskWalletSheet from "../components/kiosk/KioskWalletSheet.vue";
import KioskPinSheet from "../components/kiosk/KioskPinSheet.vue";
import KioskPinPad from "../components/KioskPinPad.vue";
import KioskWithdraw from "../components/kiosk/KioskWithdraw.vue";
import AutoTransferSheet from "../components/autoTransfer/AutoTransferSheet.vue";
import IdentityGroup from "../components/identity/IdentityGroup.vue";
import IdentityRow from "../components/identity/IdentityRow.vue";
import { useWalletStore } from "../stores/wallet";
import { useKioskMerchantStore } from "../stores/kioskMerchant.js";
import { useAutoWithdrawStore } from "../stores/autoWithdraw";
import { kioskWalletBlocker, KIOSK_BLOCKER } from "../utils/walletCapabilities.js";
import { walletTypeLabel } from "../utils/walletNames.js";
import { SELECTABLE_FIAT_CURRENCIES } from "../utils/fiatCurrencies.js";
import { formatKioskMoney, kioskDraftHasValue, kioskError } from "../utils/kioskMerchant.js";
import { destinationLabel, statusText as transferStatusText } from "../utils/autoTransferCopy.js";
const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
const VIEWS = ["home", "products", "categories", "sales", "receipt", "baskets", "settings", "payouts"];
export default {
  name: "KioskModePage",
  components: { Icon, KioskToolbar, KioskProducts, KioskOnboarding, KioskReceipt, KioskWalletSheet, KioskPinSheet, KioskPinPad, KioskWithdraw, AutoTransferSheet, IdentityGroup, IdentityRow },
  setup() {
    return { walletStore: useWalletStore(), merchant: useKioskMerchantStore(), autoTransfer: useAutoWithdrawStore() };
  },
  data() {
    return { loading: true, loadError: false, busy: false, error: "", setupStep: null, introOpen: false, setupWalletId: "", setupCurrency: "USD", firstPin: "", pinError: "", walletSheetOpen: false, pinSheetOpen: false, autoTransferOpen: false, withdrawOpen: false, menuOpen: false, editorOpen: false, detailsOpen: false, editorType: "product", editor: {}, editorError: "", searchOpen: false, search: "", category: "", catalogScroll: 0, browse: null, period: "today", statusFilter: "all", saleCurrency: "", salesScroll: 0, currencies: SELECTABLE_FIAT_CURRENCIES };
  },
  computed: {
    view() {
      return VIEWS.includes(this.$route.query.view) ? this.$route.query.view : "home";
    },
    title() {
      return this.$t({ home: "kiosk.kioskMode", products: "Products", categories: "Categories", sales: "Sales and activity", receipt: "Receipt", baskets: "Saved baskets", settings: "Register settings", payouts: "Withdraw and Auto-Transfer" }[this.view]);
    },
    walletOptions() {
      return this.walletStore.wallets.map((wallet) => {
        const blocker = kioskWalletBlocker(wallet);
        const caption = blocker === KIOSK_BLOCKER.CANNOT_RECEIVE ? this.$t("Can't receive") : blocker === KIOSK_BLOCKER.CANNOT_CONFIRM ? this.$t("Can't confirm payments") : walletTypeLabel(wallet);
        return { id: wallet.id, name: wallet.name, type: wallet.type, caption, blocked: !!blocker };
      });
    },
    eligibleWallets() {
      return this.walletOptions.filter((wallet) => !wallet.blocked);
    },
    setupWallet() {
      return this.walletOptions.find((wallet) => wallet.id === this.setupWalletId) || null;
    },
    receivingWallet() {
      return this.walletOptions.find((wallet) => wallet.id === this.walletStore.kioskWalletId) || null;
    },
    currencyLocked() {
      return !!this.merchant.products.length || !!this.merchant.savedBaskets.length || kioskDraftHasValue(this.merchant.draft) || !!this.merchant.currentOrder && this.merchant.currentOrder.status !== "paid";
    },
    toolbarActions() {
      const actions = [];
      if (this.view === "products") actions.push({ id: "add", icon: "tabler:plus", label: this.$t("Add product"), disabled: this.busy });
      if (this.view === "categories") actions.push({ id: "add-category", icon: "tabler:plus", label: this.$t("Add category"), disabled: this.busy });
      actions.push({ id: "more", icon: "tabler:dots", label: this.$t("More actions") });
      return actions;
    },
    canPrint() {
      return !Capacitor.isNativePlatform() && typeof window !== "undefined" && typeof window.print === "function";
    },
    moreActions() {
      const actions = [{ id: "register", icon: "tabler:device-mobile", label: this.$t("Open register") }];
      if (this.view === "products") actions.unshift({ id: "categories", icon: "tabler:category", label: this.$t("Categories") });
      if (this.view === "sales") actions.unshift({ id: "export-sales", icon: "tabler:download", label: this.$t("Export sales"), disabled: !this.visibleSales.length });
      if (this.view === "receipt" && this.selectedSale) actions.unshift({ id: "details", icon: "tabler:info-circle", label: this.$t("Payment details") }, { id: "label", icon: "tabler:tag", label: this.$t("Edit label") }, { id: "print", icon: "tabler:printer", label: this.$t("Print receipt") }, { id: "export-receipt", icon: "tabler:download", label: this.$t("Export receipt") });
      return actions.filter((action) => action.id !== "print" || this.canPrint);
    },
    selectedSale() {
      return this.merchant.getOrder(String(this.$route.query.sale || ""));
    },
    saleCurrencies() {
      return [...new Set(this.merchant.orders.map((sale) => sale.currency))].sort();
    },
    visibleSales() {
      const now = /* @__PURE__ */ new Date();
      const start = this.period === "today" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() : this.period === "week" ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime() : 0;
      const terms = normalize(this.search).trim().split(/\s+/).filter(Boolean);
      return this.merchant.orders.filter((sale) => (sale.paidAt || sale.createdAt) >= start && (!this.saleCurrency || sale.currency === this.saleCurrency) && (this.statusFilter === "all" || this.statusFilter === "paid" && sale.status === "paid" || this.statusFilter === "waiting" && ["preparing", "waiting"].includes(sale.status) || this.statusFilter === "attention" && (["uncertain", "expired", "failed"].includes(sale.status) || sale.duplicatePayment)) && terms.every((term) => normalize(`${sale.label} ${sale.id} ${sale.walletName} ${sale.items.map((item) => `${item.name} ${item.category}`).join(" ")}`).includes(term))).slice().sort((a, b) => (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt));
    },
    summary() {
      const groups = /* @__PURE__ */ new Map();
      for (const sale of this.visibleSales.filter((sale2) => sale2.status === "paid")) {
        if (!groups.has(sale.currency)) groups.set(sale.currency, { currency: sale.currency, count: 0, minor: 0, baseSats: 0, extrasSats: 0 });
        const group = groups.get(sale.currency);
        group.count += 1;
        group.minor = group.minor == null || sale.subtotalMinor == null ? null : group.minor + sale.subtotalMinor;
        group.baseSats += sale.baseSats;
        group.extrasSats += sale.tipSats + sale.roundUpSats;
      }
      return [...groups.values()];
    },
    editorTitle() {
      return this.$t(this.editorType === "label" ? "Edit label" : this.editorType === "category" ? this.editor.id ? "Edit category" : "Add category" : this.editor.id ? "Edit product" : "Add product");
    },
    transferRule() {
      return this.autoTransfer.getConfig(this.walletStore.kioskWalletId);
    },
    transferContext() {
      return { t: this.$t.bind(this), locale: this.$i18n.locale, bip177: this.walletStore.useBip177Format, wallets: this.walletStore.wallets };
    },
    transferDestination() {
      return this.transferRule ? destinationLabel(this.transferRule.destination, this.transferContext) : "";
    },
    transferStatus() {
      return this.transferRule ? transferStatusText(this.transferRule, this.transferContext).text : "";
    }
  },
  watch: {
    "$route.query.view"(next, previous) {
      this.error = "";
      this.menuOpen = false;
      this.detailsOpen = false;
      if (next !== "receipt" && previous !== "receipt") {
        this.search = "";
        this.searchOpen = false;
      }
      if (next === "sales") this.$nextTick(() => {
        this.scrollSalesTo(this.salesScroll);
      });
    },
    search() { if (this.view === "sales") this.scrollSalesTo(0); },
    period() { this.scrollSalesTo(0); },
    statusFilter() { this.scrollSalesTo(0); },
    saleCurrency() { this.scrollSalesTo(0); },
    searchOpen(open) {
      if (open) {
        this.browse = { view: this.view, category: this.category, scroll: this.view === "sales" ? this.salesScroll : this.catalogScroll };
        if (this.view === "products") this.category = "";
      }
    },
    eligibleWallets(wallets) {
      if (this.setupStep && !this.setupWalletId) this.setupWalletId = wallets[0]?.id || "";
    }
  },
  mounted() {
    this.initialize();
  },
  beforeUnmount() {
    this.firstPin = "";
  },
  methods: {
    async initialize() {
      this.loading = true;
      this.loadError = false;
      try {
        await this.merchant.initialize({ currency: this.walletStore.preferredFiatCurrency });
        if (this.merchant.data?.revision === 0 && !this.merchant.setupCompleted && !this.merchant.products.length && !this.merchant.orders.length && !this.merchant.savedBaskets.length && !kioskDraftHasValue(this.merchant.draft)) {
          await this.merchant.setCatalogCurrency(this.walletStore.preferredFiatCurrency);
        }
        this.setupCurrency = this.merchant.catalogCurrency;
        const usable = new Set(this.eligibleWallets.map((wallet) => wallet.id));
        this.setupWalletId = [this.walletStore.kioskWalletId, this.walletStore.activeWalletId].find((id) => usable.has(id)) || this.eligibleWallets[0]?.id || "";
        this.setupStep = this.walletStore.kioskEnabled ? null : this.merchant.setupCompleted || this.$route.query.setup === "defaults" ? "defaults" : "welcome";
        if (this.$route.query.action === "withdraw") this.withdrawOpen = true;
      } catch {
        this.loadError = true;
      } finally {
        this.loading = false;
      }
    },
    problem(error) {
      return this.$t({ KIOSK_WALLET_UNAVAILABLE: "Choose a kiosk wallet that can take payments",
        KIOSK_CATEGORY_EXISTS: "This category already exists.", KIOSK_CATEGORY_IN_USE: "Move these products to another category first.", KIOSK_BASKET_CONFLICT: "Save or clear the current basket before opening another.", KIOSK_RESTORE_CONFLICT: "Restore register data into an empty register so existing records stay safe.", KIOSK_CURRENCY_LOCKED: "Finish the open sale and keep existing product prices in their original currency.", KIOSK_INVALID_DATA: "Check the entered values and try again.", KIOSK_STORAGE_FAILED: "We could not save this change. Try again before continuing.", KIOSK_STORAGE_CONFLICT: "The register changed in another window. Reload before continuing." }[error?.code] || "We could not save this change. Try again before continuing.");
    },
    async run(fn) {
      if (this.busy) return false;
      this.busy = true;
      this.error = "";
      try {
        await fn();
        return true;
      } catch (error) {
        this.error = this.problem(error);
        return false;
      } finally {
        this.busy = false;
      }
    },
    startSetup() {
      this.setupStep = "defaults";
      this.introOpen = false;
    },
    setupBack() {
      if (this.setupStep === "defaults") this.setupStep = "welcome";
      else if (this.setupStep === "pin") {
        this.firstPin = "";
        this.pinError = "";
        this.setupStep = "defaults";
      } else this.$router.push("/settings");
    },
    async confirmDefaults() {
      if (!this.setupWallet || this.setupWallet.blocked) return;
      if (await this.run(() => this.merchant.setCatalogCurrency(this.setupCurrency))) this.setupStep = "pin";
    },
    async setupPin(pin) {
      if (this.busy) return;
      if (!this.setupWallet || this.setupWallet.blocked) {
        this.firstPin = "";
        this.error = this.$t("Choose a kiosk wallet that can take payments");
        this.setupStep = "defaults";
        return;
      }
      if (!this.firstPin) {
        this.firstPin = pin;
        this.pinError = "";
        this.$nextTick(() => this.$refs.setupPad?.reset());
        return;
      }
      if (pin !== this.firstPin) {
        this.firstPin = "";
        this.pinError = this.$t("kiosk.pinMismatch");
        this.$refs.setupPad?.fail();
        return;
      }
      const fresh = !this.merchant.setupCompleted;
      const ok = await this.run(async () => {
        await this.merchant.completeSetup();
        if (fresh) {
          await this.walletStore.setKioskDisplayCurrency("fiat");
          await this.merchant.setDraft({ ...this.merchant.draft, amountUnit: "fiat" });
        }
        if (!this.setupWallet || this.setupWallet.blocked) throw { code: "KIOSK_WALLET_UNAVAILABLE" };
        await this.walletStore.enableKiosk(pin, this.setupWalletId);
      });
      this.firstPin = "";
      this.$refs.setupPad?.reset();
      if (ok) this.setupStep = "ready";
    },
    async connectWallet() {
      await this.$router.replace({ path: "/kiosk-mode", query: { setup: "defaults" } });
      this.$q.notify({ message: this.$t("Connect a wallet, then return here to finish setup."), color: "info" });
      this.$router.push({ path: "/settings", query: { section: "wallets" } });
    },
    async setWallet(id) {
      if (!this.eligibleWallets.some((wallet) => wallet.id === id)) return;
      if (this.merchant.currentOrder && this.merchant.currentOrder.status !== "paid" && id !== this.walletStore.kioskWalletId) {
        this.error = this.$t("Finish or set aside the current payment before changing the receiving wallet.");
        return;
      }
      if (this.setupStep) this.setupWalletId = id;
      else await this.run(() => this.walletStore.setKioskWallet(id));
    },
    async changeCurrency(code) {
      await this.run(() => this.merchant.setCatalogCurrency(code));
    },
    async openRegister() {
      if (!this.receivingWallet || this.receivingWallet.blocked) {
        this.error = this.$t("Choose a kiosk wallet that can take payments");
        this.walletSheetOpen = true;
        return;
      }
      await this.run(async () => {
        await this.merchant.flush();
        if (!this.merchant.setupCompleted) await this.merchant.completeSetup();
        if (!this.receivingWallet || this.receivingWallet.blocked) {
          this.error = this.$t("Choose a kiosk wallet that can take payments");
          this.walletSheetOpen = true;
          return;
        }
        await this.walletStore.activateKioskMode();
        await this.$router.push("/kiosk");
      });
    },
    async finishToTransfers() {
      this.setupStep = null;
      await this.go("payouts");
    },
    go(view) {
      return this.$router.push({ path: "/kiosk-mode", query: { view } });
    },
    back() {
      if (this.view === "home") this.$router.push("/settings");
      else if (this.view === "receipt") this.go("sales");
      else if (this.view === "categories") this.go("products");
      else this.go("home");
    },
    toolbarAction(id) {
      if (id === "add") this.editProduct();
      else if (id === "add-category") this.editCategory();
      else this.menuOpen = true;
    },
    async performMore(id) {
      this.menuOpen = false;
      if (id === "register") return this.openRegister();
      if (id === "categories") return this.go("categories");
      if (id === "details") this.detailsOpen = true;
      if (id === "label") this.openEditor("label", { id: this.selectedSale.id, name: this.selectedSale.label });
      if (id === "resume-payment") return this.resumePayment(this.selectedSale.id);
      if (id === "print") {
        if (!this.canPrint) return;
        await this.$nextTick();
        window.print();
      }
      if (id === "export-sales") this.exportSales();
      if (id === "export-receipt") await this.run(() => this.download(`buhogo-receipt-${this.selectedSale.id}.csv`, this.merchant.salesCsv([this.selectedSale]), "text/csv;charset=utf-8"));
    },
    restoreBrowse() {
      if (this.browse) {
        const scroll = this.browse.scroll;
        if (this.browse.view === "sales") {
          this.$nextTick(() => { this.scrollSalesTo(scroll); this.$refs.salesList?.$el?.focus({ preventScroll: true }); });
        } else {
          this.category = this.browse.category;
          this.catalogScroll = scroll;
          this.$nextTick(() => {
            this.$refs.catalog?.scrollTo(scroll);
            this.$refs.catalog?.focusList();
          });
        }
      }
      this.browse = null;
    },
    scrollSalesTo(value) {
      const list = this.$refs.salesList?.$el;
      if (list) list.scrollTop = Math.max(0, value || 0);
    },
    resetSearch() {
      this.search = "";
      this.category = "";
    },
    clearSalesFilters() {
      this.search = "";
      this.period = "all";
      this.statusFilter = "all";
      this.saleCurrency = "";
    },
    money(minor, currency) {
      return formatKioskMoney(minor, currency, this.$i18n.locale);
    },
    sats(value) {
      return `${Number(value || 0).toLocaleString(this.$i18n.locale)} sats`;
    },
    date(value) {
      return new Intl.DateTimeFormat(this.$i18n.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(value);
    },
    productPrice(product) {
      return this.money(product.priceMinor, product.currency);
    },
    receiptTotal(sale) {
      return sale.totalMinor == null ? this.sats(sale.totalSats) : this.money(sale.totalMinor, sale.currency);
    },
    statusText(sale) {
      return this.$t(sale.status === "paid" ? "Paid" : sale.status === "failed" ? "Failed" : sale.status === "expired" ? "Expired" : sale.status === "uncertain" ? "Needs attention" : "Waiting for confirmation");
    },
    async resumePayment(id) {
      await this.run(async () => {
        if (id !== this.merchant.currentOrder?.id && (this.merchant.currentOrder && this.merchant.currentOrder.status !== "paid" || kioskDraftHasValue(this.merchant.draft))) {
          throw kioskError("KIOSK_BASKET_CONFLICT", "Save or clear the current basket before opening another.");
        }
        const payments = useKioskPayments({ merchant: this.merchant, walletStore: this.walletStore });
        await payments.ready;
        await this.walletStore.activateKioskMode();
        await this.$nextTick();
        await payments.resume(id);
        await this.$router.push("/kiosk");
      });
    },
    async openReceipt(sale) {
      await this.$router.push({ path: "/kiosk-mode", query: { view: "receipt", sale: sale.id } });
    },
    openEditor(type, value) {
      this.editorType = type;
      this.editor = { ...value };
      this.editorError = "";
      this.editorOpen = true;
      this.$nextTick(() => this.$refs.editorName?.focus());
    },
    editProduct(product) {
      this.openEditor("product", product ? { ...product, price: (product.priceMinor / 100).toFixed(2) } : { name: "", price: "", category: "" });
    },
    editCategory(name = "") {
      this.openEditor("category", { id: name, name });
    },
    async saveEditor() {
      if (this.busy) return;
      this.editorError = "";
      let priceMinor = 0;
      if (this.editorType === "product") {
        const value = this.editor.price.trim().replace(",", ".");
        if (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isSafeInteger(Number(value.replace(".", "")))) {
          this.editorError = this.$t("Enter a price with up to two decimal places.");
          return;
        }
        const [whole, fraction = ""] = value.split(".");
        priceMinor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
        if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) {
          this.editorError = this.$t("Enter a price greater than zero.");
          return;
        }
      }
      if (this.editorType !== "label" && !this.editor.name.trim()) {
        this.editorError = this.$t("Enter a name.");
        return;
      }
      this.busy = true;
      try {
        if (this.editorType === "product") await this.merchant.saveProduct({ ...this.editor, priceMinor, currency: this.merchant.catalogCurrency });
        else if (this.editorType === "category") await this.merchant.saveCategory(this.editor.name, this.editor.id || null);
        else await this.merchant.setSaleLabel(this.editor.id, this.editor.name);
        this.editorOpen = false;
      } catch (error) {
        this.editorError = this.problem(error);
      } finally {
        this.busy = false;
      }
    },
    ask(title, message, ok) {
      return new Promise((resolve) => {
        this.$q.dialog({ title, message, cancel: true, persistent: true, ok: { label: ok || this.$t("Continue"), color: "primary" }, cancel: { label: this.$t("Cancel"), flat: true } }).onOk(() => resolve(true)).onCancel(() => resolve(false)).onDismiss(() => resolve(false));
      });
    },
    async deleteEdited() {
      if (!await this.ask(this.$t("Delete {name}?", { name: this.editor.name }), this.$t("Existing baskets and receipts keep their original details."), this.$t("Delete"))) return;
      this.busy = true;
      try {
        if (this.editorType === "product") await this.merchant.removeProduct(this.editor.id);
        else await this.merchant.removeCategory(this.editor.id);
        this.editorOpen = false;
      } catch (error) {
        this.editorError = this.problem(error);
      } finally {
        this.busy = false;
      }
    },
    basketActions(basket) {
      this.$q.dialog({ title: basket.name, options: { type: "radio", model: "resume", items: [{ label: this.$t("Resume basket"), value: "resume" }, { label: this.$t("Delete basket"), value: "delete" }] }, cancel: { label: this.$t("Cancel"), flat: true }, ok: { label: this.$t("Continue") } }).onOk(async (choice) => {
        if (choice === "resume") {
          if (await this.run(async () => {
            if (this.merchant.currentOrder?.status === "paid") await this.merchant.startNextSale();
            await this.merchant.resumeBasket(basket.id);
          })) this.openRegister();
        } else if (await this.ask(this.$t("Delete basket?"), this.$t("This saved basket will be removed."), this.$t("Delete"))) await this.run(() => this.merchant.removeBasket(basket.id));
      });
    },
    async setTip(index, value) {
      const percentage = Number(value);
      if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
        this.error = this.$t("Use a percentage from 0 to 100.");
        return;
      }
      const values = [...this.walletStore.kioskTipValues];
      values[index] = percentage;
      await this.run(() => this.walletStore.setKioskTipValues(values));
    },
    async disableKiosk() {
      if (!await this.ask(this.$t("Turn off Kiosk Mode?"), this.$t("Your products, receipts and waiting payments stay on this device."), this.$t("Turn off"))) return;
      if (await this.run(() => this.walletStore.disableKiosk())) {
        this.setupStep = "defaults";
        this.$router.push("/settings");
      }
    },
    async download(name, content, type) {
      await saveFile({ filename: name, data: content, mimeType: type });
    },
    async exportSales() {
      const orders = this.visibleSales.slice();
      const filename = `buhogo-sales-${this.period}-${this.statusFilter}.csv`;
      const scope = `${this.$t({ today: "Today", week: "Last 7 days", all: "All time" }[this.period])} · ${this.$t({ all: "All statuses", paid: "Paid", waiting: "Waiting", attention: "Needs attention" }[this.statusFilter])} · ${this.saleCurrency || this.$t("All currencies")}${this.search ? ` · ${this.$t("Search")}: ${this.search}` : ""}`;
      if (await this.ask(this.$t("Export sales"), this.$t("Export {n} matching sales: {scope}", { n: orders.length, scope }), this.$t("Export"))) await this.run(() => this.download(filename, this.merchant.salesCsv(orders), "text/csv;charset=utf-8"));
    },
    async exportBackup() {
      await this.run(async () => {
        const bundle = await this.merchant.exportBundle();
        await this.download(`buhogo-register-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`, bundle, "application/json");
      });
    },
    async restoreBackup(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) {
        this.error = this.$t("Choose a register backup smaller than 20 MB.");
        return;
      }
      if (!await this.ask(this.$t("Restore register backup"), this.$t("Restore products and records only. Wallet access and PIN are not included. Waiting payments need their original wallet connection."), this.$t("Restore"))) return;
      await this.run(async () => {
        await this.merchant.restoreBundle(await file.text());
        this.setupCurrency = this.merchant.catalogCurrency;
      });
    }
  }
};
</script>

<style scoped>
.kiosk-owner { display:flex; flex-direction:column; width:100%; max-width:600px; height:100dvh; min-height:0 !important; margin:0 auto; padding-top:env(safe-area-inset-top,0px); overflow:hidden; color:var(--text-primary); background:var(--bg-primary); }
.ko-scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; }
.ko-body { padding:12px 20px max(24px,var(--safe-bottom,16px)); }
.ko-body :deep(.id-group) { margin-bottom:20px; }
.ko-centered { display:flex; flex:1; min-height:0; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:24px; text-align:center; }
.ko-centered h1,.ko-centered h2 { margin:0; font:750 21px/1.3 'Manrope',sans-serif; }
.ko-centered p { max-width:330px; margin:0; color:var(--text-secondary); font-size:14px; line-height:1.55; }
.ko-empty { min-height:240px; }
.ko-primary { display:flex; align-items:center; justify-content:center; gap:9px; width:100%; min-height:52px; padding:12px 18px; border:1px solid var(--btn-neutral-border); border-radius:15px; background:var(--btn-neutral-bg); color:var(--btn-neutral-fg); font:700 14px/1.4 'Manrope',sans-serif; cursor:pointer; }
.ko-open { margin-bottom:22px; }
.ko-plain,.ko-danger { min-height:44px; padding:10px; border:0; border-radius:10px; background:transparent; color:var(--brand-accent-text); font:650 14px/1.4 'Manrope',sans-serif; cursor:pointer; }
.ko-danger { width:100%; color:var(--color-negative); }
.ko-error { flex:none; margin:4px 20px 10px; color:var(--color-negative); font-size:13px; line-height:1.5; }
.ko-editor .ko-error { margin:0; }
.ko-context { flex:none; margin:0; padding:3px 20px 10px; color:var(--text-secondary); font-size:11px; line-height:1.5; }
.ko-context--inset { padding-inline:2px; }
.ko-note { color:var(--text-secondary); font-size:12px; line-height:1.6; }
.ko-value { max-width:45%; color:var(--text-secondary); font-size:13px; text-align:right; overflow-wrap:anywhere; }
.ko-body select,.ko-filters select { min-height:44px; max-width:145px; padding:9px; border:1px solid var(--border-card); border-radius:11px; background:var(--bg-input); color:var(--text-primary); font:600 12px/1.3 'Manrope',sans-serif; }
.ko-sales { display:flex; flex:1; min-height:0; flex-direction:column; }
.ko-filters { display:flex; flex:none; gap:6px; padding:4px 16px 8px; overflow-x:auto; }
.ko-filters select { flex:1; min-width:0; }
.ko-sales-scroll { padding:0 20px max(20px,var(--safe-bottom,16px)); }
.ko-summary { display:flex; gap:10px; overflow-x:auto; padding:5px 0 14px; }
.ko-summary section { flex:1 0 200px; padding:12px 14px; border:1px solid var(--border-card); border-radius:14px; }
.ko-summary-main { display:flex; flex-direction:column; gap:4px; }
.ko-summary-main span { color:var(--text-secondary); font-size:11px; }
.ko-summary-main strong { font:750 27px/1.2 'Manrope',sans-serif; letter-spacing:-.8px; }
.ko-summary p { margin:6px 0 0; color:var(--text-secondary); font-size:11px; line-height:1.5; }
.ko-sale-row { display:flex; align-items:center; gap:12px; width:100%; min-height:78px; padding:13px 0; border:0; border-bottom:1px solid var(--border-card); background:transparent; color:var(--text-primary); text-align:left; cursor:pointer; }
.ko-sale-row > span:first-child { min-width:0; flex:1; }
.ko-sale-row strong { display:block; font:650 14px/1.4 'Manrope',sans-serif; overflow-wrap:anywhere; }
.ko-sale-row small { display:block; margin-top:4px; color:var(--text-secondary); font-size:11px; line-height:1.5; }
.ko-sale-amount { flex:none; max-width:45%; text-align:right; font:650 13px/1.4 'Manrope',sans-serif; overflow-wrap:anywhere; }
.ko-receipt { display:flex; flex-direction:column; flex:1; min-height:0; padding:6px 20px max(20px,var(--safe-bottom,16px)); }
.ko-tip-fields { display:flex; gap:8px; padding:8px 16px 16px; }
.ko-tip-fields label { flex:1; min-width:0; color:var(--text-secondary); font-size:10px; }
.ko-tip-input { display:flex; align-items:center; margin-top:5px; border:1px solid var(--border-card); border-radius:10px; padding-right:10px; font-size:13px; }
.ko-tip-input input { width:100%; min-width:0; height:44px; padding:8px; border:0; background:transparent; color:var(--text-primary); }
.ko-sheet { width:100%; max-width:600px; max-height:min(90dvh,800px); margin:0 auto; padding:0 16px max(20px,var(--safe-bottom,16px)); overflow-y:auto; border-radius:24px 24px 0 0; background:var(--bg-primary); color:var(--text-primary); }
.ko-sheet-header { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:52px; }
.ko-sheet-header h2 { margin:0; font:750 16px/1.4 'Manrope',sans-serif; }
.ko-icon { display:grid; place-items:center; flex:none; width:44px; min-width:44px; height:44px; padding:0; border:0; border-radius:10px; background:transparent; color:var(--text-secondary); cursor:pointer; }
.ko-menu-action { display:flex; align-items:center; gap:13px; width:100%; min-height:56px; padding:12px 8px; border:0; border-bottom:1px solid var(--border-card); background:transparent; color:var(--text-primary); font:600 14px/1.4 'Manrope',sans-serif; text-align:left; cursor:pointer; }
.ko-editor-fields { display:flex; flex-direction:column; gap:16px; padding:12px 4px; }
.ko-editor-fields label { display:flex; flex-direction:column; gap:7px; font:600 12px/1.4 'Manrope',sans-serif; }
.ko-editor-fields input,.ko-editor-fields select { width:100%; min-height:48px; padding:11px 13px; border:1px solid var(--border-card); border-radius:12px; background:var(--bg-input); color:var(--text-primary); font:500 16px/1.4 'Manrope',sans-serif; }
.ko-details dl { display:grid; grid-template-columns:1fr; gap:3px; padding:8px; }
.ko-details dt { color:var(--text-secondary); font-size:11px; }
.ko-details dd { margin:0 0 13px; font-size:13px; line-height:1.5; overflow-wrap:anywhere; }
.ko-sr { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.kiosk-owner button:focus-visible,.kiosk-owner input:focus-visible,.kiosk-owner select:focus-visible { outline:2px solid var(--brand-accent-text); outline-offset:-2px; }
.kiosk-owner button:disabled { opacity:.45; cursor:default; }
@media print { .kiosk-owner { height:auto; max-width:none; overflow:visible; padding:0; } .kiosk-owner > :not(.ko-receipt) { display:none !important; } .ko-receipt { display:block; padding:0; overflow:visible; } }
</style>
