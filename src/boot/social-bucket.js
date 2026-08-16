import { boot } from 'quasar/wrappers';

/**
 * Social Bucket boot.
 *
 * Closes the gap that made "pay me by name" a promise BuhoGO could not keep.
 *
 * A username resolves to a profile, and a payer's wallet then looks in that
 * profile for a `lud16` to actually send to. New users have no Lightning
 * address: Spark wallets do not have one at all, and asking a first time user
 * to go and find one elsewhere is the end of the flow. So every identity
 * adopts its own address, `<npub>@npub.cash`, which is payable the moment the
 * key exists and needs no registration call to work.
 *
 * The address is never shown as something to hand out. It sits in the profile
 * as routing, and what the user gives people is their username.
 *
 * Two rules this must never break:
 *   1. A user's own Lightning address always wins. We only fill an empty field.
 *   2. The field is worthless unless it is published, so a local write that
 *      never reached the relays is retried on the next launch.
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
  const { npubCashAddress, isNpubCashAddress } = await import('../services/npubCash.js');

  const identity = useIdentityStore();
  const profile = useProfileStore();

  let inFlight = false;

  async function ensureBucketAddress() {
    if (inFlight) return;
    inFlight = true;
    try {
      await identity.hydrate();
      if (!identity.bootstrapped) return;
      await profile.hydrate();

      if (!identity.nostrNpub) await identity.loadNostrIdentity();
      const address = npubCashAddress(identity.nostrNpub);
      if (!address) return;

      const changed = profile.adoptBucketAddress(address, {
        isBucketAddress: isNpubCashAddress,
      });

      // Publish when we just set it, and also when a previous attempt wrote it
      // locally but never got it onto the relays. Both cases are the same
      // question: does the published profile carry a way to pay this person?
      const needsPublish = changed || (profile.isDirty && profile.lud16);
      if (!needsPublish) return;

      const result = await profile.publish();
      if (!result?.ok) {
        console.warn('[social-bucket] address saved locally, publish will retry');
      }
    } catch (err) {
      console.warn('[social-bucket] could not set up the address:', err);
    } finally {
      inFlight = false;
    }
  }

  // Identities that already exist at startup.
  ensureBucketAddress();

  // A new, restored, created or switched identity is a different key and needs
  // its own address. `ensureBucketAddress` is idempotent per key, so firing
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
        ensureBucketAddress();
      }
    });
  });
});
