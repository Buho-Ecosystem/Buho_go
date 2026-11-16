<template>
  <section class="kiosk-onboarding" :aria-label="$t('Set up register')" :aria-busy="busy">
    <header class="kiosk-onboarding__header">
      <div v-if="step === 'welcome'" class="kiosk-onboarding__brand"><img src="/buho_logo.svg" alt="" aria-hidden="true" /><span>BuhoGO</span></div>
      <button v-else type="button" class="kiosk-onboarding__icon" :disabled="busy" :aria-label="$t('Back')" @click="$emit('back')"><Icon icon="tabler:chevron-left" width="22" height="22" /></button>
      <span v-if="step !== 'welcome'" class="kiosk-onboarding__heading">{{ $t('kiosk.kioskMode') }}</span>
      <button v-if="step === 'welcome' && intro" type="button" class="kiosk-onboarding__done" @click="closeIntro">{{ $t('Done') }}</button>
      <span v-else class="kiosk-onboarding__spacer" aria-hidden="true"></span>
    </header>

    <template v-if="step === 'welcome'">
      <div class="kiosk-onboarding__welcome">
        <div class="kiosk-onboarding__scene kiosk-onboarding__scene--welcome">
          <img :key="imageKey" :src="asset(currentSlide.image)" alt="" aria-hidden="true" draggable="false" />
        </div>
        <div class="kiosk-onboarding__copy">
          <h1>{{ $t(currentSlide.title) }}</h1>
          <p>{{ $t(currentSlide.copy) }}</p>
        </div>
      </div>
      <footer class="kiosk-onboarding__actions">
        <template v-if="intro">
          <div class="kiosk-onboarding__dots" role="group" :aria-label="$t('Introduction pages')">
            <button v-for="(_, index) in slides" :key="index" type="button" :aria-label="$t('Introduction {n}', { n: index + 1 })" :aria-current="index === tourIndex ? 'step' : undefined" @click="tourIndex = index"><i :class="{ 'is-current': index === tourIndex }"></i></button>
          </div>
          <button type="button" class="kiosk-onboarding__primary" @click="nextIntro">{{ tourIndex === slides.length - 1 ? $t('Done') : $t('Continue') }}<Icon v-if="tourIndex < slides.length - 1" icon="tabler:arrow-right" width="19" height="19" /></button>
        </template>
        <template v-else>
          <button type="button" class="kiosk-onboarding__primary" @click="$emit('start')">{{ $t('Set up register') }}<Icon icon="tabler:arrow-right" width="19" height="19" /></button>
          <button type="button" class="kiosk-onboarding__secondary" @click="$emit('update:intro', true)">{{ $t('See how it works') }}</button>
        </template>
      </footer>
    </template>

    <template v-else-if="step === 'defaults'">
      <div class="kiosk-onboarding__progress"><span>{{ $t('Set up register') }}</span><span>{{ $t('Step {n} of {total}', { n: 1, total: 2 }) }}</span></div>
      <div class="kiosk-onboarding__step">
        <div class="kiosk-onboarding__intro">
          <div class="kiosk-onboarding__scene kiosk-onboarding__scene--wallet"><img :src="asset('storyset-ewallet-bro.svg')" alt="" aria-hidden="true" draggable="false" /></div>
          <div class="kiosk-onboarding__copy"><h1>{{ $t('Sales go straight here.') }}</h1><p>{{ $t('Your wallet and currency are already selected.') }}</p></div>
        </div>
        <IdentityGroup class="kiosk-onboarding__choices">
          <IdentityRow :label="wallet?.name || $t('Choose a wallet')" :caption="wallet?.caption || (canContinue ? $t('Receives your sales') : $t('Choose where sales arrive.'))" @click="$emit('wallet')">
            <template #leading><span class="kiosk-onboarding__tile"><WalletBrandMark v-if="wallet?.type" :type="wallet.type" :size="20" color="currentColor" /><Icon v-else icon="tabler:wallet" width="22" height="22" /></span></template>
            <template #trailing><span class="kiosk-onboarding__value">{{ $t('Change') }}</span></template>
          </IdentityRow>
          <IdentityRow :label="$t('Price currency')" :interactive="false">
            <template #trailing>
              <span v-if="currencyLocked || currencyOptions.length < 2" class="kiosk-onboarding__value">{{ currency }}</span>
              <select v-else :value="currency" :disabled="busy" :aria-label="$t('Price currency')" @change="$emit('currency', $event.target.value)"><option v-for="option in currencyOptions" :key="option.code" :value="option.code">{{ option.label }}</option></select>
            </template>
          </IdentityRow>
        </IdentityGroup>
        <p v-if="error" class="kiosk-onboarding__error" role="alert">{{ error }}</p>
      </div>
      <footer class="kiosk-onboarding__actions"><button type="button" class="kiosk-onboarding__primary" :disabled="busy" @click="continueDefaults"><q-spinner v-if="busy" size="18px" /><template v-else>{{ canContinue ? $t('Continue') : needsWalletSetup ? $t('Connect a wallet') : $t('Choose a wallet') }}<Icon v-if="canContinue" icon="tabler:arrow-right" width="19" height="19" /></template></button></footer>
    </template>

    <template v-else-if="step === 'pin'">
      <div class="kiosk-onboarding__progress"><span>{{ $t('Set up register') }}</span><span>{{ $t('Step {n} of {total}', { n: 2, total: 2 }) }}</span></div>
      <div class="kiosk-onboarding__pin"><slot name="pin" /></div>
      <p v-if="error" class="kiosk-onboarding__error" role="alert">{{ error }}</p>
      <p class="kiosk-onboarding__footnote">{{ $t('Use your owner PIN to open settings.') }}</p>
    </template>

    <template v-else-if="step === 'ready'">
      <div class="kiosk-onboarding__step kiosk-onboarding__step--ready">
        <div class="kiosk-onboarding__intro">
          <div class="kiosk-onboarding__scene kiosk-onboarding__scene--ready"><img :src="asset('storyset-setup-wizard-bro.svg')" alt="" aria-hidden="true" draggable="false" /></div>
          <div class="kiosk-onboarding__copy"><h1>{{ $t('Your counter is ready.') }}</h1><p>{{ $t('Take your first payment whenever you are ready.') }}</p></div>
        </div>
        <IdentityGroup class="kiosk-onboarding__choices">
          <IdentityRow :label="wallet?.name || $t('Receiving Wallet')" :caption="$t('Receives your sales')" :interactive="false"><template #leading><span class="kiosk-onboarding__tile"><Icon icon="tabler:wallet" width="21" height="21" /></span></template><template #trailing><Icon icon="tabler:check" width="20" height="20" class="kiosk-onboarding__check" /></template></IdentityRow>
          <IdentityRow :label="$t('Owner PIN set')" :interactive="false"><template #leading><span class="kiosk-onboarding__tile"><Icon icon="tabler:lock" width="21" height="21" /></span></template><template #trailing><Icon icon="tabler:check" width="20" height="20" class="kiosk-onboarding__check" /></template></IdentityRow>
        </IdentityGroup>
        <p v-if="error" class="kiosk-onboarding__error" role="alert">{{ error }}</p>
      </div>
      <footer class="kiosk-onboarding__actions">
        <button type="button" class="kiosk-onboarding__primary" :disabled="busy || !canContinue" @click="$emit('open-register')"><q-spinner v-if="busy" size="18px" /><template v-else>{{ $t('Open register') }}<Icon icon="tabler:arrow-right" width="19" height="19" /></template></button>
        <button type="button" class="kiosk-onboarding__secondary" :disabled="busy || !canContinue" @click="$emit('open-transfers')">{{ $t('Set up Auto-Transfer') }}</button>
      </footer>
    </template>
  </section>
