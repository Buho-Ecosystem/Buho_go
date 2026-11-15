# Pay from another wallet

Someone with BuhoGO and another wallet app on the same phone can move money into BuhoGO in two taps. Receive offers **Pay from another wallet**; it opens that other app with the request, amount included. The person confirms there. BuhoGO keeps waiting and announces the payment as for any other.

It's the reverse of [payment links that open BuhoGO](PAYMENT_LINKS.md): there a checkout opens BuhoGO, here BuhoGO opens another wallet.

[← Feature records](README.md)

## What the person sees

- **One row on Receive**, built like the voucher row: the other apps' own icons, stacked, and their names ("Phoenix and BlueWallet"). It shows only while at least one such app is installed. On the web it never shows. While the keypad is up it steps aside.
- **The sheet**, opened by the row: a grabber, **Done**, the title, one line naming the amount ("The wallet you pick opens with ₿ 21,000 to pay. BuhoGO shows it here once it arrives."), and the apps as icons in a grid of four, the way the share sheet lists apps. The app picked last comes first, marked **Last used**.
- **Tapping an app** opens it with the request and the sheet steps away. If the app doesn't open (removed meanwhile), the sheet says so in words ("Phoenix didn't open.") with **Copy payment code** under it, which copies the code on screen the way Receive's own Copy does and closes the sheet.
- **Without an amount**, the row asks for the amount first, since another wallet needs something to pay. On Android the sheet follows as soon as the invoice exists. On iPhone it opens only from a tap: the person sees the new invoice and taps the row again (`sheetFollowsAmount`, `createAmountWait` in `services/walletApps.js`).
- **Before the amount**, the row already shows the apps for the kind of request Receive will hand over (`ReceiveModal.payFromWalletKind`): an invoice, or Arkade's unified Bitcoin request.
- **Coming back to BuhoGO** looks again, since an app may have been installed or removed meanwhile.

The row is the shared disclosure row and the sheet the shared info sheet (`css/app.css`), the same as Receive's voucher row and the Spark status sheet.

Kiosk mode never shows the row. A register's customers pay from their own phones, and the kiosk doesn't use Receive.

## What is handed over

`ReceiveModal.payFromWalletRequest`:

- `lightning:<invoice>` whenever there is an invoice with an amount, **in lower case**. An invoice reads the same in either case, and Alby Go only recognises lower case.
- Otherwise (Arkade without its Lightning rail) the unified `bitcoin:` request with its amount.
- Nothing while there is no amount.

## Android

The system knows which apps take a `lightning:` or `bitcoin:` link, so no list is needed (`WalletAppsPlugin.handlers`).

- **Package visibility:** the manifest's `<queries>` declares both schemes (Android 11+).
- **Icons:** each app arrives with its own name and launcher icon. Adaptive icons are drawn from their layers, unmasked, so every icon is a full square that the sheet rounds alike. Drawn whole, an icon carries the phone's mask, often a circle.
- **Opening:** `WalletAppsPlugin.open` opens the request in the chosen app by package (`setPackage`). The chooser never appears, and BuhoGO itself is never listed. Both platforms' plugins share one contract, written down once in `services/walletApps.js`.
- **Web-link wallets:** a wallet that is opened by a web link (Cash App) is looked up by its package (`androidPackage`, also declared in `<queries>`) and opened by package, so it can never open the browser instead.

## iPhone

iOS can't list the apps for a scheme. `utils/walletAppLinks.js` lists the wallets BuhoGO can open by their own link, and `WalletAppsPlugin.installed` asks `canOpenURL` about each.

- **Which schemes:** iOS answers only for schemes in `Info.plist`'s `LSApplicationQueriesSchemes` (`QUERIED_SCHEMES`; the spec keeps both lists equal). Any other scheme reads as not installed. Apps linked on iOS 15 or later may list 50, apps linked on iOS 27 or later 25 ([`canOpenURL(_:)`](https://developer.apple.com/documentation/uikit/uiapplication/canopenurl(_:))); `MAX_QUERIED_SCHEMES` holds the lower one.
- **No plain links:** a plain `lightning:` link is never handed to iOS. With several wallets installed, which one it opens is undefined, possibly BuhoGO.
- **Web links:** a web-link wallet is found by the schemes that reveal it (`detect`) and opened with `universalLinksOnly`: the app or nothing, never Safari.
- **System prompt:** iOS may ask before it opens the other app ("BuhoGO wants to open Phoenix"). That's the system, not BuhoGO.

## The wallets (iPhone)

Each wallet reads the request in its own form (`LINK_FORM`):

| Form | Shape | Example |
|---|---|---|
| prefix | `<scheme>:<request>` | `phoenix:lightning:lnbc…` |
| slashes | `<scheme>://<request>` | `bitkit://lightning:lnbc…` |
| bare | `<scheme>:<request minus its scheme>` | `muun:lnbc…` |
| bare-slashes | `<scheme>://<request minus its scheme>` | `river://lnbc…` |
| pay-link | `<scheme>://pay?request=<URL-encoded request>` | `coinsnap://pay?request=lightning%3Alnbc…` |
| web | `<web link><request minus its scheme>` | `https://cash.app/launch/lightning/lnbc…` |

How sure each link is:
- **Own code:** read in the wallet's own source.
- **Vendor:** published by the vendor.
- **Checkouts:** only seen in other apps' wallet lists (Zaprite's checkout, Damus, Wavlake, 0xchat, Nostur).

