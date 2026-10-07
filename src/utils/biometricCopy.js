/**
 * What the app-lock sheet says for each way the phone can check it's you.
 *
 * The sheet names the method big, shows it, and adds one line on when it
 * is asked for. The per-platform method names live here so they cannot
 * drift apart once more screens describe the lock.
 */
import { Capacitor } from '@capacitor/core';

const ILLUSTRATIONS = {
  devicePin: '/Onboarding wizard spark/storyset-secure-login-bro.svg',
  fingerprint: '/Onboarding wizard spark/storyset-fingerprint-bro.svg',
  face: '/Onboarding wizard spark/storyset-face-scan-bro.svg',
};

/**
 * Resolve the sheet's title, line and illustration for a biometry type on
 * the current platform.
 *
 * @param {string} biometryType  One of 'fingerprint' | 'face' | 'iris' |
 *                               'multiple' | 'device-pin' | 'none'.
 * @param {(key: string) => string} t  Translation function ($t bound).
 * @returns {{
 *   title: string,         // the method, e.g. "Fingerprint", "Face ID"
 *   line: string,          // when BuhoGO asks for it
 *   illustration: string,  // public path of the picture above the title
 * }}
 */
export function getBiometricMethodCopy(biometryType, t) {
  const ios = Capacitor.getPlatform() === 'ios';

  switch (biometryType) {
    case 'fingerprint':
      return {
        title: ios ? t('Touch ID') : t('Fingerprint'),
        line: t("We ask for your fingerprint whenever we need to be sure it's you."),
        illustration: ILLUSTRATIONS.fingerprint,
      };
    case 'face':
      return {
        title: ios ? t('Face ID') : t('Face recognition'),
        line: t("We ask for your face whenever we need to be sure it's you."),
        illustration: ILLUSTRATIONS.face,
      };
    case 'iris':
      return {
        title: t('Iris scan'),
        line: t("We ask for an iris scan whenever we need to be sure it's you."),
        illustration: ILLUSTRATIONS.face,
      };
    case 'multiple':
      return {
        title: t('Biometrics'),
        line: t("We ask for your face or fingerprint whenever we need to be sure it's you."),
        illustration: ILLUSTRATIONS.face,
      };
    case 'device-pin':
      return {
        title: t('Device PIN'),
        line: t("We ask for your PIN, pattern or password whenever we need to be sure it's you."),
        illustration: ILLUSTRATIONS.devicePin,
      };
    default:
      return {
        title: t('Device unlock'),
        line: t("We ask you to unlock your phone whenever we need to be sure it's you."),
        illustration: ILLUSTRATIONS.devicePin,
      };
  }
}
