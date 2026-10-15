/** Whole-sat arithmetic shared by the request sheet and its send service. */
export const MAX_REQUEST_SATS = Math.floor(Number.MAX_SAFE_INTEGER / 1000)
export const MAX_REQUEST_PEOPLE = 50
export const REQUEST_METHOD = Object.freeze({
  EQUAL: 'equal',
  AMOUNTS: 'amounts'
})

const positiveSats = (value) =>
  Number.isSafeInteger(value) && value > 0 && value <= MAX_REQUEST_SATS

/**
 * A repayment's total includes the requester; a direct request's total does
 * not. Individual amounts define a direct goal's total. For repayments the
 * requester covers the remainder, or every sat must be assigned explicitly.
 * Errors are data so the UI can translate them without duplicating arithmetic.
 */
export function allocateRequest({
  people,
  method = REQUEST_METHOD.EQUAL,
  totalSats = 0,
  repayment = false,
  includeSelf = true
}) {
  const empty = {
    shares: [],
    ownSats: 0,
    collectSats: 0,
    totalSats,
    error: null
  }
  if (
    !Array.isArray(people) ||
    !people.length ||
    people.length > MAX_REQUEST_PEOPLE
  )
    return { ...empty, error: 'people' }
  if (new Set(people.map((person) => person.pubkey)).size !== people.length)
    return { ...empty, error: 'people' }
  if (!Object.values(REQUEST_METHOD).includes(method))
    return { ...empty, error: 'method' }
  if (method === REQUEST_METHOD.EQUAL) {
    const count = people.length + Number(repayment && includeSelf)
    if (!positiveSats(totalSats) || totalSats < count)
      return { ...empty, error: 'total', minimum: count }
    const each = Math.floor(totalSats / count)
    const remainder = totalSats % count
    const ownSats = repayment && includeSelf ? each + Number(remainder > 0) : 0
    const shares = people.map((person, index) => ({
      pubkey: person.pubkey,
      amountSats:
        each + Number(index + Number(repayment && includeSelf) < remainder)
    }))
    return { ...empty, shares, ownSats, collectSats: totalSats - ownSats }
  }
  const missing = people.find((person) => !positiveSats(person.amountSats))
  const collectSats = people.reduce(
    (sum, person) =>
      sum + (positiveSats(person.amountSats) ? person.amountSats : 0),
    0
  )
  if (missing)
    return { ...empty, collectSats, error: 'amount', pubkey: missing.pubkey }
  if (!positiveSats(collectSats))
    return { ...empty, collectSats, error: 'limit' }
  const shares = people.map(({ pubkey, amountSats }) => ({
    pubkey,
    amountSats
  }))
  if (!repayment)
    return { ...empty, shares, collectSats, totalSats: collectSats }
  if (!positiveSats(totalSats))
    return { ...empty, collectSats, error: 'total', minimum: people.length }
  const remaining = totalSats - collectSats
  if (remaining < 0)
    return { ...empty, collectSats, error: 'over', difference: -remaining }
  if (!includeSelf && remaining !== 0)
    return { ...empty, collectSats, error: 'unassigned', difference: remaining }
  return { ...empty, shares, collectSats, ownSats: remaining }
}

/** Accept pasted grouping; decimal commas work in fiat, fractions never in sats. */
export function parseRequestAmount(value, { fiat = false, rate = 0 } = {}) {
  let raw = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
  if (fiat && /^\d+,\d{1,2}$/.test(raw)) raw = raw.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+(,\d{0,2})?$/.test(raw))
    raw = raw.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(,\d{3})+(\.\d{0,2})?$/.test(raw))
    raw = raw.replace(/,/g, '')
  if (!(fiat ? /^\d+(\.\d{0,2})?$/ : /^\d+$/).test(raw)) return null
  if (fiat && !(rate > 0)) return null
  const amount = fiat
    ? Math.floor((Number(raw) / rate) * 100_000_000)
    : Number(raw)
  return positiveSats(amount) ? amount : null
}

export function requestSourceKey(source) {
  return typeof source?.walletId === 'string' &&
    source.walletId.length > 0 &&
    source.walletId.length <= 200 &&
    typeof source?.transactionId === 'string' &&
    source.transactionId.length > 0 &&
    source.transactionId.length <= 500
    ? JSON.stringify([source.walletId, source.transactionId])
    : null
}
