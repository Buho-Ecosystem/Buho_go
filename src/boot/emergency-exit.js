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

const FIRST_PASS_DELAY_MS = 8000;

export default boot(() => {
  // The wallet store registers itself with the kit service on import; the
  // driver gets both stores here so neither service imports a store.
  attachExitWalletStore(useWalletStore);
  attachEmergencyExitStore(useEmergencyExitStore);
  if (typeof window === 'undefined' || window.__AUDIT__?.noExitMonitor) return;
  setTimeout(() => {
    if (!useEmergencyExitStore().hasActiveExit) return;
    startExitMonitor();
  }, FIRST_PASS_DELAY_MS);
});
