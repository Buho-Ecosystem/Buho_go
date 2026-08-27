/**
 * Opening the wallets a report covers, and putting them back afterwards.
 *
 * The app keeps exactly ONE wallet live at a time. At boot it connects the
 * active wallet and no others, and `connectAllSparkWallets()` tears down every
 * non-active Spark provider so a single Spark session holds the shared SDK
 * auth channel. A report over several wallets therefore has to open them
 * itself, one at a time, and leave the app as it found it.
 *
 * Two rules this module exists to hold:
 *
 *   - SPARK IS EXCLUSIVE. Two live Spark providers is the state that costs the
 *     active wallet its session on Android. So before opening a Spark wallet
 *     that is not the active one, the live Spark provider is torn down first,
 *     and when the report is finished the app's own invariant is restored.
 *   - THE USER'S WALLET COMES BACK. Generating a report must not leave someone
 *     on a different connection than the one they were using. `restore()` is
 *     called whether the report succeeded, failed or was cancelled.
 *
 * NWC needs a provider of its own. The store connects an NWC wallet by keeping
 * a raw `NostrWebLNProvider` on its connection state and never files anything
 * under `providers`, so there is nothing there with a `getTransactions` on it.
 * The class that has one (`providers/NWCWalletProvider.js`) already exists and
 * is simply not wired into the store, so this opens one for the length of the
 * report and closes it afterwards rather than reimplementing `listTransactions`
 * for a third time.
 *
 * Takes the wallet store rather than importing it, so the sequencing can be
 * tested against a fake.
 */

const SPARK = 'spark';

/** Builds a standalone provider for a wallet the store files nowhere. */
const defaultCreateProvider = async (wallet) => {
  const { createWalletProvider } = await import('../../providers/WalletFactory');
  return createWalletProvider(wallet);
};

/**
 * @param {object} store the wallet store (needs `providers`, `activeWalletId`,
 *   `connectWallet`, and for Spark `_disconnectSparkProvider` +
 *   `connectAllSparkWallets`)
 * @param {object} [deps]
 * @param {(wallet) => Promise<object>} [deps.createProvider] injected for tests
 * @returns {{ connect: (wallet) => Promise<object|null>, restore: () => Promise<void>, order: (wallets) => object[] }}
 */
export function createReportConnector(store, { createProvider = defaultCreateProvider } = {}) {
  /** Whether we moved the Spark connection off where the user left it. */
  let sparkMoved = false;
  /** Providers this report opened itself and therefore has to close. */
  const borrowed = [];

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

  async function connect(wallet) {
    const id = wallet?.id;
    if (!id) return null;
    if (isLive(id)) return store.providers[id];

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
    const filed = store.providers?.[id];
    if (typeof filed?.getTransactions === 'function') return filed;

    // NWC lands here: connected, but with nothing that can be read from.
    const own = await createProvider(wallet);
    if (typeof own?.getTransactions !== 'function') return null;
    await own.connect?.();
    borrowed.push(own);
    return own;
  }

  /**
   * Put the app back on the connection the user was using.
   *
   * Only Spark needs it: `connectAllSparkWallets()` is the store's own way of
   * asserting the single-session invariant, so calling it here means the
   * report restores the app exactly the way a wallet switch does, rather than
   * inventing a second way to do the same thing.
   */
  async function restore() {
    // Close anything this report opened for itself before touching Spark, so
    // a relay connection is not left running behind a finished report.
    while (borrowed.length) {
      try {
        await borrowed.pop().disconnect?.();
      } catch {
        // Already gone, or never fully up. Nothing to recover.
      }
    }

    if (!sparkMoved) return;
    sparkMoved = false;
    try {
      await store.connectAllSparkWallets?.();
    } catch {
      // The report is already written by this point. A failed restore is a
      // reconnect the app does on its own next time the wallet is used, and
      // is not worth failing a finished report over.
    }
  }

  return { connect, restore, order };
}
