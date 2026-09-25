import { defineStore } from 'pinia'
import {
  isNativeApp,
  isSupported,
  notify,
  permissionState,
  requestPermission,
} from '../services/paymentNotifications.js'

/**
 * Whether BuhoGO may tell the user money arrived while they were elsewhere.
 *
 * Two facts, deliberately kept apart:
 *   - `permission` is the OS's answer, which only the OS can change. We read
 *     it, we never cache it as truth for longer than a session.
 *   - `enabled` is the user's answer inside the app. It exists so the Settings
 *     toggle can turn notifications off without sending anyone into system
 *     settings, and so a granted permission does not silently mean "on".
 *
 * Both exist wherever BuhoGO runs: the plugin posts through the browser's own
 * Notification API on the web, so the Settings row is offered there too. Only
 * the setup wizard's slide is app-only (`canAskInSetup`).
 *
 * `prompted` remembers that we already asked in the wizard, because the system
 * dialog is a one-shot on Android: asking again does nothing, and asking a
 * second time in our own UI would be nagging.
 */

const STORAGE_KEY = 'buhoGO_notifications'

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    /** The user's switch inside the app. */
    enabled: false,
    /** 'granted' | 'denied' | 'prompt' | 'unsupported' — the OS's answer. */
    permission: 'prompt',
    /** Have we already shown the system dialog once (wizard or settings)? */
    prompted: false,
    initialized: false,
  }),

  getters: {
    /** Is this even a place where notifications exist? */
    supported: () => isSupported(),

    /** The only question the rest of the app asks. */
    canNotify: (state) => isSupported() && state.enabled && state.permission === 'granted',

    /**
     * Is the question still open — somewhere we can post, not asked before,
     * and the OS has not already decided for us? The Settings row uses this
     * shape of reasoning wherever the app runs, browser included.
     */
    canAsk: (state) => isSupported() && !state.prompted && state.permission === 'prompt',

    /**
     * Same question, for the setup wizard's slide only. Native-only on
     * purpose: a first-run tour is where an installed app earns the OS dialog,
     * while on the web the Settings row is the way in (and a browser
     * permission prompt during onboarding is exactly the kind of thing people
     * dismiss on reflex).
     */
    canAskInSetup() {
      return isNativeApp() && this.canAsk
    },
  },

  actions: {
    async initialize() {
      if (this.initialized) return
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        const parsed = saved ? JSON.parse(saved) : null
        this.enabled = parsed?.enabled === true
        this.prompted = parsed?.prompted === true
      } catch {
        // A fresh, quiet default is the right fallback.
        this.enabled = false
        this.prompted = false
      }
      this.initialized = true
      await this.syncPermission()
    },

    persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          enabled: this.enabled,
          prompted: this.prompted,
        }))
      } catch (error) {
        console.warn('[notifications] could not persist:', error)
      }
    },

    /**
     * Re-read the OS answer. Called on load, whenever the app comes back to
     * the front, and when Settings opens — the user may have changed it in
     * system settings while they were away.
     *
     * It updates the OS side ONLY. `enabled` is the user's own answer and
     * survives a revoke untouched: `canNotify` already gates on the
     * permission, so silently flipping it here would buy nothing and would
     * lose the user's choice — re-granting in system settings would come back
     * to a switch that says OFF, which they never turned off.
     */
    async syncPermission() {
      this.permission = await permissionState()
      return this.permission
    },

    /**
     * Turn notifications on: our explanation has already been read, so this
     * goes straight to the system dialog. A denial is an answer, not an error
     * — nothing else in the app changes because of it.
     *
     * @returns {Promise<boolean>} whether notifications are on afterwards
     */
    async enable() {
      if (!isSupported()) return false
      this.prompted = true
      const state = this.permission === 'granted' ? 'granted' : await requestPermission()
      this.permission = state
      this.enabled = state === 'granted'
      this.persist()
      return this.enabled
    },

    /** Turn them off in the app. The OS permission is left alone. */
    disable() {
      this.enabled = false
      this.persist()
    },

    /** The wizard's "not now": don't ask again on its own. */
    declineForNow() {
      this.prompted = true
      this.persist()
    },

    /**
     * Post a notification if the user asked for them. Copy comes in already
     * translated — this store decides *whether*, never *what*.
     */
    async notifyIfEnabled({ title, body }) {
      if (!this.canNotify) return false
      return notify({ title, body })
    },
  },
})
