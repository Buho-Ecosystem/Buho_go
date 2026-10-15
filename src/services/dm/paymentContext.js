/**
 * The "payment context": an opaque string that rides along with a payment made
 * through the app's ordinary send pipeline and comes back, unchanged, in the
 * `payment:sent` event once it succeeded.
 *
 * The send pipeline (usePayContact -> /wallet?action=pay_contact ->
 * Wallet.vue) knows nothing about the chat. The chat knows nothing about the
 * wallet page. This string is the whole agreement between them:
 *
 *   chat:<partner pubkey>            a plain "Send" to a contact
 *   chat:<partner pubkey>:<id>       paying the request with rumor id <id>
 *   chat:<partner pubkey>:<id>:<url> ... and the invoice's LUD-21 verify URL (may contain ':')
 *
 * The pubkey is the CONVERSATION partner (the person the announcement goes
 * to), not whoever the invoice belongs to, so a request from a stranger who
 * is not in the address book works the same as one from a contact.
 *
 * Pure: no Vue, no stores.
 */

const PREFIX = 'chat';
const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * @param {string} partner Conversation partner, 64 hex characters.
 * @param {string} [requestId] Rumor id of the request being paid.
 * @param {string} [verifyUrl] LUD-21 verify URL of the invoice (needs a request id).
 * @returns {string}
 * @throws {TypeError} for a malformed pubkey or request id.
 */
export function buildChatPaymentContext(partner, requestId, verifyUrl) {
  const to = typeof partner === 'string' ? partner.toLowerCase() : '';
  if (!HEX_64.test(to)) throw new TypeError('payment context: partner must be a 64-hex pubkey');
  if (requestId === undefined || requestId === null) return `${PREFIX}:${to}`;
  const id = typeof requestId === 'string' ? requestId.toLowerCase() : '';
  if (!HEX_64.test(id)) throw new TypeError('payment context: request id must be 64 hex characters');
  return verifyUrl ? `${PREFIX}:${to}:${id}:${verifyUrl}` : `${PREFIX}:${to}:${id}`;
}

/**
 * Read a context string back. Anything that is not exactly a chat context
 * (another feature's context, garbage, a non-string) gives `null`.
 *
 * @param {unknown} context
 * @returns {{ partner: string, requestId: string | null, verifyUrl: string | null } | null}
 */
export function parseChatPaymentContext(context) {
  if (typeof context !== 'string') return null;
  const [prefix, partner, requestId = null, ...rest] = context.split(':');
  if (prefix !== PREFIX || partner === undefined || !HEX_64.test(partner)) return null;
  if (requestId !== null && !HEX_64.test(requestId)) return null;
  return { partner, requestId, verifyUrl: rest.join(':') || null };
}

/**
 * The arguments for `usePayContact().payInvoice` that pay a partner's request
 * through the ordinary send pipeline. `invoice` was fetched from the
 * requester's current Lightning address for exactly the requested amount;
 * the context makes the always-on announcer tell the partner once it went
 * out. Shared by the chat and Home's "Waiting for you" sheet.
 *
 * @param {{ partner: string, message: { id: string, request: { note?: string|null } },
 *   invoice: { bolt11: string, verifyUrl?: string|null }, name?: string, contactId?: string,
 *   payer?: { id: string, usable: boolean } | null }} input
 * @returns {[{ bolt11: string, name: string }, object]}
 */
export function requestPaymentHandover({ partner, message, invoice, name = '', contactId, payer = null }) {
  return [
    { bolt11: invoice.bolt11, name },
    {
      // An unusable pick is not forced on the wallet page: its own sheet explains and offers the others.
      walletId: payer?.usable ? payer.id : undefined,
      // The verify URL (LUD-21) rides along so the announcement can carry it.
      context: buildChatPaymentContext(partner, message.id, invoice.verifyUrl),
      // The invoice has no address, so the contact is named for the history link.
      contactId,
      // What the money is for, shown on the confirm sheet (an LNURL invoice carries no memo).
      note: message.request.note || undefined,
      returnHere: true,
    },
  ];
}
