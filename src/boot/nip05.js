import { boot } from 'quasar/wrappers';

/**
 * NIP-05 boot.
 *
 * Silently ensures every BuhoGO identity has a verified `name@mybuho.de`
 * handle registered — the programmatic identifier the future clink feature
 * builds on. There is no prompt and no onboarding step: at first launch we
 * derive a handle, register the identity's Nostr pubkey under mybuho.de via
 * the keyless public endpoint, store the result on the identity store, and
 * seed the publishable `nip05` profile field. The user can later override it
 * from the profile editor.
 *
 * Orchestrated here rather than inside a store so neither the identity nor
 * the profile store has to import the other (which would risk a circular
 * import) — the same pattern boot/cloud-backup.js uses for its auto-backups.
 *
 * Idempotent and best-effort: once a handle exists we never re-register, and
 * a failed attempt (offline, server hiccup) simply retries on the next launch
 * or the next identity action.
 */
export default boot(async () => {
  const { useIdentityStore } = await import('../stores/identity.js');
  const { useProfileStore } = await import('../stores/profile.js');
  const { deriveBaseSlug, registerFreeHandle } = await import('../services/nip05.js');

  const identity = useIdentityStore();
  const profile = useProfileStore();

  let inFlight = false;
  async function ensureHandle() {
    if (inFlight) return;
    inFlight = true;
    try {
      await identity.hydrate();
      if (!identity.bootstrapped) return; // no identity yet — nothing to bind
      await profile.hydrate();

      // Already registered: just make sure the profile field reflects it
      // (covers users who registered before the profile field existed).
      if (identity.nip05Handle) {
        profile.adoptNip05(identity.nip05Address);
        return;
      }

      // Need the Nostr pubkey to register the handle against.
      if (!identity.nostrPubkeyHex) await identity.loadNostrIdentity();
      if (!identity.nostrPubkeyHex) return;

      const baseSlug = deriveBaseSlug({
        name: profile.displayName || profile.name,
        npub: identity.nostrNpub,
      });

      let result;
      try {
        result = await registerFreeHandle({
          baseSlug,
          pubkeyHex: identity.nostrPubkeyHex,
        });
      } catch (err) {
        console.warn('[nip05] registration failed, will retry next launch:', err);
        return;
      }

      identity.setNip05({ handle: result.handle, rotationSecret: result.rotationSecret });
      profile.adoptNip05(identity.nip05Address);
    } finally {
      inFlight = false;
    }
  }

  // Catch-up for identities that already exist at startup.
  ensureHandle();

  // New / rotated identities: re-run once a pubkey appears or changes.
  identity.$onAction(({ name, after }) => {
    after(() => {
      if (
        name === 'ensureIdentity' ||
        name === 'importMnemonic' ||
        name === 'rotateNostrIdentity'
      ) {
        ensureHandle();
      }
    });
  });
});
