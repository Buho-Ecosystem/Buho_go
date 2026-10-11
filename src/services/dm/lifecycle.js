/**
 * The contact chat's lifecycle: when the runtime exists, runs, sleeps and dies.
 *
 * `boot/dm-inbox.js` is a thin wrapper that wires this to the real stores, the
 * EventBus and the document; everything that has a rule lives here, with every
 * collaborator injected, so the rules are tested without a browser.
 *
 * ONE runtime per identity (`createRuntime(pubkey)`), reacting to:
 *
 *   event                     action
 *   ------------------------  ---------------------------------------------------
 *   identity appears/changes  dispose the old runtime (key zeroed, connections
 *   (switch, rotation)        closed), `messages.setScope(new)`, create the new
 *                             runtime, publish it, start it unless locked
 *   identity reset            same, with no new runtime; the reset identity's
 *                             stored history is deleted
 *   app locked                `runtime.wipeKey('lock')`, `messages.flush()`
 *   app unlocked              start if it never started, retry the outbox (backoff
 *                             respected), check payment claims
 *   app hidden                `runtime.wipeKeyAfter(KEY_IDLE_WIPE_MS)`, flush
 *   app visible               cancel the wipe, start if needed, then at most once
 *                             per `resumeIntervalMs`: `retryOutbox({ ignoreBackoff })`
 *                             and check payment claims
 *   network online            the same throttled resume
 *
 * A runtime is created as soon as an identity is known (so the UI always has
 * actions to call) but started only when the app is not locked and not
 * suspended (a kiosk device). Why the throttle: every `retryOutbox({
 * ignoreBackoff: true })` costs each waiting message one delivery attempt, and
 * the visible and online events often arrive together.
 *
 * Pure service: no Vue, no Pinia, no DOM.
 */

import { KEY_IDLE_WIPE_MS } from './constants.js';
import { WIPE_REASON } from './sessionKey.js';

/** Resumes closer together than this are collapsed into the first. */
export const RESUME_MIN_INTERVAL_MS = 30_000;

const noop = () => {};

/** Run a callback whose failure must never break the lifecycle (and never be logged with content). */
function quietly(fn) {
  try {
    const result = fn();
    if (result && typeof result.catch === 'function') result.catch(noop);
  } catch {
    // Contained on purpose.
  }
}

/**
 * @typedef {object} ChatLifecycleDeps
 * @property {{ hydrate: () => Promise<unknown>, bootstrapped: boolean, nostrPubkeyHex: string | null,
 *   loadNostrIdentity: () => Promise<unknown> }} identity The identity store.
 * @property {(onChange: (pubkey: string | null) => void) => () => void} watchIdentity
 *   Calls back (synchronously, in the turn of the change) when `identity.nostrPubkeyHex` changes.
 * @property {{ setScope: (pubkey: string | null) => Promise<unknown>, flush: () => Promise<unknown>,
 *   deleteAllHistory: () => Promise<unknown> }} messages The messages store.
 * @property {(pubkey: string) => ReturnType<import('./runtime.js').createChatRuntime>} createRuntime
 * @property {(runtime: object | null) => void} publish Hands the current runtime to the UI accessor.
 * @property {{ isLocked: () => boolean, whenKnown: () => Promise<unknown> }} lock
 * @property {(listener: (locked: boolean) => void) => () => void} onLockChange
 * @property {(listener: (visible: boolean) => void) => () => void} onVisibility
 *   May fire for the same state more than once (DOM and native events); repeats are ignored.
 * @property {(listener: () => void) => () => void} onOnline
 * @property {() => boolean} [isHidden] Is the app out of sight right now?
 * @property {() => boolean} [isSuspended] True where the chat must not run (kiosk).
 * @property {(listener: (suspended: boolean) => void) => () => void} [onSuspendChange]
 *   Reports `isSuspended` changing while the app runs (kiosk mode turned on or off).
 * @property {() => number} [now] Milliseconds.
 * @property {number} [resumeIntervalMs]
 * @property {number} [keyIdleWipeMs]
 */

/**
 * Start the lifecycle. Returns at once; the identity is resolved in the background.
 *
 * @param {ChatLifecycleDeps} deps
 * @returns {{ stop: () => void, whenSettled: () => Promise<void> }}
 */
