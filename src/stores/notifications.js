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
 *
 * `enabled` is the master switch. Under it each kind has its own switch,
 * `paymentsEnabled` (money received) and `messagesEnabled` (the contact chat:
 * requests and messages). They only narrow the master switch (see
 * `canNotifyPayments`, `canNotifyMessages`): either can be silenced while the
 * other keeps coming, but neither gets through while notifications as a whole
 * are off or not permitted.
 */

const STORAGE_KEY = 'buhoGO_notifications'

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    /** The user's switch inside the app: notifications at all. */
    enabled: false,
    /**
     * The user's switch for received payments, on top of `enabled`. On by
     * default: turning notifications on means payments too until they say
     * otherwise.
     */
    paymentsEnabled: true,
    /** The same for the contact chat (requests and messages). */
    messagesEnabled: true,
    /** 'granted' | 'denied' | 'prompt' | 'unsupported' — the OS's answer. */
    permission: 'prompt',
    /** Have we already shown the system dialog once (wizard or settings)? */
    prompted: false,
    initialized: false,
  }),

  getters: {
    /** Is this even a place where notifications exist? */
    supported: () => isSupported(),

    /** Notifications at all: the master switch and the OS permission. */
    canNotify: (state) => isSupported() && state.enabled && state.permission === 'granted',

    /** The question for a received payment: `canNotify` and the payments switch. */
    canNotifyPayments() {
      return this.canNotify && this.paymentsEnabled
    },

    /** The same for a chat request or message, with the chat's switch. */
    canNotifyMessages() {
      return this.canNotify && this.messagesEnabled
    },

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
        // Saved before a kind had its own switch there is no such field:
        // that means "on", the default. Only an explicit `false` is the
        // user's answer.
        this.paymentsEnabled = parsed?.paymentsEnabled !== false
        this.messagesEnabled = parsed?.messagesEnabled !== false
      } catch {
        // A fresh, quiet default is the right fallback.
        this.enabled = false
        this.prompted = false
        this.paymentsEnabled = true
        this.messagesEnabled = true
      }
      this.initialized = true
      await this.syncPermission()
    },

    persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          enabled: this.enabled,
          prompted: this.prompted,
          paymentsEnabled: this.paymentsEnabled,
          messagesEnabled: this.messagesEnabled,
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
     * The payments switch in Settings. The master switch and the OS
     * permission are left alone; this only decides whether received payments
     * are announced once those allow notifications at all.
     */
    setPaymentsEnabled(value) {
      this.paymentsEnabled = Boolean(value)
      this.persist()
    },

    /** The same for the contact chat's requests and messages. */
    setMessagesEnabled(value) {
      this.messagesEnabled = Boolean(value)
      this.persist()
    },

    /**
     * Post a notification if the user asked for them. Copy comes in already
     * translated — this store decides *whether*, never *what*.
     *
     * The message goes to `notify` as it is, so every option the service
     * knows (`force`, `channel`, `channelName`, `id`, `group`, `route`) works
     * from here. `force` posts even while the app is visible; the receipt
     * ledger uses it for a payment that settled while the app was hidden and
     * was only caught up after the user returned (services/paymentReceipts.js).
     *
     * Payments come through here, so the payments switch applies. A chat
     * message goes through `notifyMessageIfEnabled` instead.
     */
    async notifyIfEnabled(message) {
      if (!this.canNotifyPayments) return false
      return notify(message)
    },

    /**
     * The same for a chat message: posted only when notifications are on and
     * the chat's own switch is on, always on the `messages` channel. Pass the
     * channel's translated name as `channelName`, and for one entry per chat
     * an `id` from `stableNotificationId` with a `group` and a `route`.
     */
    async notifyMessageIfEnabled(message) {
      if (!this.canNotifyMessages) return false
      return notify({ ...message, channel: 'messages' })
    },
  },
})
