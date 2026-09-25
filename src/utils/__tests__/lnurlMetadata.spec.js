/**
 * lnurlMetadata — LUD-06 payRequest metadata parsing for LUD-11 services.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/lnurlMetadata.spec.js
 */

import { strict as assert } from 'node:assert';
import { parsePayRequestMetadata, serviceTitle, serviceAddressLine, normalizeServiceImage } from '../lnurlMetadata.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

console.log('lnurlMetadata');

await test('every LUD-06 entry type parses, first occurrence wins', () => {
  const meta = parsePayRequestMetadata(JSON.stringify([
    ['text/plain', '  Corner Coffee\nSecond line  '],
    ['text/long-desc', 'Espresso bar on the corner'],
    ['text/identifier', 'Pay@Coffee.Example'],
    ['image/png;base64', PNG],
    ['text/plain', 'ignored second description'],
    ['image/jpeg;base64', '/9j/'],
  ]));
  assert.equal(meta.description, 'Corner Coffee\nSecond line');
  assert.equal(meta.longDescription, 'Espresso bar on the corner');
  assert.equal(meta.identifier, 'pay@coffee.example');
  assert.deepEqual(meta.image, { mime: 'image/png', base64: PNG });
});

await test('an array is accepted as well as a JSON string; text/email counts as the identifier', () => {
  const meta = parsePayRequestMetadata([['text/plain', 'Shop'], ['text/email', 'shop@example.com']]);
  assert.equal(meta.description, 'Shop');
  assert.equal(meta.identifier, 'shop@example.com');
});

await test('malformed input yields nulls and never throws', () => {
  const empty = { description: null, longDescription: null, identifier: null, image: null };
  assert.deepEqual(parsePayRequestMetadata('not json'), empty);
  assert.deepEqual(parsePayRequestMetadata('{"a":1}'), empty);
  assert.deepEqual(parsePayRequestMetadata(null), empty);
  assert.deepEqual(parsePayRequestMetadata(undefined), empty);
  assert.deepEqual(parsePayRequestMetadata([['text/plain'], 'x', ['image/png;base64', 42], null]), empty);
});

await test('an identifier that is not a Lightning address is dropped', () => {
  assert.equal(parsePayRequestMetadata([['text/identifier', 'not an address']]).identifier, null);
  assert.equal(parsePayRequestMetadata([['text/identifier', 'https://evil.example']]).identifier, null);
});

await test('only png/jpeg base64 images within the cap are kept', () => {
  assert.equal(parsePayRequestMetadata([['image/gif;base64', PNG]]).image, null);
  assert.equal(parsePayRequestMetadata([['image/png;base64', 'not*base64!']]).image, null);
  assert.equal(parsePayRequestMetadata([['image/png;base64', 'A'.repeat(96 * 1024 + 1)]]).image, null);
  assert.equal(parsePayRequestMetadata([['image/png;base64', 'A'.repeat(96 * 1024)]]).image.base64.length, 96 * 1024);
});

await test('text is cleaned of control characters and clamped', () => {
  const meta = parsePayRequestMetadata([['text/plain', 'a\u0000b\u0007c' + 'x'.repeat(300)]]);
  assert.equal(meta.description.startsWith('a b c'), true);
  assert.equal(meta.description.length, 256);
  assert.equal(parsePayRequestMetadata([['text/long-desc', 'y'.repeat(3000)]]).longDescription.length, 2048);
});

await test('serviceTitle uses the first description line, clamped, else the domain', () => {
  assert.equal(serviceTitle({ description: 'Corner Coffee\nOpen daily' }, 'coffee.example'), 'Corner Coffee');
  assert.equal(serviceTitle({ description: '' }, 'coffee.example'), 'coffee.example');
  assert.equal(serviceTitle(null, 'coffee.example'), 'coffee.example');
  const clamped = serviceTitle({ description: 'A very long description that goes well past forty characters' }, 'x.example');
  assert.equal(clamped, 'A very long description that goes well…');
  assert.ok(clamped.length <= 40);
});

await test('serviceAddressLine names the host and the kind, and degrades to the kind alone', () => {
  const t = (key) => ({ 'payment link': 'Zahlungslink' }[key] || key);
  assert.equal(serviceAddressLine('lnurlp://coffee.example/pay', t), 'coffee.example · Zahlungslink');
  assert.equal(serviceAddressLine('not-a-link', t), 'Zahlungslink');
});

await test('normalizeServiceImage resolves null outside a browser and for missing input', async () => {
  assert.equal(await normalizeServiceImage(null), null);
  assert.equal(await normalizeServiceImage({ mime: 'image/png', base64: PNG }), null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
