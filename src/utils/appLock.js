/**
 * The biometric app lock as a readable state.
 *
 * `App.vue` owns the lock (its `locked` ref) and reports every change here.
 * The EventBus announces CHANGES ('app:locked' / 'app:unlocked'); this module
 * answers the question those events cannot: what is the state right now, and
 * has App.vue decided it yet? Boot files run before App.vue is set up, and a
 * lock that is already on at launch is a state, not a change, so something
 * that must not start while the app is locked (the contact chat's key and
 * relay connections) asks here instead of guessing.
 *
 * Plain module state, no Vue: usable from boot files and unit tests alike.
 */

let known = false;
let locked = false;
/** @type {Array<() => void>} */
let waiting = [];

/**
 * Report the lock state. Called by `App.vue`: once with the launch state, then
 * on every change. Order: the state is updated before the EventBus event goes
 * out, so a listener that reads it sees the new value.
 * @param {boolean} value
 */
export function setAppLocked(value) {
  locked = value === true;
  known = true;
  const release = waiting;
  waiting = [];
  for (const resolve of release) resolve();
}

/** Is the app locked right now? `false` until App.vue reports (see `isAppLockKnown`). */
export function isAppLocked() {
  return locked;
}

/** Has App.vue reported the launch state yet? */
export function isAppLockKnown() {
  return known;
}

/** Resolves once App.vue has reported the launch state (immediately if it already did). */
export function whenAppLockKnown() {
  return known ? Promise.resolve() : new Promise((resolve) => { waiting.push(resolve); });
}

/** Forget everything. For tests. */
export function resetAppLock() {
  known = false;
  locked = false;
  waiting = [];
}
