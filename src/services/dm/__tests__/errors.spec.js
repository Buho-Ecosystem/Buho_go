/**
 * Contact chat error and relay-reply tests.
 *
 * `DmError` is what every service throws, and the relay-reply helpers decide
 * whether the transport authenticates, retries or gives up, so the cases here
 * are table-driven and include the hostile input a third-party relay can send.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/errors.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';
import {
  DM_ERROR,
  DmError,
  RELAY_REASON,
  isAuthRequired,
  isDeliveredRelayReason,
  isRetryableRelayReason,
  parseRelayReason,
} from '../errors.js';

const NO_REASON = { prefix: null, message: '' };

// ---------------------------------------------------------------------------
// DM_ERROR
// ---------------------------------------------------------------------------

const REQUIRED_CODES = [
  'INVALID_ARGUMENT',
  'MESSAGE_TOO_LARGE',
  'NO_IDENTITY',
  'KEY_WIPED',
  'NO_INBOX_RELAYS',
  'NO_RELAY_ACCEPTED',
  'RELAY_UNAVAILABLE',
  'AUTH_FAILED',
  'TIMEOUT',
  'INVALID_INVOICE',
  'INVOICE_EXPIRED',
  'SECRET_KEY_IN_TEXT',
  'WALLET_CANNOT_INVOICE',
  'WALLET_CANNOT_PAY',
];

test('DM_ERROR defines every code the contract names', () => {
  for (const code of REQUIRED_CODES) assert.equal(DM_ERROR[code], code);
});

test('every DM_ERROR value equals its key', () => {
  for (const [key, value] of Object.entries(DM_ERROR)) assert.equal(value, key);
});

test('DM_ERROR is frozen: codes cannot be changed, added or removed', () => {
  assert.ok(Object.isFrozen(DM_ERROR));
  assert.throws(() => { DM_ERROR.TIMEOUT = 'OTHER'; }, TypeError);
  assert.throws(() => { DM_ERROR.NEW_CODE = 'NEW_CODE'; }, TypeError);
  assert.throws(() => { delete DM_ERROR.TIMEOUT; }, TypeError);
  assert.equal(DM_ERROR.TIMEOUT, 'TIMEOUT');
  assert.equal(DM_ERROR.NEW_CODE, undefined);
});

// ---------------------------------------------------------------------------
// DmError
// ---------------------------------------------------------------------------

test('DmError is an Error named DmError that keeps its code and message', () => {
  const err = new DmError(DM_ERROR.NO_IDENTITY, 'identity not created yet');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof DmError);
  assert.equal(err.name, 'DmError');
  assert.equal(err.code, 'NO_IDENTITY');
  assert.equal(err.message, 'identity not created yet');
  assert.equal(String(err), 'DmError: identity not created yet');
});

test('DmError falls back to the code as its message', () => {
  assert.equal(new DmError(DM_ERROR.TIMEOUT).message, 'TIMEOUT');
  assert.equal(new DmError(DM_ERROR.TIMEOUT, '').message, 'TIMEOUT');
  assert.equal(new DmError(DM_ERROR.TIMEOUT, null).message, 'TIMEOUT');
  const details = { relay: 'wss://a' };
  assert.equal(new DmError(DM_ERROR.TIMEOUT, undefined, { details }).message, 'TIMEOUT');
});

test('DmError accepts every DM_ERROR code', () => {
  for (const code of Object.values(DM_ERROR)) assert.equal(new DmError(code).code, code);
});

const UNKNOWN_CODES = [
  undefined,
  null,
  '',
  'timeout',
  ' TIMEOUT',
  'TIMEOUT ',
  'NO_INBOX_RELAY',
  'NOPE',
  42,
  true,
  {},
  [],
  ['TIMEOUT'],
  'toString',
  'constructor',
  '__proto__',
  Symbol('TIMEOUT'),
];

for (const code of UNKNOWN_CODES) {
  test(`DmError rejects the unknown code ${inspect(code)}`, () => {
    assert.throws(
      () => new DmError(code, 'message'),
      (error) => error instanceof TypeError
        && !(error instanceof DmError)
        && /^Unknown DmError code: /.test(error.message),
    );
  });
}

test('DmError keeps the underlying failure as the standard cause', () => {
  const cause = new Error('socket closed');
  const err = new DmError(DM_ERROR.RELAY_UNAVAILABLE, 'relay down', { cause });
  assert.equal(err.cause, cause);
  assert.ok(Object.hasOwn(err, 'cause'));
});

test('DmError keeps a cause that is not an Error', () => {
  assert.equal(new DmError(DM_ERROR.TIMEOUT, 'slow', { cause: 'plain text' }).cause, 'plain text');
  assert.equal(new DmError(DM_ERROR.TIMEOUT, 'slow', { cause: null }).cause, null);
});

test('DmError without a cause has no cause property at all', () => {
  assert.equal(Object.hasOwn(new DmError(DM_ERROR.TIMEOUT), 'cause'), false);
  assert.equal(Object.hasOwn(new DmError(DM_ERROR.TIMEOUT, 'slow', {}), 'cause'), false);
  const explicitlyUndefined = new DmError(DM_ERROR.TIMEOUT, 'slow', { cause: undefined });
  assert.equal(Object.hasOwn(explicitlyUndefined, 'cause'), false);
});

test('DmError keeps its details object as given', () => {
  const details = { relay: 'wss://relay.example', attempts: 3 };
  const err = new DmError(DM_ERROR.NO_RELAY_ACCEPTED, 'all refused', { details });
  assert.equal(err.details, details);
});

test('DmError keeps cause and details together', () => {
  const cause = new Error('boom');
  const details = { relays: ['wss://a', 'wss://b'] };
  const err = new DmError(DM_ERROR.NO_RELAY_ACCEPTED, 'all refused', { cause, details });
  assert.equal(err.cause, cause);
  assert.equal(err.details, details);
});

test('DmError without details has undefined details', () => {
  assert.equal(new DmError(DM_ERROR.TIMEOUT).details, undefined);
  assert.equal(new DmError(DM_ERROR.TIMEOUT, 'slow', {}).details, undefined);
});

test('DmError refuses a message that is not a string so misplaced options fail loudly', () => {
  const options = { cause: new Error('x'), details: { relay: 'wss://a' } };
  assert.throws(() => new DmError(DM_ERROR.TIMEOUT, options), TypeError);
  assert.throws(() => new DmError(DM_ERROR.TIMEOUT, new Error('x')), TypeError);
  assert.throws(() => new DmError(DM_ERROR.TIMEOUT, 42), TypeError);
});

test('DmError can be thrown, caught and inspected like any Error', async () => {
  const fail = async () => {
    throw new DmError(DM_ERROR.NO_INBOX_RELAYS, 'no kind 10050 list', {
      details: { pubkey: 'ab'.repeat(32) },
    });
  };
  await assert.rejects(fail, (error) => {
    assert.ok(DmError.is(error, DM_ERROR.NO_INBOX_RELAYS));
    assert.equal(error.details.pubkey, 'ab'.repeat(32));
    assert.equal(typeof error.stack, 'string');
    return true;
  });
});

// ---------------------------------------------------------------------------
// DmError.is
// ---------------------------------------------------------------------------

class SubError extends DmError {}

const errorWithCode = Object.assign(new Error('x'), { code: 'TIMEOUT' });

const IS_CASES = [
  ['a DmError, any code', new DmError(DM_ERROR.TIMEOUT), undefined, true],
  ['a DmError with the same code', new DmError(DM_ERROR.TIMEOUT), DM_ERROR.TIMEOUT, true],
  ['a DmError with another code', new DmError(DM_ERROR.TIMEOUT), DM_ERROR.KEY_WIPED, false],
  ['a DmError and an unknown code', new DmError(DM_ERROR.TIMEOUT), 'NOT_A_CODE', false],
  ['a DmError subclass', new SubError(DM_ERROR.AUTH_FAILED), DM_ERROR.AUTH_FAILED, true],
  ['a plain Error', new Error('x'), undefined, false],
  ['a TypeError', new TypeError('x'), undefined, false],
  ['a plain Error carrying a matching code', errorWithCode, DM_ERROR.TIMEOUT, false],
  ['a lookalike object', { name: 'DmError', code: 'TIMEOUT' }, DM_ERROR.TIMEOUT, false],
  ['a string', 'TIMEOUT', DM_ERROR.TIMEOUT, false],
  ['a number', 42, undefined, false],
  ['null', null, undefined, false],
  ['undefined', undefined, undefined, false],
];

for (const [label, value, code, expected] of IS_CASES) {
  test(`DmError.is(${label}) is ${expected}`, () => {
    assert.equal(DmError.is(value, code), expected);
  });
}

// ---------------------------------------------------------------------------
// RELAY_REASON
// ---------------------------------------------------------------------------

test('RELAY_REASON holds the NIP-01 prefixes and auth-required, exactly', () => {
  assert.deepEqual(RELAY_REASON, {
    DUPLICATE: 'duplicate',
    POW: 'pow',
    BLOCKED: 'blocked',
    RATE_LIMITED: 'rate-limited',
    INVALID: 'invalid',
    RESTRICTED: 'restricted',
    MUTE: 'mute',
    ERROR: 'error',
    AUTH_REQUIRED: 'auth-required',
  });
});

test('RELAY_REASON keys are UPPER_SNAKE_CASE and values are lowercase prefixes', () => {
  for (const [key, value] of Object.entries(RELAY_REASON)) {
    assert.match(key, /^[A-Z]+(?:_[A-Z]+)*$/);
    assert.match(value, /^[a-z]+(?:-[a-z]+)*$/);
    assert.equal(key.toLowerCase().replaceAll('_', '-'), value, 'the key spells the value');
  }
});

test('RELAY_REASON is frozen: prefixes cannot be changed, added or removed', () => {
  assert.ok(Object.isFrozen(RELAY_REASON));
  assert.throws(() => { RELAY_REASON.BLOCKED = 'banned'; }, TypeError);
  assert.throws(() => { RELAY_REASON.UNSUPPORTED = 'unsupported'; }, TypeError);
  assert.throws(() => { delete RELAY_REASON.BLOCKED; }, TypeError);
  assert.equal(RELAY_REASON.BLOCKED, 'blocked');
  assert.equal(RELAY_REASON.UNSUPPORTED, undefined);
});

// ---------------------------------------------------------------------------
// parseRelayReason
// ---------------------------------------------------------------------------

// [input, expected prefix, expected message]
const PARSE_CASES = [
  // Replies in the style of the NIP-01 and NIP-42 examples.
  ['duplicate: already have this event', 'duplicate', 'already have this event'],
  ['pow: difficulty 26 is less than 30', 'pow', 'difficulty 26 is less than 30'],
  ['blocked: you are banned from posting here', 'blocked', 'you are banned from posting here'],
  ['rate-limited: slow down there chief', 'rate-limited', 'slow down there chief'],
  [
    'invalid: event creation date is too far off from the current time',
    'invalid',
    'event creation date is too far off from the current time',
  ],
  ['restricted: not allowed to write.', 'restricted', 'not allowed to write.'],
  ['mute: no one wants to hear from you!', 'mute', 'no one wants to hear from you!'],
  ['error: could not connect to the database', 'error', 'could not connect to the database'],
  [
    'auth-required: we only accept events from registered users',
    'auth-required',
    'we only accept events from registered users',
  ],

  // Case variations in the prefix; the message keeps its case.
  ['Auth-Required: sign in first', 'auth-required', 'sign in first'],
  ['AUTH-REQUIRED:', 'auth-required', ''],
  ['Rate-Limited:slow', 'rate-limited', 'slow'],
  ['BLOCKED: Spam From Here', 'blocked', 'Spam From Here'],

  // Extra whitespace around the reason and after the colon.
  ['  blocked:   spam  ', 'blocked', 'spam'],
  ['\n\tduplicate: seen it\n', 'duplicate', 'seen it'],
  ['restricted:\tnot you', 'restricted', 'not you'],

  // A prefix with nothing after it.
  ['duplicate:', 'duplicate', ''],
  ['duplicate: ', 'duplicate', ''],
  ['auth-required:    ', 'auth-required', ''],

  // A bare keyword, no colon.
  ['duplicate', 'duplicate', ''],
  ['  AUTH-REQUIRED  ', 'auth-required', ''],
  ['rate-limited', 'rate-limited', ''],

  // Further colons belong to the message.
  ['invalid: bad tag: ["p"]', 'invalid', 'bad tag: ["p"]'],
  ['blocked:blocked: twice', 'blocked', 'blocked: twice'],
  ['error::', 'error', ':'],

  // Unknown prefixes and plain text come back whole, trimmed.
  ['foo: bar', null, 'foo: bar'],
  [
    'unsupported: filter contains unknown elements',
    null,
    'unsupported: filter contains unknown elements',
  ],
  ['you are banned', null, 'you are banned'],
  ['  spaced out  ', null, 'spaced out'],
  [':', null, ':'],
  [': blocked', null, ': blocked'],
  ['x: blocked: y', null, 'x: blocked: y'],
  ['please auth-required: x', null, 'please auth-required: x'],

  // Near misses are not prefixes.
  ['blocked : x', null, 'blocked : x'],
  ['blocked-user: x', null, 'blocked-user: x'],
  ['unblocked: x', null, 'unblocked: x'],
  ['errors: x', null, 'errors: x'],
  ['ratelimited: x', null, 'ratelimited: x'],
  ['rate_limited: x', null, 'rate_limited: x'],
  ['auth_required: x', null, 'auth_required: x'],
  ['duplicate event', null, 'duplicate event'],
  ['blocked： x', null, 'blocked： x'],

  // Nothing to read.
  ['', null, ''],
  ['   ', null, ''],
  ['\n', null, ''],
];

for (const [input, prefix, message] of PARSE_CASES) {
  test(`parseRelayReason(${inspect(input)})`, () => {
    assert.deepEqual(parseRelayReason(input), { prefix, message });
  });
}

const NOT_STRINGS = [
  undefined,
  null,
  0,
  42,
  NaN,
  true,
  false,
  12n,
  {},
  [],
  ['blocked: x'],
  { prefix: 'blocked', message: 'x' },
  new Error('blocked: x'),
  () => 'blocked: x',
  Symbol('blocked: x'),
];

for (const input of NOT_STRINGS) {
  test(`parseRelayReason(${inspect(input)}) finds no reason`, () => {
    assert.deepEqual(parseRelayReason(input), NO_REASON);
  });
}

test('parseRelayReason never throws, even for objects that explode when touched', () => {
  const explosive = {
    toString() { throw new Error('boom'); },
    valueOf() { throw new Error('boom'); },
  };
  const trap = new Proxy({}, { get() { throw new Error('boom'); } });
  for (const input of [explosive, trap, Object.create(null)]) {
    assert.deepEqual(parseRelayReason(input), NO_REASON);
  }
});

test('parseRelayReason passes a very long message through untouched', () => {
  const long = 'x'.repeat(200_000);
  assert.deepEqual(parseRelayReason(`blocked: ${long}`), { prefix: 'blocked', message: long });
  assert.deepEqual(parseRelayReason(long), { prefix: null, message: long });
});

test('parseRelayReason recognises every RELAY_REASON prefix, in any case', () => {
  for (const prefix of Object.values(RELAY_REASON)) {
    const loud = prefix.toUpperCase();
    for (const text of [prefix, loud, `${prefix}: why`, `${loud}: why`]) {
      assert.equal(parseRelayReason(text).prefix, prefix, text);
    }
  }
});

test('parseRelayReason returns a fresh object each time', () => {
  const first = parseRelayReason('blocked: x');
  first.prefix = 'tampered';
  assert.equal(parseRelayReason('blocked: x').prefix, 'blocked');
  assert.notEqual(parseRelayReason(undefined), parseRelayReason(undefined));
});

// ---------------------------------------------------------------------------
// isAuthRequired
// ---------------------------------------------------------------------------

const AUTH_REQUIRED_INPUTS = [
  'auth-required: please authenticate',
  'Auth-Required:',
  '  AUTH-REQUIRED  ',
  '\tauth-required:\n',
  { prefix: 'auth-required', message: '' },
  { prefix: 'auth-required', message: 'sign in' },
  parseRelayReason('auth-required: we only accept events from registered users'),
  // Seen live on relay.damus.io and relay.nostr.net (2026-10-10): one nested level.
  'ERROR: auth-required: requested filter requires authentication',
  'error: auth-required: x',
  '  Error:  Auth-Required  ',
  'error:auth-required',
  { prefix: 'error', message: 'auth-required: requested filter requires authentication' },
  parseRelayReason('ERROR: auth-required: requested filter requires authentication'),
];

for (const input of AUTH_REQUIRED_INPUTS) {
  test(`isAuthRequired(${inspect(input)}) is true`, () => {
    assert.equal(isAuthRequired(input), true);
  });
}

const NOT_AUTH_REQUIRED_INPUTS = [
  'blocked: auth-required',
  'restricted: authenticated users only',
  'please auth-required: x',
  'auth-required-ish: x',
  'auth_required: x',
  '',
  undefined,
  null,
  { prefix: 'restricted', message: '' },
  { prefix: null, message: 'auth-required: x' },
  // Only `error` may wrap the prefix, and only once.
  'blocked: auth-required: x',
  'restricted: auth-required',
  'error: error: auth-required: x',
  'error: please auth-required: x',
  'error: authenticated users only',
  'error:',
  { prefix: 'error', message: 'error: auth-required' },
  { prefix: 'error', message: 42 },
  { prefix: 'error' },
  { prefix: 'Auth-Required', message: '' },
  {},
  [],
  42,
  true,
  Symbol('auth-required'),
];

for (const input of NOT_AUTH_REQUIRED_INPUTS) {
  test(`isAuthRequired(${inspect(input)}) is false`, () => {
    assert.equal(isAuthRequired(input), false);
  });
}

// ---------------------------------------------------------------------------
// isRetryableRelayReason
// ---------------------------------------------------------------------------

const RETRYABLE = ['rate-limited', 'error', 'auth-required'];
const PERMANENT = ['blocked', 'invalid', 'restricted', 'mute', 'pow', 'duplicate'];

for (const prefix of RETRYABLE) {
  test(`isRetryableRelayReason('${prefix}') is true`, () => {
    assert.equal(isRetryableRelayReason(prefix), true);
  });
}

for (const prefix of PERMANENT) {
  test(`isRetryableRelayReason('${prefix}') is false`, () => {
    assert.equal(isRetryableRelayReason(prefix), false);
  });
}

const NOT_PREFIXES = [
  null,
  undefined,
  '',
  'unknown',
  'Rate-Limited',
  'rate-limited: slow down',
  42,
  {},
  { prefix: 'error' },
  [],
];

for (const input of NOT_PREFIXES) {
  test(`isRetryableRelayReason(${inspect(input)}) is false`, () => {
    assert.equal(isRetryableRelayReason(input), false);
  });
}

test('every RELAY_REASON prefix is classified as retryable or permanent, never both', () => {
  assert.deepEqual([...RETRYABLE, ...PERMANENT].sort(), Object.values(RELAY_REASON).sort());
});

// ---------------------------------------------------------------------------
// isDeliveredRelayReason
// ---------------------------------------------------------------------------

const DELIVERED = [
  [{ ok: true }, 'accepted, no reason at all'],
  [{ ok: true, reason: '' }, 'accepted with the empty reason NIP-01 prescribes'],
  [{ ok: true, reason: 'duplicate: already have this event' }, 'accepted as a duplicate'],
  [{ ok: true, reason: 'blocked: ignored because ok wins' }, 'ok wins over any reason'],
  [{ ok: false, reason: 'duplicate: already have this event' }, 'refused as a duplicate'],
  [{ ok: false, reason: 'Duplicate:' }, 'duplicate, any case, nothing after the colon'],
  [{ ok: false, reason: '  DUPLICATE  ' }, 'bare duplicate keyword'],
];

for (const [result, label] of DELIVERED) {
  test(`isDeliveredRelayReason delivers: ${label}`, () => {
    assert.equal(isDeliveredRelayReason(result), true);
  });
}

const NOT_DELIVERED = [
  [{ ok: false }, 'refused, no reason'],
  [{ ok: false, reason: '' }, 'refused, empty reason'],
  [{ ok: false, reason: undefined }, 'refused, reason undefined'],
  [{ ok: false, reason: null }, 'refused, reason null'],
  [{ ok: false, reason: 'auth-required: log in' }, 'auth-required'],
  [{ ok: false, reason: 'blocked: banned' }, 'blocked'],
  [{ ok: false, reason: 'rate-limited: slow down' }, 'rate-limited'],
  [{ ok: false, reason: 'invalid: bad signature' }, 'invalid'],
  [{ ok: false, reason: 'restricted: no' }, 'restricted'],
  [{ ok: false, reason: 'mute: no' }, 'mute'],
  [{ ok: false, reason: 'pow: more work' }, 'pow'],
  [{ ok: false, reason: 'error: database down' }, 'error'],
  [{ ok: false, reason: 'some text with duplicate in it' }, 'duplicate only in the middle'],
  [{ ok: false, reason: 'foo: duplicate' }, 'duplicate behind an unknown prefix'],
  [{ ok: false, reason: 42 }, 'reason that is not a string'],
  [{ ok: 'true' }, 'ok that is not a boolean'],
  [{ ok: 1, reason: 'blocked: x' }, 'ok that is only truthy'],
  [{ reason: 'blocked: x' }, 'no ok flag'],
  [{}, 'empty result'],
  [undefined, 'no result'],
  [null, 'null result'],
  ['duplicate: already have this event', 'a bare string instead of a result'],
  [42, 'a number instead of a result'],
];

for (const [result, label] of NOT_DELIVERED) {
  test(`isDeliveredRelayReason does not deliver: ${label}`, () => {
    assert.equal(isDeliveredRelayReason(result), false);
  });
}

// ---------------------------------------------------------------------------
// The three decisions together, as the transport uses them
// ---------------------------------------------------------------------------

// [raw reason of a refused publish, authenticate?, retry later?, already delivered?]
const DECISIONS = [
  ['auth-required: log in first', true, true, false],
  ['ERROR: auth-required: requested filter requires authentication', true, true, false],
  ['rate-limited: slow down', false, true, false],
  ['error: database unavailable', false, true, false],
  ['duplicate: already have this event', false, false, true],
  ['blocked: banned', false, false, false],
  ['invalid: bad signature', false, false, false],
  ['restricted: not allowed to write', false, false, false],
  ['mute: no one wants to hear from you', false, false, false],
  ['pow: need 25 bits', false, false, false],
  ['something unexpected', false, false, false],
  [undefined, false, false, false],
];

for (const [reason, authenticate, retry, delivered] of DECISIONS) {
  test(`a refused publish with reason ${inspect(reason)} is handled correctly`, () => {
    const parsed = parseRelayReason(reason);
    assert.equal(isAuthRequired(reason), authenticate);
    assert.equal(isAuthRequired(parsed), authenticate);
    assert.equal(isRetryableRelayReason(parsed.prefix), retry);
    assert.equal(isDeliveredRelayReason({ ok: false, reason }), delivered);
  });
}
