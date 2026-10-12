/**
 * Where the chat lives in the router (src/router/routes.js). One place, so a
 * notification tap, the Messages list and the address book always agree.
 * Pure: no Vue, no stores.
 */

/** A saved contact's own page (their details and payments). */
export const contactPageRoute = (contactId) => `/address-book/${encodeURIComponent(contactId)}`;

/** The chat with a saved contact. */
export const contactChatRoute = (contactId) => `${contactPageRoute(contactId)}/chat`;

/** The chat with someone who is not in the address book, by their hex public key. */
export const unknownChatRoute = (pubkey) => `/messages/${pubkey}`;
