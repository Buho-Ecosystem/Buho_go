# Toast interaction map

## Evidence and scope

The September 2026 audit found 226 `$q.notify` calls and seven `Notify.create`
calls in 49 source files. Quasar 2.33.0 provides grouping, actions, persistent
notices and dismissal handles, but no built-in swipe or interaction-pause API.
Its actual timer is the configured timeout plus a 1000 ms entrance allowance.
The default remains 2500 + 1000 ms; full-screen payment confirmations are separate.

Current callers use messages, captions, semantic types/colors, explicit icons,
top/bottom positioning, action buttons, timeout overrides, and an ongoing
Bitcoin withdrawal notice. No caller uses HTML messages. Message content stays
plain text. The compatibility layer is scoped to our app's usage, not a complete
replacement for every possible Quasar Notify option.

## Apple HIG basis

- [Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures):
  familiar gestures, responsive feedback, alternative inputs and avoiding system
  gesture conflicts. Horizontal dragging starts on the toast, not at the screen
  edge; vertical scrolling stays available. Dismissal also has a native button.
- [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback):
  feedback should match the importance of the event and avoid unnecessary
  interruption. Toasts never steal focus, block the page, or cancel an operation.
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility):
  keyboard and assistive-input alternatives, readable content and usable controls.
  Following the [Buttons guidance](https://developer.apple.com/design/human-interface-guidelines/buttons),
  buttons have 44 CSS-pixel targets; simple notices have a message-area dismiss
  button, while actionable/persistent notices retain visible Dismiss text.
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion):
  brief, purposeful feedback and optional motion. The card follows the finger;
  incomplete drags return, and reduced-motion mode omits movement animations.

These are product choices informed by the HIG, not an Apple-prescribed toast
pattern. Apple does not prescribe our timeout, drag threshold or animation time.

## Behavior

| Case | Behavior |
| --- | --- |
| Ordinary mobile toast | Tap the message or swipe horizontally to dismiss; no X |
| Desktop | Drag or click the message; keyboard dismissal; no X |
| Actions / persistent progress | Separate action buttons and visible Dismiss |
| Horizontal movement | Lock after 10 px of predominantly horizontal motion |
| Dismissal threshold | 25% of card width, at least 56 px; a short fast flick also qualifies |
| Incomplete/cancelled/vertical movement | Never dismiss or invoke an action |
| Hold, keyboard focus, mouse hover | Pause the remaining timeout and progress bar |
| Background app/tab | Pause old and newly created notices until visible again |
| Duplicates | One card with count; renew its timer while preserving active holds |
| Progress updates | Update in place; updates after dismissal do not resurrect it |
| Several notices | Swipe affects only the touched notice; stacks respect safe areas |
| Open modal | Portal moves inside the foremost modal's focus and accessibility area |

## Integration

`boot/toasts.js` installs one controller behind both public entry points before
other app boot services run. `ToastHost` mounts once in `App.vue`; `ToastCard`
owns pointer interaction. No DOM polling, synthetic close-button clicks, or
private Quasar notification state is used. The modal portal observer only tracks
portal placement; Vue and the controller own the toast lifecycle.

Dismissal handles, `onDismiss`, `noDismiss`, custom grouping, grouped replacement,
and non-grouped updates retain their existing meanings. Dismissal is idempotent.
Tests use controlled clocks for expiry/group/update races and browser interaction
for gestures, action isolation, themes, keyboard focus, modals and reduced motion.

## Validation

Checked on September 23, 2026:

- `npm test`: full existing suite and 12 new controlled-clock tests passed.
- `pnpm build`: production SPA build passed.
- `node scripts/check-toast-interactions.mjs`: Chromium touch input passed.
- `node scripts/check-toast-interactions.mjs --desktop`: real mouse dragging,
  hover timers and keyboard input passed.
- `TOAST_BROWSER=webkit node scripts/check-toast-interactions.mjs`: WebKit passed;
  gestures use synthetic pointer events because Playwright does not expose native
  WebKit touch dragging. This does not replace an iPhone test.
- Browser checks include cancellation, vertical motion, neighboring cards,
  actions, persistent updates, duplicates, timeout holds, Receive's focus trap,
  modal closing, reduced motion, 150% root text size, long content and safe areas.
  No uncaught browser errors occurred.
- Light/dark screenshots were inspected for all four semantic types. Opaque
  elevated surfaces, status badges and a separate action row improve visibility;
  no message or caption wording changed. Simple notices have no X on any device.
  Message contrast is 15.98:1 in light mode and 13.58:1 in dark mode; all four
  semantic action colours exceed 4.5:1 against their surface.

Run browser checks against `pnpm dev --port 9012`. They use an isolated empty
wallet and synthetic notices, with outbound wallet requests blocked. Screenshots
are written to the ignored `output/toast-interactions/` directory.

Physical iPhone/Android gestures and VoiceOver have not been tested here.
