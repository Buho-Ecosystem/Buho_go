<!--
  UpdateExperience: how BuhoGO tells people about a new version
  (docs/APP_UPDATES.md).

  An ordinary update never interrupts. A dot on the logo and on About in the
  menu, and the Software update row on About, lead to this sheet. It opens on
  its own only twice: for a required update (full screen, the recovery phrase
  stays reachable), and once a Google Play download has finished, because only
  a restart completes it.

  One sheet, by stage (updateStage): available, downloading, ready, required.
  Each has one filled button; the other action is quiet text.
-->
<template>
  <q-dialog
    :model-value="updateStore.sheetOpen"
    :persistent="isRequired"
    :maximized="isRequired"
    :position="isRequired || !$q.screen.lt.sm ? 'standard' : 'bottom'"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @update:model-value="onDialogModel"
  >
    <q-card
      class="update-sheet"
      :class="[$q.dark.isActive ? 'card_dark_style' : 'card_light_style', { 'update-sheet--full': isRequired }]"
    >
      <div v-if="!isRequired" class="form-sheet-grabber" aria-hidden="true"></div>

      <div v-if="focused" class="update-sheet__focus">
        <span class="update-mark update-mark--large">
          <img src="/buho_logo.svg" alt="" />
          <span class="update-mark__badge" :class="isRequired ? 'update-mark__badge--warn' : 'update-mark__badge--done'" aria-hidden="true">
            <Icon :icon="isRequired ? 'tabler:exclamation-mark' : 'tabler:check'" width="15" height="15" />
          </span>
        </span>
        <h2 class="update-sheet__title">{{ isRequired ? $t('Update required') : $t('Ready to install') }}</h2>
        <p class="update-sheet__body">{{ focusBody }}</p>
      </div>

      <template v-else>
        <div class="update-sheet__release">
          <span class="update-mark"><img src="/buho_logo.svg" alt="" /></span>
          <div class="update-sheet__heading">
            <h2 class="update-sheet__title">{{ releaseTitle }}</h2>
            <p class="update-sheet__source">{{ sourceLine }}</p>
          </div>
        </div>
        <section v-if="releaseNotes.length" class="update-sheet__notes">
          <h3>{{ $t("What's new") }}</h3>
          <ul>
            <li v-for="note in releaseNotes" :key="note">{{ note }}</li>
          </ul>
        </section>
      </template>

      <div v-if="stage === 'downloading'" class="update-sheet__progress">
        <div class="update-sheet__progress-copy">
          <span>{{ $t('Downloading...') }}</span>
          <span v-if="sizeLine">{{ sizeLine }}</span>
        </div>
        <q-linear-progress
          rounded
          size="6px"
          :indeterminate="!updateStore.playTotalBytes"
          :value="updateStore.playDownloadProgress"
          color="positive"
          :aria-label="$t('Downloading...')"
        />
      </div>

      <p v-if="note" class="update-sheet__note" :class="{ 'update-sheet__note--focus': focused }">
        <Icon v-if="note.secure" icon="tabler:lock" width="15" height="15" aria-hidden="true" />
        <span>{{ note.text }}</span>
      </p>

      <p v-if="updateStore.actionError" class="form-sheet-error update-sheet__error" role="alert">
        {{ $t('Could not open the update. Please try again.') }}
      </p>

      <div class="update-sheet__actions">
        <button
          v-if="actions.primary"
          type="button"
          class="form-sheet-primary"
          :disabled="updateStore.actionPending"
          @click="actions.primary.run"
        >
          <q-spinner v-if="updateStore.actionPending" size="18px" aria-hidden="true" />
          {{ actions.primary.label }}
        </button>
        <button type="button" class="update-sheet__quiet" @click="actions.secondary.run">
          {{ actions.secondary.label }}
        </button>
      </div>
    </q-card>
  </q-dialog>
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
/** The finished Play download is presented once per session; afterwards the dot leads back. */
let readyPresented = false

/** Where people get each channel's update, as the sheet names it. */
const SOURCE = Object.freeze({
  play: { available: 'Update available on Google Play', downloading: 'Downloading from Google Play' },
  zapstore: { available: 'Update available on Zapstore' },
  apk: { available: 'Update available on GitHub' },
  ios: { available: 'Update available on the App Store' },
  // A web update is already downloaded by the time it is offered.
  web: { available: 'Ready to install' },
})

const stage = computed(() => updateStore.stage)
const isRequired = computed(() => updateStore.isRequired)
/** Required and ready say one thing, centred; the others show the release. */
const focused = computed(() => isRequired.value || stage.value === 'ready')
const version = computed(() => updateStore.release?.version || '')
const releaseNotes = computed(() => localizedReleaseNotes(updateStore.release, locale.value))

const releaseTitle = computed(() => (version.value
  ? t('BuhoGO {version}', { version: version.value })
  : t('New version of BuhoGO')))

const sourceLine = computed(() => {
  const source = SOURCE[updateStore.release?.channel]
  if (!source) return ''
  return t(source[stage.value] || source.available)
})

const focusBody = computed(() => {
  if (isRequired.value && stage.value !== 'ready') {
    return t('This version of BuhoGO is no longer supported. Update to keep sending and receiving safely.')
  }
  return version.value
    ? t('BuhoGO {version} has downloaded. Restart to finish updating; it takes a few seconds.', { version: version.value })
    : t('The update has downloaded. Restart to finish updating; it takes a few seconds.')
})

const megabytes = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }))
const sizeLine = computed(() => {
  const { playBytesDownloaded: done, playTotalBytes: total } = updateStore
  if (!total) return ''
  const mb = bytes => megabytes.value.format(bytes / 1_000_000)
  return t('{done} of {total} MB', { done: mb(done), total: mb(total) })
})

