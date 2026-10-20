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
