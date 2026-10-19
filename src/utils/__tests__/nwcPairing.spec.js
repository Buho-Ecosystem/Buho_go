/**
 * utils/nwcPairing: the links that ask a wallet to approve BuhoGO, and
 * reading the wallet's answer.
 *
 *   node --test src/utils/__tests__/nwcPairing.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPublicKey, hexToBytes } from 'nostr-core';
import {
  ALBY_CLOUD_URL, COINOS, HUB_RELAYS, PAIRING_TTL_MS, RETURN_PATH,
  coinosApprovalUrl, coinosConnection, connectionFor, createPairingRequest,
  hubApprovalUrl, isPairingExpired, normalizeHubUrl, pairingReturnRoute,
  readHubReturn, readWalletAnswer, returnUrlFor, walletAuthUri,
} from '../nwcPairing.js';
import { parseNwcConnection } from '../nwcConnection.js';

const WALLET = 'a'.repeat(64);
const request = createPairingRequest('code', { now: 1_000_000 });

test('a request has its own key pair, a state and an id', () => {
  assert.match(request.secret, /^[a-f0-9]{64}$/);
  assert.equal(request.pubkey, getPublicKey(hexToBytes(request.secret)));
  assert.match(request.state, /^[a-f0-9]{32}$/, 'at least 128 bits, lower-case hex (NWC-08)');
  assert.match(request.id, /^[a-f0-9]{24}$/);
  const other = createPairingRequest('code');
  assert.notEqual(other.secret, request.secret);
  assert.notEqual(other.state, request.state);
});

test('a request expires after the pairing window', () => {
  assert.equal(isPairingExpired(request, 1_000_000 + PAIRING_TTL_MS), false);
  assert.equal(isPairingExpired(request, 1_000_001 + PAIRING_TTL_MS), true);
  assert.equal(isPairingExpired(null), true);
});

test('the code names BuhoGO, its key, the state and what it asks for, never the secret', () => {
  const uri = walletAuthUri(request);
  assert.ok(uri.startsWith(`nostr+walletauth://${request.pubkey}?`));
  assert.ok(!uri.includes(request.secret));
  const params = new URL(uri.replace('nostr+walletauth://', 'https://')).searchParams;
  assert.deepEqual(params.getAll('relay'), HUB_RELAYS);
  assert.equal(params.get('state'), request.state);
  assert.equal(params.get('name'), 'BuhoGO');
  assert.equal(params.get('request_methods'), 'pay_invoice make_invoice lookup_invoice get_balance get_info list_transactions');
  assert.equal(params.get('optional_request_methods'), 'get_budget');
  assert.equal(params.get('notification_types'), 'payment_received payment_sent');
  assert.ok(!uri.includes('+pay'), 'spaces as %20, not +');
});

test('the Hub link carries our key and a return address with the request id', () => {
  const hub = { ...request, kind: 'hub', hubUrl: 'https://hub.example.com' };
  const url = new URL(hubApprovalUrl(hub));
  assert.equal(url.origin + url.pathname, 'https://hub.example.com/apps/new');
  assert.equal(url.searchParams.get('pubkey'), request.pubkey);
  assert.equal(url.searchParams.get('app'), 'buhogo');
  assert.equal(url.searchParams.get('name'), 'BuhoGO');
  assert.equal(url.searchParams.get('return_to'), `https://go.mybuho.de/nwc/connected?request=${request.id}`);
  assert.ok(!url.href.includes(request.secret));
  assert.ok(hubApprovalUrl({ ...hub, hubUrl: '' }).startsWith(`${ALBY_CLOUD_URL}/apps/new?`), 'Alby Cloud when no address');
});

test('the Coinos link carries our key only, and its connection is known up front', () => {
  const url = new URL(coinosApprovalUrl(request));
  assert.equal(url.href.split('?')[0], 'https://coinos.io/apps/new');
  assert.equal(url.searchParams.get('pubkey'), request.pubkey);
  const parsed = parseNwcConnection(coinosConnection(request));
  assert.equal(parsed.pubkey, COINOS.walletPubkey);
  assert.deepEqual(parsed.relays, [COINOS.relay]);
  assert.equal(parsed.secret, request.secret);
});

test('a typed Hub address becomes an origin with https by default', () => {
  assert.equal(normalizeHubUrl('hub.example.com'), 'https://hub.example.com');
  assert.equal(normalizeHubUrl(' https://hub.example.com/ '), 'https://hub.example.com');
  assert.equal(normalizeHubUrl('https://hub.example.com/apps/new'), 'https://hub.example.com');
  assert.equal(normalizeHubUrl('http://umbrel.local:8029'), 'http://umbrel.local:8029');
  assert.equal(normalizeHubUrl('https://example.com/hub/'), 'https://example.com/hub');
  assert.equal(normalizeHubUrl(''), '');
  assert.equal(normalizeHubUrl('ftp://hub.example.com'), '');
  assert.equal(normalizeHubUrl('not a url'), '');
  assert.equal(normalizeHubUrl('https://not%20a%20hub'), '', 'an escaped space is not a host either');
  assert.equal(normalizeHubUrl('http://192.168.1.20:8080/'), 'http://192.168.1.20:8080');
});

test('an approved request becomes a normal connection string', () => {
  const connection = connectionFor(request, { walletPubkey: WALLET.toUpperCase(), relays: ['wss://relay.getalby.com', 'not-a-relay'], lud16: 'maria@getalby.com' });
  const parsed = parseNwcConnection(connection);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.pubkey, WALLET);
  assert.deepEqual(parsed.relays, ['wss://relay.getalby.com']);
  assert.equal(parsed.secret, request.secret);
  assert.equal(parsed.lud16, 'maria@getalby.com');
  assert.equal(connectionFor(request, { walletPubkey: 'nope', relays: ['wss://r.example'] }), '');
  assert.equal(connectionFor(request, { walletPubkey: WALLET, relays: [] }), '');
});

const answer = (tags, extra = {}) => ({ kind: 13194, pubkey: WALLET, tags, content: 'pay_invoice', ...extra });

test('a wallet answer must name our key', () => {
  assert.equal(readWalletAnswer(answer([['p', 'b'.repeat(64)], ['state', request.state]]), request, 'wss://relay.getalby.com'), null);
  assert.equal(readWalletAnswer(answer([['p', request.pubkey], ['state', request.state]], { kind: 1 }), request, 'wss://relay.getalby.com'), null);
});

test('an answer with state must carry ours, and may move the connection to its relays', () => {
  const ok = readWalletAnswer(answer([['p', request.pubkey], ['state', request.state], ['relay', 'wss://relay.wallet.example']]), request, 'wss://relay.getalby.com');
  assert.deepEqual(ok, { walletPubkey: WALLET, relays: ['wss://relay.wallet.example'] });
  assert.equal(readWalletAnswer(answer([['p', request.pubkey], ['state', 'f'.repeat(32)]]), request, 'wss://relay.getalby.com'), null);
});

test('an answer without state counts only from a Hub relay (Alby Hub sends none)', () => {
  assert.deepEqual(
    readWalletAnswer(answer([['p', request.pubkey]]), request, 'wss://relay2.getalby.com/'),
    { walletPubkey: WALLET, relays: ['wss://relay2.getalby.com'] },
  );
  assert.equal(readWalletAnswer(answer([['p', request.pubkey]]), request, 'wss://relay.other.example'), null);
});

test('a Hub return gives the wallet key, relays and Lightning address', () => {
  const back = readHubReturn({ request: request.id, relay: ['wss://relay.getalby.com', 'wss://relay2.getalby.com'], pubkey: WALLET, lud16: 'maria@getalby.com' });
  assert.deepEqual(back, { requestId: request.id, walletPubkey: WALLET, relays: ['wss://relay.getalby.com', 'wss://relay2.getalby.com'], lud16: 'maria@getalby.com', state: '' });
  const nwc08 = readHubReturn({ request: request.id, relay_url: 'wss://r.example', wallet_pubkey: WALLET, state: request.state });
  assert.equal(nwc08.walletPubkey, WALLET);
  assert.deepEqual(nwc08.relays, ['wss://r.example']);
  assert.equal(nwc08.state, request.state);
  assert.equal(readHubReturn({ relay: 'wss://r.example', pubkey: WALLET }), null, 'no request id');
  assert.equal(readHubReturn({ request: request.id, pubkey: WALLET }), null, 'no relay');
});

test('only the return address on go.mybuho.de becomes the return route', () => {
  const route = pairingReturnRoute(`https://go.mybuho.de/nwc/connected?request=${request.id}&relay=wss%3A%2F%2Fa&relay=wss%3A%2F%2Fb&pubkey=${WALLET}`);
  assert.deepEqual(route, { path: RETURN_PATH, query: { request: request.id, relay: ['wss://a', 'wss://b'], pubkey: WALLET } });
  assert.equal(pairingReturnRoute('https://evil.example/nwc/connected?request=x'), null);
  assert.equal(pairingReturnRoute('https://go.mybuho.de/p/maria'), null);
  assert.equal(pairingReturnRoute('lightning:lnbc1'), null);
  assert.equal(returnUrlFor(route.query), `https://go.mybuho.de/nwc/connected?request=${request.id}&relay=wss%3A%2F%2Fa&relay=wss%3A%2F%2Fb&pubkey=${WALLET}`);
});