| Wallet | Link | Pays | Source | Note |
|---|---|---|---|---|
| Alby Go | `alby:lightning:` | Lightning | Own code (`lib/link.ts`) | Lower-case invoices only |
| AQUA | `aqua:lightning:` | Lightning, on-chain | Own code (`deep_link_provider.dart`) | |
| Bitkit | `bitkit://lightning:` | Lightning, on-chain | Own code (bitkit-core scanner) | The slashes are required; `bitkit:lightning:` fails |
| Blink | `blink:<invoice>` | Lightning | Own code (`deep-link-screens.ts`) | Bare invoice only; the router splits a query string |
| Blitz Wallet | `blitz:lightning:` | Lightning, on-chain | Own code (`App.tsx`) | |
| Blixt | `blixtwallet:lightning:` | Lightning | Own code (`DeeplinkManager.ts`) | iPhone build on TestFlight only |
| BlueWallet | `bluewallet:lightning:` | Lightning, on-chain | Own code (`deeplink-schema-match.ts`) | Lightning needs the person's own LNDHub |
| Cake Wallet | `cakewallet:<invoice>`, `cakewallet:<address>?amount=…` | Lightning, on-chain | Own code (`payment_request.dart`, `anypay_parser.dart`) | Lightning runs on Breez SDK Spark inside Cake's Bitcoin wallet. A link goes to the wallet open in Cake, so a Monero wallet left open needs a switch first. `cakewallet:bitcoin:` would reach it with `bitcoin:bc1…` as the address |
| Cash App | `https://cash.app/launch/lightning/` | Lightning | Vendor (cash.app's AASA file) | Found by `squarecash://` or `cashme://`, neither confirmed on a device |
| Coinsnap | `coinsnap://pay?request=` | Lightning, on-chain | Coinsnap issue #140 | Works once Coinsnap ships that link |
| Glow (Breez) | `glow:lightning:` | Lightning | Own code (glow-web `deepLink.ts`) | Breez's current app |
| Manna | `manna:lightning:` | Lightning, on-chain | Checkouts (Zaprite) | |
| Muun | `muun:<request minus its scheme>` | Lightning, on-chain | Own code (libwallet `address.go`) | `muun:lightning:` turns into `lightning:lightning:` and fails |
| Phoenix | `phoenix:lightning:` | Lightning | Own code (`SceneDelegate.swift`) | |
| River | `river://<invoice>` | Lightning | Checkouts (Damus, Wavlake) | |
| Strike | `strike:lightning:` | Lightning, on-chain | Checkouts (Zaprite, Wavlake) | Damus uses `strike:<invoice>`; settle on a device |
| Wallet of Satoshi | `walletofsatoshi:lightning:` | Lightning, on-chain | Checkouts (five apps agree) | |
| ZBD | `zebedee:lightning:` | Lightning | Checkouts (Zaprite, Damus) | |
| ZEUS | `zeusln:lightning:` | Lightning, on-chain | Own code (`AddressUtils.ts`) | |

**Left out on iPhone:**
- **No link of their own:** Minibits, Speed, Fountain, Fedi, Tando, Bitnob. They are still listed on Android when installed.
- **No way to hand them an invoice:** Primal, Bull Bitcoin.
- **Gone:** Breez classic, Misty Breez (replaced by Glow), Mutiny, eNuts.

On Android every installed wallet that takes the link is listed, these included.

## Adding a wallet

1. One entry in `utils/walletAppLinks.js`: id, name, scheme, form, what it pays.
2. Its scheme in `Info.plist`'s `LSApplicationQueriesSchemes` (or its `detect` schemes, for a web-link wallet).
3. Its icon at `public/wallet-apps/<id>.png`, 180 px square: the App Store icon, or the app's own icon from its repository.
4. A web-link wallet also needs its Android package in the manifest's `<queries>`.

`src/utils/__tests__/walletAppLinks.spec.js` fails until all of these agree.

## Testing

- **Unit tests:** `src/services/__tests__/walletApps.spec.js` (finding, ordering, opening, both platforms) and `src/utils/__tests__/walletAppLinks.spec.js` (the catalog against `Info.plist`, the manifest and the icons, and every link form).
- **Android emulator:** install real wallets (Phoenix and BlueWallet release APKs), then Receive → the row → an amount. Checked:
  - The sheet followed the new invoice by itself, with no toast.
  - Phoenix opened directly, with no chooser, on its pay screen with the amount and BuhoGO's invoice.
  - **Last used** moved Phoenix first.
- **iOS simulator:** real wallets can't be installed there. A small test app that answers a few wallet schemes and shows the link it was opened with stands in for them. Checked:
  - The sheet stayed closed after the new invoice and opened from a tap on the row.
  - It listed exactly the wallets whose schemes the test app answers (Blixt, Cash App, Coinsnap, Muun, Phoenix, River).
  - River, tapped in the sheet, opened the test app with `river://<invoice>`.
  - Coinsnap's link carried the whole request, intact after one decode.
  - Cash App, whose web link no app claimed, reported "didn't open" without opening Safari.
- **Still open:** a real iPhone with real wallets, above all Strike, Wallet of Satoshi, ZBD and Cash App, whose links come from other apps' lists or are unconfirmed.
