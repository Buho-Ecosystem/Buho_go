<!--
  Create another identity: choose what comes along (contacts or a clean
  list), wait on a progress stage, then name it and pick a photo.

  Sheet handoffs wait for dismissal, so only one sheet owns focus at a time:
  choice sheet -> profile sheet <-> photo picker.
-->
<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    :persistent="busy"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @update:model-value="close"
    @hide="onChoiceHidden"
  >
    <q-card class="account-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true"><span></span></div>

      <div class="account-sheet-header">
        <div>
          <span class="account-sheet-kicker">{{ $t('New identity') }}</span>
          <h2 class="account-sheet-title">{{ $t('Create another identity') }}</h2>
        </div>
        <q-btn flat round dense class="account-sheet-close" :disable="busy" :aria-label="$t('Close')" @click="close(false)">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div v-if="busy" class="account-progress" role="status" aria-live="polite">
        <span class="account-progress-orb" aria-hidden="true">
          <q-spinner size="34px" color="positive" />
        </span>
        <strong>{{ $t('Creating your identity…') }}</strong>
        <p>{{ keepContacts ? $t('Copying your contacts and preparing a separate profile.') : $t('Preparing a fresh profile with no contacts.') }}</p>
      </div>

      <div v-else class="account-sheet-body">
        <p class="account-sheet-lede">{{ $t('Choose what comes with you. You can change the contact list later.') }}</p>

        <div class="account-options">
          <button v-if="contactCount > 0" type="button" class="account-option account-option--recommended" @click="onCreate(true)">
            <span class="account-option-icon account-option-icon--accent" aria-hidden="true">
              <Icon icon="tabler:address-book" width="21" height="21" />
            </span>
            <span class="account-option-copy">
              <span class="account-option-title-row">
                <strong>{{ $t('Bring my contacts') }}</strong>
                <span class="account-option-chip">{{ $t('Recommended') }}</span>
              </span>
              <span>{{ contactCount === 1 ? $t('Copy one contact into the new identity.') : $t('Copy {n} contacts into the new identity.', { n: contactCount }) }}</span>
            </span>
            <Icon class="account-option-chevron" icon="tabler:chevron-right" width="18" height="18" />
          </button>

          <button type="button" class="account-option" @click="onCreate(false)">
            <span class="account-option-icon" aria-hidden="true">
              <Icon icon="tabler:user-plus" width="21" height="21" />
            </span>
            <span class="account-option-copy">
              <strong>{{ $t('Start empty') }}</strong>
              <span>{{ $t('Begin with a clean contact list.') }}</span>
            </span>
            <Icon class="account-option-chevron" icon="tabler:chevron-right" width="18" height="18" />
          </button>

          <div class="account-recovery-note">
            <Icon icon="tabler:shield-check" width="17" height="17" />
            <span>{{ $t('The same 12 words recover this identity too.') }}</span>
          </div>
        </div>
      </div>
    </q-card>
  </q-dialog>

  <q-dialog v-model="showProfileSetup" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'" @hide="onProfileSetupHidden">
    <q-card class="account-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true"><span></span></div>
      <div class="account-sheet-header">
        <div>
          <span class="account-sheet-kicker">{{ $t('New identity') }}</span>
          <h2 class="account-sheet-title">{{ $t('Make it yours') }}</h2>
        </div>
        <q-btn flat round dense class="account-sheet-close" :aria-label="$t('Close')" @click="showProfileSetup = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>
      <div class="profile-setup-body">
        <button type="button" class="setup-avatar" @click="openProfilePicker">
          <img v-if="profile.picture" :src="profile.picture" alt="" />
          <Icon v-else icon="tabler:camera-plus" width="25" height="25" />
          <span>{{ profile.picture ? $t('Change photo') : $t('Add a photo') }}</span>
        </button>
        <label class="setup-field">
          <span>{{ $t('Name') }}</span>
          <input v-model="profileName" type="text" :placeholder="$t('Your name')" maxlength="200" autocomplete="off" />
        </label>
        <button type="button" class="account-confirm" @click="finishProfileSetup">{{ $t('Done') }}</button>
      </div>
    </q-card>
  </q-dialog>

  <ProfileAvatarPickerSheet v-model="showProfilePicker" @hide="showProfileSetup = true" />
