# Backup: one Buho split screen, then the WoS experience

## Agreed direction

Use one wallet/identity selection screen, then copy the four-page Wallet of Satoshi UX from the user's screenshots. Pages 2–5 use the reference wording and visual hierarchy with Buho's colors, typography, logo and success animation. Each backup gets its own dedicated success screen.

The notice and word-check German copy is transcribed from the screenshots, including their phrasing. The success page uses a subject-specific completion title only. English and Spanish translate it. Necessary adaptations are the identity subject, whether device authentication is enabled, and support for either 12 or 24 words (the preparation text does not promise exactly 12). Wallet/provider scope stays visible with the words so the person can distinguish their paper copies. Error and expired-reveal states retain contextual Buho copy because those states were not provided in the references.

## User pages

1. **Security.** Select Bitcoin wallet recovery or Identity recovery, with an independent checked state for each set. Spark Personal and Business share one row. Each Arkade wallet has its own row on this same page. Existing checked backups open in view mode. The optional Google Drive copy and Restore from backup sit below as quieter rows.
2. **Backup Wallet / Backup Identity.** Reference introduction, four notice paragraphs, WoS-style note-and-pencil graphic, an “I understand” slider switch with clear off/on states and fixed bottom “Next”. Device authentication follows when configured.
3. **Write the words.** Reference instruction, numbered two-column grid, reference note that the next page asks for confirmation, and bottom “Next”. Words appear after acknowledgement and successful unlock. The existing two-minute reveal timeout still conceals them; a Show words control appears only after concealment. A 24-word phrase scrolls.
4. **Check the order.** Reference instruction and one shuffled two-column word grid. Tapping correct words colors their existing tiles and adds the selected position. “Next” remains disabled until the whole order matches. It persists the selected backup's checked state before showing success.
5. **Sicherung abgeschlossen! / Backup complete!** One full-screen celebration per completed backup, using the shared BackupSuccessScreen and existing SuccessCheckmark animation. The large title names wallet or identity. There is no subtitle or supporting text. Done returns to the selection screen with the chosen set checked.

There is no automatic sequence through other backups. Each starts from the Security page and ends with its own success. There is no progress stepper, repeated preparation heading, second word-selection grid, separate Confirm action, or backup-coverage list on success.

## Entry points

| Entry | Destination |
| --- | --- |
| Home → menu → Security | `/security`, always |
| Settings / You / Spend tab bar → keyring tab | `/security`, always |
| Wallet home keyring | `/security`, shown only while a set of words is unchecked |
| Required update → backup access | `/security`, the one route the update gate yields to |
| `/settings?section=backup`, `/settings?section=backups`, `/identity/words` | Redirect to `/security` |

Settings and Profile carry no backup entries. App lock stays a Settings quick toggle and Screen Privacy lives in Settings → Preferences; see [Security area](SECURITY_AREA_PLAN.md) for the reasoning.

**The identity-card backup status/reminder is removed**, as is the profile setup step for backing up. The QR action, public-key copy and other card interactions remain on the card. The previously disabled home banner and Settings attention strip remain disabled.

Google Drive and restore keep their existing journeys behind the Security rows. Google Drive remains optional on supported Android builds and never marks paper words checked.

## Code responsibilities

- `SecurityPage.vue`: the `/security` route. Hosts the choices, the recovery dialog, the Drive sheet and the restore chooser, and returns to itself after each success.
- `BackupChoices.vue`: the wallet/identity rows with per-set status, plus the quieter Drive and Restore rows.
- `RecoveryPhraseDialog.vue`: one notice/write/check lifecycle for both subjects, with store adapters and a fixed bottom action.
- `useRecoveryPhraseFlow.js`: existing authentication/load/save lifecycle, timed concealment and secret cleanup.
- `MnemonicOrderVerify.vue`: shuffled choices, duplicate-word-safe matching, wrong-word feedback, and completion signal.
- `BackupSuccessScreen.vue`: shared subject-aware success content, using `SuccessCheckmark.vue`.
- `src/css/recovery.css`: shared recovery screen and word-tile styling.
- Each locale's `backup.js`: the grouped `wosBackup` reference copy.

Backups stay scoped to their real recovery data. Verifying Spark covers its shared accounts; Arkade and identity remain independent. Failed persistence, canceled unlock, closing or backgrounding never count as successful verification. Viewing words never changes backup state.

See [Backup implementation and validation](BACKUP_IDENTITY_UX.md) for test instructions and platform limits.
