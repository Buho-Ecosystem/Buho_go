# BuhoGO app updates

Native BuhoGO builds discover updates through
`https://go.mybuho.de/update-manifest.json`. Web builds use the same-origin
`/update-manifest.json`, so preview deployments cannot accidentally consume
production release metadata. The checked-in source is
`public/update-manifest.json`; Netlify serves it with `Cache-Control: no-store`.
The manifest response also permits credential-free cross-origin reads from the
Capacitor WebView.

## Release safety

The manifest is channel-aware because Google Play, Zapstore, direct APK, web,
and a future App Store release could become available at different times. A
channel announcing a release that is not downloadable yet gives users an
update action that cannot succeed.

BuhoGO releases go live on Google Play, Zapstore and GitHub (APK) together, so
the manifest moves with the version:

1. `./update-version.sh X.Y.Z` bumps the version and the Android build, and
   activates `play`, `zapstore`, `apk` and `web` in `public/update-manifest.json`
   with that version and build (`release:activate` with several channels).
2. Publish the artifacts as usual.
3. The manifest reaches installed apps when `main` deploys to go.mybuho.de.
4. Then send the store listings that wait for this release. They point other
   apps' users at screens that exist only once `main` is out:
   - **Alby Hub app store** (issue #389): `store/alby-hub/PULL_REQUEST.md` has
     the steps, the logo and the entry; open the pull request to getAlby/hub
     once the release with "Connect a wallet" (#410, #412) is live.

`appUpdate.spec.js` fails while an enabled Android channel or the web channel
names another version or build than `package.json` and `build.gradle`, so a
release cannot ship with a stale manifest again (1.9.2 to 1.10.0 did, and no
installed app was told about them).

Release notes are optional; add them, or activate a single channel that lags
behind, with `release:activate`:

```sh
npm run release:activate -- \
  --channel play,zapstore,apk \
  --version 1.10.0 \
  --build 25 \
  --note "Faster wallet startup" \
  --note "Improved payment reliability"
```

A new version activated without notes shows none, never the previous
release's.

Use `--minimum-build N` only when builds below `N` cannot safely continue.
Required updates must be tested on every enabled channel first. The required
sheet preserves access to the recovery-phrase backup flow.

The iOS channel stays disabled until BuhoGO has an App Store product URL. iOS
activation requires an allowlisted `https://apps.apple.com/...` URL.

## Client behavior

- Update checks are best-effort, time out after six seconds, and never block
  wallet startup.
- An ordinary update never interrupts. A dot on the wallet logo and on About
  in the menu stays until the app is updated; the logo, the menu and About's
  Software update row open the update sheet (`UpdateExperience.vue`), which
  names the release, where it comes from, what is new and that the wallet
  stays as it is, with one Update button and a quiet Not Now.
- The sheet presents itself only twice: a required update (full screen after
  biometric unlock, outside onboarding, setup, restore and locked kiosk
  routes, with Back Up Recovery Phrase as the way out) and, once per session,
  a finished Google Play download, which only a restart completes. Its
  stages come from `updateStage` (available, downloading, ready, required).
- About shows the version and a Software update row: what the last check
  found and when (opening About checks, within the six-hour limit; tapping
  checks now or opens the waiting update).
- PWA availability comes from the service-worker lifecycle; the manifest only
  supplies display metadata. Every check (start, coming back to the app, the
  version tap on About) asks the service worker to look for a new deployment
  (`registration.update()`), because the app navigates inside one page and the
  browser itself only looks when the page loads. A deployment still
  downloading gets up to 30 seconds.
- Native apps check on start and when they come back to the foreground; web
  checks when the tab becomes visible again. Both share `checkForUpdates`,
  which goes to the network at most every six hours unless forced (the
  version tap forces).
- Android Play installs use Play Core. Other Android installs open an
  allowlisted Zapstore or GitHub destination.

## Testing a release

- PWA: deploy an old build, keep it open, deploy the new build, and confirm the
  cue, badge, sheet, and reload path.
- Google Play: use Internal App Sharing with the same application ID and
  signing key, then upload a higher version code.
- APK/Zapstore: install the prior APK and confirm the update destination from
  the newer manifest.
- Kiosk: confirm no update UI appears while kiosk mode is locked.
- Accessibility: check keyboard focus, VoiceOver/TalkBack labels, large text,
  contrast in both themes, and reduced-motion behavior.
