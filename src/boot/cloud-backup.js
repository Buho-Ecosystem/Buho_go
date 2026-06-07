import { boot } from 'quasar/wrappers';
import { Capacitor } from '@capacitor/core';

/**
 * Cloud-backup boot plugin.
 *
 * Wires three things at app start so the rest of the app doesn't need to
 * know cloud backup exists:
 *
 *   1. Calls `cloudBackup.init()` so the OAuth config + cached sign-in
 *      state are ready before any screen probes them. Without this, the
 *      Settings sheet would show a brief "not signed in" flash on first
 *      open even when a refresh token is sitting in localStorage.
 *
 *   2. Subscribes to wallet + identity store actions to fire silent
 *      auto-backups after the moments the spec calls out — wallet
 *      created, mnemonic verified, identity imported. We use Pinia's
 *      `$onAction` rather than having those stores call cloudBackup
 *      directly, which would create a circular import (cloudBackup
 *      already imports wallet and identity).
 *
 *   3. On native, listens for app foreground transitions and triggers a
 *      due-check (auto-backup only fires if >24 h since last). The same
 *      `appStateChange` event is consumed by App.vue for the biometric
 *      lock — registering a second listener is fine; Capacitor delivers
 *      to all of them.
 *
 * All triggers are best-effort: `runAutoBackupIfDue` swallows its own
 * errors so a Drive outage cannot stall a wallet-creation flow.
 */
export default boot(async () => {
  const { useCloudBackupStore } = await import('../stores/cloudBackup.js');
  const { useWalletStore } = await import('../stores/wallet.js');
  const { useIdentityStore } = await import('../stores/identity.js');

  const cloudBackup = useCloudBackupStore();
  await cloudBackup.init();

  const wallet = useWalletStore();
  const identity = useIdentityStore();

  // Spec triggers, "bypassInterval" because these are deliberate one-shot
  // signals — the user *just* created or verified something the backup
  // file doesn't yet reflect, the 24 h gate would defeat the point.
  wallet.$onAction(({ name, after }) => {
    after(() => {
      if (name === 'addSparkWallet' || name === 'confirmBackup') {
        cloudBackup.runAutoBackupIfDue({ bypassInterval: true });
      }
    });
  });

  identity.$onAction(({ name, after }) => {
    after(() => {
      if (name === 'confirmBackup' || name === 'importMnemonic') {
        cloudBackup.runAutoBackupIfDue({ bypassInterval: true });
      }
    });
  });

  if (!Capacitor.isNativePlatform()) return;

  // Foreground-resume periodic check. Lazy-import so the web bundle never
  // pulls @capacitor/app.
  const { App } = await import('@capacitor/app');
  await App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) return;
    // The 24 h gate runs inside runAutoBackupIfDue — passing nothing here
    // lets it apply.
    cloudBackup.runAutoBackupIfDue();
  });
});
