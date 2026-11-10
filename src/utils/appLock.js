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
 * It also holds the lock back while a system picker the app opened is open
 * (openingSystemPicker): App.vue asks leavingForPicker when the app goes to
 * the background and backFromPickerTooLate when it comes back.
 *
 * Plain module state, no Vue: usable from boot files and unit tests alike.
 */

let known = false;
let locked = false;
/** When the system picker the lock is held back for was opened (null: none), and its token. */
let pickerOpenedAt = null;
let pickerToken = 0;
/**
 * The app is in the background for that picker: when the trip there started,
 * the moment the picker was opened (null: it is not away for a picker).
 */
let awayTripStartedAt = null;
/** @type {Array<() => void>} */
let waiting = [];
/** @type {Array<() => void>} */
let waitingForUnlock = [];

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
  if (!locked) {
    const unlocked = waitingForUnlock;
    waitingForUnlock = [];
    for (const resolve of unlocked) resolve();
  }
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

/**
 * Resolves once App.vue has reported the app as unlocked: immediately when it
 * already did, otherwise when the person unlocks. Something asked for from
 * outside the app (a Quick Settings tile, a launcher shortcut) opens its
 * screen only then.
 */
export function whenAppUnlocked() {
  return known && !locked ? Promise.resolve() : new Promise((resolve) => { waitingForUnlock.push(resolve); });
}

/**
 * How long after opening a system picker the app may come back from the
 * background without the lock: the whole trip, not the time away.
 */
export const PICKER_AWAY_MS = 2 * 60 * 1000;

/**
 * A system picker the app opens itself (the photo picker) is part of what the
 * person is doing in the app, not leaving it. On some phones it still sends
 * the app to the background, and the lock would engage and close the screen
 * that is waiting for the photo. Call this just before opening the picker;
 * call what it returns once the picker closed.
 *
 * The lock is held back for one trip to the picker and one departure: once
 * the app is back, leaving again is leaving, even before the photo arrived.
 * And only within PICKER_AWAY_MS of opening it: a phone left in the picker,
 * or a person who went from it to another app, finds the lock when coming
 * back later than that.
 *
 * @param {number} [now]
 * @returns {() => void} closed: the picker is gone
 */
export function openingSystemPicker(now = Date.now()) {
  const token = ++pickerToken;
  pickerOpenedAt = now;
  awayTripStartedAt = null;
  return () => {
    if (token === pickerToken) pickerOpenedAt = null;
  };
}

/**
 * App.vue asks this when the app goes to the background: is that the picker
 * it opened (so the lock stays off)? Remembers it for backFromPickerTooLate.
 * @param {number} [now]
 */
export function leavingForPicker(now = Date.now()) {
  if (pickerOpenedAt === null || now - pickerOpenedAt > PICKER_AWAY_MS) return false;
  // Counted from opening the picker, so the trip as a whole is capped.
  awayTripStartedAt = pickerOpenedAt;
  return true;
}

/**
 * App.vue asks this every time the app comes to the front: did a trip away
 * for the picker take longer than PICKER_AWAY_MS from opening it, so the lock
 * engages now? False when it was not away for a picker at all.
 *
 * Either way the hold is used up, whether or not the photo has arrived yet:
 * a picker shown over the app only pauses it and never sends it away, but
 * the app still comes to the front when that picker closes, a moment before
 * the photo reaches the page. Leaving in that moment is leaving.
 * @param {number} [now]
 */
export function backFromPickerTooLate(now = Date.now()) {
  const startedAt = awayTripStartedAt;
  awayTripStartedAt = null;
  pickerOpenedAt = null;
  return startedAt !== null && now - startedAt > PICKER_AWAY_MS;
}

/**
 * Away for the picker, and longer than PICKER_AWAY_MS since opening it, so
 * the lock is about to engage? Unlike backFromPickerTooLate this only asks:
 * the screen that waits for the photo keeps its camera off, since the
 * picker's own "closed" can arrive a moment before App.vue hears that the
 * app is back.
 * @param {number} [now]
 */
export function awayForPickerTooLong(now = Date.now()) {
  return awayTripStartedAt !== null && now - awayTripStartedAt > PICKER_AWAY_MS;
}

/** Forget everything. For tests. */
export function resetAppLock() {
  known = false;
  locked = false;
  waiting = [];
  waitingForUnlock = [];
  pickerOpenedAt = null;
  awayTripStartedAt = null;
}
