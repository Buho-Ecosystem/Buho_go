/**
 * The locale files, kept honest.
 *
 * Each locale is an `index.js` that merges one file per feature area. Two
 * things go wrong quietly there, and both have shipped before:
 * - a string defined twice: the later definition wins, so the other one is a
 *   translation nobody ever sees;
 * - a string one locale has and another lacks: the app falls back to English
 *   in the middle of a German or Spanish screen, and a string that English
 *   itself lacks loses its placeholders.
 *
 * Run: node --test src/i18n/__tests__/locales.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../locales.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const codes = SUPPORTED_LOCALES.map((locale) => locale.value);

// A top-level entry: two spaces, then a quoted or bare key, then a colon.
const ENTRY = /^ {2}(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z_$][\w$]*))\s*:/gm;
// The key as JavaScript reads it: escapes such as \u00b7 resolved.
const literal = (body, quote) => JSON.parse(`"${quote === '"' ? body : body.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"')}"`);

/** Every top-level definition of a locale, as `{ file, key }`, in its files' own words. */
function definitions(code) {
  const found = [];
  for (const file of readdirSync(join(root, code)).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(join(root, code, file), 'utf8');
    for (const match of source.matchAll(ENTRY)) {
      const key = match[3] ?? (match[1] !== undefined ? literal(match[1], '"') : literal(match[2], "'"));
      found.push({ file, key });
    }
  }
  return found;
}

const messages = Object.fromEntries(await Promise.all(codes.map(async (code) => (
  [code, (await import(pathToFileURL(join(root, code, 'index.js')).href)).default]
))));

for (const code of codes) {
  test(`${code}: every string is defined once`, () => {
    const seen = new Map();
    for (const { file, key } of definitions(code)) seen.set(key, [...(seen.get(key) ?? []), file]);
    const twice = [...seen].filter(([, files]) => files.length > 1).map(([key, files]) => `"${key}" in ${files.join(' and ')}`);
    assert.deepEqual(twice, [], 'the later definition wins; remove the one that loses');
    // The reading above is by pattern. It has to account for every string the
    // locale really exports, or a new way of writing an entry went unseen.
    assert.deepEqual([...seen.keys()].sort(), Object.keys(messages[code]).sort());
  });
}

for (const code of codes.filter((value) => value !== DEFAULT_LOCALE)) {
  test(`${code}: holds the same strings as ${DEFAULT_LOCALE}`, () => {
    const reference = messages[DEFAULT_LOCALE];
    const missing = Object.keys(reference).filter((key) => !(key in messages[code]));
    const unknown = Object.keys(messages[code]).filter((key) => !(key in reference));
    assert.deepEqual(missing, [], `in ${DEFAULT_LOCALE} but not in ${code}`);
    assert.deepEqual(unknown, [], `in ${code} but not in ${DEFAULT_LOCALE}`);
  });
}
