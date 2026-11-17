# Settings and Security as grouped lists

Status: built November 17, 2026 on `feat/settings-apple-layout`. An arrangement of what was already there: every setting keeps its behaviour, only where it sits and how it reads changed.

[← Feature records](README.md)

## The rule

One grouped list per tab, the way the phone's own Settings reads. A group holds settings that belong together; a short footer under it says what they do, in place of most info buttons. A row shows where its setting stands (value, switch or check). A row with a chevron opens its own page or sheet. Tiles carry one colour per kind of setting with a white glyph, and no icon stands for two things. Captions and group titles use the secondary text colour, which reads at 4.5:1 or more in both themes; the muted colour is for glyphs such as the chevron.

## Settings (`pages/Settings.vue`)

| Group | Rows | Footer says |
|---|---|---|
| Large title | "Settings"; the bar has no title (hub headers scroll with the page) | |
| Wallets | Total (2+ wallets), one row per wallet, Add wallet | which kinds live on this phone, which are connected, and what brings them back |
| Other recovery phrase | Wallets set aside on another phrase (only when there are some) | how to keep their money |
| (features) | Auto-Transfer, Kiosk Mode | what each does |
| (this phone) | Notifications, App lock, Screen Privacy | App lock falls back to the phone's PIN, pattern or password |
| (look and feel) | Display, Language, Currency, Haptics, Quick access | what Haptics and Quick access do |
| (payments) | Default wallet, Transaction report | what each is for |
| Advanced | one row, opens a sheet: Exchange rates, Business check, Danger Zone | |

- **Wallet rows** wear the wallet's real logo on a tile in its brand colour (`components/settings/WalletLogoTile.vue`, the marks from `WalletBrandMark`): Spark white on black, NWC orange and violet on deep indigo, LNbits magenta on deep plum, Arkade on the theme's Arkade tile. The caption is the kind ("Spark", "NWC"), then one state: Active, what came in since the user last looked, Connection ended, or Offline. Online means what the wallet page means (`isWalletLive`: set up, connection not ended, an NWC wallet answering), so the row, the total and the page agree. The balance follows the switcher's rules: a placeholder until the first figure, dimmed when known to be out of date. What came in is spoken through `HiddenAmount`, so with balances hidden a screen reader hears "Amount hidden", never the figure.
- **Total** uses `walletStore.totalBalanceInfo`: the wallet rows' placeholder until the first figure is in (`known`), never "at least 0"; then "at least" while a figure is missing, dimmed when one is out of date, pulsing while wallets refresh, hidden with balances. The caption says how many wallets are online, by the same test as the rows.
- **A wallet's page** (`WalletDetailPanel`) opens straight from its row as its own sheet, closed with an x. Besides rename, balance, recovery phrase, use, reconnect and remove, it carries what only that kind has: the Spark Lightning address and Auto-add Bitcoin deposits (one switch for every Spark wallet, said on the row), the Arkade address with copy and share, the LNbits server and its Lightning address from Pay Links (asked of that wallet's server when its page opens, not only for the active wallet; an answer that arrives after the page closed opens nothing). An NWC wallet's address comes from `lightningAddressOf`, which also reads the `lud16` in its connection string. After a wallet leaves this phone, focus goes to Add wallet.
- **Display** (`DisplaySheet.vue`): Appearance, Main unit, Hide balances, Amount format. The sheet only reports choices; Settings owns every setter. Each pick-one group is a `SettingsChoiceGroup`, one radio group: Tab reaches it once, on the current choice, and the arrow keys, Home and End move the choice.
- **Advanced**: removing every wallet of a kind; one wallet leaves from its own page ([Taking a wallet off this phone](WALLET_REMOVAL.md)).
- **Links**: `?section=wallets` (Home's Manage) lands on Settings with the wallets on top; `?section=advanced` opens Advanced once and drops the query, so Back does not reopen it; `?section=quick-access` is unchanged.
- **Kiosk**: the Kiosk row opens the existing Kiosk Mode page; the kiosk boot path does not pass through Settings.

## Security (`pages/SecurityPage.vue`, `components/BackupChoices.vue`)

- No title in the bar: the keyring opens the tab, the same mark as the Home reminder, with "Backup" and a status line in the reminder's words ("Bitcoin not checked yet", "All recovery words are checked"). Both read `pendingBackupLabel` in `utils/backupStatus.js`, so they never disagree.
- **Recovery words**: one row per set of words. All Spark wallets share one phrase, so they are one row that names them ("Main and Savings"); Arkade and Identity follow. The value is Checked or Not checked yet. A row opens the recovery flow, as before.
- **Emergency exit kit** (Spark only), **Google Drive backup** (Android only, cloud tile, "Saved today" / "Out of date" / "Optional" from `cloudBackup.lastBackupAt`), **Restore from backup** as an accent row.

## Checks

- `node scripts/check-settings-layout.mjs` (dev server on port 9120) walks Settings, each wallet page, Display, Advanced and Security in light and dark, and writes pictures to `output/settings-layout/`.
- Wording lives in `i18n/*/settingsLayout.js`.
- On a 320 px phone a wide balance or state moves under a long label instead of over it (wallet rows, Security rows); any label word too long for its row breaks.
