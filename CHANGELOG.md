# Changelog

Notable changes to BuhoGO, newest first. Zapstore takes each release's notes from its section here (`release_notes` in `zapstore.yaml`). Releases up to 1.9.2 are described on [GitHub Releases](https://github.com/Buho-Ecosystem/Buho_go/releases).

## [1.11.0]

### Before you update

Still on a BuhoGO from GitHub or Zapstore older than 1.9.1? It was signed with a different key, so Android will not install 1.11.0 over it. Back up your recovery phrases in Security, uninstall BuhoGO, then install 1.11.0. Updating from 1.9.1 or later works as usual.

### Highlights

- **Contact chat.** Ask a contact for money, pay their request or send them money in a private, end-to-end encrypted chat. Tap a contact in the Address Book to open it. A request can be typed in your own currency, stays open for 30 days and shows as paid once BuhoGO has confirmed the money arrived. Short messages, replies and reactions sit next to it, and text that looks like a secret key or recovery phrase is never sent.
- **Up to six Spark wallets.** One recovery phrase now holds up to six equal Spark wallets, to keep savings, a shop or the family apart, and one backup covers them all. Add, rename, switch and remove them in Settings, and move a wallet's Lightning address to another one. Your Business and Personal wallets become two ordinary wallets that keep their names, and a restore brings back every wallet you used.
- **Split the bill.** Request, new in Receive, asks one person or several at once, in equal shares or by amount, and shows who has paid. Pick people from your contacts, search for anyone or scan the code on their profile. After paying for a group, Request repayment on the payment asks the others for their share, fees left out. Each person gets an ordinary private request; only you see the whole list.
- **Pay again.** Swipe a payment to the left in History, or tap Pay again in its details, to pay the same Lightning address, Spark, Arkade or Bitcoin address or reusable payment link again. The last amount is filled in, in the recipient's own currency where they offer one, and the payment still ends on the slide. Tap the recipient on the receipt to see how often and how much you paid them.
- **Bitcoin received, in every wallet.** Bitcoin that arrives while the app is open is confirmed, also when you didn't start it from Receive: on Home with the Bitcoin received screen, anywhere else with a toast that opens the payment. LNbits, NWC and Arkade wallets now announce payments the moment they arrive, like Spark, each payment once and with its own amount. Money that lands in a wallet you are not using is marked on that wallet until you look.
- **Choose which wallet pays.** With more than one wallet, the payment sheet shows Pay with, so any of your wallets can pay without switching the active one. Each shows its balance and says plainly when it can't pay.
- **Connect a wallet.** One Connect a wallet entry in Settings and on Welcome lists Alby Hub, Coinos, LNbits and any other wallet. Alby Hub, Coinos and a wallet app on the same phone connect with one approval and nothing to copy. Tapping Connect in another wallet app, or pasting a connection on Home, opens BuhoGO ready to connect.
- **Pay from another wallet app.** Receive shows Pay from another wallet when one is installed on the phone. It opens that app with the request and its amount, and BuhoGO announces the payment once it arrives. Checkouts can also open BuhoGO directly with a payment, which never pays on its own.
- **Use an identity from another app.** Add identity now also takes an identity you already have: from a browser extension on the web, a remote signer link, or its secret key. BuhoGO shows the profile it found before anything is saved and keeps that profile's existing details when you edit it. Get paid offers a payment address instead of setting one on its own, and website sign-ins keep using your 12 words.
- **Waiting for you.** When a contact asks you for money or a voucher still holds money, one line above Receive and Send says so. Tap it to pay or redeem right there. Requests that expire leave the line on their own, and muted chats stay quiet.
- **Auto-Transfer, rebuilt.** A rule reads as a sentence: when a wallet holds more than an amount, move everything, or everything above what you keep, to another of your wallets, a contact or an address. Amounts can be in your currency. Each rule has its own page with its progress and recent transfers, and a transfer that fails shows one line on Home instead of an alert.
- **Bolt Card on one sheet.** Tapping a card shows the card, the amount and the PIN on one sheet with a new slide, including the tries left. The kiosk says it takes cards, and every parked sale stays watched, also after a restart.

### UI/UX

