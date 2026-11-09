/**
 * Reading a QR code out of a chosen picture: which looks run, in which
 * order, and what the person is told when there is no code.
 *
 * Run directly with Node:
 *   node --test src/utils/__tests__/qrFromImage.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AFTER_NATIVE_SIDES, LOOK_SIDES, PHOTO_SCAN_ERROR, lookSizes, readQrFromImage } from '../qrFromImage.js';

/** A picture of the given size; `closed` tells whether it was released. */
function picture(width, height) {
  const p = { width, height, closed: false };
  p.close = () => { p.closed = true; };
  return p;
}

/** Looks that find `text` only at the sizes listed in `findsAt` (longest side). */
function looks(text, findsAt = []) {
  const seen = [];
  return {
    seen,
    look: async (_picture, size) => {
      const side = Math.max(size.width, size.height);
      seen.push(side);
      return findsAt.includes(side) ? text : null;
    },
  };
}

test('the looks grow from a screenshot\'s size to a large photo\'s, never past the picture', () => {
  assert.deepEqual(lookSizes(4032, 3024).map((s) => s.width), [800, 1600, 3200]);
  assert.deepEqual(lookSizes(3024, 4032).map((s) => s.height), [800, 1600, 3200], 'portrait: the longest side counts');
  assert.deepEqual(lookSizes(1179, 2556), [{ width: 369, height: 800 }, { width: 738, height: 1600 }, { width: 1179, height: 2556 }]);
  assert.deepEqual(lookSizes(600, 400), [{ width: 600, height: 400 }], 'a small picture is read once, at its size');
  assert.deepEqual(lookSizes(8064, 6048).at(-1), { width: 3200, height: 2400 }, 'a 48-megapixel photo is capped');
  assert.deepEqual(lookSizes(0, 0), []);
  assert.deepEqual(LOOK_SIDES, [800, 1600, 3200]);
});

test('the first look that finds a code answers; the picture is released', async () => {
  const p = picture(4032, 3024);
  const { look, seen } = looks(' lnbc1code ', [1600]);
  assert.equal(await readQrFromImage({}, { open: async () => p, look }), 'lnbc1code');
  assert.deepEqual(seen, [800, 1600], 'no larger look after a find');
  assert.equal(p.closed, true);
});

test('no code in any look: NO_CODE, after every look, and the picture is released', async () => {
  const p = picture(4032, 3024);
  const { look, seen } = looks('x', []);
  await assert.rejects(readQrFromImage({}, { open: async () => p, look }), (err) => err.code === PHOTO_SCAN_ERROR.NO_CODE);
  assert.deepEqual(seen, [800, 1600, 3200]);
  assert.equal(p.closed, true);
});

test('a file that is not a picture this device opens: UNREADABLE, nothing looked at', async () => {
  const { look, seen } = looks('x', [800]);
  await assert.rejects(
    readQrFromImage({}, { open: async () => { throw new Error('decode failed'); }, look }),
    (err) => err.code === PHOTO_SCAN_ERROR.UNREADABLE,
  );
  await assert.rejects(
    readQrFromImage({}, { open: async () => picture(0, 0), look }),
    (err) => err.code === PHOTO_SCAN_ERROR.UNREADABLE,
  );
  assert.deepEqual(seen, []);
});

test('in the app the native decoder reads first, and its code is the answer', async () => {
  const { look, seen } = looks('web', [800, 1600, 3200]);
  const text = await readQrFromImage({}, { readNative: async () => '  nostr+walletconnect://x ', open: async () => picture(4032, 3024), look });
  assert.equal(text, 'nostr+walletconnect://x');
  assert.deepEqual(seen, [], 'the web view never looked');
});

test('the native decoder found nothing: one quick look for a light code on a dark screenshot', async () => {
  const { look, seen } = looks('inverted', [1600]);
  const text = await readQrFromImage({}, { readNative: async () => null, open: async () => picture(1179, 2556), look });
  assert.equal(text, 'inverted');
  assert.deepEqual(seen, [1600]);
  assert.deepEqual(AFTER_NATIVE_SIDES, [1600]);
});

test('the native decoder found nothing and the quick look cannot open it either: still "no code"', async () => {
  // A HEIC photo: the app opens it, the web view does not. The photo opened; it has no code.
  await assert.rejects(
    readQrFromImage({}, { readNative: async () => null, open: async () => { throw new Error('no HEIC here'); } }),
    (err) => err.code === PHOTO_SCAN_ERROR.NO_CODE,
  );
});

test('the native decoder cannot run here: the full looks read the picture', async () => {
  const { look, seen } = looks('found', [3200]);
  const text = await readQrFromImage({}, {
    readNative: async () => { throw Object.assign(new Error('no plugin'), { code: 'NATIVE_UNAVAILABLE' }); },
    open: async () => picture(4032, 3024),
    look,
  });
  assert.equal(text, 'found');
  assert.deepEqual(seen, [800, 1600, 3200]);
});
