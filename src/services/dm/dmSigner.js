/**
 * The chat's signer: everything the chat does with the identity, behind one
 * async interface, whether the key is on this phone or in another app.
 *
 *   pubkey                       the identity (64 lowercase hex)
 *   nip44Encrypt(peer, text)     seal content for a recipient (or ourselves)
 *   nip44Decrypt(peer, payload)  open a wrap or a seal
 *   signEvent(template)          seals, NIP-42 AUTH, our kind 10050 list
 *   wipe / wipeAfter / cancelWipe / isLoaded / dispose   lifecycle (boot)
 *
 * Two implementations:
 *
 * - Local (`createLocalDmSigner`): a BuhoGO identity or an imported secret
 *   key. The bytes stay inside `sessionKey.js`, which loads them on demand and
 *   zeroes them on lock, idle and identity change.
 *
 * - External (`createExternalDmSigner`): a browser extension (NIP-07) or a
 *   remote signer (NIP-46). Every call is a request to another app, so this
 *   side
 *   - runs at most `maxParallel` requests at once (an extension asks the
 *     person per call, so it gets one; a remote signer a few),
 *   - gives each request `timeoutMs`, so a sleeping signer cannot hold the
 *     inbox forever,
 *   - refuses while the app is locked, like the local key, and while it is
 *     in the background (an approval prompt out of nowhere; the work waits
 *     for the app to come back),
 *   - after a refusal sends nothing more until `allowAgain()` (a person who
 *     said no must not get the same prompt again a second later),
 *   - and turns the signer's errors into DmError codes the inbox understands:
 *     SIGNER_UNAVAILABLE and SIGNER_DENIED keep the work for later
 *     (`isSignerWait`), SIGNER_UNSUPPORTED says the app cannot do NIP-44. A
 *     decrypt only counts as unreadable when the error blames the ciphertext;
 *     anything else (a dropped connection, a closed prompt) waits.
 *
 * No Vue, Pinia or i18n. Keys, plaintexts and payloads are never logged.
 */

import { finalizeEvent, nip44 } from 'nostr-core';
import { DM_ERROR, DmError } from './errors.js';

/** How long one request to a signer app may take before the work waits for later. */
export const SIGNER_TIMEOUT_MS = 30_000;

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * A signer for a key on this phone, held by `sessionKey.js`.
 *
 * @param {object} options
 * @param {string} options.pubkey The identity.
 * @param {ReturnType<typeof import('./sessionKey.js').createSessionKey>} options.sessionKey
 *   The key holder for the same identity.
 */
export function createLocalDmSigner({ pubkey, sessionKey }) {
  if (typeof pubkey !== 'string' || !HEX_64.test(pubkey)) {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'pubkey must be 64 lowercase hex characters');
  }
  if (typeof sessionKey?.use !== 'function') throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'sessionKey is required');

  return Object.freeze({
    pubkey,
    external: false,
    nip44Encrypt: (peer, plaintext) =>
      sessionKey.use((secretKey) => nip44.encrypt(plaintext, nip44.getConversationKey(secretKey, peer))),
    nip44Decrypt: (peer, payload) =>
      sessionKey.use((secretKey) => nip44.decrypt(payload, nip44.getConversationKey(secretKey, peer))),
    signEvent: (template) => sessionKey.use((secretKey) => finalizeEvent(template, secretKey)),
    allowAgain: () => {},
    wipe: (reason) => sessionKey.wipe(reason),
    wipeAfter: (ms) => sessionKey.wipeAfter(ms),
    cancelWipe: () => sessionKey.cancelWipe(),
    isLoaded: () => sessionKey.isLoaded(),
    dispose: () => sessionKey.dispose(),
  });
}

/**
 * A signer in another app (NIP-07 extension or NIP-46 remote signer).
 *
 * @param {object} options
 * @param {string} options.pubkey The identity; every signed event must carry it.
 * @param {() => Promise<{ signer: import('nostr-core').Signer, release?: () => void }>} options.acquire
 *   The identity's signer, pinned to `pubkey` (the caller refuses once the
 *   identity in use is another one). Called per request; it may reconnect.
 * @param {() => boolean} [options.isLocked] True while the app is locked.
 * @param {() => boolean} [options.isHidden] True while the app is in the background.
 * @param {number} [options.maxParallel] Requests in flight at once.
 * @param {number} [options.timeoutMs]
 * @param {typeof setTimeout} [options.setTimer]
 * @param {typeof clearTimeout} [options.clearTimer]
 */
