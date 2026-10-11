<!--
  One identity's own page, opened from the detail button on its row in
  Identities: use it, copy its public code, copy its secret key, or take it
  off this phone. Never offered for the identity in use.

  How it leaves depends on where it came from:
    - made here (from the 12 words): Remove hides it, nothing more (the
      identity store's `nostrRemovedAccounts`): a plain action sheet;
    - an imported secret key: Delete erases the only copy on this phone,
      so an alert says so first;
    - a signer app: Disconnect ends the pairing; connecting again undoes it.
-->
<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Identities')" to="/identity/identities" :title="$t('Identity')" />

    <div v-if="row" class="id-sub-body">
      <header class="detail-head">
        <span class="detail-avatar" aria-hidden="true">
          <img v-if="row.picture && !pictureBroken" :src="row.picture" alt="" @error="pictureBroken = true" />
          <Icon v-else icon="tabler:user" width="38" height="38" />
        </span>
        <h1 class="detail-name">{{ name }}</h1>
        <span class="detail-caption" :class="{ 'detail-caption--mono': caption.mono }">{{ caption.text }}</span>
        <span v-if="row.active" class="detail-in-use">
          <Icon icon="tabler:check" width="14" height="14" />{{ $t('In use') }}
        </span>
      </header>

      <button
        v-if="!row.active"
        type="button"
        class="btn-primary detail-use"
        :disabled="busy || bucket.isSweeping"
        @click="onUse"
      >
        {{ $t('Use this identity') }}
      </button>

      <IdentityGroup
        :title="$t('Keys')"
        :footer="$t('Share the public code so people can find you. Keep the secret key private: anyone who has it can act as this identity.')"
      >
        <IdentityRow icon="tabler:id" :label="$t('Public code')" :caption="row.npub" mono :chevron="false" @click="copyPublicCode">
          <template #trailing><span class="row-action">{{ $t('Copy') }}</span></template>
        </IdentityRow>
        <IdentityRow v-if="hasSecretKey" icon="tabler:lock-password" :label="$t('Secret key')" @click="showSecretKey = true" />
      </IdentityGroup>

      <IdentityGroup
        v-if="signerApp"
        :title="$t('Signer')"
        :footer="$t('Your key stays in your signer app; it is asked for every signature. Social Bucket needs a secret key on this phone.')"
      >
        <IdentityRow :icon="row.kind === 'nip07' ? 'tabler:puzzle' : 'tabler:link'" :label="originOf(row)" :interactive="false" />
      </IdentityGroup>

      <IdentityGroup
        v-if="!row.active && row.external"
        class="remove-group"
        :footer="signerApp ? $t('Ends the pairing with your signer app. You can connect again any time.') : $t('Deletes the secret key stored on this phone. Make sure you have it saved somewhere else.')"
      >
        <IdentityRow danger :icon="signerApp ? 'tabler:plug-connected-x' : 'tabler:trash'" :label="signerApp ? $t('Disconnect') : $t('Delete from this phone')" :chevron="false" @click="showRemove = true" />
      </IdentityGroup>

      <IdentityGroup
        v-if="!row.active && !row.external"
        class="remove-group"
        :footer="$t('Hides {name} on this phone. Nothing is deleted: its keys, username and contacts stay, and restoring your 12 words brings it back.', { name })"
      >
        <IdentityRow danger icon="tabler:eye-off" :label="$t('Remove from this phone')" :chevron="false" @click="showRemove = true" />
      </IdentityGroup>
    </div>

    <IdentitySwitchingDialog :target="switching" />
    <IdentityPrivateKeySheet v-if="row && hasSecretKey" v-model="showSecretKey" :account="row.external ? null : row.account" :external-id="row.external ? row.id : null" :name="name" :npub="row.npub" />

    <!-- An alert when the loss is final (a stored secret key), an action
         sheet when the step can be undone (hide, disconnect). -->
    <q-dialog v-if="row" v-model="showRemove" :position="removal.alert ? 'standard' : 'bottom'" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="remove-sheet" :class="{ 'remove-sheet--alert': removal.alert }" role="alertdialog" aria-labelledby="remove-title" aria-describedby="remove-body">
        <h2 id="remove-title" class="remove-title">{{ removal.title }}</h2>
        <p id="remove-body" class="remove-body">{{ removal.body }}</p>
        <button type="button" class="remove-confirm" @click="onRemove">{{ removal.confirm }}</button>
        <button type="button" class="remove-cancel" @click="showRemove = false">{{ $t('Cancel') }}</button>
      </q-card>
    </q-dialog>

    <SettingsHubNav />
  </q-page>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { copyToClipboard, useQuasar } from 'quasar';
import { Icon } from '@iconify/vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import IdentityPrivateKeySheet from '../../components/identity/IdentityPrivateKeySheet.vue';
import IdentitySwitchingDialog from '../../components/identity/IdentitySwitchingDialog.vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { useIdentities } from '../../composables/useIdentities';
import { useIdentityChange } from '../../composables/useIdentityChange';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { useSocialBucketStore } from '../../stores/socialBucket';

const LIST_PATH = '/identity/identities';

// vue-i18n runs in legacy mode, so useI18n() throws; reach $t via the proxy.
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const identity = useIdentityStore();
const profile = useProfileStore();
const bucket = useSocialBucketStore();
const { identities, refresh, nameOf, captionOf, originOf } = useIdentities(t);
const { busy, switching, switchTo } = useIdentityChange(t);

/** The route names a derived account by number, an imported identity by id. */
const key = computed(() => (/^\d+$/.test(route.params.key) ? Number(route.params.key) : String(route.params.key)));
const row = computed(() => identities.value.find((r) => r.key === key.value) || null);
/** A secret key this phone can copy: made here, or imported as a key. */
const hasSecretKey = computed(() => !!row.value && (!row.value.external || row.value.kind === 'secretKey'));
const signerApp = computed(() => !!row.value?.external && row.value.kind !== 'secretKey');
const removal = computed(() => {
  if (row.value?.external && !signerApp.value) {
    return { alert: true, title: t('Delete {name} from this phone?', { name: name.value }), body: t('This phone\'s copy of the secret key is deleted. Make sure it is saved somewhere else.'), confirm: t('Delete') };
  }
  if (signerApp.value) {
    return { alert: false, title: t('Disconnect {name}?', { name: name.value }), body: t('You can connect again any time.'), confirm: t('Disconnect') };
  }
  return { alert: false, title: t('Remove {name} from this phone?', { name: name.value }), body: t('Restoring your 12 words brings it back.'), confirm: t('Remove') };
});
const name = computed(() => nameOf(row.value));
const caption = computed(() => captionOf(row.value));
const showSecretKey = ref(false);
const showRemove = ref(false);
const pictureBroken = ref(false);
watch(() => row.value?.picture, () => { pictureBroken.value = false; });

async function onUse() {
  const current = identities.value.find((r) => r.active);
  if (!row.value || row.value.active || !current) return;
  await switchTo(
    { key: row.value.key, name: name.value, picture: row.value.picture },
    { key: current.key, name: nameOf(current), picture: current.picture },
  );
}

async function copyPublicCode() {
  try {
    await copyToClipboard(row.value.npub);
  } catch {
    $q.notify({ type: 'warning', message: t("Couldn't copy"), timeout: 2000 });
    return;
  }
  $q.notify({ type: 'positive', message: t('Public code copied'), timeout: 1600 });
}

async function onRemove() {
  showRemove.value = false;
  if (row.value?.external) {
    const removedName = name.value;
    try {
      identity.deleteExternalIdentity(row.value.id);
    } catch (err) {
      console.warn('[identity-detail] delete failed:', err?.code || err);
      $q.notify({ type: 'negative', message: t("Couldn't remove the identity"), caption: t('Please try again.'), timeout: 3500 });
      return;
    }
    $q.notify({ type: 'positive', message: t('{name} removed from this phone', { name: removedName }), timeout: 2500 });
    router.replace(LIST_PATH);
    return;
  }
  const removed = { account: row.value.account, name: name.value };
  // "Restoring your 12 words brings it back" holds only once the restore
  // pointer lists this identity, which a creation made offline may not have
  // published yet.
  if (identity.pointerDirty) await identity.republishNostrPointer().catch(() => {});
  if (identity.pointerDirty) {
    $q.notify({ type: 'warning', message: t('Connect to the internet to remove this identity'), caption: t('Your 12 words can only bring it back once this phone has been online.'), timeout: 4500 });
    return;
  }
  try {
    identity.removeNostrIdentityFromDevice(removed.account);
  } catch (err) {
    console.warn('[identity-detail] remove failed:', err?.code || err);
    $q.notify({ type: 'negative', message: t("Couldn't remove the identity"), caption: t('Please try again.'), timeout: 3500 });
    return;
  }
  $q.notify({
    message: t('{name} removed from this phone', { name: removed.name }),
    timeout: 5000,
    actions: [{ label: t('Undo'), color: 'white', handler: () => identity.restoreNostrIdentityToDevice(removed.account) }],
  });
  router.replace(LIST_PATH);
}

onMounted(async () => {
  await identity.hydrate();
  await profile.hydrate();
  await refresh();
  // A removed or unknown identity has no page; its list is the way back.
  if (!row.value) router.replace(LIST_PATH);
});
</script>

<style scoped>
.detail-head { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 8px 4px; text-align: center; }
.detail-avatar { width: 88px; height: 88px; margin-bottom: 8px; display: grid; place-items: center; overflow: hidden; border-radius: 50%; background: var(--bg-input); color: var(--text-secondary); }
.detail-avatar img { width: 100%; height: 100%; object-fit: cover; }
.detail-name { margin: 0; max-width: 100%; overflow-wrap: anywhere; color: var(--text-primary); font-family: 'Manrope', sans-serif; font-size: 24px; font-weight: 750; line-height: 1.25; letter-spacing: -0.02em; }
.detail-caption { max-width: 100%; overflow-wrap: anywhere; color: var(--text-secondary); font-size: 14px; }
.detail-caption--mono { font-family: var(--font-mono); font-size: 13px; }
.detail-in-use { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; padding: 4px 10px; border-radius: var(--radius-pill); background: var(--brand-accent-soft); color: var(--brand-accent-text); font-size: 12.5px; font-weight: 700; }
.detail-use { margin-top: 18px !important; }
.row-action { flex: 0 0 auto; color: var(--brand-accent-text); font-size: 14px; font-weight: 650; }
/* Destructive territory sits apart from everything above it. */
.remove-group { margin-top: 22px; }

.remove-sheet { width: 100%; max-width: 520px; padding: 22px 20px max(16px, env(safe-area-inset-bottom, 0px)); border-radius: 24px 24px 0 0; background: var(--bg-card); color: var(--text-primary); text-align: center; }
.remove-title { margin: 0; font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 700; line-height: 1.35; letter-spacing: normal; overflow-wrap: anywhere; }
.remove-body { margin: 6px 0 18px; color: var(--text-secondary); font-size: 14px; line-height: 1.45; }
.remove-confirm, .remove-cancel { width: 100%; min-height: 50px; border: 0; border-radius: 14px; font-family: 'Manrope', sans-serif; font-size: 16px; font-weight: 700; cursor: pointer; }
.remove-confirm { background: rgba(255, 68, 68, 0.12); color: var(--color-red); }
.remove-cancel { margin-top: 8px; background: transparent; color: var(--text-primary); }
.remove-sheet--alert { width: min(320px, calc(100vw - 48px)); border-radius: 20px; padding-bottom: 16px; }
</style>
