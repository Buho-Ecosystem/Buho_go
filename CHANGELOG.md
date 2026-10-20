# Changelog

Notable changes to BuhoGO, newest first. Zapstore takes each release's notes from its section here (`release_notes` in `zapstore.yaml`). Releases up to 1.9.2 are described on [GitHub Releases](https://github.com/Buho-Ecosystem/Buho_go/releases).

## [1.11.0]

### Before you update

Still on a BuhoGO from GitHub or Zapstore older than 1.9.1? It was signed with a different key, so Android will not install 1.11.0 over it. Back up your recovery phrases in Security, uninstall BuhoGO, then install 1.11.0. Updating from 1.9.1 or later works as usual.

### Highlights

- **Contact chat.** Ask a contact for money, pay their request or send them money in a private, end-to-end encrypted chat. Tap a contact in the Address Book to open it. A request can be typed in your own currency, stays open for 30 days and shows as paid once BuhoGO has confirmed the money arrived. Short messages, replies and reactions sit next to it, and text that looks like a secret key or recovery phrase is never sent.
- **Up to six Spark wallets.** One recovery phrase now holds up to six equal Spark wallets, to keep savings, a shop or the family apart, and one backup covers them all. Add, rename, switch and remove them in Settings, and move a wallet's Lightning address to another one. Your Business and Personal wallets become two ordinary wallets that keep their names, and a restore brings back every wallet you used.
- **Split the bill.** Request, new in Receive, asks one person or several at once, in equal shares or by amount, and shows who has paid. Pick people from your contacts, search for anyone or scan the code on their profile. After paying for a group, Request repayment on the payment asks the others for their share, fees left out. Each person gets an ordinary private request; only you see the whole list.
- **Bitrefill Widget.** Buy vouchers and gift cards from common brands with bitcoin, without leaving BuhoGO. Open Bitrefill in the Spend tab, pick a brand and pay from your wallet; the voucher is ready straight away.
- **Choose which wallet pays.** With more than one wallet, the payment sheet shows Pay with, so any of your wallets can pay without switching the active one. Each shows its balance and says plainly when it can't pay.
- **Use an identity from another app.** Add identity now also takes an identity you already have: from a browser extension on the web, a remote signer link, or its secret key. BuhoGO shows the profile it found before anything is saved and keeps that profile's existing details when you edit it. Get paid offers a payment address instead of setting one on its own, and website sign-ins keep using your 12 words.
- **Waiting for you.** When a contact asks you for money or a voucher still holds money, one line above Receive and Send says so. Tap it to pay or redeem right there. Requests that expire leave the line on their own, and muted chats stay quiet.
- **Auto-Transfer, rebuilt.** A rule reads as a sentence: when a wallet holds more than an amount, move everything, or everything above what you keep, to another of your wallets, a contact or an address. Amounts can be in your currency. Each rule has its own page with its progress and recent transfers, and a transfer that fails shows one line on Home instead of an alert.
- **Bolt Card on one sheet.** Tapping a card shows the card, the amount and the PIN on one sheet with a new slide. The kiosk says it takes cards, and every parked sale stays watched, also after a restart.

### UI/UX

