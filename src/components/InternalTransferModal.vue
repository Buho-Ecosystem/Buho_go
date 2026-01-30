<!--
  InternalTransferModal
  Clean 3-step transfer flow between connected wallets.
  iOS-inspired design with Vue 3 Composition API.
-->
<template>
  <q-dialog
    v-model="isVisible"
    position="bottom"
    @hide="resetState"
  >
    <q-card class="modal-card" :class="themeClass">
      <!-- Header -->
      <header class="modal-header">
        <div class="header-left">
          <q-icon name="las la-exchange-alt" size="22px" class="header-icon" />
          <h2 class="header-title">{{ $t('Transfer Funds') }}</h2>
        </div>
        <q-btn flat round dense icon="las la-times" class="close-btn" @click="close" />
      </header>

      <!-- Step Indicator -->
      <nav v-if="!state.transferComplete" class="step-nav">
        <template v-for="(step, i) in STEPS" :key="step.key">
          <div class="step" :class="{ active: state.currentStep >= i + 1 }">
            <span class="step-dot">{{ i + 1 }}</span>
            <span class="step-label">{{ $t(step.label) }}</span>
          </div>
          <div v-if="i < STEPS.length - 1" class="step-line" :class="{ active: state.currentStep > i + 1 }" />
        </template>
      </nav>

      <!-- Content -->
      <main class="modal-body">
        <!-- Step 1: Select Wallets -->
        <section v-if="state.currentStep === 1" class="step-panel">
          <div v-if="state.isReconnecting" class="banner banner--info">
            <q-spinner-dots size="14px" />
            <span>{{ $t('Connecting wallets...') }}</span>
          </div>

          <div class="field">
            <label class="field-label">{{ $t('From') }}</label>
            <button type="button" class="wallet-btn" :class="{ selected: state.fromWallet }" @click="state.showFromPicker = true">
              <template v-if="state.fromWallet">
                <WalletAvatar :type="state.fromWallet.type" :wallet-id="state.fromWallet.id" />
                <div class="wallet-meta">
                  <span class="wallet-name">{{ state.fromWallet.name }}</span>
                  <span class="wallet-bal">{{ fmt(state.fromWallet.balance) }}</span>
                </div>
              </template>
              <template v-else>
                <q-icon name="las la-wallet" size="20px" class="placeholder-icon" />
                <span class="placeholder-text">{{ $t('Select source wallet') }}</span>
              </template>
              <q-icon name="las la-chevron-right" size="16px" class="chevron" />
            </button>
          </div>

          <div class="direction">
            <div class="direction-line"></div>
            <div class="direction-icon"><q-icon name="las la-arrow-down" size="14px" /></div>
            <div class="direction-line-bottom"></div>
          </div>

          <div class="field">
            <label class="field-label">{{ $t('To') }}</label>
            <button type="button" class="wallet-btn" :class="{ selected: state.toWallet }" @click="state.showToPicker = true">
              <template v-if="state.toWallet">
                <WalletAvatar :type="state.toWallet.type" :wallet-id="state.toWallet.id" />
                <div class="wallet-meta">
                  <span class="wallet-name">{{ state.toWallet.name }}</span>
                  <span class="wallet-bal">{{ fmt(state.toWallet.balance) }}</span>
                </div>
              </template>
              <template v-else>
                <q-icon name="las la-wallet" size="20px" class="placeholder-icon" />
                <span class="placeholder-text">{{ $t('Select destination wallet') }}</span>
              </template>
              <q-icon name="las la-chevron-right" size="16px" class="chevron" />
            </button>
          </div>

          <div v-if="sameWalletSelected" class="banner banner--warn">
            <q-icon name="las la-exclamation-triangle" size="16px" />
            <span>{{ $t('Select different wallets') }}</span>
          </div>
        </section>

        <!-- Step 2: Amount -->
        <section v-else-if="state.currentStep === 2" class="step-panel step-panel--center">
          <div class="route-bar">
            <div class="route-wallet">
              <WalletAvatar :type="state.fromWallet?.type" :wallet-id="state.fromWallet?.id" size="sm" />
              <span class="route-wallet-name">{{ state.fromWallet?.name }}</span>
            </div>
            <div class="route-arrow">
              <q-icon name="las la-arrow-right" size="14px" />
            </div>
            <div class="route-wallet">
              <WalletAvatar :type="state.toWallet?.type" :wallet-id="state.toWallet?.id" size="sm" />
              <span class="route-wallet-name">{{ state.toWallet?.name }}</span>
            </div>
          </div>
          <div class="amount-row">
            <input
              ref="amountInputRef"
              v-model="state.amount"
              type="number"
              inputmode="numeric"
              class="amount-input"
              placeholder="0"
              @input="onAmountInput"
            />
            <span class="amount-unit">sats</span>
          </div>
          <p class="hint">{{ $t('Available') }}: {{ fmt(state.fromWallet?.balance || 0) }}</p>
          <div class="quick-row">
            <button v-for="p in [25, 50, 75]" :key="p" type="button" class="quick-chip" @click="setPercent(p)">{{ p }}%</button>
            <button type="button" class="quick-chip quick-chip--max" @click="setMax">Max</button>
          </div>
          <p v-if="state.isMaxAmount" class="fee-hint">
            <q-icon name="las la-info-circle" size="12px" />
            {{ $t('Small buffer reserved for network fees. If transfer fails, try lowering the amount.') }}
          </p>
          <div v-if="state.amountError" class="banner banner--error">
            <q-icon name="las la-exclamation-circle" size="14px" />
            <span>{{ state.amountError }}</span>
          </div>
        </section>

        <!-- Step 3: Confirm -->
        <section v-else-if="state.currentStep === 3 && !state.transferComplete" class="step-panel step-panel--center">
          <div class="confirm-amount">{{ fmt(parseInt(state.amount)) }}</div>
          <div class="confirm-flow">
            <div class="confirm-wallet">
              <WalletAvatar :type="state.fromWallet?.type" :wallet-id="state.fromWallet?.id" size="sm" />
              <span>{{ state.fromWallet?.name }}</span>
            </div>
            <div class="flow-connector">
              <div class="connector-line"></div>
              <div class="connector-arrow"><q-icon name="las la-arrow-right" size="12px" /></div>
              <div class="connector-line"></div>
            </div>
            <div class="confirm-wallet">
              <WalletAvatar :type="state.toWallet?.type" :wallet-id="state.toWallet?.id" size="sm" />
              <span>{{ state.toWallet?.name }}</span>
            </div>
          </div>
          <p class="note">{{ $t('This transfer happens instantly via Lightning') }}</p>
        </section>

        <!-- Success -->
        <section v-if="state.transferComplete" class="step-panel step-panel--center">
          <div class="success-ring"><q-icon name="las la-check" size="32px" /></div>
          <h3 class="success-title">{{ $t('Transfer Complete') }}</h3>
          <p class="success-amount">{{ fmt(parseInt(state.amount)) }}</p>
          <p class="success-route">{{ state.fromWallet?.name }} → {{ state.toWallet?.name }}</p>
        </section>

        <div v-if="state.transferError" class="banner banner--error banner--lg">
          <q-icon name="las la-exclamation-triangle" size="18px" />
          <span>{{ state.transferError }}</span>
        </div>
      </main>

      <!-- Footer -->
      <footer class="modal-footer">
        <q-btn v-if="state.currentStep > 1 && !state.transferComplete && !state.isTransferring" flat no-caps class="btn-back" @click="goBack">
          <q-icon name="las la-arrow-left" size="16px" />
          <span>{{ $t('Back') }}</span>
        </q-btn>
        <q-space />
        <q-btn v-if="!state.transferComplete" unelevated no-caps class="btn-main" :disable="!canProceed" :loading="state.isTransferring" @click="goNext">
          <span>{{ state.currentStep < 3 ? $t('Continue') : $t('Transfer Now') }}</span>
          <q-icon v-if="state.currentStep < 3" name="las la-arrow-right" size="16px" />
        </q-btn>
        <q-btn v-else unelevated no-caps class="btn-main" @click="close">{{ $t('Done') }}</q-btn>
      </footer>
    </q-card>

    <!-- Picker: From -->
    <q-dialog v-model="state.showFromPicker" position="bottom">
      <q-card class="picker-card" :class="themeClass">
        <header class="picker-header">
          <h3>{{ $t('Select Source Wallet') }}</h3>
          <q-btn flat round dense icon="las la-times" v-close-popup />
        </header>
        <div class="picker-list">
          <button
            v-for="w in wallets"
            :key="w.id"
            type="button"
            class="picker-row"
            :class="{ selected: w.id === state.fromWallet?.id, disabled: !w.canSend }"
            @click="pickFrom(w)"
          >
            <WalletAvatar :type="w.type" :wallet-id="w.id" />
            <div class="wallet-meta">
              <span class="wallet-name">{{ w.name }}</span>
              <span class="wallet-bal" :class="{ muted: !w.balance }">{{ fmt(w.balance) }}</span>
            </div>
            <StatusDot :status="connStatus[w.id]" />
            <q-icon v-if="w.id === state.fromWallet?.id" name="las la-check" size="18px" class="check" />
            <span v-else-if="!w.canSend" class="hint-text">{{ $t('No balance') }}</span>
          </button>
        </div>
      </q-card>
    </q-dialog>

    <!-- Picker: To -->
    <q-dialog v-model="state.showToPicker" position="bottom">
      <q-card class="picker-card" :class="themeClass">
        <header class="picker-header">
          <h3>{{ $t('Select Destination Wallet') }}</h3>
          <q-btn flat round dense icon="las la-times" v-close-popup />
        </header>
        <div class="picker-list">
          <button
            v-for="w in wallets"
            :key="w.id"
            type="button"
            class="picker-row"
            :class="{ selected: w.id === state.toWallet?.id, disabled: w.id === state.fromWallet?.id }"
            @click="pickTo(w)"
          >
            <WalletAvatar :type="w.type" :wallet-id="w.id" />
            <div class="wallet-meta">
              <span class="wallet-name">{{ w.name }}</span>
              <span class="wallet-bal">{{ fmt(w.balance) }}</span>
            </div>
            <StatusDot :status="connStatus[w.id]" />
            <q-icon v-if="w.id === state.toWallet?.id" name="las la-check" size="18px" class="check" />
            <span v-else-if="w.id === state.fromWallet?.id" class="hint-text">{{ $t('Source') }}</span>
          </button>
        </div>
      </q-card>
    </q-dialog>
  </q-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, h } from 'vue';
