<!--
  Use an identity from another app. One sheet, four steps:
    choose   - how the key is held: browser extension (web), remote signer,
               or the secret key itself (offered last, as advised for keys);
    secret   - a secure field with Paste; the key is never shown;
    bunker   - a remote signer's link, then a wait for its approval;
    confirm  - "Is this you?": the profile found for the key, before anything
               is stored.
  Every wait can be cancelled. Website sign-ins keep using the 12 words.
-->
<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    :persistent="busy"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @update:model-value="(open) => !open && close()"
  >
    <q-card class="import-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true"><span></span></div>
      <header class="import-header">
        <q-btn v-if="step !== 'choose' && !waiting" flat round dense class="import-header-button" :aria-label="$t('Back')" @click="back">
          <Icon icon="tabler:chevron-left" width="20" height="20" />
        </q-btn>
        <span v-else class="import-header-spacer" aria-hidden="true"></span>
        <h2 class="import-title">{{ title }}</h2>
        <q-btn flat round dense class="import-header-button" :disable="busy" :aria-label="$t('Close')" @click="close">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </header>

      <div v-if="waiting" class="import-wait" role="status" aria-live="polite">
        <q-spinner size="34px" color="positive" />
        <strong>{{ waiting }}</strong>
        <button type="button" class="import-link" @click="cancelWait">{{ $t('Cancel') }}</button>
      </div>

      <div v-else-if="step === 'choose'" class="import-body">
        <div class="import-list">
          <button v-for="method in methods" :key="method.id" type="button" class="import-row" @click="method.open()">
            <span class="import-row-icon" aria-hidden="true"><Icon :icon="method.icon" width="20" height="20" /></span>
            <span class="import-row-text">
              <span class="import-row-title">{{ method.title }}</span>
              <span class="import-row-caption">{{ method.caption }}</span>
            </span>
            <Icon icon="tabler:chevron-right" width="18" height="18" class="import-row-chevron" />
          </button>
        </div>
        <p class="import-footer">{{ $t('Works with identities from any Nostr app. Website sign-ins keep using this phone\'s 12 words.') }}</p>
      </div>

      <form v-else-if="step === 'secret'" class="import-body" novalidate @submit.prevent="useSecretKey">
        <label class="import-label" for="import-secret">{{ $t('Secret key') }}</label>
        <div class="import-field">
          <input
            id="import-secret"
            v-model="secretInput"
            type="password"
            class="import-input"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            :aria-invalid="!!secretProblem"
            aria-describedby="import-secret-note"
            @input="secretProblem = ''"
          />
          <button type="button" class="import-paste" @click="pasteSecret">{{ $t('Paste') }}</button>
        </div>
        <p v-if="secretProblem" class="import-problem" role="alert">{{ secretProblem }}</p>
        <p id="import-secret-note" class="import-footer">{{ $t('Anyone with this key can act as you. BuhoGO keeps it encrypted on this phone and never shows it.') }}</p>
        <button type="submit" class="import-primary" :disabled="!secretInput.trim()">{{ $t('Continue') }}</button>
      </form>

      <form v-else-if="step === 'bunker'" class="import-body" novalidate @submit.prevent="connectBunker">
        <label class="import-label" for="import-bunker">{{ $t('Remote signer link') }}</label>
        <input
          id="import-bunker"
          v-model="bunkerInput"
          type="text"
          class="import-input import-input--full"
          placeholder="bunker://"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :aria-invalid="!!bunkerProblem"
          @input="bunkerProblem = ''"
        />
        <p v-if="bunkerProblem" class="import-problem" role="alert">{{ bunkerProblem }}</p>
        <p class="import-footer">{{ $t('Copy the connection link from your signer app. Your key stays there; BuhoGO asks it to sign.') }}</p>
        <button type="submit" class="import-primary" :disabled="!bunkerInput.trim()">{{ $t('Connect') }}</button>
      </form>

      <div v-else-if="step === 'confirm' && found" class="import-body">
        <div class="import-found">
          <span class="import-avatar" aria-hidden="true">
            <img v-if="foundProfile.picture && !pictureBroken" :src="foundProfile.picture" alt="" @error="pictureBroken = true" />
            <Icon v-else icon="tabler:user" width="34" height="34" />
          </span>
          <strong class="import-found-name">{{ foundProfile.name || $t('No profile found') }}</strong>
          <span v-if="foundProfile.address" class="import-found-caption">{{ foundProfile.address }}</span>
          <span class="import-found-caption import-found-caption--mono">{{ shortCode }}</span>
        </div>
        <label v-if="contactCount > 0" class="import-toggle">
          <span>{{ $t('Also copy my current contacts') }}</span>
          <q-toggle v-model="copyContacts" color="positive" :aria-label="$t('Also copy my current contacts')" />
        </label>
        <button type="button" class="import-primary" @click="useIdentity">{{ $t('Use this identity') }}</button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { Icon } from '@iconify/vue';
