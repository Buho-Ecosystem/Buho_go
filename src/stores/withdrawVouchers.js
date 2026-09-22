import { defineStore } from 'pinia'
import { lnurlGetJson } from '../utils/lnurlHttp.js'
import { withdrawInfo } from '../utils/lnurlWithdraw.js'

/**
 * LUD-14 voucher tracking.
 *
 * A withdrawRequest may carry a `balanceCheck` URL: GET it later and the
 * service answers with a FRESH withdrawRequest reflecting whatever balance is
 * left. That turns a one-shot QR into a voucher (an ATM slip or a gift card
 * the wallet can keep an eye on), so a partial withdrawal stops meaning "keep
 * the paper and rescan it".
 *
 * Spec: https://github.com/lnurl/luds/blob/luds/14.md
 *
 * Rules taken from the spec and from LUD-03, in the order they matter:
 *
 *   1. Stable scan aliases are retained separately from the bounded history
 *      of rotating balanceCheck URLs. A rescan of the original code and a
 *      sweep using a recent service URL both resolve to the same record.
 *   2. "After calling the balanceCheck URL the wallet must check the response
 *      for a new balanceCheck and replace the previous one; just erase the
 *      previous if there is not a new one." An answer without balanceCheck
 *      erases the voucher. The old URL is never kept.
 *   3. Empty means zero withdrawal bounds and no positive currentBalance. A
 *      `status: ERROR`, an HTTP failure, a transport failure or an unexpected
 *      tag is a failed check, not an empty voucher: the record and its last
 *      known figure stay, and the reason is recorded for the row to show.
 *   4. `currentBalance` takes priority over `maxWithdrawable` for display;
 *      `maxWithdrawable` remains the bound for what can be taken right now.
 *
 * What is stored is only ever a URL the service handed us (validated at the
 * parse boundary by validateBalanceCheckUrl: same host as the callback, no
 * credentials, https unless .onion) plus the numbers it answered with. The
 * URL IS the bearer right to the remaining funds, which is why forgetting one
 * is a first-class, confirmed action in the UI.
 */

const STORAGE_KEY = 'buhoGO_withdraw_vouchers'
/** How many URLs to remember per voucher, newest first. */
const MAX_KNOWN_URLS = 8
/** An empty voucher is kept this long so a rescan revives the same record. */
const EXHAUSTED_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** A voucher checked more recently than this is not re-checked on open. */
const STALE_AFTER_MS = 60 * 1000
const CHECK_TIMEOUT_MS = 15000
const REASON_MAX_CHARS = 80

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

/** The URLs an answer carries, newest-first: the fresh balanceCheck, then
 * the URL that was called to get it. */
function urlsOf(info) {
  return [info?.balanceCheck, info?.sourceUrl].filter((url) => typeof url === 'string' && url)
}

function mergeUrls(incoming, existing) {
  const seen = new Set()
  const merged = []
  for (const url of [...incoming, ...(existing || [])]) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    merged.push(url)
  }
  return merged.slice(0, MAX_KNOWN_URLS)
}

// Total funds and funds available to withdraw are separate service facts.
function isExhausted(voucher) {
  const withdrawable = voucher.maxWithdrawable ?? voucher.maxSats * 1000
  const balance = voucher.currentBalance ?? (voucher.currentBalanceSats ?? 0) * 1000
  return withdrawable === 0 && balance === 0
}

function titleOf(info, domain) {
  const description = typeof info?.description === 'string' ? info.description.trim() : ''
  return description || domain
}

function satsFromMillisats(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.floor(value / 1000) : null
}