import { useQuasar } from 'quasar';
import { useWalletStore } from '../stores/wallet';
import { haptics } from '../utils/haptics';

// ─────────────────────────────────────────────────────────────
// Sub-components (functional)
// ─────────────────────────────────────────────────────────────
const WalletAvatar = {
  props: { type: String, walletId: String, size: { type: String, default: 'md' } },
  setup(props) {
    const cls = computed(() => ['avatar', props.size === 'sm' && 'avatar--sm'].filter(Boolean));
    return () => h('div', { class: cls.value }, [
      // Spark - white fill
      props.type === 'spark' && h('svg', { width: '20', height: '19', viewBox: '0 0 135 128', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('path', {
          'fill-rule': 'evenodd',
          'clip-rule': 'evenodd',
          d: 'M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554ZM67.2944 66.062L67.2941 66.0609H67.2932L67.2924 66.0635L67.2944 66.062Z',
          fill: 'white'
        })
      ]),
      // NWC - gradient fill (yellow/orange)
      props.type === 'nwc' && h('svg', { width: '20', height: '20', viewBox: '0 0 257 256', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('defs', {}, [
          h('linearGradient', { id: `nwc_grad_${props.walletId || 'def'}`, x1: '123.989', y1: '10.4384', x2: '123.989', y2: '249.939', gradientUnits: 'userSpaceOnUse' }, [
            h('stop', { 'stop-color': '#FFCA4A' }),
            h('stop', { offset: '1', 'stop-color': '#F7931A' })
          ])
        ]),
        h('path', {
          d: 'M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z',
          fill: `url(#nwc_grad_${props.walletId || 'def'})`
        }),
        h('path', {
          d: 'M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z',
          fill: '#897FFF'
        })
      ]),
      // LNBits - pink fill
      props.type === 'lnbits' && h('svg', { width: '18', height: '18', viewBox: '0 0 502 902', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('path', {
          d: 'M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z',
          fill: '#FF1FE1'
        })
      ]),
      // Default wallet icon
      !['spark', 'nwc', 'lnbits'].includes(props.type) && h('svg', { width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('path', {
          d: 'M19 7h-1V6a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-8a3 3 0 0 0-3-3zm-4 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2z',
          fill: 'white'
        })
      ])
    ].filter(Boolean));
  }
};