</template>

<script setup>
import { computed, getCurrentInstance, ref } from 'vue';
import { useQuasar } from 'quasar';
import { Icon } from '@iconify/vue';
import ProfileAvatarPickerSheet from '../ProfileAvatarPickerSheet.vue';
import { useAddressBookStore } from '../../stores/addressBook';
import { useProfileStore } from '../../stores/profile';
import { useIdentityChange } from '../../composables/useIdentityChange';

defineProps({ modelValue: { type: Boolean, default: false } });
const emit = defineEmits(['update:modelValue', 'created']);

// vue-i18n runs in legacy mode, so useI18n() throws; reach $t via the proxy.
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const $q = useQuasar();
const addressBook = useAddressBookStore();
const profile = useProfileStore();
const { busy, create } = useIdentityChange(t);

const contactCount = computed(() => addressBook.entries.length);
const keepContacts = ref(false);
const showProfileSetup = ref(false);
const showProfilePicker = ref(false);
const profileName = ref('');
let profileSetupNext = false;
let pickerNext = false;

function close() {
  if (!busy.value) emit('update:modelValue', false);
}

async function onCreate(keep) {
  keepContacts.value = keep;
  if (!await create(keep)) return;
  emit('created');
  profileName.value = '';
  profileSetupNext = true;
  emit('update:modelValue', false);
}

function onChoiceHidden() {
  if (!profileSetupNext) return;
  profileSetupNext = false;
  showProfileSetup.value = true;
}

function openProfilePicker() {
  pickerNext = true;
  showProfileSetup.value = false;
}

function onProfileSetupHidden() {
  if (!pickerNext) return;
  pickerNext = false;
  showProfilePicker.value = true;
}

async function finishProfileSetup() {
  profile.setDisplayName(profileName.value);
  if (profile.isDirty) await profile.publish().catch(() => {});
  showProfileSetup.value = false;
  emit('created');
  $q.notify({ type: 'positive', message: t('New identity created'), timeout: 2200 });
}
</script>

<style scoped>
.account-sheet { width: 100%; max-width: 520px; border-radius: 24px 24px 0 0; overflow: hidden; padding-bottom: max(14px, env(safe-area-inset-bottom, 0px)); }
.sheet-handle { display: flex; justify-content: center; padding: 8px 0 3px; }
.sheet-handle span { width: 36px; height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--text-secondary) 28%, transparent); }
body.body--dark .sheet-handle span { background: rgba(255, 255, 255, 0.22); }
.account-sheet-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 10px 20px 12px; }
.account-sheet-kicker { display: block; margin-bottom: 3px; color: var(--brand-accent-text); font-size: 12px; font-weight: 700; letter-spacing: 0.035em; text-transform: uppercase; }
.account-sheet-title { margin: 0; color: var(--text-primary); font-family: 'Manrope', sans-serif; font-size: 22px; font-weight: 750; letter-spacing: -0.03em; line-height: 1.22; }
.account-sheet-close { flex: 0 0 auto; width: 40px; height: 40px; min-width: 40px; min-height: 40px; color: var(--text-secondary); background: color-mix(in srgb, var(--text-secondary) 9%, transparent); }
body.body--dark .account-sheet-close { background: rgba(255, 255, 255, 0.07); }
.account-sheet-body { padding: 0 20px 8px; }
.account-sheet-lede { margin: 0 0 16px; color: var(--text-secondary); font-size: 14px; line-height: 1.5; }

