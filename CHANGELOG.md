# Changelog

Notable changes to BuhoGO, newest first. Zapstore takes each release's notes from its section here (`release_notes` in `zapstore.yaml`). Releases up to 1.9.2 are described on [GitHub Releases](https://github.com/Buho-Ecosystem/Buho_go/releases).

## [1.10.0]

### Before you update

Still on a BuhoGO from GitHub or Zapstore older than 1.9.1? It was signed with a different key, so Android will not install 1.10.0 over it. Back up your recovery phrases in Security, uninstall BuhoGO, then install 1.10.0. Updating from 1.9.1 or later works as usual.

### Highlights

- **Balances and history appear at once.** BuhoGO opens on your last known balance and recent payments instead of a loading screen, and switching wallets or opening History shows them immediately. Fresh figures roll in as they arrive; the balance only pulses when there is nothing to show yet, and is dimmed only when an update actually failed.
- **Bolt Card payments in kiosk mode.** A locked kiosk now accepts NFC cards, before an amount is entered or against an open sale, through the same confirmation and PIN screens as the rest of the app.
- **Spark stays in sync on its own.** Both Spark wallets reconnect and catch up when you return to the app, whichever wallet or screen is open, and a cached balance is no longer mistaken for a fresh one.
- **Every received payment is noticed.** Receipts are matched by payment, not guessed from a balance change, so missed or wrong "payment received" notifications are caught up.
- **Your username stays yours.** A purchased name@mybuho.de no longer disappears after a restart or a slow relay, activation finishes even if you close the sheet, and a name you already paid for can be recovered free of charge with "Already yours".
- **A clearer app lock sheet.** It names the method (Device PIN, Fingerprint, Face and others), shows it, and says in one line when BuhoGO asks for it.

### Bug Fixes

- Confirmed on-chain deposits that were never claimed show up again and are claimed. Wallets already affected are unstuck.
- Deposits to the Spark wallet you are not using are found and processed too.
- Wallet totals no longer show a false zero in Manage Wallets, the switcher or Settings.
- Copying a private key works again in Safari.
- A missing exchange rate shows the fiat balance as "--" instead of 0,00, and a brief rate outage no longer drops BRL, ZAR, KES or ZMW.
- The QR scanner no longer stays on the slower in-app engine after a single camera hiccup.
- Learn & Earn payouts no longer fail with "payout_failed".
- The public card page opens the app, and Save saves the contact.
- Fixed the Brazilian real (BRL) display, long memos in Home's last transaction, and large amounts in the Receive sheet.

## [1.9.3]

### Before you update

Installed BuhoGO from GitHub or Zapstore before version 1.9.1? That version was signed with a different key, so Android will not install 1.9.3 over it. Back up your recovery phrases in Security first, because uninstalling removes your wallets from this phone. Then uninstall BuhoGO and install 1.9.3. Updating from 1.9.1 or later works as usual, and Google Play installs are not affected.

### Highlights

- **An emergency exit for Spark wallets.** Your Spark money can move to plain Bitcoin without Spark's operators. BuhoGO keeps an exit kit up to date after every payment, shows it in Security, and only raises a banner on Home after a long Spark outage. An exit picks up where it left off over the two weeks it can take.
- **Your own username.** An optional name@mybuho.de, paid per year for 1 to 10 years, with a verified badge on your card. Send and People accept @name and name@mybuho.de. There is no default name anymore.
- **Share your Lightning address on request (LUD-23).** One sheet asks you before any service receives your address, whether the request came from a scan, a paste, a link, NFC or Redeem.
- **Faster withdrawals (LUD-08).** Complete withdraw links open the Redeem review straight away, showing the service and the receiving wallet before you confirm.
- **Reusable vouchers (LUD-14).** BuhoGO keeps track of withdraw vouchers that can be redeemed more than once and checks what is left on them.
- **Deposits show what waiting costs.** A confirming on-chain deposit shows the fee and what you get. Speed up is one tap when you want it sooner, and BuhoGO no longer claims early on your behalf.
- **Brazilian real (BRL)** joins the display currencies.

### UI/UX

- **The balance pulses softly while it loads** and settles when the figure is in, on Home and in the wallet switcher.
- **The backup intro always fits one screen**, on small phones and in every language, with Next above Android's navigation bar.
- **A copied address is offered once** on Android, says what it is, and does not return after a restart. On iOS, Paste stays explicit.
- **Toasts can be swiped away**, with clearer light and dark themes.
- **The payment confirmation stays for seven seconds.**
- **Receive shows your address more simply**, and the Arkade logo reads in dark mode.
- **Internal transfers open the transaction details** straight from the success screen.
- **Security labels the Bitcoin backups** Spark and Arkade.
- **Google Drive backup says when a phone has no Google Play services** instead of failing at sign-in.

### Bug Fixes

- On-chain deposits are added automatically whichever wallet view is open.
- An accepted early deposit claim no longer shows as declined.
- The QR scanner falls back to the in-app scanner when the camera engine cannot start.
- Descriptions containing @ no longer corrupt withdraw callback values.
- Fixed scrolling on the map, the kiosk and the Spark setup success screen.
- The cloud backup sheet's title no longer wraps under the close button.

### Code Quality

- Breez SDK 0.24.1 to 0.25.0, and dependency security updates.
- Deposit state lives in one store; toasts have one host and controller.
- New browser checks for deposits, toasts, transfers, LUD-08, LUD-23, usernames, the balance pulse and the backup screens.
- README credits Storyset for the illustrations.
