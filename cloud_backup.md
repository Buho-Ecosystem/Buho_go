# Cloud Backup Integration Plan

## Overview

BuhoGO will support encrypted cloud backup of Spark wallet seed phrases. Users authenticate with their **own** iCloud (iOS) or Google Drive (Android) account. BuhoGO does not provide cloud storage - we only facilitate secure backup to the user's personal cloud.

---

## How It Works

```
User's Device                    User's Cloud Account
┌──────────────┐                ┌─────────────────────┐
│  BuhoGO App  │  ──encrypt──►  │  iCloud / G-Drive   │
│              │  ◄──decrypt──  │  (user's account)   │
└──────────────┘                └─────────────────────┘
```

- **We don't store anything** - all data lives in the user's cloud
- **User authenticates** - via Apple ID or Google Account on their device
- **Double encryption** - PIN + platform keychain protection

---

## Settings UI

```
┌─────────────────────────────────────────┐
│ Cloud Backup                            │
├─────────────────────────────────────────┤
│ ○ Enable Cloud Backup          [Toggle] │
│                                         │
│ Provider: iCloud / Google Drive         │
│ Account: user@icloud.com                │
│ Last backup: Jan 14, 2026 at 2:30 PM    │
│                                         │
│ [Backup Now]  [Restore]  [Delete Backup]│
└─────────────────────────────────────────┘
```

---

## User Flows

### 1. Enable Backup (First Time)

```
1. User toggles "Enable Cloud Backup" ON
2. Show explanation:
   "Your wallet will be encrypted and backed up to your [iCloud/Google Drive].
    You control the cloud account. We never see your data."
3. Request platform permissions:
   - iOS: Check iCloud signed in
   - Android: Prompt Google account selection
4. Encrypt wallet data (double layer)
5. Upload to user's cloud
6. Show success + timestamp
```

### 2. Restore on New Device

```
1. User opens app (no wallet exists)
2. Welcome page shows "Restore from Backup"
3. User taps restore
4. App checks user's cloud for backup
5. If found: Show backup info (date created)
6. Authenticate (Face ID / fingerprint)
7. Download encrypted blob from user's cloud
8. Prompt for original wallet PIN
9. Decrypt and restore wallet
```

### 3. Manual Backup

```
1. User taps "Backup Now"
2. Authenticate
3. Re-encrypt current wallet
4. Upload to user's cloud
5. Update timestamp
6. Show "Backup complete"
```

### 4. Delete Backup

```
1. User taps "Delete Backup"
2. Show warning:
   "This will permanently delete the backup from your [iCloud/Google Drive].
    Your local wallet is not affected."
3. User types "DELETE" to confirm
4. Delete from user's cloud
5. Clear local metadata
6. Toggle backup OFF
```

---

## Security Model

### Double-Layer Encryption

```
Layer 1 (existing): User PIN → PBKDF2 → AES-256-GCM → encrypted mnemonic
Layer 2 (cloud):    Platform Key → AES-256-GCM → cloud blob

Result: Even if cloud is compromised, attacker needs:
        1. Platform key (device-bound)
        2. User's PIN
```

### Platform Key Sources

| Platform | Key Storage | Protection |
|----------|-------------|------------|
| iOS | Keychain + Secure Enclave | Biometric / device passcode |
| Android | Android Keystore | Hardware-backed when available |

### What Gets Backed Up

```json
{
  "version": "1.0",
  "format": "buho-cloud-backup",
  "checksum": "sha256_of_payload",
  "createdAt": "2026-01-14T14:30:00Z",
  "updatedAt": "2026-01-14T14:30:00Z",
  "payload": "base64_encrypted_blob"
}
```

The `payload` contains (encrypted):
- Wallet ID
- Encrypted mnemonic (already PIN-encrypted)
- Network (MAINNET/REGTEST)
- Creation timestamp

---

## Platform Implementation

### iOS (iCloud)

**Storage:** iCloud Key-Value Store (`NSUbiquitousKeyValueStore`)

