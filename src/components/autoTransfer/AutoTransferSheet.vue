<!--
  AutoTransferSheet: create or change a wallet's Auto-Transfer rule.

  The rule is three groups that read as a sentence (When / Move / To), each
  row a value with a chevron, the way a rule is built in system automation
  editors. Tapping a row pushes its own view inside the sheet:

    'wallet'       which wallet the rule watches (new rules only)
    'threshold'    "holds more than", on the app's keypad, sats or fiat
    'move'         Everything, or Keep some (with its own keypad)
    'destination'  my wallets, contacts, paste or scan; checked on choose
    'speed'        how fast a Bitcoin address is paid (on-chain only)

  The one explanation is the footer under the groups, and it is live: what
  the wallet holds now and what would happen. "Turn On" creates the rule;
  editing ends with "Done". The rule's own page switches it off and on.
-->
<template>
  <q-dialog :model-value="modelValue" position="bottom" @update:model-value="$emit('update:modelValue', $event)" @hide="reset">
    <div class="iform-sheet at-sheet" role="dialog" aria-modal="true" :aria-label="title">
      <div class="iform-sheet-grab" aria-hidden="true"></div>

      <!-- ── The rule ─────────────────────────────────────────────── -->
      <template v-if="view === 'rule'">
        <header class="iform-sheet-top">
          <button type="button" class="at-bar-action" @click="close">{{ $t('Cancel') }}</button>
          <div class="iform-sheet-title">{{ title }}</div>
          <span class="at-bar-action at-bar-action--ghost" aria-hidden="true">{{ $t('Cancel') }}</span>
        </header>
        <div class="iform-sheet-scroll">
          <div class="iform-body">
            <div class="iform-seclabel at-seclabel">{{ $t('When') }}</div>
            <div class="iform-group">
              <component :is="editing ? 'div' : 'button'" type="button" class="iform-line" @click="!editing && push('wallet')">
                <span class="iform-line-tile at-wallet-tile"><WalletBrandMark :type="wallet?.type" :size="16" :color="'currentColor'" /></span>
                <span class="iform-line-label">{{ wallet?.name || $t('Choose a wallet') }}</span>
                <span class="iform-line-value">{{ walletBalanceText }}</span>
                <Icon v-if="!editing" icon="tabler:chevron-right" width="18" height="18" class="iform-line-chevron" />
              </component>
              <button type="button" class="iform-line" @click="openAmount('threshold')">
                <span class="iform-line-label">{{ $t('Holds more than') }}</span>
                <span class="iform-line-value" :class="{ 'is-good': draft.threshold }">{{ draft.threshold ? amountText(draft.threshold) : $t('Choose') }}</span>
                <Icon icon="tabler:chevron-right" width="18" height="18" class="iform-line-chevron" />
              </button>
            </div>

            <div class="iform-seclabel at-seclabel">{{ $t('Move') }}</div>
            <div class="iform-group">
              <button type="button" class="iform-line" @click="push('move')">
                <span class="iform-line-label">{{ draft.keep ? $t('Everything above') : $t('Everything') }}</span>
                <span v-if="draft.keep" class="iform-line-value is-good">{{ amountText(draft.keep) }}</span>
                <Icon icon="tabler:chevron-right" width="18" height="18" class="iform-line-chevron" />
              </button>
            </div>

            <div class="iform-seclabel at-seclabel">{{ $t('To') }}</div>
            <div class="iform-group">
              <button type="button" class="iform-line" @click="push('destination')">
                <template v-if="draft.destination">
                  <span class="iform-line-tile at-dest-tile">
                    <WalletBrandMark v-if="destinationWallet" :type="destinationWallet.type" :size="16" color="currentColor" />
                    <Icon v-else :icon="destinationIcon(draft.destination)" width="17" height="17" />
                  </span>
                  <span class="iform-line-label">
                    {{ destinationText(draft.destination) }}
                    <small v-if="destinationDetail(draft.destination)">{{ destinationDetail(draft.destination) }}</small>
                  </span>
                </template>
                <template v-else>
                  <span class="iform-line-label">{{ $t('Destination') }}</span>
                  <span class="iform-line-value is-good">{{ $t('Choose') }}</span>
                </template>
                <Icon icon="tabler:chevron-right" width="18" height="18" class="iform-line-chevron" />
              </button>
              <button v-if="draft.destination?.kind === 'bitcoin'" type="button" class="iform-line" @click="push('speed')">
                <span class="iform-line-label">{{ $t('Arrives') }}</span>
                <span class="iform-line-value">{{ speedLabel(draft.feeSpeed) }}</span>
                <Icon icon="tabler:chevron-right" width="18" height="18" class="iform-line-chevron" />
              </button>
            </div>
            <p v-if="destinationProblemText" class="iform-foot at-warn" role="alert">{{ destinationProblemText }}</p>
            <p v-else-if="preview" class="iform-foot" aria-live="polite">{{ preview }}</p>
          </div>
        </div>
        <footer class="iform-sheet-footer">
          <button type="button" class="form-sheet-primary at-primary" :disabled="!canSave || saving" @click="save">
            <q-spinner v-if="saving" size="18px" />
            <template v-else>{{ editing ? $t('Done') : $t('Turn On') }}</template>
          </button>
        </footer>
      </template>

      <!-- ── Which wallet ─────────────────────────────────────────── -->
      <template v-else-if="view === 'wallet'">
        <header class="iform-sheet-top">
          <q-btn flat round dense class="glass-back-btn" :aria-label="$t('Back')" @click="pop"><Icon icon="tabler:chevron-left" width="20" height="20" /></q-btn>
          <div class="iform-sheet-title">{{ $t('When') }}</div>
          <div class="iform-sheet-spacer"></div>
        </header>
        <div class="iform-sheet-scroll">
          <div class="iform-body">
            <div class="iform-group">
              <button v-for="w in walletChoices" :key="w.id" type="button" class="iform-line" :disabled="!!w.taken" @click="chooseWallet(w.id)">
                <span class="iform-line-tile at-wallet-tile"><WalletBrandMark :type="w.type" :size="16" :color="'currentColor'" /></span>
                <span class="iform-line-label">
                  {{ w.name }}
                  <small v-if="w.taken">{{ $t('Has a rule') }}</small>
                </span>
                <span class="iform-line-value">{{ balanceText(w.id) }}</span>
                <Icon v-if="w.id === draft.walletId" icon="tabler:check" width="18" height="18" class="at-check" />
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- ── An amount: holds more than / keep ──────────────────────── -->
      <template v-else-if="view === 'threshold' || view === 'move'">
        <header class="iform-sheet-top">
          <q-btn flat round dense class="glass-back-btn" :aria-label="$t('Back')" @click="pop"><Icon icon="tabler:chevron-left" width="20" height="20" /></q-btn>
          <div class="iform-sheet-title">{{ view === 'threshold' ? $t('Holds more than') : $t('Move') }}</div>
          <div class="iform-sheet-spacer"></div>
        </header>
        <div v-if="view === 'move'" class="at-move-choice">
          <div class="iform-group">
            <button type="button" class="iform-line" @click="keepSome = false">
              <span class="iform-line-label">{{ $t('Everything') }}</span>
              <Icon v-if="!keepSome" icon="tabler:check" width="18" height="18" class="at-check" />
            </button>
            <button type="button" class="iform-line" @click="startKeep">
              <span class="iform-line-label">{{ $t('Keep some in {name}', { name: wallet?.name || '' }) }}</span>
              <Icon v-if="keepSome" icon="tabler:check" width="18" height="18" class="at-check" />
            </button>
          </div>
        </div>
        <AmountKeypad
          v-if="view === 'threshold' || keepSome"
          v-model="keypad.value"
          v-model:fiat="keypad.fiat"
          class="at-keypad"
          :fiat-code="keypad.currency.toLowerCase()"
          :fiat-rate="rateFor(keypad.currency)"
          :locale="$i18n.locale"
        >
          <div v-if="view === 'threshold' && !keypad.fiat && suggestions.length" class="at-chips">
            <button v-for="n in suggestions" :key="n" type="button" class="at-chip" :class="{ 'is-on': keypadSatsValue === n }" @click="keypad.value = String(n)">
              {{ compact(n) }}
            </button>
          </div>
          <p v-if="keypadHint" class="at-keypad-hint" :class="{ 'at-warn': keypadHintWarn }">{{ keypadHint }}</p>
        </AmountKeypad>
        <div v-else class="at-spacer"></div>
        <footer class="iform-sheet-footer">
          <button type="button" class="form-sheet-primary at-primary" :disabled="!amountReady" @click="confirmAmount">{{ $t('Done') }}</button>
        </footer>
      </template>

      <!-- ── Where to ─────────────────────────────────────────────── -->
      <template v-else-if="view === 'destination'">
        <header class="iform-sheet-top">
          <q-btn flat round dense class="glass-back-btn" :aria-label="$t('Back')" @click="pop"><Icon icon="tabler:chevron-left" width="20" height="20" /></q-btn>
          <div class="iform-sheet-title">{{ $t('To') }}</div>
          <div class="iform-sheet-spacer"></div>
        </header>
        <div class="iform-sheet-scroll">
          <div class="iform-body">
            <div class="at-input-actions">
              <button type="button" class="at-input-action" @click="paste"><Icon icon="tabler:clipboard" width="18" height="18" />{{ $t('Paste') }}</button>
              <button type="button" class="at-input-action" @click="scanning = true"><Icon icon="tabler:scan" width="18" height="18" />{{ $t('Scan') }}</button>
            </div>
            <div v-if="candidate" class="iform-group at-candidate">
              <div class="iform-line">
                <span class="iform-line-tile at-dest-tile"><Icon :icon="destinationIcon(candidate)" width="17" height="17" /></span>
                <span class="iform-line-label">
                  {{ destinationText(candidate) }}
                  <small>{{ destinationDetail(candidate) }}</small>
                </span>
                <q-spinner v-if="candidateState === 'checking'" size="18px" class="at-check" />
              </div>
            </div>
            <p v-if="candidateMessage" class="iform-foot" :class="{ 'at-warn': candidateState !== 'checking' }" role="status">{{ candidateMessage }}</p>

            <template v-if="walletDestinations.length">
              <div class="iform-seclabel at-seclabel">{{ $t('My wallets') }}</div>
              <div class="iform-group">
                <button v-for="d in walletDestinations" :key="d.wallet.id" type="button" class="iform-line" :disabled="!!d.problem" @click="choose({ kind: 'wallet', walletId: d.wallet.id })">
                  <span class="iform-line-tile at-wallet-tile"><WalletBrandMark :type="d.wallet.type" :size="16" :color="'currentColor'" /></span>
                  <span class="iform-line-label">
                    {{ d.wallet.name }}
                    <small>{{ d.problem ? walletProblemShort(d.problem) : (d.free ? $t('Free') : '') }}</small>
                  </span>
                  <Icon v-if="isChosen({ kind: 'wallet', walletId: d.wallet.id })" icon="tabler:check" width="18" height="18" class="at-check" />
                </button>
              </div>
            </template>

            <template v-if="contactDestinations.length">
              <div class="iform-seclabel at-seclabel">{{ $t('Contacts') }}</div>
              <div class="iform-group">
                <button v-for="c in contactDestinations" :key="c.entry.id || c.destination.address" type="button" class="iform-line" @click="choose(c.destination)">
                  <ContactAvatar class="at-contact-avatar" :entry="c.entry" />
                  <span class="iform-line-label">
                    {{ c.entry.name }}
                    <small>{{ destinationText({ ...c.destination, name: '' }) }}</small>
                  </span>
                  <Icon v-if="isChosen(c.destination)" icon="tabler:check" width="18" height="18" class="at-check" />
                </button>
              </div>
            </template>
          </div>
        </div>
        <QrScanSheet v-model="scanning" @scanned="takeText" />
      </template>

      <!-- ── How fast (Bitcoin address) ──────────────────────────────── -->
      <template v-else-if="view === 'speed'">
        <header class="iform-sheet-top">
          <q-btn flat round dense class="glass-back-btn" :aria-label="$t('Back')" @click="pop"><Icon icon="tabler:chevron-left" width="20" height="20" /></q-btn>
          <div class="iform-sheet-title">{{ $t('Arrives') }}</div>
          <div class="iform-sheet-spacer"></div>
        </header>
        <div class="iform-sheet-scroll">
          <div class="iform-body">
            <div class="iform-group">
              <button v-for="speed in ['low', 'medium', 'high']" :key="speed" type="button" class="iform-line" @click="draft.feeSpeed = speed; pop()">
                <span class="iform-line-label">{{ speedLabel(speed) }}</span>
                <Icon v-if="draft.feeSpeed === speed" icon="tabler:check" width="18" height="18" class="at-check" />
              </button>
            </div>
            <p class="iform-foot">{{ $t('Faster costs more. The fee is checked at each transfer.') }}</p>
          </div>
        </div>
      </template>
    </div>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import AmountKeypad from '../AmountKeypad.vue';
