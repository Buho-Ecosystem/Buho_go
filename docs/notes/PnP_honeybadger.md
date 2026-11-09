# Till codes (MoneyBadger, cryptoqr.net)

People in South Africa pay at the till by scanning the store's QR code. The code is the store's own (Pick n Pay, Zapper, Scan to Pay and others), not a Lightning code. MoneyBadger runs a Lightning service on `cryptoqr.net` that turns such a code into a payment.

Code: `src/utils/merchantQR.js`, used by `SendModal.vue` (the Send field and the camera) and `Wallet.vue` (setup, the confirm sheet, history).

## How a payment goes

1. The Send field or the camera reads a text that BuhoGO cannot pay itself (no invoice, address, LNURL, Bitcoin or Spark code). Only then does `getMerchantInfo` check whether it looks like a till code. Typed text never gets this far. A Lightning address on `cryptoqr.net`, pasted or linked, is a till code too (`isTillAddress`).
2. `convertToLightningAddress` makes a Lightning address from the whole code: `encodeTillCode(code)@cryptoqr.net`.
3. The pay request is read like any other address. MoneyBadger's answer names the store (its LUD-06 `text/plain`), the amount in sats, and whether it wants a refund address (LUD-18).
4. The confirm sheet shows:
   - the store, with its logo or the storefront mark;
   - the rand amount printed in the code ("R1.00 at the till");
   - "Refunds to" (see below).
5. The invoice is asked for and paid as for any Lightning address. Afterwards the payment keeps the store's name, never the code: a till code pays one sale, so there is no Save contact and no Pay again.

## The code as an address

MoneyBadger takes "the entire QR code payload" as the name and decodes it exactly once.

- **Encoded once:** everything except letters, digits and `- _ .` is percent-encoded, including `! ' ( ) * ~`, which `encodeURIComponent` leaves alone. Then every path accepts the name, NWC's address check included.
- **Never decoded first:** a `%41` in the code goes out as `%2541`. Encoding twice gives `UNKNOWN_CODE`, and an unencoded `/` gives 404.
- **Case kept:** codes are case-sensitive. Addresses are paid in lower case, except a name on `cryptoqr.net` (`lightningAddressCase`). This holds in the Send field, the clipboard strip, and a `lightning:` link or a card tap.
- **Length:** a code longer than 2048 characters is never treated as a till code.

## Which codes

BuhoGO recognises the networks MoneyBadger names, by how their codes look (`NETWORKS` in `merchantQR.js`). It does not decide which ones work. A recognised code goes to MoneyBadger as soon as it is scanned, so every rule is exact (`tillNetwork`). A word that only appears somewhere in a text proves nothing: a secret key or a token can hold one by chance.

| The code | Counts when | Networks |
|---|---|---|
| EMV merchant code (`000201…`) | a merchant account (templates 26 to 51) names the network in its sub-tag 00, and every field fits | Pick n Pay (`za.co.electrum.picknpay`), Electrum (`za.co.electrum…`), Ecentric (`za.co.ecentric…`) |
| Web link | its host is the network's domain or below it | SnapScan (`snapscan.io`, `snapscan.co.za`), Yoyo (`wigroup.co`, `yoyogroup.co`), Zapper (`zapper.com`, `<digits>.zap.pe`), Pay@ (`payat.io`), Netcash and Sage Pay (`paynow.….co.za`), Transaction Junction, Scan to Pay (`scantopay.io`, `oltio.co.za`), MoneyBadger (`cryptoqr.net`) |
| Any other one-word text | it is one of these shapes, whole | Scan to Pay: 10 digits. Zapper: 20 digits. Pay@: `xx/xxxx/` and 20 characters. Standard Bank: `SK-<digits>-<23 digits>`. Parking: `CRSTPC-` and five numbers |

Any other link or card (Wi-Fi, contact cards, sign-in codes, mail, phone) is never a till code. A network named in an EMV code's reference or name is not its network, so such a code never gets that store's logo.

Where the shapes come from:
- **Scan to Pay's operator:** its developer docs say a scanned code is "the decoded ten-digit masterpass QRCode", or a link such as `https://regstest.oltio.co.za/qr/?c=…` ([payments use cases](https://developer.eftcorp.com/docs/payments-use-cases)). Each of the five ten-digit codes in its examples goes to MoneyBadger here, and so does the link.
- **An open-source integration with MoneyBadger:** of its 28 sample texts, 18 codes give the same address here, among them Zapper links holding quotes, `@` and `%`, and the 6 it refuses are refused here too. The other 4 are EMV samples edited by hand, so their lengths no longer add up. A code whose fields don't fit is not read as one here.
- **MoneyBadger's own test code and spec example**, and a Pick n Pay till code of the same form: every field fits, and its checksum is valid.

