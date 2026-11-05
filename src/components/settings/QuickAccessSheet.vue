<!--
  QuickAccessSheet: where BuhoGO can be opened from outside the app, opened
  from the Quick access row in Settings and by long-pressing a BuhoGO tile in
  Quick Settings (issues #445, #446). Android only.

  Quick Settings: a Send and a Receive tile, each with Add (Android 13 and
  newer: the system's own dialog) or Added. Android may stop showing that
  dialog after it was declined a few times, so the footer always says how to
  add a tile by hand.

  Home screen: Add for a Scan QR icon (the launcher's own confirmation), and
  how the long-press menu on the BuhoGO icon works. With the app lock on, the
  footer says why the last person paid is missing from that menu.

  Nothing here is a setting that is saved: what is added lives in the system,
  so the sheet asks again every time it opens and when the person comes back
  from the system's screens.
-->
<template>
  <q-dialog
    v-model="open"
    position="bottom"
    transition-show="slide-up"
    transition-hide="slide-down"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card class="qa-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="form-sheet-grabber" aria-hidden="true"></div>
      <header class="form-sheet-header">
        <span aria-hidden="true"></span>
        <h2 class="form-sheet-title">{{ $t('Quick access') }}</h2>
        <button type="button" class="form-sheet-cancel qa-done" @click="open = false">{{ $t('Done') }}</button>
      </header>

      <div class="qa-body">
        <p v-if="unavailableNote" class="qa-note" role="status">{{ unavailableNote }}</p>

        <SettingsSection :title="$t('Quick Settings')">
          <SettingsRow
            v-for="tile in tileRows"
            :key="tile.kind"
            :icon="tile.icon"
            :label="tile.label"
            :interactive="false"
          >
            <template #right>
              <span v-if="tiles.added[tile.kind]" class="qa-added">
                <Icon icon="tabler:check" width="16" height="16" aria-hidden="true" />
                {{ $t('Added') }}
              </span>
              <button
                v-else-if="tiles.canRequest"
                type="button"
                class="qa-add"
                :disabled="busy !== null"
                :aria-label="$t('Add the {name} tile', { name: tile.label })"
                @click="addTile(tile)"
              >
                {{ $t('Add') }}
              </button>
            </template>
          </SettingsRow>
          <template #footer>{{ tilesFooter }}</template>
        </SettingsSection>

        <SettingsSection v-if="pinSupported" :title="$t('Home screen')">
          <SettingsRow
            icon="tabler:camera"
            :label="$t('Scan QR')"
            :caption="$t('An icon that opens the camera to pay')"
            :interactive="false"
          >
            <template #right>
              <span v-if="scanPinned" class="qa-added">
                <Icon icon="tabler:check" width="16" height="16" aria-hidden="true" />
                {{ $t('Added') }}
              </span>
              <button
                v-else
                type="button"
                class="qa-add"
                :disabled="busy !== null"
                :aria-label="$t('Add Scan QR to the Home screen')"
                @click="pinScan"
              >
                {{ $t('Add') }}
              </button>
            </template>
          </SettingsRow>
          <template #footer>{{ menuFooter }}</template>
        </SettingsSection>
        <p v-else class="qa-hint">{{ menuFooter }}</p>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, ref } from 'vue';
import { useQuasar } from 'quasar';
import { Icon } from '@iconify/vue';
import { App } from '@capacitor/app';
import { useWalletStore } from '../../stores/wallet.js';
import { getPinnedShortcuts, getTiles, requestAddTile, requestPinShortcut } from '../../services/quickAccess.js';
import { scanShortcut } from '../../utils/quickAccessPlan.js';
import SettingsRow from './SettingsRow.vue';
import SettingsSection from './SettingsSection.vue';

const props = defineProps({ modelValue: { type: Boolean, default: false } });
const emit = defineEmits(['update:modelValue']);

const $q = useQuasar();
// vue-i18n runs in legacy mode (src/boot/i18n.js), so useI18n() throws.
const { proxy } = getCurrentInstance();
const t = (key, values) => proxy.$t(key, values);
const walletStore = useWalletStore();

const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) });

const tiles = ref({ canRequest: false, added: { send: false, receive: false } });
const pinSupported = ref(false);
const pinnedIds = ref([]);
/** The request waiting on the system: 'send', 'receive' or 'scan'. */
const busy = ref(null);

