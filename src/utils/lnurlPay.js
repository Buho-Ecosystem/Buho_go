/**
 * Build an LNURL-pay callback URL for requesting the invoice.
 *
 * One shared builder so the Spark, LNbits, and LNURL paths construct the exact
 * same request (they previously each hand-rolled it and drifted). Supports both
 * amount forms:
 *   - Option B (default): amount in millisats (standard LNURL-pay).
 *   - Option A (LUD-21 currency extension #207): when `payout` is given, the
 *     amount is requested in the recipient's own currency so they receive
 *     exactly that (provider fee added on top).
 *
 * Amount-bounds validation is intentionally left to the caller: the sats form
 * is bounded against the endpoint's msat min/max (with caller-specific error
 * copy), while the currency form is bounded by the provider in its own units.
 *
 * @param {object} args
 * @param {string} args.callback      the LNURL-pay callback URL
 * @param {number} [args.amountSats]  amount in sats (Option B)
 * @param {{code:string, amount:number}|null} [args.payout]  local-currency request (Option A)
 * @param {string} [args.comment]     optional LUD-12 comment
 * @param {number} [args.commentAllowed]  max comment length the endpoint accepts
 * @returns {string} the fully-built callback URL
 */
export function buildLnurlPayCallbackUrl({ callback, amountSats, payout = null, comment = '', commentAllowed = 0 }) {
  const sep = callback.includes('?') ? '&' : '?'
  let url
  if (payout && payout.code && payout.amount > 0) {
    url = `${callback}${sep}amount=${payout.amount}&currency=${encodeURIComponent(payout.code)}`
  } else {
    url = `${callback}${sep}amount=${amountSats * 1000}`
  }
  if (comment && commentAllowed > 0) {
    url += `&comment=${encodeURIComponent(String(comment).substring(0, commentAllowed))}`
  }
  return url
}

/**
 * LUD-11 — may we keep the link this invoice came from?
 *
 * A payRequest callback can answer `disposable: false` to say its LNURL is
 * reusable: the service intends the link to be stored and paid again without
 * a new QR. Anything else — absent, null, or an explicit true — means
 * single-use, which is what every link was before the field existed and is
 * the only safe default (storing a one-shot link would offer the user a
 * "Pay again" that can only fail).
 *
 * The field belongs on the second callback (the one returning `pr`), but
 * some services also put it on the payRequest itself, so callers pass
 * whichever response they hold — either one saying `false` is the service
 * telling us the link is storeable.
 *
 * @param {object|null|undefined} response  a payRequest or invoice response
 * @returns {boolean}
 */
export function isStoreablePayLink(response) {
  return response?.disposable === false
}
