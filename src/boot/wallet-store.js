import { boot } from 'quasar/wrappers'
import { useWalletStore } from 'stores/wallet'
import { loadSavedWalletsAtStart } from 'src/utils/walletHydration'

/**
 * Wallet store boot file.
 *
 * Loads the saved wallets and settings before anything reads or saves them:
 * the route guards, the boot tasks after this one and the first screen. A
 * save replaces everything on disk, so one made before this would replace
 * them. Bounded and never throws (see loadSavedWalletsAtStart).
 */
export default boot(() => loadSavedWalletsAtStart(useWalletStore()))