const StatusDot = {
  props: { status: String },
  setup(props) {
    return () => h('span', { class: 'status-dot' }, [
      props.status === 'connecting' && h('span', { class: 'dot dot--loading' }),
      props.status === 'connected' && h('span', { class: 'dot dot--ok' }),
      props.status === 'pin_required' && h('span', { class: 'dot dot--warn' }),
      props.status === 'failed' && h('span', { class: 'dot dot--error' })
    ]);
  }
};

// ─────────────────────────────────────────────────────────────
// Props / Emits
// ─────────────────────────────────────────────────────────────
const props = defineProps({ modelValue: { type: Boolean, default: false } });
const emit = defineEmits(['update:modelValue', 'transfer-complete']);

// ─────────────────────────────────────────────────────────────
// Composables
// ─────────────────────────────────────────────────────────────
const $q = useQuasar();
const store = useWalletStore();

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const STEPS = [
  { key: 'select', label: 'Select' },
  { key: 'amount', label: 'Amount' },
  { key: 'confirm', label: 'Confirm' }
];

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
const amountInputRef = ref(null);
const connStatus = reactive({});

const state = reactive({
  currentStep: 1,
  fromWallet: null,
  toWallet: null,
  amount: '',
  amountError: '',
  showFromPicker: false,
  showToPicker: false,
  isTransferring: false,
  transferComplete: false,
  transferError: '',
  isReconnecting: false,
  isMaxAmount: false
});

