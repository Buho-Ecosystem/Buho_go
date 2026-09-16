# Bitcoin and identity recovery

## Flow and reference

The current manual backup follows the user-provided Wallet of Satoshi screenshots: **Security → notice → numbered words → order check → dedicated success**. See [Backup strategy](BACKUP_WOS_STRATEGY.md) for copy, page behavior, entry points and component responsibilities, and [Security area](SECURITY_AREA_PLAN.md) for why backups have one home.

Each completed backup has its own success moment. The Security page is reached from the home menu and, while words are unchecked, from the home keyring. Settings and Profile have no backup entries. The identity-card backup reminder is removed. The home banner and Settings attention strip remain disabled.

## Recovery scope

| Subject | Actual scope | Checked state |
| --- | --- | --- |
| Spark — Personal / Business | Accounts share one phrase | Spark metadata and legacy Spark flag, after durable persistence |
| Arkade | Each wallet has its own phrase | Only the selected wallet |
| Identity | One phrase derives the local Nostr identity accounts; profile and contacts are fetched from their Nostr storage | Identity backupConfirmed, after durable persistence |
| Connected NWC/LNbits wallet | Recovery belongs to its provider | No invented local phrase |
| Optional Google Drive copy | Existing encrypted snapshot of wallet credentials and identity seed on supported Android builds | Upload time, separate from paper verification |

Bitcoin and Identity are two subjects, not necessarily exactly two phrases. The wallet ID is pinned when the task opens, and identity confirmation checks the original identity fingerprint. A successful wallet backup never marks identity checked or another independent wallet checked.

## Secrets and lifecycle

- Acknowledgement and configured device authentication precede the word reveal. The words appear directly after that action when the app is in the foreground.
- The existing reveal timeout uses wall-clock elapsed time. Expiration hides words; returning from the check uses the same timed reveal.
- Closing or backgrounding clears displayed words and verification choices. Native authentication may finish while the document is hidden, but must never reveal words there.
- Every position must match before the Next action can save confirmation. Duplicate words can be selected in either visual order. Wrong-word feedback names the paper position without disclosing its answer.
- A failed durable save keeps the check retryable and does not claim success. View mode never marks a backup checked.
- The success screen uses the shared animated payment checkmark with a large wallet/identity completion title and explicit Done action, without supporting text. Reduced-motion mode shows a static check.

## Identity keys and restore

The profile supports public npub copying. Per-identity private-key export remains a separate copy-only task: no nsec preview, a pinned account, configured authentication and best-effort sensitive-clipboard clearing. Exporting an inactive identity does not switch the active profile or signer.

Paper restore asks whether the person is restoring Bitcoin or Identity because either can be a valid BIP-39 phrase. Identity restore requires explicit replacement confirmation when appropriate, then resolves the existing accounts, profile and contacts. Cancel preserves the current identity; failures retain input for correction. Wallet restore retains the existing provider recovery behavior.

Google Drive remains optional and independent of paper-word confirmation. See [Cloud backup setup](CLOUD_BACKUP_SETUP.md) for transport, encryption and Android configuration.

## Validation

- `npm test`: existing unit suites, including backup grouping, phrase lifecycle and identity confirmation rollback.
- `npm run build`: production compilation.
- `node scripts/backup-experience.mjs`: browser regression against the local Quasar server on port 9000. Uses published BIP-39 test vectors and fixed test-only encrypted fixtures, blocks provider connections, and mocks Google transport. Screenshots go to `output/backup-wos/`.

The browser regression checks the menu door and keyring entry, acknowledgement, direct reveal, full-order and repeated-word verification, separate Spark/Arkade/identity completion, failed-save retry, return to Security, the keyring leaving once everything is checked, Settings without backup rows, view mode, background cleanup, 24-word phrases, missing identity-card reminder and setup step, legacy URL redirects, English/German/Spanish narrow layouts, and existing identity restore and private-key interactions.

Native biometrics/PIN, Android Google consent and transport, VoiceOver/TalkBack, and actual provider recovery still require device acceptance testing. Browser tests do not certify those platform behaviors or guarantee recovery of profile data unavailable from Nostr relays.