/** The line under the content: what the update means for the wallet. */
const note = computed(() => {
  if (stage.value === 'downloading') {
    return { secure: false, text: t('You can keep using BuhoGO. It tells you when the update is ready.') }
  }
  if (isRequired.value && stage.value !== 'ready') {
    return { secure: true, text: t('Your funds are safe. Nothing is lost by updating.') }
  }
  return { secure: true, text: t('Your wallets, balance and recovery phrase stay exactly as they are.') }
})

const actions = computed(() => {
  const later = isRequired.value
    ? { label: t('Back Up Recovery Phrase'), run: openRecovery }
    : null
  switch (stage.value) {
    case 'ready':
      return {
        primary: { label: t('Restart BuhoGO'), run: () => updateStore.completePlayUpdate() },
        secondary: later || { label: t('Later'), run: dismiss },
      }
    case 'downloading':
      return { primary: null, secondary: { label: t('Continue in Background'), run: dismiss } }
    default:
      return {
        primary: { label: t('Update'), run: () => updateStore.performUpdate() },
        secondary: later || { label: t('Not Now'), run: dismiss },
      }
  }
})

function dismiss() {
  updateStore.dismissSheet()
}

function openRecovery() {
  updateStore.allowRecoveryAccess(router)
}

/** Screens where an update may present itself: not lock, kiosk, setup or restore. */
function presentableRoute() {
  return !['/', '/kiosk'].includes(route.path) && !route.path.includes('setup') && !route.path.includes('restore')
}

function surfaceUpdate() {
  if (props.suspended || !presentableRoute()) return
  if (stage.value === 'ready' && !readyPresented) {
    readyPresented = true
    updateStore.openSheet()
    return
  }
  // Required updates may yield only to Security, where the recovery words
  // live. As soon as the user leaves that exact route, the update sheet
  // becomes persistent again instead of granting unrestricted access for the
  // rest of the session.
  if (isRequired.value && !(updateStore.requiredRecoveryAccess && route.path === '/security')) {
    updateStore.openSheet()
  }
}

async function runCheck(options) {
  await updateStore.checkForUpdates(options)
  surfaceUpdate()
}

function onPwaUpdateReady() {
  window[PWA_UPDATE_FLAG] = true
  updateStore.markPwaUpdateReady()
}

function onDialogModel(open) {
  if (open) updateStore.openSheet()
  else updateStore.dismissSheet()
}

watch(
  () => [props.suspended, route.fullPath, updateStore.status, stage.value],
  surfaceUpdate,
  { flush: 'post' }
)

onMounted(async () => {
  window.addEventListener(PWA_UPDATE_EVENT, onPwaUpdateReady)
  await router.isReady()
  startupTimer = setTimeout(() => runCheck(), 650)

  // Coming back to the app checks again; the store keeps that to one network
  // check every few hours.
  if (Capacitor.isNativePlatform()) {
    resumeListener = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) runCheck()
    })
  } else {
    const onVisible = () => {
      if (document.visibilityState === 'visible') runCheck()
    }
    document.addEventListener('visibilitychange', onVisible)
    resumeListener = { remove: () => document.removeEventListener('visibilitychange', onVisible) }
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
  /* The ring around the mark's badge matches the sheet behind it. */
  --update-ring: var(--bg-card);
  width: min(100%, 440px);
  box-sizing: border-box;
  padding: 0 24px calc(20px + var(--safe-bottom, 0px));
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  display: flex;
  flex-direction: column;
}
body.body--dark .update-sheet { --update-ring: #0C0C0C; }

.update-sheet--full {
  width: 100%;
  max-width: none;
  min-height: 100%;
  border-radius: 0 !important;
  padding-top: var(--safe-top, 0px);
}

.update-mark {
  position: relative;
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
}
.update-mark img { width: 32px; height: 34px; }
.update-mark--large { width: 84px; height: 84px; border-radius: 21px; }
.update-mark--large img { width: 42px; height: 45px; }

.update-mark__badge {
  position: absolute;
  right: -7px;
  bottom: -7px;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--update-ring);
}
.update-mark__badge--done { background: var(--brand-accent); color: #04140B; }
.update-mark__badge--warn { background: #F5A524; color: #1A1A1A; }

.update-sheet__release {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 14px;
}
.update-sheet__heading { min-width: 0; }

.update-sheet__title {
  margin: 0;
  font-size: 21px;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.01em;
}
.update-sheet__source {
  margin: 3px 0 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.update-sheet__notes { margin-top: 24px; }
.update-sheet__notes h3 { margin: 0 0 8px; font-size: 15px; font-weight: 700; }
.update-sheet__notes ul {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 6px;
  font-size: 15px;
  line-height: 1.45;
  color: var(--text-secondary);
}

.update-sheet__focus {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding-top: 20px;
}
.update-sheet__focus .update-sheet__title { margin-top: 24px; }
.update-sheet--full .update-sheet__focus {
  flex: 1;
  justify-content: center;
}
.update-sheet__body {
  margin: 10px 0 0;
  max-width: 320px;
  font-size: 16px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.update-sheet__progress { margin-top: 26px; }
.update-sheet__progress-copy {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.update-sheet__note {
  margin: 22px 0 0;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-muted);
}
.update-sheet__note svg { flex-shrink: 0; margin-top: 1px; }
.update-sheet__note--focus { justify-content: center; text-align: left; }

.update-sheet__error { margin: 12px 0 0; }

.update-sheet__actions {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.update-sheet__quiet {
  min-height: 48px;
  border: 0;
  background: transparent;
  color: var(--brand-accent-text);
  font: 600 16px/1.3 'Manrope', sans-serif;
  cursor: pointer;
}
.update-sheet__quiet:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 10px; }
</style>
