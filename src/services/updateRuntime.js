import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { version as bundledVersion } from '../../package.json'
import { openInAppBrowser } from '../utils/inAppBrowser'
import { selectAndroidChannel } from './appUpdate'

export const NativeUpdate = registerPlugin('BuhoUpdate')

const NATIVE_UPDATE_MANIFEST_URL = 'https://go.mybuho.de/update-manifest.json'

export function getUpdateManifestUrl() {
  // Web builds should read metadata from the deployment that supplied their
  // service worker. This keeps previews and alternate domains isolated from
  // production. Native bundles have no web origin, so they use the canonical
  // BuhoGO endpoint.
  return Capacitor.isNativePlatform()
    ? NATIVE_UPDATE_MANIFEST_URL
    : '/update-manifest.json'
}

function preferredAndroidChannel() {
  try {
    return process.env.BUHO_DISTRIBUTION_CHANNEL || ''
  } catch {
    return ''
  }
}

export async function getUpdateRuntime() {
  if (!Capacitor.isNativePlatform()) {
    return { platform: 'web', channel: 'web', version: bundledVersion, build: null, installSource: null }
  }

  const platform = Capacitor.getPlatform()
  const info = await App.getInfo()
  const build = Number(info.build)
  let installSource = null

  if (platform === 'android') {
    try {
      installSource = (await NativeUpdate.getInstallSource()).installSource || null
    } catch {
      // Older builds do not have the native bridge yet. They safely fall back
      // to the official APK release page instead of guessing Google Play.
    }
  }

  return {
    platform,
    channel: platform === 'ios'
      ? 'ios'
      : selectAndroidChannel(installSource, preferredAndroidChannel()),
    version: info.version,
    build: Number.isSafeInteger(build) && build >= 0 ? build : null,
    installSource,
  }
}

export function isKioskLocked() {
  try {
    const saved = localStorage.getItem('buhoGO_wallet_store')
    if (!saved) return false
    const state = JSON.parse(saved)
    return state.kioskEnabled === true && state.kioskOwnerAccess !== true
  } catch {
    return false
  }
}

export async function openUpdateDestination(url) {
  if (!url) throw new Error('This update channel is not available yet')
  await openInAppBrowser(url)
}
