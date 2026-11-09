# Reading a QR code from a photo

Issue #484. Every scanner offers **Choose photo**: the code in a picture the
person picks (a screenshot of an invoice, a request sent in a chat, a
connection code saved from another screen) goes exactly where a scanned one
goes.

## Where

| Scanner | Platform | What a code from a photo does |
|---|---|---|
| `ScannerOverlay` | App | Every scanner in the app: Send, Receive's Redeem, requests, Auto-Transfer, contacts, sites, wallet setup |
| `QrScanSheet` | Web | Send, Redeem, requests, Auto-Transfer |
| NWC and LNbits setup | Web | Fills the connection, as a scan does |
| Add contact, add a site | Web | Takes the code as a scan does |

`QrPhotoButton` is the one button; `utils/photoPick.js` is one trip to the
picker; `utils/qrFromImage.js` reads the picture. Kiosk mode has no scanner.

## The picker

The system photo picker opens from a hidden `<input type="file" accept="image/*">`.
It needs no access to the photo library, so BuhoGO asks for none. On Android
the system says so in the picker itself: "BuhoGo will only have access to the
photos you select". On an iPhone the same input first offers Photo Library,
Take Photo or Choose File.

- **The camera is off while the picker is open**, so the camera indicator is
  not lit while someone looks through their photos. It comes back when the
  picker closes without a photo, and after a photo without a usable code.
  The web scanners call `pauseForPhoto` (`utils/qrScanner.js`): `pause(true)`
  lets go of the stream at once, then `stop()` marks the scanner inactive. A
  paused scanner that is still active starts itself again whenever the page
  turns visible, which lit the camera behind the open picker. The scanner
  itself is kept and restarted with `start()`: qr-scanner lets go of a stream
  300 ms after `stop()`, so a second scanner on the same `<video>` would lose
  its stream. A screen restarts the scanner it has and never gives its
  `<video>` to another. No camera start begins while the picker is open, and
  one that was already on its way is turned off once it has started.
- **Closing the picker without a photo** is reported by the `cancel` event on
  web engines from 2023 on (`engineSendsCancel`), and there the trip ends only
  on `change` or `cancel`. Older engines never say it, so the trip also ends
  when the person is back and no photo arrived within 4 s, or on a touch of
  the screen from 700 ms after opening (a touch before that is the picker
  still on its way). A photo that arrives after such a guess still counts.
  In a browser "back" is the window having focus again or the page being
  visible again. On Android it is the app resuming: there the window gets
  focus back for a moment while the picker is still opening (it opens
  through a short trampoline screen), and the page never turns hidden. The
  4 s are measured: on Android the chosen photo reaches the page up to 2.3 s
  after the app resumed. The app's WebView on current Android sends `cancel`,
  so the guesses only run on old WebViews and on iPhones before iOS 16.4.
- **A scanner that takes several codes** (wallet setup) resumes its camera
  after a photo only once its parent had its turn: a parent that took the
  code and closes the scanner must not see the camera flick on first.
- **Add a site** switches to paste when a photo's code looks like a sign-in
  code but is none. The camera stays off then: before the review it came
  back on the `<video>` paste mode removes and ran until the app closed.
- **The app lock** (`utils/appLock.js`, `openingSystemPicker`), Android only:
  where the picker sends BuhoGO to the background, that engaged the lock and
  closed the scanner before the photo arrived. Going to the background for
  the picker the app opened is not leaving the app, for one departure and
  within 2 minutes of opening the picker (`PICKER_AWAY_MS`). Once the app is
  back, leaving again locks as usual, even before the photo arrived. Back
  later than that, the lock engages on return, and the scanner keeps its
  camera off meanwhile (`awayForPickerTooLong`): the picker's "closed" can
  reach the page a moment before App.vue hears that the app is back. Where
  the picker is a sheet over the app (Android 16, and iPhones), the app never
  goes to the background, so the lock is not involved; on an iPhone it is
  never held back at all.

## Reading the picture

In the app, ML Kit reads it first: the model the live camera uses, bundled
into the app, so it needs no Google Play services. It only reads files, so
each read copies the picture to its own file in the app's cache
(`scanned-picture-…`) and removes it again. A read still running from a
closed scanner therefore never removes the copy a new read is using. When it
finds no code, one quick look in the web view still runs, for a light code
on a dark screenshot. When it cannot run, or gives no answer within 10 s
(`NATIVE_READ_MS`), the picture gets the web looks.

On the web, qr-scanner reads the whole picture at three sizes, 800, 1600 and
3200 px on the longest side, smallest first, and each look also tries
inverted colours. The decoder finds a code only when its squares are neither
too small nor too blurred at the size it reads, so one size misses codes
another finds. Measured on generated screenshots, chat images and 12 and 48
megapixel photos (five runs, eleven hard cases each):

