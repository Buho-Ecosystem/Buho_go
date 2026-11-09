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
 * a copy of the saved wallets on their own (a support export, a glance at
 * developer tools), not out of a copy of the whole storage, nor away from
 * code running in the app. A lock with a PIN or passkey is what closes that.
 *
 * Older versions read only `nwcUrl`. One that finds none drops the wallet,
 * then refuses to save fewer wallets than are stored, and after a removal
 * saves without it. So the saved wallet keeps an `nwcUrl` too, with a
 * stand-in for its secret: an older version keeps the wallet, shows it as
 * not answering, and saves `sealedNwcUrl` back untouched, and the next
 * newer version opens it again.
 */

const isNwc = (wallet) => (wallet?.type || 'nwc') === 'nwc';

/** The plain string a wallet carries, or null: one rule for sealing and for asking whether all is sealed. */
const plainUrlOf = (wallet) => (isNwc(wallet) && typeof wallet.nwcUrl === 'string' && wallet.nwcUrl) || null;

/**
 * The secret an older version finds: the private key 1. A valid key, so the
 * connection still builds, that no wallet service has granted anything.
 */
export const STAND_IN_SECRET = `${'0'.repeat(63)}1`;

/** The connection string with the stand-in for its secret. */
export function withStandInSecret(nwcUrl) {
  return String(nwcUrl).replace(/([?&]secret=)[^&#]*/gi, `$1${STAND_IN_SECRET}`);
}

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
      const current = new Set(wallets.map(plainUrlOf).filter(Boolean));
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
      return wallets.map(plainUrlOf).every((url) => !url || envelopes.has(url) || unsealable.has(url));
    },

    /** The wallet as it is written to storage. Synchronous: see `seal`. */
    toSaved(wallet) {
      if (!isNwc(wallet) || !envelopes.has(wallet.nwcUrl)) return wallet;
      return { ...wallet, nwcUrl: withStandInSecret(wallet.nwcUrl), sealedNwcUrl: envelopes.get(wallet.nwcUrl) };
    },

    /**
     * The wallet as read from storage, its string opened. One that cannot be
     * opened (the device key is gone) comes back without `nwcUrl`, the
     * stand-in dropped, so the store sets it aside instead of connecting
     * with a string that can do nothing, or losing it. `plain` tells that it
     * was saved before strings were sealed.
     */
    async fromSaved(wallet) {
      if (!isNwc(wallet) || typeof wallet.sealedNwcUrl !== 'string') {
        return { wallet, plain: isNwc(wallet) && typeof wallet.nwcUrl === 'string' && !!wallet.nwcUrl };
      }
      const { sealedNwcUrl, ...rest } = wallet;
      delete rest.nwcUrl; // the stand-in, which can do nothing
      try {
        const nwcUrl = await decrypt(sealedNwcUrl);
        envelopes.set(nwcUrl, sealedNwcUrl);
        return { wallet: { ...rest, nwcUrl }, plain: false };
      } catch (error) {
        warn(`[nwc] the connection of "${wallet.name || wallet.id}" could not be opened; it stays saved, unused:`, error?.message || error);
        return { wallet: { ...rest, sealedNwcUrl }, plain: false };
      }
    },
  };
}
