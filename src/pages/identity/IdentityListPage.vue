<!--
  Identities: every identity on this phone in one inset grouped list.

  A row makes that identity the one in use, on tap, with Undo in the
  confirmation toast (a switch is reversible, so it is not asked first). The
  identity in use carries the checkmark. Each row's detail button opens the
  identity's own page, where its public code, secret key and removal live,
  so none of that repeats on every row. Adding is the list's last row;
  erasing everything sits apart, in its own group.
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
          :key="row.account"
          :name="nameOf(row)"
          :caption="captionOf(row).text"
          :mono="captionOf(row).mono"
          :picture="row.picture"
          :active="row.active"
          :disabled="busy || bucket.isSweeping"
          @select="onSelect(row)"
          @details="$router.push(`/identity/identities/${row.account}`)"
        />
        <button type="button" class="add-identity" :disabled="busy || bucket.isSweeping" @click="showCreate = true">
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

    <NewIdentitySheet v-model="showCreate" @created="refresh" />
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
const { identities, refresh, nameOf, captionOf } = useIdentities(t);
const { busy, switching, switchTo } = useIdentityChange(t);

/** Back goes to whichever screen opened this one. */
const backNav = computed(() => identityBack(router, route.path));
const showCreate = ref(false);

function onSelect(row) {
  const current = identities.value.find((r) => r.active);
  if (row.active || !current) return;
  switchTo(
    { account: row.account, name: nameOf(row), picture: row.picture },
    { account: current.account, name: nameOf(current), picture: current.picture },
    refresh,
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
/* Destructive territory sits apart from the switching it must never be
   mistaken for. */
.erase-group { margin-top: 22px; }
</style>
