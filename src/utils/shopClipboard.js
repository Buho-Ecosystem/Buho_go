/**
 * Clipboard write for shop receipts.
 *
 * Routes through Capacitor's native plugin on iOS/Android, where the WebView's
 * Clipboard API is gated by permission and focus and can fail silently. Falls
 * back to the web API in browsers and tests.
 *
 * Mirrors the helper in components/PaymentErrorDialog.vue; kept here because
 * the shop needs the same guarantee from several components. Deliberately NOT
 * `utils/sensitiveClipboard.js`: that one wipes the clipboard after 30 seconds,
 * which is right for a private key and wrong for a receipt the user is in the
 * middle of pasting into a support email.
 *
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