- **Identities in one list.** Every identity on this phone is one row: tap it to switch, with Undo. Its detail page copies the public code or the secret key, and removes the identity from this phone with Undo; your 12 words bring it back. Erase all identities now says that it erases every identity.
- **Messages live in the Address Book.** A Messages row lists every chat, unread messages show on the contact and on the Address Book door in the menu, and a message notification opens the chat. Chats with people who are not in your contacts sit in their own section and never light the menu badge.
- **Calmer updates.** An ordinary update no longer pops up. A dot on the logo and on About leads to one sheet that follows the update from download to restart, and About shows the version and when BuhoGO last checked.
- **One Notifications setting.** Preferences has one Notifications row that says On, Off or Blocked. Its sheet turns notifications on and switches payments received, and requests and messages, separately.
- **Wallet details in Manage Wallets.** Each wallet opens a page to rename, use, reconnect or remove it; a Spark wallet also shows its own Lightning address. A wallet is removed only once a fresh balance shows it empty, and the last Spark wallet only after its recovery phrase is backed up.
- **Fiat next to every balance** in Manage Wallets and the wallet switcher, which also shows the total across your wallets. A total is dimmed only when a figure in it is out of date.
- **Between you shows both directions.** A contact's page lists the payments you received from them as well as the ones you sent.
- **A designed QR image to share.** Sharing from Receive sends a card that names what the code is, with the amount for an invoice and "Scan with any Bitcoin wallet". Links to go.mybuho.de and to shared profile cards have new previews.
- **Clearer deposit timing.** Speeding up a Bitcoin deposit says "Available now" or how many confirmations are still needed, instead of always "Right away", and explains confirmations in plain words.
- **Spend tab.** The Bitcoin Map card is a drawn map with its title below it, and Learn & Earn has its own mark, also on reward payments, and a clearer subtitle.
- **Haptics.** The app gives a light tap at the moments that matter, such as sliding to send or tapping a card, as it was always meant to. Turn it off in Settings, Preferences, Haptics.
- **Arkade colours.** The Arkade mark is purple in light mode and red in dark mode on every screen.
- **One picture from the tap to Home.** The launch screen matches Home in light and dark, and the owl moves to its place, instead of three screens with different backgrounds.
- **Remove from this phone, or Disconnect.** Removing a wallet now says what happens: a Spark or Arkade wallet leaves this phone and its recovery phrase brings it back; an NWC or LNbits wallet is disconnected and the money stays where it is. Manage Wallets groups wallets as On this phone and Connected.
- **Connecting NWC and LNbits.** An NWC connection is tested before you name it and shows what it can do. LNbits setup stays in one sheet, with help when the server has no Pay Links.
- **Spark status in words.** When Spark can't be reached, Home says so in one quiet line, and only once the internet works and Spark's operators don't answer. The emergency exit lives in Security.
- **Pay again.** Swipe a payment to the left in History, or tap Pay again in its details, to pay the same Lightning address, Spark, Arkade or Bitcoin address or reusable payment link again. The last amount is filled in, in the recipient's own currency where they offer one, and the payment still ends on the slide. Payments to an invoice or a shop's checkout code are not offered. Tap the recipient on the receipt, or More options, to see how often and how much you paid them.

### Bug Fixes

- Fixed a web issue where adding a wallet straight after reloading its setup page erased every other wallet on the device, a Spark recovery phrase included, and reset settings such as currency and app lock. A tab that missed a change made in another tab now asks you to reload instead of overwriting it.
- Fixed an automatic transfer made right after start erasing the saved notes, tags and contact links of past payments.
- Fixed payment notifications never appearing on Android 14 and later while BuhoGO was in the background.
- With a single wallet, a payment larger than the balance is now stopped before the slide with "Not enough balance", instead of failing with the wallet's own error shown as the recipient's.
- Error messages name the recipient or the service only when that party really sent the text. Adding a wallet that is already connected now says so.
- Fixed NWC wallets stopping with "That wallet isn't ready" when buying an eSIM, a VPN or a username.
- Fixed update notices: installed apps had not been told about any version after 1.9.1, and an open web app now notices a new version.
- A payment opened from a contact, a link, NFC or a request now appears as soon as the wallets are ready, instead of after Home's whole start-up, which could take half a minute when Spark synced slowly.
- Fixed Between you on a contact's page staying empty after a cold start, or showing the previous contact's payments.
- Fixed the Onboarding Guide in About not opening, and a wallet renamed in Settings not being saved.
- Fixed German and Spanish texts: the About door in the menu read "About you", and the start-up text stayed in English.
- Fixed the payment sheet trapping you when the phone had no connection: Android's Back button and a swipe down now close it, like the arrow at its top left.
- Icons ship with the app, so they show without internet. They were loaded from another server at every start, and without a connection buttons such as Back showed up empty.
- When a payment reaches no server, BuhoGO says why: you're offline, the network has no internet (a VPN that blocks traffic, for example), or Spark can't be reached while the internet works. The payment sheet says so before you send and shows no guessed network fee.
- Fixed Auto-Transfer moving almost the whole balance instead of what is above the amount, holding back 3% even between Spark wallets, and sending a wrong amount to a Bitcoin address. Rules on wallets other than the active one now run too.
- Fixed a kiosk on an NWC wallet not taking any payment, and two ways an unpaid sale could show as paid. An NWC payment now counts only on proof.
- Fixed Auto-Transfer payments from an NWC wallet missing their label in History.
- Fixed moving money into an NWC wallet.
- Fixed the kiosk staying set to a wallet that had been disconnected, which made every sale fail.
- An Arkade wallet that holds money can now be removed only once its recovery phrase is backed up.

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
