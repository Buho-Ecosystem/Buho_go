/**
 * The identity's secret key, held in memory only for as long as it is needed.
 *
 * Signing a gift wrap, answering a relay's AUTH challenge and decrypting the
 * inbox all need the Nostr secret key, which otherwise never exists outside
 * the encrypted identity store. This module is the only holder of those
 * bytes: it loads them once, hands them to a synchronous callback and nowhere
 * else, and zeroes them on app lock, idle timeout, identity change or reset.
 *
 * The risks it guards against are all races. A wipe can arrive while a load is
 * in flight (the freshly loaded bytes must be discarded, not kept), between a
 * load finishing and its caller resuming (the caller must not receive zeroed
 * bytes as if they were a key), or the loader can return the wrong identity's
 * key. An async callback is refused because it would keep using the bytes
 * after a wipe zeroed them.
 *
 * No Vue, Pinia or i18n. Keys are never logged and never put in an error.
 *
 * Contract: docs/CONTACT_CHAT.md section 6 (`sessionKey.js`).
 */

import { getPublicKey } from 'nostr-core';
import { DM_ERROR, DmError } from './errors.js';

/**
 * Why a key was wiped. Frozen, and passed to `wipe(reason)` and `onWipe`.
 */
export const WIPE_REASON = Object.freeze({
  /** The app was locked. */
  LOCK: 'lock',
  /** The app sat in the background for `KEY_IDLE_WIPE_MS`. */
  IDLE: 'idle',
  /** The active identity changed (rotation or switch). */
  IDENTITY_CHANGE: 'identity-change',
  /** The identity was reset or deleted. */
  RESET: 'reset',
  /** This session key was disposed and will not be used again. */
  DISPOSE: 'dispose',
});

const HEX_PUBKEY = /^[0-9a-f]{64}$/;
const SECRET_KEY_LENGTH = 32;

const keyWiped = (message) => new DmError(DM_ERROR.KEY_WIPED, message);

function isThenable(value) {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof value.then === 'function'
  );
}

/**
 * Create the session key holder for ONE identity.
 *
 * @param {object} options
 * @param {() => Promise<Uint8Array>} options.load Returns fresh secret key bytes
 *   on every call (the caller owns them; this module zeroes them), for example
 *   `identity.getNostrSecretKeyBytes`.
 * @param {string} options.pubkey The identity's public key (64 lowercase hex).
 *   Loaded bytes that do not derive to it are rejected and zeroed.
 * @param {typeof setTimeout} [options.setTimer] Injected for tests.
 * @param {typeof clearTimeout} [options.clearTimer] Injected for tests.
 * @param {(reason: string) => void} [options.onWipe] Called after each wipe of
 *   loaded bytes; errors in it are swallowed. For status and diagnostics only.
 * @returns {{
 *   use: <T>(fn: (secretKey: Uint8Array) => T) => Promise<T>,
 *   wipe: (reason?: string) => void,
 *   wipeAfter: (ms: number) => void,
 *   cancelWipe: () => void,
 *   isLoaded: () => boolean,
 *   dispose: () => void,
 * }}
 */