</template>

<script>
import { Icon } from '@iconify/vue';
import IdentityGroup from '../identity/IdentityGroup.vue';
import IdentityRow from '../identity/IdentityRow.vue';
import WalletBrandMark from '../WalletBrandMark.vue';

const SLIDES = [
  { title: 'Your phone. Your register.', copy: 'Choose products or enter an amount. Your customer scans. You see it is paid.', image: 'scan-to-pay-animated.svg' },
  { title: 'Straight to your wallet.', copy: 'Sales arrive in a BuhoGO wallet you already know.', image: 'storyset-ewallet-bro.svg' },
  { title: 'Move money when you want.', copy: 'Transfer now, or set up Auto-Transfer when you are ready.', image: 'storyset-transfer-money-bro.svg' },
  { title: 'See your day add up.', copy: 'See what sold. Add a label. Export your records.', image: 'storyset-receipt-bro.svg' },
];

/** Full-height presentation. The parent owns wallet checks, PIN entry, persistence and navigation. */
export default {
  name: 'KioskOnboarding',
  components: { Icon, IdentityGroup, IdentityRow, WalletBrandMark },
  props: {
    step: { type: String, default: 'welcome', validator: (value) => ['welcome', 'defaults', 'pin', 'ready'].includes(value) },
    intro: { type: Boolean, default: false },
    wallet: { type: Object, default: null },
    currency: { type: String, required: true },
    /** Strings or { code, label }; passed from the app's currency catalog. */
    currencies: { type: Array, default: () => [] },
    currencyLocked: { type: Boolean, default: false },
    canContinue: { type: Boolean, default: false },
    needsWalletSetup: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
    error: { type: String, default: '' },
  },
  emits: ['start', 'update:intro', 'back', 'wallet', 'currency', 'next', 'connect-wallet', 'open-register', 'open-transfers'],
  data() { return { tourIndex: 0, replay: 0, slides: SLIDES }; },
  computed: {
    currentSlide() { return this.slides[this.intro ? this.tourIndex : 0]; },
    imageKey() { return `${this.replay}-${this.currentSlide.image}`; },
    currencyOptions() {
      const options = this.currencies.length ? this.currencies : [this.currency];
      return options.map((option) => typeof option === 'string' ? { code: option, label: option } : option);
    },
  },
  watch: {
    intro() { this.tourIndex = 0; this.replay += 1; },
    tourIndex() { this.replay += 1; },
  },
  methods: {
    asset(file) { return `${encodeURI(`/Onboarding wizard spark/${file}`)}?kiosk=${this.replay}`; },
    closeIntro() { this.$emit('update:intro', false); },
    nextIntro() { if (this.tourIndex < this.slides.length - 1) this.tourIndex += 1; else this.closeIntro(); },
    continueDefaults() {
      if (this.busy) return;
      this.$emit(this.canContinue ? 'next' : this.needsWalletSetup ? 'connect-wallet' : 'wallet');
    },
  },
};
</script>

