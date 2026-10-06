import { boot } from 'quasar/wrappers';
import { Notify } from 'quasar';
import { startProfileSync } from '../services/profileSync.js';
import { claimIsInView } from '../services/usernameClaim.js';
import { nip05AddressFor } from '../services/nip05.js';

export default boot(async () => {
  if (typeof window !== 'undefined' && window.__AUDIT__) return;
  const [{ useIdentityStore }, { useProfileStore }, { i18n }] = await Promise.all([
    import('../stores/identity.js'), import('../stores/profile.js'), import('./i18n.js'),
  ]);
  const sync = startProfileSync({
    identity: useIdentityStore(), profile: useProfileStore(),
    onClaim({ handle }) {
      if (!claimIsInView()) Notify.create({
        type: 'positive',
        message: i18n.global.t('{name} is yours', { name: nip05AddressFor(handle) }),
        timeout: 2600,
      });
    },
  });
  if (import.meta.hot) import.meta.hot.dispose(() => sync.stop());
});
