# Quick access

Opening BuhoGO straight on Send, Receive or the scanner from outside the
app, on Android: two Quick Settings tiles and the long-press menu on the app
icon, whose entries can also be dragged onto the Home screen (issues #444,
#445, #446). Settings → Preferences → Quick access explains both and offers
Add buttons.

## One way in

Every tile and shortcut starts `MainActivity` with one link:

```
buhogo://open/<kind>[?contact=<address-book id>]&src=<tile|shortcut>
```

| Kind | Opens |
|---|---|
| `send` | The Send sheet, as Home's Send button |
| `receive` | Receive, as Home's Receive button |
| `scan` | The Send sheet with the camera already open |
| `pay` | Paying one saved contact, as their row in the address book. `contact` is a key from `shortcutKeysOf` (`utils/quickAccessPlan.js`) |
| `quick-access` | Settings with the Quick access sheet (long-pressing a tile) |

`OpenActionIntents.java` builds it and `src/utils/openActions.js` reads it;
the two must stay in step. `src/boot/deep-links.js` hands it to
`services/openActionIntake.js`, after the kiosk intake. The intake waits for
the saved wallets (a cold start) and the app lock, so the page the person is
on is only left for an action that will open. It then hands the action to
`Wallet.vue` through `walletStore.pendingOpenAction` (never saved), which
opens the screen (`openWhenUnlocked`, then `runOpenAction`). Like a tap on
Home, it never waits for the wallets to connect: the sheets show their own
loading. Pay goes through the payment hand-over, which on a cold start waits
for the wallets to connect, as a tap in Payees does; meanwhile a toast says
"Getting ready to pay {name}".

Only the last tap counts: an action still waiting (behind the lock, say) is
dropped when a newer one comes in (`isOpenActionCurrent`).

A link only opens a screen. It carries no amount and no destination other
than a saved contact's id, and it never pays: the person still sees the
screen and confirms. Anything else in it is ignored; an unreadable one is
dropped quietly.

## Rules

- No wallet, or kiosk mode on: the tiles are greyed out, the long-press menu
  is empty, and every pinned shortcut is switched off with the reason the
  launcher shows when it is tapped. A locked kiosk consumes every link before
  it gets here.
- The app lock always comes first, and is the last thing awaited before the
  screen opens, so it cannot come back in between. An action that waited
  behind it for more than two minutes is dropped instead of opening a screen
  out of the blue.
- The scanner closes when the app lock engages (`ScannerOverlay.vue`): while
  the camera runs every other surface is hidden, the lock screen included.
- An action never replaces a payment in progress, a destination still being
  looked up, the request flow, or a sheet with something typed in it
  (`openActionWouldInterrupt`); lighter sheets (Send, Receive, the Redeem
  scanner, the switcher, the menu) are closed first, so screens never stack.
- With the app lock on, the last person paid stays out of the long-press
  menu: it shows outside the lock. A contact the person pinned stays.
- A pinned contact that was removed is switched off with "This contact was
  removed", never deleted: the person put it there, and Android leaves
  removing a pinned icon to the person. It keeps its name and picture.
- A contact's shortcut carries its most lasting key: a hash of its Nostr key
  or of its id in the shared contact list, else its local id. When the
  address book is rebuilt (another identity's list, a restore), contacts come
  back under new local ids, and a pinned shortcut still finds them. No
  publish runs during the rebuild itself.
- Tiles are action tiles, never switches, and never show a balance or a
  name: they are visible on the lock screen. A locked phone asks to unlock
  first.

## Who keeps it current

`composables/useQuickAccessSync.js`, from `App.vue` (the kiosk boot path
never mounts the wallet page). It waits for the saved wallets, then
publishes whenever the wallet, kiosk mode, the app lock, the contacts or the
language change, and on every return to the app. Publishes run one at a
time; one that takes longer than 30 s is given up so the next is never held
behind it. On the native side the menu and the switched-off shortcuts land
first; pinned contacts' pictures are fetched last. `utils/quickAccessPlan.js`
decides what to publish; `services/quickAccess.js` carries it to
`QuickAccessPlugin.java`.

The tiles read their state from `SharedPreferences` (`BuhoGoQuickAccess`,
`QuickAccessState.java`), so they work while the app is not running. Until
the app has written it, they are greyed out. It is left out of Android's
backup (`res/xml/backup_rules.xml`, `data_extraction_rules.xml`): which tiles
were added belongs to this phone.

## Native pieces

| File | Role |
|---|---|
| `QuickAccessPlugin.java` | Publishes shortcuts, offers pins and tiles, reports use for ranking |
| `SendTileService.java`, `ReceiveTileService.java` | The tiles (`ActionTileService.java`) |
| `QuickAccessSettingsActivity.java` | Long-press on a tile: opens Quick access in Settings |
| `ShortcutIcons.java` | Bundled icons, and a contact's picture: https only, 2 MB, one 8 s deadline, failures not retried for 10 min |
| `res/drawable*/ic_shortcut_*`, `ic_tile_*` | Adaptive icons with a monochrome layer, pre-8 fallbacks |

Shortcuts are dynamic, not declared in the manifest: manifest shortcuts
restart the app's task, dynamic ones reach the running app in `onNewIntent`
and keep its state.

An activity that Android recreates (the font size changed, the app reopened
from Recents after it was stopped) is handed its last intent again;
`MainActivity` drops an open link from it, so a tile's screen does not open
a second time.

## Notes

- The launcher marks a pinned shortcut with the app icon, so the app icon
  is part of this: its mark (`drawable/ic_launcher_mark.xml`) sits inside
  the 66dp circle every launcher shape keeps, and is also the monochrome
  layer for themed icons. The legacy PNGs (Android 7) are rendered from the
  same paths.
- Add a tile (Android 13 and newer) uses the system's own dialog. Android
  may stop showing it after it was declined a few times, so the sheet always
  says how to add a tile by hand.
- Checks: `src/utils/__tests__/openActions.spec.js`,
  `src/utils/__tests__/quickAccessPlan.spec.js`, and the open-link case in
  `src/boot/__tests__/deepLinkCards.spec.js`. On a device,
  `adb shell dumpsys shortcut` lists what was published and pinned.
