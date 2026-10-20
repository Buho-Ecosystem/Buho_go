# Haptics

A light physical answer to a moment that matters, in the Android and iOS
app only. Every haptic goes through `src/utils/haptics.js`, which plays it
with Capacitor's Haptics plugin, does nothing on the web, and respects the
user's switch in Settings → Preferences → Haptics (on by default, kept in
`localStorage` under `buhoGO_haptics_enabled`). Turning it on answers with
one tap. The phone's own vibration setting applies on top.

## Meanings

One meaning per pattern, as Apple's Human Interface Guidelines ask
([Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)):

| Call | Means |
|---|---|
| `haptics.success()` | Money arrived or left: the outcome is known |
| `haptics.error()` | Something failed: a wrong PIN, a refused card, a failed payment |
| `haptics.warning()` | Something needs attention |
| `haptics.medium()` | A commit point was crossed: the slide armed, a sale parked |
| `haptics.tap()` | Something snapped or was read: a swipe past its threshold, a card read |

Routine taps (buttons, tabs, keys, copying) get none: people expect them to
work, and a haptic on every touch drowns out the ones that matter. Never a
haptic without a visible change at the same moment.

## Where

| Moment | Plays |
|---|---|
| A payment sent (once it completed), a batch sent (as its summary counts it), a transfer done | `success` |
| A payment received while you watch, a voucher or card redeemed, a kiosk sale paid (also a parked one) | `success` |
| A payment, an on-chain withdrawal, a batch, a transfer, a redeem or a kiosk card payment failed; a wrong card PIN; a card locked | `error` |
| A payment whose outcome is unknown, a batch where some failed | `warning` |
| The slide reaching its commit point (or committed by a flick), a kiosk sale parked | `medium` |
| A card read, a QR code recognised (a new one, when scanning several), the History swipe past Pay again, turning haptics on | `tap` |

Nothing else plays: no tabs, buttons, keys, pickers, steps or copying, and
nothing while a payment is still pending. The slide's commit plays once, from
the finger at the detent or at the commit itself for a flick or a keyboard
run; springing back after a failed send is silent. (The app PIN dialog,
`PinEntryDialog.vue`, plays an error on a wrong PIN but is not used today.) The list is enforced by
`src/utils/__tests__/haptics.spec.js` ("haptics play only at the moments the
map lists"): a new haptic is added there on purpose, with its meaning.

## Notes

- Android plays every pattern as a short vibration (the plugin uses the
  vibrator, not the view's touch feedback), so the phone's Touch feedback
  setting does not silence it; the in-app switch and the phone's vibration
  switch do.
- The plugin must be installed in `src-capacitor/package.json` too
  (`npm run check:native-plugins` guards it). Until it was, every haptic in
  the app silently did nothing.
- Checks: `src/utils/__tests__/haptics.spec.js` (the switch, web no-op).
  On a device, `adb shell dumpsys vibrator_manager` lists each vibration
  the app played.