- **Quick access on Android.** Quick Settings tiles for Send and Receive, and a long-press menu on the app icon for Send, Receive, Scan QR and the last person you paid. Any entry can be dragged to the Home screen. Nothing is filled in or paid, and on a locked phone a tile asks to unlock first.
- **Scan a QR code from a photo.** Every scanner has Choose photo, to read a screenshot of an invoice, a request sent in a chat or a saved connection code. BuhoGO asks for no access to your photo library, and the camera stays off while you choose.
- **Haptics.** The app gives a light tap at the moments that matter: a payment sent or received, a card read, a wrong PIN, the slide committing. Routine taps stay quiet. Turn it off in Settings, Preferences, Haptics.
- **Kiosk Mode has its own page.** A Kiosk Mode row in Settings opens one switch with everything for the register under it: the receiving wallet, the display currency, tips, round up and the PIN. The PIN is set in a sheet when you turn it on, and is stored only as a salted hash.
- **Paying at the till in South Africa.** Every Scan to Pay till code BuhoGO recognises now goes to the payment provider, and its answer shows in plain words. The confirm sheet names the store and the rand amount in the code, and a Refunds to row picks the Lightning address a refund goes to, or none where the store allows it.
- **Connection ended.** When an NWC connection is removed or expires in the wallet app, or an LNbits wallet's key stops working, BuhoGO says Connection ended and what brings it back, instead of Offline with a Reconnect that can't work.
- **Identities in one list.** Every identity on this phone is one row: tap it to switch, with Undo. Its detail page copies the public code or the secret key, and removes the identity from this phone with Undo; your 12 words bring it back. Erase all identities now says that it erases every identity.
- **Messages live in the Address Book.** A Messages row lists every chat, unread messages show on the contact and on the Address Book door in the menu, and a message notification opens the chat. Chats with people who are not in your contacts sit in their own section and never light the menu badge.
- **Calmer updates.** An ordinary update no longer pops up. A dot on the logo and on About leads to one sheet that follows the update from download to restart, and About shows the version and when BuhoGO last checked.
- **One Notifications setting.** Preferences has one Notifications row that says On, Off or Blocked. Its sheet turns notifications on and switches payments received, and requests and messages, separately.
- **Wallet details in Manage Wallets.** Each wallet opens a page to rename, use, reconnect or remove it; a Spark wallet also shows its own Lightning address. A wallet is removed only once a fresh balance shows it empty, and the last Spark wallet only after its recovery phrase is backed up.
- **Fiat next to every balance** in Manage Wallets and the wallet switcher, which also shows the total across your wallets. A total is dimmed only when a figure in it is out of date.
- **Between you shows both directions.** A contact's page lists the payments you received from them as well as the ones you sent.
- **A designed QR image to share.** Sharing from Receive sends a card that names what the code is, with the amount for an invoice and "Scan with any Bitcoin wallet". Links to go.mybuho.de and to shared profile cards have new previews.
- **Clearer deposit timing.** Speeding up a Bitcoin deposit says "Available now" or how many confirmations are still needed, instead of always "Right away", and explains confirmations in plain words.
- **Exchange rates setting.** The exchange rate source is a simple list in the settings sheet, and the currency picker opens at once.
- **Spend tab.** The Bitcoin Map card is a drawn map with its title below it, and Learn & Earn has its own mark, also on reward payments, and a clearer subtitle.
- **Arkade colours.** The Arkade mark is purple in light mode and red in dark mode on every screen.
- **See who you're paying.** When a payment code belongs to a verified business, its name and logo show before you pay and stay with the payment in History. A Bitcoin address that doesn't match the business's verified one is stopped before anything is sent.
- **One picture from the tap to Home.** The launch screen matches Home in light and dark, and the owl moves to its place, instead of three screens with different backgrounds. Returning users skip the Welcome page.
- **Remove from this phone, or Disconnect.** Removing a wallet now says what happens: a Spark or Arkade wallet leaves this phone and its recovery phrase brings it back; an NWC or LNbits wallet is disconnected and the money stays where it is. Manage Wallets groups wallets as On this phone and Connected.
- **Connecting NWC and LNbits.** An NWC connection is tested before you name it and shows what it may do (send, receive, balance, history) and its spending limit; receive-only connections work. LNbits setup stays in one sheet, with help when the server has no Pay Links. Add New Wallet puts both under "Connect a wallet you already use".
- **Spark status in words.** When Spark can't be reached, Home says so in one quiet line, and only once the internet works and Spark's operators don't answer. The emergency exit lives in Security, next to your recovery phrase.
- **A steadier Send sheet.** While a destination is being looked up, nothing in the sheet can start another payment; if the lookup fails, Paste, Scan and your contacts come back.
- **App features on the web.** In the browser, Haptics and Quick access show in Settings and point to the Android app, like App lock already does.

### Bug Fixes

