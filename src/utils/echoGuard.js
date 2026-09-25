/**
 * Collapse a delivery that arrives twice.
 *
 * On a cold start Capacitor hands the launching link over twice: once through
 * App.getLaunchUrl() and once more as an appUrlOpen event, replayed as soon as
 * the listener registers. Both land within a moment of each other. The same
 * link opened again later is a person tapping it again, and must work;
 * remembering the last link for the whole session swallowed every repeat.
 *
 * @param {{ windowMs: number, now?: () => number }} options
 * @returns {(value: string) => boolean} true when `value` repeats the last
 *   handled value inside the window
 */
export function createEchoGuard({ windowMs, now = Date.now }) {
  let last = { value: null, at: 0 };

  return function isEcho(value) {
    const at = now();
    if (value === last.value && at - last.at < windowMs) return true;
    last = { value, at };
    return false;
  };
}