// The same icons as Home's Receive and Send buttons.
const tileRows = computed(() => [
  { kind: 'send', icon: 'tabler:scan', label: t('Send') },
  { kind: 'receive', icon: 'tabler:qrcode', label: t('Receive') },
]);

const scanPinned = computed(() => pinnedIds.value.includes(scanShortcut(t).id));

const unavailableNote = computed(() => {
  if (walletStore.kioskEnabled) return t('Quick access is off while kiosk mode is on.');
  if (!walletStore.activeWallet) return t('Quick access works once you have a wallet.');
  return '';
});

const tilesFooter = computed(() => (tiles.value.canRequest
  ? t('Swipe down from the top of the screen and tap a tile to open it. To add one yourself, swipe down twice, tap Edit and drag a BuhoGO tile into place.')
  : t('To add a tile, swipe down twice from the top of the screen, tap Edit and drag a BuhoGO tile into place.')));

const menuFooter = computed(() => (walletStore.biometricsEnabled
  ? t('Touch and hold the BuhoGO icon for Scan QR, Receive and Send. While App lock is on, the last person you paid stays out of this menu.')
  : t('Touch and hold the BuhoGO icon for Scan QR, Receive, Send and the last person you paid. Drag one onto your Home screen to keep it there.')));

async function refresh() {
  try {
    const [tileState, pins] = await Promise.all([getTiles(), getPinnedShortcuts()]);
    tiles.value = tileState;
    pinSupported.value = pins.pinSupported;
    pinnedIds.value = pins.shortcuts.map((s) => s.id);
  } catch (err) {
    console.warn('[quick-access] Could not read the tiles and shortcuts:', err?.message || err);
  }
}

async function addTile(tile) {
  busy.value = tile.kind;
  try {
    const result = await requestAddTile(tile.kind, tile.label);
    if (result === 'added' || result === 'already-added') {
      tiles.value = { ...tiles.value, added: { ...tiles.value.added, [tile.kind]: true } };
    } else if (result === 'failed') {
      $q.notify({ message: t('Android did not add the tile. Add it from Quick Settings instead.'), timeout: 4000 });
    }
  } catch (err) {
    console.warn('[quick-access] Add tile request failed:', err?.message || err);
    $q.notify({ message: t('Android did not add the tile. Add it from Quick Settings instead.'), timeout: 4000 });
  } finally {
    busy.value = null;
  }
}

async function pinScan() {
  busy.value = 'scan';
  try {
    // The launcher confirms on its own screen; coming back refreshes the row.
    if (!(await requestPinShortcut(scanShortcut(t)))) {
      $q.notify({ message: t('Your Home screen does not take icons from apps.'), timeout: 4000 });
    }
  } catch (err) {
    console.warn('[quick-access] Pin request failed:', err?.message || err);
    $q.notify({ message: t('Your Home screen does not take icons from apps.'), timeout: 4000 });
  } finally {
    busy.value = null;
  }
}

// Back from the system's dialogs or Quick Settings editor: ask again.
let resumeListener = null;
let shown = false;

async function onShow() {
  shown = true;
  refresh();
  const listener = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) refresh(); });
  if (shown && !resumeListener) resumeListener = listener;
  else listener.remove();
}

function onHide() {
  shown = false;
  resumeListener?.remove();
  resumeListener = null;
}

onBeforeUnmount(onHide);
</script>

<style scoped>
.qa-card { width: 100%; max-width: 560px; margin: 0 auto; border-radius: 24px 24px 0 0; padding-bottom: max(20px, var(--safe-bottom, 0px)); }
.qa-body { padding: 4px 16px 0; }
.qa-done { justify-self: end; font-weight: 600; }

.qa-note,
.qa-hint {
  margin: 4px 4px 16px;
  font: 400 13px/1.45 'Manrope', sans-serif;
  color: var(--text-muted);
}

.qa-add {
  min-width: 64px;
  min-height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--brand-accent-soft);
  color: var(--brand-accent-text);
  font: 600 14px/1 'Manrope', sans-serif;
  cursor: pointer;
}
.qa-add:disabled { opacity: 0.5; cursor: default; }
.qa-add:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: 2px; }

.qa-added {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font: 500 14px/1 'Manrope', sans-serif;
}
</style>
