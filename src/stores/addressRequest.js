import { defineStore } from 'pinia';
import { reactive } from 'vue';
import { addressRequestState, createAddressRequestSession } from '../utils/addressRequestSession.js';
import { resolveAddressRequest, submitAddressRequest } from '../services/addressRequest.js';
import { readPersistedWalletState } from '../utils/walletHydration.js';
import { preferredProfileLightningAddress } from '../utils/profilePaymentAddress.js';

export const useAddressRequestStore = defineStore('addressRequest', () => {
  const state = reactive(addressRequestState());
  let identity, profile, wallet, npubCashAddress;
  function allowed() {
    const saved = readPersistedWalletState();
    const kiosk = wallet?.kioskEnabled || (!wallet?.isInitialized && saved?.kioskEnabled);
    return !(kiosk && !wallet?.kioskOwnerAccess);
  }
  function snapshot() {
    const npub = identity?.nostrNpub;
    // An explicit profile address always wins, including a malformed value:
    // never silently substitute a different money destination for it.
    const source = wallet?.isInitialized ? wallet : (readPersistedWalletState() || wallet || {});
    const address = profile?.lud16?.trim() || preferredProfileLightningAddress(source)
      || (npubCashAddress ? npubCashAddress(npub) : '');
    const ready = identity?.bootstrapped && profile?.hydrated
      && profile.hydratedProfileKey === profile._profileStorageKey();
    return { identity: ready ? (npub || '') : '', address: address.toLowerCase() };
  }
  async function prepare() {
    const [i, p, w, cash] = await Promise.all([
      import('./identity.js'), import('./profile.js'), import('./wallet.js'), import('../services/npubCash.js'),
    ]);
    identity = i.useIdentityStore();
    profile = p.useProfileStore();
    wallet = w.useWalletStore();
    npubCashAddress = cash.npubCashAddress;
    await identity.hydrate();
    if (identity.bootstrapped) await identity.loadNostrIdentity();
    await profile.hydrate();
  }
  const session = createAddressRequestSession({
    state, resolve: resolveAddressRequest, submit: submitAddressRequest, prepare, snapshot, allowed,
  });
  return { state, ...session, snapshot, allowed };
});
