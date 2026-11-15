/**
 * In a scoped <style>, Vue compiles `:global(A) B` to just `A`: everything
 * after the :global() is dropped. `:global(body.body--dark) .x { color }`
 * therefore became `body.body--dark { color }` and recolored the text of the
 * whole app in dark mode. A dark-mode rule in a scoped style is written as
 * `body.body--dark .x`, which Vue keeps and scopes to the component.
 *
 * Run directly with Node:
 *   node src/__tests__/scopedStyles.spec.js
 */

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../', import.meta.url));

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

/** The scoped <style> blocks of every component, comments left out. */
function scopedStyles(dir = SRC) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : scopedStyles(path);
    if (!entry.name.endsWith('.vue')) return [];
    const blocks = [...readFileSync(path, 'utf8').matchAll(/<style\b[^>]*\bscoped\b[^>]*>([\s\S]*?)<\/style>/g)];
    return blocks.map((m) => ({ file: relative(SRC, path), css: m[1].replace(/\/\*[\s\S]*?\*\//g, '') }));
  });
}

test('no scoped style puts anything after a :global() selector', () => {
  const dropped = scopedStyles().flatMap(({ file, css }) =>
    [...css.matchAll(/:global\([^)]*\)[^{},]*?(?=\s*[{,])/g)]
      .map((m) => m[0])
      .filter((selector) => !/^:global\([^)]*\)$/.test(selector.trim()))
      .map((selector) => `${file}: ${selector.trim()}`));
  assert.deepEqual(dropped, []);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
