/**
 * Learn & Earn Store
 *
 * Tracks quiz progress, manages sat rewards, and handles payouts.
 * 1 sat per correct answer. Claimable every 25 sats.
 * Complete all lessons to get earnings doubled.
 *
 * Anti-abuse:
 *   - Rate limit: 1 claim per 30 minutes
 *   - Answer timing: average < 3 seconds = blocked
 */

import { defineStore } from 'pinia'
import quizData from '../data/earn-quizzes.json'

const STORAGE_KEY = 'buhoGO_earn_progress'
const PAYOUT_THRESHOLD = 25
const CLAIM_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes
const MIN_AVG_ANSWER_TIME_MS = 3000 // 3 seconds

// LNbits funding config
const LNBITS_URL = 'https://lnbits.de'
const LNBITS_API_KEY = 'e823f6517cae4fe2aefc0a03d928ddc9'

export const useEarnStore = defineStore('earn', {
  state: () => ({
    completedQuestions: [],
    selectedWalletId: null,
    pendingSats: 0,
    totalEarned: 0,
    bonusPaid: false,
    lastPayoutAt: null,
    // Answer timing tracking (questionId → timestamp when question was opened)
    answerTimings: [],
  }),

  getters: {
    groups: () => quizData.groups,

    totalQuestions: () => {
      return quizData.groups.reduce((sum, g) =>
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
      const group = quizData.groups.find(g => g.id === groupId)
      if (!group) return { completed: 0, total: 0, percentage: 0 }
      const total = group.chapters.reduce((s, c) => s + c.questions.length, 0)
      const completed = group.chapters.reduce((s, c) =>
        s + c.questions.filter(q => state.completedQuestions.includes(q.id)).length, 0)
      return { completed, total, percentage: total > 0 ? Math.round((completed / total) * 100) : 0 }
    },

    isGroupUnlocked: (state) => (groupId) => {
      const groupIndex = quizData.groups.findIndex(g => g.id === groupId)
      if (groupIndex <= 0) return true
      const prevGroup = quizData.groups[groupIndex - 1]
      const prevTotal = prevGroup.chapters.reduce((s, c) => s + c.questions.length, 0)
      const prevCompleted = prevGroup.chapters.reduce((s, c) =>
        s + c.questions.filter(q => state.completedQuestions.includes(q.id)).length, 0)
      return prevCompleted >= prevTotal
    },

    chapterProgress: (state) => (chapterId) => {
      for (const group of quizData.groups) {
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
      for (const group of quizData.groups) {
        const chapter = group.chapters.find(c => c.id === chapterId)
        if (chapter) {
          return chapter.questions.every(q => state.completedQuestions.includes(q.id))
        }
      }
      return false
    },

    nextQuestionInChapter: (state) => (chapterId) => {
      for (const group of quizData.groups) {
        const chapter = group.chapters.find(c => c.id === chapterId)
        if (chapter) {
          return chapter.questions.find(q => !state.completedQuestions.includes(q.id)) || null
        }
      }
      return null
    },

    canClaim(state) {
      return state.pendingSats >= PAYOUT_THRESHOLD
    },

    claimableAmount(state) {
      return Math.floor(state.pendingSats / PAYOUT_THRESHOLD) * PAYOUT_THRESHOLD
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

    /**
     * Average answer time in ms for recent answers (since last claim).
     */
    averageAnswerTime(state) {
      if (state.answerTimings.length === 0) return Infinity
      const total = state.answerTimings.reduce((sum, t) => sum + t, 0)
      return total / state.answerTimings.length
    },

    isSuspiciousTiming() {
      return this.answerTimings.length >= 5 && this.averageAnswerTime < MIN_AVG_ANSWER_TIME_MS
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
          this.answerTimings = parsed.answerTimings || []
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
          answerTimings: this.answerTimings,
        }))
      } catch (e) {
        console.warn('[earn] Failed to save progress:', e)
      }
    },

    /**
     * Record when a question is opened (for timing tracking).
     */
    startQuestionTimer() {
      this._questionOpenedAt = Date.now()
    },

    /**
     * Mark a question as correctly answered. Tracks answer timing.
     */
    markQuestionComplete(questionId) {
      if (this.completedQuestions.includes(questionId)) return { alreadyDone: true }

      // Record answer timing
      if (this._questionOpenedAt) {
        const elapsed = Date.now() - this._questionOpenedAt
        this.answerTimings.push(elapsed)
        // Keep only timings since last claim (max 50 entries)
        if (this.answerTimings.length > 50) {
          this.answerTimings = this.answerTimings.slice(-50)
        }
        this._questionOpenedAt = null
      }

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
     * Claim accumulated sats in multiples of 25.
     * Checks rate limit and answer timing before processing.
     */
    async claimPayout() {
      const claimable = this.claimableAmount
      if (claimable <= 0) return { amount: 0, success: false, error: 'nothing_to_claim' }

      // Rate limit check
      if (this.isOnCooldown) {
        const mins = Math.ceil(this.claimCooldownRemaining / 60000)
        return { amount: 0, success: false, error: 'cooldown', minutesLeft: mins }
      }

      // Suspicious timing check
      if (this.isSuspiciousTiming) {
        return { amount: 0, success: false, error: 'suspicious_timing' }
      }

      try {
        // Create LNURL-withdraw on LNbits
        const withdrawLink = await this._createWithdrawLink(claimable)
        if (!withdrawLink) throw new Error('Failed to create withdraw link')

        // Get the LNURL-withdraw details
        const withdrawInfo = await this._fetchWithdrawInfo(withdrawLink.lnurl)
        if (!withdrawInfo) throw new Error('Failed to fetch withdraw info')

        // Create invoice on user's wallet
        const invoice = await this._createUserInvoice(claimable)
        if (!invoice) throw new Error('Failed to create invoice')

        // Claim the withdraw with the invoice
        const claimed = await this._claimWithdraw(withdrawInfo.callback, withdrawInfo.k1, invoice)
        if (!claimed) throw new Error('Failed to claim withdraw')

        // Success — update state
        this.pendingSats -= claimable
        this.lastPayoutAt = Date.now()
        this.answerTimings = [] // Reset timings after successful claim
        this.persist()

        return { amount: claimable, success: true }
      } catch (error) {
        console.error('[earn] Payout failed:', error.message)
        return { amount: 0, success: false, error: 'payout_failed', message: error.message }
      }
    },

    /**
     * Create a one-time LNURL-withdraw link on LNbits.
     */
    async _createWithdrawLink(amountSats) {
      try {
        const response = await fetch(`${LNBITS_URL}/withdraw/api/v1/links`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': LNBITS_API_KEY,
          },
          body: JSON.stringify({
            title: `BuhoGO Learn & Earn - ${amountSats} sats`,
            min_withdrawable: amountSats,
            max_withdrawable: amountSats,
            uses: 1,
            wait_time: 1,
            is_unique: true,
          }),
        })

        if (!response.ok) throw new Error(`LNbits API error: ${response.status}`)
        return await response.json()
      } catch (error) {
        console.error('[earn] Create withdraw link failed:', error)
        return null
      }
    },

    /**
     * Fetch LNURL-withdraw info (callback + k1) from an LNURL.
     */
    async _fetchWithdrawInfo(lnurl) {
      try {
        // Decode LNURL (bech32) to URL
        let url = lnurl
        if (lnurl.toLowerCase().startsWith('lnurl')) {
          // Import bech32 decode from existing utility
          const { bech32 } = await import('bech32')
          const decoded = bech32.decode(lnurl.toLowerCase(), 2000)
          const bytes = bech32.fromWords(decoded.words)
          url = new TextDecoder().decode(new Uint8Array(bytes))
        }

        const response = await fetch(url)
        if (!response.ok) throw new Error(`LNURL fetch failed: ${response.status}`)
        const data = await response.json()

        if (data.tag !== 'withdrawRequest') throw new Error('Not a withdraw request')
        return { callback: data.callback, k1: data.k1 }
      } catch (error) {
        console.error('[earn] Fetch withdraw info failed:', error)
        return null
      }
    },

    /**
     * Create an invoice on the user's selected wallet.
     */
    async _createUserInvoice(amountSats) {
      try {
        const { useWalletStore } = await import('./wallet')
        const walletStore = useWalletStore()

        const wallet = walletStore.wallets.find(w => w.id === this.selectedWalletId)
        if (!wallet) throw new Error('Selected wallet not found')

        const provider = walletStore.providers[this.selectedWalletId]
        if (!provider) throw new Error('Wallet not connected')

        const result = await provider.createInvoice({
          amount: amountSats,
          description: 'BuhoGO Learn & Earn reward',
        })

        return result.paymentRequest || result.payment_request || result.bolt11 || result
      } catch (error) {
        console.error('[earn] Create invoice failed:', error)
        return null
      }
    },

    /**
     * Claim a LNURL-withdraw with an invoice.
     */
    async _claimWithdraw(callback, k1, invoice) {
      try {
        const separator = callback.includes('?') ? '&' : '?'
        const url = `${callback}${separator}k1=${k1}&pr=${invoice}`
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Claim failed: ${response.status}`)

        const data = await response.json()
        if (data.status === 'ERROR') throw new Error(data.reason || 'Withdraw failed')

        return true
      } catch (error) {
        console.error('[earn] Claim withdraw failed:', error)
        return false
      }
    },

    /**
     * Execute the completion bonus: double all earnings.
     * The bonus equals totalEarned + pendingSats, so final total is 2x.
     */
    async executeCompletionBonus() {
      if (this.bonusPaid) return { amount: 0, alreadyPaid: true }

      // Rate limit check
      if (this.isOnCooldown) {
        const mins = Math.ceil(this.claimCooldownRemaining / 60000)
        return { amount: 0, success: false, error: 'cooldown', minutesLeft: mins }
      }

      const earned = this.totalEarned + this.pendingSats
      const bonus = earned // doubling means the bonus equals what was already earned

      try {
        // Create withdraw link for bonus + any remaining pending sats
        const totalPayout = bonus + this.pendingSats
        const withdrawLink = await this._createWithdrawLink(totalPayout)
        if (!withdrawLink) throw new Error('Failed to create bonus withdraw link')

        const withdrawInfo = await this._fetchWithdrawInfo(withdrawLink.lnurl)
        if (!withdrawInfo) throw new Error('Failed to fetch bonus withdraw info')

        const invoice = await this._createUserInvoice(totalPayout)
        if (!invoice) throw new Error('Failed to create bonus invoice')

        const claimed = await this._claimWithdraw(withdrawInfo.callback, withdrawInfo.k1, invoice)
        if (!claimed) throw new Error('Failed to claim bonus')

        this.totalEarned = earned * 2
        this.pendingSats = 0
        this.bonusPaid = true
        this.lastPayoutAt = Date.now()
        this.persist()

        return { bonus, totalEarned: this.totalEarned, success: true }
      } catch (error) {
        console.error('[earn] Bonus payout failed:', error.message)
        return { amount: 0, success: false, error: 'payout_failed', message: error.message }
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
      this.answerTimings = []
      this.persist()
    },

    getQuestion(questionId) {
      for (const group of quizData.groups) {
        for (const chapter of group.chapters) {
          const q = chapter.questions.find(q => q.id === questionId)
          if (q) return q
        }
      }
      return null
    },

    getGroupForChapter(chapterId) {
      return quizData.groups.find(g => g.chapters.some(c => c.id === chapterId)) || null
    },

    getChapter(chapterId) {
      for (const group of quizData.groups) {
        const chapter = group.chapters.find(c => c.id === chapterId)
        if (chapter) return chapter
      }
      return null
    },
  }
})