export function startChatLifecycle({
  identity,
  watchIdentity,
  messages,
  createRuntime,
  publish,
  lock,
  onLockChange,
  onVisibility,
  onOnline,
  isHidden = () => false,
  isSuspended = () => false,
  onSuspendChange = () => noop,
  now = Date.now,
  resumeIntervalMs = RESUME_MIN_INTERVAL_MS,
  keyIdleWipeMs = KEY_IDLE_WIPE_MS,
}) {
  let stopped = false;
  /** Bumped by every identity change: work that began under an older value stops. */
  let generation = 0;
  /** The pubkey the latest adoption was asked for (`undefined` before the first). */
  let target;
  /** @type {{ pubkey: string, runtime: object, started: boolean } | null} */
  let current = null;
  let settled = Promise.resolve();
  let hidden = false;
  let lastResumeAt = null;

  // ----- starting --------------------------------------------------------

  /** Start the runtime if it may run now. Failures are retried by the next trigger. */
  async function ensureStarted() {
    const entry = current;
    if (!entry || entry.started || stopped || lock.isLocked() || isSuspended()) return false;
    entry.started = true;
    try {
      await entry.runtime.start();
      // `start()` retries the outbox and checks payment claims: that counts as a resume.
      lastResumeAt = now();
      return true;
    } catch {
      if (current === entry) entry.started = false;
      return false;
    }
  }

  // ----- identity --------------------------------------------------------

  async function adopt(pubkey) {
    if (stopped || pubkey === target) return;
    target = pubkey;
    const mine = ++generation;

    const previous = current;
    current = null;
    if (previous) {
      // Synchronous on purpose: the old identity's key must be gone before
      // anything else happens, and no late callback may reach the new scope.
      quietly(() => previous.runtime.dispose());
      quietly(() => publish(null));
    }

    try {
      // Reset (not a switch): the seed and every identity are gone, so is every chat history.
      if (previous && pubkey === null && identity.bootstrapped === false) {
        await messages.deleteAllHistory();
      }
      await messages.setScope(pubkey);
    } catch {
      // The store logs its own storage trouble (without content); it then starts empty.
    }
    if (mine !== generation || stopped || pubkey === null) return;

    let runtime;
    try {
      runtime = createRuntime(pubkey);
    } catch {
      return;
    }
    current = { pubkey, runtime, started: false };
    publish(runtime);
    // Launched in the background: its key goes the way of the idle rule from the start.
    if (hidden) quietly(() => runtime.wipeKeyAfter(keyIdleWipeMs));

    await lock.whenKnown();
    if (mine !== generation || stopped) return;
    await ensureStarted();
  }

  function adoptInBackground(pubkey) {
    settled = adopt(pubkey).catch(noop);
  }

  // ----- triggers --------------------------------------------------------

  function onLock(locked) {
    const entry = current;
    if (locked) {
      if (entry) quietly(() => entry.runtime.wipeKey(WIPE_REASON.LOCK));
      quietly(() => messages.flush());
      return;
    }
    if (!entry) return;
    quietly(async () => {
      const startedNow = await ensureStarted();
      if (current !== entry) return;
      // The key is available again: wraps that waited for it get their chance,
      // and what is due goes out. Backoff is respected (nothing just failed).
      if (!startedNow) {
        // Relays whose AUTH failed while locked are read again.
        entry.runtime.resubscribe();
        await entry.runtime.retryOutbox();
      }
      await entry.runtime.settleClaims();
    });
  }

  /** Kiosk mode turned on: the chat stops (no subscription, no notifications on a till); off: it starts. */
  function onSuspend(suspended) {
    const entry = current;
    if (!entry) return;
    if (!suspended) {
      quietly(ensureStarted);
      return;
    }
    if (!entry.started) return;
    entry.started = false;
    quietly(() => entry.runtime.stop());
    quietly(() => messages.flush());
  }

  /** At most one resume per `resumeIntervalMs`: each `ignoreBackoff` retry costs an attempt. */
  async function resume() {
    const entry = current;
    if (!entry || stopped) return;
    if (await ensureStarted()) return;
    if (!entry.started || lock.isLocked()) return;
    const at = now();
    if (lastResumeAt !== null && at - lastResumeAt < resumeIntervalMs) return;
    lastResumeAt = at;
    // Relays the transport gave up on (an AUTH that failed in the background) are read again.
    entry.runtime.resubscribe();
    await entry.runtime.retryOutbox({ ignoreBackoff: true });
    await entry.runtime.settleClaims();
  }

  function onVisible(visible) {
    const nowHidden = !visible;
    if (nowHidden === hidden) return;
    hidden = nowHidden;
    const entry = current;
    if (nowHidden) {
      if (entry) quietly(() => entry.runtime.wipeKeyAfter(keyIdleWipeMs));
      quietly(() => messages.flush());
      return;
    }
    if (entry) quietly(() => entry.runtime.cancelKeyWipe());
    quietly(resume);
  }

  // ----- wiring ----------------------------------------------------------

  hidden = isHidden() === true;
  const offs = [
    watchIdentity((pubkey) => adoptInBackground(pubkey ?? null)),
    onLockChange(onLock),
    onVisibility(onVisible),
    onOnline(() => quietly(resume)),
    onSuspendChange(onSuspend),
  ];

  // The identity that is there at launch (the watch only reports changes).
  settled = (async () => {
    try {
      await identity.hydrate();
      if (identity.bootstrapped && !identity.nostrPubkeyHex) await identity.loadNostrIdentity();
    } catch {
      // No readable identity yet: the watch picks it up when one appears.
    }
    await adopt(identity.nostrPubkeyHex ?? null);
  })().catch(noop);

  return {
    /** Resolves when the latest identity change has been fully handled. For tests and shutdown. */
    async whenSettled() {
      let seen;
      do {
        seen = settled;
        await seen;
      } while (seen !== settled);
    },
    /** Stop reacting and dispose the runtime (hot reload, tests). */
    stop() {
      if (stopped) return;
      stopped = true;
      generation += 1;
      for (const off of offs) quietly(off);
      const entry = current;
      current = null;
      if (entry) quietly(() => entry.runtime.dispose());
      quietly(() => publish(null));
    },
  };
}