export function createSessionKey({
  load,
  pubkey,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onWipe,
} = {}) {
  if (typeof load !== 'function') {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'load must be a function');
  }
  if (typeof pubkey !== 'string' || !HEX_PUBKEY.test(pubkey)) {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'pubkey must be 64 lowercase hex characters');
  }

  /** @type {Uint8Array | null} */
  let bytes = null;
  /** @type {Promise<Uint8Array> | null} */
  let loading = null;
  /** Bumped by every wipe; a load that started under an older value is stale. */
  let generation = 0;
  let disposed = false;
  let timer = null;

  function clearScheduledWipe() {
    if (timer === null) return;
    const handle = timer;
    timer = null;
    try {
      clearTimer(handle);
    } catch {
      // Nothing useful to do; the stale timer would only wipe again.
    }
  }

  /** Zero whatever a loader returned, if it is bytes at all. */
  function zero(value) {
    if (value instanceof Uint8Array) value.fill(0);
  }

  async function loadBytes() {
    const startedIn = generation;
    let loaded;
    try {
      loaded = await load();
    } catch (cause) {
      if (DmError.is(cause)) throw cause;
      throw new DmError(DM_ERROR.NO_IDENTITY, 'secret key could not be loaded', { cause });
    }
    if (generation !== startedIn) {
      zero(loaded);
      throw keyWiped('key was wiped while it was loading');
    }
    if (!(loaded instanceof Uint8Array) || loaded.length !== SECRET_KEY_LENGTH) {
      zero(loaded);
      throw new DmError(DM_ERROR.NO_IDENTITY, 'loader did not return a 32-byte key');
    }
    let derived;
    try {
      derived = getPublicKey(loaded);
    } catch (cause) {
      zero(loaded);
      throw new DmError(DM_ERROR.NO_IDENTITY, 'loaded key is not a valid secret key', { cause });
    }
    if (derived !== pubkey) {
      zero(loaded);
      throw keyWiped('loaded key does not belong to this identity');
    }
    bytes = loaded;
    return loaded;
  }

  function wipe(reason) {
    try {
      clearScheduledWipe();
      generation += 1;
      loading = null;
      const held = bytes;
      bytes = null;
      if (held) {
        held.fill(0);
        if (typeof onWipe === 'function') onWipe(reason);
      }
    } catch {
      // wipe runs inside event listeners and timers: it must never throw.
    }
  }

  return {
    /**
     * Run `fn` with the secret key bytes and return its result. `fn` must be
     * synchronous and must not keep the bytes: they are zeroed on the next wipe.
     *
     * @template T
     * @param {(secretKey: Uint8Array) => T} fn
     * @returns {Promise<T>}
     * @throws {DmError} KEY_WIPED after dispose, when a wipe interrupts the load,
     *   or when the loaded key is not this identity's; NO_IDENTITY when loading
     *   fails. `fn`'s own errors propagate unchanged. TypeError if `fn` is not a
     *   function or returns a thenable.
     */
    async use(fn) {
      if (typeof fn !== 'function') throw new TypeError('use() requires a callback function');
      if (disposed) throw keyWiped('session key was disposed');
      let current = bytes;
      if (!current) {
        if (!loading) {
          const attempt = loadBytes();
          loading = attempt;
          // A failed load is not remembered, so the next call can try again.
          attempt.catch(() => {
            if (loading === attempt) loading = null;
          });
        }
        current = await loading;
      }
      // A wipe can land between the load finishing and this line running.
      if (disposed || bytes !== current) throw keyWiped('key was wiped before it could be used');
      const result = fn(current);
      if (isThenable(result)) {
        // Do not leave the abandoned promise to surface as an unhandled rejection.
        try {
          result.then(undefined, () => {});
        } catch {
          // ignore
        }
        throw new TypeError('use() callbacks must be synchronous');
      }
      return result;
    },

    /**
     * Zero and drop the key, cancel a scheduled wipe and abandon a load in
     * flight (its callers get KEY_WIPED). Never throws. The key is loaded again
     * on the next `use`.
     *
     * @param {string} [reason] A `WIPE_REASON` value, passed to `onWipe`.
     */
    wipe,

    /**
     * Wipe `ms` milliseconds from now, replacing any earlier schedule (used when
     * the app goes to the background). A non-finite or negative `ms` is ignored.
     *
     * @param {number} ms
     */
    wipeAfter(ms) {
      if (disposed || typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return;
      clearScheduledWipe();
      timer = setTimer(() => {
        timer = null;
        wipe(WIPE_REASON.IDLE);
      }, ms);
    },

    /** Cancel a scheduled wipe (used when the app returns to the foreground). */
    cancelWipe: clearScheduledWipe,

    /** @returns {boolean} True while key bytes are held in memory. */
    isLoaded() {
      return bytes !== null;
    },

    /** Wipe and refuse all further use. Call when the identity this belongs to goes away. */
    dispose() {
      disposed = true;
      wipe(WIPE_REASON.DISPOSE);
    },
  };
}
