import { strict as assert } from 'node:assert';
import {
  MAX_CLIPBOARD_LENGTH,
  abbreviateDestination,
  classifyDestination,
  fingerprint,
  createClipboardOfferMemory,
  isSuggestibleDestination,
  normalizeDestination,
  offerLabelKey,
} from '../clipboardSuggestion.js';

const npub = 'npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7';

// Wrappers come off before classification, for every wallet type.
assert.equal(classifyDestination('lightning:alice@example.com', 'spark'), 'lightning_address');
assert.equal(classifyDestination('  alice@example.com  ', null), 'lightning_address');
assert.equal(classifyDestination('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'spark'), 'bitcoin_address');
assert.equal(classifyDestination('just some words', 'spark'), 'unknown');
assert.equal(classifyDestination('', 'spark'), 'unknown');
assert.deepEqual(normalizeDestination('lnurl:alice@example.com', 'nwc'), { cleaned: 'alice@example.com', bip21: null });

// Payable rails are offered, identities are always offered, noise never is.
assert.equal(isSuggestibleDestination('alice@example.com', 'spark'), true);
assert.equal(isSuggestibleDestination('alice@example.com', 'nwc'), true);
assert.equal(isSuggestibleDestination(npub, 'spark'), true);
assert.equal(isSuggestibleDestination(`nostr:${npub}`, 'lnbits'), true);
assert.equal(isSuggestibleDestination('just some words', 'spark'), false);
assert.equal(isSuggestibleDestination('', 'spark'), false);
assert.equal(isSuggestibleDestination('a'.repeat(MAX_CLIPBOARD_LENGTH + 1), 'spark'), false);

// One line on the strip: both ends of a long code, whole when it is short.
assert.equal(abbreviateDestination('alice@example.com'), 'alice@example.com');
assert.equal(abbreviateDestination('LNURL1DP68GURN8GHJ7MRWW4EXCTNXD9SHG6NPVCHXXMMD9AKXUATJDSKHQCTED'), 'LNURL1DP68GURN…JDSKHQCTED');
assert.equal(abbreviateDestination('  padded  ', { head: 2, tail: 2 }), 'pa…ed');

// The strip names the thing in the app's own words, never the rail.
assert.equal(offerLabelKey('alice@example.com', 'spark'), 'Copied address');
assert.equal(offerLabelKey('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'spark'), 'Copied address');
assert.equal(offerLabelKey('LNURL1DP68GURN8GHJ7MRWW4EXCTNXD9SHG6NPVCHXXMMD9AKXUATJDSKHQCTED', 'spark'), 'Copied payment request');
assert.equal(offerLabelKey(`nostr:${npub}`, 'spark'), 'Copied Nostr profile');
assert.equal(offerLabelKey('+254712345678', 'spark'), 'Copied phone number');

// Only fingerprints reach storage; session memory survives storage failure.
const store = new Map();
const storage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value),
};
const memory = createClipboardOfferMemory(storage);
assert.equal(memory.hasBeenOffered('alice@example.com'), false);
memory.rememberOffered('alice@example.com');
assert.equal(memory.hasBeenOffered('alice@example.com'), true);
assert.equal(createClipboardOfferMemory(storage).hasBeenOffered('alice@example.com'), true);
assert.equal(memory.hasBeenOffered('bob@example.com'), false);
assert.ok(![...store.values()].some((value) => value.includes('example.com')));
assert.match(fingerprint('alice@example.com'), /^[0-9a-f]{8}$/);

// Observing a different clipboard is separate from displaying a payable offer.
for (const changed of ['ordinary copied text', '', 'bob@example.com']) {
  memory.rememberOffered('alice@example.com');
  memory.observe(changed);
  assert.equal(memory.hasBeenOffered('alice@example.com'), false);
  assert.equal(createClipboardOfferMemory(storage).hasBeenOffered('alice@example.com'), false);
}
memory.rememberOffered('alice@example.com');
memory.observe('  alice@example.com  ');
memory.observe(null); // Denied / failed reads are not clipboard changes.
assert.equal(memory.hasBeenOffered('alice@example.com'), true);

for (const unavailable of [null, {
  getItem() { throw new Error('unavailable'); },
  setItem() { throw new Error('unavailable'); },
}]) {
  const fallback = createClipboardOfferMemory(unavailable);
  fallback.rememberOffered('alice@example.com');
  assert.equal(fallback.hasBeenOffered('alice@example.com'), true);
  fallback.observe('ordinary copied text');
  assert.equal(fallback.hasBeenOffered('alice@example.com'), false);
}

// A failed write must not allow an older on-disk value to overwrite memory.
const failingWrites = createClipboardOfferMemory({
  getItem: storage.getItem,
  setItem() { throw new Error('quota'); },
});
failingWrites.observe('different text');
assert.equal(failingWrites.hasBeenOffered('alice@example.com'), false);
failingWrites.rememberOffered('bob@example.com');
assert.equal(failingWrites.hasBeenOffered('bob@example.com'), true);

console.log('clipboardSuggestion: all assertions passed');
