<!--
  Auto-Transfer: the rules, one row each ("Shop → Savings"), with where
  each stands in a few words underneath. A row opens the rule's page; "New
  Rule" opens the setup sheet. With no rules, the page says what the
  feature does in one line and offers the same button.

  `?new=<walletId>` opens the setup sheet for that wallet (from the
  wallet's details in Manage Wallets).
-->
<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Settings')" to="/settings" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Auto-Transfer') }}</h1>

      <template v-if="rows.length">
        <IdentityGroup :footer="$t('Rules run while BuhoGO is open.')">
          <IdentityRow
            v-for="row in rows"
            :key="row.walletId"
            :label="row.title"
            data-audit="auto-transfer-rule"
            @click="$router.push(`/auto-transfer/${row.walletId}`)"
          >
            <template #leading>
              <span class="at-row-glyph" aria-hidden="true"><WalletBrandMark :type="row.type" :size="16" color="currentColor" /></span>
            </template>
            <template #caption><span :class="row.status.tone && `at-tone-${row.status.tone}`">{{ row.status.text }}</span></template>
          </IdentityRow>
        </IdentityGroup>
        <button v-if="canAdd" type="button" class="btn-primary" @click="openNew()">{{ $t('New Rule') }}</button>
      </template>

      <div v-else class="at-empty">
        <span class="at-empty-glyph" aria-hidden="true"><Icon icon="tabler:arrow-autofit-right" width="28" height="28" /></span>
        <h2>{{ $t('Move money on its own') }}</h2>
        <p>{{ $t('Like shop takings into savings, once they pass an amount.') }}</p>
        <button type="button" class="btn-primary" :disabled="!walletStore.wallets.length" @click="openNew()">{{ $t('New Rule') }}</button>
      </div>
    </div>

    <AutoTransferSheet v-model="sheetOpen" :wallet-id="newFor" @saved="(id) => $router.push(`/auto-transfer/${id}`)" />
    <SettingsHubNav />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import IdentityNav from '../components/identity/IdentityNav.vue';
import IdentityGroup from '../components/identity/IdentityGroup.vue';
import IdentityRow from '../components/identity/IdentityRow.vue';
import SettingsHubNav from '../components/settings/SettingsHubNav.vue';
import WalletBrandMark from '../components/WalletBrandMark.vue';
import AutoTransferSheet from '../components/autoTransfer/AutoTransferSheet.vue';
import { useWalletStore } from '../stores/wallet';
import { useAutoWithdrawStore } from '../stores/autoWithdraw';
import { destinationLabel, statusText } from '../utils/autoTransferCopy.js';

export default {
  name: 'AutoTransferPage',
  components: { Icon, IdentityNav, IdentityGroup, IdentityRow, SettingsHubNav, WalletBrandMark, AutoTransferSheet },
  setup() {
    return { walletStore: useWalletStore(), autoTransfer: useAutoWithdrawStore() };
  },
  data() {
    return { sheetOpen: false, newFor: '' };
  },
  computed: {
    ctx() {
      return { t: this.$t.bind(this), locale: this.$i18n.locale, bip177: this.walletStore.useBip177Format, wallets: this.walletStore.wallets };
    },
    rows() {
      return this.walletStore.wallets
        .filter((w) => this.autoTransfer.getConfig(w.id))
        .map((w) => {
          const rule = this.autoTransfer.getConfig(w.id);
          return {
            walletId: w.id,
            type: w.type,
            title: `${w.name} → ${destinationLabel(rule.destination, this.ctx) || '…'}`,
            status: statusText(rule, this.ctx),
          };
        });
    },
    /** One rule per wallet: "New Rule" stays while a wallet has none. */
    canAdd() {
      return this.walletStore.wallets.some((w) => !this.autoTransfer.getConfig(w.id));
    },
  },
  created() {
    const walletId = this.$route.query.new;
    if (walletId) {
      this.$router.replace({ query: {} });
      this.openNew(String(walletId));
    }
  },
  methods: {
    openNew(walletId = '') {
      this.newFor = walletId;
      this.sheetOpen = true;
    },
  },
};
</script>

<style scoped>
.at-row-glyph {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  background: var(--bg-input);
  color: var(--text-primary);
  margin-right: 12px;
}
.at-tone-good { color: var(--brand-accent-text); }
.at-tone-warn { color: #8A5A00; font-weight: 600; }
body.body--dark .at-tone-warn { color: #F5C451; }
.at-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 56px 12px 0;
}
.at-empty-glyph {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  color: var(--text-secondary);
}
.at-empty h2 {
  margin: 18px 0 6px;
  font: 750 21px/1.2 'Manrope', sans-serif;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}
.at-empty p {
  margin: 0 0 8px;
  max-width: 30ch;
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.at-empty .btn-primary { max-width: 320px; }
</style>
