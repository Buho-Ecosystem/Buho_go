import { boot } from 'quasar/wrappers';

/**
 * Payment address boot.
 *
 * Closes the gap that made "pay me by name" a promise BuhoGO could not keep.
 *
 * A username resolves to a profile, and a payer's wallet then looks in that
 * profile for a `lud16` to actually send to. The app fills that field with
 * its best default:
 *
 *   1. The first Spark wallet's own Lightning address (Business, then
 *      Personal) — payments land straight in the wallet, no extra hop.
 *   2. The identity's Social Bucket address (`<npub>@npub.cash`) when no
 *      Spark wallet has an address — payable the moment the key exists,
 *      no registration call needed.
 *
 * The address is never shown as something to hand out. It sits in the profile
 * as routing, and what the user gives people is their username.
 *
 * Two rules this must never break:
 *   1. A user's own Lightning address always wins. We only fill an empty
 *      field or upgrade a bucket default of our own.
 *   2. The field is worthless unless it is published, so a local write that
 *      never reached the relays is retried on the next launch.
 *
 * Renames and wallet removals are handled elsewhere: the wallet store's
 * `_syncProfilePaymentAddress` follows a changed Spark address onto the
 * profile the moment it changes. This boot covers launches, new identities
 * and the bucket-to-Spark upgrade for profiles published before Spark
 * wallets had addresses.
 *
 * Best effort throughout. A failure here leaves the user exactly where they
 * were, and the next launch tries again.
 */
export default boot(async () => {
  // The screenshot harness seeds identities for rendering. Publishing a real
  // kind:0 for a throwaway test key on every audit run would be rude to the
  // relays and would make the fixtures non-deterministic.
  if (typeof window !== 'undefined' && window.__AUDIT__) return;

  const { useIdentityStore } = await import('../stores/identity.js');
  const { useProfileStore } = await import('../stores/profile.js');
  const { useWalletStore } = await import('../stores/wallet.js');
  const { npubCashAddress, isNpubCashAddress } = await import('../services/npubCash.js');

  const identity = useIdentityStore();
  const profile = useProfileStore();
  const walletStore = useWalletStore();

  let inFlight = false;

  async function ensurePaymentAddress() {
    if (inFlight) return;
    inFlight = true;
    try {
      await identity.hydrate();
      if (!identity.bootstrapped) return;
      await profile.hydrate();

      if (!identity.nostrNpub) await identity.loadNostrIdentity();

      // The Spark address lives in persisted wallet metadata, so knowing it
      // only needs the store loaded, not the wallet connected. A wallet
      // store that fails to come up degrades to the bucket default.
      try {
        await walletStore.initialize();
      } catch (err) {
        console.warn('[payment-address] wallet init failed, using the bucket default:', err);
      }

      const preferred = walletStore.preferredProfileLightningAddress
        || npubCashAddress(identity.nostrNpub);
      if (!preferred) return;

      const changed = profile.adoptDefaultPaymentAddress(preferred, {
        isReplaceable: isNpubCashAddress,
      });

      // Publish when we just set it, and also when a previous attempt wrote it
      // locally but never got it onto the relays. Both cases are the same
      // question: does the published profile carry a way to pay this person?
      const needsPublish = changed || (profile.isDirty && profile.lud16);
      if (!needsPublish) return;

      const result = await profile.publish();
      if (!result?.ok) {
        console.warn('[payment-address] address saved locally, publish will retry');
      }
    } catch (err) {
      console.warn('[payment-address] could not set up the address:', err);
    } finally {
      inFlight = false;
    }
  }

  // Identities that already exist at startup.
  ensurePaymentAddress();

  // A new, restored, created or switched identity is a different key and needs
  // its own address. `ensurePaymentAddress` is idempotent per key, so firing
  // more often than strictly necessary is harmless.
  identity.$onAction(({ name, after }) => {
    after(() => {
      if (
        name === 'ensureIdentity' ||
        name === 'importMnemonic' ||
        name === 'regenerate' ||
        name === 'createAnotherNostrIdentity' ||
        name === 'switchNostrIdentity' ||
        name === 'resolveActiveNostrAccount'
      ) {
        ensurePaymentAddress();
      }
    });
  });
});
