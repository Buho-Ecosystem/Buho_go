import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  compareVersions,
  fetchUpdateManifest,
  findWaitingWorker,
  isReleaseNewer,
  isReleaseRequired,
  localizedReleaseNotes,
  normalizeUpdateManifest,
  releaseKey,
  selectAndroidChannel,
  updateStage,
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

/**
 * A service-worker container with one registration. `onUpdate` decides what
 * `registration.update()` finds: nothing, or a worker that installs.
 */
function workerContainer({ waiting = null, onUpdate = () => {} } = {}) {
  const registration = {
    waiting,
    installing: null,
    updates: 0,
    async update() {
      this.updates += 1
      onUpdate(this)
    },
  }
  return { controller: {}, registration, getRegistration: async () => registration }
}

function installingWorker() {
  const worker = new EventTarget()
  worker.state = 'installing'
  worker.finish = (state, registration) => {
    worker.state = state
    if (state === 'installed') registration.waiting = worker
    registration.installing = null
    worker.dispatchEvent(new Event('statechange'))
  }
  return worker
}

test('a web check finds a deployment that is already waiting without asking again', async () => {
  const { registration, ...container } = workerContainer({ waiting: {} })
  assert.equal(await findWaitingWorker(container, { timeoutMs: 50 }), true)
  assert.equal(registration.updates, 0)
})

test('a web check asks for a new deployment and waits for it to install', async () => {
  let worker
  const container = workerContainer({
    onUpdate: (registration) => {
      worker = installingWorker()
      registration.installing = worker
      setTimeout(() => worker.finish('installed', registration), 5)
    },
  })
  assert.equal(await findWaitingWorker(container, { timeoutMs: 1000 }), true)
  assert.equal(container.registration.updates, 1)
})

test('a web check finds nothing when there is no newer deployment or no service worker', async () => {
  assert.equal(await findWaitingWorker(workerContainer(), { timeoutMs: 50 }), false)
  assert.equal(await findWaitingWorker(null, { timeoutMs: 50 }), false)
  assert.equal(await findWaitingWorker({ controller: {}, getRegistration: async () => undefined }, { timeoutMs: 50 }), false)
})

test('a first visit, with no worker running the page yet, is never offered an update', async () => {
  const { registration, ...firstVisit } = workerContainer({ waiting: {} })
  assert.equal(await findWaitingWorker({ ...firstVisit, controller: null }, { timeoutMs: 50 }), false)
  assert.equal(registration.updates, 0)
})

test('a web deployment that fails to install, or takes too long, is not offered', async () => {
  const failing = workerContainer({
    onUpdate: (registration) => {
      const worker = installingWorker()
      registration.installing = worker
      setTimeout(() => worker.finish('redundant', registration), 5)
    },
  })
  assert.equal(await findWaitingWorker(failing, { timeoutMs: 1000 }), false)

  const slow = workerContainer({
    onUpdate: (registration) => { registration.installing = installingWorker() },
  })
  assert.equal(await findWaitingWorker(slow, { timeoutMs: 20 }), false)

  const stalled = workerContainer()
  stalled.registration.update = () => new Promise(() => {})
  assert.equal(await findWaitingWorker(stalled, { timeoutMs: 20 }), false, 'a stalled request ends with the check')
})

test('a failed web check is reported, not taken for "up to date"', async () => {
  const offline = workerContainer({ onUpdate: () => { throw new Error('offline') } })
  await assert.rejects(() => findWaitingWorker(offline, { timeoutMs: 50 }), /offline/)
})

test('the checked-in manifest announces the version this repository builds', () => {
  const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
  const shipped = normalizeUpdateManifest(JSON.parse(read('public/update-manifest.json')))
  const { version } = JSON.parse(read('package.json'))
  const build = Number(read('src-capacitor/android/app/build.gradle').match(/versionCode (\d+)/)[1])

  assert.equal(shipped.channels.web.version, version, 'web')
  for (const channel of ['play', 'zapstore', 'apk']) {
    const release = shipped.channels[channel]
    if (!release.enabled) continue
    assert.equal(release.version, version, `${channel} version (run ./update-version.sh or release:activate)`)
    assert.equal(release.build, build, `${channel} build`)
  }
})

test('the update flow shows one stage at a time, and a finished download always wins', () => {
  const stage = (status, playUpdateStatus = '') => updateStage({ status, playUpdateStatus })
  assert.equal(stage('available'), 'available')
  assert.equal(stage('available', 'downloading'), 'downloading')
  assert.equal(stage('available', 'downloaded'), 'ready')
  assert.equal(stage('required'), 'required')
  assert.equal(stage('required', 'downloading'), 'required', 'Play shows its own screen for a required update')
  for (const status of ['idle', 'checking', 'upToDate', 'error']) {
    assert.equal(stage(status), null, status)
    assert.equal(stage(status, 'downloaded'), 'ready', `${status}: only a restart completes a downloaded update`)
  }
})
