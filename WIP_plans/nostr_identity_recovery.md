# Nostr Identity Recovery — Multi-Account Support

**Status:** Deferred. Rotation UI commented out in `NostrIdentityDialog.vue` until this plan ships.

**Trigger to revisit:** When we add NostrCore relay support and start signing/publishing events (see future `WIP_plans/nostr_relays.md`).

---

## The promise we want to keep

> Your 12 recovery words are your **full** Nostr backup. Whatever Nostr identity BuhoGO shows you on Device A must come back on Device B when you restore from the same recovery phrase.

This is the same promise we make for Spark wallets and for LUD-04 sign-in keys. It must hold for Nostr too.

---

## The problem

NIP-06 derives a Nostr keypair at `m/44'/1237'/<account>'/0/0`. Account 0 is canonical — every Nostr client that imports the same seed phrase will land there.

We added a "Create new Nostr key" feature that increments the account index (0 → 1 → 2 → ...) without changing the seed. The increment is stored *only* in local metadata — it does not, and cannot, live inside the 12 words.

Consequence today: a user who rotates to account 3 on Phone A and then restores from the recovery phrase on Phone B lands back at **account 0**. Their rotated key is mathematically derivable but invisible in BuhoGO. That breaks the promise above.

We can't fix this by stuffing the account index into the seed phrase — that would diverge from NIP-06 and break compatibility with every other Nostr client that consumes the same 12 words.

---

## The solution: publish the active account index as a Nostr event

When we have relay support, we can sign a small "BuhoGO pointer" event with the **account-0** key that says "my current Nostr identity is at account N." On restore, BuhoGO queries relays for that event, finds it, and lands the user on the correct account.

### Why this works

- Account 0 is always derivable from the recovery phrase (deterministic via NIP-06).
- The pointer event is signed by account 0, so anyone with the seed phrase can verify authenticity.
- The 12 words remain the **only** thing the user has to remember.
- It survives device wipe, app reinstall, switching between iOS and Android — anywhere Nostr relays reach.
- It composes cleanly with the rotation feature we already have in `src/stores/identity.js` (`rotateNostrIdentity`).

### Event shape (draft)

Use a parameterised replaceable event (NIP-33, kind `30078` for "application-specific data" or a similar reserved range — confirm at implementation time):

```
{
  kind: 30078,
  pubkey: <account-0 pubkey hex>,
  tags: [
    ["d", "buhogo:nostr-identity-pointer:v1"],
    ["account", "3"]
  ],
  content: "",
  sig: <signed by account-0 secret key>
}
```

Replaceable so only the latest pointer survives per `d`-tag. The `d`-tag namespace prevents collisions with other apps that use kind 30078.

### Relay set

