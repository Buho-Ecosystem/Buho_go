/**
 * Keeps emergency exits moving. An exit spans days: whenever the app is
 * open, every active exit is checked against the chain and its next
 * packages go out. Broadcasting needs no Spark connection, only the ledger
 * and an Esplora endpoint, so this runs even while Spark is unreachable.
 *
 * Also starts the Spark reachability checks behind the Home status line
 * (#381). They only run while a Spark wallet exists.
 */
import { boot } from 'quasar/wrappers';
import { useWalletStore } from '../stores/wallet';
import { useEmergencyExitStore } from '../stores/emergencyExit';
import { useExitKitStore } from '../stores/exitKit';
import { attachEmergencyExitStore, attachExitKitStore, attachExitWalletStore, startExitMonitor } from '../services/emergencyExit.js';
import { attachWalletStore as attachKitWalletStore } from '../services/exitKit.js';
import { startReachabilityChecks } from '../services/sparkReachabilityCheck.js';

const FIRST_PASS_DELAY_MS = 8000;

export default boot(() => {
  // The exit driver takes its stores from here, so it imports none.
  attachKitWalletStore(useWalletStore);
  attachExitWalletStore(useWalletStore);
  attachEmergencyExitStore(useEmergencyExitStore);
  attachExitKitStore(useExitKitStore);
  if (typeof window === 'undefined' || window.__AUDIT__?.noExitMonitor) return;
  startReachabilityChecks({ isEnabled: () => (useWalletStore().sparkWallets || []).length > 0 });
  // Always on: a pass with no active exit costs nothing, and an exit
  // started later in this session must keep moving without a restart.
  setTimeout(() => startExitMonitor(), FIRST_PASS_DELAY_MS);
});
