/**
 * Cross-platform clipboard bridge.
 *
 * Routes through Capacitor's native plugin on iOS/Android, where the WebView's
 * Clipboard API is gated by permission and focus and can fail silently. Falls
 * back to the web API in browsers and tests.
 *
 * Deliberately NOT `utils/sensitiveClipboard.js`: that one wipes the clipboard
 * after 30 seconds, which is right for a private key and wrong for a receipt
 * or an invoice the user is in the middle of pasting.
 */

/**
 * Write text to the platform clipboard.
 * @param {string} text
 * @returns {Promise<void>} rejects if neither path is available
 */
export async function writeClipboardCrossPlatform(text) {
  try {
    const cap = await import('@capacitor/core');
    if (cap?.Capacitor?.isNativePlatform?.()) {
      const { Clipboard } = await import('@capacitor/clipboard');
      await Clipboard.write({ string: text });
      return;
    }
  } catch {
    // Capacitor unavailable or plugin missing — fall through to the web API.
  }
  await navigator.clipboard.writeText(text);
}

/**
 * Passive Home suggestions are Android-only. iOS reads can prompt for paste
 * permission, so there the user chooses Paste in Send instead. Unlike the
 * explicit-paste helper below, null preserves offer memory on read failure;
 * an empty string confirms that the clipboard has changed to empty.
 */
export async function readClipboardForSuggestion() {
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.getPlatform() !== 'android') return null;
  try {
    const { Clipboard } = await import('@capacitor/clipboard');
    const { value } = await Clipboard.read();
    return typeof value === 'string' ? value.trim() : null;
  } catch (error) {
    // Capacitor's Android plugin rejects an empty clipboard with this message.
    if (error?.message === 'There is no data on the clipboard') return '';
    return null;
  }
}

/**
 * Read text from the platform clipboard.
 *
 * Tries, in order: the native Capacitor plugin (the only reliable road on
 * Android, where the WebView rejects programmatic reads without a focus +
 * permission dance), then `navigator.clipboard.readText()`, then the
 * item-based `read()` some WebViews allow instead. Returns '' when every
 * road fails - the caller decides how to coach the user.
 *
 * @returns {Promise<string>} clipboard text, or '' when unreadable
 */
export async function readClipboardCrossPlatform() {
  try {
    const cap = await import('@capacitor/core');
    if (cap?.Capacitor?.isNativePlatform?.()) {
      const { Clipboard } = await import('@capacitor/clipboard');
      const { value } = await Clipboard.read();
      if (typeof value === 'string' && value) return value;
    }
  } catch (e) {
    console.warn('Native clipboard read failed:', e?.message || e);
  }

  if (navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text) return text;
    } catch (e) {
      console.warn('clipboard.readText() failed:', e?.message || e);
    }
  }

  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          if (text) return text;
        }
      }
    } catch (e) {
      console.warn('clipboard.read() failed:', e?.message || e);
    }
  }

  return '';
}