**Requirements:**
- User must be signed into iCloud on device
- App needs iCloud entitlement in Xcode
- Native Capacitor plugin bridges Swift ↔ JavaScript

**User Experience:**
- No sign-in prompt (uses device's Apple ID)
- Backup syncs automatically across user's devices

### Android (Google Drive)

**Storage:** App Data Folder (hidden from user in Drive UI)

**Requirements:**
- Google Play Services installed
- User selects/confirms Google account
- `drive.appdata` OAuth scope
- Native Capacitor plugin bridges Kotlin ↔ JavaScript

**User Experience:**
- One-time account selection prompt
- Backup visible only to BuhoGO app

---

## Auto-Backup Triggers

| Event | Action |
|-------|--------|
| Wallet created | Backup immediately after setup |
| Mnemonic verified | Backup after verification step |
| App backgrounded | Backup if >24 hours since last |
| User enables backup | Backup immediately |

All auto-backups are **silent** (no user prompt) but respect the enable toggle.

---

## Error Handling

| Scenario | User Message |
|----------|--------------|
| Cloud unavailable | "Cannot connect to [iCloud/Google Drive]. Check your internet." |
| Not signed in | "Sign in to [Apple ID/Google] in Settings to enable backup." |
| Storage full | "Your [iCloud/Google Drive] is full. Free up space to backup." |
| Wrong PIN on restore | "Incorrect PIN. Please try again." |
| No backup found | "No backup found in your [iCloud/Google Drive]." |
| Corrupted backup | "Backup appears corrupted and cannot be restored." |
| Version mismatch | "This backup requires a newer version of BuhoGO." |

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/services/CloudBackupService.js` | Backup/restore logic, encryption |
| `src/components/CloudBackupSettings.vue` | Settings UI component |
| `src-capacitor/ios/App/Plugins/CloudBackup/` | iOS native plugin |
| `src-capacitor/android/.../plugins/CloudBackup/` | Android native plugin |

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/Settings.vue` | Add Cloud Backup section |
| `src/pages/WelcomePage.vue` | Add "Restore from Backup" option |
| `src/stores/wallet.js` | Add backup state, auto-trigger hooks |
| `package.json` | Add Capacitor filesystem plugin |
| `capacitor.config.json` | Plugin configuration |

---

## UX Rules (Must Follow)

1. **Never auto-enable** - User must explicitly turn on backup
2. **Never auto-restore** - Always confirm before restoring
3. **Show cloud provider** - Always display which cloud is being used
4. **Show account** - Display the cloud account (email) being used
5. **Allow deletion** - User can always delete their backup
6. **Clear memory** - Wipe plaintext from memory immediately after use
7. **Explain ownership** - Make clear the user owns their cloud data

---

## Implementation Phases

### Phase 1: Service Foundation
- Create `CloudBackupService.js` skeleton
- Implement encryption/decryption logic
- Add backup state to wallet store

### Phase 2: Settings UI
- Create `CloudBackupSettings.vue` component
- Integrate into Settings.vue
- Implement toggle, status display, action buttons

### Phase 3: iOS Native Plugin
- Create Capacitor plugin for iCloud access
- Implement upload/download/delete operations
- Handle iCloud availability checks

### Phase 4: Android Native Plugin
- Create Capacitor plugin for Google Drive
- Implement OAuth flow for account selection
- Implement upload/download/delete operations

### Phase 5: Restore Flow
- Add "Restore from Backup" to WelcomePage
- Implement cloud check on app start
- Build restore UI flow

### Phase 6: Testing & Polish
- Test all error scenarios
- Test cross-device restore
- Refine UX copy and timing

---

## Privacy Note

BuhoGO **never** has access to user cloud credentials or data. The backup:
- Lives in the user's personal cloud account
- Is encrypted before leaving the device
- Can only be decrypted with the user's PIN
- Can be deleted by the user at any time

We are a conduit, not a custodian.