<style scoped>
.kiosk-onboarding { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden; container-type: size; color: var(--text-primary); background: var(--bg-primary); }
.kiosk-onboarding__header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 52px; flex: none; padding: 0 16px; }
.kiosk-onboarding__brand { display: flex; align-items: center; gap: 8px; color: var(--text-primary); font: 800 20px/1.2 'Manrope', sans-serif; letter-spacing: -.7px; }
.kiosk-onboarding__brand img { width: 25px; height: 27px; }
.kiosk-onboarding__icon, .kiosk-onboarding__done { display: grid; place-items: center; width: 44px; min-width: 44px; height: 44px; padding: 0; border: 0; border-radius: 11px; background: transparent; color: var(--brand-accent-text); cursor: pointer; }
.kiosk-onboarding__done { font: 600 13px/1.3 'Manrope', sans-serif; }
.kiosk-onboarding__heading { flex: 1; text-align: center; color: var(--text-secondary); font-size: 12px; }
.kiosk-onboarding__spacer { width: 44px; flex: none; }
.kiosk-onboarding__welcome { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(12px,3cqh,24px); padding: 0 16px 14px; overflow-y: auto; }
.kiosk-onboarding__scene { width: 100%; min-height: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 1; }
.kiosk-onboarding__scene img { display: block; width: 100%; height: 100%; max-height: inherit; object-fit: contain; user-select: none; pointer-events: none; }
.kiosk-onboarding__scene--welcome { height: min(39cqh,300px); max-height: 300px; max-width: 450px; }
.kiosk-onboarding__copy { flex: none; max-width: 350px; width: 100%; padding: 0 5px; text-align: center; }
.kiosk-onboarding__copy h1 { margin: 0; color: var(--text-primary); font: 780 29px/1.16 'Manrope', sans-serif; letter-spacing: -.9px; text-wrap: balance; }
.kiosk-onboarding__copy p { max-width: 310px; margin: 12px auto 0; color: var(--text-secondary); font-size: 14px; line-height: 1.6; text-wrap: pretty; }
.kiosk-onboarding__actions { display: flex; flex-direction: column; gap: 6px; flex: none; padding: 0 24px max(16px,var(--safe-bottom,16px)); }
.kiosk-onboarding__primary { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 52px; padding: 12px 16px; border: 1px solid var(--btn-neutral-border); border-radius: 15px; background: var(--btn-neutral-bg); color: var(--btn-neutral-fg); font: 700 14px/1.4 'Manrope', sans-serif; cursor: pointer; }
.kiosk-onboarding__secondary { min-height: 44px; padding: 9px 10px; border: 0; border-radius: 11px; background: transparent; color: var(--text-secondary); font: 650 13px/1.4 'Manrope', sans-serif; cursor: pointer; }
.kiosk-onboarding button:disabled { opacity: .45; cursor: default; }
.kiosk-onboarding button:focus-visible, .kiosk-onboarding select:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: -2px; }
.kiosk-onboarding__dots { display: flex; justify-content: center; align-items: center; min-height: 44px; }
.kiosk-onboarding__dots button { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; background: transparent; cursor: pointer; }
.kiosk-onboarding__dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); opacity: .5; }
.kiosk-onboarding__dots .is-current { width: 20px; border-radius: 8px; background: var(--brand-accent-text); opacity: 1; }
.kiosk-onboarding__progress { display: flex; align-items: center; justify-content: space-between; min-height: 24px; padding: 0 21px; color: var(--text-secondary); font-size: 11px; flex: none; }
.kiosk-onboarding__step { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 14px; padding: 10px 20px 14px; overflow-y: auto; }
.kiosk-onboarding__intro { display: flex; flex: 1; min-height: 0; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
.kiosk-onboarding__scene--wallet { height: min(26cqh,210px); max-height: 210px; }
.kiosk-onboarding__scene--ready { height: min(29cqh,240px); max-height: 240px; }
.kiosk-onboarding__choices { flex: none; width: 100%; }
.kiosk-onboarding__choices :deep(.id-row) { min-height: 64px; }
.kiosk-onboarding__tile { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; flex: none; background: var(--bg-input); color: var(--text-primary); }
.kiosk-onboarding__value { color: var(--text-secondary); font-size: 12px; white-space: nowrap; }
.kiosk-onboarding__choices select { width: 100px; min-height: 44px; padding: 8px 11px; border: 1px solid var(--border-card); border-radius: 11px; color: var(--text-primary); background: var(--bg-input); font: 600 14px/1.4 'Manrope', sans-serif; }
.kiosk-onboarding__check { flex: none; color: var(--brand-accent-text); }
.kiosk-onboarding__pin { display: grid; place-items: center; flex: 1; min-height: 0; padding: 12px 20px; overflow-y: auto; }
.kiosk-onboarding__footnote { flex: none; margin: 0; padding: 8px 20px max(16px,var(--safe-bottom,16px)); color: var(--text-secondary); text-align: center; font-size: 12px; line-height: 1.5; }
.kiosk-onboarding__error { flex: none; margin: 0; color: var(--color-negative); text-align: center; font-size: 13px; line-height: 1.5; }
@container (max-height:600px) { .kiosk-onboarding__scene--welcome { height: min(36cqh,240px); } .kiosk-onboarding__copy h1 { font-size: 26px; } .kiosk-onboarding__copy p { margin-top: 9px; font-size: 13px; } .kiosk-onboarding__intro { gap: 11px; } .kiosk-onboarding__step { gap: 10px; padding-top: 4px; } .kiosk-onboarding__choices :deep(.id-row) { min-height: 59px; } .kiosk-onboarding__scene--wallet { height: min(23cqh,160px); } .kiosk-onboarding__scene--ready { height: min(25cqh,175px); } }
@media(prefers-reduced-motion:reduce) { .kiosk-onboarding * { scroll-behavior: auto; } }
</style>
