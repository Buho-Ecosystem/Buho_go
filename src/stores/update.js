import { defineStore } from 'pinia'
import {
  fetchUpdateManifest,
  isReleaseNewer,
  isReleaseRequired,
  releaseKey,
  updateStage,
} from '../services/appUpdate'
import {
  findWebUpdate,
  getUpdateRuntime,
  getUpdateManifestUrl,
  isKioskLocked,
  NativeUpdate,
  openUpdateDestination,
} from '../services/updateRuntime'
import { reloadPwa } from '../services/pwaReload'
import { PWA_UPDATE_FLAG } from '../utils/updateEvents'

const STORAGE_KEY = 'buhoGO_update_state_v1'
const CHECK_TTL_MS = 6 * 60 * 60 * 1000
const CHECK_TIMEOUT_MS = 6_000

function readPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { lastCheckedAt: Number.isFinite(parsed.lastCheckedAt) ? parsed.lastCheckedAt : 0 }
  } catch {
    return { lastCheckedAt: 0 }
  }
}

function writePreferences(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lastCheckedAt: state.lastCheckedAt }))
  } catch {
    // Storage can be unavailable in private browsing. Update discovery still
    // works for the current session; only cross-launch acknowledgement is lost.
  }
}

const preferences = readPreferences()

/** The check under way, shared by everyone who asks while it runs. */
let pendingCheck = null

