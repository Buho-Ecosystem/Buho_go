import { boot } from 'quasar/wrappers';

/**
 * Keeps the public profile quietly current. Editing the profile is a local
 * action; reaching relays is a background concern and should not be another
 * settings task the user has to remember.
 */
export default boot(async () => {
  if (typeof window !== 'undefined' && window.__AUDIT__) return;

  const { useIdentityStore } = await import('../stores/identity.js');
  const { useProfileStore } = await import('../stores/profile.js');
  const identity = useIdentityStore();
  const profile = useProfileStore();
  let timer = null;
  let inFlight = false;

  const sync = async () => {
    if (inFlight || !profile.isDirty || profile.isPublishing) return;
    inFlight = true;
    try {
      const result = await profile.publish();
      if (!result?.ok) console.warn('[profile-sync] profile will retry later');
    } catch (err) {
      console.warn('[profile-sync] profile publish failed:', err);
    } finally {
      inFlight = false;
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; sync(); }, 1200);
  };

  await identity.hydrate();
  await profile.hydrate();

  // A restore on a new phone has no local profile blob. Recover the active
  // account's public metadata from Nostr immediately; this is what makes the
  // profile portable across devices instead of relying on local storage.
  if (identity.bootstrapped && !profile.isDirty) {
    await profile.recoverFromNostr({ identityStore: identity }).catch((err) => {
      console.warn('[profile-sync] initial profile recovery failed:', err);
    });
  }
  profile.$subscribe((_mutation, state) => {
    if (state.isDirty) schedule();
  });

  // A Nostr account is a complete profile boundary. Load the target
  // account's local metadata as soon as the identity store switches keys.
  identity.$onAction(({ name, after }) => {
    after(async () => {
      if (
        name === 'ensureIdentity' ||
        name === 'createAnotherNostrIdentity' ||
        name === 'switchNostrIdentity' ||
        name === 'importMnemonic' ||
        name === 'regenerate'
      ) {
        await profile.hydrate({ force: true });
        if (!profile.isDirty) {
          await profile.recoverFromNostr({ identityStore: identity }).catch((err) => {
            console.warn('[profile-sync] account profile recovery failed:', err);
          });
        }
      }
    });
  });

  // Retry naturally after a reconnect or when the app returns to the front.
  window.addEventListener('online', schedule);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && profile.isDirty) schedule();
  });
  if (profile.isDirty) schedule();
});
