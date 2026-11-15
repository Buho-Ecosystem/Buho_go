/**
 * The locale files, kept honest.
 *
 * Each locale is an `index.js` that merges one file per feature area. Things
 * go wrong quietly there, and each of these has shipped before:
 * - a string defined twice: the later definition wins, so the other one is a
 *   translation nobody ever sees;
 * - a string one locale has and another lacks: the app falls back to English
 *   in the middle of a German or Spanish screen, and a string that English
 *   itself lacks loses its placeholders;
 * - a string the app asks for that no locale defines;
 * - a translation whose placeholders differ from the English ones, so a
 *   name or an amount never appears.
 *
 * What it reads by pattern (definitions, and the strings the app asks for)
 * it checks against what the locale really exports, so a new way of writing
 * an entry fails here instead of going unseen. Entries are written one per
 * line, two spaces in, in files directly inside the locale's folder.
 *
 * Run: node --test src/i18n/__tests__/locales.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../locales.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sources = join(root, '..');
const codes = SUPPORTED_LOCALES.map((locale) => locale.value);

// A top-level entry: two spaces, then a quoted or bare key, then a colon.
const ENTRY = /^ {2}(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z_$][\w$]*))\s*:/gm;
// The text of a string literal as JavaScript reads it: escapes such as \u00b7 resolved.
const literal = (body, quote) => JSON.parse(`"${quote === '"' ? body : body.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"')}"`);

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

/** Every string of a locale by its path: nested groups as `group.name`. */
function flatten(messages, prefix = '') {
  const flat = new Map();
  for (const [key, value] of Object.entries(messages)) {
    if (value && typeof value === 'object') for (const [path, text] of flatten(value, `${prefix}${key}.`)) flat.set(path, text);
    else flat.set(prefix + key, value);
  }
  return flat;
}

const placeholders = (text) => [...String(text).matchAll(/\{([A-Za-z_][\w]*)\}/g)].map((match) => match[1]).sort();

const messages = Object.fromEntries(await Promise.all(codes.map(async (code) => (
  [code, (await import(pathToFileURL(join(root, code, 'index.js')).href)).default]
))));
const strings = Object.fromEntries(codes.map((code) => [code, flatten(messages[code])]));

test('every locale folder is a supported locale, and the app loads each one', () => {
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '__tests__').map((entry) => entry.name);
  assert.deepEqual(folders.sort(), [...codes].sort(), 'src/i18n/<code>/ and SUPPORTED_LOCALES name the same locales');
  const registry = readFileSync(join(root, 'index.js'), 'utf8');
  for (const code of codes) {
    assert.match(registry, new RegExp(`from '\\./${code}'`), `${code} is imported in src/i18n/index.js`);
    assert.match(registry, new RegExp(`'${code}':`), `${code} is registered in src/i18n/index.js`);
  }
});

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

  test(`${code}: every string has text`, () => {
    const empty = [...strings[code]].filter(([, text]) => typeof text !== 'string' || text.trim() === '').map(([path]) => path);
    assert.deepEqual(empty, []);
  });
}

for (const code of codes.filter((value) => value !== DEFAULT_LOCALE)) {
  test(`${code}: holds the same strings as ${DEFAULT_LOCALE}`, () => {
    const missing = [...strings[DEFAULT_LOCALE].keys()].filter((path) => !strings[code].has(path));
    const unknown = [...strings[code].keys()].filter((path) => !strings[DEFAULT_LOCALE].has(path));
    assert.deepEqual(missing, [], `in ${DEFAULT_LOCALE} but not in ${code}`);
    assert.deepEqual(unknown, [], `in ${code} but not in ${DEFAULT_LOCALE}`);
  });

  test(`${code}: every string keeps the placeholders of ${DEFAULT_LOCALE}`, () => {
    const differing = [...strings[DEFAULT_LOCALE]]
      .filter(([path, text]) => strings[code].has(path) && placeholders(text).join() !== placeholders(strings[code].get(path)).join())
      .map(([path]) => path);
    assert.deepEqual(differing, [], 'a renamed or missing placeholder never gets its value');
  });
}

test(`every string the app asks for is defined in ${DEFAULT_LOCALE}`, () => {
  // $t('…'), t('…'), $tc('…') and i18n.global.t('…') with the string written
  // out, also as either side of a condition: $t(paid ? 'Paid' : 'Waiting').
  const CALL = /(?:\$tc?|\bt|\.t)\(\s*(['"])((?:\\.|(?!\1).)+)\1\s*[,)]/g;
  const EITHER = /(?:\$tc?|\bt|\.t)\([^()]*\?\s*(['"])((?:\\.|(?!\1).)+)\1\s*:\s*(['"])((?:\\.|(?!\3).)+)\3\s*[,)]/g;
  const files = [];
  (function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!['__tests__', 'i18n', 'node_modules'].includes(entry.name)) walk(join(folder, entry.name));
      } else if (/\.(vue|js)$/.test(entry.name)) files.push(join(folder, entry.name));
    }
  })(sources);
  const defined = strings[DEFAULT_LOCALE];
  const undefinedKeys = [];
  let calls = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const asked = [];
    for (const match of source.matchAll(CALL)) asked.push(literal(match[2], match[1]));
    for (const match of source.matchAll(EITHER)) asked.push(literal(match[2], match[1]), literal(match[4], match[3]));
    calls += asked.length;
    for (const key of asked) if (!defined.has(key)) undefinedKeys.push(`"${key}" in ${relative(sources, file)}`);
  }
  assert.ok(calls > 1000, 'the pattern still finds the app\'s translation calls');
  assert.deepEqual([...new Set(undefinedKeys)], []);
});
