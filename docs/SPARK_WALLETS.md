# Spark wallets: one recovery phrase, up to six wallets

Implementation record for the move from a fixed Business/Personal pair to equal Spark wallets.

## Model

- Every Spark wallet is the same recovery phrase opened at a different Breez account number (`SdkBuilder.withAccountNumber`). There are six slots, accounts 0 to 5. They are allocated in the order 1, 2, 3, 4, 5, 0 (`src/utils/sparkAccounts.js`, `SPARK_ACCOUNT_ORDER`).
  - Account 1 comes first: it is the SDK's mainnet default and what every install has used since the pair.
  - Account 0 comes last: older restores already sit there.
- A new install creates one wallet, account 1, named "Wallet". More are added from Settings. Each added wallet takes the lowest free account.
- Slots are deterministic. A removed wallet that is added again opens the same account, with its history and its reserved Lightning address.
- Wallets have no roles. Kiosk has its own wallet picker (`kioskWalletId`).
- Each wallet entry holds its own device-key envelope of the same phrase (`connectionData.encryptedMnemonic`). There is no shared seed record.
- All Spark wallets stay connected (#285). Each has its own Breez instance and IndexedDB (`breez-<walletId>`), and its own lifecycle coordinator (`src/services/sparkLifecycle.js`).

## Rules (where they live)

| Rule | Where |
|---|---|
| Slots, next account, limit, restore evidence, default names | `src/utils/sparkAccounts.js` |
| Wallet names: trimmed, at most 32 characters, unique (case-blind) | `src/utils/walletNames.js` |
| When a wallet may be removed, and the wording | `src/utils/walletRemoval.js` |
| One-time migration of saved installs | `src/utils/sparkWalletMigration.js` |
| Drive backup wallet list | `src/utils/sparkBackup.js` |
| Exit keys per account | `src/utils/exitKeys.js` (see `docs/EMERGENCY_EXIT.md`) |
| Auto-transfer rules from former pockets | `src/utils/autoWithdrawKeys.js` |

The store (`src/stores/wallet.js`) applies these rules. Membership changes run one at a time through `serializeSparkMembership`: create, restore, add, discovery adds and removals. Two of them can never claim the same account.

## Store actions

- `createSparkWallet({ mnemonic })`: the first wallet. Throws `SPARK_WALLET_EXISTS` when Spark is already set up.
- `addSparkWallet({ name })`:
  - Takes the next free account and connects it; a failed connect undoes the entry.
  - Switches to the new wallet.
  - The new wallet inherits the phrase's backup state.
  - Errors: `SPARK_WALLET_LIMIT`, `WALLET_NAME_*`.
- `restoreSparkWallets({ mnemonic, accounts? })`:
  - Creates the listed accounts now, or account 1 when none are listed, and queues every other account for discovery.
  - On a device that already holds this phrase, it only adds what is missing.
  - A different phrase is refused (`SPARK_OTHER_PHRASE`).
- `discoverSparkAccounts()`:
  - Checks the queued accounts with throwaway SDK probes (`src/services/sparkAccountScan.js`, two at a time).
  - Adds a wallet only on evidence of use: a balance, a payment, an unclaimed deposit, or a registered Lightning address.
  - An account whose probe failed, or was unsynced and empty, stays queued in `sparkDiscovery` (persisted). It resumes on the next start and is given up after five starts.
  - Discovery started for one phrase never adds wallets after that phrase left the device (`sparkPhraseEpoch`).
- `removeWallet(id)` removes exactly one wallet, after `removalCheckFor(id)`:
  - no removal while an emergency exit or an incoming deposit is under way;
  - a funded wallet is emptied first (Settings offers Move funds);
  - the last Spark wallet goes only with a backed-up phrase, unless it is empty.
- `removeSparkFromDevice()` removes every Spark wallet under the last-wallet rules. One cleanup path (`_removeWalletEntry`) handles:
  - engine storage, caches and lifecycle work;
  - exit kit metadata (the kit itself is kept);
  - the auto-transfer rule;
  - a kiosk binding to the wallet.
- `updateWalletName(id, name)`: validated, durable before it resolves, rolled back if the save fails.
- `moveSparkLightningAddress(from, to)`:
  - Uses the Breez address transfer: the source authorises the target's identity key, then the target claims.
  - The target's own address is replaced. The source gets a fresh random name.
  - A refused transfer changes nothing (`LN_ADDRESS_TRANSFER_FAILED`).
  - Address assignments are single-flight per wallet. The SDK's `lightningAddressChanged` event is followed, except for wallets in the middle of a move.

## Migration of saved installs

Runs in `initialize()` until it completes once (`sparkModelVersion` 2):

- Former pairs become two ordinary wallets that keep their names. No Personal is created, nothing is renamed, nothing is purged.
- Pockets (the pre-1.6 model) become wallets on the same phrase.
- `walletGroupId` is dropped.
- Entries on another phrase, or a second entry for the same account, are set aside in `buhoGO_spark_set_aside_v1`. They are never deleted. The kept list then passes the store's persist guard explicitly.
- When a phrase cannot be read yet (an install still on the old PIN encryption), nothing is set aside and the migration waits for a later start.

## Backup and restore

- One phrase covers every Spark wallet. Confirming the backup marks all of them, and new wallets inherit it.
- The Drive payload (still `v: 2`) carries `spark.accounts: [{ accountNumber, name, lud16, sparkAddress }]`. Older apps ignore the field and restore the phrase.
- Restore:
  - Stores the exit kits first.
  - Restores exactly the listed wallets with their names.
  - Reads older backups through their exit kits' account numbers.
  - Finds any other account by discovery.
- Wallet changes notify `cloudBackup.noteWalletsChanged()`. The device that wrote the current backup uploads a fresh one silently. It never does so:
  - after a restore that could not bring everything back;
  - over a backup another phone wrote in the meantime;
  - without a signed-in account.

  A manual backup clears any pause. The Drive sheet says when the copy no longer matches this phone.
- Phrase-only restore checks accounts 1, 2 and 0 to tell Spark from Arkade, then discovers the rest.

## UI

- **Home:** the name chip with the wallet's mark opens `WalletSwitcherSheet`. It shows the total across wallets, one row per wallet, Transfer and Manage. While a restore keeps looking for wallets it says so, and Home announces wallets the restore found.
- **Settings > Manage Wallets:**
  - Add Wallet offers "New Spark wallet" with how many of six are left. The row is hidden at the limit. The sheet is `AddSparkWalletSheet`.
  - A row pushes `WalletDetailPanel`: rename, balance, use, reconnect and remove. For Spark it also shows the wallet's Lightning address, with change and "Move to another wallet" (`MoveLightningAddressSheet`).
- Every user-facing string is in en-US, de and es. The multi-wallet strings live in `src/i18n/<lang>/wallets.js`.

## Validation

- `npm test` includes:
  - `sparkWallets.spec.js`: create, add, limit, restore, discovery, removal, rename, migration.
  - `sparkLightningAddress.spec.js`.
  - `cloudBackup.spec.js`.
  - The pure-rule specs (`sparkAccounts`, `sparkBackup`, `autoWithdrawKeys`, `exitKeys`).
- `node scripts/check-spark-wallets.mjs` drives Home, Settings, add, move address, removal and the tour in the browser. It covers German, dark mode and 320px. `scripts/check-wallet-details.mjs` covers the detail panel.

## Needs a device

- Six live Breez instances on Android: memory, battery, and the 60 s reconcile across six wallets.
- A funded restore across several accounts, including discovery resuming after the app is killed mid-scan.
- A real Lightning address transfer between two wallets on the production domain.
- A Drive backup and restore with the wallet list, on Android with Play services.
