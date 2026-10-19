<!--
  The pull request for getAlby/hub (issue #389). It is sent after a release,
  never before: the guides send Hub users to BuhoGO's "Connect a wallet"
  screens (#410, #412), which they only have once `dev` is merged to `main`,
  released and deployed (docs/APP_UPDATES.md, release step 4). The poster
  links below also point at `main`.

  Before sending:
  - the release with #410 and #412 is live on Play, Zapstore and go.mybuho.de;
  - set addedDate in SuggestedAppData.entry.tsx to the day of the PR;
  - check the poster links below resolve on `main` (they live in store/zapstore/);
  - connect a real Alby Hub once with these exact steps (see "Tested").
  Title and body below the line go to GitHub as they are.
-->

**Title:** feat: add BuhoGO to app store

---

Adds [BuhoGO](https://go.mybuho.de) to the app store, under Wallet Interfaces.

BuhoGO is an open-source (AGPL-3.0) Bitcoin wallet for Android and the web. It holds several wallets side by side (its own Spark and Arkade wallets, plus wallets connected over NWC or LNbits) and lets the person pick which one pays. With an Alby Hub connected, they pay and get paid from their Hub on their phone, next to their other wallets.

**Connecting, both ways:**
- *From the Hub* (this listing): the finalize guide follows BuhoGO's own labels: **Connect a wallet** → **Alby Hub** → **Scan a code from your Hub** (or **Paste** on the same phone). BuhoGO tests the connection before saving it (`get_info`, then `get_balance` and `get_budget` when allowed) and shows the Hub's name, balance and spending limit before **Add wallet**. A `nostr+walletconnect://` link opened on the phone lands in the same place.
- *From BuhoGO*: **Connect a wallet** → **Alby Hub** → **Open Alby Hub** opens `/apps/new` with BuhoGO's own `pubkey`, `request_methods`, `notification_types`, `app=buhogo` and a `return_to`. The person approves once; BuhoGO completes the connection from the return (or the Hub's info event addressed to its key) and never handles a copied secret. Works with Alby Cloud (`my.albyhub.com`) and self-hosted Hubs.

**Permissions:** the default set. BuhoGO uses `pay_invoice`, `make_invoice`, `lookup_invoice`, `get_balance`, `get_info`, `list_transactions`, and shows which of them a connection may use.

**Changes**
- `frontend/src/assets/suggested-apps/buhogo.png` (200 × 200)
- one entry in `SuggestedAppData.tsx`

**Links:** [Web app](https://go.mybuho.de) · [Google Play](https://play.google.com/store/apps/details?id=mybuho.buhogo) · [Zapstore](https://zapstore.dev/apps/mybuho.buhogo) · [Source](https://github.com/Buho-Ecosystem/Buho_go) · [Docs: connecting a wallet over NWC](https://docs-buhogo.netlify.app/nwc-wallet)

| | | | |
|---|---|---|---|
| <img src="https://raw.githubusercontent.com/Buho-Ecosystem/Buho_go/main/store/zapstore/01-everyday.png" width="180" alt="BuhoGO Home"> | <img src="https://raw.githubusercontent.com/Buho-Ecosystem/Buho_go/main/store/zapstore/03-wallets.png" width="180" alt="Several wallets in one place"> | <img src="https://raw.githubusercontent.com/Buho-Ecosystem/Buho_go/main/store/zapstore/02-send.png" width="180" alt="Send"> | <img src="https://raw.githubusercontent.com/Buho-Ecosystem/Buho_go/main/store/zapstore/05-receive.png" width="180" alt="Receive with one QR"> |

**Tested:** created a connection for BuhoGO in Alby Hub vX.Y.Z, scanned it with BuhoGO X.Y on Android and pasted it in the web app; both showed the Hub and added it.
