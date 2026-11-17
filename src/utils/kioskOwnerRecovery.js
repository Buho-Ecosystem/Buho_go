import { authenticate, isBiometricAvailable } from './biometric.js';

/** Recovery uses the existing native device-authentication sheet; browsers fail closed. */
export async function verifyKioskOwner({ availability = isBiometricAvailable, verify = authenticate } = {}) {
  try {
    const capability = await availability();
    if (!capability?.available) return false;
    return await verify({ reason: 'Unlock register owner settings', title: 'BuhoGO',
      subtitle: 'Unlock register owner settings', useFallback: true }) === true;
  } catch { return false; }
}
