<!--
  MoveLightningAddressSheet: hand one Spark wallet's Lightning address to
  another of the person's Spark wallets. Choose where payments to the name
  should arrive, read what changes, confirm. The consequence that cannot be
  undone in one tap (the receiving wallet's current address stops working)
  is stated before the button, not after.
-->
<template>
  <q-dialog
    v-model="open"
    position="bottom"
    transition-show="slide-up"
    transition-hide="slide-down"
    :persistent="moving"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="move-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="form-sheet-grabber" aria-hidden="true"></div>
      <header class="form-sheet-header">
        <button type="button" class="form-sheet-cancel" :disabled="moving" @click="open = false">{{ $t('Cancel') }}</button>
        <h2 class="form-sheet-title">{{ $t('Move address') }}</h2>
        <span aria-hidden="true"></span>
      </header>

      <div v-if="source" class="move-body">
        <p class="move-address">{{ address }}</p>
        <p class="move-lead">{{ $t('Choose the wallet that should receive payments sent to this address.') }}</p>

        <div class="move-list" role="radiogroup" :aria-label="$t('Receiving wallet')">
          <button
            v-for="wallet in targets"
            :key="wallet.id"
            type="button"
            role="radio"
            class="move-option"
            :aria-checked="wallet.id === targetId ? 'true' : 'false'"
            :disabled="moving || !connected(wallet.id)"
            :data-wallet-id="wallet.id"
            @click="targetId = wallet.id"
          >
            <span class="move-option-mark" aria-hidden="true"><WalletBrandMark type="spark" :size="16" /></span>
            <span class="move-option-copy">
              <span class="move-option-name">{{ wallet.name }}</span>
              <span class="move-option-sub" :class="{ 'is-placeholder': !connected(wallet.id) || !addressOf(wallet) }">{{ connected(wallet.id) ? (addressOf(wallet) || $t('No address yet')) : $t('Offline') }}</span>
            </span>
            <q-icon v-if="wallet.id === targetId" name="check" size="20px" class="move-option-check" :aria-hidden="true" />
          </button>
        </div>

        <p v-if="targets.length && targets.every((w) => !connected(w.id))" class="move-consequence" role="status">
          {{ notConnectedCopy }}
        </p>
        <p v-if="target" class="move-consequence" :class="{ 'is-destructive': !!addressOf(target) }" role="status">
          {{ addressOf(target)
            ? $t('{target} receives at {address} instead of {old}, which stops working. {source} gets a new address, which you can change later.', { target: target.name, address, old: addressOf(target), source: source.name })
            : $t('{target} receives at {address}. {source} gets a new address, which you can change later.', { target: target.name, address, source: source.name }) }}
        </p>
        <p v-if="error" class="form-sheet-error move-error" role="alert">{{ error }}</p>

        <button type="button" class="form-sheet-primary move-primary" :disabled="!target || moving" @click="move">
          <q-spinner v-if="moving" size="18px" :aria-hidden="true" />
          {{ moving ? $t('Moving address...') : $t('Move address') }}
        </button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue';
import { useWalletStore } from '../../stores/wallet';
import WalletBrandMark from '../WalletBrandMark.vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** The Spark wallet whose address moves. */
  fromWalletId: { type: String, default: null },
});
const emit = defineEmits(['update:modelValue', 'moved']);

// vue-i18n runs in legacy mode (src/boot/i18n.js), so useI18n() throws.
// Reach $t through the component proxy, the app's established pattern.
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const store = useWalletStore();
const targetId = ref(null);
const moving = ref(false);
const error = ref('');

const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) });
const source = computed(() => store.sparkWallets.find((w) => w.id === props.fromWalletId) || null);
const targets = computed(() => store.sparkWallets.filter((w) => w.id !== props.fromWalletId));
const target = computed(() => targets.value.find((w) => w.id === targetId.value) || null);
const addressOf = (wallet) => store.walletInfos[wallet.id]?.lightningAddress || wallet.metadata?.lud16 || '';
const address = computed(() => (source.value ? addressOf(source.value) : ''));
const connected = (walletId) => !!store.connectionStates[walletId]?.connected;
/** Every possible receiving wallet is offline: name them right for one or several. */
const notConnectedCopy = computed(() => (targets.value.length > 1
  ? t('Your other wallets need to be connected to receive the address. Check your connection and try again.')
  : t('Both wallets need to be connected. Check your connection and try again.')));

watch(() => props.modelValue, (visible) => {
  if (!visible) return;
  error.value = '';
  // One other wallet: nothing to choose.
  targetId.value = targets.value.length === 1 && connected(targets.value[0].id) ? targets.value[0].id : null;
});

function describe(failure) {
  switch (failure?.code) {
    case 'LN_ADDRESS_NOT_CONNECTED': return t('Both wallets need to be connected. Check your connection and try again.');
    case 'LN_ADDRESS_NONE': return t('This wallet has no address to move right now.');
    default: return t('The address could not be moved. Nothing changed, so you can try again.');
  }
}

async function move() {
  if (!target.value || moving.value) return;
  moving.value = true;
  error.value = '';
  try {
    const result = await store.moveSparkLightningAddress(props.fromWalletId, target.value.id);
    emit('moved', { ...result, target: target.value });
    open.value = false;
  } catch (failure) {
    console.warn('[move-address] not moved:', failure?.code || failure?.message || failure);
    error.value = describe(failure);
  } finally {
    moving.value = false;
  }
}
</script>

<style scoped>
.move-card { width: 100%; max-width: 560px; margin: 0 auto; border-radius: 24px 24px 0 0; padding-bottom: max(20px, var(--safe-bottom, 0px)); max-height: 92dvh; overflow-y: auto; }
.move-body { display: flex; flex-direction: column; padding: 8px 20px 0; }
.move-address { margin: 4px 0 0; font-family: var(--font-mono, monospace); font-size: 15px; font-weight: 600; text-align: center; overflow-wrap: anywhere; color: var(--text-primary); }
.move-lead { margin: 12px 0 16px; color: var(--text-secondary); font-size: 14px; line-height: 1.5; text-align: center; }
.move-list { display: flex; flex-direction: column; border: 1px solid var(--border-card); border-radius: 16px; overflow: hidden; background: var(--bg-input); }
.move-option { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 60px; padding: 10px 14px; border: 0; background: transparent; color: var(--text-primary); text-align: start; font: inherit; cursor: pointer; }
.move-option + .move-option { border-top: 1px solid var(--border-card); }
.move-option:disabled { opacity: .5; cursor: default; }
.move-option-mark { display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%; background: #1a1a1c; }
.move-option-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 2px; }
.move-option-name { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.move-option-sub { color: var(--text-secondary); font-family: var(--font-mono, monospace); font-size: 12px; overflow-wrap: anywhere; }
.move-option-check { flex-shrink: 0; color: var(--brand-accent-text, #15DE72); }
.move-consequence { margin: 14px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
.move-consequence.is-destructive { color: var(--color-negative); }
.move-option-sub.is-placeholder { font-family: inherit; }
.move-error { margin: 10px 0 0; }
.move-primary { margin-top: 20px; }
body.body--dark .move-option-mark { background: rgba(255, 255, 255, 0.1); }
.move-option:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
</style>
