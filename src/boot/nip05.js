import { boot } from 'quasar/wrappers';
import { Notify } from 'quasar';

/**
 * Username upkeep.
 *
 * Nothing is registered here: a username is only ever bought in the claim
 * sheet. This boot keeps the published one honest and finishes purchases
 * that outlived the sheet, quietly, on launch, when the app comes back to
 * the front, after identity changes and whenever the profile's `nip05`
 * changes (a restore brings one in from the relays):
 *
 *   1. Drop the retired free `name.123456` handle that older versions put in
 *      every profile.
 *   2. Check a username the profile carries but this phone never recorded,
 *      such as one restored from the relays or written by another app.
 *   3. Finish a purchase that was paid but not finished: the sheet was
 *      closed, the app was killed, or it was paid from another wallet.
 */
const IDENTITY_ACTIONS = new Set([
  'ensureIdentity',
  'importMnemonic',
  'rotateNostrIdentity',
  'createAnotherNostrIdentity',
  'switchNostrIdentity',
  'resolveActiveNostrAccount',
]);

export default boot(async () => {
  // The screenshot harness seeds its own identities and must never reach the
  // real name server.
  if (typeof window !== 'undefined' && window.__AUDIT__) return;

  const [
    { useIdentityStore },
    { useProfileStore },
    { settlePendingClaim, reconcileProfileUsername, claimIsInView, CLAIM_STATUS },
    { nip05AddressFor },
    { i18n },
  ] = await Promise.all([
    import('../stores/identity.js'),
    import('../stores/profile.js'),
    import('../services/usernameClaim.js'),
    import('../services/nip05.js'),
    import('./i18n.js'),
  ]);

  const identity = useIdentityStore();
  const profile = useProfileStore();

  async function upkeep() {
    await identity.hydrate();
    if (!identity.bootstrapped) return;
    if (!identity.nostrPubkeyHex) await identity.loadNostrIdentity();
    if (!identity.nostrPubkeyHex) return;
    await profile.hydrate();

    profile.dropFreeNip05();
    await reconcileProfileUsername({ identity, profile });

    const result = await settlePendingClaim({ identity, profile });
    if (result.status === CLAIM_STATUS.DONE && !claimIsInView()) {
      Notify.create({
        type: 'positive',
        message: i18n.global.t('{name} is yours', { name: nip05AddressFor(result.handle) }),
        timeout: 2600,
      });
    }
  }

  // Single-flight with one trailing run, so a burst of triggers (launch,
  // restore, profile update) costs one pass plus at most one more.
  let running = null;
  let runAgain = false;
  function run() {
    if (running) {
      runAgain = true;
      return;
    }
    running = upkeep()
      .catch((err) => console.warn('[nip05] username upkeep failed:', err))
      .finally(() => {
        running = null;
        if (runAgain) {
          runAgain = false;
          run();
        }
      });
  }

  run();

  identity.$onAction(({ name, after }) => {
    if (IDENTITY_ACTIONS.has(name)) after(() => run());
  });

  let lastNip05 = profile.nip05;
  profile.$subscribe((_mutation, state) => {
    if (state.nip05 === lastNip05) return;
    lastNip05 = state.nip05;
    run();
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') run();
    });
  }
});
