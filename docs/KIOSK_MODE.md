# Kiosk Mode

Kiosk Mode turns the phone into a register for staff: they can take payments and nothing else. The settings page follows Apple's Guided Access in iOS Settings (issue #449): one switch, with everything that belongs to the register under it.

[← Feature records](README.md)

## Where it lives

- **Settings:** in the Wallet group, the Kiosk Mode row shows On or Off and opens `/kiosk-mode` (`pages/KioskModePage.vue`).
- **The register:** `/kiosk` (`pages/KioskDashboard.vue`).
- **Guard:** while the register runs, `boot/kiosk.js` sends every route to `/kiosk`, the settings page included.

## States

| `kioskEnabled` | `kioskOwnerAccess` | Means |
|---|---|---|
| false | false | Off. The settings from last time are kept. |
| true | false | The register runs. |
| true | true | The owner is inside the app: after turning kiosk on, after the PIN, or after the forgotten-PIN taps. This state is not saved, so every app start opens the register. |

## Turning it on and off

- **First visit:** `KioskIntroDialog` explains Kiosk Mode once. Continue sets `buhoGO_kiosk_intro_seen` in localStorage; Cancel goes back to Settings and the dialog shows again next time.
- **Switch on:** `KioskPinSheet` asks for a new PIN twice. Cancel leaves the switch off.
  - Payments go to the wallet chosen before, else the active wallet, else the first wallet that can take kiosk payments (`kioskWalletBlocker` in `utils/walletCapabilities.js`).
  - With no such wallet, a toast says so and the switch stays off.
- **Switch off:** no PIN is asked. Only the PIN is removed; the wallet, tips, round-up and display currency stay (`disableKiosk`).
  - Because the wallet is kept, wallet removal says "The kiosk stops taking payments" only while kiosk is on.
- **Open Register:** checks that the wallet can still take payments (otherwise the wallet sheet opens), then calls `activateKioskMode()` and goes to `/kiosk`.

## The PIN

- **Storage:** saved as `kioskPinHash`, `<salt>:<sha256(salt:pin)>` (`utils/kioskPin.js`). It is never shown.
- **Old plain PINs:** a PIN that an earlier version saved in plain text (`kioskPin`) is hashed on the next start, and the plain copy leaves storage.
- **Limits:** a four-digit PIN can still be found from the hash by trying all 10 000. The hash keeps it off screens and out of readable storage, nothing more.
- **When it is asked:** only to leave the register. Inside the app, Change PIN sets a new PIN without the old one, the way a new Guided Access passcode is set in Settings.
- **Forgotten PIN:** 13 taps on the logo in the register, each within 5 seconds of the last (`handleScreenTap`), open the app without the PIN. This is kept on purpose. The owner then sets a new PIN on the page. Anyone standing at the register can do this too.

## Leaving the register

The lock goes straight to the PIN pad. The right PIN opens the app; Resume goes back to the register.

## Checks

- `src/utils/__tests__/kioskPin.spec.js`: the hash, matching, and reading an old plain PIN.
- `src/stores/__tests__/sparkWallets.spec.js`: a plain PIN leaves storage on the next start and still opens the register.
- `scripts/check-wallet-persistence.mjs`: a kiosk device reloads into the register with only the hash saved.