import { Capacitor } from '@capacitor/core';
import { useIdentityStore } from '../../stores/identity';
import { useAddressBookStore } from '../../stores/addressBook';
import { useWalletStore } from '../../stores/wallet';
import { useIdentityChange } from '../../composables/useIdentityChange';
import { shortPublicCode, addressFor } from '../../composables/useIdentities';
import { parseSecretKeyInput } from '../../utils/externalIdentity.js';
import { npubFromHex } from '../../utils/identityCrypto.js';
import { hasExtensionSigner, extensionSigner, pairBunker, closeBunker } from '../../services/identitySigners.js';
import { readClipboardCrossPlatform, writeClipboardCrossPlatform } from '../../utils/shopClipboard.js';
import { isBiometricAvailable, authenticate } from '../../utils/biometric';
import { fetchProfiles, parseProfileContent } from '../../utils/nostrFetch.js';
import { ownUsernameFrom } from '../../services/nip05.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** The identity in use now, for Undo after the switch: { key, name, picture }. */
  current: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue']);

// vue-i18n runs in legacy mode, so useI18n() throws; reach $t via the proxy.
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const $q = useQuasar();
const identity = useIdentityStore();
const addressBook = useAddressBookStore();
const wallet = useWalletStore();
const { switchTo } = useIdentityChange(t);

const step = ref('choose');
const waiting = ref('');
const secretInput = ref('');
const secretProblem = ref('');
const bunkerInput = ref('');
const bunkerProblem = ref('');
/** { kind, pubkeyHex, secretKey?, clientKey?, bunker?, connection? } */
const found = ref(null);
const foundProfile = ref({ name: '', address: '', picture: '' });
const pictureBroken = ref(false);
const copyContacts = ref(false);
let attempt = 0;

const busy = computed(() => !!waiting.value);
const contactCount = computed(() => addressBook.entries.length);
const shortCode = computed(() => (found.value ? shortPublicCode(npubFromHex(found.value.pubkeyHex)) : ''));
const title = computed(() => ({
  choose: t('Use an existing identity'),
  secret: t('Secret key'),
  bunker: t('Remote signer'),
  confirm: t('Is this you?'),
}[step.value]));

/** The ways in this platform offers, the one that keeps the key elsewhere first. */
const methods = computed(() => [
  ...(!Capacitor.isNativePlatform() && hasExtensionSigner()
    ? [{ id: 'nip07', icon: 'tabler:puzzle', title: t('Browser extension'), caption: t('Use the extension that holds your key.'), open: useExtension }]
    : []),
  { id: 'nip46', icon: 'tabler:link', title: t('Remote signer'), caption: t('Connect with a link from your signer app. Your key stays there.'), open: () => { step.value = 'bunker'; } },
  { id: 'secretKey', icon: 'tabler:lock-password', title: t('Secret key'), caption: t('Paste the key from your other app. It is kept on this phone.'), open: () => { step.value = 'secret'; } },
]);

/** Forget everything typed or found; wipe key bytes. */
function forget() {
  attempt += 1;
  found.value?.secretKey?.fill(0);
  found.value?.clientKey?.fill(0);
  closeBunker(found.value?.connection);
  found.value = null;
  secretInput.value = '';
  bunkerInput.value = '';
  secretProblem.value = '';
  bunkerProblem.value = '';
  waiting.value = '';
  copyContacts.value = false;
  pictureBroken.value = false;
}

function close() {
  if (busy.value) return;
  forget();
  step.value = 'choose';
  emit('update:modelValue', false);
}

function back() {
  forget();
  step.value = 'choose';
}

function cancelWait() {
  forget();
}

watch(() => props.modelValue, (open) => { if (open) { forget(); step.value = 'choose'; } });

async function pasteSecret() {
  try {
    secretInput.value = (await readClipboardCrossPlatform() || '').trim();
    secretProblem.value = '';
  } catch {
    secretProblem.value = t("Couldn't read the clipboard. Long-press the field to paste.");
  }
}

