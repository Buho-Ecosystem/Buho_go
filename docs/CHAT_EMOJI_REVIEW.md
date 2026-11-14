# Contact chat emoji picker

Implemented a Google Workspace-style companion panel beside the desktop chat
and a bottom sheet below 1024px. Both use the same picker, adapted from Lotus's
Vue component, curated Unicode catalog, and search logic. No npm dependency or
external emoji service was added.

The emoji button sits inside the message field, after the text, with its own
44px target. It remains at the bottom as a longer draft grows. The composer
inserts emoji at the saved cursor or replaces selected text. Desktop selection
returns focus to the cursor so typing can continue; Escape closes the panel
without losing that focus. Existing length and secret key checks still decide
whether the message can be sent.

An unreacted message reveals a direct React button on desktop hover or keyboard
focus. Existing reactions provide Add reaction and Change reaction actions in
place; tapping another person's emoji adds that reaction immediately. Compact
pills have separate 44px targets. Touch users can long-press a message for five
quick choices and More emojis. Both paths open the same searchable picker.

The discoverability patterns are informed by [Telegram's input-field emoji
control](https://www.telegram.org/blog/ultimate-privacy-topics-2-0/it?setln=en)
and [Signal's direct desktop reaction affordance and extended
choices](https://signal.org/blog/more-reactions/).

Search has a single deduplicated result list, ranked across categories and
recents. Browsing keeps recognizable categories, sticky section names, 44px
targets, keyboard navigation, and a quiet preview. Up to 24 recent choices stay
on the device; invalid or unavailable storage cannot block selection.

## Red-team review

An independent adversarial review found these issues. All were fixed:

| Finding | Correction | Evidence |
| --- | --- | --- |
| Category order could put a weak match ahead of exact eyes, tongue, or star | Rank all search results together and remove duplicates | Component tests; browser checks exact eyes ordering |
| Common German and Spanish searches returned no results | Add common translated search aliases and accent normalization | Tests for lachen, glücklich, feliz, corazón, and emoji characters; browser checks German and Spanish |
| Switching an open composer picker to reactions retained stale search and focus | Remount the picker for each opening | Browser check switches Compose to React with an old query |
| Closing reactions moved focus to the composer | Restore focus to the originating message after the mobile dialog finishes hiding | Desktop and mobile browser checks |
| Pointer could lose the desktop reaction button across its 6px gap | Bridge the hover region | Browser moves through the gap before clicking |
| Expanded reaction hit areas could overlap Add reaction | Reserve separate 44px layout slots with smaller visual pills | Browser checks rectangles and taps a peer reaction's edge |

The first browser run also detected a queued scroll callback after unmount.
The callback now guards the missing scroller. A transition timing issue in the
screenshot helper was corrected so captures show the settled mobile sheet.

## Blue-team review

A second independent reviewer verified the corrections and ran the relevant
Node suites. They identified one additional case: opening reactions again
while already in React mode retained the prior search. Each opening now gets
a new session key, including reopening the same message. A browser regression
checks this twice with a deliberately stale query.

The reviewer rechecked the fix and reported no remaining concrete blocker.
Two additional page tests cover session renewal, deferred focus restoration,
and clearing pending state when the conversation changes.

The embedded-trigger/direct-reaction refinement received another red-team and
blue-team check. The final reviewer independently passed 130 component/page
tests and found no remaining concrete blocker in pointer, keyboard, or focus
behavior. The overlapping-target and hover-gap findings above were fixed.

## Validation

- Full `npm test` passed, including its 3,218-test primary suite and all
  subsequent test commands.
- Focused chat components, ContactChatPage, useContactChat, and protocol suites:
  387 passed, including picker emoji round trips and standard peer sequences.
- Scoped style and safe-area checks: 4 passed.
- `node scripts/check-chat-emoji.mjs`: 14 real-browser scenarios passed using
  isolated test identities and simulated relays, with no uncaught page errors.
- A subsequent edge-case review reproduced a wrapped draft needing 88px after
  opening the desktop dock while its textarea still showed only 66px. The
  composer now observes width changes and refits unchanged text, with observer
  cleanup on unmount. The browser regression checks this exact case.
- Full `node scripts/check-contact-chat.mjs` browser regression passed, including
  replies, payments, unknown senders, blocking, translated/large-text layouts,
  permanent delivery refusal, manual retry, and automatic temporary-error recovery.
- Production build passed. The existing large-chunk warning remains.
- `git diff --check` passed.

Together these checks cover desktop docking, cursor replacement and repeated
picks, keyboard navigation and IME confirmation guards, empty results,
encrypted message sending, reactions, switching picker modes, repeat reaction
openings, 320px and 390px layouts, focus restoration, changing between desktop
and mobile layouts, translated search, and malformed recents.

Committed screenshot evidence (test identities only; generated by the browser check):

- [Desktop, light](images/chat-emoji/desktop-thread-light.png)
- [Desktop, dark](images/chat-emoji/desktop-thread-dark.png)
- [Mobile, light](images/chat-emoji/mobile-light.png)
- [Mobile, dark](images/chat-emoji/mobile-dark.png)
- [320px mobile](images/chat-emoji/mobile-320-light.png)
- [Embedded composer control](images/chat-emoji/composer-inline-desktop.png)
- [Desktop reaction affordance](images/chat-emoji/desktop-reaction-hover.png)
- [Touch quick reactions](images/chat-emoji/touch-reaction-choices.png)

## Nostr interoperability

Checked against the current [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md),
[NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md), and
[NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) specifications.
The UI uses the existing messaging runtime; there are no protocol controls,
server choices, or new setup steps in the picker.

The browser check inspects events actually accepted by the simulated relay,
independently of the app's event builders and parser. It verifies the outer
signature, decrypts the seal with the recipient's key, verifies the seal's
signature, decrypts the unsigned rumor, checks its hash and author, and
compares message content. It also checks the sender's history copy, authenticated
relay access, ciphertext rather than visible message content, and reaction
message references. The sender's UI must reach Sent before this check passes.

Incoming messages and reactions are constructed using Nostr primitives without
BuhoGO-specific tags or app builders. They render normally, including joined
sequences, skin tones, and variation selectors. Unit tests cover all 492
picker emoji as both text and reactions, plus representative standard-peer
sequences not included in the curated picker.

These are local interoperability checks with simulated relays, not a claim of
live testing every third-party client or relay.

## Scope and remaining device checks

Controls and category labels are translated into English, German, and Spanish.
Search supports the English catalog plus common German and Spanish aliases;
individual emoji names, tooltips, and previews remain English. This is Lotus's
curated standard Unicode set, without custom image packs or a skin-tone
selector. Glyph appearance follows the operating system.

Browser viewport checks establish layout and focus behavior. Physical Android
and iOS keyboard behavior, safe-area rendering, and screen-reader operation
still need device verification.
