<template>
  <q-dialog
    :model-value="updateStore.sheetOpen"
    :persistent="updateStore.isRequired"
    :position="$q.screen.lt.sm ? 'bottom' : 'standard'"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @update:model-value="onDialogModel"
  >
    <q-card class="update-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="update-sheet__grab" aria-hidden="true"></div>

      <q-card-section class="update-sheet__header">
        <div class="update-sheet__icon" :class="{ 'update-sheet__icon--required': updateStore.isRequired }">
          <Icon :icon="updateStore.isRequired ? 'tabler:shield-exclamation' : 'tabler:download'" width="27" height="27" />
        </div>
        <div class="update-sheet__copy">
          <h2 class="update-sheet__title">{{ updateTitle }}</h2>
          <p class="update-sheet__version">
            {{ $t('You are using version {version}', { version: currentVersion }) }}
          </p>
        </div>
      </q-card-section>

      <q-card-section v-if="releaseNotes.length" class="update-sheet__notes">
        <div v-for="note in releaseNotes" :key="note" class="update-sheet__note">
          <span class="update-sheet__check" aria-hidden="true">
            <Icon icon="tabler:check" width="13" height="13" />
          </span>
          <span>{{ note }}</span>
        </div>
      </q-card-section>

      <q-card-section v-if="updateStore.isRequired" class="update-sheet__required-copy">
        {{ $t('This update is needed to keep BuhoGO working safely. You can still back up your recovery phrase first.') }}
      </q-card-section>

      <q-card-section v-if="isDownloading" class="update-sheet__progress">
        <div class="update-sheet__progress-copy">
          <span>{{ $t('Downloading update') }}</span>
          <span v-if="progressPercent">{{ progressPercent }}%</span>
        </div>
        <q-linear-progress
          rounded
          size="6px"
          :indeterminate="!progressPercent"
          :value="updateStore.playDownloadProgress"
          color="positive"
        />
      </q-card-section>

      <div v-if="updateStore.actionError" class="update-sheet__error" role="alert">
        {{ $t('Could not open the update. Please try again.') }}
      </div>

      <q-card-actions class="update-sheet__actions">
        <q-btn
          v-if="updateStore.isRequired"
          flat
          no-caps
          :label="$t('Back Up First')"
          class="update-sheet__secondary"
          @click="openRecovery"
        />
        <q-btn
          v-else
          flat
          no-caps
          :label="$t('Not Now')"
          class="update-sheet__secondary"
          @click="updateStore.dismissSheet()"
        />
        <q-btn
          unelevated
          no-caps
          :loading="updateStore.actionPending"
          :disable="isDownloading"
          :label="$t('Update Now')"
          class="update-sheet__primary"
          @click="updateStore.performUpdate()"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <transition name="update-ready">
    <div v-if="updateStore.playUpdateDownloaded" class="update-ready-banner" role="status">
      <div>
        <div class="update-ready-banner__title">{{ $t('Update ready') }}</div>
        <div class="update-ready-banner__copy">{{ $t('Restart BuhoGO to finish installing it.') }}</div>
      </div>
      <q-btn
        unelevated
        no-caps
        :label="$t('Restart')"
        class="update-ready-banner__button"
        @click="updateStore.completePlayUpdate()"
      />
    </div>
  </transition>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { Icon } from '@iconify/vue'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { localizedReleaseNotes } from '../services/appUpdate'
import { useUpdateStore } from '../stores/update'
import { PWA_UPDATE_EVENT, PWA_UPDATE_FLAG } from '../utils/updateEvents'

const props = defineProps({
  suspended: { type: Boolean, default: false },
})

const $q = useQuasar()
const route = useRoute()
const router = useRouter()
// BuhoGO configures vue-i18n in legacy mode, where useI18n() throws at
// runtime. Use the injected component proxy, matching the other setup-based
// components in this app.
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const locale = computed(() => proxy.$i18n.locale)
const updateStore = useUpdateStore()

let resumeListener = null
let startupTimer = null

const currentVersion = computed(() => updateStore.runtime?.version || '—')
const releaseNotes = computed(() => localizedReleaseNotes(updateStore.release, locale.value))
const updateTitle = computed(() => {
  if (updateStore.release?.version) {
    return t('BuhoGO {version} is available', { version: updateStore.release.version })
  }
  return t('A new BuhoGO version is ready')
})
const isDownloading = computed(() => updateStore.playUpdateStatus === 'downloading')
const progressPercent = computed(() => Math.round(updateStore.playDownloadProgress * 100))

function eligibleForCue() {
  return !props.suspended && route.path === '/wallet'
}

function eligibleForRequiredUpdate() {
  if (props.suspended) return false
  // Required updates may yield only to the recovery-phrase screen. As soon as
  // the user leaves that exact route, the update sheet becomes persistent
  // again instead of granting unrestricted access for the rest of the session.
  if (
    updateStore.requiredRecoveryAccess
    && route.path === '/settings'
    && route.query.section === 'backup'
  ) return false
  return !['/', '/kiosk'].includes(route.path) && !route.path.includes('setup') && !route.path.includes('restore')
}

function surfaceUpdate() {
  if (updateStore.isRequired && eligibleForRequiredUpdate()) {
    updateStore.openSheet()
    return
  }
  if (!updateStore.shouldShowCue || !eligibleForCue()) return

  // Mark before presenting so rapid route changes cannot duplicate the cue.
  // The persistent logo badge remains even after this lightweight message.
  updateStore.markCueShown()
  $q.notify({
    message: t('BuhoGO update available'),
    caption: t('Tap View to see what is new.'),
    icon: 'system_update_alt',
    timeout: 5500,
    actions: [{
      label: t('View'),
      color: 'white',
      handler: () => updateStore.openSheet(),
    }],
  })
}

