/**
 * NWC connection strings at rest. A connection string carries a secret that
 * can spend, so the saved wallets keep it encrypted with the device key
 * (`sealedNwcUrl`), as they keep recovery phrases. In memory it stays plain
 * (`nwcUrl`): every screen and service reads it as text.
 *
 * Encrypting is asynchronous (WebCrypto), and a save must never wait between
 * reading the state and writing it, or a slower save could write an older
 * state over a newer one. So the save first seals every string it will
 * write (`seal`), then builds and writes the state in one synchronous step,
 * taking each envelope from here (`toSaved`). A string is encrypted once;
 * the same envelope serves every later save.
 *
 * The device key sits in the same storage, so this keeps the secret out of
 * anything that copies or shows the saved state (a storage dump, a support
 * export, a glance at developer tools), not out of code running in the app.
 * A lock with a PIN or passkey is what closes that.
 */

const isNwc = (wallet) => (wallet?.type || 'nwc') === 'nwc';

/**
 * @param {{ encrypt: (plain: string) => Promise<string>, decrypt: (envelope: string) => Promise<string>, warn?: Function }} crypto
 */
export function createNwcAtRest({ encrypt, decrypt, warn = () => {} }) {
  /** plain connection string -> its envelope, for the strings of current wallets */
  let envelopes = new Map();
  /** Strings that could not be encrypted on this device: saved as before. */
  const unsealable = new Set();

  return {
    /**
     * Encrypt the strings of `wallets` that have no envelope yet. Strings
     * of wallets that are gone are dropped. A device that cannot encrypt
     * (no WebCrypto, an insecure page) saves the string as before rather
     * than not at all.
     */
    async seal(wallets) {
      const current = new Set(wallets.filter(isNwc).map((w) => w.nwcUrl).filter((url) => typeof url === 'string' && url));
      envelopes = new Map([...envelopes].filter(([url]) => current.has(url)));
      for (const url of current) {
        if (envelopes.has(url) || unsealable.has(url)) continue;
        try {
          envelopes.set(url, await encrypt(url));
        } catch (error) {
          unsealable.add(url);
          warn('[nwc] a connection string could not be encrypted; it is saved as before:', error?.message || error);
        }
      }
    },

    /** True when every string of `wallets` was sealed, or cannot be. */
    isSealed(wallets) {
      return wallets.filter(isNwc).every((w) => !w.nwcUrl || envelopes.has(w.nwcUrl) || unsealable.has(w.nwcUrl));
    },

    /** The wallet as it is written to storage. Synchronous: see `seal`. */
    toSaved(wallet) {
      if (!isNwc(wallet) || !envelopes.has(wallet.nwcUrl)) return wallet;
      const { nwcUrl, ...rest } = wallet;
      return { ...rest, sealedNwcUrl: envelopes.get(nwcUrl) };
    },

    /**
     * The wallet as read from storage, its string opened. One that cannot be
     * opened (the device key is gone) comes back as it was saved, without
     * `nwcUrl`, so the store sets it aside unchanged instead of losing it.
     * `plain` tells that it was saved before strings were sealed.
     */
    async fromSaved(wallet) {
      if (!isNwc(wallet) || typeof wallet.sealedNwcUrl !== 'string') {
        return { wallet, plain: isNwc(wallet) && typeof wallet.nwcUrl === 'string' && !!wallet.nwcUrl };
      }
      try {
        const nwcUrl = await decrypt(wallet.sealedNwcUrl);
        const { sealedNwcUrl, ...rest } = wallet;
        envelopes.set(nwcUrl, sealedNwcUrl);
        return { wallet: { ...rest, nwcUrl }, plain: false };
      } catch (error) {
        warn(`[nwc] the connection of "${wallet.name || wallet.id}" could not be opened; it stays saved, unused:`, error?.message || error);
        return { wallet, plain: false };
      }
    },
  };
}
