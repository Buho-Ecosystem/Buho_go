/**
 * A chat signer for tests: the real local signer (`dmSigner.js` over
 * `sessionKey.js`) for a raw key, so specs run the production path.
 */

import { getPublicKey } from 'nostr-core';
import { createLocalDmSigner } from '../dmSigner.js';
import { createSessionKey } from '../sessionKey.js';

/** @param {Uint8Array} secretKey */
export function keySigner(secretKey) {
  const pubkey = getPublicKey(secretKey);
  // sessionKey zeroes what it loads, so every load hands over a fresh copy.
  return createLocalDmSigner({ pubkey, sessionKey: createSessionKey({ pubkey, load: async () => secretKey.slice() }) });
}
