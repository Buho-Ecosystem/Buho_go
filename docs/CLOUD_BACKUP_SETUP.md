# Cloud Backup Setup (Google Drive, Android)

BuhoGO's cloud backup uploads a passphrase-encrypted file with every wallet
secret (Spark + Arkade recovery phrases, NWC connection strings, LNbits
credentials, the Nostr identity seed) to the user's own Google Drive, into
the hidden `appDataFolder` space. The file never appears in the user's
normal Drive UI, and Google only ever stores ciphertext.

**No OAuth client ID or secret ships in the app.** Google identifies the
APK by its package name and signing-certificate SHA-1, both registered
once in Google Cloud Console. That registration is the only manual setup
this feature needs, and it is why sign-in fails with a
`developer-error-10-sha1-mismatch` until it is done.

## One-time Google Cloud Console setup

1. Create (or pick) a project at https://console.cloud.google.com
2. **Enable the Google Drive API**: APIs & Services > Library > Google
   Drive API > Enable.
3. **OAuth consent screen**: APIs & Services > OAuth consent screen.
   - User type: External.
   - Add the scope `https://www.googleapis.com/auth/drive.appdata`
     ("See, edit, create, and delete its own configuration data in your
     Google Drive"). This scope is classed as sensitive; while the app is
     in "Testing" publishing status only listed test users can sign in.
     Publish to production (verification) before a public release.
4. **Create the OAuth client**: APIs & Services > Credentials > Create
   Credentials > OAuth client ID > Application type **Android**.
   - Package name: `mybuho.buhogo`
   - SHA-1: the signing certificate fingerprint of the APK being tested
     (see below). Create one Android client per signing key you use.
   - No client secret exists for the Android client type, and nothing is
     copied into the repo.

## Getting the SHA-1 fingerprints

Debug builds (what `quasar dev -m capacitor` installs):

    keytool -list -v -alias androiddebugkey \
      -keystore ~/.android/debug.keystore -storepass android \
      | grep SHA1

Release builds (the key that signs the published APK, including the
Zapstore release key):

    keytool -list -v -alias <release-alias> -keystore <release-keystore> | grep SHA1

Register BOTH fingerprints (as two Android OAuth clients or by adding a
second client), otherwise sign-in works in dev and fails in release, or
the other way around.

## What lives where in the code

| Piece | File |
| --- | --- |
| Native plugin (sign-in + Drive REST) | `src-capacitor/android/.../CloudBackupPlugin.java` |
| Plugin registration | `src-capacitor/android/.../MainActivity.java` |
| Native dependency | `play-services-auth` in `src-capacitor/android/app/build.gradle` |
| JS transport facade | `src/services/cloudStorage.js` |
| Envelope encryption (PBKDF2 + AES-GCM) | `src/utils/backupCrypto.js` |
| Orchestration (payload gather/apply) | `src/stores/cloudBackup.js` |
| UI sheet | `src/components/CloudBackupSheet.vue` |
| Entry points | Settings row (backup), WelcomePage "More ways to start" (restore) |

## Behaviour notes

- One canonical backup file per Google account
  (`buhogo-wallet-backup.json`); a new backup overwrites the old one.
- Restore is additive: it recreates whatever is missing on the device and
  never overwrites an existing wallet or identity.
- Tokens are minted on demand by Play Services; the app never stores an
  OAuth token. Sign-out revokes the grant entirely.
- iOS and web report "not available". An iOS implementation would use an
  iCloud ubiquity container behind the same plugin contract, not Google.

## Troubleshooting sign-in

| Reason surfaced in the sheet | Cause | Fix |
| --- | --- | --- |
| `developer-error-10-sha1-mismatch` | APK signature not registered | Add this build's SHA-1 in Cloud Console |
| `sign-in-failed-12500` | Android OAuth client misconfigured | Check package name + SHA-1 pair |
| `drive-scope-not-granted` / `consent-declined` | User denied the Drive checkbox | Sign in again, allow Drive access |
| `network-error` | Offline / captive portal | Retry with connectivity |
| Testing-mode 403 on Drive calls | Consent screen in Testing, user not listed | Add the account as a test user or publish |
