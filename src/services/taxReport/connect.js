/**
 * Opening the wallets a report covers, and putting them back afterwards.
 *
 * The app keeps exactly ONE wallet live at a time. At boot it connects the
 * active wallet and no others, and `connectAllSparkWallets()` tears down every
 * non-active Spark provider so a single Spark session holds the shared SDK
 * auth channel. A report over several wallets therefore has to open them
 * itself, one at a time, and leave the app as it found it.
 *
 * Three rules this module exists to hold:
 *
 *   - SPARK IS EXCLUSIVE. Two live Spark providers is the state that costs the
 *     active wallet its session on Android. So before opening a Spark wallet
 *     that is not the active one, the live Spark provider is torn down first,
 *     and when the report is finished the app's own invariant is restored.
 *   - WHAT WE OPEN, WE CLOSE. Every connection this module makes is closed by
 *     `restore()`, with one deliberate exception: the wallet the user is
 *     actually on. Closing that would leave someone staring at a disconnected
 *     wallet because they generated a report.
 *   - THE USER'S WALLET COMES BACK. `restore()` runs whether the report
 *     succeeded, failed or was cancelled.
 *
 * NWC is opened directly rather than through the store. The store connects an
 * NWC wallet by keeping a raw `NostrWebLNProvider` on its connection state and
 * files nothing under `providers`, so asking it to connect would open a second
 * relay connection that nothing closes and that still could not be read from.
 * The class that can be read (`providers/NWCWalletProvider.js`) already exists
 * and simply is not wired into the store.
 *
 * Takes the wallet store rather than importing it, so the sequencing can be
 * tested against a fake.
 */

const SPARK = 'spark';

/**
 * Wallet types the store connects without filing anything readable under
 * `providers`. For these the report builds its own provider and owns its
 * lifetime.
 */
const STORE_FILES_NO_PROVIDER = new Set(['nwc']);

/** Builds a standalone provider for a wallet the store files nowhere. */
const defaultCreateProvider = async (wallet) => {
  const { createWalletProvider } = await import('../../providers/WalletFactory');
  return createWalletProvider(wallet);
};

/**
 * @param {object} store the wallet store. `providers`, `wallets`,
 *   `activeWalletId` and `connectWallet` are required. `disconnectWallet`,
 *   `_disconnectSparkProvider` and `connectAllSparkWallets` are called
 *   defensively: a store without them can still produce a report, it just
 *   cannot tidy up after one, and failing the report over that would be worse
 *   than the untidiness.
 * @param {object} [deps]
 * @param {(wallet) => Promise<object>} [deps.createProvider] injected for tests
 * @returns {{
 *   connect: (wallet) => Promise<object|null>,
 *   restore: () => Promise<void>,
 *   order: (wallets: object[]) => object[],
 * }}
 */
export function createReportConnector(store, { createProvider = defaultCreateProvider } = {}) {
  /** Whether we moved the Spark connection off where the user left it. */
  let sparkMoved = false;
  /** Providers this report built itself and therefore has to close. */
  const borrowed = [];
  /** Wallet ids we asked the STORE to connect, so we can ask it to disconnect. */
  const opened = new Set();

  const isLive = (walletId) =>
    typeof store?.providers?.[walletId]?.getTransactions === 'function';

  /**
   * Read the already-live wallet first.
   *
   * It costs nothing, so its rows are in hand before anything can go wrong
   * with a wallet that has to be opened. It also means the common case (one
   * wallet, already connected) never touches a connection at all.
   */
  function order(wallets = []) {
    const activeId = store?.activeWalletId;
    const live = [];
    const rest = [];
    for (const w of wallets) {
      if (w?.id === activeId || isLive(w?.id)) live.push(w);
      else rest.push(w);
    }
    return [...live, ...rest];
  }

  /** Build and open a provider this module owns. */
  async function openOwnProvider(wallet) {
    const own = await createProvider(wallet);
    if (typeof own?.getTransactions !== 'function') return null;
    await own.connect?.();
    borrowed.push(own);
    return own;
  }

  async function connect(wallet) {
    const id = wallet?.id;
    if (!id) return null;
    if (isLive(id)) return store.providers[id];

    if (STORE_FILES_NO_PROVIDER.has(wallet.type)) return openOwnProvider(wallet);

    // A Spark wallet that is not the live one can only be opened after the
    // live one is closed; the SDK holds a single authenticated channel.
    if (wallet.type === SPARK) {
      for (const key of Object.keys(store.providers || {})) {
        if (key === id) continue;
        const other = (store.wallets || []).find((w) => w.id === key);
        if (other?.type === SPARK) {
          await store._disconnectSparkProvider?.(key);
        }
      }
      sparkMoved = true;
    }

    await store.connectWallet(id);
    opened.add(id);

    const filed = store.providers?.[id];
    return typeof filed?.getTransactions === 'function' ? filed : null;
  }

  /**
   * Close everything this report opened and put the app back on the
   * connection the user was using.
   *
   * Safe to call more than once and from more than one place: the sheet calls
   * it from the run's own `finally`, and the run may already have been
   * abandoned by a dismissal.
   */
  async function restore() {
    // Providers we built ourselves, first: an NWC relay connection left
    // running behind a finished report is the one that keeps costing.
    while (borrowed.length) {
      try {
        await borrowed.pop().disconnect?.();
      } catch {
        // Already gone, or never fully up. Nothing to recover.
      }
    }

    // Wallets the store opened for us. Never the active one: the user is
    // looking at it, and disconnecting it to tidy up after a report they
    // asked for would be a worse outcome than leaving it connected.
    for (const id of opened) {
      if (id === store?.activeWalletId) continue;
      try {
        await store.disconnectWallet?.(id);
      } catch {
        // Same reasoning: the report is written, this is housekeeping.
      }
    }
    opened.clear();

    if (!sparkMoved) return;
    sparkMoved = false;
    try {
      // The store's own way of asserting the single-session invariant, so the
      // report restores the app exactly the way a wallet switch does rather
      // than inventing a second way to do the same thing.
      await store.connectAllSparkWallets?.();
    } catch {
      // The report is already written by this point. A failed restore is a
      // reconnect the app does on its own next time the wallet is used, and
      // is not worth failing a finished report over.
    }
  }

  return { connect, restore, order };
}
