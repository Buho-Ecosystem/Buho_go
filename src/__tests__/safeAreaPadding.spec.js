/**
 * The app pads for the system bars itself, with --safe-top and --safe-bottom
 * (src/css/app.css). Quasar 2.32 started to pad on Android too: it puts
 * `q-safe-area-padding` on <body>, and that class sets every bottom sheet's
 * bottom padding to the bare inset, which beats the sheet's own padding.
 * On older Android WebViews the inset is 0, so sheets lost their bottom
 * padding; on newer ones, sheets that pad inside got the inset twice
 * (issue #452). quasar.config.js turns Quasar's Android padding off.
 *
 * Run directly with Node:
 *   node src/__tests__/safeAreaPadding.spec.js
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

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

/** The `capacitor: { ... }` block of the framework config, as flag -> value. */
function capacitorFlags() {
  const config = readFileSync(join(ROOT, 'quasar.config.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const block = config.match(/framework:\s*\{\s*config:\s*\{[\s\S]*?capacitor:\s*\{([^}]*)\}/);
  assert.ok(block, 'quasar.config.js has no framework.config.capacitor block');
  return Object.fromEntries(
    [...block[1].matchAll(/(\w+)\s*:\s*(true|false)/g)].map(([, key, value]) => [key, value === 'true']),
  );
}

test('Quasar does not pad for the system bars on Android', () => {
  assert.equal(capacitorFlags().androidStatusBarPadding, false);
});

test('iOS keeps Quasar\'s padding (naming the capacitor block turns it off unless set)', () => {
  assert.equal(capacitorFlags().iosStatusBarPadding, true);
});

test('the installed Quasar still reads both switches for the body class', () => {
  const quasarDir = dirname(createRequire(join(ROOT, 'package.json')).resolve('quasar/package.json'));
  const body = readFileSync(join(quasarDir, 'src/plugins/private.body/Body.js'), 'utf8');
  assert.match(body, /androidStatusBarPadding !== false[\s\S]*?q-safe-area-padding/);
  assert.match(body, /iosStatusBarPadding\)[\s\S]*?q-ios-padding/);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
