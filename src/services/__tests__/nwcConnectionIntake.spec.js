import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listenForNwcConnection, offerNwcConnection, takeNwcConnection } from '../nwcConnectionIntake.js';
import { looksLikeNwcConnection } from '../../utils/nwcConnection.js';

const CONNECTION = `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&secret=${'5e'.repeat(32)}`;

function router(path = '/wallet') {
  const pushes = [];
  return { pushes, currentRoute: { value: { path } }, push(to) { pushes.push(to); return Promise.resolve(); } };
}

test('every way a wallet writes a connection is recognised, valid or not', () => {
  for (const text of [
    CONNECTION,
    `  ${CONNECTION}  `,
    CONNECTION.replace('nostr+walletconnect://', 'NOSTR+WALLETCONNECT://'),
    CONNECTION.replace('nostr+walletconnect://', 'nostrwalletconnect://'),
    CONNECTION.replace('nostr+walletconnect://', 'nostr+walletconnect:'),
    CONNECTION.replace('nostr+walletconnect://', 'web+nostrwalletconnect://'),
    `lightning:${CONNECTION}`,
    'nostr+walletconnect://not-a-key', // broken: the connect sheet says what is wrong
  ]) {
    assert.equal(looksLikeNwcConnection(text), true, text.slice(0, 40));
  }
});

test('payments and other Nostr links are not connections', () => {
  for (const text of ['lightning:lnbc10u1p0examplexyz', 'maria@mybuho.de', 'nostr:npub1example', 'bunker://abc?relay=wss://r', 'bitcoin:bc1qexample', '', null]) {
    assert.equal(looksLikeNwcConnection(text), false, String(text));
  }
});

test('a connection goes to the connect sheet, handed over once and never in the route', () => {
  const r = router();
  assert.equal(offerNwcConnection(`  ${CONNECTION} `, r), true);
  assert.deepEqual(r.pushes, ['/nwc-setup']);
  assert.equal(takeNwcConnection(), CONNECTION);
  assert.equal(takeNwcConnection(), '', 'only once');
});

test('an open connect sheet receives a new connection directly', () => {
  const r = router('/nwc-setup');
  const received = [];
  const stop = listenForNwcConnection((connection) => received.push(connection));
  assert.equal(offerNwcConnection(CONNECTION, r), true);
  assert.deepEqual(received, [CONNECTION]);
  assert.deepEqual(r.pushes, []);
  assert.equal(takeNwcConnection(), '', 'nothing left behind');

  stop();
  assert.equal(offerNwcConnection(CONNECTION, r), true);
  assert.deepEqual(received, [CONNECTION], 'a closed sheet no longer listens');
  assert.deepEqual(r.pushes, ['/nwc-setup']);
  takeNwcConnection();
});

test('anything else is left alone', () => {
  const r = router();
  assert.equal(offerNwcConnection('lightning:maria@mybuho.de', r), false);
  assert.deepEqual(r.pushes, []);
  assert.equal(takeNwcConnection(), '');
});
