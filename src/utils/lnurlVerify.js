/**
 * LUD-21 payment verification.
 *
 * After paying an LNURL-pay invoice, the callback may return a `verify` URL.
 * Polling it confirms the payment settled — and for a fiat-payout provider
 * (e.g. ChapSmart) the response is extended with a delivery object that proves
 * the local currency actually landed on the recipient's mobile-money account,
 * plus the receipt id and the verified account-holder name.
 *
 * Spec: https://github.com/lnurl/luds/blob/luds/21.md
 *
 * Same-domain rule: like the LUD-09 `url` guard, we only ever poll a verify URL
 * on the SAME host as the callback (the service just paid) — never a third
 * party. Pure and framework-free so it can be unit-tested under plain Node.
 */

/**
 * Validate a `verify` URL: https, and same host as the callback (when known).
 * @param {unknown} verifyUrl
 * @param {string|null} callbackUrl  the LNURL callback (or `https://<domain>/`)
 * @returns {string|null} the normalized verify URL, or null when invalid
 */
export function validateVerifyUrl(verifyUrl, callbackUrl) {
  if (typeof verifyUrl !== 'string' || !verifyUrl) return null
  try {
    const v = new URL(verifyUrl)
    // https only (post-payment polling), and the same host as the callback,
    // compared by hostname so it is port-insensitive. Fails closed on a
    // missing/unparseable callback so we can never be tricked into polling a
    // third-party URL. Unlike a LUD-09 `url` successAction — a link the user
    // reads and taps — this one the app calls by itself, so the host stays
    // pinned to the service just paid.
    if (v.protocol !== 'https:') return null
    const c = new URL(callbackUrl)
    if (v.hostname !== c.hostname) return null
    return v.toString()
  } catch {
    return null
  }
}

/**
 * Normalize a raw verify response into a display-ready delivery status. The
 * base LUD-21 fields are `status`/`settled`/`preimage`; the `mpesa` (or generic
 * `payout`) object is a fiat-payout extension surfaced when present.
 * @param {object} data
 * @returns {{ settled: boolean, delivered: boolean, receipt: string|null,
 *   recipient: string|null, amount: number|null, completedAt: string|null }}
 */
export function normalizeVerify(data) {
  const payout = data && typeof data.mpesa === 'object' && data.mpesa
    ? data.mpesa
    : (data && typeof data.payout === 'object' && data.payout ? data.payout : null)
  return {
    settled: data?.settled === true,
    delivered: !!(payout && payout.delivered === true),
    receipt: payout?.receipt || null,
    recipient: payout?.recipient || null,
    amount: typeof payout?.amount === 'number' ? payout.amount : null,
    completedAt: payout?.completedAt || null,
  }
}

/**
 * Poll a (validated) verify URL until fiat delivery is confirmed or the
 * deadline passes. Non-blocking by contract: it never throws and never blocks
 * the send — resolves with the best status seen, or null if nothing was read.
 *
 * @param {string} verifyUrl  already validated by validateVerifyUrl
 * @param {(status: object) => void} [onUpdate]  called when settled/delivered changes
 * @param {{ timeoutMs?: number, intervalMs?: number, maxIntervalMs?: number,
 *   fetchTimeoutMs?: number, fetchImpl?: Function, now?: () => number,
 *   signal?: AbortSignal }} [opts]
 * @returns {Promise<object|null>}
 */
export async function pollVerify(verifyUrl, onUpdate, opts = {}) {
  const {
    timeoutMs = 90000,
    intervalMs = 3000,
    maxIntervalMs = 15000,
    fetchTimeoutMs = 10000,
  } = opts
  const doFetch = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  const now = opts.now || (() => Date.now())
  const signal = opts.signal || null
  if (!verifyUrl || !doFetch) return null

  const deadline = now() + timeoutMs
  let last = null
  let wait = intervalMs
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal && signal.aborted) return last
    try {
      const res = await fetchWithTimeout(doFetch, verifyUrl, fetchTimeoutMs, signal)
      if (res && res.ok) {
        const status = normalizeVerify(await res.json())
        const changed = !last || status.settled !== last.settled || status.delivered !== last.delivered
        last = status
        if (changed && onUpdate) {
          try { onUpdate(status) } catch { /* UI callback must never break the poll */ }
        }
        if (status.delivered) return status
      }
    } catch {
      // Transient network/JSON error, a per-request timeout, or an abort —
      // the deadline/abort checks below decide whether to keep polling.
    }
    if ((signal && signal.aborted) || now() >= deadline) return last
    await sleep(wait, signal)
    // Exponential backoff (capped): fast first checks, no 30-request tail on a
    // slow payout. `|| intervalMs` keeps a 0-interval test loop at 0.
    wait = Math.min(Math.floor(wait * 1.5) || intervalMs, maxIntervalMs)
  }
}

/** setTimeout-based sleep that resolves early if the abort signal fires. */
function sleep(ms, signal) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    if (signal) {
      if (signal.aborted) return done()
      signal.addEventListener?.('abort', done, { once: true })
    }
  })
}

/**
 * fetch with a per-request timeout and external-abort support, so one hung
 * connection can't stall the poll past its deadline. Falls back to a plain
 * fetch when AbortController isn't available.
 */
async function fetchWithTimeout(doFetch, url, timeoutMs, externalSignal) {
  if (typeof AbortController === 'undefined' || !timeoutMs) {
    return doFetch(url, externalSignal ? { signal: externalSignal } : undefined)
  }
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener?.('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await doFetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener?.('abort', onAbort)
  }
}
