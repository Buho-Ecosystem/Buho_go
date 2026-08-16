import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compareVersions,
  fetchUpdateManifest,
  isReleaseNewer,
  isReleaseRequired,
  localizedReleaseNotes,
  normalizeUpdateManifest,
  releaseKey,
  selectAndroidChannel,
} from '../appUpdate.js'

function manifest(overrides = {}) {
  const channel = (name, extra = {}) => ({
    enabled: true,
    version: '1.10.0',
    build: name === 'web' ? null : 23,
    minimumBuild: name === 'web' ? null : 0,
    url: {
      web: null,
      play: 'https://play.google.com/store/apps/details?id=mybuho.buhogo',
      zapstore: 'https://zapstore.dev/apps/example',
      apk: 'https://github.com/Buho-Ecosystem/Buho_go/releases/latest',
      ios: 'https://apps.apple.com/app/id123456789',
    }[name],
    notes: { 'en-US': ['First', 'Second', 'Third', 'Ignored fourth'] },
    ...extra,
  })
  return {
    schemaVersion: 1,
    publishedAt: '2026-08-16T00:00:00.000Z',
    channels: {
      web: channel('web'),
      play: channel('play'),
      zapstore: channel('zapstore'),
      apk: channel('apk'),
      ios: channel('ios'),
    },
    ...overrides,
  }
}

test('normalizes every update channel and caps release notes', () => {
  const parsed = normalizeUpdateManifest(manifest())
  assert.equal(parsed.channels.play.build, 23)
  assert.deepEqual(parsed.channels.web.notes['en-US'], ['First', 'Second', 'Third'])
  assert.ok(Object.isFrozen(parsed.channels))
})

test('rejects unsupported schemas and unsafe update hosts', () => {
  assert.throws(
    () => normalizeUpdateManifest(manifest({ schemaVersion: 2 })),
    /schemaVersion/
  )

  const unsafe = manifest()
  unsafe.channels.apk.url = 'https://evil.example/BuhoGO.apk'
  assert.throws(() => normalizeUpdateManifest(unsafe), /approved update destination/)
})

test('uses native build numbers as the update authority', () => {
  const release = normalizeUpdateManifest(manifest()).channels.play
  assert.equal(isReleaseNewer({ version: '99.0.0', build: 22 }, release), true)
  assert.equal(isReleaseNewer({ version: '1.0.0', build: 23 }, release), false)
})

test('falls back to semantic version comparison when no build exists', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1)
  assert.equal(compareVersions('1.9.1', '1.9.1'), 0)
  const release = normalizeUpdateManifest(manifest()).channels.web
  assert.equal(isReleaseNewer({ version: '1.9.1', build: null }, release), true)
})

test('required state is based on minimum supported build', () => {
  const raw = manifest()
  raw.channels.play.minimumBuild = 22
  const release = normalizeUpdateManifest(raw).channels.play
  assert.equal(isReleaseRequired({ version: '1.8.0', build: 21 }, release), true)
  assert.equal(isReleaseRequired({ version: '1.9.0', build: 22 }, release), false)
})

test('selects Play only from an explicit Play source and safely falls back to APK', () => {
  assert.equal(selectAndroidChannel('com.android.vending'), 'play')
  assert.equal(selectAndroidChannel('dev.zapstore.app'), 'zapstore')
  assert.equal(selectAndroidChannel(null), 'apk')
  assert.equal(selectAndroidChannel('com.android.vending', 'apk'), 'apk')
})

test('release acknowledgement is scoped to the channel release', () => {
  const parsed = normalizeUpdateManifest(manifest())
  assert.equal(releaseKey(parsed.channels.apk), 'apk:23')
  assert.equal(releaseKey(parsed.channels.web), 'web:1.10.0')
  assert.notEqual(releaseKey(parsed.channels.apk), releaseKey(parsed.channels.play))
})

test('localizes notes with language and English fallbacks', () => {
  const raw = manifest()
  raw.channels.play.notes = { de: ['Schneller'], 'en-US': ['Faster'] }
  const release = normalizeUpdateManifest(raw).channels.play
  assert.deepEqual(localizedReleaseNotes(release, 'de-DE'), ['Schneller'])
  assert.deepEqual(localizedReleaseNotes(release, 'fr-FR'), ['Faster'])
})

test('fetches the manifest without credentials or cache', async () => {
  let request
  const parsed = await fetchUpdateManifest({
    url: 'https://go.mybuho.de/update-manifest.json',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, json: async () => manifest() }
    },
  })
  assert.equal(parsed.channels.apk.version, '1.10.0')
  assert.equal(request.options.cache, 'no-store')
  assert.equal(request.options.credentials, 'omit')
  assert.equal(request.options.redirect, 'error')
})
