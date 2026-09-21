<template>
  <q-page class="id-sub-page identity-surface exit-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Security')" to="/security" />

    <div class="id-sub-body exit-body">
      <h1 class="id-large-title">{{ $t('Emergency exit') }}</h1>
      <p class="exit-wallet">{{ walletName }}</p>

      <section class="exit-status" :class="`exit-status--${status.tone}`">
        <span class="exit-status-icon" aria-hidden="true"><Icon :icon="status.icon" width="24" height="24" /></span>
        <div class="exit-status-copy">
          <strong>{{ status.title }}</strong>
          <span>{{ status.text }}</span>
        </div>
      </section>

      <!-- Before anything starts: the honest triage and one free action. -->
      <template v-if="!exit">
        <IdentityGroup :title="$t('If you leave now')" :footer="$t('Fee money is paid separately. Nothing is sent until you confirm the last step. Figures come from a live quote at today\'s fees and can change.')">
          <IdentityRow :label="$t('Can leave now')" :interactive="false" :chevron="false">
            <template #trailing><span class="exit-figure exit-figure--strong">{{ sats(triage.recoverableSat) }}</span></template>
          </IdentityRow>
          <IdentityRow :label="$t('Network cost')" :caption="$t('Paid from separate fee money, not from this amount.')" wrap :interactive="false" :chevron="false">
            <template #trailing><span class="exit-figure">{{ $t('about {amount} sats', { amount: formatSats(triage.feeSat) }) }}</span></template>
          </IdentityRow>
          <IdentityRow :label="$t('Not worth moving')" :caption="$t('Fees would cost more than these are worth. They stay in Spark.')" wrap :interactive="false" :chevron="false">
            <template #trailing><span class="exit-figure">{{ sats(triage.notWorthSat) }}</span></template>
          </IdentityRow>
          <IdentityRow :label="$t('Arrives as plain Bitcoin')" :caption="shortAddress(destinationAddress)" mono :chevron="false" @click="openDestination">
            <template #trailing><span class="exit-change">{{ $t('Change') }}</span></template>
          </IdentityRow>
        </IdentityGroup>

        <div class="exit-callout">
          <Icon icon="tabler:info-circle" width="18" height="18" aria-hidden="true" />
          <span>{{ $t('While Spark is running, a normal withdrawal is faster and cheaper.') }}</span>
        </div>

        <p v-if="startError" class="exit-error" role="alert">{{ startError }}</p>
        <button type="button" class="btn-primary" :disabled="!canStart" @click="start">{{ $t('Start emergency exit') }}</button>
        <p class="exit-hint">{{ $t('Starting is free and can be cancelled before anything is sent.') }}</p>
        <button type="button" class="btn-quiet" @click="showHow = true">{{ $t('How the emergency exit works') }}</button>
      </template>

      <!-- In progress: a tracker, not a wizard. Comes back to the same place after days. -->
      <template v-else>
        <ol class="exit-stages">
          <li v-for="stage in stages" :key="stage.key" class="exit-stage" :class="`is-${stage.state}`">
            <span class="exit-stage-mark" aria-hidden="true">
              <Icon v-if="stage.state === 'done'" icon="tabler:check" width="14" height="14" />
              <span v-else-if="stage.state === 'current'" class="exit-stage-dot"></span>
            </span>
            <div class="exit-stage-body">
              <strong>{{ stage.name }}</strong>
              <span v-if="stage.summary" class="exit-stage-summary">{{ stage.summary }}</span>

              <div v-if="stage.key === 'fund' && exit.stage === 'fund'" class="exit-panel">
                <p>{{ $t('Send {amount} sats of on-chain Bitcoin to this address. It pays the network fees.', { amount: formatSats(exit.funding.requiredSat) }) }}</p>
                <div class="exit-qr"><vue-qrcode :value="fundingUri" :options="qrOptions" /></div>
                <code class="exit-address">{{ exit.funding.address }}</code>
                <button type="button" class="btn-ghost" @click="copyFunding">{{ $t('Copy address') }}</button>
                <p class="exit-note">{{ fundingStatus }}</p>
              </div>

              <div v-if="stage.key === 'send' && stage.state === 'current'" class="exit-panel">
                <div class="exit-progress" role="progressbar" :aria-valuenow="progressPct" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: progressPct + '%' }"></span></div>
                <p class="exit-note">{{ $t('Each transaction goes out when the one before it confirms. Continues in the background and when you open the app.') }}</p>
              </div>

              <div v-if="stage.key === 'unlock' && stage.state === 'current'" class="exit-panel">
                <div class="exit-progress" role="progressbar" :aria-valuenow="unlockPct" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: unlockPct + '%' }"></span></div>
                <p class="exit-note">{{ unlockNote }}</p>
                <p class="exit-note">{{ $t('Counted in Bitcoin blocks, so the date can shift by a day either way.') }}</p>
              </div>
            </div>
          </li>
        </ol>

        <p v-if="exit.lastError" class="exit-error" role="status">{{ $t('Last attempt failed: {error}. Trying again in a few minutes.', { error: exit.lastError }) }}</p>
        <button v-if="exit.stage === 'ready'" type="button" class="btn-primary" :disabled="sending" @click="confirmOpen = true">{{ $t('Send to Bitcoin') }}</button>
        <button v-if="exit.stage === 'done'" type="button" class="btn-primary" @click="finish">{{ $t('Done') }}</button>
        <button v-if="cancellable" type="button" class="btn-danger" @click="cancel">{{ $t('Cancel exit') }}</button>
        <button type="button" class="btn-quiet" @click="showHow = true">{{ $t('How the emergency exit works') }}</button>
      </template>
    </div>

    <!-- The one alert: the point of no return. -->
    <q-dialog v-model="confirmOpen" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="identity-surface exit-confirm" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'" role="alertdialog" aria-labelledby="exit-confirm-title">
        <h2 id="exit-confirm-title" class="exit-confirm-title">{{ $t('Send to Bitcoin now?') }}</h2>
        <p class="exit-confirm-text">{{ confirmText }}</p>
        <button type="button" class="btn-primary" :disabled="sending" @click="send">{{ $t('Send') }}</button>
        <button type="button" class="btn-quiet" :disabled="sending" @click="confirmOpen = false">{{ $t('Cancel') }}</button>
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
          <label class="field">
            <span class="field-label">{{ $t('Paste a Bitcoin address') }}</span>
            <input v-model.trim="destinationInput" class="field-input" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" :placeholder="derivedDestination" />
          </label>
          <p v-if="destinationError" class="exit-error" role="alert">{{ destinationError }}</p>
          <button type="button" class="btn-primary" :disabled="!destinationInput || savingDestination" @click="useDestination">{{ $t('Use this address') }}</button>
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
import { canCancel, arrivedSat } from '../utils/exitLedger.js';
import { classifyDestination } from '../utils/exitKeys.js';
import { kitState } from '../utils/exitKit.js';
import { formatSats, formatDay, relativeDay, durationText, shortAddress } from '../composables/useExitFormat.js';

