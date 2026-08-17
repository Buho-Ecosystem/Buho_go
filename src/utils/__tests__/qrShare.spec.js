/**
 * qrShare — label fitting tests.
 *
 * The canvas rendering itself needs a browser; what must never regress
 * in CI is the middle-truncation that puts a readable identifier on the
 * share card: both ends preserved (the parts of an address people
 * compare), monotone shrinking until it fits, and a sane floor for
 * absurdly narrow widths. Measurement is injected as a ctx-shaped stub.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/qrShare.spec.js
 */

import { strict as assert } from 'node:assert';
import { fitLabelToWidth } from '../qrShare.js';

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

// 10px per character — deterministic stand-in for measureText.
const ctx = { measureText: (t) => ({ width: t.length * 10 }) };

const ADDRESS = 'sp1pgss9y5twlyx6m2h5m9nk7c4t2u8xq3v0z1a2b3c4d5e6f7g8h9j0kl';

test('text that fits is returned untouched', () => {
  assert.equal(fitLabelToWidth(ctx, 'short', 100), 'short');
  assert.equal(fitLabelToWidth(ctx, 'exactly10!', 100), 'exactly10!');
});

test('long text is middle-truncated to fit', () => {
  const out = fitLabelToWidth(ctx, ADDRESS, 320);
  assert.ok(ctx.measureText(out).width <= 320, 'must fit the width');
  assert.ok(out.includes('…'), 'must show the ellipsis');
  assert.ok(out.length < ADDRESS.length);
});

test('both ends of the identifier survive truncation', () => {
  const out = fitLabelToWidth(ctx, ADDRESS, 320);
  const [head, tail] = out.split('…');
  assert.ok(ADDRESS.startsWith(head), 'head must be a prefix of the original');
  assert.ok(ADDRESS.endsWith(tail), 'tail must be a suffix of the original');
  assert.ok(head.length >= 2 && tail.length >= 2);
});

test('result shrinks monotonically with the available width', () => {
  const wide = fitLabelToWidth(ctx, ADDRESS, 400);
  const narrow = fitLabelToWidth(ctx, ADDRESS, 200);
  assert.ok(narrow.length <= wide.length);
  assert.ok(ctx.measureText(narrow).width <= 200);
});

test('absurdly narrow width still yields the 2+2 floor, never an empty string', () => {
  const out = fitLabelToWidth(ctx, ADDRESS, 10);
  assert.equal(out, `${ADDRESS.slice(0, 2)}…${ADDRESS.slice(-2)}`);
});

test('unicode identifiers are handled (no mid-codepoint surprises for our charset)', () => {
  const out = fitLabelToWidth(ctx, 'käse@zahlung.de'.repeat(6), 300);
  assert.ok(ctx.measureText(out).width <= 300);
  assert.ok(out.includes('…'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
