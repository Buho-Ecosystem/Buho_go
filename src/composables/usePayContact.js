/**
 * Paying a saved contact, from wherever the tap happened.
 *
 * There were two implementations of this. The address book's version guards
 * identity-only Nostr contacts (saved from a card that has not published a
 * Lightning address yet), explains why the tap cannot become a payment, and
 * kicks off a silent re-sync that promotes the contact the moment they publish
 * one. The identity tab's People strip had a shorter copy that dropped both,
 * so the same face that explained itself in the address book did nothing at
 * all when tapped from the identity tab.
 *
 * One behaviour, one place. Everything routes through the wallet page's
 * dispatcher, which is the single send pipeline (LNURL metadata, merchant
 * verification, branding, fee estimates, capability gate).
 */

import { useAddressBookStore } from '../stores/addressBook';

/** A rage-tap should not hammer the relays. */
const RESYNC_COOLDOWN_MS = 60 * 1000;

/**
 * @param {{ $q: any, $t: Function, $router: any }} ctx  Component instance.
 * @returns {{ payContact: (contact: object) => void }}
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

  function payContact(contact) {
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

    ctx.$router.push({
      path: '/wallet',
      query: {
        action: 'pay_contact',
        address,
        addressType: contact.addressType || 'lightning',
        contactName: contact.name,
      },
    });
  }

  return { payContact };
}
