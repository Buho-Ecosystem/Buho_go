# Android App Links for shared card links

Shared card links look like:

```
https://go.mybuho.de/p/maria?k=npub1az708…
```

On a phone with BuhoGO installed and verification passing, tapping or scanning
one opens the card **inside the app**. Everywhere else it opens the same page
in a browser. Both paths land on `PublicProfilePage`, so there is one page to
maintain, not two.

## Status

Everything in this repository is done. One thing is not, and cannot be done
from here.

- [x] `<intent-filter android:autoVerify="true">` scoped to `/p/`
      (`src-capacitor/android/app/src/main/AndroidManifest.xml`)
- [x] `public/.well-known/assetlinks.json`, copied into `dist/pwa` by the build
      and served by the `/.well-known/*` passthrough already in `netlify.toml`
- [x] Incoming links routed to the card rather than the payment parser
      (`src/boot/deep-links.js`)
- [x] Debug certificate listed, so a debug build verifies on a dev device
- [ ] **Release certificate listed.** Until this is done, links open in the
      browser on every released build.

## Adding the release fingerprint

The release keystore is deliberately not in this repository, so the fingerprint
has to be added once by whoever holds it:

```sh
npm run assetlinks -- add --keystore ~/path/to/buhogo.jks --alias <alias>
```

keytool prompts for the password; the script never takes it as an argument, so
it stays out of shell history. If the app is distributed through Play App
Signing, take the SHA-256 from **Play Console → Setup → App integrity** and
paste it instead:

```sh
npm run assetlinks -- add --sha256 AA:BB:CC:…
```

Both forms are additive and idempotent. Listing several certificates is normal
and expected: debug builds, the release key, and Play's re-signing key can all
be present, and Android verifies if **any** of them matches the installed APK.

Then commit the change and deploy the web build. Android reads the deployed
file, not this repository.

## Checking it

```sh
npm run assetlinks -- list      # what this repo claims
npm run assetlinks -- verify    # what go.mybuho.de actually serves
```

On a device, after installing:

```sh
adb shell pm get-app-links mybuho.buhogo
# go.mybuho.de: verified

adb shell am start -a android.intent.action.VIEW \
  -d "https://go.mybuho.de/p/maria"
```

If the domain shows anything other than `verified`, re-trigger verification
with:

```sh
adb shell pm verify-app-links --re-verify mybuho.buhogo
```

## Why this fails quietly

There is no error state. If the deployed `assetlinks.json` does not list the
certificate that signed the installed APK, Android simply does not claim the
link and the browser opens it — which is exactly what happened before this
existed. So "it still opens the browser" almost always means one of:

1. the fingerprint is missing from the **deployed** file (`verify` catches this),
2. the web build has not been deployed since it was added,
3. the installed APK was signed with a different key than the one listed,
4. verification has not run yet on the device (`--re-verify` above).

## Scope

The filter deliberately covers `/p/` only. BuhoGO must not claim the rest of
`go.mybuho.de`: the web wallet lives there and has to keep opening in a
browser.
