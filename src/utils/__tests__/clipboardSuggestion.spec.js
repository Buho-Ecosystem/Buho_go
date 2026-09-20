import { strict as assert } from 'node:assert';
import {
  MAX_CLIPBOARD_LENGTH,
  abbreviateDestination,
  classifyDestination,
  fingerprint,
  hasBeenOffered,
  isSuggestibleDestination,
  normalizeDestination,
  offerLabelKey,
  rememberOffered,
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

// The offer memory outlives the component: it tracks the last text only,
// and stores a fingerprint rather than the clipboard's contents.
const store = new Map();
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
};
assert.equal(hasBeenOffered('alice@example.com', storage), false);
rememberOffered('alice@example.com', storage);
assert.equal(hasBeenOffered('alice@example.com', storage), true);
assert.equal(hasBeenOffered('bob@example.com', storage), false);
rememberOffered('bob@example.com', storage);
assert.equal(hasBeenOffered('alice@example.com', storage), false);
assert.equal(hasBeenOffered('bob@example.com', storage), true);
assert.ok(![...store.values()].some((v) => v.includes('example.com')));
assert.equal(fingerprint('alice@example.com'), fingerprint('alice@example.com'));
assert.notEqual(fingerprint('alice@example.com'), fingerprint('alice@example.co'));
assert.match(fingerprint(''), /^[0-9a-f]{8}$/);

// No storage at all: never "seen", never throws.
assert.equal(hasBeenOffered('alice@example.com', null), false);
rememberOffered('alice@example.com', null);
const broken = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
assert.equal(hasBeenOffered('alice@example.com', broken), false);
rememberOffered('alice@example.com', broken);

console.log('clipboardSuggestion: all assertions passed');
