# LUD-14 vouchers: implementation and impact

Issue [#267](https://github.com/Buho-Ecosystem/Buho_go/issues/267), implemented on `flow_improvement` against `dev`.

## Protocol behavior

The [LUD-14 specification](https://github.com/lnurl/luds/blob/luds/14.md) lets a withdrawRequest carry a `balanceCheck` URL: calling it later returns a fresh withdrawRequest for whatever is left. BuhoGO reads the field at the same boundary as every other withdraw field (`src/utils/lnurlWithdraw.js`): the URL must be https (http only for a .onion host), carry no credentials or fragment, and share its host with the callback, otherwise the code is simply not tracked. `currentBalance` is read as the balance to display; `maxWithdrawable` stays the bound for what can be taken now.

A voucher retains durable scanned-source aliases alongside its eight most recent rotating URLs: the decoded link that was scanned, each `balanceCheck` the service handed out, and the URL called on a re-check (`sourceUrl` travels with the parsed answer). That single rule keeps a rescan of the paper code, a sweep from the list, and a service that rotates its URL on every answer on one record.

An answer for a known voucher that carries no `balanceCheck` erases the voucher, as the specification requires. Only zero withdrawable funds with no positive total balance empties a voucher. A positive `currentBalance` remains visible even when nothing can be withdrawn yet; a `status: ERROR`, an HTTP failure, a transport failure or an unexpected tag is recorded as a failed check with its reason, and the last known figure stands.

The store re-checks stale vouchers (older than 60 s) when the Vouchers sheet opens and once after receipt of a withdrawal is confirmed. There is no polling and no check at app start. Confirmed-empty vouchers leave the list and are pruned after 7 days. Funded and unresolved vouchers are never automatically evicted by age or list size. The stored URL is the bearer right to the remaining funds, so forgetting one is a confirmed action.

## App-wide impact

| Flow | Behavior |
| --- | --- |
| Scan, paste, clipboard strip, NFC, `lightning:` / `lnurlw:` links, LUD-08 inline links, Receive → Redeem | All reach `onPaymentDetected`, where every resolved withdrawRequest is handed to the voucher store. Intake follows the code, not a surface. |
| Receive sheet | One summary row under the header while at least one voucher holds money (title or count, sum left, disclosure). Shown in every receive view. Nothing when there is nothing. |
| Vouchers subview | The existing Receive dialog shows the list; Back preserves the receive form and restores focus. Rows are single native buttons: tap sweeps through the same dispatcher and review a scanned code takes. Edit exposes Remove, which asks first. Failed checks are said in words next to the last known figure. |
| Home | A 6 px dot on the Receive button while a voucher holds money; the label reads "Receive payment, vouchers saved". |
| Withdraw success | Shows where to find the voucher immediately, then the authoritative balance after its post-confirmation check. Never deducts twice or guesses that the voucher is empty. |
| Spark, LNbits, NWC | A voucher redeems into the active wallet through the existing invoice providers. Arkade keeps its Lightning-unavailable message. |
| Locked kiosk | Boots without the wallet page and never shows vouchers. |
| Web | Behaves like native; the audit harness covers it. |

## Apple-guided experience

[Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables), [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) and [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) guide the surfaces. The receive flow stays a receive flow: vouchers get one summary line and a subview within the same sheet. Enlarged text wraps and scrolls; narrow headers give the title its own row. Every row is one control at least 44 pt tall with a disclosure indicator that means "navigates"; nothing is nested, so Enter fires one action. Destructive removal is behind Edit and confirmed. The close glyph is never reused for delete. No refresh control exists because the app checks on its own when the list opens.

## Validation

- `node src/stores/__tests__/withdrawVouchers.spec.js`: store tests covering identity across carriers and rotation, erase on absence, ERROR versus empty, `currentBalance` priority, the domain title fallback, stale re-checks, reload, explicit removal, funded retention beyond 180 days and 30 entries, repeated URL rotation, unavailable funds and empty-only pruning.
- `node --test src/utils/__tests__/lnurlWithdraw.spec.js src/pages/__tests__/fastWithdraw.spec.js`: parser and Wallet page integration, including `sourceUrl` on inline and fetched answers and the tracking side note that never blocks a withdrawal.
- `node scripts/check-lud14.mjs`: browser fixtures on the real Wallet page: the home dot and the summary row, the sheet's automatic re-check with a rotating service and a service ERROR, Enter on a row opening the redeem review with one fetch and no invoice, Edit → Remove with confirmation, the empty state, and en-US/de/es in light/dark at 390 px, 320 px with 200% text and 768 px.

- `node --test src/pages/__tests__/walletFlow.spec.js`: settlement ordering, stale receipt guards and wallet balance request attribution.
- Follow-up evidence: `output/pr287-fixes/INDEX.md`. Browser checks assert actual computed text growth and one visible dialog, including 320 px at 200% text in all three locales.
