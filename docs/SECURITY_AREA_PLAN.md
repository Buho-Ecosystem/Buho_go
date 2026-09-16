# One Security area

Status: accepted September 16, 2026 and implemented on `feat/simplify-backup-wos`. The accepted WoS backup screens remain described in [Backup strategy](BACKUP_WOS_STRATEGY.md).

Two decisions changed after the first review of this proposal:

- App lock stays where it is, as a quick toggle at the top of Settings.
- Screen Privacy lives in Settings → Preferences.

Security therefore holds backups and restoration only. Device protection is not part of it.

## Recommendation

Create a permanent Security destination in the home menu. Put the wallet/identity backup choices directly on this page, followed by the optional cloud copy and the way back for people who already have a backup. The home keyring opens the same page while any applicable recovery phrase remains unchecked.

This gives users one place to learn and makes Settings and Profile simpler. It also removes the Settings-to-Backups navigation step. However, a cleaner screen alone does not prove that a task is easier: people must still find recovery after the reminder disappears.

Hidden navigation still adds an interaction step even when users recognize the hamburger icon. [Nielsen Norman Group's 2025 review](https://www.nngroup.com/articles/hamburger-menu-icon-recognizability/) supports treating discoverability as a tradeoff. Whether Buho users find Security more easily than the old paths needs a task-based usability check.

## 1. Entry points

| Entry | Behavior |
| --- | --- |
| Home → menu → Security | Permanent access to `/security`, including after all backups are checked. Sits directly under Settings. |
| Settings / You / Spend tab bar → keyring tab | Security is the fourth tab of the hub, so it is one tap away wherever people look for backups. The tab wears the grey keyring from the home reminder; it turns green when active. |
| Home → pending backup keyring | Opens `/security`. Keeps the readable Backup label and pending subject. Hidden entirely once every applicable phrase is checked. |
| Settings → Security section | Removed. The backup, Drive and restore rows moved to Security. |
| Settings → App lock | Unchanged: quick toggle at the top of Settings. |
| Settings → Screen Privacy | Moved from the old Security section into Preferences. |
| Profile → Identity backup | Removed. |
| Profile setup → Back up your card | Removed. Setup completion now means username plus name or photo. |
| `/identity/words` | Redirects to `/security`. |
| `/settings?section=backup` and `?section=backups` | Redirect to `/security`. |
| Required update → backup access | Opens `/security`; the update gate yields only to that route. |
| Welcome → restore | Unchanged before a wallet or identity has been set up. |

Security is a tab of the Settings hub and uses the hub chrome: the shared header with the title and the home icon, and the floating tab bar in the order Settings, Security, You, Spend (the same order as the menu doors). The tabs are peers, so there is no back chevron; the home icon is the way out.

## 2. Security page

Use Buho fonts, colors and the existing backup rows. Keep the page short and put the most important task first.

```text
← Security

  Bitcoin backup       [individual status]  >
  Identity backup      [individual status]  >

  Google Drive backup   Optional backup     >  supported Android builds
  Restore from backup   From another phone  >
```

- The backup rows ARE the split screen. Selecting one immediately starts its existing WoS flow. There is no Backups page or chooser between them.
- Show separate rows where recovery actually differs: Spark Personal and Business share one phrase; each Arkade wallet has its own. Identify rows using wallet names. Connected provider-managed wallets keep their recovery guidance.
- A checked row remains accessible for viewing the words with existing authentication and reveal protections.
- Google Drive opens the existing management flow: sign in, upload/replace, restore, delete remote backup, and sign out. Preserve platform availability and actual cloud status.
- Restore from backup asks which backup the person has: Identity, Bitcoin, or Google Drive where supported. Each reuses its existing restoration journey.
- Keep visible language about what was checked or saved. Avoid a blanket claim that everything is secure.

## 3. Numbered paper-backup flow

1. **Security:** choose Bitcoin or Identity backup.
2. **Prepare:** existing WoS instructions, note-and-pencil graphic, acknowledgement slider and Next; device authentication when configured.
3. **Write the words:** existing numbered words and Next.
4. **Check the words:** existing shuffled-word check; persist success only when verification and saving succeed.
5. **Backup completed:** shared celebration with the subject-specific large title, no subtitle, and Done.

Done returns to Security with that row checked. The user chooses when to start another pending backup. Every completed backup retains its dedicated celebration.

## 4. Home reminder rules

- Show the keyring and label while any applicable wallet phrase or the identity phrase is unchecked.
- After one backup, keep it visible if another remains pending and update its subject label.
- After all applicable phrases are checked, hide the entire shortcut. The earlier version hid only the label.
- Show it again when a new unchecked recovery set is introduced. A new account sharing an already-checked phrase must not create a duplicate task.
- Derive pending state from the same source as the Security rows, after stores are initialized. Do not use balance, banner dismissal or a Drive upload as proof of phrase verification.
- Finishing the last backup must not unmount or dismiss its success screen. The home trigger is not mounted while the recovery flow is open, so the two never interact.

## 5. Preserve feature scope

Consolidate backups without relocating every sensitive action into a long Security list:

| Feature | Location after change |
| --- | --- |
| Wallet and identity phrase backup/view | Security |
| Paper and Drive restoration | Security; welcome restoration remains reachable |
| Optional Drive management | Security → Google Drive backup |
| App lock | Settings quick toggles (unchanged) |
| Screen Privacy | Settings → Preferences |
| Per-identity private-key export | Existing identity-management detail, with explicit selected identity |
| Identity switching and local removal | Existing identity management |
| Wallet connections and removal | Existing wallet management |
| Kiosk PIN | Existing Kiosk configuration |

The identity phrase must not imply that it recovers unrelated imported identities. Preserve the explicit per-identity private-key export path and current recovery boundaries.

## 6. Implementation sequence

1. Add the Security route/page using the shared backup choices and recovery dialog. The page owns the restore chooser that the identity words page used to host.
2. Connect the menu door, the hub tab bar and the pending keyring to the new page. Keep a single definition of pending backup state. Verify that six menu entries and four tabs fit short screens and larger text.
3. Remove the old Settings Security section, move Screen Privacy into Preferences, and remove the Profile backup row and the profile-setup backup step. Audit progress/status consumers before changing the setup calculation.
4. Redirect `/settings?section=backup`, `/settings?section=backups` and `/identity/words`. Update the required-update recovery URL and its route guard in the same change.
5. Update the browser regression and documentation. Remove unused wrappers only after all callers have moved.

## 7. Review criteria

- From the pending keyring: one tap reaches the split; the next selects a backup. From home menu: menu → Security → backup selection. From Settings, You or Spend: the keyring tab.
- Users can find saved words when no home reminder is visible, and start restoration on a fresh installation without assistance.
- Both subjects still complete the existing five-page journey, including separate successes and failed-save handling.
- Checking one recovery set never checks unrelated sets; adding a new pending set restores the reminder.
- All cloud actions, imported-identity exports, update recovery access and legacy URLs remain usable.
- App lock and Screen Privacy behave exactly as before in their Settings locations.
- Back, cancellation, background concealment, keyboard operation, 320px layouts, short screens and translations work.

For a small usability review, ask people unfamiliar with the redesign to back up a pending identity, find saved words after completion, and restore on a new phone. Observe their first destination and whether they need help. If people repeatedly search Settings for backups, consider a single Security navigation link there. That would preserve one implementation and one destination, while adding a useful route to it.

## Decision

Consolidate backups and restoration into Security. The benefits are clearer ownership, fewer competing backup routes and a simpler Profile. The conditions are direct backup choices on Security, a persistent menu destination, accurate pending state, and preserved restoration access. Device protection stays in Settings. Measure success by whether users can finish and later find their tasks, alongside visual simplicity.
