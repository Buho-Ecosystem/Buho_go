import { boot } from 'quasar/wrappers'
import { useWalletStore } from 'stores/wallet'
import { loadSavedWalletsAtStart } from 'src/utils/walletHydration'

/**
 * Wallet store boot file.
 *
 * Loads the saved wallets and settings before anything reads them: the route
 * guards, the boot tasks after this one and the first screen. They see the
 * saved values, and their saves go through: until the load lands, the store
 * refuses to save. Bounded and never throws (see loadSavedWalletsAtStart).
 */
export default boot(() => loadSavedWalletsAtStart(useWalletStore()))
