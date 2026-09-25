<template>
  <q-page class="id-sub-page identity-surface exit-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Settings')" to="/settings?section=advanced" />

    <div class="id-sub-body exit-body">
      <h1 class="id-large-title">{{ $t('Emergency exit') }}</h1>
      <p class="exit-wallet">{{ walletName }}</p>

      <section class="exit-status" :class="`exit-status--${status.tone}`" aria-live="polite">
        <span class="exit-status-icon" aria-hidden="true"><Icon :icon="status.icon" width="24" height="24" /></span>
        <div class="exit-status-copy">
          <strong>{{ status.title }}</strong>
          <span>{{ status.text }}</span>
          <span v-if="lastChecked" class="exit-status-meta">{{ lastChecked }}</span>
        </div>
      </section>

      <!-- Before anything starts: the honest figures and one free action. -->
      <template v-if="!tracked">
        <IdentityGroup :title="$t('If you leave now')" :footer="quoteFooter">
          <IdentityRow :label="$t('Can leave now')" :interactive="false" :chevron="false">
            <template #trailing><span class="exit-figure exit-figure--strong">{{ sats(triage.recoverableSat) }}</span></template>
          </IdentityRow>
          <IdentityRow :label="$t('Fee money you send')" :caption="$t('On-chain Bitcoin from another wallet, sent to a separate address.')" wrap :interactive="false" :chevron="false">
            <template #trailing><span class="exit-figure">{{ sats(triage.fundingSat) }}</span></template>
          </IdentityRow>
          <IdentityRow :label="$t('Taken from the amount')" :caption="$t('The final transaction pays its own fee.')" wrap :interactive="false" :chevron="false">
            <template #trailing><span class="exit-figure">{{ $t('about {amount} sats', { amount: num(triage.sweepFeeSat) }) }}</span></template>
          </IdentityRow>
          <IdentityRow :label="$t('Not worth moving')" :caption="$t('They stay in this Spark wallet and can be spent normally if Spark comes back.')" wrap :interactive="false" :chevron="false">
            <template #trailing><span class="exit-figure">{{ sats(triage.notWorthSat) }}</span></template>
          </IdentityRow>
          <IdentityRow :label="$t('Arrives as plain Bitcoin')" :caption="shortAddress(destinationAddress)" mono :chevron="false" @click="openDestination">
            <template #trailing>
              <span class="exit-change">{{ $t('Change') }}</span>
              <span class="exit-figure exit-figure--strong">{{ $t('about {amount} sats', { amount: num(triage.arrivesSat) }) }}</span>
            </template>
          </IdentityRow>
        </IdentityGroup>

        <div class="exit-callout">
          <Icon icon="tabler:info-circle" width="18" height="18" aria-hidden="true" />
          <span>{{ $t('While Spark is running, a normal withdrawal is faster and cheaper.') }}</span>
        </div>

        <p v-if="triage.fundingSat > 0" class="exit-note exit-note--center">{{ $t('You will need about {amount} sats of on-chain Bitcoin from another wallet to pay the fees.', { amount: num(triage.fundingSat) }) }}</p>
        <p v-if="startError" class="exit-error" role="alert">{{ startError }}</p>
        <button type="button" class="btn-primary" :disabled="!canStart" @click="start">{{ $t('Start emergency exit') }}</button>
        <p class="exit-hint">{{ $t('Starting is free and can be cancelled before anything is sent.') }}</p>
        <p v-if="lastFinished" class="exit-note exit-note--center">{{ lastFinished }}</p>
        <button type="button" class="btn-quiet" @click="showHow = true">{{ $t('How the emergency exit works') }}</button>
      </template>

      <!-- In progress or just finished: a tracker over the persisted ledger. -->
      <template v-else>
        <ol class="exit-stages">
          <li v-for="stage in stages" :key="stage.key" class="exit-stage" :class="`is-${stage.state}`" :aria-current="stage.state === 'current' ? 'step' : null">
            <span class="exit-stage-mark" aria-hidden="true">
              <Icon v-if="stage.state === 'done'" icon="tabler:check" width="14" height="14" />
              <span v-else-if="stage.state === 'current'" class="exit-stage-dot"></span>
            </span>
            <div class="exit-stage-body">
              <strong>{{ stage.name }}</strong>
              <span v-if="stage.summary" class="exit-stage-summary">{{ stage.summary }}</span>

              <div v-if="stage.key === 'fund' && exit.stage === 'fund'" class="exit-panel">
                <p>{{ fundingHeadline }}</p>
                <div class="exit-qr" role="img" :aria-label="exit.funding.address"><vue-qrcode :value="fundingUri" :options="qrOptions" /></div>
                <code class="exit-address">{{ exit.funding.address }}</code>
                <button type="button" class="btn-ghost" @click="copyText(exit.funding.address)">{{ $t('Copy address') }}</button>
                <p class="exit-note">{{ fundingStatus }}</p>
              </div>

              <div v-if="stage.key === 'send' && exit.stage === 'send'" class="exit-panel">
                <div class="exit-progress" role="progressbar" :aria-label="stage.name" :aria-valuenow="progressPct" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: progressPct + '%' }"></span></div>
                <p class="exit-note">{{ $t('Each transaction goes out when the one before it confirms.') }} {{ $t('Continues each time you open BuhoGO.') }}</p>
              </div>

              <div v-if="stage.key === 'unlock' && exit.stage === 'unlock'" class="exit-panel">
                <div class="exit-progress" role="progressbar" :aria-label="stage.name" :aria-valuenow="unlockPct" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: unlockPct + '%' }"></span></div>
                <p class="exit-note">{{ unlockNote }}</p>
                <p class="exit-note">{{ $t('Counted in Bitcoin blocks, so the date can shift by a day either way.') }}</p>
              </div>
            </div>
          </li>
        </ol>

        <p v-if="errorLine" class="exit-error" role="status">{{ errorLine }}</p>

        <template v-if="exit.stage === 'done'">
          <IdentityGroup :title="$t('Where the money is now')" :footer="spendHint">
            <IdentityRow :label="exit.destination.address" mono-label wrap :interactive="false" :chevron="false" />
            <IdentityRow :label="$t('Copy address')" icon="tabler:copy" :chevron="false" @click="copyText(exit.destination.address)" />
            <IdentityRow :label="$t('View on mempool.space')" icon="tabler:external-link" :chevron="false" @click="openExplorer" />
          </IdentityGroup>
          <button type="button" class="btn-primary" @click="finish">{{ $t('Done') }}</button>
        </template>

        <template v-else-if="exit.stage === 'ready'">
          <p v-if="!connected" class="exit-note exit-note--center">{{ $t('Switch to {wallet} on the home screen first, then confirm the send.', { wallet: walletName }) }}</p>
          <button type="button" class="btn-primary" :disabled="sending || !connected" @click="confirmOpen = true">{{ $t('Send to Bitcoin') }}</button>
        </template>

        <button v-if="cancellable" type="button" class="btn-danger" @click="cancel">{{ $t('Cancel emergency exit') }}</button>
        <button type="button" class="btn-quiet" @click="showHow = true">{{ $t('How the emergency exit works') }}</button>
      </template>
    </div>

    <!-- Keep the transaction facts and the point of no return visible together. -->
    <q-dialog v-model="confirmOpen" :position="$q.screen.lt.sm ? 'bottom' : 'standard'" :persistent="sending" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="identity-surface exit-confirm" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'" role="dialog" aria-labelledby="exit-confirm-title" aria-describedby="exit-confirm-warning">
        <h2 id="exit-confirm-title" class="exit-confirm-title">{{ $t('Send to Bitcoin now?') }}</h2>
        <div v-if="exit?.quote" class="exit-confirm-body">
          <dl class="exit-confirm-facts">
            <div class="exit-confirm-amount">
              <dt>{{ $t('Leaving Spark') }}</dt>
              <dd>{{ sats(exit.quote.recoverableValueSat) }}</dd>
            </div>
            <div class="exit-confirm-destination">
              <dt>{{ $t('Where the money arrives') }}</dt>
              <dd>{{ exit.destination.address }}</dd>
            </div>
            <div>
              <dt>{{ $t('Fee money used') }}</dt>
              <dd>{{ $t('about {amount} sats', { amount: num(exit.quote.singleUtxoFundingSat) }) }}</dd>
            </div>
            <div>
              <dt>{{ $t('Taken from the amount') }}</dt>
              <dd>{{ $t('about {amount} sats', { amount: num(confirmSweepFeeSat) }) }}</dd>
            </div>
          </dl>
          <p v-if="fundingExcessSat > 0" class="exit-confirm-extra">{{ $t('{amount} sats of extra fee money may also be spent on fees.', { amount: num(fundingExcessSat) }) }}</p>
          <div class="exit-confirm-warning">
            <strong id="exit-confirm-warning">{{ $t('Once sent, this cannot be stopped.') }}</strong>
            <p>{{ $t('It takes about two weeks') }}</p>
            <p>{{ $t('Keep BuhoGO installed on this phone. Open it daily until the exit finishes.') }}</p>
          </div>
        </div>
        <div class="exit-confirm-actions">
          <button type="button" class="btn-primary" :disabled="sending" @click="send">{{ sending ? $t('Signing') : $t('Send to Bitcoin') }}</button>
          <button type="button" class="btn-quiet" autofocus :disabled="sending" @click="confirmOpen = false">{{ $t('Cancel') }}</button>
        </div>
      </q-card>
    </q-dialog>

    <q-dialog v-model="destinationOpen" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="identity-surface exit-destination" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <div class="sheet-grab" aria-hidden="true"><span></span></div>
        <div class="sheet-head">
          <div class="sheet-title">{{ $t('Where the money arrives') }}</div>
          <q-btn flat round class="sheet-close" :aria-label="$t('Close')" @click="destinationOpen = false">
            <Icon icon="tabler:x" width="18" height="18" />
          </q-btn>
        </div>
        <div class="sheet-body exit-destination-body">
          <p class="exit-note">{{ $t('Your recovery words control the default address. Change it only if you want the money somewhere else.') }}</p>
          <IdentityGroup :title="$t('Current address')">
            <IdentityRow :label="destinationAddress" mono-label wrap :interactive="false" :chevron="false" />
            <IdentityRow :label="$t('Copy address')" icon="tabler:copy" :chevron="false" @click="copyText(destinationAddress)" />
          </IdentityGroup>
          <label class="field">
            <span class="field-label">{{ $t('Paste a Bitcoin address') }}</span>
            <input v-model.trim="destinationInput" class="field-input" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="bc1q…" />
          </label>
          <p v-if="destinationError" class="exit-error" role="alert">{{ destinationError }}</p>
          <div class="exit-destination-actions">
            <button type="button" class="btn-ghost" @click="pasteDestination">{{ $t('Paste') }}</button>
            <button type="button" class="btn-primary" :disabled="!destinationInput || savingDestination" @click="useDestination">{{ $t('Use this address') }}</button>
          </div>
        </div>
      </q-card>
    </q-dialog>

    <HowExitWorksSheet v-model="showHow" />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import IdentityNav from '../components/identity/IdentityNav.vue';
