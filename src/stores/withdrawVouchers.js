import { defineStore } from 'pinia'
import { lnurlGetJson } from '../utils/lnurlHttp.js'
import { withdrawInfo } from '../utils/lnurlWithdraw.js'

/**
 * LUD-14 voucher tracking.
 *
 * A withdrawRequest may carry a `balanceCheck` URL: GET it later and the
 * service answers with a FRESH withdrawRequest reflecting whatever balance is
 * left. That turns a one-shot QR into a voucher — an ATM slip or gift card the
 * wallet can keep an eye on — so a partial withdrawal stops meaning "keep the
 * paper and rescan it".
 *
 * Spec: https://github.com/lnurl/luds/blob/luds/14.md
 *
 * What is stored is only ever a URL the service handed us (validated at the
 * parse boundary by validateBalanceCheckUrl: same host as the callback, no
 * credentials, https unless .onion) plus the numbers it answered with. No
 * secret of ours goes in here, but the URL IS the bearer right to the
 * remaining funds, which is why forgetting one is a first-class action.
 *
 * URL rotation is the fiddly part: a service may answer with a different
 * balanceCheck every time, so identity cannot be the URL. A voucher keeps the
 * URLs it has answered under (`knownUrls`) and matches on any of them, which
 * is also what stops a rescan of the original paper QR from creating a second
 * entry for the same voucher.
 */

const STORAGE_KEY = 'buhoGO_withdraw_vouchers'
/** Plenty for a wallet full of ATM slips; keeps a runaway service bounded. */
const MAX_VOUCHERS = 30
/** How many rotated URLs to remember per voucher, newest first. */
const MAX_KNOWN_URLS = 6
/** A voucher untouched for this long is forgotten on the next load. */
const VOUCHER_TTL_MS = 180 * 24 * 60 * 60 * 1000