const STAGE_INDEX = { fund: 1, ready: 1, send: 2, unlock: 3, sweep: 3, done: 4 };
const TICK_MS = 60 * 1000;

/**
 * Emergency exit for one Spark wallet. Before it starts: what could leave
 * today and the one free action. Once started: a resumable tracker that
 * reads the persisted ledger, so the page looks the same after a restart
 * or a week away. The only alert is the point of no return.
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
      customDestination: '',
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
    triage() {
      const kit = this.kit || {};
      return { recoverableSat: kit.recoverableSat || 0, feeSat: kit.feeSat || 0, notWorthSat: kit.notWorthSat || 0 };
    },
    derivedDestination() { return this.kit?.destinationAddress || ''; },
    destinationAddress() { return this.exit?.destination.address || this.customDestination || this.derivedDestination; },
    canStart() { return this.connected && this.triage.recoverableSat > 0 && !this.starting; },
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
    fundingStatus() {
      const funding = this.exit?.funding;
      if (!funding) return '';
      const waiting = funding.confirmedSat > 0 && funding.shortfallSat > 0
        ? this.$t('{confirmed} sats confirmed · {shortfall} sats more needed', { confirmed: formatSats(funding.confirmedSat), shortfall: formatSats(funding.shortfallSat) })
        : this.$t('Waiting for the fee money to arrive.');
      return `${waiting} ${this.$t('Continues on its own when the money arrives. You can close the app.')}`;
    },
    confirmText() {
      const quote = this.exit?.quote;
      if (!quote) return '';
      return this.$t('{amount} sats leave Spark. About {fee} sats of fee money is used. Once sent, this cannot be stopped and takes about two weeks.', {
        amount: formatSats(quote.recoverableValueSat), fee: formatSats(quote.totalFeeSat),
      });
    },
    status() {
      const exit = this.exit;
      if (!exit) {
        const outage = sparkHealth().unreachableFor(this.walletId);
        const spark = outage > 0
          ? this.$t('Spark has not responded for {duration}.', { duration: durationText(outage, (key, params) => this.$t(key, params)) })
          : this.$t('Spark is responding normally.');
        const state = kitState(this.kit);
        if (state === 'checked' || state === 'saved') {
          const at = this.kit.checkedAt || this.kit.exportedAt;
          const checked = this.relativeDay(at) === this.$t('today') ? this.$t('Exit kit checked today') : this.$t('Exit kit checked {date}', { date: this.relativeDay(at) });
          return { icon: 'tabler:shield-check', tone: 'accent', title: this.$t('Ready to leave on your own'), text: `${checked}. ${spark}` };
        }
        if (state === 'failed') {
          return { icon: 'tabler:alert-triangle', tone: 'warn', title: this.$t('Exit kit needs a refresh'), text: this.$t('Could not refresh since {date}. Payments after that date are not covered yet.', { date: this.relativeDay(this.kit.failedSince) }) };
        }
        return { icon: 'tabler:lifebuoy', tone: 'neutral', title: this.$t('Exit kit not checked yet'), text: this.connected ? spark : this.$t('Connect this wallet first.') };
      }
      switch (exit.stage) {
        case 'fund': return { icon: 'tabler:lifebuoy', tone: 'neutral', title: this.$t('Add fee money'), text: this.$t('Waiting for the fee money to arrive.') };
        case 'ready': return { icon: 'tabler:lifebuoy', tone: 'accent', title: this.$t('Send to Bitcoin'), text: this.$t('Fee money confirmed. Confirm the send when you are ready.') };
        case 'unlock': return { icon: 'tabler:calendar-time', tone: 'accent', title: this.$t('Unlocks around {date}', { date: this.day(exit.unlock?.estimatedAt) }), text: this.unlockNote };
        case 'done': return { icon: 'tabler:check', tone: 'accent', title: this.$t('Your money is plain Bitcoin now'), text: this.$t('{amount} sats arrived at {address}. Only you control that address.', { amount: formatSats(arrivedSat(exit)), address: shortAddress(exit.destination.address) }) };
        default: return { icon: 'tabler:lifebuoy', tone: 'accent', title: this.$t('On its way'), text: this.$t('Cannot be stopped now. Keep BuhoGO installed until it finishes.') };
      }
    },
    stages() {
      const exit = this.exit;
      if (!exit) return [];
      const index = STAGE_INDEX[exit.stage] ?? 0;
      const progress = exit.progress || { confirmed: 0, total: exit.built?.transactions.length || 0 };
      const items = [
        { key: 'check', name: this.$t('Check'), summary: this.$t('{amount} sats can leave · {dust} sats stay', { amount: formatSats(exit.triage.recoverableSat), dust: formatSats(exit.triage.notWorthSat) }) },
        { key: 'fund', name: this.$t('Add fee money'), summary: exit.funding.confirmedAt ? this.$t('{amount} sats confirmed', { amount: formatSats(exit.funding.confirmedSat) }) : '' },
        { key: 'send', name: this.$t('Send to Bitcoin'), summary: index >= 2 ? this.$t('{confirmed} of {total} transactions confirmed', { confirmed: progress.confirmed, total: progress.total }) : '' },
        { key: 'unlock', name: this.$t('Unlocking'), summary: exit.unlock ? (index > 3 ? this.day(exit.unlock.estimatedAt) : this.$t('{blocks} blocks left, about {duration}', { blocks: exit.unlock.blocksLeft.toLocaleString(), duration: durationText(exit.unlock.blocksLeft * 10 * 60 * 1000, (key, params) => this.$t(key, params)) })) : '' },
        { key: 'done', name: this.$t('Done'), summary: exit.stage === 'done' ? this.$t('Fees {fee} sats · Left in Spark {dust} sats, too small to move', { fee: formatSats(exit.built.totalFeeSat), dust: formatSats(exit.triage.notWorthSat) }) : '' },
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
    formatSats,
    shortAddress,
    sats(value) { return `${formatSats(value)} sats`; },
    day(timestamp) { return timestamp ? formatDay(timestamp, this.$i18n.locale) : ''; },
    relativeDay(timestamp) { return relativeDay(timestamp, (key, params) => this.$t(key, params), this.$i18n.locale); },
    refreshKit() {
      if (!this.connected || this.exit) return;
      exitKitService().refresh(this.walletId, { force: true, reason: 'exit page' }).catch(() => {});
    },
    async tick() {
      if (this.exit) await exitDriver().tick(this.walletId).catch(() => {});
    },
    describeError(error) {
      const code = error?.code || '';
      const exit = this.exit;
      switch (code) {
        case 'NOT_CONNECTED': return this.$t('Connect this wallet first.');
        case 'NOTHING_TO_EXIT': return this.$t('Nothing can be moved at today\'s fees.');
        case 'MORE_FEE_MONEY': return this.$t('Fees rose. {amount} sats more fee money is needed.', { amount: formatSats(exit?.funding?.shortfallSat || 0) });
        case 'DESTINATION_NOT_ONCHAIN': return this.$t('Not a Bitcoin address');
        case 'DESTINATION_WRONG_NETWORK': return this.$t('This address belongs to another network.');
        case 'DESTINATION_SPARK_DEPOSIT': return this.$t('This is the wallet\'s own deposit address. It would send the money back into Spark.');
        default: return String(error?.message || error);
      }
    },
    async start() {
      this.starting = true;
      this.startError = '';
      try {
        await exitDriver().start(this.walletId, { destination: this.customDestination || null });
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
        this.$q.notify({ type: 'negative', message: `${this.$t('Could not send')}: ${this.describeError(error)}` });
      } finally {
        this.sending = false;
      }
    },
    async cancel() {
      try {
        await exitDriver().cancel(this.walletId);
        this.$q.notify({ type: 'info', message: this.$t('Exit cancelled. Fee money stays on its address and belongs to your recovery words.') });
      } catch (error) {
        this.$q.notify({ type: 'negative', message: this.describeError(error) });
      }
    },
    finish() {
      this.exits.remove(this.walletId);
    },
    async copyFunding() {
      try {
        await navigator.clipboard.writeText(this.exit.funding.address);
        this.$q.notify({ type: 'positive', message: this.$t('Address copied') });
      } catch {
        this.$q.notify({ type: 'negative', message: this.$t('Failed to copy') });
      }
    },
    openDestination() {
      if (this.exit && !canCancel(this.exit)) return;
      this.destinationInput = '';
      this.destinationError = '';
      this.destinationOpen = true;
    },
    async useDestination() {
      this.savingDestination = true;
      this.destinationError = '';
      try {
        if (this.exit) {
          await exitDriver().setDestination(this.walletId, this.destinationInput);
        } else {
          const verdict = classifyDestination(this.destinationInput, { network: this.kit?.network || 'mainnet' });
          if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { code: `DESTINATION_${verdict.reason.toUpperCase()}` });
          this.customDestination = verdict.address;
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
.exit-stage:not(:last-child) .exit-stage-body { border-left: 0; }
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
.exit-progress { width: 100%; height: 6px; border-radius: 999px; background: var(--border-card); overflow: hidden; }
.exit-progress span { display: block; height: 100%; border-radius: 999px; background: var(--brand-accent-text); }
.exit-confirm { width: 100%; max-width: 360px; padding: 22px 20px 12px; border-radius: 20px; display: flex; flex-direction: column; gap: 12px; }
.exit-confirm-title { margin: 0; font-size: 18px; font-weight: 700; text-align: center; line-height: 1.3; }
.exit-confirm-text { margin: 0 0 6px; font-size: 14px; line-height: 1.5; text-align: center; color: var(--text-secondary); }
.exit-destination-body { display: flex; flex-direction: column; gap: 14px; }
</style>
