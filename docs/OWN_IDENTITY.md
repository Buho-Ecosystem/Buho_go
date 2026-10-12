# Identities from another app

Implementation record for using an existing identity (made in another app) in BuhoGO, next to the identities BuhoGO derives from its 12 words.

## What stays as it was

- The 12 words are still created on first start. They derive the built-in identities (NIP-06 accounts), the restore pointer and every website sign-in key.
- Website sign-in (LUD-04) never uses the identity key: `deriveLinkingKey(mnemonic, domain)` derives each site's key from the 12 words on the LUD-05 path `m/138'/…`. It works the same whatever identity is in use. It is never derived from an imported key (LUD-05 needs the seed; a homemade scheme would give logins no other wallet can recover).
- The address book works as before: one encrypted contacts doc per identity (`kind:30078`, `d=nostroogle:contacts:v1`). An imported identity brings its own doc if it has one. BuhoGO never reads or writes the follow list (`kind:3`).

## Ways in

| Kind | Where the key lives | Platforms |
|---|---|---|
| `secretKey` | Encrypted on this phone (device-key envelope `buhoGO_identity_external_<id>`) | App and web |
| `nip07` | A browser extension | Web |
| `nip46` | A remote signer, paired from a `bunker://` link (this app's pairing key is stored like a secret key) | App and web |

A signer app on Android (NIP-55, e.g. Amber) is not supported yet: NostrCore has no NIP-55 client and it needs a native plugin.

## Model (`src/stores/identity.js`)

- `externalIdentities` (records, no secrets) and `activeExternalId` sit next to the roster. Records are sanitised on load (`src/utils/externalIdentity.js`).
- `addExternalIdentity()` never adds a key twice: a key that is already a derived or imported identity is named instead.
- `switchToExternalIdentity()` / `switchNostrIdentity()` move between the two kinds; usernames stay with the identity they belong to.
- `deleteExternalIdentity()` deletes the stored key or pairing; never the identity in use.
- Erase all identities wipes imports and their envelopes too. A restored phrase keeps imports but takes over as the identity in use.
- External identities are never in the roster or the restore pointer.

## Signing

Every signature, encryption and decryption goes through `identity.acquireSigner()`, which returns a NostrCore `Signer` and a `release()` that wipes key bytes:

- profile publish and photo upload (`src/stores/profile.js`);
- contacts sync (`src/stores/addressBook.js`, `src/utils/nostrContactsDoc.js`).

A signer outside BuhoGO is wrapped in `verifiedSigner()`: every signed event must carry the paired public key and a valid signature, or it is refused (`SIGNER_MISMATCH`).

`identityCapabilities` says what the identity in use can do:

- `rawKey` false (extension, remote signer): the Social Bucket is unavailable (it signs ecash mint quotes, which a signer cannot).
- `needsApproval` true: nothing signs in the background (contacts sync waits for an action).

## Safety rules for profiles that already exist

- A profile publish keeps every field BuhoGO does not edit (`foreignProfileFields`, stored as `extraContent`).
- A relay list (`kind:10002`) is published only when the key has none; an existing or uncheckable one is never replaced.
- BuhoGO never edits an imported identity's profile on its own (the automatic Lightning address fill is for identities made here).
- The Social Bucket never writes an ecash wallet event without reading the current one, and never over one it cannot read (`nip60Blocked`).

## Not in Drive backup

Imported secret keys are not in the Drive backup: the person brought them from elsewhere, where they are already kept. The list footer says so.

## Validation

- `src/utils/__tests__/externalIdentity.spec.js`, `src/stores/__tests__/identity.spec.js` (imports), `profile.spec.js` (kept fields, relay list), `socialBucket.spec.js` (foreign wallet), `nostrContactsDoc.spec.js`, `addressBook.spec.js`.
- `node scripts/check-own-identity.mjs`: secret key and extension import, "Is this you?", switching, detail pages, delete alert, a wrong remote signer link, dark mode.
- Needs a device: a real remote signer (nsec.app, Amber over NIP-46) and a real extension (Alby, nos2x).
- nostr-core 1.0.5 or later: 1.0.4 sent the wrong first `connect` param, so remote signers that check it timed out (nostr-core-org/nostr-core#76).