import IdentityGroup from '../components/identity/IdentityGroup.vue';
import IdentityRow from '../components/identity/IdentityRow.vue';
import HowExitWorksSheet from '../components/exit/HowExitWorksSheet.vue';
import { useWalletStore } from '../stores/wallet';
import { useExitKitStore } from '../stores/exitKit';
import { useEmergencyExitStore } from '../stores/emergencyExit';
import { exitDriver } from '../services/emergencyExit.js';
import { exitKitService } from '../services/exitKit.js';
import { remindersAvailable } from '../services/exitNotifications.js';
import { sparkHealth } from '../utils/sparkHealth.js';
import { canCancel, canChangeDestination, needsAttention, isActive, arrivedSat, sweepFeeSat, selectFundingInputs } from '../utils/exitLedger.js';
import { classifyDestination } from '../utils/exitKeys.js';
import { kitState } from '../utils/exitKit.js';
import { readClipboardCrossPlatform } from '../utils/shopClipboard.js';
import { fiatRatesService } from '../utils/fiatRates';
import { formatSats, formatDay, formatTime, relativeDay, durationText, shortAddress } from '../composables/useExitFormat.js';

const STAGE_INDEX = { fund: 1, ready: 1, send: 2, unlock: 3, sweep: 3, done: 4 };
const TICK_MS = 60 * 1000;
const STUCK_ATTEMPTS = 3;
const BLOCK_MS = 10 * 60 * 1000;