export const useUpdateStore = defineStore('appUpdate', {
  state: () => ({
    status: 'idle',
    runtime: null,
    manifest: null,
    release: null,
    currentReleaseKey: '',
    lastCheckedAt: preferences.lastCheckedAt,
    lastError: '',
    actionError: '',
    sheetOpen: false,
    actionPending: false,
    pwaReloadReady: false,
    requiredRecoveryAccess: false,
    nativeListenerReady: false,
    playUpdateStatus: '',
    playBytesDownloaded: 0,
    playTotalBytes: 0,
  }),

  getters: {
    hasUpdate: state => state.status === 'available' || state.status === 'required',
    isRequired: state => state.status === 'required',
    /**
     * The part of the update flow to show (`updateStage`); null when there is
     * nothing to show. The app marks the logo and the menu while it is set.
     */
    stage: state => updateStage(state),
    playDownloadProgress: state => {
      if (!state.playTotalBytes) return 0
      return Math.min(1, state.playBytesDownloaded / state.playTotalBytes)
    },
  },

  actions: {
    persistPreferences() {
      writePreferences(this)
    },

    applyPlayUpdateState(event = {}) {
      this.playUpdateStatus = String(event.status || '')
      this.playBytesDownloaded = Number(event.bytesDownloaded) || 0
      this.playTotalBytes = Number(event.totalBytes) || 0
    },

    async initializeNativeListener() {
      if (this.nativeListenerReady || this.runtime?.platform !== 'android') return
      this.nativeListenerReady = true
      try {
        await NativeUpdate.addListener('playUpdateState', event => this.applyPlayUpdateState(event))
        // Recover a flexible update that finished downloading while BuhoGO
        // was backgrounded or terminated; the listener alone cannot replay it.
        this.applyPlayUpdateState(await NativeUpdate.getPlayUpdateInfo())
      } catch {
        // Builds predating the bridge still use the safe store-page fallback.
      }
    },

    /**
     * Look for a newer release. A check already under way answers this caller
     * too, so a version tap during the startup check gets that check's result.
     */
    checkForUpdates({ force = false } = {}) {
      if (isKioskLocked()) return Promise.resolve({ skipped: 'kiosk' })
      pendingCheck ??= this.runCheck(force).finally(() => { pendingCheck = null })
      return pendingCheck
    },

    async runCheck(force) {
      // `manifest` is intentionally session-only. Do not let a persisted
      // timestamp suppress the first check after a process restart, and let a
      // failed check try again.
      const fresh = this.manifest && this.status !== 'error' && Date.now() - this.lastCheckedAt < CHECK_TTL_MS
      if (!force && fresh) {
        if (typeof window !== 'undefined' && window[PWA_UPDATE_FLAG]) this.markPwaUpdateReady()
        return { skipped: 'fresh' }
      }

      const previousStatus = this.status
      const previousRelease = this.release
      this.status = 'checking'
      this.lastError = ''
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

      try {
        const runtimePromise = getUpdateRuntime().then(runtime => {
          this.runtime = runtime
          // Native update recovery should not depend on the manifest request
          // succeeding (for example, a Play download may finish while offline).
          void this.initializeNativeListener()
          return runtime
        })
        const [runtime, manifest] = await Promise.all([
          runtimePromise,
          fetchUpdateManifest({ url: getUpdateManifestUrl(), signal: controller.signal }),
        ])
        this.manifest = manifest

        if (runtime.platform === 'web') {
          // The manifest only describes a web release; the service worker is
          // what knows whether a newer deployment is actually ready.
          if (window[PWA_UPDATE_FLAG] || await findWebUpdate()) {
            window[PWA_UPDATE_FLAG] = true
            this.markPwaUpdateReady()
          } else {
            this.status = 'upToDate'
          }
        } else {
          this.applyRelease(manifest.channels[runtime.channel])
        }
        this.lastCheckedAt = Date.now()
        this.persistPreferences()
        return { status: this.status }
      } catch (error) {
        // A remote check must never delay or block wallet access. Preserve a
        // previously known update, otherwise quietly report an internal error.
        if (previousRelease && ['available', 'required'].includes(previousStatus)) {
          this.status = previousStatus
        } else {
          this.status = 'error'
        }
        this.lastError = error?.name === 'AbortError'
          ? 'Update check timed out'
          : (error?.message || 'Update check failed')
        return { status: this.status, error: this.lastError }
      } finally {
        clearTimeout(timer)
      }
    },

    applyRelease(release) {
      if (!release?.enabled || !isReleaseNewer(this.runtime, release)) {
        this.status = 'upToDate'
        this.release = null
        this.currentReleaseKey = ''
        this.sheetOpen = false
        return
      }

      this.release = release
      this.currentReleaseKey = releaseKey(release)
      this.status = isReleaseRequired(this.runtime, release) ? 'required' : 'available'
      this.requiredRecoveryAccess = false
    },

    markPwaUpdateReady() {
      this.pwaReloadReady = true
      const manifestRelease = this.manifest?.channels?.web
      // A redeploy of the same version is still an update, but the sheet only
      // names a version (and its notes) when it is newer than this one.
      const named = manifestRelease && this.runtime && isReleaseNewer(this.runtime, manifestRelease)
      this.release = named ? manifestRelease : {
        channel: 'web',
        enabled: true,
        version: null,
        build: null,
        minimumBuild: null,
        url: null,
        notes: {},
      }
      this.currentReleaseKey = releaseKey(this.release)
      this.status = 'available'
    },

    openSheet() {
      if (!this.stage) return
      this.actionError = ''
      this.sheetOpen = true
    },

    dismissSheet() {
      if (this.isRequired && !this.requiredRecoveryAccess) return
      this.sheetOpen = false
    },

    async allowRecoveryAccess(router) {
      this.requiredRecoveryAccess = true
      this.sheetOpen = false
      await router.push('/security')
    },

    async performUpdate() {
      if (!this.release || this.actionPending) return false
      this.actionPending = true
      this.actionError = ''
      try {
        if (this.release.channel === 'web') {
          if (!this.pwaReloadReady) throw new Error('The new web version is still preparing')
          // Resolves once the waiting worker has taken over (or a fallback
          // reload fired), so the button stays busy for the whole switch.
          await reloadPwa()
          return true
        }

        if (this.runtime?.platform === 'android' && this.release.channel === 'play') {
          try {
            const result = await NativeUpdate.startPlayUpdate({ immediate: this.isRequired })
            // The sheet stays open: Play reports the download into it
            // (stage 'downloading', then 'ready').
            if (result?.started) return true
          } catch {
            // A Play API failure (non-Play install, staged rollout, old bridge)
            // falls back to the verified HTTPS Play listing below.
          }
        }

        await openUpdateDestination(this.release.url)
        if (!this.isRequired) this.sheetOpen = false
        return true
      } catch (error) {
        this.actionError = error?.message || 'Could not open the update'
        return false
      } finally {
        this.actionPending = false
      }
    },

    async completePlayUpdate() {
      this.actionError = ''
      try {
        await NativeUpdate.completePlayUpdate()
      } catch (error) {
        this.actionError = error?.message || 'Could not finish the update'
      }
    },
  },
})