Two older patterns, `UMPQR` or `easypay` anywhere in a text, are gone: no public source shows what such a code looks like.

Ten digits can be both: a Scan to Pay till code, and a local mobile number in a payout country (Kenya, Zambia, Tanzania, Ghana: `0` and nine digits). What decides is how the digits arrived (`SendModal.vue`):

- **Scanned:** a till code. Scan to Pay's operator says "A Scan to Pay merchant identified by 10 digit QR" ([payments use cases](https://developer.eftcorp.com/docs/payments-use-cases)), while a phone number belongs in a QR code as a `tel:` link ([barcode contents](https://github.com/zxing/zxing/wiki/Barcode-Contents#telephone-numbers), [RFC 3966](https://www.rfc-editor.org/rfc/rfc3966)). A `tel:` link is never a till code.
- **Typed or pasted:** a phone number. That is how people enter one.
- **Scanned, then edited:** the person's own text, so typed.

A number with its country code (`+254…`, `254…`, `00254…`) has no till code's shape and stays a phone number either way.

MoneyBadger's answer is said in plain words:

| MoneyBadger's answer | What the person reads |
|---|---|
| `UNKNOWN_CODE`, or a technical line with no code BuhoGO knows | This code can't be paid. Ask the cashier for a new one. |
| `UNSUPPORTED_QR_CODE` | This store's code isn't supported yet. Pay another way. |
| `SMART_SHOPPER_SCANNED` | That's a rewards code. Ask the cashier for the payment QR code. |
| `AMOUNT_TOO_HIGH` | This amount is over the limit. Pay another way. |
| `REFUND_ADDRESS_REQUIRED`, `INVALID_REFUND_ADDRESS` | Said on the "Refunds to" row; in the payment dialog if the sheet is gone |
| HTTP 400, 404 or 410 | This code can't be paid. Ask the cashier for a new one. |
| HTTP 429, 5xx without words, no pay request | The store's payment service isn't answering. Try again in a moment. |

When it says this while the code is read, the words show in the Send field and no sheet opens. When it says it while the invoice is asked for, they show in the payment dialog. Plain words from MoneyBadger stay its own, labelled as theirs. With no answer at all (offline, a timeout), the reason is the one any address gets.

## The store and the amount

- **Name:** MoneyBadger's `text/plain` metadata, as one short line (control and direction characters removed, at most 48 characters). Without one, the network's name where the code itself names the store (only Pick n Pay codes do), else "Store".
- **Name cleaning:** control and format characters (zero-width marks, direction overrides) and line breaks are removed. A cut never splits a character.
- **Logo:** needs both the store's name (or that name followed by a branch, "Checkers Hyper") and the store's own network:

  | Store | Network |
  |---|---|
  | Pick n Pay | Pick n Pay's Electrum code |
  | Checkers, Shoprite | Electrum |
  | Woolworths | Ecentric |

  On shared networks (SnapScan, Zapper and others) any merchant can register any name, so a name alone proves no brand. Without a logo, the sheet shows the storefront mark, and it does the same when a logo fails to load. A network is never shown as a shop.
- **Rand amount:** read from the code itself (`readEmvAmount`), never from the metadata. EMV merchant codes carry the currency in tag 53 (`710` is the rand) and the amount in tag 54. The amount is read only when:
  - every tag fits;
  - the CRC in tag 63 matches;
  - the currency is the rand;
  - there is no tip or fee (tag 55), since then tag 54 is not the total.

  MoneyBadger's test code reads R1.00 and its example R1.23.
- **Amount in sats:** the pay request sets it. A fixed amount is paid as it is. With a narrow range (at most 5 % wide, the rate moving) the confirm sheet opens at its top (`tillPrefillSats`), and the person confirms it. A wider range is left for the person to enter: the CRC is a checksum, not a signature, so an amount printed in the code never picks one. An amount left over from an earlier payment never counts toward whether the wallet can cover this one.

## Refunds

MoneyBadger can only refund to a Lightning address the payer gave with the payment (LUD-18 `payerData.identifier`). It enforces this at affected stores from 2026-09-01. The confirm sheet's "Refunds to" row shares one, and only with a callback on `cryptoqr.net` over https, checked again when the invoice is asked for. See `src/utils/refundAddress.js`.

