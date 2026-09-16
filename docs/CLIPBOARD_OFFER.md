# Clipboard offer

When the app comes to the foreground on a phone, the home screen reads the clipboard once. If it holds something the active wallet can pay, a strip appears under the toolbar: "Found in your clipboard", the destination shortened to its two ends, a Use button, and a countdown bar. Use hands the text to the Send sheet exactly as a paste would, so it resolves and lands on the confirm sheet. Nothing advances on its own.

## Rules

- Native only. The web keeps the Send sheet's own clipboard chip, because a programmatic read in a browser needs a permission prompt.
- One read per return to the app, plus one on start. A return counts only after the app was away for at least 1.5 seconds, so the unlock prompt and the paste-consent dialog closing do not trigger a second read.
- No read while the app lock is up (it runs once the lock clears), and none while a sheet or dialog is in front.
- The same clipboard content is offered once. Used or dismissed, it is not offered again until the clipboard changes.
- What counts as payable is one rule for the strip and the Send chip: `isSuggestibleDestination` in `src/utils/clipboardSuggestion.js`. It mirrors the Send field's detection set (rails, Nostr identities, payout phone numbers), excludes BOLT12 and silent payments, and applies the wallet capability check.
- The strip leaves when the countdown ends or on an upward swipe; a finger resting on it pauses the countdown. Reduced motion keeps the strip but ends it by timer.

## Platform notes

- Android 12 and later show the system's "pasted from your clipboard" notice on every read of text another app copied. Reading once per return keeps that to one notice per visit.
- Android hands the clipboard only to the focused window, which lags the resume event by a beat; the read waits a moment and retries once when empty.
- iOS asks for paste permission on the first read from another app, and the user can set Allow, Ask or Deny per app in Settings. A denied read simply yields nothing.
- Kiosk mode never mounts the home screen, so it never reads the clipboard.

## Where

- `src/components/ClipboardSuggestion.vue`: the strip, the foreground listener, the read, and the once-per-content memory.
- `src/utils/clipboardSuggestion.js`: normalization, classification, the payable rule and the abbreviation, with `src/utils/__tests__/clipboardSuggestion.spec.js`.
- `src/pages/Wallet.vue` opens Send on Use; `SendModal.useDestination` takes the text as a paste.
- `src/App.vue` provides the lock state the strip waits on.
