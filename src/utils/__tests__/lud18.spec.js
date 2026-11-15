/**
 * LUD-18 payer details (utils/lud18.js): what a pay request asks to know
 * about the payer, and what goes back. Each rule is the spec's:
 *   - a listed kind MAY be sent, one marked `"mandatory": true` MUST be sent
 *     or the payment does not go ahead;
 *   - a kind that is not listed SHOULD NOT be sent, nothing when none is.
 * BuhoGO shares the `identifier` kind only.
 *
 * Run: node --test src/utils/__tests__/lud18.spec.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PAYER_DATA_PROBLEM, PAYER_IDENTIFIER, payerDataFor, payerIdentifier, readPayerRequest } from '../lud18.js';

const NOTHING = { asksIdentifier: false, identifierRequired: false, unmetRequired: [] };

describe('what a service asks for', () => {
  test('no record, or one that is not an object, asks for nothing', () => {
    for (const payerData of [undefined, null, '', 'identifier', 0, 1, true, [], [{ identifier: {} }]]) {
      assert.deepEqual(readPayerRequest(payerData), NOTHING, JSON.stringify(payerData));
    }
    assert.deepEqual(readPayerRequest({}), NOTHING, 'an empty record lists nothing');
  });

  test('listing a kind is enough to accept it; only `mandatory: true` demands it', () => {
    for (const record of [{}, { mandatory: false }, null, true, 'yes', { mandatory: 'true' }, { mandatory: 1 }]) {
      assert.deepEqual(readPayerRequest({ identifier: record }), { ...NOTHING, asksIdentifier: true }, JSON.stringify(record));
    }
    assert.deepEqual(readPayerRequest({ identifier: { mandatory: true } }),
      { asksIdentifier: true, identifierRequired: true, unmetRequired: [] });
  });

  test('the provider\'s own record, as its test till code sends it', () => {
    assert.deepEqual(readPayerRequest({ identifier: { mandatory: false } }), { ...NOTHING, asksIdentifier: true });
  });

  test('a required kind BuhoGO never shares is unmet, also one negotiated later', () => {
    const request = readPayerRequest({
      name: { mandatory: true },
      email: { mandatory: true },
      pubkey: { mandatory: false },
      auth: { mandatory: true, k1: 'ab'.repeat(32) },
      identifier: { mandatory: false },
      futureKind: { mandatory: true },
    });
    assert.deepEqual(request, { asksIdentifier: true, identifierRequired: false, unmetRequired: ['name', 'email', 'auth', 'futureKind'] });
    assert.deepEqual(readPayerRequest({ pubkey: { mandatory: false }, name: {} }), NOTHING, 'optional kinds of others are simply not sent');
  });

  test('a hostile record cannot reach the prototype or flood the details', () => {
    const parsed = JSON.parse('{"__proto__":{"mandatory":true},"identifier":{}}');
    const request = readPayerRequest(parsed);
    assert.deepEqual(request.unmetRequired, ['__proto__'], 'an odd kind that is required still stops the payment');
    assert.equal({}.mandatory, undefined, 'nothing leaked into Object.prototype');
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${'x'.repeat(100)}${i}`, { mandatory: true }]));
    const flooded = readPayerRequest(many).unmetRequired;
    assert.equal(flooded.length, 8);
    assert.ok(flooded.every((kind) => kind.length <= 32));
  });

  test('an inherited `identifier` is not one the service listed', () => {
    const record = Object.create({ identifier: { mandatory: true } });
    assert.deepEqual(readPayerRequest(record), NOTHING);
  });
});

describe('the address that may be shared', () => {
  test('a Lightning address, trimmed', () => {
    assert.equal(payerIdentifier('  alice@example.com '), 'alice@example.com');
    assert.equal(payerIdentifier('a.b+c%d_e-f@pay.example.co.za'), 'a.b+c%d_e-f@pay.example.co.za');
  });

  test('anything else is not', () => {
    for (const value of [null, undefined, 42, {}, '', '   ', 'alice', 'alice@', '@example.com', 'alice@example', 'alice@@example.com',
      'alice smith@example.com', 'alice@example.com/x', 'https://example.com', 'alice@exa mple.com', 'lnurl1dp68gurn8ghj7',
      '"x"@example.com', 'a\u0000@example.com', `${'a'.repeat(310)}@example.com`]) {
      assert.equal(payerIdentifier(value), null, JSON.stringify(value));
    }
  });
});

describe('what goes with a payment', () => {
  const ALICE = 'alice@example.com';
  const sent = (address) => ({ problem: null, kinds: [], sent: { identifier: address }, json: JSON.stringify({ identifier: address }) });
  const nothing = { problem: null, kinds: [], sent: null, json: null };

  test('a service that asks for nothing gets nothing, even with an address at hand', () => {
    assert.deepEqual(payerDataFor(undefined, { identifier: ALICE }), nothing);
    assert.deepEqual(payerDataFor({ name: {}, email: {} }, { identifier: ALICE }), nothing, 'other kinds listed, none shared');
    assert.deepEqual(payerDataFor(null, { identifier: 'not an address' }), nothing, 'an unusable address is not looked at when none is asked for');
  });

  test('an optional address goes when one is given, and nothing when none is', () => {
    assert.deepEqual(payerDataFor({ identifier: {} }, { identifier: ALICE }), sent(ALICE));
    assert.deepEqual(payerDataFor({ identifier: { mandatory: false } }), nothing);
    assert.deepEqual(payerDataFor({ identifier: { mandatory: false } }, { identifier: null }), nothing);
    assert.deepEqual(payerDataFor({ identifier: { mandatory: false } }, { identifier: '  ' }), nothing, 'blank is none');
  });

  test('a required address goes, or the payment does not', () => {
    assert.deepEqual(payerDataFor({ identifier: { mandatory: true } }, { identifier: ` ${ALICE} ` }), sent(ALICE));
    assert.deepEqual(payerDataFor({ identifier: { mandatory: true } }), { ...nothing, problem: PAYER_DATA_PROBLEM.REQUIRED });
  });

  test('an address that cannot be sent stops the payment instead of going quietly missing', () => {
    for (const payerData of [{ identifier: {} }, { identifier: { mandatory: true } }]) {
      assert.deepEqual(payerDataFor(payerData, { identifier: 'alice' }), { ...nothing, problem: PAYER_DATA_PROBLEM.INVALID });
    }
  });

  test('a required kind BuhoGO never shares stops the payment first', () => {
    const verdict = payerDataFor({ identifier: { mandatory: true }, email: { mandatory: true } }, { identifier: ALICE });
    assert.deepEqual(verdict, { ...nothing, problem: PAYER_DATA_PROBLEM.UNSUPPORTED, kinds: ['email'] });
  });

  test('only the identifier is ever sent, as one exact text', () => {
    const verdict = payerDataFor({ identifier: {}, name: {}, pubkey: {}, email: {} }, { identifier: ALICE, name: 'Alice', email: 'a@b.c' });
    assert.deepEqual(Object.keys(verdict.sent), [PAYER_IDENTIFIER]);
    assert.equal(verdict.json, '{"identifier":"alice@example.com"}');
  });
});
