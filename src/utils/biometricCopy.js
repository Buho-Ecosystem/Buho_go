/**
 * Shared copy and illustrations for biometric / device-PIN auth flows.
 *
 * Used by any screen that needs to describe what will happen when the
 * native authentication sheet appears (e.g. the recovery-phrase reveal
 * dialog, the app-lock enable dialog). Keeping platform labels in one
 * place prevents iOS Touch ID / Face ID branding from drifting across
 * call sites as new flows are added.
 *
 * The device-PIN branch is treated distinctly: the user will see their
 * lockscreen, not a fingerprint prompt, so it gets its own illustration.
 */
import { Capacitor } from '@capacitor/core';

export const BIOMETRIC_ILLUSTRATION = '/Onboarding wizard spark/storyset-fingerprint-bro.svg';
export const DEVICE_PIN_ILLUSTRATION = '/Onboarding wizard spark/storyset-secure-login-bro.svg';

/**
 * Resolve the label and action phrase to display for a given biometry
 * type on the current platform.
 *
 * @param {string} biometryType  One of 'fingerprint' | 'face' | 'iris' |
 *                               'multiple' | 'device-pin' | 'none'.
 * @param {(key: string) => string} t  Translation function ($t bound).
 * @returns {{
 *   illustration: string,
 *   isDevicePinOnly: boolean,
 *   methodLabel: string,   // noun, e.g. "Touch ID", "Fingerprint"
 *   actionPhrase: string,  // sentence starter, e.g. "Use Touch ID"
 * }}
 */
export function getBiometricMethodCopy(biometryType, t) {
  const platform = Capacitor.getPlatform();
  const isDevicePinOnly = biometryType === 'device-pin';

  let methodLabel;
  let actionPhrase;

  switch (biometryType) {
    case 'fingerprint':
      methodLabel = platform === 'ios' ? t('Touch ID') : t('Fingerprint');
      actionPhrase = platform === 'ios' ? t('Use Touch ID') : t('Use your fingerprint');
      break;
    case 'face':
      methodLabel = platform === 'ios' ? t('Face ID') : t('Face recognition');
      actionPhrase = platform === 'ios' ? t('Use Face ID') : t('Use face recognition');
      break;
    case 'iris':
      methodLabel = t('Iris scan');
      actionPhrase = t('Use iris unlock');
      break;
    case 'multiple':
      methodLabel = t('Biometrics');
      actionPhrase = t('Use your fingerprint or face');
      break;
    case 'device-pin':
      methodLabel = t('Device PIN');
      actionPhrase = t('Use your device PIN, pattern, or password');
      break;
    default:
      methodLabel = t('Device unlock');
      actionPhrase = t('Verify it is you');
  }

  return {
    illustration: isDevicePinOnly ? DEVICE_PIN_ILLUSTRATION : BIOMETRIC_ILLUSTRATION,
    isDevicePinOnly,
    methodLabel,
    actionPhrase,
  };
}
