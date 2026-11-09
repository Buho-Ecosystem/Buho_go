/**
 * LUD-18: what a pay request asks to know about the payer, and what the
 * wallet sends back.
 *
 * A service lists the kinds it accepts in `payerData` on its first answer
 * (`name`, `pubkey`, `identifier`, `email`, `auth`, or kinds negotiated
 * later). The wallet then adds `&payerdata=<urlencode(json)>` to the callback.
 * The rules, from the spec:
 *   - a listed kind MAY be sent;
 *   - a kind marked `"mandatory": true` MUST be sent, "or otherwise do not
 *     proceed with the payment flow";
 *   - a kind the service did not list SHOULD NOT be sent, and nothing at all
 *     when it lists none.
 *
 * BuhoGO shares one kind only: `identifier`, a Lightning address of the
 * person's own (LUD-16). It never sends a name, an email, a key or a login
 * signature. So a service that requires any other kind cannot be paid.
 *
 * Pure: no store, Vue or network, so it runs under plain Node.
 */
import { isLightningAddress } from './addressUtils.js'

/** The one kind BuhoGO sends. */
export const PAYER_IDENTIFIER = 'identifier'

/** Why the payer details cannot go with a payment (`problem` of payerDataFor). */
export const PAYER_DATA_PROBLEM = Object.freeze({
  /** The service requires a kind BuhoGO never shares. */
  UNSUPPORTED: 'unsupported',
  /** The service requires an address and none was given. */
  REQUIRED: 'required',
  /** An address was given, but it is not a Lightning address. */
  INVALID: 'invalid',
})

// The longest address there can be: a 64-character name, `@`, a 255-character
// domain (RFC 5321).
const MAX_IDENTIFIER_LENGTH = 320
// Kind names are only kept for the error's details, never shown.
const MAX_KIND_LENGTH = 32
const MAX_KINDS_KEPT = 8

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * What a pay request's `payerData` asks for. Anything that is not an object
 * asks for nothing. A kind counts as mandatory only when its own record says
 * `"mandatory": true`: listing a kind is enough to accept it (LUD-18 §1),
 * and anything other than `true` is not a demand.
 * @param {unknown} payerData  the `payerData` field as the service sent it
 * @returns {{ asksIdentifier: boolean, identifierRequired: boolean, unmetRequired: string[] }}
 *   `unmetRequired`: the mandatory kinds BuhoGO cannot send
 */
export function readPayerRequest(payerData) {
  if (!isRecord(payerData)) return { asksIdentifier: false, identifierRequired: false, unmetRequired: [] }
  const required = Object.keys(payerData).filter((kind) => isRecord(payerData[kind]) && payerData[kind].mandatory === true)
  return {
    asksIdentifier: Object.prototype.hasOwnProperty.call(payerData, PAYER_IDENTIFIER),
    identifierRequired: required.includes(PAYER_IDENTIFIER),
    unmetRequired: required
      .filter((kind) => kind !== PAYER_IDENTIFIER)
      .slice(0, MAX_KINDS_KEPT)
      .map((kind) => kind.slice(0, MAX_KIND_LENGTH)),
  }
}

/** A Lightning address as it may be sent, trimmed, or null. */
export function payerIdentifier(value) {
  if (typeof value !== 'string') return null
  const address = value.trim()
  return address.length <= MAX_IDENTIFIER_LENGTH && isLightningAddress(address) ? address : null
}

/**
 * What goes with a payment: the details the person agreed to share, cut to
 * what the service asked for, or why the payment must not go ahead.
 *
 * `json` is the exact text sent. A service that follows the first version of
 * LUD-18 hashes the metadata with this text appended, so the invoice is
 * checked against it as sent.
 *
 * @param {unknown} payerData  the pay request's `payerData`
 * @param {{ identifier?: string|null }} [shared]  what the person agreed to share
 * @returns {{ problem: string|null, kinds: string[], sent: { identifier: string }|null, json: string|null }}
 *   `problem` is a PAYER_DATA_PROBLEM, or null when the payment may go ahead
 *   with `sent` (null: nothing is sent); `kinds` names the unmet kinds
 */
export function payerDataFor(payerData, { identifier = null } = {}) {
  const request = readPayerRequest(payerData)
  const nothing = { problem: null, kinds: [], sent: null, json: null }
  if (request.unmetRequired.length) {
    return { ...nothing, problem: PAYER_DATA_PROBLEM.UNSUPPORTED, kinds: request.unmetRequired }
  }
  if (!request.asksIdentifier) return nothing
  const given = typeof identifier === 'string' && identifier.trim() !== ''
  const address = payerIdentifier(identifier)
  // An address the person saw on the sheet is never dropped quietly: one
  // that cannot be sent stops the payment, so their refund is not lost.
  if (given && !address) return { ...nothing, problem: PAYER_DATA_PROBLEM.INVALID }
  if (!address) return request.identifierRequired ? { ...nothing, problem: PAYER_DATA_PROBLEM.REQUIRED } : nothing
  const sent = { [PAYER_IDENTIFIER]: address }
  return { ...nothing, sent, json: JSON.stringify(sent) }
}
