/**
 * WireGuard config delivery — share the finished `.conf` to the WireGuard
 * app (native share sheet) or download it (web). There is no reliable
 * `wireguard://` deep link on either platform, so the canonical paths are
 * the QR code (rendered by the success screen) and sharing the file.
 */

import { shareContent } from '../../utils/share.js';

/**
 * Build a WireGuard-safe tunnel filename. The WireGuard apps reject names
 * with special characters and cap the tunnel name length, so we reduce to
 * `[a-z0-9_]` and keep it short.
 *
 * @param {string} label — human label, e.g. "buho netherlands 12m"
 * @returns {string} e.g. "buho_netherlands.conf"
 */
export function safeWgFileName(label) {
  const base = String(label || 'buho_vpn')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 15) || 'buho_vpn';
  return `${base}.conf`;
}

/**
 * Hand the `.conf` to the native share sheet (lands on WireGuard's "Import
 * from file"). Returns the shareContent result so callers can fall back to
 * copy/download on `unsupported`.
 *
 * @param {{ config: string, label?: string }} input
 */
export async function shareWireGuardConfig({ config, label } = {}) {
  if (!config) return { success: false, reason: 'error' };
  const name = safeWgFileName(label);
  const blob = new Blob([config], { type: 'text/plain' });
  return shareContent({
    title: name,
    files: [{ blob, name, mimeType: 'application/octet-stream' }],
  });
}

/**
 * Web fallback: trigger a `.conf` file download.
 * @param {{ config: string, label?: string }} input
 * @returns {boolean} success
 */
export function downloadWireGuardConfig({ config, label } = {}) {
  if (!config || typeof document === 'undefined') return false;
  try {
    const blob = new Blob([config], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeWgFileName(label);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