| Sizes | Found | No code, average |
|---|---|---|
| 1280, 2560 | 44 of 55 | 0.8 s |
| 1600, 3200 | 47 of 55 | 1.0 s |
| 800, 1600, 3200 | 51 of 55 | 1.2 s |
| 1024, 2048, 3200 | 48 of 55 | 1.4 s |

Screenshots are found by the first look, in about 0.1 s. The looks are capped
at 3200 px, but the picture is opened at its full size first: about 48 MB of
memory for a 12-megapixel photo, four times that for 48 megapixels. A picture
the device has no memory for ends as one it cannot open.

## What the person sees

| Moment | Shown |
|---|---|
| Reading | The button: a spinner and "Reading photo…". It keeps the focus and ignores taps (`aria-disabled`) |
| No code in the picture | "No QR code in this photo. Choose one that shows the whole code." in place of the prompt; the camera comes back |
| Not a picture this device opens | "This photo can't be opened. Choose another one." |
| A code this scanner cannot use (contacts, sites) | "That code is not a profile or an address. Choose a photo of the code you want to add." / "That code is not a sign-in code. Choose a photo of the code the website shows." The camera keeps looking without a word, as before; a photo chosen on purpose gets an answer |
| No camera, or camera access refused | The error, and Choose photo in its usual place, clear of Retry |

The prompt and every note are always in the page, so a note that appears is
read out; a new trip clears the note, so the same note twice is read out
twice. On the camera, Choose photo is dark glass like the scanner's other
controls, and the scrim stays dark up to the prompt's line: over white paper
the prompt is about 5.4:1 and the button 15:1. Where a paste alternative sits
next to it (Add contact, add a site), Choose photo takes that button's look
and size, since neither way is the main one.

A code from a photo plays the same tap as a scanned one. Nothing else is new
in the haptics map.

## Checks

- `utils/__tests__/qrFromImage.spec.js`, `photoPick.spec.js`, `appLock.spec.js`.
- `scripts/check-scan-photo.mjs`: Chromium's stand-in camera and generated
  pictures. Send (the camera off while the picker is open, also through focus
  and visibility; a real "Reading photo"), no camera (also at 320 x 568, Retry
  not covered), NWC setup (light and dark), Add contact, Add a site (no camera
  left running after a code that is no sign-in code), German at 320 px.
  `SCAN_PHOTO_ONLY=site,contact` runs chosen cases.
- Android 16 emulator, debug build, the system photo picker: the camera stays
  off for the whole visit; Back in the picker brings the camera back through
  `cancel`; a photo without a code says so and the camera comes back; a photo
  of a connection code fills wallet setup; no copy of a picture is left in
  the cache; with the app lock on, Home from the picker and back in time does
  not lock, and leaving again does. Not checked on an iPhone.

## Review

A red team (break it) and a blue team (HIG, accessibility, robustness)
reviewed the first version. Fixed:

- Add a site left the camera running after a photo of a code that is no
  sign-in code.
- The web camera could come back behind the open picker (page visible again,
  or focus coming back while the picker was still opening), and a camera
  still starting when Choose photo was tapped stayed on.
- A second tap while the picker was opening ended the trip on old engines.
- The lock hold covered every departure until the photo arrived, counted
  from leaving rather than from opening, and also applied on iPhones.
- A native decoder that never answered left "Reading photo" spinning; reads
  shared one cache file.
- Choose photo on the camera was white glass, near invisible over white
  paper; the web scanner's bottom could cover Retry; the reading state threw
  the focus to the page; notes that appeared were not read out; Choose photo
  outweighed its paste alternative; the contact note gave no next step.

Kept, on purpose: a wrong code in wallet setup still gets the toast a
scanned one gets; the torch stays off after a photo (the person turns it on
again if they want it).

## Limits

- A picture with several codes gives the first one the decoder finds.
- HEIC photos open in the app; the web view of some phones cannot open them,
  and says so.
- On the web there is no pasting or dropping a picture yet, only the picker.
- On iPhones before iOS 16.4 the picker never says it closed: the trip ends
  on a touch or when the page has focus again.
- Where the picker is a full-screen app and the system ends BuhoGO while it
  is open, the chosen photo is lost with the page; choosing it again works.
- On a very slow device the native decoder can take longer than 10 s (seen
  once on an overloaded emulator); the web view then reads the picture, as
  it did there.
- Once on the emulator, the first photo after installing could not be read
  ("This photo can't be opened") and the next picks of the same photo were.
  It did not happen again in eight more picks, so its cause is unknown.
  Choosing the same photo again read it.
