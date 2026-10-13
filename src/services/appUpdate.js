/**
 * Pure update-manifest parsing and version comparison, and the web
 * deployment check against an injected service-worker container.
 *
 * This module deliberately has no browser or Capacitor dependencies, which
 * keeps the security-sensitive comparison rules easy to unit test.
 */

export const UPDATE_CHANNELS = Object.freeze(['web', 'play', 'zapstore', 'apk', 'ios'])

export const DEFAULT_UPDATE_URLS = Object.freeze({
  play: 'https://play.google.com/store/apps/details?id=mybuho.buhogo',
  zapstore: 'https://zapstore.dev/apps/naddr1qqxk67tzw45x7tnzw45x7em0qgs83nn04fezvsu89p8xg7axjwye2u67errat3dx2um725fs7qnrqlgrqsqqqlstrk2q4u',
  apk: 'https://github.com/Buho-Ecosystem/Buho_go/releases/latest',
})

const ALLOWED_UPDATE_HOSTS = Object.freeze({
  play: new Set(['play.google.com']),
  zapstore: new Set(['zapstore.dev']),
  apk: new Set(['github.com']),
  ios: new Set(['apps.apple.com']),
})

const STABLE_VERSION_RE = /^\d+\.\d+\.\d+$/

function asBuild(value, field, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === '')) return null
  const build = Number(value)
  if (!Number.isSafeInteger(build) || build < 0) {
    throw new TypeError(`${field} must be a non-negative integer`)
  }
  return build
}

function asVersion(value, field) {
  const version = String(value || '').trim()
  if (!STABLE_VERSION_RE.test(version)) {
    throw new TypeError(`${field} must use stable X.Y.Z format`)
  }
  return version
}

function normalizeNotes(notes) {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return {}
  const normalized = {}
  for (const [locale, entries] of Object.entries(notes)) {
    if (!Array.isArray(entries)) continue
    const safeEntries = entries
      .filter(entry => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean)
      .slice(0, 3)
    if (safeEntries.length) normalized[locale] = safeEntries
  }
  return normalized
}

/**
 * Only accept destinations owned by the selected distribution channel.
 * The manifest is remote configuration, not permission to open arbitrary
 * URLs from a wallet application.
 */
export function normalizeUpdateUrl(channel, value) {
  if (channel === 'web') return null
  const fallback = DEFAULT_UPDATE_URLS[channel] || null
  const candidate = value || fallback
  if (!candidate) return null

  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    throw new TypeError(`channels.${channel}.url must be an absolute URL`)
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_UPDATE_HOSTS[channel]?.has(parsed.hostname)) {
    throw new TypeError(`channels.${channel}.url is not an approved update destination`)
  }
  return parsed.toString()
}

function normalizeChannel(channel, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`channels.${channel} must be an object`)
  }

  const version = asVersion(raw.version, `channels.${channel}.version`)
  const build = asBuild(raw.build, `channels.${channel}.build`, { optional: channel === 'web' })
  const minimumBuild = asBuild(
    raw.minimumBuild,
    `channels.${channel}.minimumBuild`,
    { optional: channel === 'web' }
  )

  if (build !== null && minimumBuild !== null && minimumBuild > build) {
    throw new TypeError(`channels.${channel}.minimumBuild cannot exceed build`)
  }

  return Object.freeze({
    channel,
    enabled: raw.enabled === true,
    version,
    build,
    minimumBuild,
    url: normalizeUpdateUrl(channel, raw.url),
    notes: Object.freeze(normalizeNotes(raw.notes)),
  })
}

export function normalizeUpdateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Update manifest must be an object')
  }
  if (raw.schemaVersion !== 1) {
    throw new TypeError('Unsupported update manifest schemaVersion')
  }
  if (!raw.channels || typeof raw.channels !== 'object') {
    throw new TypeError('Update manifest channels are missing')
  }

  const channels = {}
  for (const channel of UPDATE_CHANNELS) {
    channels[channel] = normalizeChannel(channel, raw.channels[channel])
  }

  const publishedAt = String(raw.publishedAt || '')
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    throw new TypeError('publishedAt must be an ISO date')
  }

  return Object.freeze({
    schemaVersion: 1,
    publishedAt,
    channels: Object.freeze(channels),
  })
}

export async function fetchUpdateManifest({ url, fetchImpl = fetch, signal } = {}) {
  if (!url) throw new TypeError('Update manifest URL is required')
  const response = await fetchImpl(url, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error(`Update check returned HTTP ${response.status}`)
  return normalizeUpdateManifest(await response.json())
}

/**
 * Ask the service worker for a newer web deployment and resolve whether one
 * is installed and waiting to take over. The whole check, asking included,
 * gets `timeoutMs`: a stalled network must not hold the check open. `container`
 * is `navigator.serviceWorker`, passed in so this module stays free of
 * browser globals. Without a worker running this page (no service worker in
 * this browser or build, or the very first visit) there is no update to offer.
 *
 * @returns {Promise<boolean>}
 */
export async function findWaitingWorker(container, { timeoutMs }) {
  if (!container?.controller) return false
  let timer
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) })
  try {
    return await Promise.race([installedWorker(container), deadline])
  } finally {
    clearTimeout(timer)
  }
}

async function installedWorker(container) {
  const registration = await container.getRegistration()
  if (!registration) return false
  if (registration.waiting) return true
  await registration.update()
  const worker = registration.installing
  if (!worker) return Boolean(registration.waiting)
  await new Promise(resolve => {
    const onStateChange = () => {
      if (worker.state === 'installing') return
      worker.removeEventListener('statechange', onStateChange)
      resolve()
    }
    worker.addEventListener('statechange', onStateChange)
  })
  return Boolean(registration.waiting)
}

export function compareVersions(left, right) {
  const a = asVersion(left, 'left version').split('.').map(Number)
  const b = asVersion(right, 'right version').split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}

export function isReleaseNewer(runtime, release) {
  if (!release?.enabled) return false
  if (release.build !== null && Number.isSafeInteger(runtime?.build)) {
    return release.build > runtime.build
  }
  return compareVersions(release.version, runtime.version) > 0
}

export function isReleaseRequired(runtime, release) {
  return release?.minimumBuild !== null
    && Number.isSafeInteger(runtime?.build)
    && runtime.build < release.minimumBuild
}

export function releaseKey(release) {
  if (!release) return ''
  // Acknowledgement belongs to the channel release itself. The manifest-level
  // timestamp changes whenever *any* channel is activated, so including it
  // would resurface an unchanged APK update after a Play-only release.
  return `${release.channel}:${release.build ?? release.version}`
}

export function localizedReleaseNotes(release, locale = 'en-US') {
  if (!release?.notes) return []
  return release.notes[locale]
    || release.notes[locale.split('-')[0]]
    || release.notes['en-US']
    || []
}

export function selectAndroidChannel(installSource, preferredChannel = '') {
  if (UPDATE_CHANNELS.includes(preferredChannel) && !['web', 'ios'].includes(preferredChannel)) {
    return preferredChannel
  }
  const source = String(installSource || '').toLowerCase()
  if (source === 'com.android.vending') return 'play'
  if (source.includes('zapstore')) return 'zapstore'
  return 'apk'
}