/** A service's `reason` is untrusted text: keep it short and printable. */
function cleanReason(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, REASON_MAX_CHARS)
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

    /** What is worth showing: a voucher with something left in it. */
    active() {
      return this.list.filter((voucher) => !voucher.exhausted)
    },

    byId: (state) => (id) => state.vouchers.find((voucher) => voucher.id === id) || null,

    /** Match a stable scan alias or a retained rotation URL. */
    byUrl: (state) => (url) => {
      if (!url) return null
      return state.vouchers.find((voucher) => (voucher.sourceUrls?.includes(url) || voucher.knownUrls?.includes(url))) || null
    },

    isChecking: (state) => (id) => !!state.checking[id],

    /** LUD-14: currentBalance first, maxWithdrawable otherwise. */
    displaySats: () => (voucher) => {
      if (!voucher) return 0
      if (Number.isSafeInteger(voucher.currentBalanceSats)) return voucher.currentBalanceSats
      return Number.isSafeInteger(voucher.maxSats) ? voucher.maxSats : 0
    },

    activeTotalSats() {
      return this.active.reduce((sum, voucher) => sum + this.displaySats(voucher), 0)
    },
  },

  actions: {
    async initialize() {
      if (this.initialized) return
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        const parsed = saved ? JSON.parse(saved) : null
        const list = Array.isArray(parsed?.vouchers) ? parsed.vouchers : []
        const now = Date.now()
        this.vouchers = list.filter((voucher) => {
          if (!voucher?.balanceCheck || !Array.isArray(voucher.knownUrls)) return false
          // Older records mixed scan aliases with rotating URLs. Preserve all
          // surviving aliases during migration; future rotations stay bounded.
          voucher.sourceUrls ||= [...voucher.knownUrls]
          voucher.exhausted = isExhausted(voucher)
          if (voucher.exhausted && (voucher.exhaustedAt || voucher.updatedAt || 0) <= now - EXHAUSTED_TTL_MS) return false
          return true
        })
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
     * Called wherever a withdrawRequest is resolved: the first scan, a rescan
     * of the paper code, a sweep from the list. `info` is a withdrawInfo()
     * result carrying `sourceUrl` (the URL that was fetched). Without a
     * `balanceCheck` there is nothing to track, and if the answer came for a
     * voucher we already hold, the spec says the voucher is over: erase it.
     *
     * @param {object} info
     * @returns {Promise<object|null>} the tracked voucher, or null
     */
    async track(info) {
      if (!this.initialized) await this.initialize()
      const balanceCheck = info?.balanceCheck
      if (!balanceCheck) {
        const known = info?.sourceUrl ? this.byUrl(info.sourceUrl) : null
        if (known) await this.forget(known.id)
        return null
      }

      const existing = this.byUrl(info.sourceUrl) || this.byUrl(balanceCheck)
      if (existing) {
        // track is a scan/dispatch entry point; refresh only updates rotation.
        if (info.sourceUrl && !existing.knownUrls.includes(info.sourceUrl)) {
          existing.sourceUrls = [...new Set([...(existing.sourceUrls || []), info.sourceUrl])]
        }
        return this.apply(existing, info)
      }

      const now = Date.now()
      const domain = hostOf(balanceCheck)
      const maxSats = Number.isFinite(info.maxSats) ? info.maxSats : 0
      const voucher = {
        id: voucherId(balanceCheck, now),
        balanceCheck,
        knownUrls: mergeUrls(urlsOf(info), []),
        sourceUrls: info.sourceUrl ? [info.sourceUrl] : [],
        domain,
        title: titleOf(info, domain),
        minSats: info.minSats ?? 1,
        maxSats,
        maxWithdrawable: info.maxWithdrawable,
        currentBalance: info.currentBalance,
        currentBalanceSats: satsFromMillisats(info.currentBalance),
        exhausted: false,
        exhaustedAt: null,
        lastCheckedAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      }
      voucher.exhausted = isExhausted(voucher)
      voucher.exhaustedAt = voucher.exhausted ? now : null
      // A funded or unresolved voucher is user data, never an evictable cache.
      this.vouchers.push(voucher)
      await this.persist()
      return voucher
    },

    /**
     * Fold a fresh withdrawRequest into a voucher we already hold.
     *
     * Rotation lives here: the newest balanceCheck wins, recent rotation
     * URLs stay matchable, and durable scan aliases remain unchanged. An answer WITHOUT a
     * balanceCheck erases the voucher (spec), so callers must handle null.
     *
     * @param {object} voucher  a record already in `vouchers`
     * @param {object} info     a withdrawInfo() result
     * @returns {Promise<object|null>} the updated voucher, or null when erased
     */
    async apply(voucher, info) {
      if (!info?.balanceCheck) {
        await this.forget(voucher.id)
        return null
      }
      const now = Date.now()
      const maxSats = Number.isFinite(info.maxSats) ? info.maxSats : 0
      const wasExhausted = !!voucher.exhausted

      voucher.knownUrls = mergeUrls(urlsOf(info), voucher.knownUrls)
      voucher.balanceCheck = info.balanceCheck
      voucher.domain = hostOf(info.balanceCheck) || voucher.domain
      voucher.title = titleOf(info, voucher.domain)
      voucher.minSats = info.minSats ?? voucher.minSats
      voucher.maxSats = maxSats
      voucher.maxWithdrawable = info.maxWithdrawable
      voucher.currentBalance = info.currentBalance
      voucher.currentBalanceSats = satsFromMillisats(info.currentBalance)
      voucher.exhausted = isExhausted(voucher)
      voucher.exhaustedAt = voucher.exhausted ? (wasExhausted ? voucher.exhaustedAt || now : now) : null
      voucher.lastCheckedAt = now
      voucher.lastError = null
      voucher.updatedAt = now
      await this.persist()
      return voucher
    },

    /**
     * Ask the service what is left. Never throws. Only a real withdrawRequest
     * changes the balance; every other outcome keeps the last known figure
     * and records why, because "we couldn't check" is not "it is empty".
     *
     * @param {string} id
     * @param {{ fetchJson?: Function }} [opts]  injectable for tests
     * @returns {Promise<{ ok: boolean, sats: number, voucher: object|null, reason?: string, erased?: boolean }>}
     */
    async refresh(id, { fetchJson = lnurlGetJson } = {}) {
      const voucher = this.byId(id)
      if (!voucher) return { ok: false, sats: 0, voucher: null, reason: 'unknown-voucher' }

      this.checking = { ...this.checking, [id]: true }
      const failed = async (kind, reason = '') => {
        voucher.lastError = kind === 'service' ? { kind, reason: cleanReason(reason) } : { kind }
        voucher.lastCheckedAt = Date.now()
        await this.persist()
        return { ok: false, sats: this.displaySats(voucher), voucher, reason: kind }
      }
      try {
        const response = await fetchJson(voucher.balanceCheck, { timeoutMs: CHECK_TIMEOUT_MS })
        const data = response?.data
        if (data && data.status === 'ERROR') return failed('service', data.reason)
        if (!response?.ok || !data) return failed('unreachable')
        if (data.tag !== 'withdrawRequest') return failed('unexpected')

        const updated = await this.apply(voucher, withdrawInfo(data, { sourceUrl: voucher.balanceCheck }))
        if (!updated) return { ok: true, sats: 0, voucher: null, erased: true }
        return { ok: true, sats: this.displaySats(updated), voucher: updated }
      } catch (error) {
        console.warn('[vouchers] re-check failed:', error?.message)
        return failed('unreachable')
      } finally {
        const next = { ...this.checking }
        delete next[id]
        this.checking = next
      }
    },

    /**
     * Re-check every active voucher that has not been checked recently. This
     * is the app's only automatic check (when the Vouchers sheet opens), the
     * "at its next startup, or after 24 hours" the spec leaves to the wallet.
     *
     * @param {{ maxAgeMs?: number, fetchJson?: Function }} [opts]
     * @returns {Promise<number>} how many vouchers were checked
     */
    async refreshStale({ maxAgeMs = STALE_AFTER_MS, fetchJson } = {}) {
      if (!this.initialized) await this.initialize()
      const cutoff = Date.now() - maxAgeMs
      const targets = this.active.filter((voucher) => (voucher.lastCheckedAt || 0) < cutoff && !this.checking[voucher.id])
      await Promise.allSettled(targets.map((voucher) => this.refresh(voucher.id, fetchJson ? { fetchJson } : {})))
      return targets.length
    },

    /** Explicitly forget the bearer handle. The original code may no longer work. */
    async forget(id) {
      this.vouchers = this.vouchers.filter((voucher) => voucher.id !== id)
      await this.persist()
    },
  },
})