- Fixed a web issue where adding a wallet straight after reloading its setup page erased every other wallet on the device, a Spark recovery phrase included, and reset settings such as currency and app lock. A tab that missed a change made in another tab now asks you to reload instead of overwriting it.
- Fixed the Social Bucket's ecash backup on Nostr, which could not be read back, so a restore on another phone would have found nothing. Existing backups are read and replaced. The ecash on the phone itself was always safe.
- Fixed Spark looking broken on networks that can't reach mempool.space: slow syncs, a balance that kept pulsing and a connection rebuilt over and over. Chain lookups now try three servers in turn.
- Fixed all fiat values disappearing, and the currency picker not opening, when mempool.space stopped answering. Rates now fall back to mempool.emzy.de and Alby, and transaction reports no longer hang for the same reason.
- Fixed an automatic transfer made right after start erasing the saved notes, tags and contact links of past payments.
- Fixed payment notifications never appearing on Android 14 and later while BuhoGO was in the background.
- With a single wallet, a payment larger than the balance is now stopped before the slide with "Not enough balance", instead of failing with the wallet's own error shown as the recipient's.
- Error messages name the recipient or the service only when that party really sent the text. Adding a wallet that is already connected now says so.
- A Lightning address or payment link is paid exactly the amount you confirmed, on every wallet, in batch send and in Auto-Transfer. When a recipient refuses, you see their reason, marked as theirs.
- A Bitcoin request that carries an amount now opens with that amount, locked, instead of at zero.
- Fixed an address with a shop's name in it being taken for a till code and refused, and a crafted QR code that could freeze the app.
- Ten scanned digits are read as a till code and typed ones as a phone number, so a till code is no longer paid out to a phone. In Mobile Money, the country you pick decides how a national number is read.
- Fixed NWC wallets stopping with "That wallet isn't ready" when buying an eSIM, a VPN or a username.
- Fixed update notices: installed apps had not been told about any version after 1.9.1, and an open web app now notices a new version.
- A payment opened from a contact, a link, NFC or a request now appears as soon as the wallets are ready, instead of after Home's whole start-up, which could take half a minute when Spark synced slowly.
- Fixed Between you on a contact's page staying empty after a cold start, or showing the previous contact's payments.
- Fixed the Onboarding Guide in About not opening, and a wallet renamed in Settings not being saved.
- Fixed German and Spanish texts: the About door in the menu read "About you", and the start-up text stayed in English.
- Fixed the payment sheet trapping you when the phone had no connection: Android's Back button and a swipe down now close it, like the arrow at its top left.
- Icons ship with the app, so they show without internet. They were loaded from another server at every start, and without a connection buttons such as Back showed up empty.
- When a payment reaches no server, BuhoGO says why: you're offline, the network has no internet (a VPN that blocks traffic, for example), or Spark can't be reached while the internet works. The payment sheet says so before you send and shows no guessed network fee.
- Fixed a false Spark warning ("No answer from Spark for 33 hours") that counted the time the app was closed, and Home staying blank when the app opened offline.
- Fixed Auto-Transfer moving almost the whole balance instead of what is above the amount, holding back 3% even between Spark wallets, and sending a wrong amount to a Bitcoin address. Rules on wallets other than the active one now run too.
- Fixed Spark Auto-Transfer rules skipping with "The balance couldn't be checked" on every round; a check that stays stuck now shows on Home with Try Again.
- Fixed Settings counting Auto-Transfer rules left behind by removed wallets, such as "2 on" with no rules on the page. Those rules are cleaned up on their own.
- An NWC payment now counts only on proof. A payment whose outcome is unclear shows "Payment not confirmed" and is never sent twice, also by Auto-Transfer. A payment request now ends when BuhoGO stops waiting for it, so a wallet that wakes up late doesn't pay it.
- Fixed an NWC payment opened from History showing "Transaction Not Found", also for older payments further down the list, and Auto-Transfer payments from an NWC wallet missing their label.
- Fixed NWC wallets opening a new connection for almost every screen and payment and never closing it. Each one now keeps a single connection, also through a batch of payments. A relay that never answers fails after 3 seconds instead of holding up the wallet.
- Fixed two different NWC wallets being taken for the same one, a wallet without payment notifications being asked every minute instead of every five, and wallet names with hidden or right-to-left characters.
- Fixed moving money into an NWC wallet from the Social Bucket, a transfer or Learn & Earn, and some older NWC wallets losing Receive and Balance.
- Fixed LNbits saying "Not supported" when the server was only unreachable.
- Fixed an Arkade wallet's Receive sheet saying a payment arrived when the wallet only moved its own funds, an exact Bitcoin payout having its fees taken from the amount, and a copied Receive code losing its amount and note.
- Fixed a kiosk on an NWC wallet not taking any payment, two ways an unpaid sale could show as paid, the kiosk staying set to a wallet that had been disconnected, and parking a second sale replacing the first.
- Fixed a fiat register charging the typed number as Bitcoin when it had no exchange rate. It now charges only with a price from the last hour and says why when it can't.
- Fixed a Bolt Card that never pays leaving the kiosk on "Paying…". After a minute the sale goes back to the QR code, ready for another try.
- Fixed bottom sheets losing their bottom spacing on Android, and the register showing amounts in sats whatever Bitcoin format you chose in Settings.
- Fixed a link that opened a closed BuhoGO, such as a shared card, landing on the start screen instead of the linked page.
- Fixed the business verification not being saved for Spark on-chain payments, and sometimes attaching to the wrong payment.
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
