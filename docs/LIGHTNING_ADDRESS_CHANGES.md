# Lightning address changes

Issue: [#505](https://github.com/Buho-Ecosystem/Buho_go/issues/505).

A Lightning address is a receiving destination. Renaming it disables the old destination while keeping its name reserved. Moving it changes which wallet receives **future** payments; it does not move balances or existing payments.

## Interaction

The address sheet checks the current assignment before offering a change. Typing a name only checks availability. **Review address** shows the complete replacement, the old address that will stop receiving, and a reminder to update contacts, shared QR codes, and automatic payouts. **Change address** submits the reviewed change; **Cancel** returns to editing.

Availability and error feedback stays beside the relevant control. Checks have a retry action; submissions show progress and prevent duplicate submission or dismissal while running. The success state offers the confirmed address for copying. An uncertain outcome offers **Check address**, and never offers an unverified address for copying. The entered name survives recovery.

The move sheet retains its existing destination selection and consequence explanation, adds the balance distinction, and offers **Check addresses** when an outcome is uncertain. It cannot submit again without a source address.

These choices apply Apple's [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback), [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts), [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), and [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles): state consequences before commitment, put status in context, use specific actions, and support recovery. Text is provided in English, German, and Spanish. Status is conveyed in text and accessible live regions as well as color.

## Network and persistence rules

- Rename, move, fresh checks, and automatic setup share per-wallet exclusion. A move locks both wallets. A change event received during an operation triggers another authoritative check afterwards.
- Before submitting a registration or transfer claim, persist `metadata.lightningAddressPending`. If the save fails, do not submit. Shared address readers suppress both the live and persisted address while pending, including after a reload. Cached metadata is retained to follow an existing profile through a confirmed rename.
- On a lost reply, query the server before interpreting the outcome. A successful operation can be recovered as success. A failed read leaves the pending marker and an explicit recovery action. Reconnect also resolves pending assignments before automatic registration.
- Compare the fresh assignment with the one the person reviewed. If it changed elsewhere, require another review.
- Generate another random name only after an availability check says the candidate is taken. A network failure, rate limit, or missing registration result stops the attempt; it cannot consume a string of reservations.
- Keep the requested username with the pending marker. If the server confirms no assignment after a failed attempt, retry that same name when it is still available to the wallet.
- Preserve a replacement another device already gave the source wallet after a transfer. If replacement registration is unconfirmed, withhold it until a fresh check or reconnect.

### Adversarial regression checks

The red-team/blue-team review found four gaps in the initial implementation and added regression coverage before merge:

- A delayed SDK change event could replace a confirmed address with an old payload. A delayed null event could also cause the real provider to register a new name unnecessarily. Events now invalidate the assignment and trigger a fresh server check; their payloads never authorize a rename or establish ownership.
- An open sheet retained its own copyable address after the store changed, marked the assignment pending, or removed the wallet. Store changes now invalidate that view, and copying checks the current assignment synchronously so a pending render cannot expose the stale address.
- Transfer persistence briefly cleared the source wallet's pending marker before replacement recovery began. Persisted snapshots now retain the source's uncertain state continuously until it has a fresh confirmed assignment, so a restart cannot revive the live SDK's old ownership cache.
- A restarted SDK could return an address older than the app's saved assignment or revive a freshly confirmed absence. Setup now checks mismatched snapshots and confirms the server's state before automatic registration. A separate durable absence marker suppresses old cached values while still allowing a first claim. These cases use the real provider in regression tests rather than relying on a stronger fake server.

Automatic setup also checks the wallet object, provider, and reconnect epoch around asynchronous work, so a superseded attempt cannot write over a newer connection. A confirmed absence retains the former name solely for profile continuity; the absence marker prevents sharing it, and a later claim can update a profile that still points at that former name. A known transferred name is discarded from the source instead.

### Why the lookup uses a disposable SDK

In the pinned [Breez SDK 0.26.1 implementation](https://github.com/breez/spark-sdk/blob/0.26.1/crates/breez-sdk/core/src/sdk/lightning_address.rs), `get_lightning_address` returns the stored registration when its cache has been populated. `sync_wallet` is not a public force-refresh API for that registration. Reading the live getter again cannot establish ownership after a lost response.

`lookupLightningAddress` therefore uses the supported getter on a separate SDK with empty, unique storage and the `defaultServerConfig` preset. This preset disables background tasks and automatic optimizations; disabling just the client preset's background flag is invalid. The lookup does not join the live registry or start wallet synchronization, deposit claims, or payment actions. It uses the existing encrypted-wallet recovery path to construct the signer, and does not retain the recovery phrase on a provider. It disconnects the temporary instance and deletes its storage afterwards.

The caller stops waiting after 15 seconds. A late read only completes cleanup; it cannot publish a late result into the store. This has an initialization cost, so it is used for explicit address checks, mutation preflight, and uncertain-outcome recovery rather than balance polling.

Transfer authorization is also produced on the disposable instance after recovery, because the SDK signs the username from its own cache. It grants the selected destination permission to claim that freshly checked name without changing ownership itself. The live destination SDK submits the claim after the reviewed assignments have been checked.

## Cooldown policy

[BitBox documents](https://bitbox.helpjuice.com/en_US/receive-lightning-payments) a 24-hour change limit but does not explain its rationale or establish a universal Breez SDK requirement. The [Breez guide](https://sdk-doc-spark.breez.technology/guide/receive_lnurl_pay.html) describes replacement, reservations, and atomic address transfer.

This change handles upstream rate limits without inventing an expiry or a local security guarantee. A service-enforced rename quota is a separate server policy. A local timer would be bypassable and could prevent a typo correction or the first personalization of an automatically assigned name. Apple HIG does not prescribe a 24-hour limit.

## Validation

Run `npm test`. Address-specific cases cover lost replies, unavailable reconciliation, durable pending state, failed persistence, stale availability responses, overlapping mutations, profile following, cached SDK reads, and lookup timeout cleanup.

On Node 25, the full suite also passes with `NODE_OPTIONS=--no-experimental-websocket npm test`. This isolates unit tests from Node's native relay sockets; an existing identity test can otherwise finish its assertions while leaving network connections open. The browser checks below exercise their own intercepted transport separately.

For rendered checks, start a disposable development server with a fixture API key:

```sh
VITE_BREEZ_API_KEY=test-fixture-key npm run dev -- --port 9019
node scripts/check-lightning-address.mjs
```

The script blocks upstream connections and scripts the address server while exercising the actual sheets and store actions. It also runs the real pinned WASM SDK on regtest against an intercepted LNURL endpoint: an existing instance returns its cached assignment, while the production fresh-lookup helper returns the changed assignment. It uses the public BIP-39 test mnemonic and no funded wallet. Screenshots go to `output/lightning-address/`.

Screenshots demonstrate the rendered web UI, including light/dark and German/Spanish at 320px. They do not establish native iOS keyboard or VoiceOver behavior, which still needs an on-device check.
