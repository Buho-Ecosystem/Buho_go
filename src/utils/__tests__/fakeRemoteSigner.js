/**
 * A remote signer (NIP-46) on the fake relay network, for tests of
 * services/identitySigners.js. It holds a user key and answers the requests
 * that reach its relay: connect, get_public_key, sign_event. `askApproval(url)`
 * makes it answer the next request with that approval page first (NIP-46
 * `auth_url`), then with the result.
 *
 * `install()` makes it the global `WebSocket`, which nostr-core's Relay uses;
 * `dispose()` restores it.
 *
 * Test helper only: not imported by application code.
 */

import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-core';
import { createFakeNetwork } from '../../services/dm/__tests__/fakeRelay.js';

const NIP46_KIND = 24133;

export function createFakeRemoteSigner({ url = 'wss://signer.test' } = {}) {
  const network = createFakeNetwork();
  const server = network.addRelay(url);
  const signerKey = generateSecretKey();
  const userKey = generateSecretKey();
  const remotePubkey = getPublicKey(signerKey);
  /** Every request the signer received, decrypted: `{ id, method, params }`. */
  const requests = [];
  /** Approval pages to name before the next answer. */
  const approvals = [];
  const previousWebSocket = globalThis.WebSocket;

  function answer(request) {
    switch (request.method) {
      case 'connect': return { result: 'ack' };
      case 'get_public_key': return { result: getPublicKey(userKey) };
      case 'sign_event': return { result: JSON.stringify(finalizeEvent(JSON.parse(request.params[0]), userKey)) };
      default: return { error: `unsupported: ${request.method}` };
    }
  }

  const inject = server.inject.bind(server);
  server.inject = (event) => {
    inject(event);
    if (event.kind !== NIP46_KIND || !event.tags.some(([name, value]) => name === 'p' && value === remotePubkey)) return;
    const key = nip44.getConversationKey(signerKey, event.pubkey);
    const request = JSON.parse(nip44.decrypt(event.content, key));
    requests.push(request);
    const send = (reply) => inject(finalizeEvent({
      kind: NIP46_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', event.pubkey]],
      content: nip44.encrypt(JSON.stringify({ id: request.id, ...reply }), key),
    }, signerKey));
    if (request.method !== 'connect') {
      for (const url of approvals.splice(0)) send({ result: 'auth_url', error: url });
    }
    send(answer(request));
  };

  return {
    bunker: { remotePubkey, relays: [url] },
    userPubkey: getPublicKey(userKey),
    requests,
    askApproval(url) {
      approvals.push(url);
    },
    install() {
      globalThis.WebSocket = network.WebSocket;
    },
    dispose() {
      network.dispose();
      globalThis.WebSocket = previousWebSocket;
    },
  };
}