/**
 * Emergency exit for one Spark wallet. Before it starts: what could leave
 * today, what it costs, where it goes, and one free action. Once started: a
 * resumable tracker over the persisted ledger, so the page reads the same
 * after a restart or a week away. The only alert is the point of no return.
 */
export default {
  name: 'EmergencyExitPage',
  components: { Icon, VueQrcode, IdentityNav, IdentityGroup, IdentityRow, HowExitWorksSheet },
  setup() {
    return { wallet: useWalletStore(), kits: useExitKitStore(), exits: useEmergencyExitStore() };
  },
  data() {
    return {
      starting: false,
      sending: false,
      startError: '',
      confirmOpen: false,
      destinationOpen: false,
      destinationInput: '',
      destinationError: '',
      savingDestination: false,
      showHow: false,
      remindersOn: false,
      timer: null,
    };
  },
  computed: {
    walletId() { return this.$route.params.walletId; },
    walletEntry() { return this.wallet.wallets.find(w => w.id === this.walletId) || null; },
    walletName() { return this.walletEntry?.name || 'Spark'; },
    connected() { return !!this.wallet.getSparkProvider(this.walletId)?.isConnected; },
    kit() { return this.kits.kitFor(this.walletId); },
    exit() { return this.exits.exitFor(this.walletId); },
    /** The tracker shows while an exit runs or its receipt has not been seen. */
    tracked() { return needsAttention(this.exit); },
    triage() {
      const kit = this.kit || {};
      const fundingSat = kit.fundingSat || 0;
      return {
        recoverableSat: kit.recoverableSat || 0,
        fundingSat,
        sweepFeeSat: Math.max(0, (kit.feeSat || 0) - fundingSat),
        notWorthSat: kit.notWorthSat || 0,
        arrivesSat: kit.arrivesSat || 0,
      };
    },
    derivedDestination() { return this.kit?.destinationAddress || ''; },
    destinationAddress() { return this.exit?.destination.address || this.kit?.customDestination || this.derivedDestination; },
    kitReady() { return ['checked', 'saved'].includes(kitState(this.kit)); },
    canStart() { return this.connected && this.kitReady && this.triage.recoverableSat > 0 && !this.starting; },
    cancellable() { return canCancel(this.exit); },
    qrOptions() { return { width: 168, margin: 1, color: { dark: '#1A1A1C', light: '#FFFFFF' } }; },
    fundingUri() {
      const exit = this.exit;
      return exit ? `bitcoin:${exit.funding.address}?amount=${(exit.funding.requiredSat / 1e8).toFixed(8)}` : '';
    },
    progressPct() {
      const p = this.exit?.progress;
      return p?.total ? Math.round((p.confirmed / p.total) * 100) : 0;
    },
    unlockPct() {
      const exit = this.exit;
      if (!exit?.unlock || !exit.built) return 0;
      const total = Math.max(1, ...exit.built.transactions.map(tx => tx.csvTimelockBlocks || 0));
      return Math.max(0, Math.min(100, Math.round((1 - exit.unlock.blocksLeft / total) * 100)));
    },
    unlockNote() {
      const exit = this.exit;
      if (!exit?.unlock) return '';
      if (this.remindersOn && exit.reminderAt) return this.$t('You get a notification on the day. Nothing to do until then.');
      return this.$t('Open BuhoGO on or after {date}. Nothing to do until then.', { date: this.day(exit.unlock.estimatedAt) });
    },
    quoteFooter() {
      const when = this.kit?.checkedAt ? this.relativeDay(this.kit.checkedAt) : '';
      return this.$t('From the last check {date}. Starting takes a fresh quote at today\'s fees. Nothing is sent until you confirm the last step.', { date: when });
    },
    sparkLine() {
      const health = sparkHealth();
      if (health.isSustainedOutage(this.walletId)) {
        return this.$t('Spark has not answered for {duration}.', { duration: durationText(health.unreachableFor(this.walletId), this.tr) });
      }
      const at = health.lastSuccessAt(this.walletId);
      if (!at) return '';
      const when = this.relativeDay(at) === this.$t('today') ? `${this.$t('today')} ${formatTime(at, this.$i18n.locale)}` : this.relativeDay(at);
      return this.$t('Last answer from Spark {when}.', { when });
    },
    lastChecked() {
      const exit = this.exit;
      if (!exit || !isActive(exit) || !exit.lastCheckedAt) return '';
      return this.$t('Last checked {time}', { time: formatTime(exit.lastCheckedAt, this.$i18n.locale) });
    },
    lastFinished() {
      const exit = this.exit;
      if (!exit || exit.stage !== 'done' || !exit.acknowledgedAt) return '';
      return this.$t('Last exit finished {date}: {amount} sats to {address}', { date: this.day(exit.doneAt), amount: this.num(arrivedSat(exit)), address: shortAddress(exit.destination.address) });
    },
    fundingHeadline() {
      const funding = this.exit?.funding;
      if (!funding) return '';
      if (funding.confirmedSat > 0 && funding.shortfallSat > 0) return this.$t('Send {amount} sats more to this address.', { amount: this.num(funding.shortfallSat) });
      return this.$t('Send exactly {amount} sats to this address. It pays the network fees. Anything extra may also go to fees.', { amount: this.num(funding.requiredSat) });
    },
    fundingStatus() {
      const funding = this.exit?.funding;
      if (!funding) return '';
      const seen = funding.utxos.filter(u => !u.confirmed).reduce((sum, u) => sum + u.value, 0);
      let line;
      if (funding.confirmedSat > 0 && funding.shortfallSat > 0) line = this.$t('{confirmed} sats confirmed · {shortfall} sats more needed', { confirmed: this.num(funding.confirmedSat), shortfall: this.num(funding.shortfallSat) });
      else if (seen > 0) line = this.$t('{amount} sats seen, waiting for one confirmation.', { amount: this.num(seen) });
      else line = this.$t('Waiting for the fee money to arrive.');
      return `${line} ${this.$t('Continues each time you open BuhoGO.')}`;
    },
    fundingExcessSat() {
      const exit = this.exit;
      return exit ? selectFundingInputs(exit.funding.utxos, exit.funding.requiredSat).excessSat : 0;
    },
    confirmSweepFeeSat() { return this.exit ? sweepFeeSat(this.exit) : 0; },
    spendHint() {
      return this.exit?.destination.source === 'custom'
        ? this.$t('It is in the wallet you chose.')
        : this.$t('To spend it, enter this wallet\'s recovery words in any Bitcoin wallet that supports bc1q addresses. The money appears there.');
    },
    errorLine() {
      const exit = this.exit;
      if (!exit?.lastError || !isActive(exit)) return '';
      if (exit.lastErrorCode === 'UNREACHABLE' && exit.attempts >= STUCK_ATTEMPTS) return this.$t('Still could not reach the Bitcoin network. BuhoGO keeps trying each time you open it.');
      return this.$t('Last attempt failed: {error}. Trying again in a few minutes.', { error: this.describeError({ code: exit.lastErrorCode, message: exit.lastError }) });
    },
    status() {
      const exit = this.exit;
      const t = this.tr;
      if (!this.tracked) {
        if (!this.connected) return { icon: 'tabler:plug-connected', tone: 'neutral', title: t('Wallet not connected'), text: t('Switch to {wallet} on the home screen to connect it, then come back here.', { wallet: this.walletName }) };
        const state = kitState(this.kit);
        if (state === 'failed') {
          const reason = this.kit.lastError ? ` ${this.describeError({ message: this.kit.lastError })}` : '';
          return { icon: 'tabler:alert-triangle', tone: 'warn', title: t('Exit kit needs a refresh'), text: t('Could not refresh since {date}. Payments after that date are not covered yet.', { date: this.relativeDay(this.kit.failedSince) }) + reason };
        }
        if (state === 'none') return { icon: 'tabler:fire-extinguisher', tone: 'neutral', title: t('Exit kit not checked yet'), text: t('Checking now.') };
        if (this.triage.recoverableSat <= 0) {
          if (this.triage.notWorthSat > 0) return { icon: 'tabler:coins', tone: 'neutral', title: t('Nothing worth moving at today\'s fees'), text: `${t('{amount} sats are here, but each piece costs more to move than it is worth.', { amount: this.num(this.triage.notWorthSat) })} ${t('They stay in this Spark wallet and can be spent normally if Spark comes back.')}` };
          return { icon: 'tabler:wallet', tone: 'neutral', title: t('This wallet is empty'), text: t('There is nothing to move.') };
        }
        const at = this.kit.checkedAt || this.kit.exportedAt;
        const checked = this.relativeDay(at) === t('today') ? t('Exit kit checked today') : t('Exit kit checked {date}', { date: this.relativeDay(at) });
        return { icon: 'tabler:shield-check', tone: 'accent', title: t('Ready to leave on your own'), text: [`${checked}.`, this.sparkLine].filter(Boolean).join(' ') };
      }
      switch (exit.stage) {
        case 'fund': return { icon: 'tabler:fire-extinguisher', tone: 'neutral', title: t('Add fee money'), text: t('Waiting for the fee money.') };
        case 'ready': return { icon: 'tabler:fire-extinguisher', tone: 'accent', title: t('Fee money confirmed'), text: this.connected ? t('Confirm the send when you are ready. Nothing has left Spark yet.') : t('Switch to {wallet} on the home screen first, then confirm the send.', { wallet: this.walletName }) };
        case 'send': return exit.sentAt
          ? { icon: 'tabler:fire-extinguisher', tone: 'accent', title: t('On its way'), text: t('Cannot be stopped now. Continues each time you open BuhoGO.') }
          : { icon: 'tabler:fire-extinguisher', tone: 'accent', title: t('Signed, sending the first transaction'), text: t('Continues each time you open BuhoGO.') };
        case 'unlock': return { icon: 'tabler:calendar-time', tone: 'accent', title: t('Unlocks around {date}', { date: this.day(exit.unlock?.estimatedAt) }), text: this.unlockNote };
        case 'sweep': return { icon: 'tabler:fire-extinguisher', tone: 'accent', title: t('Unlocked, sending the last transaction'), text: t('Waiting for its confirmation.') };
        default: return { icon: 'tabler:check', tone: 'accent', title: t('Your money is plain Bitcoin now'), text: t('{amount} sats arrived on {date}.', { amount: this.num(arrivedSat(exit)), date: this.day(exit.doneAt) }) };
      }
    },
    stages() {
      const exit = this.exit;
      if (!exit) return [];
      const t = this.tr;
      const index = STAGE_INDEX[exit.stage] ?? 0;
      const progress = exit.progress || { confirmed: 0, total: exit.built?.transactions.length || 0 };
      const sweepSent = exit.stage === 'sweep' && (exit.pending || []).length > 0;
      const unlockSummary = exit.stage === 'unlock' && exit.unlock
        ? t('{blocks} blocks left, about {duration}', { blocks: this.num(exit.unlock.blocksLeft), duration: durationText(exit.unlock.blocksLeft * BLOCK_MS, t) })
        : exit.stage === 'sweep' ? (sweepSent ? t('Final transaction sent, waiting for confirmation') : t('Unlocked'))
          : exit.stage === 'done' && exit.unlock ? this.day(exit.unlock.estimatedAt) : '';
      const items = [
        { key: 'check', name: t('Check'), summary: t('{amount} sats can leave · {dust} sats stay', { amount: this.num(exit.triage.recoverableSat), dust: this.num(exit.triage.notWorthSat) }) },
        { key: 'fund', name: t('Add fee money'), summary: exit.funding.confirmedAt ? t('{amount} sats confirmed', { amount: this.num(exit.funding.confirmedSat) }) : '' },
        { key: 'send', name: t('Send to Bitcoin'), summary: index >= 2 ? t('{confirmed} of {total} transactions confirmed', { confirmed: progress.confirmed, total: progress.total }) : '' },
        { key: 'unlock', name: t('Unlocking'), summary: unlockSummary },
        { key: 'done', name: t('Done'), summary: exit.stage === 'done' ? t('Fee money used {funding} sats · From the amount {sweep} sats · Left in Spark {dust} sats', { funding: this.num(exit.quote.singleUtxoFundingSat), sweep: this.num(sweepFeeSat(exit)), dust: this.num(exit.triage.notWorthSat) }) : '' },
      ];
      return items.map((item, i) => ({ ...item, state: exit.stage === 'done' ? 'done' : i < index ? 'done' : i === index ? 'current' : 'upcoming' }));
    },
  },
  async mounted() {
    if (!this.wallet.isInitialized) await this.wallet.initialize();
    this.remindersOn = await remindersAvailable().catch(() => false);
    this.refreshKit();
    await this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  },
  beforeUnmount() {
    if (this.timer) clearInterval(this.timer);
  },
  methods: {
    shortAddress,
    tr(key, params) { return this.$t(key, params); },
    num(value) { return formatSats(value, this.$i18n.locale); },
    sats(value) { return `${this.num(value)} sats`; },
    day(timestamp) { return timestamp ? formatDay(timestamp, this.$i18n.locale) : ''; },
    relativeDay(timestamp) { return relativeDay(timestamp, this.tr, this.$i18n.locale); },
    refreshKit() {
      if (!this.connected || isActive(this.exit)) return;
      exitKitService().refresh(this.walletId, { force: true, reason: 'exit page' }).catch(() => {});
    },
    async tick() {
      if (isActive(this.exit)) await exitDriver().tick(this.walletId).catch(() => {});
    },
    describeError(error) {
      const code = error?.code || '';
      const reason = String(error?.message || error || '').slice(0, 80);
      switch (code) {
        case 'NOT_CONNECTED': return this.$t('Switch to {wallet} on the home screen to connect it, then come back here.', { wallet: this.walletName });
        case 'NOTHING_TO_EXIT': return this.$t('Nothing worth moving at today\'s fees');
        case 'MORE_FEE_MONEY': return this.$t('Fees rose. {amount} sats more fee money is needed.', { amount: this.num(this.exit?.funding?.shortfallSat || 0) });
        case 'DESTINATION_NOT_ONCHAIN': return this.$t('Not a Bitcoin address');
        case 'DESTINATION_WRONG_NETWORK': return this.$t('This address belongs to another network.');
        case 'DESTINATION_SPARK_DEPOSIT': return this.$t('This is the wallet\'s own deposit address. It would send the money back into Spark.');
        case 'KEY_MISMATCH': return this.$t('This phone\'s keys do not match the fee money address. Restore the wallet from its words and try again.');
        case 'UNREACHABLE': return this.$t('Could not reach the Bitcoin network.');
        case 'REJECTED': return this.$t('The Bitcoin network refused a transaction: {reason}', { reason });
        default: return this.$t('Something went wrong: {reason}', { reason });
      }
    },
    async start() {
      this.starting = true;
      this.startError = '';
      try {
        await exitDriver().start(this.walletId, {
          destination: this.kit?.customDestination || null,
          excluded: [this.kit?.depositAddress].filter(Boolean),
        });
        await this.tick();
      } catch (error) {
        this.startError = this.describeError(error);
      } finally {
        this.starting = false;
      }
    },
    async send() {
      this.sending = true;
      try {
        await exitDriver().confirmSend(this.walletId);
        this.confirmOpen = false;
      } catch (error) {
        this.confirmOpen = false;
        this.$q.notify({ type: 'negative', message: `${this.$t('Nothing was sent. Your fee money is untouched.')} ${this.describeError(error)}` });
      } finally {
        this.sending = false;
      }
    },
    cancel() {
      const funding = this.exit?.funding;
      const message = funding?.confirmedSat > 0
        ? this.$t('{amount} sats of fee money stay at {address} and belong to your recovery words. Start again any time to reuse them.', { amount: this.num(funding.confirmedSat), address: shortAddress(funding.address) })
        : this.$t('Nothing has been sent or spent.');
      this.$q.dialog({
        title: this.$t('Cancel emergency exit?'),
        message,
        ok: { label: this.$t('Cancel emergency exit'), flat: true, color: 'negative', noCaps: true },
        cancel: { label: this.$t('Keep going'), flat: true, noCaps: true },
        // The plugin puts `class` on the card itself, so it takes the card style.
        class: this.$q.dark.isActive ? 'card_dark_style' : 'card_light_style',
        dark: this.$q.dark.isActive,
      }).onOk(async () => {
        try {
          await exitDriver().cancel(this.walletId);
          this.$q.notify({ type: 'info', message: this.$t('Exit cancelled. Fee money stays on its address and belongs to your recovery words.') });
        } catch (error) {
          this.$q.notify({ type: 'negative', message: this.describeError(error) });
        }
      });
    },
    finish() {
      this.exits.acknowledge(this.walletId);
      this.refreshKit();
    },
    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        this.$q.notify({ type: 'positive', message: this.$t('Address copied') });
      } catch {
        this.$q.notify({ type: 'negative', message: this.$t('Failed to copy') });
      }
    },
    openExplorer() {
      const base = fiatRatesService.getApiUrl().replace(/\/api\/v1\/?$/, '').replace(/\/api\/?$/, '') || 'https://mempool.space';
      window.open(`${base}/address/${this.exit.destination.address}`, '_blank', 'noopener');
    },
    openDestination() {
      if (this.exit && !canChangeDestination(this.exit)) return;
      this.destinationInput = '';
      this.destinationError = '';
      this.destinationOpen = true;
    },
    async pasteDestination() {
      try {
        const text = await readClipboardCrossPlatform();
        if (typeof text === 'string' && text.trim()) this.destinationInput = text.trim();
      } catch { /* clipboard not readable: the field still accepts typing */ }
    },
    async useDestination() {
      this.savingDestination = true;
      this.destinationError = '';
      try {
        if (this.exit) {
          await exitDriver().setDestination(this.walletId, this.destinationInput, { excluded: [this.kit?.depositAddress].filter(Boolean) });
        } else {
          const verdict = classifyDestination(this.destinationInput, { network: this.kit?.network || 'mainnet', excluded: [this.kit?.depositAddress].filter(Boolean) });
          if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { code: `DESTINATION_${verdict.reason.toUpperCase()}` });
          // Remembered with the kit, so the choice survives leaving the page.
          this.kits.upsert(this.walletId, { customDestination: verdict.address === this.derivedDestination ? null : verdict.address });
        }
        this.destinationOpen = false;
      } catch (error) {
        this.destinationError = this.describeError(error);
      } finally {
        this.savingDestination = false;
      }
    },
  },
};
</script>