Use the same relays we use for the rest of NostrCore work (TBD when we pick a default set). At minimum:
- Publish to >=3 well-known relays for redundancy.
- Query the same set on restore.
- Treat missing pointer as "account 0" (matches today's behavior — safe fallback).

---

## Implementation steps (when ready)

### 1. Uncomment the rotation UI

In `src/components/NostrIdentityDialog.vue`, remove the `// WIP_PLAN: nostr-identity-recovery` markers around:
- The "Create new Nostr key" button in the overview step's action bar.
- The `rotateConfirm` template block.
- `rotateConfirmInput`, `isRotating`, `confirmPhrase` data fields.
- `cancelRotate`, `executeRotate` methods.
- The `'rotateConfirm'` case in `headerTitle` and the reset in `resetToOverview`.

The store action `rotateNostrIdentity` is already intact — nothing to uncomment there. The i18n strings (`Create new Nostr key`, `Create new key`, `New Nostr key created`, etc.) are also already in all three locales.

### 2. Update rotation copy

Before re-enabling, update the rotation confirmation copy in `NostrIdentityDialog.vue` to reflect the new reality:

> "Your recovery phrase stays the same. A fresh Nostr key replaces this one. **BuhoGO will publish a small pointer to relays so this key comes back when you restore.** Anything you signed before will still verify."

Plus de/es translations.

### 3. Add the pointer publish step to `rotateNostrIdentity`

In `src/stores/identity.js`, after the persist-then-commit succeeds:

```js
// Sign and publish the pointer with the *account-0* key, regardless of
// where we just rotated to. Account 0 is the only key recoverable from
// the seed phrase without external state, so it must be the signer of
// record. Failure to publish does not roll back the rotation — we log
// and let the user retry via a banner action.
try {
  await this.publishNostrAccountPointer(nextAccount);
} catch (err) {
  console.warn('[identity] pointer publish failed, will retry', err);
  // surface a non-blocking banner so the user can re-publish
}
```

Implement `publishNostrAccountPointer(account)` using NostrCore's signer + relay pool.

### 4. Query the pointer on restore

In `importMnemonic()`, after `_tryCacheNostrPublic(normalised)` runs (which puts us at account 0):

```js
// Best-effort: try to discover whether this seed has a rotated account
// elsewhere. Time-bounded so the restore UX doesn't hang waiting on a
// dead relay. On success, bump to that account and re-cache.
const remoteAccount = await this.fetchNostrAccountPointer(normalised, {
  timeoutMs: 4000,
});
if (remoteAccount && remoteAccount > this.nostrAccountIndex) {
  this.nostrAccountIndex = remoteAccount;
  this._tryCacheNostrPublic(normalised);
  this._persistMetadata();
}
```

The flow on restore becomes:
1. Land on account 0 (fast, deterministic, works offline).
2. Show the npub immediately.
3. In the background, query relays for a pointer.
4. If found and >= current, silently upgrade to that account and refresh the displayed npub.

### 5. Restore UX polish

Restore success copy needs a tweak so the user understands what's happening:

> "Your sign-in keys and Nostr key are back. Checking for any newer Nostr key you set up before…"

Then a toast on success if we upgraded.

### 6. Tests

- Unit test for `publishNostrAccountPointer` event shape (kind, tags, signer is account 0).
- Mock relay test for the restore-discovery path: relay returns pointer with `account: 3`, restore lands on account 3.
- Restore with no pointer found → stays on account 0 (current behavior).
- Restore with timeout → stays on account 0, no error surfaced.

---

## Edge cases we need to think through

- **User rotated on Device A, never published (offline), then restored on Device B.** Device B lands on account 0. Old key is lost from UX. *Accepted — same as today, matches the "rotation needs publish to be portable" model.*
- **Conflicting pointers from different devices.** Use the higher account index. Replaceable events naturally resolve this (latest `created_at` wins).
- **User wants to roll back to an earlier account.** Out of scope. The rotation model is forward-only.
- **Privacy of the pointer.** The event is public but only reveals "this account-0 npub uses account N" — not the rotated npub itself. Anyone could derive that from the seed if they had it, but they don't. The event leaks one bit: "this user has rotated at least N times." Acceptable.
- **NIP-44 encrypt the content?** Maybe. Content currently empty; if we put the rotated npub there for ergonomics, encrypt it to self. Decide at implementation time.

---

## Why not other approaches

| Approach | Why rejected |
|---|---|
| Encode account index in BIP-39 passphrase | Breaks NIP-06 compat with every other Nostr client. |
| Two-piece backup (12 words + small number) | Breaks the "12 words = full backup" promise. Real-world users will lose the number. |
| Multi-account UI on restore ("which account?") | Noisy edge case for the 99% who never rotated. Bad default UX. |
| Brute-force scan accounts 0..N on restore | We have no signal where to stop. |
| Use a centralised BuhoGO server | Defeats self-sovereignty. We're not running infra. |

The relay-pointer approach is the only one that (a) keeps the 12-word promise, (b) stays self-sovereign, and (c) composes with NIP-06 instead of fighting it.

---

## Open questions to resolve when we pick this up

1. Which kind number? `30078` (parameterised replaceable, app data) is the safe default but confirm against other apps' usage.
2. Which relay set? Pick when NostrCore relay support lands.
3. Should the pointer event be NIP-44-encrypted to the account-0 pubkey itself? Adds privacy but costs latency on restore.
4. Surface a "republish pointer" action on the Nostr identity dialog for users whose publish failed? Probably yes, behind a small banner.