.account-options { display: flex; flex-direction: column; gap: 10px; }
.account-option { width: 100%; min-height: 72px; display: grid; grid-template-columns: 42px minmax(0, 1fr) 18px; align-items: center; gap: 12px; padding: 12px 13px; border: 1px solid var(--border-card); border-radius: 18px; background: color-mix(in srgb, var(--text-primary) 2.5%, transparent); color: var(--text-primary); text-align: left; cursor: pointer; transition: transform 100ms ease, border-color 160ms ease, background 160ms ease; -webkit-tap-highlight-color: transparent; }
.account-option--recommended { border-color: color-mix(in srgb, var(--brand-accent-text) 30%, var(--border-card)); background: color-mix(in srgb, var(--brand-accent-soft) 48%, transparent); }
.account-option:hover { border-color: color-mix(in srgb, var(--brand-accent-text) 35%, var(--border-card)); }
.account-option:active { transform: scale(0.985); }
body.body--dark .account-option { background: rgba(255, 255, 255, 0.025); }
body.body--dark .account-option--recommended { border-color: rgba(113, 232, 167, 0.26); background: rgba(21, 222, 114, 0.09); }
.account-option-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 14px; color: var(--text-secondary); background: color-mix(in srgb, var(--text-secondary) 9%, transparent); }
body.body--dark .account-option-icon { background: rgba(255, 255, 255, 0.07); }
.account-option-icon--accent { color: var(--brand-accent-text); background: var(--brand-accent-soft); }
.account-option-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; font-family: 'Manrope', sans-serif; }
.account-option-copy strong { font-size: 15px; font-weight: 700; line-height: 1.25; }
.account-option-copy > span:last-child { color: var(--text-secondary); font-size: 12.5px; line-height: 1.35; }
.account-option-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
.account-option-chip { padding: 3px 7px; border-radius: 999px; color: var(--brand-accent-text); background: var(--brand-accent-soft); font-size: 10.5px; font-weight: 750; letter-spacing: 0.01em; }
.account-option-chevron { color: var(--text-secondary); opacity: 0.65; }
.account-recovery-note { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 5px 8px 1px; color: var(--text-secondary); font-size: 12px; line-height: 1.35; text-align: center; }

.account-progress { min-height: 238px; padding: 32px 24px 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.account-progress-orb { width: 68px; height: 68px; margin-bottom: 17px; display: grid; place-items: center; border-radius: 22px; color: var(--brand-accent-text); background: var(--brand-accent-soft); }
.account-progress strong { color: var(--text-primary); font-family: 'Manrope', sans-serif; font-size: 18px; font-weight: 750; letter-spacing: -0.02em; }
.account-progress p { max-width: 300px; margin: 7px 0 0; color: var(--text-secondary); font-size: 13.5px; line-height: 1.45; }

.profile-setup-body { padding: 4px 20px 12px; }
.setup-avatar { display: flex; flex-direction: column; align-items: center; gap: 7px; width: 100%; padding: 4px 0 18px; border: 0; background: transparent; color: var(--brand-accent-text); font-size: 13px; font-weight: 650; }
.setup-avatar img, .setup-avatar > svg { width: 76px; height: 76px; border-radius: 50%; object-fit: cover; display: grid; place-items: center; background: var(--brand-accent-soft); }
.setup-field { display: flex; flex-direction: column; gap: 7px; margin-bottom: 16px; color: var(--text-secondary); font-size: 12.5px; font-weight: 650; }
.setup-field input { width: 100%; min-height: 48px; padding: 0 13px; border: 1px solid var(--border-card); border-radius: var(--radius-md); background: var(--bg-input); color: var(--text-primary); font: inherit; font-size: 15px; outline: none; }
.setup-field input:focus { border-color: var(--brand-accent-text); }
.account-confirm { width: 100%; min-height: 50px; border: 0; border-radius: 16px; background: #1a1a1c; color: #faf7ef; font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 700; cursor: pointer; }
body.body--dark .account-confirm { background: #f4f4f4; color: #0c0c0c; }
.account-confirm:active { transform: scale(0.985); }
</style>