/** Load the found key's public profile, read only, for "Is this you?". */
async function showConfirm(result) {
  found.value = result;
  foundProfile.value = { name: '', address: '', picture: '' };
  step.value = 'confirm';
  const mine = attempt;
  try {
    const profiles = await fetchProfiles([result.pubkeyHex]);
    if (mine !== attempt) return;
    const content = parseProfileContent(profiles.get(result.pubkeyHex));
    const username = ownUsernameFrom(content.nip05);
    foundProfile.value = {
      name: content.display_name || content.name || '',
      address: username ? addressFor(username) : (typeof content.nip05 === 'string' ? content.nip05 : ''),
      picture: typeof content.picture === 'string' ? content.picture : '',
    };
  } catch { /* shown as "No profile found" */ }
}

async function useSecretKey() {
  const parsed = parseSecretKeyInput(secretInput.value);
  if (!parsed.ok) {
    secretProblem.value = parsed.problem === 'public_code'
      ? t('This is a public code. Paste the secret key instead.')
      : t("This doesn't look like a secret key.");
    return;
  }
  // The key is stored only after the person confirms it is them, and the
  // device unlock (when App Lock is on) has passed.
  if (wallet.biometricsEnabled) {
    const { available } = await isBiometricAvailable();
    if (available && !await authenticate({ reason: t('Store your secret key'), title: 'BuhoGO', useFallback: true })) {
      parsed.secretKey.fill(0);
      secretProblem.value = t('Unlock was not completed. Try again when you are ready.');
      return;
    }
  }
  secretInput.value = '';
  writeClipboardCrossPlatform('').catch(() => {});
  await showConfirm({ kind: 'secretKey', pubkeyHex: parsed.pubkeyHex, secretKey: parsed.secretKey });
}

async function connectBunker() {
  bunkerProblem.value = '';
  const mine = ++attempt;
  waiting.value = t('Waiting for your signer to approve');
  try {
    const paired = await pairBunker(bunkerInput.value);
    if (mine !== attempt) { closeBunker(paired.connection); paired.clientKey.fill(0); return; }
    waiting.value = '';
    await showConfirm({ kind: 'nip46', pubkeyHex: paired.pubkeyHex, clientKey: paired.clientKey, bunker: paired.bunker, connection: paired.connection });
  } catch (err) {
    if (mine !== attempt) return;
    waiting.value = '';
    bunkerProblem.value = err?.code === 'BUNKER_INVALID_LINK'
      ? t('This is not a remote signer link. It starts with bunker://')
      : t("Your signer didn't answer. Check that it is open and try again.");
  }
}

async function useExtension() {
  const mine = ++attempt;
  waiting.value = t('Waiting for your browser extension');
  try {
    const pubkeyHex = String(await extensionSigner().getPublicKey()).toLowerCase();
    if (mine !== attempt) return;
    waiting.value = '';
    await showConfirm({ kind: 'nip07', pubkeyHex });
  } catch {
    if (mine !== attempt) return;
    waiting.value = '';
    $q.notify({ type: 'negative', message: t("The extension didn't share your identity"), caption: t('Allow BuhoGO in the extension and try again.'), timeout: 4500 });
  }
}

async function useIdentity() {
  const result = found.value;
  if (!result) return;
  const keepContacts = copyContacts.value;
  const target = { name: foundProfile.value.name || t('Imported identity'), picture: foundProfile.value.picture };
  let added;
  try {
    added = await identity.addExternalIdentity(result);
  } catch (err) {
    console.warn('[import-identity] not stored:', err?.code || err);
    $q.notify({ type: 'negative', message: t("Couldn't add the identity"), caption: t('Please try again.'), timeout: 3500 });
    return;
  }
  // The store keeps what it needs; this sheet's copies go now. A connection
  // the store did not adopt (the identity was already here) closes with them.
  if (added.added) result.connection = null;
  forget();
  step.value = 'choose';
  emit('update:modelValue', false);
  if (!added.added) {
    $q.notify({ message: t('This identity is already on this phone'), timeout: 3000 });
    if (props.current?.key === added.key) return;
  }
  if (props.current) await switchTo({ key: added.key, ...target }, props.current, { keepContacts });
}
</script>

