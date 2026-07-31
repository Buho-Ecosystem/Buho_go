/**
 * Learn & Earn Store
 *
 * Tracks quiz progress, manages sat rewards, and handles payouts.
 * 1 sat per correct answer. Complete all lessons to get earnings doubled.
 *
 * Claiming is fluid: once the pending balance reaches 25 sats the player
 * withdraws all of it, so 28 earned sats pay out as 28. Nothing is floored
 * to a step and no sats are left stranded behind a threshold.
 *
 * Payouts go through the buhogo-earn-api service: the app creates an
 * invoice on the user's wallet and posts it to the claim endpoint, which
 * holds the funding-wallet key and enforces all limits server-side
 * (cooldown, lifetime cap, per-IP and daily budgets). The local cooldown
 * check below is fast UX feedback only; the server is the enforcement
 * point. Client-side heuristics are deliberately never used to refuse a
 * claim: a real farmer posts to the endpoint directly and never runs this
 * code, so such a check can only ever misfire on a genuine player.
 */

import { defineStore } from 'pinia'
import { Capacitor } from '@capacitor/core'
import { i18n } from '../boot/i18n'
import quizEnUS from '../data/earn-quizzes.en-US.json'
import quizDe from '../data/earn-quizzes.de.json'
import quizEs from '../data/earn-quizzes.es.json'
import { findEarnPayoutWallet } from '../utils/earnWallets'
import { earnPayoutMemo } from '../services/earnBrand'

// Locale-keyed quiz content. Structure (IDs, illustrations, ordering) is
// identical across files; only user-facing strings differ. Resolved each
// time `quizData()` is called so language switches at runtime show the
// new content immediately. Reading `i18n.global.locale.value` inside a
// Pinia getter also wires reactive tracking, so any UI that depends on
// `groups`, `totalQuestions`, etc. re-renders on locale change.
const QUIZ_LOCALES = {
  'en-US': quizEnUS,
  'de': quizDe,
  'es': quizEs,
}

function quizData() {
  // vue-i18n v9 exposes `locale` as a Ref in both legacy and composition
  // modes — read `.value` when present, fall back to the raw value (older
  // legacy builds) or DEFAULT_LOCALE if both miss.
  const loc = i18n?.global?.locale
  const code = (loc && typeof loc === 'object' && 'value' in loc) ? loc.value : loc
  return QUIZ_LOCALES[code] || QUIZ_LOCALES['en-US']
}

const STORAGE_KEY = 'buhoGO_earn_progress'
const PAYOUT_THRESHOLD = 25
const CLAIM_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes

// Payout service (holds the funding-wallet key, enforces claim rules)
const EARN_API_URL = 'https://buhogo-earn-api.netlify.app'
const DEVICE_ID_KEY = 'buhoGO_earn_device_id'

/**
 * Stable per-install identifier for the payout service's rate limiting.
 * Self-issued and therefore spoofable; the server combines it with the
 * client IP and global budgets, so it only needs to be honest-user stable.
 */
function earnDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = (globalThis.crypto?.randomUUID?.()) ||
      `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

export const useEarnStore = defineStore('earn', {
  state: () => ({
    completedQuestions: [],
    selectedWalletId: null,
    pendingSats: 0,
    totalEarned: 0,
    bonusPaid: false,
    lastPayoutAt: null,
  }),

  getters: {
    groups: () => quizData().groups,

    totalQuestions: () => {
      return quizData().groups.reduce((sum, g) =>
        sum + g.chapters.reduce((s, c) => s + c.questions.length, 0), 0)
    },

    totalCompleted(state) {
      return state.completedQuestions.length
    },

    overallProgress() {
      if (this.totalQuestions === 0) return 0
      return Math.round((this.totalCompleted / this.totalQuestions) * 100)
    },

    allCompleted() {
      return this.totalCompleted >= this.totalQuestions && this.totalQuestions > 0
    },

    isQuestionCompleted: (state) => (questionId) => {
      return state.completedQuestions.includes(questionId)
    },

    groupProgress: (state) => (groupId) => {
      const group = quizData().groups.find(g => g.id === groupId)
      if (!group) return { completed: 0, total: 0, percentage: 0 }
      const total = group.chapters.reduce((s, c) => s + c.questions.length, 0)
      const completed = group.chapters.reduce((s, c) =>
        s + c.questions.filter(q => state.completedQuestions.includes(q.id)).length, 0)
      return { completed, total, percentage: total > 0 ? Math.round((completed / total) * 100) : 0 }
    },

    isGroupUnlocked: (state) => (groupId) => {
      const groupIndex = quizData().groups.findIndex(g => g.id === groupId)
      if (groupIndex <= 0) return true
      const prevGroup = quizData().groups[groupIndex - 1]
      const prevTotal = prevGroup.chapters.reduce((s, c) => s + c.questions.length, 0)
      const prevCompleted = prevGroup.chapters.reduce((s, c) =>
        s + c.questions.filter(q => state.completedQuestions.includes(q.id)).length, 0)
      return prevCompleted >= prevTotal
    },

    chapterProgress: (state) => (chapterId) => {
      for (const group of quizData().groups) {
        const chapter = group.chapters.find(c => c.id === chapterId)
        if (chapter) {
          const total = chapter.questions.length
          const completed = chapter.questions.filter(q =>
            state.completedQuestions.includes(q.id)).length
          return { completed, total, percentage: total > 0 ? Math.round((completed / total) * 100) : 0 }
        }
      }
      return { completed: 0, total: 0, percentage: 0 }
    },

    isChapterComplete: (state) => (chapterId) => {
      for (const group of quizData().groups) {
        const chapter = group.chapters.find(c => c.id === chapterId)
        if (chapter) {
          return chapter.questions.every(q => state.completedQuestions.includes(q.id))
        }
      }
      return false
    },

    nextQuestionInChapter: (state) => (chapterId) => {
      for (const group of quizData().groups) {
        const chapter = group.chapters.find(c => c.id === chapterId)
        if (chapter) {
          return chapter.questions.find(q => !state.completedQuestions.includes(q.id)) || null
        }
      }
      return null
    },

    /** Minimum pending balance before a claim is allowed. */
    payoutThreshold: () => PAYOUT_THRESHOLD,

    canClaim(state) {
      return state.pendingSats >= PAYOUT_THRESHOLD
    },

    /**
     * The whole pending balance, not a multiple of the threshold: the
     * threshold gates *when* you can claim, never *how much*.
     */
    claimableAmount(state) {
      return state.pendingSats >= PAYOUT_THRESHOLD ? state.pendingSats : 0
    },

    /**
     * Completion bonus doubles all earned sats.
     */
    completionBonus(state) {
      return state.totalEarned + state.pendingSats
    },

    /**
     * Time remaining before next claim is allowed (in ms). 0 = can claim now.
     */
    claimCooldownRemaining(state) {
      if (!state.lastPayoutAt) return 0
      const elapsed = Date.now() - state.lastPayoutAt
      return Math.max(0, CLAIM_COOLDOWN_MS - elapsed)
    },

    isOnCooldown() {
      return this.claimCooldownRemaining > 0
    },

  },

  actions: {
    async initialize() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          const parsed = JSON.parse(saved)
          this.completedQuestions = parsed.completedQuestions || []
          this.selectedWalletId = parsed.selectedWalletId || null
          this.pendingSats = parsed.pendingSats || 0
          this.totalEarned = parsed.totalEarned || 0
          this.bonusPaid = parsed.bonusPaid || false
          this.lastPayoutAt = parsed.lastPayoutAt || null
          // parsed.answerTimings (retired anti-cheat sampling) is ignored and
          // drops out of storage on the next persist().
        }
      } catch (e) {
        console.warn('[earn] Failed to load progress:', e)
      }
    },

    persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          completedQuestions: this.completedQuestions,
          selectedWalletId: this.selectedWalletId,
          pendingSats: this.pendingSats,
          totalEarned: this.totalEarned,
          bonusPaid: this.bonusPaid,
          lastPayoutAt: this.lastPayoutAt,
        }))
      } catch (e) {
        console.warn('[earn] Failed to save progress:', e)
      }
    },

    /**
     * Mark a question as correctly answered.
     */
    markQuestionComplete(questionId) {
      if (this.completedQuestions.includes(questionId)) return { alreadyDone: true }

      this.completedQuestions.push(questionId)
      this.pendingSats += 1
      this.totalEarned += 1
      this.persist()

      return {
        alreadyDone: false,
        satsEarned: 1,
        pendingSats: this.pendingSats,
        totalEarned: this.totalEarned,
        allCompleted: this.allCompleted,
      }
    },

    /**
     * Claim the whole pending balance once it has reached 25 sats.
     * Checks the local cooldown before processing.
     */
    async claimPayout() {
      const claimable = this.claimableAmount
      if (claimable <= 0) return { amount: 0, success: false, error: 'nothing_to_claim' }

      // Rate limit check
      if (this.isOnCooldown) {
        const mins = Math.ceil(this.claimCooldownRemaining / 60000)
        return { amount: 0, success: false, error: 'cooldown', minutesLeft: mins }
      }

      try {
        const result = await this._requestPayout('claim', claimable)
        if (!result.success) return { amount: 0, ...result }

        this.pendingSats -= claimable
        this.lastPayoutAt = Date.now()
        this.persist()

        return { amount: claimable, success: true }
      } catch (error) {
        console.error('[earn] Payout failed:', error.message)
        // Keep the original (coded) error so the UI can show the real,
        // translated reason instead of a generic "payout_failed".
        return { amount: 0, success: false, error: 'payout_failed', message: error.message, cause: error }
      }
    },

    /**
     * Request a payout from the earn API: create an invoice on the user's
     * wallet, send it to the claim endpoint, and map the response onto the
     * store's result shape. The server pays the invoice from the funding
     * wallet only if all its limits pass.
     */
    async _requestPayout(kind, amountSats) {
      // Learn & Earn is native-only. The router guard (router/routes.js) keeps
      // the earn flow off the web build entirely, but this is the money exit —
      // the single call that actually moves sats — so we lock it here too.
      // That closes the tampering a route guard can't: faking pendingSats in
      // localStorage or invoking a payout straight from the console. Web builds
      // simply cannot drain the reward wallet.
      if (!Capacitor.isNativePlatform()) {
        throw new Error('Learn & Earn payouts are only available in the native app')
      }

      const { invoice } = await this._createUserInvoice(amountSats, kind)
      if (!invoice) throw new Error('Failed to create invoice')

      const response = await fetch(`${EARN_API_URL}/api/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: earnDeviceId(),
          kind,
          amount: amountSats,
          invoice,
        }),
      })

      let data = null
      try {
        data = await response.json()
      } catch {
        // Non-JSON body (gateway error page); fall through to payout_failed.
      }

      if (response.ok && data?.ok) {
        // The payment hash is shared by payer and payee, so it is the durable
        // key the tx list uses to brand this reward (see services/earnBrand.js).
        return { success: true, paymentHash: data.paymentHash || null }
      }

      const result = { success: false, error: data?.error || 'payout_failed' }
      if (data?.minutesLeft) result.minutesLeft = data.minutesLeft
      return result
    },

    /**
     * Create an invoice on the user's selected wallet.
     *
     * `walletStore.providers` is a runtime-only map populated only for
     * currently-connected Spark/LNbits wallets — and never for NWC wallets,
     * which live in `connectionStates[id].nwcInstance`. The earn-selected
     * wallet id is persisted across sessions, so by the time a payout or bonus
     * is claimed the wallet is frequently not live (app restart, a different
     * active wallet, or a locked Spark wallet). Reading `providers[id]`
     * directly therefore failed for every NWC user and for anyone claiming in
     * a later session, surfacing as `payout_failed`.
     *
     * Mirror the proven internal-transfer path: ensure a connected provider
     * via `ensureWalletConnectedForTransfer`, then branch on wallet type —
     * NWC exposes the WebLN `makeInvoice`, Spark/LNbits use `createInvoice`.
     */
    async _createUserInvoice(amountSats, kind) {
      const { useWalletStore } = await import('./wallet')
      const walletStore = useWalletStore()

      // The selected id is persisted, so it may point to a deleted wallet or
      // a formerly permitted Arkade wallet. Do not substitute another wallet:
      // a payout destination is a user decision, not a best-effort fallback.
      const wallet = findEarnPayoutWallet(walletStore.wallets, this.selectedWalletId)
      if (!wallet) {
        const err = new Error('Choose a Spark, LNbits, or NWC wallet for Learn & Earn rewards.')
        err.code = 'EARN_PAYOUT_WALLET_REQUIRED'
        throw err
      }

      return {
        invoice: await this._invoiceFromWallet(walletStore, wallet.id, wallet, amountSats, kind),
        wallet,
      }
    },

    /**
     * Create a Lightning invoice on one supported wallet. NWC exposes the
     * WebLN `makeInvoice`; Spark and LNbits use `createInvoice`.
     */
    async _invoiceFromWallet(walletStore, walletId, wallet, amountSats, kind) {
      const provider = await walletStore.ensureWalletConnectedForTransfer(walletId)
      if (!provider) throw new Error('Wallet not connected')

      const memo = earnPayoutMemo(kind)
      const type = (wallet.type || 'nwc').toLowerCase()
      if (type === 'spark' || type === 'lnbits') {
        const result = await provider.createInvoice({
          amount: amountSats,
          description: memo,
        })
        return result.paymentRequest || result.payment_request || result.bolt11 || result
      }

      // NWC wallets use the WebLN interface; makeInvoice expects sats.
      const result = await provider.makeInvoice({
        amount: amountSats,
        description: memo,
      })
      return result.invoice || result.paymentRequest || result.bolt11
    },

    /**
     * Execute the completion bonus: double all earnings.
     *
     * "Doubling" means the user should ultimately receive 2x what they earned
     * from answering (`totalEarned`). They may have already withdrawn part of
     * it via `claimPayout`; that withdrawn portion is `totalEarned - pendingSats`.
     * So this single payout settles the remaining unclaimed sats (`pendingSats`)
     * plus a matching bonus equal to `totalEarned`:
     *
     *   payout = pendingSats + totalEarned
     *
     * which brings the lifetime amount received to exactly 2 x totalEarned.
     * (The previous formula `totalEarned + 2 x pendingSats` over-paid anyone
     * who had not claimed along the way.)
     */
    async executeCompletionBonus() {
      if (this.bonusPaid) return { amount: 0, alreadyPaid: true }

      // No cooldown check here, unlike claimPayout: the bonus is exempt on the
      // server too (RULES.cooldownExemptKinds). It can only ever be paid once
      // per device, so rate limiting it protects nothing and would just make a
      // player who has finished the whole quiz wait half an hour for the
      // reward for finishing.
      const baseEarned = this.totalEarned         // lifetime sats earned from answers
      const bonus = baseEarned                     // the doubling match
      const totalPayout = this.pendingSats + bonus // settle unclaimed + bonus

      try {
        const result = await this._requestPayout('bonus', totalPayout)
        if (!result.success) return { amount: 0, ...result }

        this.totalEarned = baseEarned * 2
        this.pendingSats = 0
        this.bonusPaid = true
        this.lastPayoutAt = Date.now()
        this.persist()

        return { amount: totalPayout, bonus, totalPayout, totalEarned: this.totalEarned, success: true }
      } catch (error) {
        console.error('[earn] Bonus payout failed:', error.message)
        // Keep the original (coded) error so the UI can show the real,
        // translated reason instead of a generic "payout_failed".
        return { amount: 0, success: false, error: 'payout_failed', message: error.message, cause: error }
      }
    },

    setSelectedWallet(walletId) {
      this.selectedWalletId = walletId
      this.persist()
    },

    resetProgress() {
      this.completedQuestions = []
      this.pendingSats = 0
      this.totalEarned = 0
      this.bonusPaid = false
      this.lastPayoutAt = null
      this.persist()
    },

    getQuestion(questionId) {
      for (const group of quizData().groups) {
        for (const chapter of group.chapters) {
          const q = chapter.questions.find(q => q.id === questionId)
          if (q) return q
        }
      }
      return null
    },

    getGroupForChapter(chapterId) {
      return quizData().groups.find(g => g.chapters.some(c => c.id === chapterId)) || null
    },

    getChapter(chapterId) {
      for (const group of quizData().groups) {
        const chapter = group.chapters.find(c => c.id === chapterId)
        if (chapter) return chapter
      }
      return null
    },
  }
})