/** Short, stable id for a voucher (32-bit FNV-1a of its first URL + birth). */
function voucherId(url, createdAt) {
  const seed = `${url}|${createdAt}`
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export const useWithdrawVouchersStore = defineStore('withdrawVouchers', {
  state: () => ({
    vouchers: [],
    initialized: false,
    /** id → true while a re-check is in flight (drives the row's spinner). */
    checking: {},
  }),

  getters: {
    /** Newest first. Everything we track, spent ones included. */
    list: (state) => [...state.vouchers].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),

    /** What is still worth showing: a voucher with something left in it. */
    active() {
      return this.list.filter((voucher) => !voucher.exhausted)
    },

    byId: (state) => (id) => state.vouchers.find((voucher) => voucher.id === id) || null,

    /** Match a voucher by any URL it has ever answered under (see rotation). */
    byUrl: (state) => (url) => {
      if (!url) return null
      return state.vouchers.find((voucher) => voucher.knownUrls?.includes(url)) || null
    },

    isChecking: (state) => (id) => !!state.checking[id],
  },

  actions: {
    async initialize() {
      if (this.initialized) return
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        const parsed = saved ? JSON.parse(saved) : null
        const list = Array.isArray(parsed?.vouchers) ? parsed.vouchers : []
        const cutoff = Date.now() - VOUCHER_TTL_MS
        this.vouchers = list.filter((voucher) => voucher?.balanceCheck && (voucher.updatedAt || 0) > cutoff)
      } catch (error) {
        console.error('[vouchers] could not load:', error)
        this.vouchers = []
      }
      this.initialized = true
      await this.persist()
    },

    async persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ vouchers: this.vouchers }))
      } catch (error) {
        // A full/blocked storage must not break a withdrawal in progress; the
        // in-memory list still works for this session.
        console.warn('[vouchers] could not persist:', error)
      }
    },

    /**
     * Record (or update) the voucher behind a withdrawRequest we just read.
     *
     * Called wherever a withdrawRequest is resolved — the first scan as much
     * as a later re-check — so the stored bounds and URL always reflect the
     * newest answer. `info` is a withdrawInfo() result; without a
     * `balanceCheck` there is nothing to track and this is a no-op.
     *
     * @param {object} info
     * @returns {Promise<object|null>} the tracked voucher
     */
    async track(info) {
      const balanceCheck = info?.balanceCheck
      if (!balanceCheck) return null
      if (!this.initialized) await this.initialize()

      const now = Date.now()
      const maxSats = Number.isFinite(info.maxSats) ? info.maxSats : 0
      const existing = this.byUrl(balanceCheck)

      if (existing) return this.apply(existing, info)

      const voucher = {
        id: voucherId(balanceCheck, now),
        balanceCheck,
        knownUrls: [balanceCheck],
        domain: hostOf(balanceCheck),
        description: info.defaultDescription || '',
        minSats: info.minSats ?? 1,
        maxSats,
        lastKnownSats: maxSats,
        currentBalanceSats: Number.isSafeInteger(info.currentBalance)
          ? Math.floor(info.currentBalance / 1000)
          : null,
        exhausted: maxSats < 1,
        lastCheckedAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      }
      this.vouchers.push(voucher)
      // Keep the freshest ones; a voucher that fell off the end was the least
      // recently seen, and its paper QR still works.
      if (this.vouchers.length > MAX_VOUCHERS) {
        this.vouchers = this.list.slice(0, MAX_VOUCHERS)
      }
      await this.persist()
      return voucher
    },

    /**
     * Fold a fresh withdrawRequest into a voucher we already hold.
     *
     * Rotation lives here: the newest URL wins and the old ones stay
     * matchable, so a rescan of the paper QR lands on this same voucher
     * instead of creating a second one. Called by `track` when a scan matches
     * something known, and by `refresh` for the voucher it just re-checked —
     * that one matches by identity, not by URL, because the answer is exactly
     * where a rotated URL arrives.
     *
     * @param {object} voucher  a record already in `vouchers`
     * @param {object} info     a withdrawInfo() result
     * @returns {Promise<object>} the updated voucher
     */
    async apply(voucher, info) {
      const now = Date.now()
      const maxSats = Number.isFinite(info.maxSats) ? info.maxSats : 0
      const balanceCheck = info.balanceCheck || voucher.balanceCheck

      if (voucher.balanceCheck !== balanceCheck) {
        voucher.knownUrls = [balanceCheck, ...voucher.knownUrls.filter((url) => url !== balanceCheck)]
          .slice(0, MAX_KNOWN_URLS)
        voucher.balanceCheck = balanceCheck
      }
      voucher.description = info.defaultDescription || voucher.description
      voucher.minSats = info.minSats ?? voucher.minSats
      voucher.maxSats = maxSats
      voucher.lastKnownSats = maxSats
      voucher.currentBalanceSats = Number.isSafeInteger(info.currentBalance)
        ? Math.floor(info.currentBalance / 1000)
        : null
      voucher.exhausted = maxSats < 1
      voucher.lastCheckedAt = now
      voucher.lastError = null
      voucher.updatedAt = now
      await this.persist()
      return voucher
    },

    /**
     * Ask the service what is left. Never throws: a voucher that cannot be
     * reached keeps its last known figure and records why, because "we
     * couldn't check" is not the same claim as "it is empty".
     *
     * @param {string} id
     * @param {{ fetchJson?: Function }} [opts]  injectable for tests
     * @returns {Promise<{ ok: boolean, sats: number, voucher: object|null, reason?: string }>}
     */
    async refresh(id, { fetchJson = lnurlGetJson } = {}) {
      const voucher = this.byId(id)
      if (!voucher) return { ok: false, sats: 0, voucher: null, reason: 'unknown-voucher' }

      this.checking = { ...this.checking, [id]: true }
      try {
        const response = await fetchJson(voucher.balanceCheck, { timeoutMs: 15000 })
        const data = response?.data
        if (!response?.ok || !data || data.status === 'ERROR' || data.tag !== 'withdrawRequest') {
          // A service that answers with an error or something that is no
          // longer a withdrawRequest has spent the voucher, as far as it is
          // concerned — say so plainly instead of leaving a stale balance up.
          const spent = !!data && (data.status === 'ERROR' || data.tag !== 'withdrawRequest')
          voucher.lastError = data?.reason || (spent ? 'spent' : 'unreachable')
          voucher.exhausted = spent
          voucher.lastCheckedAt = Date.now()
          voucher.updatedAt = Date.now()
          await this.persist()
          return { ok: false, sats: voucher.lastKnownSats || 0, voucher, reason: voucher.lastError }
        }

        // Fold the answer into THIS voucher (see apply): a rotated URL is a
        // new URL for the voucher we just asked, never a new voucher.
        const updated = await this.apply(voucher, withdrawInfo(data))
        return { ok: true, sats: updated.maxSats || 0, voucher: updated }
      } catch (error) {
        voucher.lastError = 'unreachable'
        voucher.lastCheckedAt = Date.now()
        voucher.updatedAt = Date.now()
        await this.persist()
        console.warn('[vouchers] re-check failed:', error?.message)
        return { ok: false, sats: voucher.lastKnownSats || 0, voucher, reason: 'unreachable' }
      } finally {
        const next = { ...this.checking }
        delete next[id]
        this.checking = next
      }
    },

    /** Drop a voucher. The paper QR is unaffected — this is only our copy. */
    async forget(id) {
      this.vouchers = this.vouchers.filter((voucher) => voucher.id !== id)
      await this.persist()
    },
  },
})
