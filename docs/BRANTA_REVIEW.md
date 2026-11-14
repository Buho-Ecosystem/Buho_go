# Payment review: red-team and blue-team checks

[Feature and behavior](BRANTA.md)

The review covered payment correctness, business attribution and the existing payment flow. Reviewers read across component, Wallet, provider and metadata boundaries; browser checks use the actual Vue screens, the public Branta SDK and simulated wallet/verifier responses. No funds move in these checks.

| Risk examined | Resolution and regression coverage |
|---|---|
| One verified destination brands another route or sibling payment | Match the decrypted destination to its owning business and the selected SDK-prepared route. Ambiguous owners remain ordinary payments. |
| A quote expires and Spark selects another route during submission | Check the actual prepared destination before the provider's debit. Refuse the attempt for another explicit review without disconnecting the wallet or generating an error report. |
| A late result changes the recipient under a finger | Bind one lookup session to the request, wallet, amount and route; freeze settled identity. Changed-code results latch and block submission. |
| A stale or changed business is silently accepted | Refresh stale checks before confirmation; changed identity requires review. Invalid or expired TTL data cannot create a permanent match. |
| A receipt inherits branding from another payment | Require wallet-scoped transaction proof; reject time/amount-only business association, incoming collisions and unscoped legacy claims. Preserve the first accepted historical snapshot. |
| A receipt shows a previous context while loading | Bind disclosure to the loaded route and wallet; discard stale asynchronous loads and close details on context changes. |
| Technical information overwhelms the main review | Keep the business logo and amount prominent. Current and saved checks use shared details within their existing hosts, with Back and focus restoration. |
| The view adapter drops the business artwork or check time | Pass the full normalized verification snapshot to the shared presentation; assert the actual logo and timestamp in the browser. |
| Persistent sheets swallow Escape in the pinned Quasar version | Handle send-sheet Escape directly inside the card, preserving child-view Back, busy guards and native redeem/charge behavior. |
| Locale input changes the amount | Validate decimal/grouping structure, reject ambiguous pasted amounts and preserve editable invalid drafts. Keep the known decimal when editing an accepted draft; cover character-by-character German entry, blur and delete/reinsert as well as grouped sats. |
| Floating-point BTC conversion loses a satoshi | Convert decimal digits with integer arithmetic; verify 0.00000029 BTC is 29 sats and exact display through the supported safe-integer range. |
| Buttons allow changes during a send | Guard both UI controls and handlers; preserve existing slide, quote, refund, card and payout rules. |
| Missing artwork, offline service or unsupported routes block ordinary payment | Use initials or the ordinary recipient; keep no-match/unavailable checks quiet. Only an explicit changed-code result blocks. |
| External records or logos introduce unsafe URLs | Restrict to configured HTTPS Branta origins; omit invalid links and credentials. Open records only on request; handle native/offline failures briefly. |
| SDK update accidentally changes on-chain payment behavior | Preserve existing speed selection, SDK fee breakdown, routing preferences and execution fee limits; exercise their existing browser/provider regressions. |

Validation commands and screenshot evidence are recorded in [BRANTA.md](BRANTA.md). Browser keyboard and enlarged-text checks complement unit coverage; funded payments and native-device acceptance remain separate release checks.
