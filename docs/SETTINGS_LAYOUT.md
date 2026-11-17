# Settings and Security as grouped lists

Status: built November 17, 2026 on `feat/settings-apple-layout`. An arrangement of what was already there: every setting keeps its behaviour, only where it sits and how it reads changed.

[← Feature records](README.md)

## The rule

One grouped list per tab, the way the phone's own Settings reads. A group holds settings that belong together; a short footer under it says what they do, in place of info buttons. A row shows where its setting stands (value, switch or check). A row with a chevron opens its own page or sheet. Tiles carry one colour per kind of setting with a white glyph, and no icon stands for two things.

## Settings (`pages/Settings.vue`)

| Group | Rows | Footer says |
|---|---|---|
| Large title | "Settings"; the bar shows the small title once it scrolls away | |
| Wallets | Total (2+ wallets), one row per wallet, Add wallet | where wallets live and what brings them back |
| Other recovery phrase | Wallets set aside on another phrase (only when there are some) | how to keep their money |
| (features) | Auto-Transfer, Kiosk Mode | what each does |
| (this phone) | Notifications, App lock, Screen Privacy | App lock falls back to the phone's PIN, pattern or password |
| (look and feel) | Display, Language, Currency, Haptics, Quick access | what Haptics and Quick access do |
| (payments) | Default wallet, Transaction report | what each is for |
| Advanced | one row, opens a sheet: Exchange rates, Business check, Danger Zone | |

- **Wallet rows** wear the wallet's real logo on a tile in its brand colour (`components/settings/WalletLogoTile.vue`, the marks from `WalletBrandMark`): Spark white on black, NWC orange and violet on deep indigo, LNbits magenta on deep plum, Arkade on the theme's Arkade tile. The caption is the kind ("Spark", "Connected · NWC"), then one state: Active, what came in since the user last looked, Connection ended, or Offline. The balance follows the switcher's rules: a placeholder until the first figure, dimmed when known to be out of date.
- **Total** uses `walletStore.totalBalanceInfo`: "at least" while a figure is missing, dimmed when one is out of date, pulsing while wallets refresh, hidden with balances. The caption says how many wallets answer.
- **A wallet's page** (`WalletDetailPanel`) opens straight from its row as its own sheet, closed with an x. Besides rename, balance, recovery phrase, use, reconnect and remove, it carries what only that kind has: the Spark Lightning address and Auto-add Bitcoin deposits (one switch for every Spark wallet, said on the row), the Arkade address with copy and share, the LNbits server and its Lightning address from Pay Links (asked of that wallet's server when its page opens, not only for the active wallet).
- **Display** (`DisplaySheet.vue`): Appearance, Main unit, Hide balances, Amount format. The sheet only reports choices; Settings owns every setter.
- **Advanced**: removing every wallet of a kind; one wallet leaves from its own page ([Taking a wallet off this phone](WALLET_REMOVAL.md)).
- **Links**: `?section=wallets` (Home's Manage) lands on Settings with the wallets on top; `?section=advanced` opens Advanced; `?section=quick-access` is unchanged.
- **Kiosk**: the Kiosk row opens the existing Kiosk Mode page; the kiosk boot path does not pass through Settings.

## Security (`pages/SecurityPage.vue`, `components/BackupChoices.vue`)

- No title in the bar: the keyring opens the tab, the same mark as the Home reminder, with "Backup" and a status line in the reminder's words ("Bitcoin not checked yet", "Every backup is checked"). Both read `walletBackupGroups`, so they never disagree.
- **Recovery words**: one row per set of words. All Spark wallets share one phrase, so they are one row that names them ("Main and Savings"); Arkade and Identity follow. The value is Checked or Not checked yet. A row opens the recovery flow, as before.
- **Emergency exit kit** (Spark only), **Google Drive backup** (Android only, cloud tile, "Saved today" / "Out of date" / "Optional" from `cloudBackup.lastBackupAt`), **Restore from backup** as an accent row.

## Checks

- `node scripts/check-settings-layout.mjs` (dev server on port 9120) walks Settings, each wallet page, Display, Advanced and Security in light and dark, and writes pictures to `output/settings-layout/`.
- Wording lives in `i18n/*/settingsLayout.js`.
