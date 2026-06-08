/**
 * eSIM install helpers — turn a completed nadanada eSIM into something the
 * phone can install, across iOS and Android (Capacitor) and the web.
 *
 * The single source of truth is the GSMA LPA activation string
 *   LPA:1$<SM-DP+ address>$<activation/matching code>
 * from which the QR code and the platform universal links are derived. The
 * API also returns ready-made appleInstallUrl / androidInstallUrl, which we
 * prefer when present.
 */

import { Capacitor } from '@capacitor/core';

/**
 * Build the LPA activation string from completion details. The API's
 * `qrCode` field is normally already an `LPA:1$...` string; we fall back to
 * composing one from the SM-DP+ address + matching id.
 *
 * @param {{ qrCode?: string, smdpAddress?: string, matchingId?: string }} inst
 * @returns {string} LPA string, or '' if it cannot be built
 */
export function buildLpaString(inst = {}) {
  const qr = typeof inst.qrCode === 'string' ? inst.qrCode.trim() : '';
  if (/^LPA:/i.test(qr)) return qr;
  if (inst.smdpAddress && inst.matchingId) {
    return `LPA:1$${inst.smdpAddress}$${inst.matchingId}`;
  }
  // Some providers return a bare "smdp$code" in qrCode.
  if (qr.includes('$')) return /^1\$/.test(qr) ? `LPA:${qr}` : `LPA:1$${qr}`;
  return '';
}

/**
 * The platform-appropriate one-tap install universal link. Prefers the
 * API-provided URL; otherwise composes the documented Apple/Google link
 * (base host lowercase; the activation code keeps its original casing).
 *
 * @param {object} inst — installationDetails from /esim/complete
 * @returns {string}
 */
export function esimInstallUrl(inst = {}) {
  const platform = (Capacitor.getPlatform && Capacitor.getPlatform()) || 'web';
  if (platform === 'ios' && inst.appleInstallUrl) return inst.appleInstallUrl;
  if (platform === 'android' && inst.androidInstallUrl) return inst.androidInstallUrl;

  const lpa = buildLpaString(inst);
  if (!lpa) return inst.appleInstallUrl || inst.androidInstallUrl || '';
  // Raw carddata (not percent-encoded) matches Apple/Google's documented form.
  if (platform === 'android') {
    return `https://esimsetup.android.com/esim_qrcode_provisioning?carddata=${lpa}`;
  }
  return `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${lpa}`;
}

/**
 * Open the eSIM installer. The universal link must reach the EXTERNAL system
 * browser so the OS can intercept it and present its native "Add Cellular
 * Plan" sheet. In-app browser tabs (SFSafariViewController / Chrome Custom
 * Tabs) do NOT reliably trigger this, so we try a system-target open first.
 *
 * NOTE (device spike): verify this on a physical iOS 17.4+ / Android 13+
 * device. The QR code and manual codes on the success screen are the
 * guaranteed fallback and must always remain available.
 *
 * @param {string} url
 * @returns {Promise<boolean>} whether an open was dispatched
 */
export async function openEsimInstaller(url) {
  if (!url) return false;
  try {
    const win = window.open(url, '_system');
    if (win) return true;
  } catch {
    // Some webviews throw on _system; fall through.
  }
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
    return true;
  } catch {
    // Last resort: navigate. On web this opens the installer page.
  }
  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
}