async function runCheck(options) {
  await updateStore.checkForUpdates(options)
  surfaceUpdate()
}

function onPwaUpdateReady() {
  window[PWA_UPDATE_FLAG] = true
  updateStore.markPwaUpdateReady()
  surfaceUpdate()
}

function onDialogModel(open) {
  if (open) updateStore.openSheet()
  else updateStore.dismissSheet()
}

function openRecovery() {
  updateStore.allowRecoveryAccess(router)
}

watch(
  () => [props.suspended, route.fullPath, updateStore.status, updateStore.currentReleaseKey],
  surfaceUpdate,
  { flush: 'post' }
)

onMounted(async () => {
  window.addEventListener(PWA_UPDATE_EVENT, onPwaUpdateReady)
  await router.isReady()
  startupTimer = setTimeout(() => runCheck(), 650)

  if (Capacitor.isNativePlatform()) {
    resumeListener = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) runCheck()
    })
  }
})

onUnmounted(() => {
  window.removeEventListener(PWA_UPDATE_EVENT, onPwaUpdateReady)
  if (startupTimer) clearTimeout(startupTimer)
  resumeListener?.remove()
})
</script>

<style scoped>
.update-sheet {
  width: min(100%, 420px);
  border-radius: 22px;
  padding: 4px 6px 8px;
  color: var(--text-primary);
}

.update-sheet__grab {
  display: none;
  width: 36px;
  height: 5px;
  margin: 8px auto 2px;
  border-radius: 999px;
  background: var(--border-card);
}

.update-sheet__header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 18px 10px;
}

.update-sheet__icon {
  width: 54px;
  height: 54px;
  flex: 0 0 54px;
  display: grid;
  place-items: center;
  border-radius: 17px;
  color: var(--brand-accent);
  background: var(--brand-accent-soft);
}

.update-sheet__icon--required {
  color: var(--color-warn, #f59e0b);
  background: var(--color-warn-soft, rgba(245, 158, 11, 0.14));
}

.update-sheet__copy { min-width: 0; }

.update-sheet__title {
  margin: 0;
  font: 700 18px/1.25 'Manrope', sans-serif;
  letter-spacing: -0.02em;
}

.update-sheet__version {
  margin: 5px 0 0;
  color: var(--text-muted);
  font: 500 12.5px/1.4 'Manrope', sans-serif;
}

.update-sheet__notes {
  display: grid;
  gap: 10px;
  padding: 10px 18px 12px;
}

.update-sheet__note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  color: var(--text-secondary);
  font: 500 13.5px/1.45 'Manrope', sans-serif;
}

.update-sheet__check {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #08291a;
  background: var(--brand-accent);
}

.update-sheet__required-copy {
  margin: 6px 18px 4px;
  padding: 11px 12px;
  border-radius: 12px;
  color: var(--text-secondary);
  background: var(--color-warn-soft, rgba(245, 158, 11, 0.1));
  font: 500 12.5px/1.45 'Manrope', sans-serif;
}

.update-sheet__progress { padding: 10px 18px; }
.update-sheet__progress-copy {
  display: flex;
  justify-content: space-between;
  margin-bottom: 7px;
  color: var(--text-secondary);
  font: 600 12px/1.3 'Manrope', sans-serif;
}

.update-sheet__error {
  margin: 4px 18px;
  color: var(--color-red, #ef4444);
  font: 600 12.5px/1.4 'Manrope', sans-serif;
}

.update-sheet__actions {
  display: grid;
  grid-template-columns: 1fr 1.45fr;
  gap: 9px;
  padding: 14px 18px 16px;
}

.update-sheet__primary,
.update-sheet__secondary {
  min-height: 46px;
  border-radius: 13px;
  font: 700 14px/1 'Manrope', sans-serif;
}

.update-sheet__primary { background: var(--brand-accent); color: #08291a; }
.update-sheet__secondary { color: var(--text-secondary); background: var(--bg-input); }

.update-ready-banner {
  position: fixed;
  z-index: 10001;
  left: max(14px, env(safe-area-inset-left));
  right: max(14px, env(safe-area-inset-right));
  bottom: calc(14px + var(--safe-bottom, 0px));
  max-width: 440px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 14px 13px 16px;
  border: 1px solid var(--border-card);
  border-radius: 16px;
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.24);
}

.update-ready-banner__title { font: 700 14px/1.3 'Manrope', sans-serif; }
.update-ready-banner__copy { margin-top: 2px; color: var(--text-muted); font: 500 12px/1.35 'Manrope', sans-serif; }
.update-ready-banner__button { flex-shrink: 0; border-radius: 11px; background: var(--brand-accent); color: #08291a; font-weight: 700; }

.update-ready-enter-active,
.update-ready-leave-active { transition: opacity .18s ease, transform .18s ease; }
.update-ready-enter-from,
.update-ready-leave-to { opacity: 0; transform: translateY(12px); }

@media (max-width: 599px) {
  .update-sheet { max-width: none; border-radius: 22px 22px 0 0; padding-bottom: var(--safe-bottom, 0px); }
  .update-sheet__grab { display: block; }
}

@media (prefers-reduced-motion: reduce) {
  .update-ready-enter-active,
  .update-ready-leave-active { transition: none; }
}
</style>
