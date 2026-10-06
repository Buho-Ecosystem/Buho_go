# QR scanning without Google Play services

Issue #288. QR scanning must work on GrapheneOS installations without Play
services and on Android feature phones, while phones that already scan fast
with the native scanner keep doing so.

## What the live scanner actually depends on

`src/utils/nativeScanner.js` drives `@capacitor-mlkit/barcode-scanning`
through its live `startScan()` API (camera preview behind a transparent
WebView, our own overlay on top). Checked against the plugin's Android
sources and Gradle module at v8.0.1:

| Piece | Used by | Needs Play services? |
| --- | --- | --- |
| CameraX (`androidx.camera:*`) | `startScan` preview + frame analysis | No |
| `com.google.mlkit:barcode-scanning` 17.3.0 | `startScan` decoding | No. This is the **bundled** model, compiled into the APK and run in-process. |
| `com.google.android.gms:play-services-code-scanner` | `scan()` (Google-branded full-screen activity), `isGoogleBarcodeScannerModuleAvailable()`, `installGoogleBarcodeScannerModule()` | Yes. It is a Play-services optional module. |

BuhoGO never calls `scan()`. The only Play-dependent calls on our path were
the two module probes, which the wrapper awaited before every scan. On a
device without Play services they reject or stall, and even where they work
they gate the camera on a module the live scanner does not use. Those probes
are removed.

