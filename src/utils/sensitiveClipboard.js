/**
 * Sensitive-clipboard helper — write a secret to the system clipboard
 * and schedule a best-effort wipe after a short window.
 *
 * Modelled on the password-manager convention (1Password, Bitwarden,
 * KeePass): the user gets a brief window to paste the secret into its
 * target application, after which the clipboard is overwritten with an
 * empty string so a later "paste" doesn't surface the secret in a
 * different context (chat input, social-media compose box, OS keyboard
 * preview, clipboard-history app, etc.).
 *
 * Caveats:
 *   - Only one timer is tracked at a time. Calling this twice cancels
 *     the first timer — only the most recent secret is auto-cleared.
 *   - The wipe is best-effort: clipboard write may fail silently if the
 *     tab loses focus, permissions change, or the OS denies write access
 *     from a non-user-gesture context. We do not retry.
 *   - We do *not* read the clipboard before overwriting. If the user has
 *     copied something else in the meantime, they will lose that copy
 *     when our timer fires. The trade-off is fewer permission prompts;
 *     reading the clipboard would require an additional permission grant
 *     on most platforms.
 */

import { Capacitor } from '@capacitor/core';

const DEFAULT_DURATION_MS = 30_000;
let copyRevision = 0;

/**
 * Active timer state. Tracked module-level so a second call replaces
 * the first cleanly — keeps the "only one secret in flight" invariant
 * even across components.
 *
 * @type {{ timeoutId: ReturnType<typeof setTimeout> } | null}
 */
let active = null;

/**
 * Write a string to the system clipboard. Routes through Capacitor's
 * native plugin when the app is running inside iOS/Android, so the
 * write lands on the OS pasteboard rather than only the WebView's
 * view of it. Falls back to the web Clipboard API everywhere else
 * (browser PWA, dev server, test environments).
 *
 * Kept private; the only callers are `copySensitive` and the timer-
 * fired wipe.
 *
 * @param {string | (() => Promise<string>)} source
 */
function writeClipboard(source) {
  if (Capacitor.isNativePlatform()) return writeNativeClipboard(source);
  if (typeof source !== 'function') return navigator.clipboard.writeText(source);

  // Safari requires the write request inside the click, before any await.
  // ClipboardItem lets the browser accept that request while the secret is
  // unlocked/derived asynchronously, without putting it in the DOM or state.
  if (!globalThis.ClipboardItem || !navigator.clipboard?.write) {
    throw new Error('Asynchronous clipboard writes are unavailable');
  }
  const content = Promise.resolve().then(source)
    .then(text => new Blob([text], { type: 'text/plain' }));
  // A denied write may never consume the item. Still handle a later rejection
  // from authentication or key access; never log the secret or its error.
  content.catch(() => {});
  return navigator.clipboard.write([new ClipboardItem({ 'text/plain': content })]);
}

async function writeNativeClipboard(source) {
  const { Clipboard } = await import('@capacitor/clipboard');
  const text = typeof source === 'function' ? await source() : source;
  // Native errors must reach the caller, not fall through to the WebView.
  await Clipboard.write({ string: text });
}

/**
 * Copy a secret to the clipboard and schedule its wipe.
 *
 * Call directly from the user event. For asynchronous secret access, pass a
 * function rather than awaiting the secret before calling this helper.
 *
 * @param {string | (() => Promise<string>)} source
 * @param {{ durationMs?: number }} [opts]
 * @returns {Promise<{ durationMs: number, cancel: () => void }>}
 *   `cancel` cancels the wipe timer for *this* copy specifically. If
 *   another `copySensitive` call has already replaced the active timer,
 *   `cancel` is a no-op so we never wipe the newer secret accidentally.
 */
export async function copySensitive(source, opts = {}) {
  const revision = ++copyRevision;
  const durationMs = Number.isFinite(opts.durationMs)
    ? opts.durationMs
    : DEFAULT_DURATION_MS;

  // Replace any previously-scheduled wipe — we're about to overwrite
  // the clipboard anyway, so the old timer would only clobber our new
  // value if it fired first.
  cancelPendingSensitiveClear();

  let failed = false;
  function assertCurrent() {
    if (failed || revision !== copyRevision) {
      throw new DOMException('Copy superseded', 'AbortError');
    }
  }
  const resolveText = async () => {
    assertCurrent();
    const text = await source();
    assertCurrent();
    return text;
  };
  try {
    await writeClipboard(typeof source === 'function' ? resolveText : source);
    assertCurrent();
  } catch (error) {
    failed = true;
    throw error;
  }

  const timeoutId = setTimeout(() => {
    // Best-effort wipe. Swallow errors: a permission failure here just
    // means the user has to clear their clipboard manually, which is
    // strictly no worse than not having the feature at all.
    writeClipboard('').catch(() => {});
    active = null;
  }, durationMs);

  active = { timeoutId };

  return {
    durationMs,
    cancel() {
      if (active && active.timeoutId === timeoutId) {
        clearTimeout(timeoutId);
        active = null;
      }
    },
  };
}

/**
 * Cancel the currently-scheduled wipe, if any. Use this on component
 * teardown so a closed dialog doesn't keep a wipe timer running while
 * the user is doing unrelated work.
 */
export function cancelPendingSensitiveClear() {
  if (active) {
    clearTimeout(active.timeoutId);
    active = null;
  }
}
