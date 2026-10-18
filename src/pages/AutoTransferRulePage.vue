<!--
  One Auto-Transfer rule: the rule as a sentence, where it stands, its
  switch, what it did lately, and removing it.

    - Waiting: a meter from what the wallet holds to the amount that starts
      a transfer, in the unit the rule was typed in (fiat when it was).
    - Needs attention: what happened in one sentence, that the money stayed,
      and the two ways forward (Try Again, Change Destination).
    - The switch acts at once; a pause the app made is explained under it.

  `?edit=1` opens the edit sheet (from Home's "Change Destination").
-->
<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Auto-Transfer')" to="/auto-transfer">
      <template #actions>
        <button v-if="rule" type="button" class="at-nav-action" @click="editOpen = true">{{ $t('Edit') }}</button>
      </template>
    </IdentityNav>

    <div v-if="rule && wallet" class="id-sub-body">
      <div class="at-hero" aria-hidden="true">
        <span class="at-hero-tile"><WalletBrandMark :type="wallet.type" :size="20" color="currentColor" /></span>
        <Icon icon="tabler:arrow-right" width="20" height="20" class="at-hero-arrow" />
        <span class="at-hero-tile">
          <WalletBrandMark v-if="destinationWallet" :type="destinationWallet.type" :size="20" color="currentColor" />
          <Icon v-else :icon="destinationIcon" width="20" height="20" />
        </span>
      </div>
      <p class="at-sentence">{{ sentence }}</p>

      <section v-if="attention" class="at-card at-card--warn" role="status">
        <h2>{{ attention.title }}</h2>
        <p v-if="attention.text">{{ attention.text }}</p>
        <button v-if="attention.canRetry" type="button" class="btn-primary" :disabled="trying" @click="tryAgain">
          <q-spinner v-if="trying" size="18px" />
          <template v-else>{{ $t('Try Again') }}</template>
        </button>
        <button type="button" class="btn-ghost" @click="editOpen = true">{{ $t('Change Destination') }}</button>
      </section>

      <section v-else-if="rule.enabled && meter" class="at-card" :aria-label="$t('Progress')">
        <div class="at-meter-figure">
          <strong>{{ meter.now }}</strong>
          <span>{{ $t('of {amount}', { amount: meter.target }) }}</span>
        </div>
        <div class="at-meter" role="progressbar" :aria-valuenow="meter.percent" aria-valuemin="0" aria-valuemax="100">
          <i :style="{ width: `${meter.percent}%` }"></i>
        </div>
      </section>

      <IdentityGroup :footer="pausedFooter">
        <IdentityRow :label="$t('Auto-Transfer')" :interactive="false">
          <template #trailing>
            <q-toggle :model-value="rule.enabled" color="positive" :aria-label="$t('Auto-Transfer')" @update:model-value="setEnabled" />
          </template>
        </IdentityRow>
      </IdentityGroup>

      <IdentityGroup v-if="events.length" :title="$t('Recent')">
        <IdentityRow
          v-for="event in events"
          :key="event.key"
          :label="event.title"
          :interactive="!!event.txId"
          :chevron="!!event.txId"
          wrap
          @click="openTransaction(event.txId)"
        >
          <template #caption>{{ event.detail }}</template>
          <template #trailing><span v-if="event.value" class="at-event-value" :class="`at-tone-${event.tone}`">{{ event.value }}</span></template>
        </IdentityRow>
      </IdentityGroup>

      <IdentityGroup>
        <IdentityRow :label="$t('Remove Rule')" danger :chevron="false" class="at-remove" @click="confirmRemove" />
      </IdentityGroup>
    </div>

    <AutoTransferSheet v-if="rule" v-model="editOpen" :wallet-id="walletId" editing />
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
import { DESTINATION_KIND, OUTCOME, amountSats } from '../utils/autoTransfer.js';
import { attentionCopy, destinationLabel, eventRow, formatRuleAmount, formatSats, pausedText, ruleSentence } from '../utils/autoTransferCopy.js';

export default {
  name: 'AutoTransferRulePage',
  components: { Icon, IdentityNav, IdentityGroup, IdentityRow, SettingsHubNav, WalletBrandMark, AutoTransferSheet },
  setup() {
    return { walletStore: useWalletStore(), autoTransfer: useAutoWithdrawStore() };
  },
  data() {
    return { editOpen: false, trying: false };
  },
  computed: {
    walletId() {
      return String(this.$route.params.walletId || '');
    },
    rule() {
      return this.autoTransfer.getConfig(this.walletId);
    },
    wallet() {
      return this.walletStore.wallets.find((w) => w.id === this.walletId) || null;
    },
    ctx() {
      return { t: this.$t.bind(this), locale: this.$i18n.locale, bip177: this.walletStore.useBip177Format, wallets: this.walletStore.wallets };
    },
    destinationWallet() {
      const d = this.rule?.destination;
      return d?.kind === DESTINATION_KIND.WALLET ? this.walletStore.wallets.find((w) => w.id === d.walletId) || null : null;
    },
    destinationName() {
      return destinationLabel(this.rule?.destination, this.ctx) || this.$t('the destination');
    },
    destinationIcon() {
      const kind = this.rule?.destination?.kind;
      if (kind === DESTINATION_KIND.BITCOIN) return 'tabler:currency-bitcoin';
      if (kind === DESTINATION_KIND.LIGHTNING) return 'tabler:at';
      return 'tabler:qrcode';
    },
    sentence() {
      return ruleSentence(this.rule, this.wallet.name, this.ctx);
    },
    balance() {
      return this.walletStore.getDisplayBalance(this.walletId)?.balance ?? 0;
    },
    attention() {
      return attentionCopy(this.rule, { walletName: this.wallet.name, balanceSats: this.balance }, this.ctx);
    },
    /** "184,250 of 500,000 sats", in fiat when the rule was set in fiat. */
    meter() {
      const rate = (currency) => Number(this.walletStore.exchangeRates?.[String(currency).toLowerCase()]) || 0;
      const target = amountSats(this.rule.threshold, rate);
      if (!target) return null;
      const percent = Math.min(100, Math.round((this.balance / target) * 100));
      if (this.rule.threshold.fiat != null) {
        const nowFiat = { fiat: (this.balance / 1e8) * rate(this.rule.threshold.currency), currency: this.rule.threshold.currency };
        return { now: formatRuleAmount(nowFiat, this.ctx), target: formatRuleAmount(this.rule.threshold, this.ctx), percent };
      }
      return { now: formatSats(this.balance, this.ctx), target: formatRuleAmount(this.rule.threshold, this.ctx), percent };
    },
    pausedFooter() {
      return pausedText(this.rule, this.ctx);
    },
    events() {
      const names = { wallet: this.wallet.name, destination: this.destinationName };
      return (this.rule.events || []).map((event, index) => ({ key: `${event.at}-${index}`, txId: event.outcome === OUTCOME.SENT ? event.txId : null, ...eventRow(event, this.ctx, names) }));
    },
  },
  watch: {
    rule: {
      immediate: true,
      handler(rule) {
        if (!rule) this.$router.replace('/auto-transfer');
      },
    },
  },
  created() {
    if (this.$route.query.edit) {
      this.$router.replace({ query: {} });
      this.editOpen = true;
    }
  },
  methods: {
    setEnabled(on) {
      this.autoTransfer.setEnabled(this.walletId, on);
    },
    async tryAgain() {
      this.trying = true;
      try {
        await this.autoTransfer.tryNow(this.walletId, this.walletStore);
      } finally {
        this.trying = false;
      }
    },
    openTransaction(txId) {
      if (txId) this.$router.push(`/transaction/${txId}?wallet=${encodeURIComponent(this.walletId)}`);
    },
    confirmRemove() {
      this.$q.dialog({
        title: this.$t('Remove this rule?'),
        cancel: { label: this.$t('Cancel'), flat: true, noCaps: true },
        ok: { label: this.$t('Remove'), color: 'negative', flat: true, noCaps: true },
        class: this.$q.dark.isActive ? 'card_dark_style' : 'card_light_style',
        dark: this.$q.dark.isActive,
      }).onOk(async () => {
        await this.autoTransfer.removeConfig(this.walletId);
        this.$router.replace('/auto-transfer');
      });
    },
  },
};
</script>

<style scoped>
.at-nav-action {
  min-height: 44px;
  padding: 0 10px;
  border: 0;
  background: none;
  color: var(--brand-accent-text);
  font: 600 15px 'Manrope', sans-serif;
  cursor: pointer;
}
.at-hero {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 6px 0 12px;
}
.at-hero-tile {
  width: 52px;
  height: 52px;
  border-radius: 15px;
  display: grid;
  place-items: center;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  color: var(--text-primary);
}
.at-hero-arrow { color: var(--text-muted); }
.at-sentence {
  margin: 0 4px 18px;
  font: 600 17px/1.45 'Manrope', sans-serif;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  text-align: center;
  text-wrap: balance;
}
.at-card {
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  padding: 16px;
  margin-bottom: 4px;
}
.at-card h2 {
  margin: 0 0 4px;
  font: 750 17px/1.3 'Manrope', sans-serif;
  color: var(--text-primary);
}
.at-card p {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.at-card--warn h2 { color: #8A5A00; }
body.body--dark .at-card--warn h2 { color: #F5C451; }
.at-meter-figure {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}
.at-meter-figure strong {
  font: 800 22px/1.2 'Manrope', sans-serif;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}
.at-meter-figure span { font-size: 14px; color: var(--text-secondary); }
.at-meter {
  height: 6px;
  border-radius: 999px;
  background: var(--border-card);
  overflow: hidden;
  margin-top: 10px;
}
.at-meter i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--brand-accent);
  transition: width 0.4s ease;
}
.at-event-value { font-weight: 650; font-size: 14px; margin-left: 8px; }
.at-tone-good { color: var(--brand-accent-text); }
.at-tone-warn { color: #8A5A00; }
body.body--dark .at-tone-warn { color: #F5C451; }
.at-tone-muted { color: var(--text-secondary); }
.at-remove { justify-content: center; }
</style>