One caveat: the bundled artifact also declares the thin
`play-services-mlkit-barcode-scanning` artifact as a dependency. MLKit picks
the in-process model when it is present, but the code path exists, and a
device where the Google-side model ends up selected reports it at decode
time as `scanError` events ("Waiting for the barcode module to be
downloaded…"), not as a `startScan` rejection. The wrapper watches for that.

## Engine selection

Two engines, one UI (`src/components/ScannerOverlay.vue`):

- **native**: MLKit live scan, preferred. Fast, no Google branding.
- **web**: `qr-scanner` on a `<video>` inside the overlay, fed by
  `getUserMedia`. The same engine the PWA already uses. Capacitor's WebView
  grants camera capture to the page once the app holds the CAMERA
  permission (`BridgeWebChromeClient.onPermissionRequest`), so it runs
  anywhere the WebView and a camera exist.

Selection is capability-based and automatic, implemented in
`src/utils/scannerEngine.js` (pure, unit-tested) and applied by the overlay:

1. If the plugin is registered and native is not remembered as unusable,
   try native.
2. Native counts as failed when `startScan` rejects, when it does not settle
   within 6 s (`NATIVE_START_TIMEOUT_MS`), or when the decoder reports
   `scanError` before it has decoded anything (a Google-side message trips
   immediately; otherwise three consecutive errors). The wrapper tears the
   camera down and reports a coded error.
3. On any such failure the overlay switches to the web engine in place.
   Native stays demoted for the rest of the session, so reopening the
   scanner goes straight to web.
4. Whether the demotion survives a restart depends on the failure. The
   record lives in `localStorage` (`buho.scanner.nativeUnusable`) with a
   strike count:
   - **Structural** (`NATIVE_UNAVAILABLE`, `NATIVE_DECODER_FAILED`: the
     plugin is missing or the decoder cannot work here) is remembered at
     once.
   - **Ambiguous** (`NATIVE_START_FAILED`, `NATIVE_START_TIMEOUT`) is
     remembered only after two consecutive failed attempts on separate
     launches (`NATIVE_STRIKES_TO_PERSIST`). A healthy phone whose camera
     was held by another app, or whose first start ran long, gets native
     back on the next launch. A device where CameraX never binds pays the
     timeout twice and then opens web directly.
5. The record expires after an app update (keyed by `process.env.APP_VERSION`,
   injected from `package.json` in `quasar.config.js`) and, as a backstop,
   after 30 days. A native start that succeeds clears it along with the
   strike count.
6. If native was skipped because of the record and the web engine then
   fails to start (other than a permission refusal), the overlay gives
   native one last-resort attempt before showing an error, so a stale
   record never turns into a dead scanner.
7. Camera permission refusals never trigger a fallback. Both engines need
   the same OS permission, so the user sees the permission message instead.

Scan results from either engine go through the overlay's existing
`scanned` event, so every entry point (Send sheet and Receive → Redeem via
`QrScanSheet`, address book contact scan, LUD-04 site login, NWC and LNbits
setup, the wallet-connect page) gets the fallback without changes and keeps
its own parsing and routing. Cancellation is the overlay's `close` event as
before. Repeated open/close and unmount-mid-start are guarded by a start
sequence counter so a stale camera can never be left running.

## Validation matrix

| Device | Expected engine | What to check |
| --- | --- | --- |
| Standard Android with Play services | native | Camera opens with our overlay (no Google-branded screen). Torch toggle works. Send sheet tiles (Manual / Paste / Contacts) stay tappable. Deny the permission once: permission message, no fallback attempt. |
| GrapheneOS without sandboxed Play | native expected; web if the model is not usable | First scan may take up to the 6 s budget if native stalls, then the overlay paints black and shows the live video. Subsequent scans in the same session open the web engine immediately. A decoder failure is remembered across restarts; a start timeout is re-probed once on the next launch. After an app update the native engine is probed again. |
| Android feature phone (Android Go class devices) | either | The bundled MLKit model ships inside the APK, so it needs no download. If CameraX cannot bind on the OEM camera HAL, or the model cannot load, the web engine takes over. Low-end CPUs decode noticeably slower on the web engine; hold the code steady inside the frame. |
| iOS | native | Unchanged. The web engine is also viable on WKWebView (iOS 14.3+) should native ever fail there. |
| Web / PWA | in-page qr-scanner | Unchanged. `ScannerOverlay` is not mounted on web. |

Manual test script for each device:

1. Send → Scan. Point at a Lightning invoice. Result lands in the pay flow.
2. Close the scanner with the back chevron. Reopen. Repeat five times quickly.
   No stuck black screen, no camera-in-use indicator after close.
3. Settings → Add site (LUD-04). Scan, then switch to Paste mid-scan.
4. Address book → Scan a `nostr:npub…` profile QR (continuous mode).
5. Revoke the camera permission in system settings, scan again: the
   permission message appears with a Close button.
6. For the fallback device only: confirm in `adb logcat` a single
   `[ScannerOverlay] native scanner unavailable, falling back to web engine`
   (or `native decoder failed, switching to web engine`) line on the first
   scan and none on the following scans in the same session.
7. On a Play-services phone: open another camera app, switch to BuhoGO and
   scan (native may fail, web may fail too). Close the other app, kill and
   relaunch BuhoGO, scan again: the native overlay (transparent, our frame
   over the CameraX preview) must be back.

To force the fallback on any device for UI testing, set
`localStorage['buho.scanner.nativeUnusable'] = JSON.stringify({ at: Date.now(), version: '<current version>', reason: 'NATIVE_DECODER_FAILED', strikes: 1 })`
in the WebView console and relaunch; remove the key to go back.

## Known limitations

- The web engine has no zoom and a smaller effective decode distance than
  MLKit. Dense QR codes (long BOLT11 invoices with description) need to fill
  most of the frame.
- The web engine's torch relies on the `torch` media-track capability, which
  some OEM WebViews do not expose. The torch button is hidden when it is not
  available.
- On a device where native never works, each app update (or 30 days) costs
  one probe of up to 6 s before the web engine opens (two, on separate
  launches, when the failure is a start timeout rather than a decoder
  failure). Fast rejections cost nothing visible.
- A camera preview that binds but never delivers frames and never reports
  a decoder error is indistinguishable from "no QR code in view" and does
  not trigger the fallback. The plugin exposes no per-frame signal to
  detect it.
- `Capacitor.isPluginAvailable('BarcodeScanner')` is still the gate for
  mounting the overlay. A build without the plugin falls back to the call
  sites' in-page web video, which also works on native.