import QrScanSheet from '../QrScanSheet.vue';
import WalletBrandMark from '../WalletBrandMark.vue';
import ContactAvatar from '../AddressBook/ContactAvatar.vue';
import { useWalletStore } from '../../stores/wallet';
import { useAutoWithdrawStore } from '../../stores/autoWithdraw';
import { useAddressBookStore } from '../../stores/addressBook';
import { keypadSats } from '../../utils/amountKeypad.js';
import { lnurlGetJson } from '../../utils/lnurlHttp.js';
import { readClipboardCrossPlatform } from '../../utils/shopClipboard.js';
import {
  DESTINATION_KIND,
  DESTINATION_PROBLEM,
  ROUTE,
  amountSats,
  destinationProblem,
  readDestination,
  routeFor,
  thresholdSuggestions,
  transferAmount,
} from '../../utils/autoTransfer.js';
import { destinationLabel, formatRuleAmount, formatSats, reasonText } from '../../utils/autoTransferCopy.js';

const emptyDraft = () => ({ walletId: null, threshold: null, keep: null, destination: null, feeSpeed: 'medium' });

export default {
  name: 'AutoTransferSheet',
  components: { Icon, AmountKeypad, QrScanSheet, WalletBrandMark, ContactAvatar },
  props: {
    modelValue: { type: Boolean, default: false },
    /** The wallet whose rule is edited, or the one a new rule starts with. */
    walletId: { type: String, default: '' },
    editing: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'saved'],
  setup() {
    return { walletStore: useWalletStore(), autoTransfer: useAutoWithdrawStore(), addressBook: useAddressBookStore() };
  },
  data() {
    return {
      view: 'rule',
      draft: emptyDraft(),
      keypad: { value: '', fiat: false, currency: 'USD' },
      keepSome: false,
      candidate: null,
      candidateState: null, // 'checking' | 'unknown' | 'problem' | 'silent'
      candidateAttempt: 0,
      scanning: false,
      saving: false,
    };
  },
  computed: {
    title() {
      return this.editing ? this.$t('Edit Rule') : this.$t('New Rule');
    },
    ctx() {
      return { t: this.$t.bind(this), locale: this.$i18n.locale, bip177: this.walletStore.useBip177Format, wallets: this.walletStore.wallets };
    },
    wallet() {
      return this.walletStore.wallets.find((w) => w.id === this.draft.walletId) || null;
    },
    preferredCurrency() {
      return String(this.walletStore.preferredFiatCurrency || 'USD').toUpperCase();
    },
    walletBalanceText() {
      return this.wallet ? this.balanceText(this.wallet.id) : '';
    },
    walletChoices() {
      return this.walletStore.wallets.map((w) => ({
        ...w,
        taken: w.id !== this.draft.walletId && !!this.autoTransfer.getConfig(w.id),
      }));
    },
    otherRules() {
      const rules = { ...this.autoTransfer.configs };
      delete rules[this.draft.walletId];
      return rules;
    },
    problem() {
      if (!this.wallet || !this.draft.destination) return null;
      return destinationProblem({ source: this.wallet, destination: this.draft.destination, wallets: this.walletStore.wallets, rules: this.otherRules });
    },
    destinationProblemText() {
      return this.problem ? this.reason(this.problem, this.draft.destination) : '';
    },
    destinationWallet() {
      const d = this.draft.destination;
      return d?.kind === DESTINATION_KIND.WALLET ? this.walletStore.wallets.find((w) => w.id === d.walletId) || null : null;
    },
    route() {
      return this.wallet ? routeFor(this.wallet.type || 'nwc', this.draft.destination, this.destinationWallet) : null;
    },
    /** What happens right now, in one sentence. */
    preview() {
      if (!this.wallet || !this.draft.threshold) return '';
      const balance = this.walletStore.getDisplayBalance(this.wallet.id)?.balance ?? 0;
      const holds = this.$t('{name} holds {amount} now', { name: this.wallet.name, amount: formatSats(balance, this.ctx) });
      const threshold = amountSats(this.draft.threshold, this.rateFor);
      const keep = amountSats(this.draft.keep, this.rateFor);
      if (threshold == null || keep == null) return `${holds}.`;
      if (balance <= threshold) return this.$t('{holds}, so nothing moves yet.', { holds });
      const amount = transferAmount({ balanceSats: balance, thresholdSats: threshold, keepSats: keep, route: this.route });
      if (!amount || !this.draft.destination) return `${holds}.`;
      return this.$t('{holds}, so about {amount} moves once it is on.', { holds, amount: formatSats(amount, this.ctx) });
    },
    keepTooHigh() {
      if (!this.draft.keep || !this.draft.threshold) return false;
      const keep = amountSats(this.draft.keep, this.rateFor);
      const threshold = amountSats(this.draft.threshold, this.rateFor);
      return keep != null && threshold != null && keep >= threshold;
    },
    canSave() {
      return !!(this.wallet && this.draft.threshold && this.draft.destination && !this.problem && !this.keepTooHigh);
    },

    // Keypad
    keypadSatsValue() {
      return keypadSats(this.keypad.value, { fiat: this.keypad.fiat, rate: this.rateFor(this.keypad.currency) });
    },
    suggestions() {
      return this.wallet ? thresholdSuggestions(this.walletStore.getDisplayBalance(this.wallet.id)?.balance ?? 0) : [];
    },
    amountReady() {
      if (this.view === 'move' && !this.keepSome) return true;
      return Number(this.keypad.value) > 0;
    },
    keypadHint() {
      if (!this.wallet) return '';
      if (this.view === 'threshold') {
        return this.$t('{name} holds {amount} now.', { name: this.wallet.name, amount: formatSats(this.walletStore.getDisplayBalance(this.wallet.id)?.balance ?? 0, this.ctx) });
      }
      return this.keypadHintWarn ? this.$t('Keep less than {amount}, or nothing moves.', { amount: formatRuleAmount(this.draft.threshold, this.ctx) }) : '';
    },
    keypadHintWarn() {
      if (this.view !== 'move' || !this.draft.threshold) return false;
      const threshold = amountSats(this.draft.threshold, this.rateFor);
      return threshold != null && this.keypadSatsValue >= threshold && this.keypadSatsValue > 0;
    },

    // Destinations
    walletDestinations() {
      if (!this.wallet) return [];
      return this.walletStore.wallets
        .filter((w) => w.id !== this.wallet.id)
        .map((w) => {
          const destination = { kind: DESTINATION_KIND.WALLET, walletId: w.id };
          return {
            wallet: w,
            problem: destinationProblem({ source: this.wallet, destination, wallets: this.walletStore.wallets, rules: this.otherRules }),
            free: routeFor(this.wallet.type || 'nwc', destination, w) === ROUTE.SPARK,
          };
        });
    },
    contactDestinations() {
      if (!this.wallet) return [];
      const out = [];
      for (const entry of this.addressBook.entries || []) {
        const address = String(entry.address || entry.lightningAddress || '').trim();
        const read = address && readDestination(address, this.wallet.type);
        if (!read) continue;
        const destination = { ...read, name: entry.name };
        if (destinationProblem({ source: this.wallet, destination, wallets: this.walletStore.wallets })) continue;
        out.push({ entry, destination });
      }
      return out.sort((a, b) => a.entry.name.localeCompare(b.entry.name));
    },
    candidateMessage() {
      if (!this.candidateState) return '';
      if (this.candidateState === 'checking') return this.$t('Checking…');
      if (this.candidateState === 'unknown') return this.$t('That is not an address this wallet can send to.');
      if (this.candidateState === 'silent') return this.reason('unreachable', this.candidate);
      return this.reason(destinationProblem({ source: this.wallet, destination: this.candidate, wallets: this.walletStore.wallets, rules: this.otherRules }), this.candidate);
    },
  },
  watch: {
    modelValue: {
      immediate: true,
      handler(open) {
        if (open) this.load();
      },
    },
  },
  methods: {
    load() {
      this.view = 'rule';
      const rule = this.walletId ? this.autoTransfer.getConfig(this.walletId) : null;
      const startWallet = this.walletId || this.firstFreeWalletId();
      this.draft = rule && this.editing
        ? { walletId: this.walletId, threshold: rule.threshold, keep: rule.keep, destination: rule.destination, feeSpeed: rule.feeSpeed }
        : { ...emptyDraft(), walletId: startWallet };
    },
    reset() {
      this.view = 'rule';
      this.candidate = null;
      this.candidateState = null;
      this.scanning = false;
    },
    close() {
      this.$emit('update:modelValue', false);
    },
    firstFreeWalletId() {
      const active = this.walletStore.activeWalletId;
      if (active && !this.autoTransfer.getConfig(active)) return active;
      return this.walletStore.wallets.find((w) => !this.autoTransfer.getConfig(w.id))?.id || null;
    },
    push(view) {
      if (view === 'destination') {
        this.candidate = null;
        this.candidateState = null;
      }
      this.view = view;
    },
    pop() {
      this.view = 'rule';
    },

    // Formatting
    rateFor(currency) {
      return Number(this.walletStore.exchangeRates?.[String(currency || '').toLowerCase()]) || 0;
    },
    amountText(amount) {
      return formatRuleAmount(amount, this.ctx);
    },
    balanceText(walletId) {
      const balance = this.walletStore.getDisplayBalance(walletId);
      return balance?.known === false ? '' : formatSats(balance?.balance ?? 0, this.ctx);
    },
    compact(sats) {
      return new Intl.NumberFormat(this.$i18n.locale, { notation: 'compact' }).format(sats);
    },
    destinationText(destination) {
      return destinationLabel(destination, this.ctx);
    },
    destinationDetail(destination) {
      if (destination.kind === DESTINATION_KIND.WALLET) {
        return this.wallet && routeFor(this.wallet.type || 'nwc', destination, this.walletStore.wallets.find((w) => w.id === destination.walletId)) === ROUTE.SPARK
          ? this.$t('My wallet · free')
          : this.$t('My wallet');
      }
      if (destination.name) return destinationLabel({ ...destination, name: '' }, this.ctx);
      if (destination.kind === DESTINATION_KIND.BITCOIN) return this.$t('Bitcoin address');
      if (destination.kind === DESTINATION_KIND.SPARK) return this.$t('Spark address');
      if (destination.kind === DESTINATION_KIND.ARKADE) return this.$t('Arkade address');
      return '';
    },
    destinationIcon(destination) {
      if (destination.kind === DESTINATION_KIND.BITCOIN) return 'tabler:currency-bitcoin';
      if (destination.kind === DESTINATION_KIND.LIGHTNING) return 'tabler:at';
      return 'tabler:qrcode';
    },
    speedLabel(speed) {
      return { low: this.$t('Within an hour'), medium: this.$t('About 30 minutes'), high: this.$t('Next block') }[speed];
    },
    reason(problem, destination) {
      return reasonText(problem, { t: this.$t.bind(this), wallet: this.wallet?.name || '', destination: destination ? destinationLabel(destination, this.ctx) : '' });
    },
    walletProblemShort(problem) {
      if (problem === DESTINATION_PROBLEM.LOOP) return this.$t('Sends here');
      if (problem === DESTINATION_PROBLEM.CANNOT_RECEIVE) return this.$t("Can't receive payments");
      return this.$t("Can't be paid from {name}", { name: this.wallet?.name || '' });
    },

    // Choosing
    chooseWallet(walletId) {
      this.draft.walletId = walletId;
      if (this.draft.destination?.kind === DESTINATION_KIND.WALLET && this.draft.destination.walletId === walletId) this.draft.destination = null;
      this.pop();
    },
    openAmount(view) {
      const amount = view === 'threshold' ? this.draft.threshold : this.draft.keep;
      this.keepSome = !!this.draft.keep;
      this.setKeypad(amount);
      this.view = view;
    },
    setKeypad(amount) {
      if (amount?.fiat != null) this.keypad = { value: String(amount.fiat), fiat: true, currency: amount.currency };
      else this.keypad = { value: amount?.sats ? String(amount.sats) : '', fiat: false, currency: this.preferredCurrency };
    },
    startKeep() {
      if (!this.keepSome) {
        this.keepSome = true;
        // Keep in the unit the threshold was typed in.
        this.setKeypad(this.draft.keep);
        if (!this.draft.keep && this.draft.threshold?.fiat != null) this.keypad = { value: '', fiat: true, currency: this.draft.threshold.currency };
      }
    },
    keypadAmount() {
      if (!(Number(this.keypad.value) > 0)) return null;
      return this.keypad.fiat
        ? { fiat: Number(this.keypad.value), currency: this.keypad.currency.toUpperCase() }
        : { sats: this.keypadSatsValue };
    },
    confirmAmount() {
      if (this.view === 'threshold') this.draft.threshold = this.keypadAmount();
      else this.draft.keep = this.keepSome ? this.keypadAmount() : null;
      this.pop();
    },
    isChosen(destination) {
      const current = this.draft.destination;
      if (!current || current.kind !== destination.kind) return false;
      return destination.kind === DESTINATION_KIND.WALLET ? current.walletId === destination.walletId : current.address === destination.address;
    },
    choose(destination) {
      this.draft.destination = destination;
      this.pop();
    },
    async paste() {
      let text = '';
      try {
        text = await readClipboardCrossPlatform();
      } catch { /* nothing to read */ }
      await this.takeText(text);
    },
    /** A pasted or scanned destination: recognized, allowed, and for a Lightning address, answering. */
    async takeText(text) {
      // Only the newest paste or scan may finish (a reactive proxy never
      // equals the object it wraps, so the check counts instead).
      const attempt = ++this.candidateAttempt;
      const read = this.wallet ? readDestination(String(text || ''), this.wallet.type) : null;
      this.candidate = read;
      if (!read) {
        this.candidateState = text ? 'unknown' : null;
        return;
      }
      if (destinationProblem({ source: this.wallet, destination: read, wallets: this.walletStore.wallets, rules: this.otherRules })) {
        this.candidateState = 'problem';
        return;
      }
      if (read.kind === DESTINATION_KIND.LIGHTNING) {
        this.candidateState = 'checking';
        const answers = await this.lightningAddressAnswers(read.address);
        if (attempt !== this.candidateAttempt) return;
        if (!answers) {
          this.candidateState = 'silent';
          return;
        }
      }
      this.candidateState = null;
      this.choose(read);
    },
    async lightningAddressAnswers(address) {
      const [user, domain] = address.split('@');
      try {
        // A person is waiting on this: give up sooner than a payment would.
        const response = await lnurlGetJson(`https://${domain}/.well-known/lnurlp/${user}`, { timeoutMs: 8000 });
        return response.ok && response.data?.tag === 'payRequest' && !!response.data.callback;
      } catch {
        return false;
      }
    },

    async save() {
      if (!this.canSave || this.saving) return;
      this.saving = true;
      try {
        await this.autoTransfer.saveRule(this.draft.walletId, {
          threshold: this.draft.threshold,
          keep: this.draft.keep,
          destination: this.draft.destination,
          feeSpeed: this.draft.feeSpeed,
        });
        this.$emit('saved', this.draft.walletId);
        this.close();
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>

<style scoped>
/* Quasar only makes a dialog's direct child tappable: keep it a <div>. */
.at-sheet {
  pointer-events: all;
  height: min(760px, calc(100dvh - var(--safe-top, 0px) - 10px));
}
.at-bar-action {
  flex-shrink: 0;
  min-width: 64px;
  min-height: 40px;
  padding: 0 6px;
  border: 0;
  background: none;
  color: var(--brand-accent-text);
  font: 600 15px 'Manrope', sans-serif;
  text-align: left;
  cursor: pointer;
}
.at-bar-action--ghost { visibility: hidden; }
.at-seclabel { margin: 18px 4px 8px; }
.at-seclabel:first-child { margin-top: 4px; }
.at-wallet-tile,
.at-dest-tile { color: var(--text-primary); }
.at-check { flex-shrink: 0; color: var(--brand-accent-text); }
.at-warn { color: #8A5A00; }
body.body--dark .at-warn { color: #F5C451; }
.at-primary { width: 100%; }
.at-primary:disabled { opacity: 0.4; cursor: default; }
.iform-line:disabled { cursor: default; }
.iform-line:disabled .iform-line-label,
.iform-line:disabled .iform-line-tile { opacity: 0.45; }
.at-move-choice { padding: 0 20px 4px; }
.at-keypad { padding: 0 20px; }
.at-spacer { flex: 1; }
.at-chips { display: flex; gap: 8px; justify-content: center; }
.at-chip {
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--border-card);
  background: none;
  color: var(--text-secondary);
  font: 600 14px 'Manrope', sans-serif;
  cursor: pointer;
}
.at-chip.is-on { background: var(--text-primary); color: var(--bg-primary); border-color: transparent; }
.at-keypad-hint { margin: 0; font: 500 13px/1.4 'Manrope', sans-serif; color: var(--text-secondary); text-align: center; }
.at-input-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.at-input-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 46px;
  border-radius: 14px;
  border: 1px solid var(--border-card);
  background: var(--bg-input);
  color: var(--text-primary);
  font: 600 15px 'Manrope', sans-serif;
  cursor: pointer;
}
.at-candidate { margin-bottom: 2px; }
.at-contact-avatar { width: 32px; height: 32px; flex-shrink: 0; }
</style>
