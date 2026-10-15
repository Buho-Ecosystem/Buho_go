/**
 * Icons come only from the sets bundled in boot/iconify.js (the app uses
 * the offline build of @iconify/vue). A name that is not in a bundled set
 * renders nothing, so every name the code uses must exist.
 *
 * Run directly with Node:
 *   node src/boot/__tests__/iconify.spec.js
 */

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const tabler = createRequire(import.meta.url)('@iconify-json/tabler/icons.json');
const BUNDLED_PREFIXES = new Set(['tabler', 'buho', 'circle-flags']);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

/** Source files of the app, comments left out (they may name icons that no longer exist). */
function sources(dir = SRC) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path);
    if (!/\.(vue|js)$/.test(entry.name)) return [];
    const text = readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return [{ file: relative(SRC, path), text }];
  });
}

const files = sources();

test('every tabler icon the app names exists in the bundled set', () => {
  const known = new Set([...Object.keys(tabler.icons), ...Object.keys(tabler.aliases || {})]);
  const missing = files.flatMap(({ file, text }) =>
    [...text.matchAll(/tabler:([a-z0-9-]+)/g)]
      .map((m) => m[1])
      .filter((name) => !known.has(name))
      .map((name) => `${file}: tabler:${name}`));
  assert.deepEqual(missing, []);
});

test('every icon written in a template comes from a bundled set', () => {
  const foreign = files.flatMap(({ file, text }) =>
    [...text.matchAll(/\bicon="([a-z0-9-]+):[a-z0-9-]+"/g)]
      .filter((m) => !BUNDLED_PREFIXES.has(m[1]))
      .map((m) => `${file}: ${m[0]}`));
  assert.deepEqual(foreign, []);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
