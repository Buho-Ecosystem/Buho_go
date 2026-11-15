/**
 * Paying a saved contact, from wherever the tap happened.
 *
 * Guards identity-only Nostr contacts (saved from a card that has not
 * published a Lightning address yet), explains why the tap cannot become a
 * payment, and kicks off a silent re-sync that promotes the contact the
 * moment they publish one. Before this composable existed, each surface
 * carried its own copy and the shorter ones dropped both behaviours.
 *
 * One behaviour, one place. Everything uses the shared contextual payment
 * dispatcher and the existing send pipeline (LNURL metadata, merchant
 * verification, branding, fee estimates, capability gate).
 */

import { useAddressBookStore } from '../stores/addressBook';
import { CURRENCY_CODE } from '../utils/payAgain.js';
import { usePaymentFlowStore } from '../stores/paymentFlow.js';

/** A rage-tap should not hammer the relays. */
const RESYNC_COOLDOWN_MS = 60 * 1000;

/**
 * What a caller may add to a contextual payment.
 * @typedef {object} PayOptions
 * @property {string} [walletId]  The wallet that should pay ("Pay with" preselection).
 * @property {string} [context]   Opaque string returned in the `payment:sent` event
 *   once the payment succeeded (the contact chat uses it to announce the payment).
 * @property {string} [contactId]  Address-book id the payment belongs to. Only an invoice
 *   needs it (it carries no address to find the contact by).
 * @property {number} [amountSats]  Amount to fill into the confirm sheet (the user still confirms it).
 *   Used when a payment is made for an expired request.
 * @property {string} [note]  Note to fill into the confirm sheet, where the recipient accepts one
 *   (for an invoice: shown as what the payment is for).
 * @property {{ code: string, amount: number }} [payout]  Amount in the recipient's own currency,
 *   used instead of `amountSats` while the recipient still offers that currency (Pay again).
 * @property {boolean} [repeat]  A payment made again: the confirm sheet always ends on the slide.
 * @property {boolean} [returnHere] Legacy caller option; contextual payments always
 *   keep the current screen mounted and return to it when dismissed.
 */

/** Normalize optional payment details. Empty values are left out. */
function paymentOptions({ walletId, context, amountSats, note, payout, repeat, contactId } = {}) {
  return {
    ...(typeof walletId === 'string' && walletId ? { walletId } : {}),
    ...(typeof context === 'string' && context ? { context } : {}),
    ...(Number.isSafeInteger(amountSats) && amountSats > 0 ? { amountSats } : {}),
    ...(typeof note === 'string' && note ? { note } : {}),
    ...(CURRENCY_CODE.test(payout?.code || '') && Number.isFinite(Number(payout.amount)) && Number(payout.amount) > 0 ? { payout: { code: payout.code, amount: Number(payout.amount) } } : {}),
    ...(repeat === true ? { repeat: true } : {}),
    ...(typeof contactId === 'string' && contactId ? { contactId } : {}),
  };
}

/**
 * @param {{ $q: any, $t: Function, $router: any }} ctx  Component instance.
 * @returns {{
 *   payContact: (contact: object, options?: PayOptions) => boolean,
 *   payInvoice: (invoice: { bolt11: string, name?: string }, options?: PayOptions) => boolean|undefined,
 *   payAddress: (target: { address: string, addressType?: string, name?: string }, options?: PayOptions) => boolean|undefined,
 *   payAgain: (target: object|null, options?: { walletId?: string, name?: string }) => boolean|undefined,
 *   preparePayment: (input: object, options?: PayOptions) => boolean,
 * }}
 */
export function usePayContact(ctx) {
  const store = useAddressBookStore();
  const flow = usePaymentFlowStore();

  // Open a contextual payment before starting network work. The canonical
  // wallet dispatcher resolves and pays it without navigating through Home.
  function preparePayment(input, options = {}) {
    return flow.begin({ ...input, ...paymentOptions(options) }) !== false;
  }

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

  /** @returns {boolean} true when a contextual payment was accepted */
  function payContact(contact, options = {}) {
    if (!contact) return false;

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
      return false;
    }

    const address = contact.address || contact.lightningAddress;
    if (!address) {
      ctx.$q.notify({
        type: 'info',
        message: ctx.$t('No Lightning address yet'),
        caption: ctx.$t('Add an address for this contact to pay them.'),
        timeout: 4000,
      });
      return false;
    }

    // Recency feeds the Quick pay shelf. Best effort, never blocks the tap.
    store.updateLastUsed(contact.id).catch(() => {});

    return preparePayment({
      address,
      addressType: contact.addressType || 'lightning',
      name: contact.name,
      contactId: contact.id,
      contact,
    }, options);
  }

  /**
   * Pay a BOLT-11 invoice (fetched for a payment request in the contact chat)
   * through the same pipeline. There is no contact address to
   * guard here: the invoice IS the destination, so the identity-only checks of
   * `payContact` do not apply. The shared controller decodes it, checks it and shows
   * the confirm sheet.
   */
  function payInvoice({ bolt11, name = '' } = {}, options = {}) {
    if (typeof bolt11 !== 'string' || !bolt11.trim()) return;
    return preparePayment({ address: bolt11.trim(), addressType: 'invoice', name }, options);
  }

  /**
   * Pay an address that is not (or not yet) a saved contact's: the Lightning
   * address of an expired payment request. Same pipeline and capability gate as
   * `payContact`, without its contact-only guards and bookkeeping.
   */
  function payAddress({ address, addressType = 'lightning', name = '' } = {}, options = {}) {
    if (typeof address !== 'string' || !address.trim()) return;
    return preparePayment({ address: address.trim(), addressType, name }, options);
  }

  /**
   * Pay a past recipient again (utils/payAgain `payAgainTarget`): the same
   * pipeline as any payment, the last amount suggested, ending on the slide,
   * and back on this screen afterwards. `walletId` is the wallet that paid,
   * `name` what the screen calls the recipient (shown until the pipeline
   * names it from the address book or the service).
   */
  function payAgain(target, { walletId, name = '' } = {}) {
    if (!target) return;
    return payAddress({ address: target.address, addressType: target.addressType, name }, {
      walletId,
      amountSats: target.amountSats,
      payout: target.payout,
      repeat: true,
      returnHere: true,
    });
  }

  return { payContact, payInvoice, payAddress, payAgain, preparePayment };
}
