/**
 * Learn & Earn Store
 *
 * Tracks quiz progress, manages sat rewards, and handles payouts.
 * 1 sat per correct answer. Payout every 25 correct answers.
 * Double bonus when all questions are completed.
 */

import { defineStore } from 'pinia'
import quizData from '../data/earn-quizzes.json'

const STORAGE_KEY = 'buhoGO_earn_progress'
const PAYOUT_THRESHOLD = 25

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

    /**
     * Get progress for a specific group
     */
    groupProgress: (state) => (groupId) => {
      const group = quizData.groups.find(g => g.id === groupId)
      if (!group) return { completed: 0, total: 0, percentage: 0 }

      const total = group.chapters.reduce((s, c) => s + c.questions.length, 0)
      const completed = group.chapters.reduce((s, c) =>
        s + c.questions.filter(q => state.completedQuestions.includes(q.id)).length, 0)

      return {
        completed,
        total,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0
      }
    },

    /**
     * Check if a group is unlocked (previous group must be 100% complete)
     */
    isGroupUnlocked: (state) => (groupId) => {
      const groupIndex = quizData.groups.findIndex(g => g.id === groupId)
      if (groupIndex <= 0) return true // First group always unlocked

      const prevGroup = quizData.groups[groupIndex - 1]
      const prevTotal = prevGroup.chapters.reduce((s, c) => s + c.questions.length, 0)
      const prevCompleted = prevGroup.chapters.reduce((s, c) =>
        s + c.questions.filter(q => state.completedQuestions.includes(q.id)).length, 0)

      return prevCompleted >= prevTotal
    },

    /**
     * Get progress for a specific chapter
     */
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

    /**
     * Get the next unanswered question in a chapter
     */
    nextQuestionInChapter: (state) => (chapterId) => {
      for (const group of quizData.groups) {
        const chapter = group.chapters.find(c => c.id === chapterId)
        if (chapter) {
          return chapter.questions.find(q => !state.completedQuestions.includes(q.id)) || null
        }
      }
      return null
    },

    /**
     * Should we trigger a payout?
     */
    shouldPayout(state) {
      return state.pendingSats >= PAYOUT_THRESHOLD
    },

    /**
     * Bonus amount (doubles total earned)
     */
    completionBonus(state) {
      return state.totalEarned
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
     * Mark a question as correctly answered. Returns payout info if threshold reached.
     */
    markQuestionComplete(questionId) {
      if (this.completedQuestions.includes(questionId)) return { alreadyDone: true }

      this.completedQuestions.push(questionId)
      this.pendingSats += 1
      this.totalEarned += 1

      const shouldPay = this.pendingSats >= PAYOUT_THRESHOLD
      this.persist()

      return {
        alreadyDone: false,
        satsEarned: 1,
        pendingSats: this.pendingSats,
        totalEarned: this.totalEarned,
        shouldPayout: shouldPay,
        allCompleted: this.allCompleted,
      }
    },

    /**
     * Execute payout — called after marking 25 correct answers.
     * For now, resets pendingSats. LNbits integration added later.
     */
    async executePayout() {
      const amount = this.pendingSats
      // TODO: Generate LNURL-withdraw from LNbits, create invoice on user wallet, claim
      // For now, just reset the counter
      this.pendingSats = 0
      this.lastPayoutAt = Date.now()
      this.persist()
      return { amount, success: true }
    },

    /**
     * Execute the completion bonus — doubles everything.
     */
    async executeCompletionBonus() {
      if (this.bonusPaid) return { amount: 0, alreadyPaid: true }

      const bonus = this.totalEarned // double = earn again the same amount
      this.totalEarned += bonus
      this.bonusPaid = true

      // Also payout any remaining pending sats
      const remaining = this.pendingSats
      this.pendingSats = 0
      this.lastPayoutAt = Date.now()
      this.persist()

      return { bonus, remaining, totalEarned: this.totalEarned, success: true }
    },

    setSelectedWallet(walletId) {
      this.selectedWalletId = walletId
      this.persist()
    },

    /**
     * Reset all progress (for testing or user request)
     */
    resetProgress() {
      this.completedQuestions = []
      this.pendingSats = 0
      this.totalEarned = 0
      this.bonusPaid = false
      this.lastPayoutAt = null
      this.persist()
    },

    /**
     * Find a question by ID across all groups/chapters
     */
    getQuestion(questionId) {
      for (const group of quizData.groups) {
        for (const chapter of group.chapters) {
          const q = chapter.questions.find(q => q.id === questionId)
          if (q) return q
        }
      }
      return null
    },

    /**
     * Get the group that contains a chapter
     */
    getGroupForChapter(chapterId) {
      return quizData.groups.find(g => g.chapters.some(c => c.id === chapterId)) || null
    },

    /**
     * Get a chapter by ID
     */
    getChapter(chapterId) {
      for (const group of quizData.groups) {
        const chapter = group.chapters.find(c => c.id === chapterId)
        if (chapter) return chapter
      }
      return null
    },
  }
})
