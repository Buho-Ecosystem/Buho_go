# Bitrefill draft: edge-case review, 2026-11-14

Reviewed the open draft's frame trust boundary, payment lifecycle, duplicate
protection, expiry checks, and voucher-email editing. The draft remains pending
Bitrefill approval; this review does not enable or merge the integration.

Fixed verified findings:

- **Unrecorded attempts could reach a wallet.** The ledger previously treated
  unreadable storage as an empty history and ignored failed writes. Payment now
  stops before the wallet call if the attempt cannot be durably recorded and
  read back. The UI gives a short retry message without storage terminology.
- **Completion bookkeeping could change a successful outcome.** Failed writes
  after payment retain the original attempted record and do not offer a retry.
  A synchronous balance-refresh exception also cannot turn success into failure.
- **Earlier paid updates were not remembered durably.** A widget paid update now
  creates a paid record even before a local attempt. Paid state cannot regress
  after a late refusal, and the in-memory paid set also guards replay.
- **History pruning could discard unresolved payments.** Pending entries now
  reserve their slots; a full unresolved ledger refuses another attempt instead
  of forgetting the first one.
- **A stale countdown could allow confirmation after expiry.** Recheck real time
  at confirmation and again after connecting the wallet, before provider payment.
- **The email sheet could erase input during its opening animation.** Initialize
  the draft when opening starts. Saving blocks repeat submit, dismiss, remove,
  and skip actions until it finishes.

Validation:

- 27 targeted tests passed across widget/ledger, payment helper, page, and email
  interaction tests. New failure cases were reproduced before correction.
- `BITREFILL_MOCK_ONLY=1 node scripts/check-bitrefill.mjs` passed against the
  local app with a stand-in storefront and simulated wallet, including an
  earlier paid update followed by another intent. No real order or payment.
- Production build and `git diff --check` passed.

The existing real-phone and Bitrefill approval checks remain outstanding. This
review does not claim live funded-payment or multi-tab acceptance testing.
