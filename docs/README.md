# Feature records

How each feature works and the rules that keep it right, written for developers when it was built. Start with the [Developer Guide](../Developer.md) for the architecture; come here for one feature. Help for people using BuhoGO lives on the [docs site](https://docs-buhogo.netlify.app/).

[← README](../README.md) · [Developer Guide](../Developer.md)

## Wallets

| Record | What it covers |
|---|---|
| [Spark wallets](SPARK_WALLETS.md) | One recovery phrase, up to six Spark wallets |
| [Nostr Wallet Connect](NWC.md) | Connecting a wallet over NWC (NIP-47), and the rules that keep it honest |
| [Taking a wallet off this phone](WALLET_REMOVAL.md) | "Remove from this phone" and "Disconnect", never "delete" |
| [Emergency exit](EMERGENCY_EXIT.md) | Leaving Spark to plain Bitcoin without Spark's help |

## Payments

| Record | What it covers |
|---|---|
| [Auto-Transfer](AUTO_TRANSFER.md) | Rules that move money on their own, and when they run |
| [Bolt Card](BOLT_CARD.md) | Taking money from a Bolt Card, in the wallet and at the kiosk |
| [Merchant verification](BRANTA.md) | Showing the business you pay, and stopping a changed code (Branta) |
| [Shared payment requests](SHARED_REQUESTS.md) | Requests from Receive and repayments from receipts |
| [Contact chat](CONTACT_CHAT.md) | Money requests and encrypted messages between contacts |
| [LUD-08 fast withdrawal](LUD08_FAST_WITHDRAW.md) | Redeeming withdraw links in one step |
| [Pay again](PAY_AGAIN.md) | Paying a past recipient again from History or the receipt |
| [LUD-11 pay again](LUD11_PAY_AGAIN.md) | Paying a service again, and service payees |
| [LUD-14 vouchers](LUD14_VOUCHERS.md) | Vouchers with a balance |
| [LUD-23 address sharing](LUD23_APP_WIDE_PLAN.md) | Asking for and sharing payment addresses across the app |
| [Clipboard offer](CLIPBOARD_OFFER.md) | Offering to pay what was just copied, once |
| [QR scanning without Play services](QR_SCANNER_FALLBACK.md) | Scanning on phones without Google Play services |

## Backup and identity

| Record | What it covers |
|---|---|
| [One Security area](SECURITY_AREA_PLAN.md) | Where backups, the exit kit and restore live |
| [Backup strategy](BACKUP_WOS_STRATEGY.md) | The backup screens, step by step |
| [Bitcoin and identity recovery](BACKUP_IDENTITY_UX.md) | Recovery for wallets and identities |
| [Cloud backup setup](CLOUD_BACKUP_SETUP.md) | Encrypted backup to Google Drive on Android |
| [Identities from another app](OWN_IDENTITY.md) | Using an identity made elsewhere |

## The app

| Record | What it covers |
|---|---|
| [Launch](LAUNCH.md) | From tapping the icon to holding the wallet |
| [App updates](APP_UPDATES.md) | How native builds find and offer updates |
| [Toasts](TOAST_INTERACTIONS.md) | When the app speaks up, and how |

## Notes

Earlier plans and research, kept for context. Not a description of the app as it is.

| Note | Status |
|---|---|
| [Android App Links](notes/android-app-links.md) | Open: verified links for shared cards |
| [MoneyBadger / CryptoQR](notes/PnP_honeybadger.md) | Not built |
| [Cloud backup plan](notes/cloud_backup.md) | Superseded by [Cloud backup setup](CLOUD_BACKUP_SETUP.md) |
| [NWC connection refactor](notes/nwc_store_refactor.md) | Superseded by [Nostr Wallet Connect](NWC.md) |

Images for the records live in [`images/`](images/), one folder per record.
