#!/usr/bin/env node
/**
 * Every Capacitor plugin the app imports must also be installed in the native
 * project, or the call fails on a device with
 * `"<Name>" plugin is not implemented on android` (or ios).
 *
 * The web build resolves plugins from the root package.json, but the Android
 * and iOS projects are generated from src-capacitor/package.json. A plugin
 * added to only the first builds, bundles and passes every web test, then
 * breaks only on a phone. This script compares the two.
 *
 * Usage: npm run check:native-plugins
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Plugins the app imports on purpose without a native install, because every
 * call site catches the failure and falls back to a web API. Adding one here
 * is a product decision: the fallback is what users get on a phone.
 */
const WEB_FALLBACK = new Map([
  ['@capacitor/browser', 'src/utils/inAppBrowser.js falls back to window.open'],
  ['@capacitor/geolocation', 'src/utils/mapGeolocation.js falls back to navigator.geolocation'],
]);

/** Packages that are Capacitor plumbing rather than plugins. */
const NOT_PLUGINS = new Set(['@capacitor/core', '@capacitor/cli', '@capacitor/android', '@capacitor/ios']);

const IMPORT_RE = /(?:from\s+|import\(\s*)['"](@capacitor(?:-[\w-]+)?\/[\w-]+|@capgo\/[\w-]+)['"]/g;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(js|mjs|vue)$/.test(name) ? [path] : [];
  });
}

const imported = new Map();
for (const file of sourceFiles(join(ROOT, 'src'))) {
  for (const [, pkg] of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
    if (NOT_PLUGINS.has(pkg)) continue;
    if (!imported.has(pkg)) imported.set(pkg, relative(ROOT, file));
  }
}

const nativeManifest = JSON.parse(readFileSync(join(ROOT, 'src-capacitor/package.json'), 'utf8'));
const installed = new Set(Object.keys(nativeManifest.dependencies || {}));

const missing = [...imported].filter(([pkg]) => !installed.has(pkg) && !WEB_FALLBACK.has(pkg));

if (missing.length) {
  console.error('Capacitor plugins imported by the app but not installed in src-capacitor:\n');
  for (const [pkg, file] of missing) console.error(`  ${pkg}  (first used in ${file})`);
  console.error('\nFix: cd src-capacitor && npm install <plugin> && npx cap update');
  process.exit(1);
}

console.log(`OK: ${imported.size} Capacitor plugins imported, all installed natively or with a web fallback.`);
