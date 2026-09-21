/**
 * Keeps emergency exits moving. An exit spans days: whenever the app is
 * open, every active exit is checked against the chain and its next
 * packages go out. Broadcasting needs no Spark connection, only the ledger
 * and an Esplora endpoint, so this runs even while Spark is unreachable.
 */
import { boot } from 'quasar/wrappers';
import { useWalletStore } from '../stores/wallet';
import { useEmergencyExitStore } from '../stores/emergencyExit';
import { attachEmergencyExitStore, attachExitWalletStore, startExitMonitor } from '../services/emergencyExit.js';
import { attachWalletStore as attachKitWalletStore } from '../services/exitKit.js';

const FIRST_PASS_DELAY_MS = 8000;

export default boot(() => {
  // Both services take their stores from here, so neither imports a store.
  attachKitWalletStore(useWalletStore);
  attachExitWalletStore(useWalletStore);
  attachEmergencyExitStore(useEmergencyExitStore);
  if (typeof window === 'undefined' || window.__AUDIT__?.noExitMonitor) return;
  // Always on: a pass with no active exit costs one reachability probe, and
  // an exit started later in this session must keep moving without a restart.
  setTimeout(() => startExitMonitor(), FIRST_PASS_DELAY_MS);
});
