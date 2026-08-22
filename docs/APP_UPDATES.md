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
and a future App Store release can become available at different times. Never
activate a channel until that exact artifact is downloadable. A premature
activation gives users an update action that cannot succeed.

1. Bump and build the app with `./update-version.sh X.Y.Z`.
2. Publish and verify the artifact for one distribution channel.
3. Activate only that channel, for example:

   ```sh
   npm run release:activate -- \
     --channel play \
     --version 1.10.0 \
     --build 23 \
     --note "Faster wallet startup" \
     --note "Improved payment reliability"
   ```

4. Deploy the resulting manifest change.
5. Repeat activation as the other channels become available.

Use `--minimum-build N` only when builds below `N` cannot safely continue.
Required updates must be tested on every enabled channel first. The required
sheet preserves access to the recovery-phrase backup flow.

The iOS channel stays disabled until BuhoGO has an App Store product URL. iOS
activation requires an allowlisted `https://apps.apple.com/...` URL.

## Client behavior

- Update checks are best-effort, time out after six seconds, and never block
  wallet startup.
- Ordinary updates show one lightweight cue per release and keep the `+1`
  badge on the wallet logo until the app is updated.
- Required updates show a persistent sheet after biometric unlock, outside
  onboarding, setup, restore, and locked kiosk routes.
- PWA availability comes from the service-worker lifecycle; the manifest only
  supplies display metadata.
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