<style scoped>
.import-sheet { width: 100%; max-width: 560px; margin: 0 auto; border-radius: 24px 24px 0 0; padding-bottom: max(20px, var(--safe-bottom, 0px)); max-height: 92dvh; overflow-y: auto; }
/* Same chrome as the new-identity sheet beside it. */
.sheet-handle { display: flex; justify-content: center; padding: 8px 0 3px; }
.sheet-handle span { width: 36px; height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--text-secondary) 28%, transparent); }
body.body--dark .sheet-handle span { background: rgba(255, 255, 255, 0.22); }
.import-header { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; gap: 8px; padding: 6px 12px 4px; }
.import-header-spacer { width: 44px; }
.import-title { margin: 0; color: var(--text-primary); font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 700; line-height: 1.3; letter-spacing: -0.01em; text-align: center; }
.import-header-button { width: 44px; height: 44px; min-width: 44px; min-height: 44px; color: var(--text-secondary); background: color-mix(in srgb, var(--text-secondary) 9%, transparent); }
body.body--dark .import-header-button { background: rgba(255, 255, 255, 0.07); }
.import-body { display: flex; flex-direction: column; padding: 12px 20px 0; }
.import-list { border: 1px solid var(--border-card); border-radius: 16px; overflow: hidden; background: var(--bg-input); }
.import-row { width: 100%; min-height: 64px; display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 0; background: transparent; color: var(--text-primary); text-align: left; font: inherit; cursor: pointer; }
.import-row + .import-row { border-top: 1px solid var(--border-card); }
.import-row-icon { width: 36px; height: 36px; flex: 0 0 auto; display: grid; place-items: center; border-radius: var(--radius-ms, 10px); background: var(--bg-card); color: var(--text-secondary); }
.import-row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.import-row-title { font-size: 15px; font-weight: 600; }
.import-row-caption { color: var(--text-secondary); font-size: 12.5px; line-height: 1.4; }
.import-row-chevron { flex: 0 0 auto; color: var(--text-muted); }
.import-row:focus-visible, .import-paste:focus-visible, .import-link:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: -2px; }
.import-footer { margin: 10px 4px 0; color: var(--text-secondary); font-size: 12.5px; line-height: 1.5; }
.import-label { margin-bottom: 8px; color: var(--text-secondary); font-size: 13px; font-weight: 500; }
.import-field { display: flex; gap: 8px; }
.import-input { flex: 1; min-width: 0; min-height: 48px; padding: 10px 12px; border: 1px solid var(--border-card); border-radius: 12px; background: var(--bg-input); color: var(--text-primary); font: 500 16px/1.4 'Manrope', sans-serif; }
.import-input--full { width: 100%; }
.import-input[aria-invalid="true"] { border-color: var(--color-red); }
.import-input:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.import-paste { min-height: 48px; padding: 0 14px; border: 1px solid var(--border-card); border-radius: 12px; background: transparent; color: var(--brand-accent-text); font: 600 15px/1 'Manrope', sans-serif; cursor: pointer; }
.import-problem { margin: 8px 4px 0; color: var(--color-red); font-size: 13px; line-height: 1.45; }
.import-primary { width: 100%; min-height: 50px; margin-top: 20px; border: 0; border-radius: 16px; background: #1a1a1c; color: #faf7ef; font: 700 15px/1.3 'Manrope', sans-serif; cursor: pointer; }
body.body--dark .import-primary { background: #f4f4f4; color: #0c0c0c; }
.import-primary:disabled { opacity: .5; cursor: default; }
.import-primary:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.import-wait { min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 24px; text-align: center; }
.import-wait strong { color: var(--text-primary); font-size: 16px; font-weight: 700; }
.import-link { min-height: 44px; padding: 0 12px; border: 0; background: transparent; color: var(--brand-accent-text); font: 600 15px/1 'Manrope', sans-serif; cursor: pointer; }
.import-found { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 8px 4px; text-align: center; }
.import-avatar { width: 80px; height: 80px; margin-bottom: 8px; display: grid; place-items: center; overflow: hidden; border-radius: 50%; background: var(--bg-input); color: var(--text-secondary); }
.import-avatar img { width: 100%; height: 100%; object-fit: cover; }
.import-found-name { max-width: 100%; overflow-wrap: anywhere; color: var(--text-primary); font-size: 20px; font-weight: 750; line-height: 1.3; }
.import-found-caption { max-width: 100%; overflow-wrap: anywhere; color: var(--text-secondary); font-size: 14px; }
.import-found-caption--mono { font-family: var(--font-mono); font-size: 13px; }
.import-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; margin-top: 16px; padding: 4px 6px 4px 14px; border: 1px solid var(--border-card); border-radius: 14px; color: var(--text-primary); font-size: 15px; font-weight: 500; }
</style>
