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
- **Case kept:** codes are case-sensitive. Addresses are paid in lower case, except a name on `cryptoqr.net` (`lightningAddressCase`). This holds in the Send field and in the clipboard strip.
- **Length:** a code longer than 2048 characters is never treated as a till code.

## Which codes

BuhoGO recognises the networks MoneyBadger names, by how their codes look (`NETWORKS` in `merchantQR.js`). It does not decide which ones work. A recognised code goes to MoneyBadger as soon as it is scanned, so what counts is narrow (`tillSubject`):

- an EMV merchant code (`000201…`) is read whole, since its network sits inside it;
- a web link is read by its host only: a page or a query that mentions a network proves nothing;
- any other link or card (Wi-Fi, contact cards, sign-in codes, mail, phone) is never a till code;
- other text counts only when it is one word.

Bare 10 and 20 digit numbers are Scan to Pay and Zapper codes, so a scanned number of that length goes to MoneyBadger too. MoneyBadger's answer is said in plain words:

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
- **Amount in sats:** the pay request sets it. A fixed amount is paid as it is. A narrow range (at most 5 % wide, the rate moving) is filled in at its top (`tillPrefillSats`). A wider range is left for the person to enter: the CRC is a checksum, not a signature, so an amount printed in the code never picks one.

## Refunds

MoneyBadger can only refund to a Lightning address the payer gave with the payment (LUD-18 `payerData.identifier`). It enforces this at affected stores from 2026-09-01. The confirm sheet's "Refunds to" row shares one, and only with a callback on `cryptoqr.net` over https, checked again when the invoice is asked for. See `src/utils/refundAddress.js`.

## Live checks (2026-11-07, read-only)

Against `cryptoqr.net` with MoneyBadger's public test code. GET requests only, nothing paid.

- The pay request answers with `Access-Control-Allow-Origin: *`, so the web build works too.
- The metadata is just the store's name (`Pick n Pay`). The invoice description is `MBadger: cryptoqrtestscan - R1.00`, it has no description hash, and it expires in about a minute.
- A refund address that does not resolve is refused with HTTP 500 `Could not validate refund address`, even where the field is optional.
- A made-up SnapScan code gives `UNSUPPORTED_QR_CODE`. Made-up codes of other networks give `UNKNOWN_CODE`, which proves nothing.
- The service rate-limits after about 30 requests (HTTP 429, still limited 5 minutes later). Keep manual checks short.

## Not proven yet

- Real Zapper, Scan to Pay, Ecentric and Yoyo codes through this route. Only the Pick n Pay style is tested. A family whose codes have a scheme other than http(s), or spaces outside an EMV code, would need its own rule.
- Which networks Checkers, Shoprite and Woolworths tills use today. The table above is the earlier research; a till of theirs on another network shows the storefront mark.
- Zapper codes with a line break: the address check refuses control characters in a name, so such a code is refused before it is sent.
- That a refund arrives. That needs a real payment with the test code and `completion=cancel`.

## Checks

- `node --test src/utils/__tests__/merchantQR.spec.js`
- `node --test src/components/__tests__/sendTillCodes.spec.js`
- `node --test src/pages/__tests__/walletFlow.spec.js` (the till tests in the Send field, the sheet and history)
- `scripts/check-merchant-qr.mjs`: a browser check against the dev server, with MoneyBadger stood in locally