<style scoped>
.exit-body { display: flex; flex-direction: column; gap: 16px; }
.exit-wallet { margin: -8px 0 0; font-size: 14px; color: var(--text-secondary); }
.exit-status { display: flex; gap: 14px; align-items: flex-start; padding: 16px; border-radius: 16px; border: 1px solid var(--border-card); background: var(--bg-card); }
.exit-status-icon { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; background: var(--bg-input); color: var(--text-primary); }
.exit-status--accent .exit-status-icon { color: var(--brand-accent-text); }
.exit-status--warn .exit-status-icon { color: var(--color-warn, #8A5A00); }
.exit-status-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.exit-status-copy strong { font-size: 16px; font-weight: 700; line-height: 1.3; }
.exit-status-copy span { font-size: 14px; line-height: 1.45; color: var(--text-secondary); }
.exit-status-meta { font-size: 12px; }
.exit-figure { font-size: 15px; color: var(--text-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }
.exit-figure--strong { color: var(--text-primary); font-weight: 700; }
.exit-change { font-size: 14px; font-weight: 700; color: var(--brand-accent-text); }
.exit-callout { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; background: var(--bg-input); font-size: 14px; line-height: 1.45; }
.exit-callout svg { flex-shrink: 0; margin-top: 2px; color: var(--brand-accent-text); }
.exit-hint { margin: -6px 0 0; text-align: center; font-size: 13px; color: var(--text-secondary); }
.exit-error { margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--color-warn-soft, rgba(232, 196, 104, 0.12)); color: var(--text-primary); font-size: 14px; line-height: 1.45; }
.exit-stages { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.exit-stage { display: flex; gap: 14px; align-items: stretch; }
.exit-stage-mark { position: relative; display: grid; place-items: center; flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--border-card); background: var(--bg-card); color: #fff; }
.exit-stage.is-done .exit-stage-mark { background: var(--brand-accent-text); border-color: var(--brand-accent-text); }
.exit-stage.is-current .exit-stage-mark { border-color: var(--brand-accent-text); }
.exit-stage-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--brand-accent-text); }
.exit-stage-body { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; padding: 3px 0 18px; }
.exit-stage:not(:last-child) { background: linear-gradient(var(--border-card), var(--border-card)) 13px 28px / 2px calc(100% - 28px) no-repeat; }
.exit-stage.is-done:not(:last-child) { background-image: linear-gradient(var(--brand-accent-text), var(--brand-accent-text)); }
.exit-stage-body strong { font-size: 16px; font-weight: 700; }
.exit-stage.is-upcoming .exit-stage-body strong { font-weight: 500; color: var(--text-secondary); }
.exit-stage-summary { font-size: 14px; line-height: 1.4; color: var(--text-secondary); }
.exit-panel { display: flex; flex-direction: column; gap: 12px; margin-top: 6px; padding: 14px; border-radius: 14px; background: var(--bg-input); }
.exit-panel p { margin: 0; font-size: 14px; line-height: 1.45; }
.exit-qr { display: grid; place-items: center; }
.exit-qr :deep(canvas), .exit-qr :deep(img) { border-radius: 8px; background: #fff; padding: 6px; }
.exit-address { font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.exit-note { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text-secondary); }
.exit-note--center { text-align: center; }
.exit-progress { width: 100%; height: 6px; border-radius: 999px; background: var(--border-card); overflow: hidden; }
.exit-progress span { display: block; height: 100%; border-radius: 999px; background: var(--brand-accent-text); }
.exit-confirm { width: 100%; max-width: 480px; max-height: calc(100dvh - 32px); padding: 0; border-radius: 20px; display: flex; flex-direction: column; overflow: hidden; }
.exit-confirm-title { flex-shrink: 0; margin: 0; padding: 20px 20px 16px; font-size: 1.125rem; font-weight: 700; line-height: 1.3; }
.exit-confirm-body { min-height: 0; overflow-y: auto; padding: 0 20px 16px; }
.exit-confirm-facts { margin: 0; }
.exit-confirm-facts > div { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 16px; padding: 12px 0; border-bottom: 1px solid var(--border-card); }
.exit-confirm-facts dt { font-size: 0.875rem; line-height: 1.4; color: var(--text-secondary); }
.exit-confirm-facts dd { margin: 0; font-size: 0.9375rem; line-height: 1.4; font-weight: 650; font-variant-numeric: tabular-nums; }
.exit-confirm-facts .exit-confirm-amount { padding-top: 0; }
.exit-confirm-amount dd { font-size: 1.375rem; }
.exit-confirm-facts .exit-confirm-destination { flex-direction: column; }
.exit-confirm-destination dd { font-family: ui-monospace, Menlo, monospace; font-size: 0.8125rem; font-weight: 400; overflow-wrap: anywhere; max-width: 100%; }
.exit-confirm-extra { margin: 12px 0 0; font-size: 0.8125rem; line-height: 1.45; color: var(--text-secondary); }
.exit-confirm-warning { display: flex; flex-direction: column; gap: 6px; margin-top: 16px; padding: 14px; border-radius: 12px; background: var(--color-warn-soft); }
.exit-confirm-warning strong { font-size: 0.9375rem; line-height: 1.4; }
.exit-confirm-warning p { margin: 0; font-size: 0.875rem; line-height: 1.45; color: var(--text-secondary); }
.exit-confirm-actions { flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; padding: 12px 20px max(12px, env(safe-area-inset-bottom)); border-top: 1px solid var(--border-card); }
.exit-confirm-actions > button { margin-top: 0; min-height: 52px; padding: 12px 16px; font-size: 0.96875rem; line-height: 1.4; }
.exit-destination-body { display: flex; flex-direction: column; gap: 14px; }
.exit-destination-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
  gap: 12px;
}
.exit-destination-actions > button {
  min-width: 0;
  min-height: 52px;
  margin-top: 0;
  padding: 12px 16px;
  font-size: 0.96875rem;
  line-height: 1.4;
}
</style>