export function createExternalDmSigner({
  pubkey,
  acquire,
  isLocked = () => false,
  isHidden = () => false,
  maxParallel = 1,
  timeoutMs = SIGNER_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (typeof pubkey !== 'string' || !HEX_64.test(pubkey)) {
    throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'pubkey must be 64 lowercase hex characters');
  }
  if (typeof acquire !== 'function') throw new DmError(DM_ERROR.INVALID_ARGUMENT, 'acquire is required');

  let disposed = false;
  /** Set by a refusal; cleared by `allowAgain()`. */
  let refused = false;
  let running = 0;
  /** @type {Array<{ run: () => Promise<unknown>, resolve: Function, reject: Function }>} */
  const waiting = [];

  /** Why nothing may be asked right now, or null. */
  function blocked() {
    if (disposed) return new DmError(DM_ERROR.KEY_WIPED, 'the signer was disposed');
    if (isLocked()) return new DmError(DM_ERROR.KEY_WIPED, 'the app is locked');
    if (isHidden()) return new DmError(DM_ERROR.KEY_WIPED, 'the app is in the background');
    if (refused) return new DmError(DM_ERROR.SIGNER_DENIED, 'the signer app refused an earlier request');
    return null;
  }

  function pump() {
    while (running < maxParallel && waiting.length > 0) {
      const task = waiting.shift();
      const stop = blocked();
      if (stop) {
        task.reject(stop);
        continue;
      }
      running += 1;
      task.run().then(task.resolve, task.reject).finally(() => {
        running -= 1;
        pump();
      });
    }
  }

  /**
   * Queue one request to the signer app; `ask(signer)` performs it.
   * `decrypting`: an error that does not blame the ciphertext means the app
   * could not answer, so the message waits instead of being judged unreadable.
   */
  function request(ask, { decrypting = false } = {}) {
    const stop = blocked();
    if (stop) return Promise.reject(stop);
    return new Promise((resolve, reject) => {
      waiting.push({ run: () => attempt(ask, decrypting), resolve, reject });
      pump();
    });
  }

  async function attempt(ask, decrypting) {
    let lease;
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimer(() => reject(new DmError(DM_ERROR.SIGNER_UNAVAILABLE, 'the signer app did not answer in time')), timeoutMs);
      });
      lease = await Promise.race([acquire(), timeout]);
      return await Promise.race([ask(lease.signer), timeout]);
    } catch (err) {
      let mapped = toDmError(err);
      if (decrypting && !(mapped instanceof DmError) && !PAYLOAD_PROBLEM.test(String(err?.message ?? ''))) {
        mapped = new DmError(DM_ERROR.SIGNER_UNAVAILABLE, 'the signer app could not decrypt right now', { cause: err });
      }
      if (DmError.is(mapped, DM_ERROR.SIGNER_DENIED)) refused = true;
      throw mapped;
    } finally {
      clearTimer(timer);
      try {
        lease?.release?.();
      } catch {
        // Releasing is best effort.
      }
    }
  }

  /** Drop everything still waiting: it fails with KEY_WIPED, which the inbox keeps for later. */
  function abortWaiting(message) {
    for (const task of waiting.splice(0)) task.reject(new DmError(DM_ERROR.KEY_WIPED, message));
  }

  return Object.freeze({
    pubkey,
    external: true,
    nip44Encrypt: (peer, plaintext) => request((signer) => nip44Of(signer).encrypt(peer, plaintext)),
    nip44Decrypt: (peer, payload) => request((signer) => nip44Of(signer).decrypt(peer, payload), { decrypting: true }),
    signEvent: (template) => request(async (signer) => {
      const event = await signer.signEvent(template);
      if (event?.pubkey !== pubkey) throw new DmError(DM_ERROR.NO_IDENTITY, 'the signer answered for another identity');
      return event;
    }),
    /** The person asked to try again (opened the chat, tapped retry): requests may go out again. */
    allowAgain: () => {
      refused = false;
    },
    // Nothing secret lives here: a lock or reset only stops what still waits.
    wipe: (reason) => abortWaiting(`wiped: ${reason ?? 'unknown'}`),
    wipeAfter: () => {},
    cancelWipe: () => {},
    isLoaded: () => false,
    dispose: () => {
      disposed = true;
      abortWaiting('the signer was disposed');
    },
  });
}

/** The signer's NIP-44 methods; an app without them cannot run the chat. */
function nip44Of(signer) {
  if (typeof signer?.nip44?.encrypt !== 'function' || typeof signer?.nip44?.decrypt !== 'function') {
    throw new DmError(DM_ERROR.SIGNER_UNSUPPORTED, 'the signer app has no NIP-44');
  }
  return signer.nip44;
}

/** Words a signer app uses when the ciphertext itself is bad (the only reason a wrap is unreadable). */
const PAYLOAD_PROBLEM = /(invalid|mac|padding|payload|base64|ciphertext|version)/i;

/** Words signer apps use when the person (or a permission rule) said no. */
const REFUSAL = /(denied|declined|rejected|refused|not allowed|unauthori[sz]ed|permission|cancel)/i;

/**
 * A signer app's failure as a DmError, or the error itself when it is about
 * the payload (a ciphertext that does not decrypt is not the signer's fault,
 * and the caller treats it as such).
 *
 * @param {unknown} err
 * @returns {unknown}
 */
export function toDmError(err) {
  if (err instanceof DmError) return err;
  const name = err?.name;
  const code = err?.code;
  const message = String(err?.message ?? '');
  const as = (dmCode) => new DmError(dmCode, `signer: ${name || 'error'}`, { cause: err });

  if (code === 'SIGNER_MISMATCH') return as(DM_ERROR.NO_IDENTITY);
  if (code === 'NIP07_NIP44_UNSUPPORTED') return as(DM_ERROR.SIGNER_UNSUPPORTED);
  if (code === 'NIP07_NOT_AVAILABLE' || name === 'Nip46TimeoutError' || name === 'Nip46ConnectionError') {
    return as(DM_ERROR.SIGNER_UNAVAILABLE);
  }
  // An extension rejects with a plain Error when the person declines; a remote
  // signer answers with an error string. Both name the refusal in words. A
  // remote signer that answers with a link (NIP-46 auth_url) wants the person
  // to approve there first: the same "wait for the person" state.
  if (REFUSAL.test(message) || /^https:\/\/\S+$/.test(message.trim())) return as(DM_ERROR.SIGNER_DENIED);
  return err;
}
