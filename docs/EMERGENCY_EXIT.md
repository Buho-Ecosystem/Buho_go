# Emergency exit for Spark wallets: implementation record

Issue [#269](https://github.com/Buho-Ecosystem/Buho_go/issues/269). Research and UX rules: `Plans WIP/unilateral-exit-map.md` and `Plans WIP/unilateral-exit/spark.md` (section 9 holds the design research). Design canvas: Emergency Exit UI Directions.

## What it does

A Spark wallet's money can move to plain Bitcoin without Spark's operators, using only the Breez SDK's unilateral exit API (`@breeztech/breez-sdk-spark` 0.24.1) and public Esplora endpoints that proxy `submitpackage`. The feature has three layers, matching the research: an always-on kit, a door that appears only when it matters, and a resumable exit page.

### The kit (always on, quiet)

`src/services/exitKit.js`, `src/stores/exitKit.js`, `src/utils/kitStorage.js`, `src/utils/exitKit.js`.

- After every settled payment, claimed deposit or SDK exit-state change, and once after each connect, the wallet exports `exportUnilateralExitState()` into app-owned IndexedDB (`buhoGO-exit-kits`, keyed by the wallet's Spark address). This storage outlives the SDK's own databases, which `deleteWalletStorage` wipes; a full app reset clears it together with the ledger and the reachability record. A refresh inside the one-minute debounce is deferred, never dropped.
- Each refresh runs an offline quote (`prepareUnilateralExit`, auto selection, the medium fee tier, the same tier an exit starts at) so the receipt says what could leave today, and remembers the wallet's deposit address so it can never be chosen as a destination.
- On connect, a stored kit is imported back with `importUnilateralExitState` before refreshing, so an evicted or freshly created SDK database never overwrites a good kit with an empty one.
- Removing a Spark wallet takes one last export first (`removeWallet` in the wallet store); the delete dialog says so.
- The Drive backup payload carries `exitKits`; a restore stores them for import at the next connect. Sharing writes a file encrypted with a key derived from the recovery words (`deriveKitPassphrase`), so a leaked file is useless without the words and the words alone are useless without a kit.
- `config.exitChainAutoFetchEnabled = true` is set explicitly in `src/services/breezSdk.js`.

### The door

- Settings → Advanced: the Spark-only Emergency exit kit row opens `ExitKitSheet.vue` with the receipt, copies, share, refresh, the explainer and the door to start or resume an exit. `HowExitWorksSheet.vue` is the briefing card. The exit page returns to Advanced, expanded. Security keeps the backup card's second state line (`Exit kit checked today`).
- The kit sheet starts with a compact status and exit-review entry for each wallet. Native disclosure controls reveal amounts, copy dates, sharing and refresh actions. Missing kits, refresh failures, phone-only copies and outdated external copies remain visible when collapsed. This applies [Apple HIG's progressive-disclosure guidance](https://developer.apple.com/design/human-interface-guidelines/layout) to maintenance details; the fee review and final send confirmation remain explicit.
- Home: `ExitBanner.vue` appears only after a sustained outage (`src/utils/sparkHealth.js`: three failed synced reads over six hours, recorded by the provider's synced reads and by a five-minute reachability probe from the exit monitor, never while the phone itself is offline) and can be dismissed for a day. Exit progress is available through Settings → Advanced; no progress chip appears on the home screen.
- Kiosk mode never reaches any of it: the kiosk router guard redirects unlisted routes, and the banner respects `isKioskRestricted`.

### The exit page

`src/pages/EmergencyExitPage.vue` at `/security/exit/:walletId`, driven by `src/services/emergencyExit.js` over a persisted ledger (`src/stores/emergencyExit.js`, transitions in `src/utils/exitLedger.js`, chain planning in `src/utils/exitPlan.js`).

1. Start: quote at the medium fee tier with auto leaf triage. The page shows three figures with one vocabulary: fee money you send (`singleUtxoFundingSat`), taken from the amount (the sweep's own fee), and what arrives. Destination defaults to `m/84'/0'/0'/0/0` of the wallet's own words (any Bitcoin wallet restoring the words finds it) and can be changed to any plain Bitcoin address; the wallet's own deposit address is refused. Free, and cancellable behind a confirmation that says where the fee money stays.
2. Fee money: the person sends the quoted amount to `m/84'/0'/0'/0/1` of the same words. The page polls the address; confirmed value moves the stage forward.
3. Send: a review sheet with labelled amount, full destination and fee rows, followed by the irreversible warning, two-week timing and the duty to keep this phone. This follows [Apple HIG's advice to keep alerts brief](https://developer.apple.com/design/human-interface-guidelines/alerts): transaction details use a structured sheet instead of a long alert message. Cancel gets initial keyboard focus; both actions stay reachable when enlarged text makes the details scroll. The exit re-quotes for the same leaves at today's fees, signs with `unilateralExit` and the SDK's `singleKeyCpfpSigner` over the fee money key (only the inputs the requirement needs; the signer is released and the key bytes wiped afterwards), and broadcasts the first package. If fees rose, it asks for more fee money instead.
4. On its way, unlock, sweep, done: every pass reads tip height and transaction statuses (re-reading anything confirmed without a known height, since timelocks count from the parent's height), broadcasts whatever has its dependencies confirmed and its timelock matured (tree transactions as parent plus fee child packages, fan-out and sweep alone), and derives the stage. Esplora calls honour the person's configured mempool instance first, fail over across public instances, and treat a node without the package route as unavailable rather than as a rejection. A boot file keeps this running every five minutes whenever the app is open, without a Spark connection. Done keeps the receipt (full address, copy, explorer link, how to spend it) until acknowledged.
5. A reminder is scheduled for the unlock date when the LocalNotifications native plugin is present; otherwise the copy says to open the app on the day.

## Validation

- `npm test` runs 7 new spec files (39 tests): key derivation against the BIP-84 vectors, address validation, chain planning, ledger transitions, the Esplora client with failover and package rules, the kit life cycle, the exit driver end to end against fakes, and outage tracking.
- `node scripts/check-emergency-exit.mjs` against the dev server (`pnpm dev --port 9011`, or set `EXIT_BASE_URL` for another port): seeds public test words, stubs the SDK provider and every chain endpoint, and drives the real UI through Settings → Advanced, keyboard disclosure of kit details, start, destination validation, fee money, confirmation and safe dismissal, package broadcasting in dependency order, the timelock, the sweep, done with its receipt, cancel behind its confirmation, the outage banner, no progress chip on home, resume from Settings, German at 320px with 200% text, and the dark theme. Screenshots land in `output/emergency-exit/`.

## Limits and follow-ups

- No live exit was performed. The SDK's signing and the Esplora package endpoints were exercised with fakes; a funded run on a throwaway wallet is the next gate.
- Reminders need `@capacitor/local-notifications` added to both package files plus `npx cap sync` and the Android 13 notification permission. Until then the page says "Open BuhoGO on or after {date}".
- The Breez export is not in Blink's bundle format; a way out without BuhoGO remains open research.
- The Business half of a Spark pair refreshes its kit only while it is the connected wallet (single live Spark connection).
