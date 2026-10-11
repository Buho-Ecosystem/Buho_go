/**
 * Paying a saved contact, from wherever the tap happened.
 *
 * Guards identity-only Nostr contacts (saved from a card that has not
 * published a Lightning address yet), explains why the tap cannot become a
 * payment, and kicks off a silent re-sync that promotes the contact the
 * moment they publish one. Before this composable existed, each surface
 * carried its own copy and the shorter ones dropped both behaviours.
 *
 * One behaviour, one place. Everything routes through the wallet page's
 * dispatcher, which is the single send pipeline (LNURL metadata, merchant
 * verification, branding, fee estimates, capability gate).
 */

import { useAddressBookStore } from '../stores/addressBook';

/** A rage-tap should not hammer the relays. */
const RESYNC_COOLDOWN_MS = 60 * 1000;

/**
 * What a caller may add to a payment it hands to the wallet page.
 * @typedef {object} PayOptions
 * @property {string} [walletId]  The wallet that should pay ("Pay with" preselection).
 * @property {string} [context]   Opaque string returned in the `payment:sent` event
 *   once the payment succeeded (the contact chat uses it to announce the payment).
 * @property {string} [contactId]  Address-book id the payment belongs to. Only an invoice
 *   needs it (it carries no address to find the contact by).
 * @property {number} [amountSats]  Amount to fill into the confirm sheet (the user still confirms it).
 *   Used when a payment is made for a request that has no invoice any more.
 * @property {string} [note]  Note to fill into the confirm sheet, where the recipient accepts one.
 */

/** The optional query parameters of a hand-over. Empty values are left out. */
function extraQuery({ walletId, context, amountSats, note } = {}) {
  return {
    ...(typeof walletId === 'string' && walletId ? { walletId } : {}),
    ...(typeof context === 'string' && context ? { context } : {}),
    ...(Number.isSafeInteger(amountSats) && amountSats > 0 ? { prefillAmount: String(amountSats) } : {}),
    ...(typeof note === 'string' && note ? { prefillNote: note } : {}),
  };
}

/**
 * @param {{ $q: any, $t: Function, $router: any }} ctx  Component instance.
 * @returns {{
 *   payContact: (contact: object, options?: PayOptions) => void,
 *   payInvoice: (invoice: { bolt11: string, name?: string }, options?: PayOptions) => void,
 *   payAddress: (target: { address: string, addressType?: string, name?: string }, options?: PayOptions) => void,
 * }}
 */
export function usePayContact(ctx) {
  const store = useAddressBookStore();

  /**
   * Silent re-sync for Nostr-sourced contacts. Skips manual contacts (nothing
   * to sync against) and anything re-synced inside the cooldown window.
   * `refreshContact` returns a typed result rather than throwing, so this
   * stays fire-and-forget.
   */
  function maybeRefresh(contact) {
    if (!contact || contact.source !== 'nostr' || !contact.nostr_pubkey) return;
    const last = Number(contact.last_synced_at) || 0;
    if (Date.now() - last < RESYNC_COOLDOWN_MS) return;
    store.refreshContact(contact.id).catch((err) => {
      console.warn('[addressBook] silent refresh threw:', err);
    });
  }

  function payContact(contact, options = {}) {
    if (!contact) return;

    // Fire the refresh before deciding anything, so it never blocks the tap.
    maybeRefresh(contact);

    // An identity-only contact cannot finish a payment, so say that rather
    // than opening a flow that dead-ends. The refresh above promotes them
    // as soon as they publish an address.
    if (contact.source === 'nostr' && !store.isEntryPayable(contact)) {
      ctx.$q.notify({
        type: 'info',
        message: ctx.$t('No Lightning address yet'),
        caption: ctx.$t(
          "{name} hasn't published a Lightning address. We'll use it automatically once they do.",
          { name: contact.name },
        ),
        timeout: 4500,
      });
      return;
    }

    const address = contact.address || contact.lightningAddress;
    if (!address) {
      ctx.$q.notify({
        type: 'info',
        message: ctx.$t('No Lightning address yet'),
        caption: ctx.$t('Add an address for this contact to pay them.'),
        timeout: 4000,
      });
      return;
    }

    // Recency feeds the Quick pay shelf. Best effort, never blocks the tap.
    store.updateLastUsed(contact.id).catch(() => {});

    ctx.$router.push({
      path: '/wallet',
      query: {
        action: 'pay_contact',
        address,
        addressType: contact.addressType || 'lightning',
        contactName: contact.name,
        ...extraQuery(options),
      },
    });
  }

  /**
   * Pay a BOLT-11 invoice somebody handed over (a payment request in the
   * contact chat) through the same pipeline. There is no contact address to
   * guard here: the invoice IS the destination, so the identity-only checks of
   * `payContact` do not apply. The wallet page decodes it, checks it and shows
   * the confirm sheet.
   */
  function payInvoice({ bolt11, name = '' } = {}, options = {}) {
    if (typeof bolt11 !== 'string' || !bolt11.trim()) return;
    ctx.$router.push({
      path: '/wallet',
      query: {
        action: 'pay_contact',
        address: bolt11.trim(),
        addressType: 'invoice',
        ...(name ? { contactName: name } : {}),
        ...(typeof options.contactId === 'string' && options.contactId ? { contactId: options.contactId } : {}),
        ...extraQuery(options),
      },
    });
  }

  /**
   * Pay an address that is not (or not yet) a saved contact's: the Lightning
   * address a payment request names. Same pipeline and capability gate as
   * `payContact`, without its contact-only guards and bookkeeping.
   */
  function payAddress({ address, addressType = 'lightning', name = '' } = {}, options = {}) {
    if (typeof address !== 'string' || !address.trim()) return;
    ctx.$router.push({
      path: '/wallet',
      query: {
        action: 'pay_contact',
        address: address.trim(),
        addressType,
        ...(name ? { contactName: name } : {}),
        ...extraQuery(options),
      },
    });
  }

  return { payContact, payInvoice, payAddress };
}