// ─────────────────────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────────────────────
const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
});

const themeClass = computed(() => $q.dark.isActive ? 'theme-dark' : 'theme-light');
const wallets = computed(() => store.getTransferableWallets());
const sameWalletSelected = computed(() => state.fromWallet && state.toWallet && state.fromWallet.id === state.toWallet.id);

const canProceed = computed(() => {
  if (state.isTransferring) return false;
  if (state.currentStep === 1) return state.fromWallet && state.toWallet && state.fromWallet.id !== state.toWallet.id;
  if (state.currentStep === 2) return state.amount && parseInt(state.amount) > 0 && !state.amountError;
  return true;
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const fmt = (sats) => sats ? `${sats.toLocaleString()} sats` : '0 sats';

// ─────────────────────────────────────────────────────────────
// Methods
// ─────────────────────────────────────────────────────────────
async function init() {
  const active = wallets.value.find(w => w.id === store.activeWalletId);
  if (active?.canSend) state.fromWallet = active;
  await reconnectAll();
}

async function reconnectAll() {
  state.isReconnecting = true;
  for (const w of store.wallets) {
    const connected = store.connectionStates[w.id]?.connected;
    connStatus[w.id] = connected ? 'connected' : (w.type === 'spark' && !store.sessionPin) ? 'pin_required' : 'connecting';
  }
  await Promise.allSettled(store.wallets.map(async (w) => {
    if (connStatus[w.id] !== 'connecting') return;
    try {
      await store.ensureWalletConnectedForTransfer(w.id);
      connStatus[w.id] = 'connected';
    } catch (e) {
      connStatus[w.id] = (w.type === 'spark' && e.message?.includes('PIN')) ? 'pin_required' : 'failed';
    }
  }));
  state.isReconnecting = false;
}

function pickFrom(w) {
  if (!w.canSend) return;
  state.fromWallet = w;
  state.showFromPicker = false;
  haptics.tap();
  if (state.toWallet?.id === w.id) state.toWallet = null;
}

function pickTo(w) {
  if (w.id === state.fromWallet?.id) return;
  state.toWallet = w;
  state.showToPicker = false;
  haptics.tap();
}

function setPercent(p) {
  if (!state.fromWallet) return;
  state.isMaxAmount = false;
  state.amount = Math.floor((state.fromWallet.balance || 0) * p / 100).toString();
  validateAmount();
  haptics.tap();
}

function setMax() {
  if (!state.fromWallet) return;
  const balance = state.fromWallet.balance || 0;

  // Calculate fee buffer based on balance size (all integers)
  let feeBuffer;
  if (balance < 100) {
    // Small balance: reserve ~5% with minimum 1 sat
    feeBuffer = Math.max(1, Math.ceil(balance * 0.05));
  } else if (balance < 1000) {
    // Medium balance: reserve ~2% with minimum 5 sats
    feeBuffer = Math.max(5, Math.ceil(balance * 0.02));
  } else {
    // Large balance: reserve ~1% with minimum 10 sats, max 100 sats
    feeBuffer = Math.min(100, Math.max(10, Math.ceil(balance * 0.01)));
  }

  const maxAmount = Math.floor(Math.max(0, balance - feeBuffer));
  state.amount = maxAmount.toString();
  state.isMaxAmount = true;
  validateAmount();
  haptics.tap();
}

function validateAmount() {
  state.amountError = '';
  const n = parseInt(state.amount);
  if (!state.amount || isNaN(n)) return;
  if (n <= 0) state.amountError = 'Amount must be greater than 0';
  else if (n > (state.fromWallet?.balance || 0)) state.amountError = 'Insufficient balance';
}

function onAmountInput() {
  state.isMaxAmount = false; // Clear max flag when user manually edits
  validateAmount();
}

function goNext() {
  if (!canProceed.value) return;
  if (state.currentStep < 3) {
    state.currentStep++;
    haptics.tap();
    if (state.currentStep === 2) nextTick(() => amountInputRef.value?.focus());
  } else {
    doTransfer();
  }
}

function goBack() {
  if (state.currentStep > 1) {
    state.currentStep--;
    haptics.tap();
  }
}

async function doTransfer() {
  if (state.isTransferring) return;
  state.isTransferring = true;
  state.transferError = '';
  try {
    haptics.medium();
    await store.transferBetweenWallets(state.fromWallet.id, state.toWallet.id, parseInt(state.amount));
    state.transferComplete = true;
    haptics.success();
    emit('transfer-complete', { fromWallet: state.fromWallet, toWallet: state.toWallet, amount: parseInt(state.amount) });
  } catch (e) {
    state.transferError = e.message || 'Transfer failed';
    haptics.error();
  } finally {
    state.isTransferring = false;
  }
}

function resetState() {
  Object.assign(state, {
    currentStep: 1,
    fromWallet: null,
    toWallet: null,
    amount: '',
    amountError: '',
    isTransferring: false,
    transferComplete: false,
    transferError: '',
    isMaxAmount: false,
    isReconnecting: false
  });
  Object.keys(connStatus).forEach(k => delete connStatus[k]);
}

function close() {
  isVisible.value = false;
}

// ─────────────────────────────────────────────────────────────
// Watchers
// ─────────────────────────────────────────────────────────────
watch(() => props.modelValue, (open) => { if (open) init(); });
</script>

<style scoped>
/* ════════════════════════════════════════════════════════════
   Theme Variables
   ════════════════════════════════════════════════════════════ */
.theme-dark {
  --c-bg: #1c1c1e;
  --c-bg2: #2c2c2e;
  --c-bg3: #3a3a3c;
  --c-text: #fff;
  --c-text2: #8e8e93;
  --c-text3: #636366;
  --c-border: rgba(255,255,255,.1);
}
.theme-light {
  --c-bg: #fff;
  --c-bg2: #f2f2f7;
  --c-bg3: #e5e5ea;
  --c-text: #000;
  --c-text2: #8e8e93;
  --c-text3: #aeaeb2;
  --c-border: rgba(0,0,0,.08);
}

/* ════════════════════════════════════════════════════════════
   Modal
   ════════════════════════════════════════════════════════════ */
.modal-card {
  width: 100%;
  max-width: 480px;
  border-radius: 24px 24px 0 0;
  background: var(--c-bg);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  border-bottom: 1px solid var(--c-border);
}
.header-left { display: flex; align-items: center; gap: 10px; }
.header-icon { color: #15DE72; }
.header-title { margin: 0; font-size: 17px; font-weight: 600; color: var(--c-text); }
.close-btn { color: var(--c-text2); }

/* ════════════════════════════════════════════════════════════
   Step Nav
   ════════════════════════════════════════════════════════════ */
.step-nav {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 20px 20px 0;
  gap: 0;
}
.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  opacity: .35;
  transition: opacity .2s;
}
.step.active { opacity: 1; }
.step-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--c-bg3);
  color: var(--c-text2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}
.step.active .step-dot { background: #15DE72; color: #fff; }
.step-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .3px; color: var(--c-text2); }
.step-line { width: 48px; height: 2px; margin: 13px 8px 0; background: var(--c-bg3); border-radius: 1px; }
.step-line.active { background: #15DE72; }

/* ════════════════════════════════════════════════════════════
   Body
   ════════════════════════════════════════════════════════════ */
.modal-body { padding: 24px 20px; min-height: 220px; }
.step-panel { animation: fadeIn .2s ease; }
.step-panel--center { text-align: center; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* ════════════════════════════════════════════════════════════
   Field / Wallet Button
   ════════════════════════════════════════════════════════════ */
.field { margin-bottom: 0; }
.field-label { display: block; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; color: var(--c-text2); margin-bottom: 8px; }
.wallet-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--c-bg2);
  border: 2px solid transparent;
  border-radius: 14px;
  cursor: pointer;
  text-align: left;
  transition: border-color .15s, background .15s;
}
.wallet-btn:hover { background: var(--c-bg3); }
.wallet-btn.selected { border-color: #15DE72; }
.wallet-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wallet-name { font-size: 15px; font-weight: 500; color: var(--c-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wallet-bal { font-size: 13px; color: #15DE72; }
.wallet-bal.muted { color: var(--c-text3); }
.placeholder-icon { color: var(--c-text3); }
.placeholder-text { flex: 1; font-size: 15px; color: var(--c-text3); }
.chevron { color: var(--c-text3); flex-shrink: 0; }

/* ════════════════════════════════════════════════════════════
   Avatar
   ════════════════════════════════════════════════════════════ */
.avatar {
  width: 38px; height: 38px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  background: #000;
}
.avatar--sm { width: 32px; height: 32px; }
.avatar--sm svg { width: 16px !important; height: 15px !important; }

/* ════════════════════════════════════════════════════════════
   Direction Indicator (elegant vertical connector)
   ════════════════════════════════════════════════════════════ */
.direction {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 0;
}
.direction-line {
  width: 2px;
  height: 16px;
  background: linear-gradient(to bottom, var(--c-bg3), #15DE72);
  border-radius: 1px;
}
.direction-icon {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: rgba(21, 222, 114, 0.12);
  border: 2px solid #15DE72;
  color: #15DE72;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}
.direction-line-bottom {
  width: 2px;
  height: 16px;
  background: linear-gradient(to bottom, #15DE72, var(--c-bg3));
  border-radius: 1px;
}

/* ════════════════════════════════════════════════════════════
   Banners
   ════════════════════════════════════════════════════════════ */
.banner { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 500; margin-top: 16px; }
.banner--info { background: rgba(21,222,114,.12); color: #15DE72; margin-top: 0; margin-bottom: 16px; }
.banner--warn { background: rgba(245,158,11,.12); color: #f59e0b; }
.banner--error { background: rgba(239,68,68,.12); color: #ef4444; }
.banner--lg { padding: 14px 16px; font-size: 14px; }

/* ════════════════════════════════════════════════════════════
   Amount Step
   ════════════════════════════════════════════════════════════ */
.route-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 24px;
  background: var(--c-bg2);
  border-radius: 12px;
}
.route-wallet {
  display: flex;
  align-items: center;
  gap: 8px;
}
.route-wallet-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text);
  max-width: 90px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.route-arrow {
  width: 24px; height: 24px;
  border-radius: 50%;
  background: rgba(21, 222, 114, 0.12);
  color: #15DE72;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.amount-row { display: flex; align-items: baseline; justify-content: center; gap: 8px; margin-bottom: 8px; }
.amount-input {
  width: 180px; font-size: 48px; font-weight: 600; text-align: center;
  background: transparent; border: none; outline: none; color: var(--c-text);
  -moz-appearance: textfield;
}
.amount-input::-webkit-outer-spin-button, .amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.amount-input::placeholder { color: var(--c-text3); }
.amount-unit { font-size: 18px; font-weight: 500; color: var(--c-text2); }
.hint { margin: 0 0 24px; font-size: 13px; color: var(--c-text2); }
.quick-row { display: flex; justify-content: center; gap: 10px; }
.quick-chip {
  min-width: 60px; padding: 10px 16px; font-size: 14px; font-weight: 500;
  background: var(--c-bg2); color: var(--c-text); border: none; border-radius: 20px; cursor: pointer;
  transition: background .15s;
}
.quick-chip:hover { background: var(--c-bg3); }
.quick-chip:active { transform: scale(.96); }
.quick-chip--max {
  background: rgba(21, 222, 114, 0.15);
  color: #15DE72;
  font-weight: 600;
}
.quick-chip--max:hover { background: rgba(21, 222, 114, 0.25); }
.fee-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 12px 0 0;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--c-text2);
  background: var(--c-bg2);
  border-radius: 8px;
}

/* ════════════════════════════════════════════════════════════
   Confirm Step
   ════════════════════════════════════════════════════════════ */
.confirm-amount { font-size: 36px; font-weight: 700; color: #15DE72; margin-bottom: 24px; }
.confirm-flow { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 24px; }
.confirm-wallet { display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--c-text); min-width: 80px; }
.flow-connector {
  display: flex;
  align-items: center;
  gap: 0;
}
.connector-line {
  width: 20px;
  height: 2px;
  background: linear-gradient(to right, var(--c-bg3), #15DE72);
}
.connector-line:last-child {
  background: linear-gradient(to right, #15DE72, var(--c-bg3));
}
.connector-arrow {
  width: 24px; height: 24px;
  border-radius: 50%;
  background: rgba(21, 222, 114, 0.12);
  border: 2px solid #15DE72;
  color: #15DE72;
  display: flex;
  align-items: center;
  justify-content: center;
}
.note { margin: 0; font-size: 13px; color: var(--c-text2); }

/* ════════════════════════════════════════════════════════════
   Success
   ════════════════════════════════════════════════════════════ */
.success-ring { width: 72px; height: 72px; margin: 0 auto 20px; border-radius: 50%; background: rgba(21,222,114,.15); color: #15DE72; display: flex; align-items: center; justify-content: center; animation: pop .4s cubic-bezier(.175,.885,.32,1.275); }
@keyframes pop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
.success-title { margin: 0 0 8px; font-size: 20px; font-weight: 600; color: var(--c-text); }
.success-amount { margin: 0 0 8px; font-size: 32px; font-weight: 700; color: #15DE72; }
.success-route { margin: 0; font-size: 14px; color: var(--c-text2); }

/* ════════════════════════════════════════════════════════════
   Footer
   ════════════════════════════════════════════════════════════ */
.modal-footer { display: flex; align-items: center; padding: 16px 20px; padding-bottom: max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--c-border); gap: 12px; }
.btn-back { display: flex; align-items: center; gap: 4px; padding: 10px 16px; font-size: 15px; font-weight: 500; color: var(--c-text2); }
.btn-main { display: flex; align-items: center; gap: 6px; padding: 12px 24px; font-size: 15px; font-weight: 600; background: #15DE72 !important; color: #fff !important; border-radius: 12px; }
.btn-main:hover { background: #059573 !important; }
.btn-main:disabled { opacity: .5; }

/* ════════════════════════════════════════════════════════════
   Picker
   ════════════════════════════════════════════════════════════ */
.picker-card { width: 100%; max-width: 480px; border-radius: 24px 24px 0 0; background: var(--c-bg); }
.picker-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--c-border); }
.picker-header h3 { margin: 0; font-size: 17px; font-weight: 600; color: var(--c-text); }
.picker-list { padding: 8px 12px 12px; max-height: 50vh; overflow-y: auto; }
.picker-row {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px;
  background: transparent; border: none; border-radius: 12px; cursor: pointer; text-align: left;
  transition: background .15s;
}
.picker-row:hover { background: rgba(128,128,128,.06); }
.picker-row.selected { background: rgba(34,197,94,.1); }
.picker-row.disabled { opacity: .4; cursor: not-allowed; }
.picker-row.disabled:hover { background: transparent; }
.picker-row .wallet-meta { flex: 1; }
.check { color: #15DE72; }
.hint-text { font-size: 11px; color: var(--c-text3); }

/* ════════════════════════════════════════════════════════════
   Status Dot
   ════════════════════════════════════════════════════════════ */
.status-dot { width: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot--loading { background: var(--c-text3); animation: pulse 1s infinite; }
.dot--ok { background: #15DE72; }
.dot--warn { background: #f59e0b; }
.dot--error { background: #ef4444; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
</style>