Which address the row offers, the first by default:

1. the paying wallet's own;
2. the other wallets', oldest first;
3. the profile's payment address;
4. the identity's Social Bucket (`npub…@npub.cash`);
5. one typed for this payment.

For a refund, the Social Bucket is always offered to an identity whose key is on the phone, so a refund has a place to land when no Spark, LNbits or NWC wallet has an address.
- **A signer-app identity:** none is offered, because the bucket is emptied by signing with the key itself.
- **The profile's address:** it is called the Social Bucket only when it is this identity's own bucket. Any other address on `npub.cash` is shown as the profile's.
- **A service that only wants to know who paid:** it never gets the bucket unasked.

## Live checks (2026-11-07, read-only)

Against `cryptoqr.net` with MoneyBadger's public test code. GET requests only, nothing paid.

- The pay request answers with `Access-Control-Allow-Origin: *`, so the web build works too.
- The metadata is just the store's name (`Pick n Pay`). The invoice description is `MBadger: cryptoqrtestscan - R1.00`, and it expires in about a minute. What an invoice says it is for is not checked: LUD-06 and LUD-18 no longer tie it to the metadata ([lnurl/luds#234](https://github.com/lnurl/luds/pull/234)). Its amount is.
- A refund address that does not resolve is refused with HTTP 500 `Could not validate refund address`, even where the field is optional.
- A made-up SnapScan code gives `UNSUPPORTED_QR_CODE`. Made-up codes of other networks give `UNKNOWN_CODE`, which proves nothing.
- The service rate-limits after about 30 requests (HTTP 429, still limited 5 minutes later). Keep manual checks short.

## Live checks (2026-11-09, read-only)

Through BuhoGO's own `requestPayInvoice`, four GET requests, nothing paid.

- A Social Bucket address, of a key made for the check, is accepted. The invoice passes the amount and expiry checks.
- An address that cannot resolve is refused (`Could not validate refund address`) and read as refused, so the row says so.

## On a phone

The request goes through the platform's HTTP plugin (`src/utils/lnurlHttp.js`) with the URL as built and no `params`.
- **Android** sends it as given (`new URL`).
- **iOS** re-encodes only a URL that holds no `%` at all. A till code with a `/` or any other encoded character has one, so it is sent as given. A code of only letters, digits and `- _ .` has none, and re-encoding leaves it unchanged.

So `%2F` reaches MoneyBadger as `%2F`. With non-empty `params`, the Android plugin would rebuild the path decoded, and `/` would get a 404. `lnurlHttp.spec.js` fails if `params` are ever added. Read from the plugin source (Capacitor 8.3.1); a payment on a device is the final proof.

## Not proven yet

- Real Zapper, Scan to Pay, Ecentric and Yoyo codes through this route. Only the Pick n Pay style is tested. A family whose codes have a scheme other than http(s), or spaces outside an EMV code, would need its own rule.
- Which networks Checkers, Shoprite and Woolworths tills use today. The table above is the earlier research.
  - Shoprite Group's till codes have been EMV codes built with Electrum, the South African payments switch, since 2020 ([Shoprite](https://www.shopriteholdings.co.za/articles/Newsroom/2020/shoprite-the-first-retailer-to-offer-contactless-qr-payments.html)). That fits the table.
  - Reports of the Scan to Pay partnership name Checkers and Shoprite among the stores where Bitcoin works through Scan to Pay ([Cointelegraph](https://cointelegraph.com/news/south-africa-crypto-payments-scan-to-pay-moneybadger)).
  - Nothing public ties Woolworths to MoneyBadger yet.

  A till of theirs on another network shows the storefront mark.
- Zapper codes with a line break: the address check refuses control characters in a name, so such a code never leaves the phone. The Send field says "This store's code isn't supported yet. Pay another way.", never "try again".
- That a refund arrives. That needs a real payment with the test code and `completion=cancel`.

## Checks

- `node --test src/utils/__tests__/merchantQR.spec.js`
- `node --test src/components/__tests__/sendTillCodes.spec.js`
- `node --test src/pages/__tests__/walletFlow.spec.js` (the till tests in the Send field, the sheet and history)
- `node src/utils/__tests__/lnurlHttp.spec.js` (what the phone's HTTP plugin is handed)
- `node --test src/utils/__tests__/refundAddress.spec.js` (which refund address, and what a refusal means)
- `scripts/check-merchant-qr.mjs`: a browser check against the dev server, with MoneyBadger stood in locally
