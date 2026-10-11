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
