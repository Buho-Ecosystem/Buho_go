import { strict as assert } from 'node:assert';
import {
  MAX_CLIPBOARD_LENGTH,
  abbreviateDestination,
  classifyDestination,
  isSuggestibleDestination,
  normalizeDestination,
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

console.log('clipboardSuggestion: all assertions passed');
