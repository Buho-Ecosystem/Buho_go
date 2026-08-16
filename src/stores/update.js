import { defineStore } from 'pinia'
import {
  fetchUpdateManifest,
  isReleaseNewer,
  isReleaseRequired,
  releaseKey,
} from '../services/appUpdate'
import {
  getUpdateRuntime,
  getUpdateManifestUrl,
  isKioskLocked,
  NativeUpdate,
  openUpdateDestination,
  reloadPwa,
} from '../services/updateRuntime'
import { PWA_UPDATE_FLAG } from '../utils/updateEvents'

const STORAGE_KEY = 'buhoGO_update_state_v1'
const CHECK_TTL_MS = 6 * 60 * 60 * 1000
const CHECK_TIMEOUT_MS = 6_000

function readPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      cueShownFor: typeof parsed.cueShownFor === 'string' ? parsed.cueShownFor : '',
      dismissedFor: typeof parsed.dismissedFor === 'string' ? parsed.dismissedFor : '',
      lastCheckedAt: Number.isFinite(parsed.lastCheckedAt) ? parsed.lastCheckedAt : 0,
    }
  } catch {
    return { cueShownFor: '', dismissedFor: '', lastCheckedAt: 0 }
  }
}

function writePreferences(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cueShownFor: state.cueShownFor,
      dismissedFor: state.dismissedFor,
      lastCheckedAt: state.lastCheckedAt,
    }))
  } catch {
    // Storage can be unavailable in private browsing. Update discovery still
    // works for the current session; only cross-launch acknowledgement is lost.
  }
}

const preferences = readPreferences()

export const useUpdateStore = defineStore('appUpdate', {
  state: () => ({
    status: 'idle',
    runtime: null,
    manifest: null,
    release: null,
    currentReleaseKey: '',
    cueShownFor: preferences.cueShownFor,
    dismissedFor: preferences.dismissedFor,
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
    showLogoBadge() {
      return this.hasUpdate
    },
    shouldShowCue() {
      return this.status === 'available'
        && !!this.currentReleaseKey
        && this.cueShownFor !== this.currentReleaseKey
        && this.dismissedFor !== this.currentReleaseKey
    },
    playUpdateDownloaded: state => state.playUpdateStatus === 'downloaded',
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

    async checkForUpdates({ force = false } = {}) {
      if (isKioskLocked()) return { skipped: 'kiosk' }
      if (this.status === 'checking') return { skipped: 'checking' }
      // `manifest` is intentionally session-only. Do not let a persisted
      // timestamp suppress the first check after a process restart.
      if (!force && this.manifest && this.lastCheckedAt && Date.now() - this.lastCheckedAt < CHECK_TTL_MS) {
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
        this.lastCheckedAt = Date.now()
        this.persistPreferences()

        if (runtime.platform === 'web') {
          if (typeof window !== 'undefined' && window[PWA_UPDATE_FLAG]) {
            this.markPwaUpdateReady()
          } else {
            this.status = 'upToDate'
          }
          return { status: this.status }
        }

        this.applyRelease(manifest.channels[runtime.channel])
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
      this.release = manifestRelease || {
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

    markCueShown() {
      if (!this.currentReleaseKey) return
      this.cueShownFor = this.currentReleaseKey
      this.persistPreferences()
    },

    openSheet() {
      if (!this.hasUpdate) return
      this.actionError = ''
      this.sheetOpen = true
    },

    dismissSheet() {
      if (this.isRequired && !this.requiredRecoveryAccess) return
      if (this.currentReleaseKey) this.dismissedFor = this.currentReleaseKey
      this.sheetOpen = false
      this.persistPreferences()
    },

    async allowRecoveryAccess(router) {
      this.requiredRecoveryAccess = true
      this.sheetOpen = false
      await router.push({ path: '/settings', query: { section: 'backup' } })
    },

    async performUpdate() {
      if (!this.release || this.actionPending) return false
      this.actionPending = true
      this.actionError = ''
      try {
        if (this.release.channel === 'web') {
          if (!this.pwaReloadReady) throw new Error('The new web version is still preparing')
          reloadPwa()
          return true
        }

        if (this.runtime?.platform === 'android' && this.release.channel === 'play') {
          try {
            const result = await NativeUpdate.startPlayUpdate({ immediate: this.isRequired })
            if (result?.started) {
              if (!this.isRequired) this.sheetOpen = false
              return true
            }
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
