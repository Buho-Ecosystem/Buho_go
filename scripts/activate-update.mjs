#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { normalizeUpdateManifest } from '../src/services/appUpdate.js'

const MANIFEST_PATH = resolve('public/update-manifest.json')
const CHANNELS = new Set(['web', 'play', 'zapstore', 'apk', 'ios'])
const VERSION_RE = /^\d+\.\d+\.\d+$/

function usage(message) {
  if (message) console.error(`Error: ${message}\n`)
  console.error('Usage: npm run release:activate -- --channel <channel>[,<channel>...] --version X.Y.Z [--build N] [--minimum-build N] [--note "What changed"] [--url https://...]')
  process.exit(1)
}

function parseArgs(argv) {
  const result = { notes: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key.startsWith('--') || value === undefined) usage(`Missing value for ${key}`)
    i += 1
    if (key === '--note') result.notes.push(value)
    else result[key.slice(2)] = value
  }
  return result
}

function integer(value, name, { optional = false } = {}) {
  if (optional && value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) usage(`${name} must be a non-negative integer`)
  return parsed
}

const args = parseArgs(process.argv.slice(2))
// One channel, or several at once (`--channel play,zapstore,apk,web`) when a
// release goes live everywhere together.
const channels = String(args.channel || '').split(',').filter(Boolean)
if (!channels.length || !channels.every(channel => CHANNELS.has(channel))) {
  usage('channel must be web, play, zapstore, apk, or ios (comma-separated for several)')
}
if (!VERSION_RE.test(args.version || '')) usage('version must use X.Y.Z format')
const native = channels.some(channel => channel !== 'web')
const build = native ? integer(args.build, 'build') : null
const minimumBuild = native ? integer(args['minimum-build'], 'minimum-build', { optional: true }) : undefined
if (minimumBuild !== undefined && minimumBuild > build) usage('minimum-build cannot exceed build')
if (args.url && channels.length > 1) usage('--url applies to one channel at a time')

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
manifest.publishedAt = new Date().toISOString()
for (const channel of channels) {
  const current = manifest.channels?.[channel]
  if (!current) usage(`manifest channel ${channel} is missing`)
  const web = channel === 'web'
  manifest.channels[channel] = {
    ...current,
    enabled: true,
    version: args.version,
    build: web ? null : build,
    minimumBuild: web ? null : minimumBuild ?? current.minimumBuild ?? 0,
    url: args.url || current.url || null,
    // Notes describe one release: a new version without notes shows none
    // rather than the previous release's.
    notes: args.notes.length
      ? { 'en-US': args.notes.slice(0, 3) }
      : current.version === args.version ? current.notes : { 'en-US': [] },
  }
}

if (channels.includes('ios') && !manifest.channels.ios.url) {
  usage('ios activation requires an apps.apple.com URL')
}

try {
  // Apply the exact same schema and destination allowlist used by the app so
  // a release operator cannot deploy metadata that every client will reject.
  normalizeUpdateManifest(manifest)
} catch (error) {
  usage(error?.message || 'manifest validation failed')
}

await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Activated ${channels.join(', ')} update ${args.version}${build === null ? '' : ` (build ${build})`}`)
console.log('Installed apps see it once this manifest is deployed (main, go.mybuho.de).')
