/**
 * The chat runtime on top of the app's real stores.
 *
 * `createChatRuntime` takes plain functions; this module is the one place that
 * knows which store provides each. The stores are passed in (the boot gets
 * them from Pinia), so the wiring is tested with fakes and nothing here
 * imports a store, Vue or the wallet providers.
 *
 *   runtime need                  provided by
 *   ----------------------------  ------------------------------------------------
 *   key bytes (key on this phone) identity.getNostrSecretKeyBytes
 *   signer app (extension, NIP-46)identity.acquireSigner, pinned to the runtime's identity
 *   threads, outbox, status       messages store (scoped to the identity)
 *   profile Lightning address     profile.lud16
 *   requester's current profile   services.fetchProfile (signed kind 0)
 *   contact name and route id     addressBook.findContactByPubkey
 *   notification                  notifications.notifyMessageIfEnabled
 *   tx <-> contact link           transactionMetadata.enqueuePendingContactLink
 *   incoming ledger (payment claims)wallet.wallets + wallet.getProvider + services.normalizeTx
 *   relay connections for lookups getRelayPool().ensureRelay
 */

import { DM_ERROR, DmError } from './errors.js';
import { loadIncomingTransactions } from './incomingTransactions.js';
import { createChatRuntime } from './runtime.js';

/** `source` stamped on the incoming transaction of a paid chat request. */
export const CHAT_REQUEST_SOURCE = 'chat-request';

/**
 * Requests a signer app gets at once. An extension asks the person for each
 * one, so they come one by one; a remote signer answers a few in parallel.
 */
const SIGNER_APP_PARALLEL = Object.freeze({ nip07: 1, nip46: 3 });

/**
 * How the runtime for `pubkey` signs: the key on this phone (a BuhoGO
 * identity or an imported secret key) or the identity's signer app. The
 * signer is pinned: once another identity is in use it is never asked for.
 */
function signingFor(identity, pubkey) {
  const { rawKey, kind } = identity.identityCapabilities;
  if (rawKey) return { loadSecretKey: () => identity.getNostrSecretKeyBytes() };
  return {
    signerApp: {
      acquire: async () => {
        if (identity.nostrPubkeyHex !== pubkey) throw new DmError(DM_ERROR.NO_IDENTITY, 'another identity is in use');
        return identity.acquireSigner();
      },
      maxParallel: SIGNER_APP_PARALLEL[kind] ?? 1,
    },
  };
}

/**
 * @param {object} stores
 * @param {object} stores.identity
 * @param {() => object} stores.messages Getter: the messages store.
 * @param {object} stores.wallet
 * @param {object} stores.profile
 * @param {object} stores.addressBook
 * @param {object} stores.notifications
 * @param {object} stores.transactionMetadata
 * @param {object} services
 * @param {() => { ensureRelay: Function }} services.getRelayPool
 * @param {{ fetchPayRequest: Function, requestLnurlInvoice: Function, verifyPayment?: Function }} services.lnurl nostr-core's functions.
 * @param {(pubkey: string, options: { timeoutMs: number }) => Promise<object | null>} services.fetchProfile
 *   `nostrFetch.fetchProfile`: how a payer finds the requester's current Lightning address.
 * @param {() => boolean} services.isLocked
 * @param {() => boolean} services.isHidden
 * @param {(message: object) => string} services.formatNotification
 * @param {string | (() => string)} [services.channelName] Translated name of the `messages` channel.
 * @param {(raw: object, options: { walletType: string }) => object} [services.normalizeTx]
 *   The transaction normaliser; with it the runtime can check a payment the partner reports
 *   against the user's wallets.
 * @param {typeof WebSocket} [services.WebSocket]
 * @param {typeof createChatRuntime} [services.createChatRuntime] Replacement constructor, for tests.
 * @returns {(pubkey: string) => ReturnType<typeof createChatRuntime>} Builds the runtime for one identity.
 */
export function createAppRuntimeFactory(stores, services) {
  const { identity, wallet, profile, addressBook, notifications, transactionMetadata } = stores;

  return function createRuntimeFor(pubkey) {
    return (services.createChatRuntime ?? createChatRuntime)({
      me: pubkey,
      ...signingFor(identity, pubkey),
      isLocked: services.isLocked,
      store: stores.messages(),
      getProfileAddress: () => profile.lud16,
      fetchProfile: services.fetchProfile,
      lnurl: {
        fetchPayRequest: services.lnurl.fetchPayRequest,
        requestInvoice: services.lnurl.requestLnurlInvoice,
        verifyPayment: services.lnurl.verifyPayment,
      },
      contacts: {
        find(contactPubkey) {
          const entry = addressBook.findContactByPubkey(contactPubkey);
          return entry ? { id: entry.id, name: entry.name || '' } : null;
        },
      },
      notifications: { message: (notification) => notifications.notifyMessageIfEnabled(notification) },
      formatNotification: services.formatNotification,
      channelName: services.channelName,
      isHidden: services.isHidden,
      // Money that came in over a request is stamped with the contact (and the
      // note as its label) once the wallet lists the transaction. The amount is
      // the proof the link needs, which the queue already demands for a link
      // that carries no address.
      linkPayment: ({ contactId, walletId, amountSats, note }) => transactionMetadata.enqueuePendingContactLink({
        contactId,
        amountSats,
        walletId,
        direction: 'incoming',
        source: CHAT_REQUEST_SOURCE,
        label: note,
        perPayment: true,
      }),
      ...(services.normalizeTx
        ? {
          loadIncomingTransactions: () => loadIncomingTransactions({
            wallets: wallet.wallets,
            getProvider: (walletId) => wallet.getProvider(walletId),
            normalizeTx: services.normalizeTx,
          }),
        }
        : {}),
      ensureRelay: (url, options) => services.getRelayPool().ensureRelay(url, options),
      WebSocket: services.WebSocket,
    });
  };
}
