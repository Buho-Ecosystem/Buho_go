# Emergency exit for Spark wallets: implementation record

Issue [#269](https://github.com/Buho-Ecosystem/Buho_go/issues/269). Research and UX rules: `Plans WIP/unilateral-exit-map.md` and `Plans WIP/unilateral-exit/spark.md` (section 9 holds the design research). Design canvas: Emergency Exit UI Directions.

## What it does

A Spark wallet's money can move to plain Bitcoin without Spark's operators, using only the Breez SDK's unilateral exit API (`@breeztech/breez-sdk-spark`, 0.26.1 at the time of the per-wallet key change) and public Esplora endpoints that proxy `submitpackage`. The feature has three layers, matching the research: an always-on kit, a door that appears only when it matters, and a resumable exit page.

### The kit (always on, quiet)

`src/services/exitKit.js`, `src/stores/exitKit.js`, `src/utils/kitStorage.js`, `src/utils/exitKit.js`.

- After every settled payment, claimed deposit or SDK exit-state change, and once after each connect, the wallet exports `exportUnilateralExitState()` into app-owned IndexedDB (`buhoGO-exit-kits`, keyed by the wallet's Spark address). This storage outlives the SDK's own databases, which `deleteWalletStorage` wipes; a full app reset clears it together with the ledger and the reachability record. A refresh inside the one-minute debounce is deferred, never dropped.
- Each refresh runs an offline quote (`prepareUnilateralExit`, auto selection, the medium fee tier, the same tier an exit starts at) so the receipt says what could leave today, and remembers the wallet's deposit address so it can never be chosen as a destination.
- On connect, a stored kit is imported back with `importUnilateralExitState` before refreshing, so an evicted or freshly created SDK database never overwrites a good kit with an empty one.
- Removing a Spark wallet takes one last export first (`removeWallet` in the wallet store); the delete dialog says so.
- The Drive backup payload carries `exitKits`; a restore stores them for import at the next connect. Sharing writes a file encrypted with a key derived from the recovery words (`deriveKitPassphrase`), so a leaked file is useless without the words and the words alone are useless without a kit.
- `config.exitChainAutoFetchEnabled = true` is set explicitly in `src/services/breezSdk.js`.

### The door

- Security, backup area: the Spark-only Emergency exit kit row (`BackupChoices.vue`) opens `ExitKitSheet.vue` with the receipt, copies, share, refresh, the explainer and the door to start or resume an exit. This is the kit's only home: it sits next to the recovery words it depends on, and never in Settings or the Danger Zone (#381). `HowExitWorksSheet.vue` is the briefing card. The exit page returns to Security. The Spark backup row keeps its second state line (`Exit kit checked today`). `/security?open=exit-kit` opens the sheet directly.
- The kit sheet starts with a compact status and exit-review entry for each wallet. Native disclosure controls reveal amounts, copy dates, sharing and refresh actions. Missing kits, refresh failures, phone-only copies and outdated external copies remain visible when collapsed. This applies [Apple HIG's progressive-disclosure guidance](https://developer.apple.com/design/human-interface-guidelines/layout) to maintenance details; the fee review and final send confirmation remain explicit.
- Home never shows the exit. When Spark cannot be reached, one quiet line under the balance names the cause (`SparkStatusLine.vue`): "No internet connection", "Spark can't be reached", or after a long verified outage "Spark unreachable since …". It opens `SparkStatusSheet.vue`: what happened, that the money is safe, what to try. Only the long-outage sheet mentions the exit, below "waiting is the best choice", with the kit's fee figures, and only when more comes back than the fees take; its row leads to the kit in Security. Nothing to dismiss: the line leaves once Spark answers. Exit progress is available through Security; no progress chip appears on the home screen.
- Kiosk mode never reaches any of it: the kiosk router guard redirects unlisted routes, and the line respects `isKioskRestricted`.

### When Spark counts as unreachable

The signal points at an irreversible, paid action, so it only moves on proof (`src/utils/sparkReachability.js`, checks in `src/services/sparkReachabilityCheck.js`, #381):

- One verdict per check: answered, no internet, Spark down, or unknown. A Spark sync reports its outcome once, when it settles, however many callers wait on it; a failure alone never marks Spark down.
- Spark down needs the internet to work (`utils/connectivity.js`: independent HTTPS hosts) and at least two of the three Spark operators to fail when asked directly (`utils/sparkOperators.js`). Spark signs with two of three, so one operator away is no outage. Answers that are only 5xx, 429 or 401 count as failures (`utils/sparkNetwork.js`).
- Any answer from Spark clears everything. Checks never run while the app is hidden or in the first 15 seconds after start, resume or reconnect.
- Time counts only while the app is checking: each verdict adds the gap since the previous one, capped at 10 minutes. A 48-hour silence or a clock that went backwards restarts the streak. Nothing is shown from saved state before the session's own checks.
- Level 1, no internet: after one check. Level 2, Spark can't be reached: two Spark-down verdicts at least two minutes apart in this session. Level 3, long outage: Spark down in at least three app sessions (an hour away starts a new one), 24 hours from the first to the latest verdict, 30 minutes observed, the latest under 10 minutes old, and Spark's own status (`getSparkStatus()`) not "operational". When that status says operational, the sheet points at this network instead.
- One record for all Spark wallets (`buhoGO_spark_reachability_v1`). The earlier per-wallet record and the banner dismissal are deleted on start.

### The exit page

`src/pages/EmergencyExitPage.vue` at `/security/exit/:walletId`, driven by `src/services/emergencyExit.js` over a persisted ledger (`src/stores/emergencyExit.js`, transitions in `src/utils/exitLedger.js`, chain planning in `src/utils/exitPlan.js`).

1. Start: quote at the medium fee tier with auto leaf triage. The page shows three figures with one vocabulary: fee money you send (`singleUtxoFundingSat`), taken from the amount (the sweep's own fee), and what arrives. Destination defaults to the wallet's own BIP-84 destination address (see "Keys per wallet"; any Bitcoin wallet restoring the words finds it) and can be changed to any plain Bitcoin address; every Spark wallet's deposit address and every exit's fee money address are refused. Free, and cancellable behind a confirmation that says where the fee money stays.
2. Fee money: the person sends the quoted amount to the wallet's own fee money address under the same words. The page polls the address; confirmed value moves the stage forward.
3. Send: a review sheet with labelled amount, full destination and fee rows, followed by the irreversible warning, two-week timing and the duty to keep this phone. This follows [Apple HIG's advice to keep alerts brief](https://developer.apple.com/design/human-interface-guidelines/alerts): transaction details use a structured sheet instead of a long alert message. Cancel gets initial keyboard focus; both actions stay reachable when enlarged text makes the details scroll. The exit re-quotes for the same leaves at today's fees, signs with `unilateralExit` and the SDK's `singleKeyCpfpSigner` over the fee money key (only the inputs the requirement needs; the signer is released and the key bytes wiped afterwards), and broadcasts the first package. If fees rose, it asks for more fee money instead.
4. On its way, unlock, sweep, done: every pass reads tip height and transaction statuses (re-reading anything confirmed without a known height, since timelocks count from the parent's height), broadcasts whatever has its dependencies confirmed and its timelock matured (tree transactions as parent plus fee child packages, fan-out and sweep alone), and derives the stage. Esplora calls honour the person's configured mempool instance first, fail over across public instances, and treat a node without the package route as unavailable rather than as a rejection. A boot file keeps this running every five minutes whenever the app is open, without a Spark connection. Done keeps the receipt (full address, copy, explorer link, how to spend it) until acknowledged.
5. A reminder is scheduled for the unlock date when the LocalNotifications native plugin is present; otherwise the copy says to open the app on the day.

### Keys per wallet

All Spark wallets share one recovery phrase and differ by Breez account number (`src/utils/sparkAccounts.js`). The Breez and Spark docs leave the CPFP funding key to the app, so `src/utils/exitKeys.js` gives every account its own pair on the BIP-84 account-0 receive chain, all inside the usual gap limit of 20:

| Spark account | Destination | Fee money |
|---|---|---|
| 1 | `m/84'/0'/0'/0/0` | `m/84'/0'/0'/0/1` |
| n = 2..5 | `/0/(2n-2)` | `/0/(2n-1)` |
| 0 | `/0/10` | `/0/11` |

Account 1 keeps the addresses every exit used before. A shared fee money address let one wallet's exit count, and spend, another exit's fan-out outputs and CPFP change (both pay the funding script), so each account now has its own. Signing derives from the path the ledger recorded at start, restricted to the six known fee money paths, so an exit begun under the shared layout finishes on its own key. A kit cache from before is derived again on its next refresh; when the fee money address moved, the old one is kept as `legacyFundingAddress` and the exit page says how much fee money still sits there (it now belongs to account 1's exit and stays under the words).

## Validation

- `npm test` runs the emergency-exit specs: key derivation against the BIP-84 vectors and the per-account layout, signing only from known fee money paths, address validation, chain planning, ledger transitions, the Esplora client with failover and package rules, the kit life cycle, the exit driver end to end against fakes, outage tracking, and native reminder scheduling without awaiting a Capacitor proxy.
- `node scripts/check-emergency-exit.mjs` against the dev server (`pnpm dev --port 9011`, or set `EXIT_BASE_URL` for another port): seeds public test words, stubs the SDK provider and every chain endpoint, and drives the real UI through the Security backup area, keyboard disclosure of kit details, start, destination validation, fee money, confirmation and safe dismissal, package broadcasting in dependency order, the timelock, the sweep, done with its receipt, cancel behind its confirmation, the Home status line and its sheet (no exit on Home), no progress chip on home, resume from Security, German at 320px with 200% text, and the dark theme. Screenshots land in `output/emergency-exit/`.

## Limits and follow-ups

- No live exit was performed. The SDK's signing and the Esplora package endpoints were exercised with fakes; a funded run on a throwaway wallet is the next gate.
- The merged app includes and registers `@capacitor/local-notifications`. Reminders still require OS permission and on-device verification; when unavailable, the page says "Open BuhoGO on or after {date}".
- The Breez export is not in Blink's bundle format; a way out without BuhoGO remains open research.
