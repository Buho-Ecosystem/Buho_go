#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { normalizeUpdateManifest } from '../src/services/appUpdate.js'

const MANIFEST_PATH = resolve('public/update-manifest.json')
const CHANNELS = new Set(['web', 'play', 'zapstore', 'apk', 'ios'])
const VERSION_RE = /^\d+\.\d+\.\d+$/

function usage(message) {
  if (message) console.error(`Error: ${message}\n`)
  console.error('Usage: npm run release:activate -- --channel <channel> --version X.Y.Z [--build N] [--minimum-build N] [--note "What changed"] [--url https://...]')
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
if (!CHANNELS.has(args.channel)) usage('channel must be web, play, zapstore, apk, or ios')
if (!VERSION_RE.test(args.version || '')) usage('version must use X.Y.Z format')

const build = args.channel === 'web' ? null : integer(args.build, 'build')
const minimumBuild = args.channel === 'web'
  ? null
  : integer(args['minimum-build'], 'minimum-build', { optional: true })
if (build !== null && minimumBuild !== undefined && minimumBuild > build) {
  usage('minimum-build cannot exceed build')
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
const current = manifest.channels?.[args.channel]
if (!current) usage(`manifest channel ${args.channel} is missing`)

manifest.publishedAt = new Date().toISOString()
manifest.channels[args.channel] = {
  ...current,
  enabled: true,
  version: args.version,
  build,
  minimumBuild: minimumBuild ?? current.minimumBuild ?? 0,
  url: args.url || current.url || null,
  notes: args.notes.length ? { 'en-US': args.notes.slice(0, 3) } : current.notes,
}

if (args.channel === 'ios' && !manifest.channels.ios.url) {
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
console.log(`Activated ${args.channel} update ${args.version}${build === null ? '' : ` (build ${build})`}`)
console.log(`Review and deploy ${MANIFEST_PATH} only after the channel artifact is downloadable.`)
