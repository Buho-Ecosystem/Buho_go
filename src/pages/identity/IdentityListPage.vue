<!--
  Identities: every identity on this phone in one inset grouped list.

  A row makes that identity the one in use, on tap, with Undo in the
  confirmation toast (a switch is reversible, so it is not asked first). The
  identity in use carries the checkmark. Each row's detail button opens the
  identity's own page, where its public code, secret key and removal live,
  so none of that repeats on every row. Adding is the list's last row (an
  action sheet: create one, or use one from another app); erasing
  everything sits apart, in its own group.
-->
<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Identities') }}</h1>

      <IdentityGroup
        :title="$t('On this phone')"
        :footer="$t('Tap an identity to use it. The same 12 words back up every identity.')"
      >
        <IdentityAccountRow
          v-for="row in identities"
          :key="row.key"
          :name="nameOf(row)"
          :caption="originOf(row) || captionOf(row).text"
          :mono="!originOf(row) && captionOf(row).mono"
          :picture="row.picture"
          :active="row.active"
          :disabled="busy || bucket.isSweeping"
          @select="onSelect(row)"
          @details="$router.push(`/identity/identities/${row.key}`)"
        />
        <button type="button" class="add-identity" :disabled="busy || bucket.isSweeping" @click="showAddChoice = true">
          <span class="add-identity-glyph" aria-hidden="true"><Icon icon="tabler:plus" width="20" height="20" /></span>
          {{ $t('Add identity') }}
        </button>
      </IdentityGroup>

      <IdentityGroup
        class="erase-group"
        :footer="$t('Removes every identity on this phone and starts a fresh card. Your wallets and your Bitcoin are not affected.')"
      >
        <IdentityRow
          danger
          :label="$t('Erase all identities')"
          :chevron="false"
          @click="$router.push('/identity/erase')"
        />
      </IdentityGroup>
    </div>

    <!-- HIG action sheet: the two ways to add, and Cancel. -->
    <q-dialog v-model="showAddChoice" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <div class="add-choice" role="menu" :aria-label="$t('Add identity')">
        <div class="add-choice-group">
          <button type="button" role="menuitem" class="add-choice-option" @click="chooseAdd('create')">{{ $t('Create new identity') }}</button>
          <button type="button" role="menuitem" class="add-choice-option" @click="chooseAdd('import')">{{ $t('Use an existing identity') }}</button>
        </div>
        <button type="button" class="add-choice-option add-choice-cancel" @click="showAddChoice = false">{{ $t('Cancel') }}</button>
      </div>
    </q-dialog>
    <NewIdentitySheet v-model="showCreate" />
    <ImportIdentitySheet v-model="showImport" :current="currentTarget" />
    <IdentitySwitchingDialog :target="switching" />
    <SettingsHubNav />
  </q-page>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import IdentityAccountRow from '../../components/identity/IdentityAccountRow.vue';
import NewIdentitySheet from '../../components/identity/NewIdentitySheet.vue';
import ImportIdentitySheet from '../../components/identity/ImportIdentitySheet.vue';
import IdentitySwitchingDialog from '../../components/identity/IdentitySwitchingDialog.vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { identityBack } from '../../composables/useIdentityBack';
import { useIdentities } from '../../composables/useIdentities';
import { useIdentityChange } from '../../composables/useIdentityChange';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { useSocialBucketStore } from '../../stores/socialBucket';

// vue-i18n runs in legacy mode, so useI18n() throws; reach $t via the proxy.
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const router = useRouter();
const route = useRoute();
const identity = useIdentityStore();
const profile = useProfileStore();
const bucket = useSocialBucketStore();
const { identities, refresh, nameOf, captionOf, originOf } = useIdentities(t);
const { busy, switching, switchTo } = useIdentityChange(t);

/** Back goes to whichever screen opened this one. */
const backNav = computed(() => identityBack(router, route.path));
const showCreate = ref(false);
const showImport = ref(false);
const showAddChoice = ref(false);

/** The identity in use, as a switch target (for Undo after an import). */
const currentTarget = computed(() => {
  const current = identities.value.find((r) => r.active);
  return current ? { key: current.key, name: nameOf(current), picture: current.picture } : null;
});

/** The action sheet closes before the next sheet opens: one owns focus at a time. */
function chooseAdd(choice) {
  showAddChoice.value = false;
  setTimeout(() => {
    if (choice === 'create') showCreate.value = true;
    else showImport.value = true;
  }, 250);
}

function onSelect(row) {
  const current = identities.value.find((r) => r.active);
  if (row.active || !current) return;
  switchTo(
    { key: row.key, name: nameOf(row), picture: row.picture },
    { key: current.key, name: nameOf(current), picture: current.picture },
  );
}

onMounted(async () => {
  await identity.hydrate();
  await profile.hydrate();
  await refresh();
  // A stale pointer means another device cannot find these identities after
  // a restore. The moment the list is on screen is the moment it matters
  // most, and it is our retry to make, not a task to hand over.
  if (identity.pointerDirty) identity.republishNostrPointer().catch(() => {});
});
</script>

<style scoped>
.add-identity { width: 100%; min-height: 56px; display: flex; align-items: center; gap: 12px; padding: 0 14px; border: 0; border-top: 1px solid var(--border-card); background: transparent; color: var(--brand-accent-text); font-family: 'Manrope', sans-serif; font-size: 16px; font-weight: 600; text-align: left; cursor: pointer; }
.add-identity:disabled { opacity: 0.5; cursor: default; }
.add-identity:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: -2px; }
.add-identity-glyph { width: 40px; display: grid; place-items: center; }
.add-choice { width: 100%; max-width: 560px; margin: 0 auto; padding: 0 10px max(10px, env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 8px; }
.add-choice-group { display: flex; flex-direction: column; border-radius: 14px; overflow: hidden; background: var(--bg-card); }
.add-choice-option { min-height: 56px; border: 0; background: var(--bg-card); color: var(--brand-accent-text); font: 500 17px/1.3 'Manrope', sans-serif; cursor: pointer; }
.add-choice-group .add-choice-option + .add-choice-option { border-top: 1px solid var(--border-card); }
.add-choice-cancel { border-radius: 14px; font-weight: 700; }
.add-choice-option:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: -2px; }
/* Destructive territory sits apart from the switching it must never be
   mistaken for. */
.erase-group { margin-top: 22px; }
</style>
