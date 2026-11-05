# Payment links that open BuhoGO

A checkout that lists wallets ("Pay with BuhoGO, Phoenix, Wallet of Satoshi …") needs a link that opens one wallet in particular. A plain `lightning:` or `bitcoin:` link can't do that: the phone picks the wallet (Android: the default or a chooser; iPhone: whichever app claimed the scheme). BuhoGO's own link opens BuhoGO, every time.

[← Feature records](README.md)

## The format

```
buhogo://pay?request=<URL-encoded request>
```

`request` is the whole payment request, exactly as the checkout would put it in a QR code or a `lightning:` link: a `lightning:…` invoice, LNURL or Lightning address, or a `bitcoin:…` request ([BIP 321](https://github.com/bitcoin/bips/blob/master/bip-0321.mediawiki)) with its amount and `lightning=` fallback. Encode it as one parameter (`encodeURIComponent`), so the request's own `?` and `&` stay inside it.

Coinsnap's app uses the same shape (`coinsnap://pay?request=…`), so a checkout builds both wallets' links the same way.

### Examples

A Lightning invoice:

```
buhogo://pay?request=lightning%3Alnbc168u1p5…
```

A Bitcoin request with an amount and a Lightning fallback, `bitcoin:bc1q…?amount=0.0005&lightning=lnbc…`:

```
buhogo://pay?request=bitcoin%3Abc1q…%3Famount%3D0.0005%26lightning%3Dlnbc…
```

In JavaScript:

```js
const link = `buhogo://pay?request=${encodeURIComponent(request)}`
```

### Also read

Wallet lists that build links by prefix (`<wallet>:lightning:<invoice>`) work too: whatever follows `buhogo:` is read as the request.

```
buhogo:lightning:lnbc168u1p5…
buhogo:bitcoin:bc1q…?amount=0.0005&lightning=lnbc…
```

This form is read, not advertised. Integrators should use `buhogo://pay?request=…`.

## What BuhoGO does with it

1. BuhoGO opens, from closed or while already running, and unwraps the request (`utils/paymentLink.js`).
2. From there the request takes exactly the path of a `lightning:` or `bitcoin:` link (`boot/deep-links.js`): a locked kiosk register takes only card withdrawals and never sends; otherwise the payment opens on the confirmation screen.
3. The person checks the amount and the recipient and confirms. **A link never pays by itself.**

A link BuhoGO can't read shows "BuhoGO can't open this link" and pays nothing. That includes:

- `buhogo://pay` without a `request`, or with an empty one;
- a request that wasn't encoded and came apart: `buhogo://pay?request=bitcoin:bc1q…?amount=1&lightning=lnbc…` arrives as `request=bitcoin:bc1q…?amount=1` plus a separate `lightning=` parameter. BuhoGO refuses it instead of paying the part it got;
- a BuhoGO link inside the request (`buhogo://pay?request=buhogo%3A…`): one wrapper only, never unwrapped twice;
- a request that isn't a payment BuhoGO knows.

Without a wallet set up, BuhoGO says "Set up a wallet first", as for any payment link.

Two other BuhoGO links are never read as a payment:
- `buhogo://nwc/connected`: a wallet app sending the person back after approving a connection ([Nostr Wallet Connect](NWC.md)).
- `buhogo://open/…`: a Quick Settings tile or a launcher shortcut opening one screen ([Quick access](QUICK_ACCESS.md)).

## Registration

| Platform | Where | What |
|---|---|---|
| Android | `AndroidManifest.xml`, MainActivity | One intent filter for the `buhogo` scheme (`BUHOGO` too: Android matches schemes case-sensitively for links from apps and NFC). Covers `pay` and `nwc`. |
| iOS | `Info.plist`, `CFBundleURLTypes` | `buhogo`, next to the payment schemes (URL type `mybuho.buhogo.links`). The same scheme carries the way back from a wallet app after "Connect a wallet" (`buhogo://nwc/connected`). |

On iOS a custom scheme has no chooser: one app that claims it wins. Only BuhoGO claims `buhogo`, which is the point.

## Testing a link

- Unit: `src/utils/__tests__/paymentLink.spec.js` (format, encoding, refusals) and `src/boot/__tests__/deepLinkCards.spec.js` (the real handler, from a closed and a running app, kiosk, no wallet).
- Android emulator or phone:
  ```
  adb shell am start -a android.intent.action.VIEW -d 'buhogo://pay?request=lightning%3Alnbc…'
  ```
- iOS simulator:
  ```
  xcrun simctl openurl booted 'buhogo://pay?request=lightning%3Alnbc…'
  ```
- From a browser, a link on a web page (`<a href="buhogo://pay?request=…">`): Chrome on Android and Safari on iPhone ask before they open an app.

Check each with BuhoGO closed and open, with a Lightning invoice and with a Bitcoin request that has an amount, and with another wallet app installed (the link must still open BuhoGO).
